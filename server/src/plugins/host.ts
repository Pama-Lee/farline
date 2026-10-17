// Finds, loads and runs plugins, and keeps their enabled state and settings.
//
// A plugin is a directory whose package.json has a "farline" field:
//   { "id": "wecom", "name": { "en": "WeCom", "zh-CN": "企业微信" }, "apiVersion": 1,
//     "server": "./server.js", "web": "./web.js", "styles": "./style.css",
//     "skin": false, "enabledByDefault": false }
// Looked up in the built-in plugins directory, <dataDir>/plugins/*, and npm
// packages installed under <dataDir>/plugins/node_modules. A user plugin with
// the same id as a built-in one replaces it.
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Hono } from 'hono'
import type { PluginInfo, PluginStatus, RemoteSource, SettingFieldView } from '../../../shared/types.ts'
import { config } from '../config.ts'
import { allViews, cachedView, openView } from '../live.ts'
import { sendTo } from '../push.ts'
import { anthropicCompatible } from './helpers.ts'
import { FARLINE_VERSION, satisfies } from './semver.ts'
import { addChannel, addHook, addProvider, allChannels, secretEnv } from './registry.ts'
import type { Disposable, PluginContext, PluginDefinition, SettingField, SettingValues, StatusReport, Text } from './types.ts'
import { currentLocale, t, tx } from '../i18n.ts'

export const API_VERSION = 1
const ID_RE = /^[a-z0-9][a-z0-9-]{0,40}$/

interface Manifest {
  id: string
  name: Text
  version: string
  apiVersion: number
  server?: string
  web?: string
  styles?: string
  skin?: boolean
  enabledByDefault?: boolean
  // Farline versions it runs on, from "engines.farline".
  engines?: string
}

interface Plugin {
  manifest: Manifest
  root: string
  source: PluginInfo['source']
  def?: PluginDefinition
  ctx?: PluginContext
  http?: Hono
  disposables: Disposable[]
  listeners: Set<(v: SettingValues) => void>
  // Provider ids it has registered, kept after disabling.
  providerIds: Set<string>
  state: PluginInfo['state']
  error?: string
}

interface Saved {
  enabled?: boolean
  settings?: Record<string, string | number | boolean>
}

const stateFile = join(config.dataDir, 'plugins.json')
let saved: Record<string, Saved> = load()
export const userPluginsDir = join(config.dataDir, 'plugins')
// Plugins installed from GitHub, by id. They live in <dataDir>/plugins/<id>.
const remoteFile = join(userPluginsDir, '.remote.json')
const remotes: Record<string, RemoteSource> = (() => {
  try {
    return JSON.parse(readFileSync(remoteFile, 'utf8'))
  } catch {
    return {}
  }
})()

function writeRemotes() {
  mkdirSync(userPluginsDir, { recursive: true })
  const tmp = `${remoteFile}.tmp`
  writeFileSync(tmp, JSON.stringify(remotes, null, 1))
  renameSync(tmp, remoteFile)
}
const plugins = new Map<string, Plugin>()

function load(): Record<string, Saved> {
  let s: Record<string, Saved> = {}
  try {
    s = JSON.parse(readFileSync(stateFile, 'utf8'))
  } catch {}
  // Before plugins, the DeepSeek key had its own file.
  const old = join(config.dataDir, 'deepseek.json')
  if (existsSync(old)) {
    try {
      const key = JSON.parse(readFileSync(old, 'utf8')).key
      if (key && !s.deepseek?.settings?.apiKey) s.deepseek = { ...s.deepseek, settings: { ...s.deepseek?.settings, apiKey: key } }
      writeState(s)
      rmSync(old)
    } catch {}
  }
  return s
}

function writeState(s = saved) {
  const tmp = `${stateFile}.tmp`
  writeFileSync(tmp, JSON.stringify(s, null, 1), { mode: 0o600 })
  renameSync(tmp, stateFile)
}

// ---- discovery ----

export function readManifest(dir: string): Manifest | undefined {
  try {
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
    const f = pkg.farline
    if (!f || typeof f !== 'object') return undefined
    if (!ID_RE.test(f.id ?? '')) throw new Error(`invalid plugin id "${f.id}"`)
    return {
      id: f.id,
      name: f.name || f.id,
      version: pkg.version ?? '0.0.0',
      apiVersion: f.apiVersion ?? 1,
      server: f.server,
      web: f.web,
      styles: f.styles,
      skin: f.skin === true,
      engines: typeof pkg.engines?.farline === 'string' ? pkg.engines.farline : undefined,
      // A newly installed skin should not take over the look by itself.
      enabledByDefault: f.enabledByDefault ?? (f.skin === true ? false : undefined),
    }
  } catch (e: any) {
    console.error(`[plugins] skipping ${dir}: ${e?.message ?? e}`)
    return undefined
  }
}

function subdirs(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((d) => (d.isDirectory() || d.isSymbolicLink()) && !d.name.startsWith('.'))
      .map((d) => join(dir, d.name))
  } catch {
    return []
  }
}

function discover(): { dir: string; source: PluginInfo['source'] }[] {
  const userDir = join(config.dataDir, 'plugins')
  const modules = join(userDir, 'node_modules')
  const npm = subdirs(modules).flatMap((d) => (d.split(sep).pop()!.startsWith('@') ? subdirs(d) : [d]))
  return [
    ...subdirs(config.builtinPluginsDir).map((dir) => ({ dir, source: 'builtin' as const })),
    ...subdirs(userDir)
      .filter((d) => d !== modules)
      .map((dir) => ({ dir, source: 'local' as const })),
    ...npm.map((dir) => ({ dir, source: 'npm' as const })),
  ]
}

// ---- settings ----

function fields(p: Plugin): SettingField[] {
  return p.def?.settings ?? []
}

function effective(p: Plugin, overrides?: Record<string, string | number | boolean | null>): SettingValues {
  const stored = { ...saved[p.manifest.id]?.settings }
  if (overrides) for (const [k, v] of Object.entries(overrides)) v === null ? delete stored[k] : (stored[k] = v)
  const out: SettingValues = {}
  for (const f of fields(p)) out[f.key] = stored[f.key] ?? (f.env ? process.env[f.env] || undefined : undefined) ?? f.default
  return out
}

function hint(v: string) {
  return v.length >= 10 ? `${v.slice(0, 3)}…${v.slice(-4)}` : '••••'
}

function fieldViews(p: Plugin): SettingFieldView[] {
  const stored = saved[p.manifest.id]?.settings ?? {}
  return fields(p).map((f) => {
    const own = stored[f.key]
    const env = f.env ? process.env[f.env] : undefined
    const v = own ?? (env || undefined) ?? f.default
    const view: SettingFieldView = { key: f.key, label: tx(f.label), type: f.type, placeholder: f.placeholder === undefined ? undefined : tx(f.placeholder), options: f.options?.map((o) => ({ value: o.value, label: tx(o.label) })) }
    if (own !== undefined) view.source = 'saved'
    else if (env) view.source = 'env'
    if (v === undefined || v === '') return view
    if (f.type === 'secret') view.hint = hint(String(v))
    else view.value = v
    return view
  })
}

function coerce(f: SettingField, v: unknown): string | number | boolean {
  if (f.type === 'number') {
    const n = Number(v)
    if (!Number.isFinite(n)) throw new Error(t('err.mustBeNumber', { label: tx(f.label) }))
    return n
  }
  if (f.type === 'boolean') return v === true || v === 'true'
  const s = String(v).trim()
  if (f.type === 'select' && f.options && !f.options.some((o) => o.value === s)) throw new Error(t('err.badOption', { label: tx(f.label) }))
  return s
}

// ---- lifecycle ----

function context(p: Plugin): PluginContext {
  const id = p.manifest.id
  const own = (d: Disposable) => (p.disposables.push(d), d)
  const http = new Hono()
  p.http = http
  return {
    id,
    locale: () => currentLocale(),
    t: (text) => tx(text),
    get dataDir() {
      const dir = join(config.dataDir, 'plugin-data', id)
      mkdirSync(dir, { recursive: true, mode: 0o700 })
      return dir
    },
    log: (...args) => console.log(`[plugin ${id}]`, ...args),
    settings: {
      get: () => effective(p),
      onChange: (fn) => {
        p.listeners.add(fn)
        return own({ dispose: () => void p.listeners.delete(fn) })
      },
    },
    providers: {
      register: (def) => {
        const d = own(addProvider(id, def))
        p.providerIds.add(def.id)
        return d
      },
    },
    notifications: { register: (def) => own(addChannel(id, def)) },
    hooks: { on: (event, fn) => own(addHook(id, event, fn)) },
    http,
    sessions: {
      get: (sid) => cachedView(sid)?.sessionState(),
      send: async (sid, text) => {
        const view = await openView(sid)
        if (!view) throw new Error(`no session ${sid}`)
        view.send(text)
      },
    },
    helpers: { anthropicCompatible },
  }
}

async function importDefinition(p: Plugin): Promise<PluginDefinition | undefined> {
  if (!p.manifest.server) return undefined
  const file = resolve(p.root, p.manifest.server)
  if (!file.startsWith(p.root + sep)) throw new Error('server entry outside the plugin')
  // Versioned URL: turning a plugin off and on picks up edited code.
  const url = `${pathToFileURL(file).href}?v=${statSync(file).mtimeMs}`
  const mod = await import(url)
  const def: PluginDefinition = mod.default ?? mod
  if (typeof def.activate !== 'function') throw new Error('server entry has no activate()')
  return def
}

async function activate(p: Plugin) {
  try {
    if (p.manifest.apiVersion !== API_VERSION) throw new Error(`needs plugin API v${p.manifest.apiVersion}, this Farline has v${API_VERSION}`)
    if (p.manifest.engines && !satisfies(FARLINE_VERSION, p.manifest.engines)) throw new Error(`needs Farline ${p.manifest.engines}, this is ${FARLINE_VERSION}`)
    p.def = await importDefinition(p)
    for (const f of fields(p)) if (f.env) secretEnv.add(f.env)
    if (p.def) {
      p.ctx = context(p)
      await p.def.activate(p.ctx)
    }
    p.state = 'active'
    p.error = undefined
  } catch (e: any) {
    console.error(`[plugin ${p.manifest.id}] failed to start:`, e?.stack ?? e)
    disposeAll(p)
    p.state = 'error'
    p.error = String(e?.message ?? e).slice(0, 300)
  }
}

function disposeAll(p: Plugin) {
  for (const d of p.disposables.splice(0).reverse()) {
    try {
      d.dispose()
    } catch {}
  }
  p.listeners.clear()
  p.ctx = undefined
  p.http = undefined
}

async function deactivate(p: Plugin) {
  try {
    await p.def?.deactivate?.()
  } catch (e: any) {
    console.error(`[plugin ${p.manifest.id}] deactivate failed:`, e?.message ?? e)
  }
  disposeAll(p)
  p.state = 'disabled'
  p.error = undefined
}

function isEnabled(p: Plugin) {
  return saved[p.manifest.id]?.enabled ?? p.manifest.enabledByDefault ?? true
}

// Sessions keep their provider's environment until the process restarts.
function restartSessionsOf(p: Plugin) {
  for (const v of allViews()) if (p.providerIds.has(v.meta.provider)) v.respawnWhenIdle()
}

export async function loadPlugins() {
  for (const { dir, source } of discover()) {
    const manifest = readManifest(dir)
    if (!manifest) continue
    const existing = plugins.get(manifest.id)
    if (existing && !(existing.source === 'builtin' && source !== 'builtin')) {
      console.error(`[plugins] duplicate id "${manifest.id}" in ${dir}, keeping ${existing.root}`)
      continue
    }
    plugins.set(manifest.id, { manifest, root: resolve(dir), source, disposables: [], listeners: new Set(), providerIds: new Set(), state: 'disabled' })
  }
  // Disabled ones are read for their settings and env names, not run.
  for (const p of plugins.values()) await start(p)
  const active = [...plugins.values()].filter((p) => p.state === 'active').map((p) => p.manifest.id)
  if (plugins.size) console.log(`[plugins] ${active.length}/${plugins.size} active: ${active.join(', ')}`)
}

// ---- installing from GitHub ----

function isRemote(p: Plugin) {
  return p.source === 'local' && !!remotes[p.manifest.id] && p.root === resolve(userPluginsDir, p.manifest.id)
}

export function remoteOf(p: Plugin): RemoteSource | undefined {
  return isRemote(p) ? remotes[p.manifest.id] : undefined
}

async function start(p: Plugin) {
  if (isEnabled(p)) await activate(p)
  else {
    try {
      p.def = await importDefinition(p)
      for (const f of fields(p)) if (f.env) secretEnv.add(f.env)
    } catch (e: any) {
      p.state = 'error'
      p.error = String(e?.message ?? e).slice(0, 300)
    }
  }
}

// Move an unpacked plugin into place, replacing an earlier install of it.
// A plugin from GitHub may override a built-in one, never a local or npm one.
export async function installDir(dir: string, remote: RemoteSource): Promise<Plugin> {
  const manifest = readManifest(dir)
  if (!manifest) throw new Error(t('err.noManifest'))
  const id = manifest.id
  const existing = plugins.get(id)
  if (existing && existing.source !== 'builtin' && !isRemote(existing)) throw new Error(t(existing.source === 'npm' ? 'err.idTakenNpm' : 'err.idTakenLocal', { id }))
  const target = join(userPluginsDir, id)
  if (existing && existing.state !== 'disabled') await deactivate(existing)
  const old = existsSync(target) ? `${target}.old-${Date.now()}` : null
  if (old) renameSync(target, old)
  renameSync(dir, target)
  if (old) rmSync(old, { recursive: true, force: true })
  remotes[id] = remote
  writeRemotes()
  const p: Plugin = { manifest: readManifest(target)!, root: resolve(target), source: 'local', disposables: [], listeners: new Set(), providerIds: existing?.providerIds ?? new Set(), state: 'disabled' }
  plugins.set(id, p)
  await start(p)
  restartSessionsOf(p)
  return p
}

export async function uninstall(p: Plugin) {
  if (!isRemote(p)) throw new Error(t('err.onlyGitHub'))
  const id = p.manifest.id
  if (p.state !== 'disabled') await deactivate(p)
  restartSessionsOf(p)
  rmSync(p.root, { recursive: true, force: true })
  delete remotes[id]
  writeRemotes()
  delete saved[id]
  writeState()
  plugins.delete(id)
  // A built-in plugin it stood in for comes back.
  for (const { dir, source } of discover()) {
    if (source !== 'builtin') continue
    const m = readManifest(dir)
    if (m?.id !== id) continue
    const b: Plugin = { manifest: m, root: resolve(dir), source, disposables: [], listeners: new Set(), providerIds: new Set(), state: 'disabled' }
    plugins.set(id, b)
    await start(b)
  }
}

// ---- management API ----

function assetUrl(p: Plugin, entry: string | undefined): string | undefined {
  if (!entry) return undefined
  const file = resolve(p.root, entry)
  if (!file.startsWith(p.root + sep) || !existsSync(file)) return undefined
  const v = `${p.manifest.version}-${Math.round(statSync(file).mtimeMs)}`
  return `/api/plugin-assets/${p.manifest.id}/${file.slice(p.root.length + 1).split(sep).map(encodeURIComponent).join('/')}?v=${v}`
}

export function pluginInfo(p: Plugin): PluginInfo {
  return {
    id: p.manifest.id,
    name: tx(p.manifest.name),
    version: p.manifest.version,
    source: isRemote(p) ? 'github' : p.source,
    ...(isRemote(p) ? { remote: remotes[p.manifest.id] } : {}),
    enabled: isEnabled(p),
    state: p.state,
    error: p.error,
    web: p.state === 'active' ? assetUrl(p, p.manifest.web) : undefined,
    styles: p.state === 'active' ? assetUrl(p, p.manifest.styles) : undefined,
    ...(p.manifest.skin ? { skin: true } : {}),
    settings: fieldViews(p),
    links: (p.def?.links ?? []).map((l) => ({ label: tx(l.label), url: l.url })),
    hasStatus: !!p.def?.status,
    notifies: allChannels(p.manifest.id).length > 0,
  }
}

export function listPlugins(): PluginInfo[] {
  const order = { builtin: 0, local: 1, github: 1, npm: 2 }
  return [...plugins.values()].sort((a, b) => order[a.source] - order[b.source] || tx(a.manifest.name).localeCompare(tx(b.manifest.name))).map(pluginInfo)
}

export function getPlugin(id: string): Plugin | undefined {
  return plugins.get(id)
}

export async function setEnabled(p: Plugin, enabled: boolean) {
  // One skin at a time.
  if (enabled && p.manifest.skin) {
    for (const other of plugins.values()) {
      if (other === p || !other.manifest.skin || !isEnabled(other)) continue
      saved[other.manifest.id] = { ...saved[other.manifest.id], enabled: false }
      if (other.state !== 'disabled') await deactivate(other)
    }
  }
  saved[p.manifest.id] = { ...saved[p.manifest.id], enabled }
  writeState()
  if (enabled && p.state !== 'active') await activate(p)
  if (!enabled && p.state !== 'disabled') await deactivate(p)
  restartSessionsOf(p)
}

// Secrets: a string replaces, null removes, '' or absent keeps.
export async function saveSettings(p: Plugin, input: Record<string, unknown>) {
  const changes: Record<string, string | number | boolean | null> = {}
  for (const f of fields(p)) {
    if (!(f.key in input)) continue
    const v = input[f.key]
    if (v === null) changes[f.key] = null
    else if (f.type === 'secret' && v === '') continue
    else changes[f.key] = coerce(f, v)
  }
  const next = effective(p, changes)
  await p.def?.validateSettings?.(next, { locale: () => currentLocale(), t: (text) => tx(text) })
  const stored = { ...saved[p.manifest.id]?.settings }
  for (const [k, v] of Object.entries(changes)) v === null || v === '' ? delete stored[k] : (stored[k] = v)
  saved[p.manifest.id] = { ...saved[p.manifest.id], settings: stored }
  writeState()
  for (const fn of p.listeners) {
    try {
      fn(next)
    } catch (e: any) {
      console.error(`[plugin ${p.manifest.id}] settings listener failed:`, e?.message ?? e)
    }
  }
  restartSessionsOf(p)
}

export async function pluginStatus(p: Plugin): Promise<PluginStatus> {
  if (p.state !== 'active' || !p.def?.status || !p.ctx) return {}
  const r: StatusReport = await Promise.race([Promise.resolve(p.def.status(p.ctx)), new Promise<StatusReport>((res) => setTimeout(() => res({}), 10_000))])
  return {
    summary: r.summary === undefined ? undefined : tx(r.summary),
    tone: r.tone,
    rows: r.rows?.map((row) => ({ label: tx(row.label), value: tx(row.value), tone: row.tone })),
  }
}

export async function testNotification(p: Plugin) {
  const channels = allChannels(p.manifest.id)
  if (!channels.length) throw new Error(t('err.noChannel'))
  for (const ch of channels) await sendTo(ch, { kind: 'test', title: t('notify.testTitle'), body: t('notify.testBody'), url: '/' })
}

export function pluginFetch(p: Plugin, req: Request, path: string): Response | Promise<Response> {
  if (p.state !== 'active' || !p.http) return Response.json({ error: 'plugin not active' }, { status: 404 })
  const url = new URL(req.url)
  url.pathname = path
  return p.http.fetch(new Request(url, req))
}

export function pluginAsset(p: Plugin, rel: string): string | undefined {
  const file = resolve(p.root, rel)
  if (!file.startsWith(p.root + sep) || rel.split('/').some((s) => s.startsWith('.'))) return undefined
  return existsSync(file) && statSync(file).isFile() ? file : undefined
}
