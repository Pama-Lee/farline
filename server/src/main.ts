import { existsSync, readFileSync, statSync } from 'node:fs'
import { extname, join, normalize, resolve } from 'node:path'
import { serve } from '@hono/node-server'
import { getSessionMessages, listSessions } from '@anthropic-ai/claude-agent-sdk'
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { sessionActivity } from './activity.ts'
import { isAuthed, login, logout, requireAuth, setPassword } from './auth.ts'
import { config, underFsRoot } from './config.ts'
import { clearKey, deepseekKey, saveKey, status as deepseekStatus } from './deepseek.ts'
import { DEEPSEEK_MODELS, allViews, cachedView, createView, models, openView, warmModels } from './live.ts'
import { subscribe, unsubscribe, vapidPublicKey, notify } from './push.ts'
import { save, state } from './store.ts'
import { requestTitle } from './titles.ts'
import { listDirs, loadUpload, saveUpload } from './uploads.ts'
import type { CreateBody, EffortLevel, Patch, PermissionMode, Provider, SendBody, SessionSummary } from '../../shared/types.ts'

if (process.argv[2] === 'set-password') {
  const pw = process.argv[3]
  if (!pw || pw.length < 12) throw new Error('password must be at least 12 characters')
  setPassword(pw)
  console.log('password updated')
  process.exit(0)
}

const MODES: PermissionMode[] = ['default', 'auto', 'acceptEdits', 'plan', 'bypassPermissions']
const EFFORTS: EffortLevel[] = ['low', 'medium', 'high', 'xhigh', 'max']
const IMAGE_EXT: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' }

const app = new Hono()

app.post('/api/login', login)
app.post('/api/logout', logout)
app.get('/api/me', (c) => c.json({ authed: isAuthed(c) }))

const api = new Hono()
api.use('*', requireAuth)

// The remembered directory may have been deleted since; fall back quietly.
api.get('/device', (c) => {
  const last = state.prefs.lastCwd && listDirs(state.prefs.lastCwd) ? state.prefs.lastCwd : undefined
  return c.json({ name: config.deviceName, defaultCwd: last ?? config.defaultCwd, prefs: { ...state.prefs, lastCwd: last } })
})

api.get('/models', (c) => c.json(models()))

api.get('/deepseek', async (c) => c.json(await deepseekStatus()))

api.put('/deepseek', async (c) => {
  const { key } = await c.req.json<{ key?: unknown }>().catch(() => ({ key: undefined }))
  if (typeof key !== 'string') return c.json({ error: 'bad key' }, 400)
  try {
    await saveKey(key)
  } catch (e: any) {
    return c.json({ error: e?.message ?? '保存失败' }, 400)
  }
  for (const v of allViews()) v.deepseekKeyChanged()
  return c.json(await deepseekStatus())
})

api.delete('/deepseek', async (c) => {
  clearKey()
  for (const v of allViews()) v.deepseekKeyChanged()
  return c.json(await deepseekStatus())
})

// Ordered by the last real message, not file mtime: the Claude app bridge
// keeps appending status lines to idle sessions, which would float weeks-old
// threads above new ones. Small enough (tens of sessions) to sort in full.
api.get('/sessions', async (c) => {
  const limit = Math.min(Number(c.req.query('limit') ?? 40), 100)
  const offset = Number(c.req.query('offset') ?? 0)
  const infos = await listSessions()
  const now = Date.now()
  const rows: (SessionSummary & { firstPrompt?: string })[] = []
  const seen = new Set<string>()
  for (const info of infos) {
    seen.add(info.sessionId)
    const meta = state.sessions[info.sessionId]
    if (meta?.hidden) continue
    const view = cachedView(info.sessionId)
    const act = sessionActivity(info.sessionId)
    const title = view?.title || meta?.title || info.customTitle || state.titles[info.sessionId]
    rows.push({
      id: info.sessionId,
      title: title ?? '',
      firstPrompt: title ? undefined : info.firstPrompt ?? info.summary,
      cwd: info.cwd ?? '',
      updatedAt: Math.max(act.at || info.createdAt || info.lastModified, view?.live ? view.lastActive : 0),
      status: view ? view.sessionState().status : now - info.lastModified < 10 * 60_000 && act.running ? 'busy_elsewhere' : 'idle',
      provider: meta?.provider ?? 'claude',
    })
  }
  // Started here moments ago, transcript not on disk yet.
  for (const v of allViews()) {
    if (seen.has(v.id) || v.meta.hidden || !v.live) continue
    const st = v.sessionState()
    rows.push({ id: v.id, title: st.title || '新会话', cwd: st.cwd, updatedAt: v.lastActive, status: st.status, provider: st.provider })
  }
  rows.sort((x, y) => y.updatedAt - x.updatedAt)
  const page = rows.slice(offset, offset + limit).map(({ firstPrompt, ...s }) => {
    if (s.title) return s
    requestTitle(s.id, firstPrompt)
    return { ...s, title: (firstPrompt ?? '').replace(/\s+/g, ' ').slice(0, 40) || '未命名会话' }
  })
  return c.json({ sessions: page, nextOffset: rows.length > offset + limit ? offset + limit : null })
})

api.post('/sessions', async (c) => {
  const body = await c.req.json<CreateBody>()
  const dirs = listDirs(body.cwd)
  if (!dirs) return c.json({ error: '目录不可用' }, 400)
  const provider: Provider = body.provider === 'deepseek' && deepseekKey() ? 'deepseek' : 'claude'
  // DeepSeek sessions run with every permission open unless told otherwise.
  const permissionMode = MODES.includes(body.permissionMode) ? body.permissionMode : provider === 'deepseek' ? 'bypassPermissions' : 'auto'
  const model = models().some((m) => m.provider === provider && m.value === body.model) ? body.model : provider === 'deepseek' ? 'deepseek-v4-pro' : 'opus'
  const effort = body.effort && EFFORTS.includes(body.effort) ? body.effort : 'xhigh'
  const classifierModel = body.classifierModel && DEEPSEEK_MODELS.some((m) => m.value === body.classifierModel) ? body.classifierModel : undefined
  state.prefs = { lastCwd: dirs.path, provider, model, permissionMode, effort, classifierModel }
  save()
  const view = createView(dirs.path, { provider, model, permissionMode, effort, classifierModel })
  view.title = body.text.trim().replace(/\s+/g, ' ').slice(0, 40)
  view.send(body.text, body.uploads)
  return c.json({ id: view.id })
})

api.get('/sessions/:id', async (c) => {
  const view = await openView(c.req.param('id'))
  if (!view) return c.json({ error: 'not found' }, 404)
  return c.json(view.snapshot(c.req.query('all') === '1'))
})

api.get('/sessions/:id/events', async (c) => {
  const view = await openView(c.req.param('id'))
  if (!view) return c.json({ error: 'not found' }, 404)
  const since = Number(c.req.query('since') ?? -1)
  c.header('Cache-Control', 'no-cache, no-transform')
  c.header('X-Accel-Buffering', 'no')
  return streamSSE(c, async (stream) => {
    const send = (p: Patch) => void stream.writeSSE({ event: 'patch', data: JSON.stringify(p), id: String(p.seq) })
    view.subscribers.add(send)
    if (since !== view.log.seq) await stream.writeSSE({ event: 'reset', data: String(view.log.seq) })
    const hb = setInterval(() => void stream.writeSSE({ event: 'ping', data: '' }), 15_000)
    await new Promise<void>((resolve) => stream.onAbort(resolve))
    clearInterval(hb)
    view.subscribers.delete(send)
    view.lastActive = Date.now()
  })
})

api.post('/sessions/:id/messages', async (c) => {
  const view = await openView(c.req.param('id'))
  if (!view) return c.json({ error: 'not found' }, 404)
  if (view.sessionState().status === 'busy_elsewhere') return c.json({ error: '这个会话正在别处运行' }, 409)
  const body = await c.req.json<SendBody>()
  if (!body.text?.trim() && !body.uploads?.length) return c.json({ error: 'empty' }, 400)
  view.send(body.text ?? '', body.uploads)
  return c.json({ ok: true })
})

api.post('/sessions/:id/interrupt', async (c) => {
  const view = cachedView(c.req.param('id'))
  await view?.interrupt()
  return c.json({ ok: true })
})

api.post('/sessions/:id/permission', async (c) => {
  const { reqId, decision } = await c.req.json<{ reqId: string; decision: 'allow' | 'always' | 'deny' }>()
  const ok = cachedView(c.req.param('id'))?.decide(reqId, decision) ?? false
  return c.json({ ok }, ok ? 200 : 409)
})

api.post('/sessions/:id/answer', async (c) => {
  const { reqId, answers } = await c.req.json<{ reqId: string; answers: Record<string, string> | null }>()
  const ok = cachedView(c.req.param('id'))?.answer(reqId, answers) ?? false
  return c.json({ ok }, ok ? 200 : 409)
})

api.patch('/sessions/:id', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json<{ permissionMode?: PermissionMode; model?: string; effort?: EffortLevel; provider?: Provider; classifierModel?: string; title?: string; hidden?: boolean }>()
  const view = await openView(id)
  if (!view) return c.json({ error: 'not found' }, 404)
  if (body.permissionMode && !MODES.includes(body.permissionMode)) return c.json({ error: 'bad mode' }, 400)
  if (body.effort && !EFFORTS.includes(body.effort)) return c.json({ error: 'bad effort' }, 400)
  if (body.provider && !(body.provider === 'claude' || (body.provider === 'deepseek' && deepseekKey()))) return c.json({ error: 'bad provider' }, 400)
  const provider = body.provider ?? view.meta.provider
  if (body.model && !models().some((m) => m.provider === provider && m.value === body.model)) return c.json({ error: 'bad model' }, 400)
  if (body.classifierModel && !DEEPSEEK_MODELS.some((m) => m.value === body.classifierModel)) return c.json({ error: 'bad classifier' }, 400)
  if (typeof body.title === 'string' && body.title.trim()) {
    view.meta.title = body.title.trim().slice(0, 60)
    view.title = view.meta.title
  }
  if (typeof body.hidden === 'boolean') view.meta.hidden = body.hidden
  await view.update({ permissionMode: body.permissionMode, model: body.model, effort: body.effort, provider: body.provider, classifierModel: body.classifierModel })
  return c.json(view.sessionState())
})

api.get('/sessions/:id/mcp', async (c) => {
  const view = await openView(c.req.param('id'))
  return c.json(view ? await view.mcpStatus() : [])
})

// Image lookups parse the whole transcript; a thread of thumbnails asks for
// several at once, so keep the parsed messages for a moment.
const transcriptCache = new Map<string, { at: number; messages: Promise<any[]> }>()
function transcript(id: string) {
  const hit = transcriptCache.get(id)
  if (hit && Date.now() - hit.at < 30_000) return hit.messages
  const messages = getSessionMessages(id) as Promise<any[]>
  transcriptCache.set(id, { at: Date.now(), messages })
  for (const [k, v] of transcriptCache) if (Date.now() - v.at > 30_000) transcriptCache.delete(k)
  return messages
}

function imageResponse(c: any, src: any) {
  if (src?.type !== 'base64') return c.json({ error: 'not found' }, 404)
  return c.body(Buffer.from(src.data, 'base64'), 200, { 'content-type': src.media_type, 'cache-control': 'private, max-age=31536000, immutable' })
}

api.get('/sessions/:id/images/:uuid/:idx', async (c) => {
  const m: any = (await transcript(c.req.param('id'))).find((x) => x.uuid === c.req.param('uuid'))
  const blocks = Array.isArray(m?.message?.content) ? m.message.content.filter((b: any) => b.type === 'image') : []
  return imageResponse(c, blocks[Number(c.req.param('idx'))]?.source)
})

api.get('/sessions/:id/tool-images/:toolUseId/:idx', async (c) => {
  const toolUseId = c.req.param('toolUseId')
  for (const m of await transcript(c.req.param('id'))) {
    const content = m?.message?.content
    if (!Array.isArray(content)) continue
    const result = content.find((b: any) => b.type === 'tool_result' && b.tool_use_id === toolUseId)
    if (!result) continue
    const images = Array.isArray(result.content) ? result.content.filter((b: any) => b.type === 'image') : []
    return imageResponse(c, images[Number(c.req.param('idx'))]?.source)
  }
  return c.json({ error: 'not found' }, 404)
})

// Images that tools read from disk, shown as thumbnails under the step.
api.get('/file', (c) => {
  const p = resolve(c.req.query('path') ?? '')
  const type = IMAGE_EXT[extname(p).toLowerCase()]
  if (!type || !underFsRoot(p) || !existsSync(p) || statSync(p).size > 20 * 1024 * 1024) return c.json({ error: 'not found' }, 404)
  return c.body(readFileSync(p), 200, { 'content-type': type, 'cache-control': 'private, max-age=300' })
})

api.get('/fs', (c) => {
  const listing = listDirs(c.req.query('path'), c.req.query('hidden') === '1')
  return listing ? c.json(listing) : c.json({ error: '目录不可用' }, 400)
})

api.post('/uploads', async (c) => {
  const body = await c.req.parseBody()
  const file = body.file
  if (!(file instanceof File)) return c.json({ error: 'no file' }, 400)
  if (file.size > 50 * 1024 * 1024) return c.json({ error: '文件过大' }, 413)
  return c.json(await saveUpload(file))
})

api.get('/uploads/:id', (c) => {
  const u = loadUpload(c.req.param('id'))
  if (!u || !existsSync(u.path)) return c.json({ error: 'not found' }, 404)
  return c.body(readFileSync(u.path), 200, { 'content-type': u.mime, 'cache-control': 'private, max-age=31536000, immutable' })
})

api.get('/push/key', (c) => c.json({ key: vapidPublicKey }))
api.post('/push/subscribe', async (c) => {
  const sub = await c.req.json()
  if (!sub?.endpoint || !sub?.keys?.p256dh) return c.json({ error: 'bad subscription' }, 400)
  subscribe({ endpoint: sub.endpoint, keys: sub.keys })
  return c.json({ ok: true })
})
api.post('/push/unsubscribe', async (c) => {
  const { endpoint } = await c.req.json<{ endpoint: string }>()
  unsubscribe(endpoint)
  return c.json({ ok: true })
})
api.post('/push/test', async (c) => {
  await notify('通知已开启', '会话完成或需要你处理时会提醒你', '/')
  return c.json({ ok: true })
})

app.route('/api', api)

// ---- static web app ----

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
}

app.get('*', (c) => {
  const rel = normalize(decodeURIComponent(new URL(c.req.url).pathname)).replace(/^(\.\.[/\\])+/, '')
  let file = join(config.webDir, rel)
  if (!file.startsWith(config.webDir) || !existsSync(file) || !statSync(file).isFile()) {
    if (extname(rel)) return c.text('not found', 404)
    file = join(config.webDir, 'index.html')
  }
  const immutable = rel.startsWith('/assets/')
  return c.body(readFileSync(file), 200, {
    'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
    'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
  })
})

serve({ fetch: app.fetch, hostname: config.host, port: config.port }, (info) => {
  console.log(`farline listening on http://${info.address}:${info.port}`)
  warmModels().catch((e) => console.error('model list failed', e?.message))
})

process.on('SIGTERM', () => process.exit(0))
