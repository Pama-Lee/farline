import { existsSync, readFileSync, statSync } from 'node:fs'
import { extname, join, normalize, resolve } from 'node:path'
import { serve } from '@hono/node-server'
import { getSessionMessages, listSessions } from '@anthropic-ai/claude-agent-sdk'
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { sessionActivity } from './activity.ts'
import { isAuthed, login, logout, requireAuth, setPassword } from './auth.ts'
import { config, underFsRoot } from './config.ts'
import { allViews, cachedView, catalog, createView, defaultModel, models, openView, providerLabel, providerReady, warmModels } from './live.ts'
import { existsFile, readPath, resolvePaths } from './files.ts'
import { noteOrigin } from './origin.ts'
import { getPlugin, listPlugins, loadPlugins, pluginAsset, pluginFetch, pluginInfo, pluginStatus, remoteOf, saveSettings, setEnabled, testNotification, uninstall } from './plugins/host.ts'
import { installFromGitHub } from './plugins/remote.ts'
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
api.use('*', async (c, next) => {
  if (c.req.method !== 'GET') noteOrigin(c.req.header('origin'))
  await next()
})

// The remembered directory may have been deleted since; fall back quietly.
api.get('/device', (c) => {
  const last = state.prefs.lastCwd && listDirs(state.prefs.lastCwd) ? state.prefs.lastCwd : undefined
  return c.json({ name: config.deviceName, defaultCwd: last ?? config.defaultCwd, prefs: { ...state.prefs, lastCwd: last } })
})

api.get('/models', (c) => c.json(catalog()))

// ---- plugins ----

api.get('/plugins', (c) => c.json(listPlugins()))

// One install or update at a time.
let installing: Promise<unknown> = Promise.resolve()
const serially = <T>(fn: () => Promise<T>): Promise<T> => {
  const next = installing.then(fn, fn)
  installing = next.catch(() => undefined)
  return next
}

api.post('/plugins/install', async (c) => {
  const { source } = await c.req.json<{ source?: string }>().catch(() => ({ source: undefined }))
  if (!source?.trim()) return c.json({ error: '填 owner/repo 或 GitHub 仓库地址' }, 400)
  try {
    const r = await serially(() => installFromGitHub(source))
    return c.json(r.updated ? pluginInfo(r.plugin) : { error: '已安装' })
  } catch (e: any) {
    return c.json({ error: e?.message ?? '安装失败' }, 400)
  }
})

api.post('/plugins/:id/update', async (c) => {
  const p = getPlugin(c.req.param('id'))
  const remote = p && remoteOf(p)
  if (!p || !remote) return c.json({ error: 'not found' }, 404)
  try {
    const r = await serially(() => installFromGitHub({ repo: remote.repo, ref: remote.ref, path: remote.path }, remote.commit))
    return c.json({ updated: r.updated, plugin: pluginInfo(r.updated ? r.plugin : p) })
  } catch (e: any) {
    return c.json({ error: e?.message ?? '更新失败' }, 400)
  }
})

api.delete('/plugins/:id', async (c) => {
  const p = getPlugin(c.req.param('id'))
  if (!p) return c.json({ error: 'not found' }, 404)
  try {
    await uninstall(p)
  } catch (e: any) {
    return c.json({ error: e?.message ?? '卸载失败' }, 400)
  }
  return c.json({ ok: true })
})

api.get('/plugins/:id/status', async (c) => {
  const p = getPlugin(c.req.param('id'))
  return p ? c.json(await pluginStatus(p)) : c.json({ error: 'not found' }, 404)
})

api.put('/plugins/:id/enabled', async (c) => {
  const p = getPlugin(c.req.param('id'))
  if (!p) return c.json({ error: 'not found' }, 404)
  const { enabled } = await c.req.json<{ enabled?: unknown }>().catch(() => ({ enabled: undefined }))
  if (typeof enabled !== 'boolean') return c.json({ error: 'bad request' }, 400)
  await setEnabled(p, enabled)
  return c.json(pluginInfo(p))
})

api.put('/plugins/:id/settings', async (c) => {
  const p = getPlugin(c.req.param('id'))
  if (!p) return c.json({ error: 'not found' }, 404)
  const body = await c.req.json<Record<string, unknown>>().catch(() => null)
  if (!body || typeof body !== 'object') return c.json({ error: 'bad request' }, 400)
  try {
    await saveSettings(p, body)
  } catch (e: any) {
    return c.json({ error: e?.message ?? '保存失败' }, 400)
  }
  return c.json(pluginInfo(p))
})

api.post('/plugins/:id/test', async (c) => {
  const p = getPlugin(c.req.param('id'))
  if (!p) return c.json({ error: 'not found' }, 404)
  try {
    await testNotification(p)
  } catch (e: any) {
    return c.json({ error: e?.message ?? '发送失败' }, 400)
  }
  return c.json({ ok: true })
})

// Routes a plugin registers on ctx.http.
api.all('/ext/:id/*', (c) => {
  const id = c.req.param('id')
  const p = getPlugin(id)
  if (!p) return c.json({ error: 'not found' }, 404)
  const rest = new URL(c.req.url).pathname.slice(`/api/ext/${id}`.length) || '/'
  return pluginFetch(p, c.req.raw, rest)
})

// Browser code of plugins. Behind login like the rest of the API.
api.get('/plugin-assets/:id/*', (c) => {
  const id = c.req.param('id')
  const p = getPlugin(id)
  const rel = decodeURIComponent(new URL(c.req.url).pathname.slice(`/api/plugin-assets/${id}/`.length))
  const file = p && pluginAsset(p, rel)
  if (!file) return c.json({ error: 'not found' }, 404)
  return c.body(readFileSync(file), 200, {
    'content-type': TYPES[extname(file)] ?? (extname(file) === '.mjs' ? 'text/javascript; charset=utf-8' : 'application/octet-stream'),
    'cache-control': 'private, no-cache',
  })
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
      ...(meta?.provider && meta.provider !== 'claude' ? { providerLabel: providerLabel(meta.provider) } : {}),
      ...(view?.runningTasks ? { tasks: view.runningTasks } : {}),
    })
  }
  // Started here moments ago, transcript not on disk yet.
  for (const v of allViews()) {
    if (seen.has(v.id) || v.meta.hidden || !v.live) continue
    const st = v.sessionState()
    rows.push({
      id: v.id,
      title: st.title || '新会话',
      cwd: st.cwd,
      updatedAt: v.lastActive,
      status: st.status,
      provider: st.provider,
      ...(st.provider !== 'claude' ? { providerLabel: providerLabel(st.provider) } : {}),
      ...(v.runningTasks ? { tasks: v.runningTasks } : {}),
    })
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
  if (body.provider && body.provider !== 'claude' && !providerReady(body.provider)) return c.json({ error: `${providerLabel(body.provider)} 不可用` }, 400)
  const provider: Provider = body.provider || 'claude'
  const info = catalog().providers.find((p) => p.id === provider)
  const permissionMode = MODES.includes(body.permissionMode) ? body.permissionMode : (info?.defaultPermissionMode ?? 'auto')
  const model = models().some((m) => m.provider === provider && m.value === body.model) ? body.model : defaultModel(provider)
  const effort = body.effort && EFFORTS.includes(body.effort) ? body.effort : 'xhigh'
  const classifierModel = body.classifierModel && info?.classifierModels?.includes(body.classifierModel) ? body.classifierModel : undefined
  state.prefs = { lastCwd: dirs.path, provider, model, permissionMode, effort, classifierModel }
  save()
  const view = createView(dirs.path, { provider, model, permissionMode, effort, classifierModel }, body.text.trim().replace(/\s+/g, ' ').slice(0, 40))
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
  try {
    view.send(body.text ?? '', body.uploads)
  } catch (e: any) {
    return c.json({ error: e?.message ?? '发送失败' }, 400)
  }
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
  if (body.provider && !providerReady(body.provider)) return c.json({ error: `${providerLabel(body.provider)} 不可用` }, 400)
  const provider = body.provider ?? view.meta.provider
  if (body.model && !models().some((m) => m.provider === provider && m.value === body.model)) return c.json({ error: 'bad model' }, 400)
  const classifiers = catalog().providers.find((p) => p.id === provider)?.classifierModels ?? []
  if (body.classifierModel && !classifiers.includes(body.classifierModel)) return c.json({ error: 'bad classifier' }, 400)
  if (typeof body.title === 'string' && body.title.trim()) {
    view.meta.title = body.title.trim().slice(0, 60)
    view.title = view.meta.title
  }
  if (typeof body.hidden === 'boolean') view.meta.hidden = body.hidden
  await view.update({ permissionMode: body.permissionMode, model: body.model, effort: body.effort, provider: body.provider, classifierModel: body.classifierModel })
  return c.json(view.sessionState())
})

// ---- background tasks ----

api.get('/sessions/:id/tasks/:taskId/output', async (c) => {
  const view = await openView(c.req.param('id'))
  if (!view) return c.json({ error: 'not found' }, 404)
  return c.json(await view.taskOutput(c.req.param('taskId')))
})

api.post('/sessions/:id/tasks/:taskId/stop', async (c) => {
  const view = cachedView(c.req.param('id'))
  if (!view?.live) return c.json({ error: '会话进程已经结束' }, 409)
  try {
    await view.stopTask(c.req.param('taskId'))
  } catch (e: any) {
    return c.json({ error: e?.message ?? '停止失败' }, 400)
  }
  return c.json({ ok: true })
})

// Move a running foreground command or subagent to the background.
api.post('/sessions/:id/background', async (c) => {
  const { toolUseId } = await c.req.json<{ toolUseId?: string }>().catch(() => ({ toolUseId: undefined }))
  const view = cachedView(c.req.param('id'))
  try {
    const ok = (await view?.backgroundTool(toolUseId)) ?? false
    return c.json({ ok }, ok ? 200 : 409)
  } catch (e: any) {
    return c.json({ error: e?.message ?? '操作失败' }, 400)
  }
})

api.get('/sessions/:id/rewind/:messageId', async (c) => {
  const view = await openView(c.req.param('id'))
  if (!view) return c.json({ error: '会话不存在' }, 404)
  return c.json(await view.rewindPreview(c.req.param('messageId')))
})

api.post('/sessions/:id/rewind', async (c) => {
  const body = await c.req.json<{ messageId?: string; files?: boolean; conversation?: boolean }>().catch(() => ({}) as { messageId?: string; files?: boolean; conversation?: boolean })
  const view = await openView(c.req.param('id'))
  if (!view) return c.json({ error: '会话不存在' }, 404)
  if (!body.messageId || (!body.files && !body.conversation)) return c.json({ error: '参数不对' }, 400)
  try {
    return c.json(await view.rewind(body.messageId, { files: !!body.files, conversation: !!body.conversation }))
  } catch (e: any) {
    return c.json({ error: e?.message ?? '回退失败' }, 409)
  }
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

// Paths written in messages → files on disk, using where the session has been working.
api.post('/fs/resolve', async (c) => {
  const body = await c.req.json<{ paths?: unknown; sessionId?: string; base?: string }>().catch(() => null)
  if (!body || !Array.isArray(body.paths)) return c.json({ error: 'bad request' }, 400)
  const view = body.sessionId ? await openView(body.sessionId).catch(() => undefined) : undefined
  const paths = body.paths.filter((p): p is string => typeof p === 'string' && p.length < 500)
  return c.json(resolvePaths(paths, { view, base: typeof body.base === 'string' ? body.base : undefined, cwd: config.defaultCwd }))
})

api.get('/fs/read', (c) => {
  const r = readPath(c.req.query('path') ?? '')
  return r ? c.json(r) : c.json({ error: '找不到这个文件' }, 404)
})

// The file itself. Never rendered as a page on our origin: text is served as
// plain text and everything runs sandboxed.
api.get('/fs/raw', (c) => {
  const file = existsFile(c.req.query('path') ?? '')
  if (!file || statSync(file).size > 100 * 1024 * 1024) return c.json({ error: 'not found' }, 404)
  const ext = extname(file).toLowerCase()
  const type = ext === '.svg' ? 'image/svg+xml' : (IMAGE_EXT[ext] ?? (c.req.query('download') ? 'application/octet-stream' : 'text/plain; charset=utf-8'))
  const headers: Record<string, string> = {
    'content-type': type,
    'cache-control': 'private, no-cache',
    'content-security-policy': 'sandbox',
    'x-content-type-options': 'nosniff',
  }
  if (c.req.query('download')) headers['content-disposition'] = `attachment; filename*=UTF-8''${encodeURIComponent(file.split('/').pop()!)}`
  return c.body(readFileSync(file), 200, headers)
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
  await notify({ kind: 'test', title: '通知已开启', body: '会话完成或需要你处理时会提醒你', url: '/' })
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

await loadPlugins()

serve({ fetch: app.fetch, hostname: config.host, port: config.port }, (info) => {
  console.log(`farline listening on http://${info.address}:${info.port}`)
  warmModels().catch((e) => console.error('model list failed', e?.message))
})

process.on('SIGTERM', () => process.exit(0))
