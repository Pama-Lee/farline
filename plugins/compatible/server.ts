// Providers you add yourself: any Anthropic-compatible API (a relay, a proxy,
// another vendor). Each one has an address, a key and a list of model ids.
import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import type { Disposable, PluginContext, PluginDefinition } from '../../server/src/plugins/types.ts'

interface Entry {
  id: string
  name: string
  baseUrl: string
  apiKey: string
  models: string[]
  contextWindow?: number
}

// Claude Code appends /v1/messages itself.
function normalize(url: string) {
  return url.trim().replace(/\/+$/, '').replace(/\/v1$/, '')
}

function hint(key: string) {
  return key.length >= 10 ? `${key.slice(0, 3)}…${key.slice(-4)}` : '••••'
}

function parseModels(v: unknown): string[] {
  const list = Array.isArray(v) ? v.map(String) : String(v ?? '').split(/[\s,，]+/)
  return [...new Set(list.map((s) => s.trim()).filter(Boolean))]
}

async function listModels(baseUrl: string, apiKey: string): Promise<string[]> {
  const base = normalize(baseUrl)
  const origin = new URL(base).origin
  // Relays differ in where the list lives; the first that answers wins.
  const urls = [...new Set([`${base}/v1/models`, `${origin}/v1/models`, `${origin}/models`])]
  let last = '连不上这个地址'
  for (const url of urls) {
    const res = await fetch(url, {
      headers: { authorization: `Bearer ${apiKey}`, 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      signal: AbortSignal.timeout(10_000),
    }).catch(() => undefined)
    if (!res) continue
    if (res.status === 401 || res.status === 403) throw new Error('API key 无效')
    if (!res.ok) {
      last = `接口返回 ${res.status}`
      continue
    }
    const data = (await res.json().catch(() => ({}))) as { data?: { id?: string }[] }
    return (data.data ?? []).map((m) => m.id).filter((id): id is string => !!id)
  }
  throw new Error(last)
}

export default {
  async status(ctx) {
    const n = load(ctx).length
    return n ? { summary: `${n} 个` } : { summary: '未添加' }
  },

  activate(ctx) {
    const live = new Map<string, Disposable>()
    const sync = () => {
      for (const d of live.values()) d.dispose()
      live.clear()
      for (const e of load(ctx)) {
        live.set(
          e.id,
          ctx.providers.register({
            id: e.id,
            label: e.name,
            available: () => !!(e.baseUrl && e.apiKey && e.models.length),
            models: () => e.models.map((value) => ({ value, label: value })),
            env: ({ model }) =>
              ctx.helpers.anthropicCompatible({
                baseUrl: e.baseUrl,
                token: e.apiKey,
                model,
                smallModel: e.models[e.models.length - 1],
                contextWindow: e.contextWindow,
              }),
          }),
        )
      }
    }
    sync()

    const view = (e: Entry) => ({ ...e, apiKey: undefined, keyHint: e.apiKey ? hint(e.apiKey) : '' })

    ctx.http.get('/providers', (c) => c.json(load(ctx).map(view)))

    ctx.http.put('/providers/:id', async (c) => {
      const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>)
      const all = load(ctx)
      const id = c.req.param('id')
      const prev = all.find((e) => e.id === id)
      const name = String(body.name ?? '').trim()
      const baseUrl = normalize(String(body.baseUrl ?? ''))
      const apiKey = String(body.apiKey ?? '').trim() || prev?.apiKey || ''
      const models = parseModels(body.models)
      const contextWindow = body.contextWindow ? Number(body.contextWindow) : undefined
      if (!name) return c.json({ error: '填一个名称' }, 400)
      if (!/^https?:\/\/\S+$/.test(baseUrl)) return c.json({ error: '地址要以 http:// 或 https:// 开头' }, 400)
      if (!apiKey) return c.json({ error: '填 API key' }, 400)
      if (!models.length) return c.json({ error: '至少填一个模型' }, 400)
      if (contextWindow !== undefined && !(contextWindow >= 100_000 && contextWindow <= 1_000_000)) {
        return c.json({ error: '上下文长度要在 100000 到 1000000 之间' }, 400)
      }
      const entry: Entry = { id: prev?.id ?? `c-${randomBytes(3).toString('hex')}`, name, baseUrl, apiKey, models, contextWindow }
      save(ctx, prev ? all.map((e) => (e.id === prev.id ? entry : e)) : [...all, entry])
      sync()
      return c.json(view(entry))
    })

    ctx.http.delete('/providers/:id', (c) => {
      save(ctx, load(ctx).filter((e) => e.id !== c.req.param('id')))
      sync()
      return c.json({ ok: true })
    })

    // Check an address and key, and list the models it offers.
    ctx.http.post('/test', async (c) => {
      const body = await c.req.json<{ id?: string; baseUrl?: string; apiKey?: string }>().catch(() => ({}) as any)
      const prev = load(ctx).find((e) => e.id === body.id)
      const apiKey = body.apiKey?.trim() || prev?.apiKey || ''
      if (!body.baseUrl || !apiKey) return c.json({ error: '先填地址和 API key' }, 400)
      try {
        return c.json({ models: await listModels(body.baseUrl, apiKey) })
      } catch (e: any) {
        return c.json({ error: e.message }, 400)
      }
    })

    return undefined
  },
} satisfies PluginDefinition

function file(ctx: PluginContext) {
  return join(ctx.dataDir, 'providers.json')
}

function load(ctx: PluginContext): Entry[] {
  try {
    return JSON.parse(readFileSync(file(ctx), 'utf8'))
  } catch {
    return []
  }
}

function save(ctx: PluginContext, entries: Entry[]) {
  const tmp = `${file(ctx)}.tmp`
  writeFileSync(tmp, JSON.stringify(entries, null, 1), { mode: 0o600 })
  renameSync(tmp, file(ctx))
}
