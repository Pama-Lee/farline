// pi (pi.dev) as a second agent runtime, next to Claude Code. A session runs
// `pi --mode rpc` (JSON lines over stdin/stdout) and is stored by pi in
// ~/.pi/agent/sessions/--<cwd>--/<time>_<uuid>.jsonl. Farline names it
// "pi-<uuid>" after that file. pi's messages are translated into the shape
// ItemLog already understands (Claude Code's), so the web app renders both
// the same way.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import type { EffortLevel, Item, ModelOption, Patch, ProviderInfo, SessionSnapshot, SessionState, SessionStatus } from '../../shared/types.ts'
import { config } from './config.ts'
import { t, tx } from './i18n.ts'
import { agentInstructions, agentToolFromCall, allAgentTools, allProviders, emit, secretEnv } from './plugins/registry.ts'
import type { SessionInfo } from './plugins/types.ts'
import { notify } from './push.ts'
import { save, state, type SessionMeta } from './store.ts'
import { ItemLog } from './transcript.ts'
import { loadUpload } from './uploads.ts'
import { applyReaction, lastUserMessageId, restoreReactions } from './reactions.ts'

const SNAPSHOT_ITEMS = 400
const EXTENSION = new URL('../pi/farline-providers.js', import.meta.url).pathname
export const PI_PREFIX = 'pi:'
export const isPiProvider = (p: string | undefined) => !!p && p.startsWith(PI_PREFIX)
export const isPiSession = (id: string) => id.startsWith('pi-')

// ---------- finding pi ----------

export function piPath(): string | undefined {
  if (config.piPath) return existsSync(config.piPath) ? config.piPath : undefined
  const dirs = [join(process.env.HOME ?? '', '.local/bin'), ...(process.env.PATH ?? '').split(delimiter)]
  for (const d of dirs) {
    const p = join(d, 'pi')
    if (d && existsSync(p)) return p
  }
  return undefined
}

let versionCache: { path?: string; version?: string } | null = null
export function piVersion(fresh = false): string | undefined {
  const path = piPath()
  if (!fresh && versionCache && versionCache.path === path) return versionCache.version
  let version: string | undefined
  if (path) {
    const r = spawnSync(path, ['--version'], { encoding: 'utf8', timeout: 15_000 })
    version = r.status === 0 ? `${r.stdout}${r.stderr}`.trim().split('\n').pop() : undefined
  }
  versionCache = { path, version }
  return version
}

// ---------- providers Farline shares with pi ----------

function sharedProviders() {
  const env: Record<string, string> = {}
  const list: unknown[] = []
  allProviders().forEach((p, i) => {
    let ep
    try {
      if (!p.available()) return
      ep = p.pi?.()
    } catch {
      return
    }
    if (!ep?.baseUrl || !ep.apiKey || !ep.models.length) return
    const keyVar = `FARLINE_PI_KEY_${i}`
    env[keyVar] = ep.apiKey
    list.push({ id: `farline-${p.id}`, name: tx(p.label), baseUrl: ep.baseUrl, apiKey: keyVar, models: ep.models })
  })
  env.FARLINE_PI_PROVIDERS = JSON.stringify(list)
  return env
}

function processEnv() {
  const env: Record<string, string | undefined> = { ...process.env }
  for (const k of Object.keys(env)) if (k.startsWith('FARLINE_') || secretEnv.has(k)) delete env[k]
  const tools = allAgentTools().map((d) => ({ name: `farline_${d.name}`, description: d.description, params: d.params }))
  return { ...env, ...sharedProviders(), FARLINE_PI_TOOLS: JSON.stringify(tools) }
}

// ---------- RPC process ----------

class RpcProcess {
  private proc: ChildProcess
  private buf = ''
  private waiting = new Map<string, (r: any) => void>()
  private n = 0
  onEvent: (e: any) => void = () => {}
  onExit: () => void = () => {}

  constructor(args: string[], cwd: string) {
    const bin = piPath()
    if (!bin) throw new Error(t('err.piMissing'))
    this.proc = spawn(bin, ['--mode', 'rpc', '-e', EXTENSION, ...args], { cwd, env: processEnv(), stdio: ['pipe', 'pipe', 'pipe'] })
    this.proc.stdout!.setEncoding('utf8')
    // Split on \n only: JSON strings may hold U+2028, which readline splits on.
    this.proc.stdout!.on('data', (d: string) => {
      this.buf += d
      let i
      while ((i = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, i).replace(/\r$/, '')
        this.buf = this.buf.slice(i + 1)
        if (!line) continue
        let msg: any
        try {
          msg = JSON.parse(line)
        } catch {
          continue
        }
        // A surprise in pi's output must not take Farline down with it.
        try {
          if (msg.type === 'response' && msg.id && this.waiting.has(msg.id)) {
            this.waiting.get(msg.id)!(msg)
            this.waiting.delete(msg.id)
          } else this.onEvent(msg)
        } catch (e: any) {
          console.error('[pi] event failed:', e?.stack ?? e)
        }
      }
    })
    this.proc.stderr!.on('data', (d) => {
      const s = String(d).trim()
      if (/error/i.test(s)) console.error(`[pi] ${s.slice(0, 400)}`)
    })
    this.proc.on('exit', () => {
      for (const fn of this.waiting.values()) fn({ success: false, error: 'pi exited' })
      this.waiting.clear()
      this.onExit()
    })
    this.proc.stdin!.on('error', () => {})
  }

  send(cmd: Record<string, unknown>) {
    this.proc.stdin!.write(JSON.stringify(cmd) + '\n')
  }

  request<T = any>(cmd: Record<string, unknown>, timeoutMs = 30_000): Promise<T> {
    const id = `f${++this.n}`
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiting.delete(id)
        reject(new Error(t('err.timeout')))
      }, timeoutMs)
      this.waiting.set(id, (r) => {
        clearTimeout(timer)
        if (r.success) resolve(r.data as T)
        else reject(new Error(r.error || 'pi error'))
      })
      this.send({ ...cmd, id })
    })
  }

  kill() {
    this.proc.kill()
  }
}

// ---------- models ----------

const EFFORTS: EffortLevel[] = ['low', 'medium', 'high']
let modelCache: { at: number; providers: ProviderInfo[]; models: ModelOption[] } = { at: 0, providers: [], models: [] }
let refreshing: Promise<void> | null = null

function refreshModels(): Promise<void> {
  if (refreshing) return refreshing
  refreshing = (async () => {
    if (!piPath()) {
      modelCache = { at: Date.now(), providers: [], models: [] }
      return
    }
    const p = new RpcProcess(['--no-session'], config.defaultCwd)
    try {
      const data = await p.request<{ models: any[] }>({ type: 'get_available_models' }, 30_000)
      const providers = new Map<string, ProviderInfo>()
      const models: ModelOption[] = []
      for (const m of data.models ?? []) {
        const pid = PI_PREFIX + m.provider
        if (!providers.has(pid)) providers.set(pid, { id: pid, label: `pi · ${m.provider.startsWith('farline-') ? labelOf(m.provider) : m.provider}` })
        models.push({ provider: pid, value: m.id, label: m.name || m.id, ...(m.reasoning ? { efforts: EFFORTS } : {}) })
      }
      modelCache = { at: Date.now(), providers: [...providers.values()], models }
    } catch {
      modelCache = { ...modelCache, at: Date.now() }
    } finally {
      p.kill()
    }
  })().finally(() => {
    refreshing = null
  })
  return refreshing
}

function labelOf(piProvider: string) {
  const id = piProvider.slice('farline-'.length)
  const p = allProviders().find((x) => x.id === id)
  return p ? tx(p.label) : id
}

// Cached; refreshed in the background when older than a minute.
export function piCatalog() {
  if (Date.now() - modelCache.at > 60_000) void refreshModels()
  return modelCache
}

export async function warmPiModels() {
  await refreshModels()
}

export function invalidatePiModels() {
  modelCache = { ...modelCache, at: 0 }
}

// ---------- session files ----------

const SESSIONS = () => join(config.piAgentDir, 'sessions')

function dirFor(cwd: string) {
  return join(SESSIONS(), `--${cwd.replace(/^\//, '').replace(/\//g, '-')}--`)
}

const paths = new Map<string, string>()

function fileOf(id: string): string | undefined {
  const uuid = id.slice(3)
  const hit = paths.get(uuid)
  if (hit && existsSync(hit)) return hit
  let dirs: string[] = []
  try {
    dirs = readdirSync(SESSIONS())
  } catch {
    return undefined
  }
  for (const d of dirs) {
    let files: string[] = []
    try {
      files = readdirSync(join(SESSIONS(), d))
    } catch {
      continue
    }
    const f = files.find((x) => x.endsWith(`_${uuid}.jsonl`))
    if (f) {
      paths.set(uuid, join(SESSIONS(), d, f))
      return paths.get(uuid)
    }
  }
  return undefined
}

function readEntries(file: string): any[] {
  const out: any[] = []
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line) continue
    try {
      out.push(JSON.parse(line))
    } catch {}
  }
  return out
}

// The branch the session is on: from the newest entry back to the root.
function activeBranch(entries: any[]): any[] {
  const byId = new Map(entries.filter((e) => e.id).map((e) => [e.id, e]))
  const last = [...entries].reverse().find((e) => e.id)
  const out: any[] = []
  for (let e = last; e; e = e.parentId ? byId.get(e.parentId) : undefined) out.push(e)
  return out.reverse()
}

const textOf = (content: any) => (typeof content === 'string' ? content : Array.isArray(content) ? content.filter((c) => c.type === 'text').map((c) => c.text).join('\n') : '')

export interface PiSessionInfo {
  id: string
  cwd: string
  createdAt: number
  lastModified: number
  firstPrompt?: string
  provider?: string
}

export function listPiSessions(): PiSessionInfo[] {
  let dirs: string[] = []
  try {
    dirs = readdirSync(SESSIONS())
  } catch {
    return []
  }
  const out: PiSessionInfo[] = []
  for (const d of dirs) {
    let files: string[] = []
    try {
      files = readdirSync(join(SESSIONS(), d)).filter((f) => f.endsWith('.jsonl'))
    } catch {
      continue
    }
    for (const f of files) {
      const m = f.match(/_([0-9a-f-]{36})\.jsonl$/)
      if (!m) continue
      const file = join(SESSIONS(), d, f)
      paths.set(m[1], file)
      try {
        const st = statSync(file)
        const head = readFileSync(file, 'utf8').slice(0, 256 * 1024).split('\n')
        let cwd = ''
        let createdAt = st.mtimeMs
        let firstPrompt: string | undefined
        let provider: string | undefined
        for (const line of head) {
          if (!line) continue
          let e: any
          try {
            e = JSON.parse(line)
          } catch {
            continue
          }
          if (e.type === 'session') {
            cwd = e.cwd ?? ''
            createdAt = Date.parse(e.timestamp) || createdAt
          } else if (e.type === 'model_change' && !provider) provider = e.provider
          else if (e.type === 'message' && e.message?.role === 'user' && !firstPrompt) firstPrompt = textOf(e.message.content).replace(/\s+/g, ' ').slice(0, 200)
          if (cwd && provider && firstPrompt) break
        }
        if (!firstPrompt) continue
        out.push({ id: `pi-${m[1]}`, cwd, createdAt, lastModified: st.mtimeMs, firstPrompt, provider })
      } catch {}
    }
  }
  return out
}

// ---------- translating pi messages ----------

const TOOL_NAMES: Record<string, string> = { bash: 'Bash', read: 'Read', edit: 'Edit', write: 'Write', grep: 'Grep', find: 'Glob', ls: 'LS' }

function toolName(name: string, args: any) {
  if (name === 'edit' && Array.isArray(args?.edits)) return 'MultiEdit'
  return TOOL_NAMES[name] ?? name
}

function toolInput(name: string, a: any = {}) {
  switch (name) {
    case 'read':
      return { file_path: a.path, offset: a.offset, limit: a.limit }
    case 'write':
      return { file_path: a.path, content: a.content }
    case 'edit':
      return Array.isArray(a.edits)
        ? { file_path: a.path, edits: a.edits.map((e: any) => ({ old_string: e.oldText, new_string: e.newText })) }
        : { file_path: a.path, old_string: a.oldText, new_string: a.newText }
    case 'grep':
    case 'find':
      return { pattern: a.pattern, path: a.path }
    default:
      return a
  }
}

function assistantContent(content: any[]) {
  return (content ?? []).map((b) => {
    if (b.type === 'toolCall') return { type: 'tool_use', id: b.id, name: toolName(b.name, b.arguments), input: toolInput(b.name, b.arguments) }
    return b
  })
}

function resultContent(content: any[]) {
  return (content ?? []).map((c) => (c.type === 'image' ? { type: 'image', source: { type: 'base64', media_type: c.mimeType, data: c.data } } : c))
}

// One pi message as the message shape ItemLog.apply takes.
function toLogMessage(uuid: string, m: any) {
  const timestamp = m.timestamp ? new Date(m.timestamp).toISOString() : undefined
  if (m.role === 'user') {
    const content = typeof m.content === 'string' ? m.content : resultContent(m.content)
    return { type: 'user', uuid, message: { role: 'user', content }, timestamp }
  }
  if (m.role === 'assistant') return { type: 'assistant', uuid, message: { id: uuid, role: 'assistant', content: assistantContent(m.content) }, timestamp }
  if (m.role === 'toolResult') {
    return { type: 'user', uuid, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: m.toolCallId, content: resultContent(m.content), is_error: !!m.isError }] }, timestamp }
  }
  return undefined
}

// ---------- the session ----------

type Subscriber = (patch: Patch) => void

export class PiView {
  readonly id: string
  log: ItemLog
  title: string
  cwd: string
  meta: SessionMeta
  persisted: boolean
  lastModified: number
  status: SessionStatus = 'idle'
  model = ''
  subscribers = new Set<Subscriber>()
  lastActive = Date.now()
  readonly runningTasks = 0
  file: string
  private proc?: RpcProcess
  private streaming = false
  private msgId: string | null = null
  private turns = 0

  constructor(id: string, file: string, cwd: string, meta: SessionMeta, persisted: boolean) {
    this.id = id
    this.file = file
    this.cwd = cwd
    this.meta = meta
    this.persisted = persisted
    this.log = new ItemLog(id)
    this.title = meta.title ?? ''
    this.lastModified = Date.now()
  }

  get live() {
    return !!this.proc
  }

  sessionState(): SessionState {
    return {
      id: this.id,
      title: this.title,
      cwd: this.cwd,
      status: this.status,
      provider: this.meta.provider,
      model: this.model || this.meta.model,
      permissionMode: this.meta.permissionMode,
      effort: this.meta.effort ?? 'high',
      classifierModel: null,
      live: this.live,
      tasks: [],
    }
  }

  info(): SessionInfo {
    return { id: this.id, title: this.title, cwd: this.cwd, provider: this.meta.provider, model: this.model || this.meta.model }
  }

  snapshot(all = false): SessionSnapshot {
    this.flush()
    const items = all ? this.log.items : this.log.items.slice(-SNAPSHOT_ITEMS)
    return { state: this.sessionState(), items, seq: this.log.seq, hasEarlier: items.length < this.log.items.length }
  }

  private flushTimer?: NodeJS.Timeout
  private flush(withState = false) {
    clearTimeout(this.flushTimer)
    this.flushTimer = undefined
    if (!this.log.hasChanges() && !withState) return
    const patch = this.log.takePatch()
    if (withState) patch.state = this.sessionState()
    for (const s of this.subscribers) s(patch)
  }
  private soon() {
    if (!this.flushTimer) this.flushTimer = setTimeout(() => this.flush(), 80)
  }
  private setStatus(s: SessionStatus) {
    if (this.status === s) return
    this.status = s
    this.flush(true)
  }

  // Past messages, from the file.
  load() {
    if (!existsSync(this.file)) return
    const entries = readEntries(this.file)
    for (const e of activeBranch(entries)) {
      if (e.type === 'model_change') this.model = e.modelId
      if (e.type !== 'message') continue
      const m = toLogMessage(e.id, e.message)
      if (m) this.log.apply(m)
      if (e.message.role === 'assistant' && e.message.stopReason === 'error' && e.message.errorMessage) {
        this.log.upsert({ kind: 'notice', id: `${e.id}:err`, level: 'error', text: String(e.message.errorMessage).slice(0, 2000) })
      }
    }
    this.log.settleRunning()
    restoreReactions(this)
    this.log.discardChanges()
  }

  react(itemId: string, emoji: string, by: 'agent' | 'user') {
    if (!applyReaction(this, itemId, emoji, by)) return false
    this.flush()
    return true
  }

  private start() {
    const [, provider] = this.meta.provider.split(':')
    const args = ['--session', this.file]
    if (provider && this.meta.model) args.push('--provider', provider, '--model', this.meta.model)
    args.push('--thinking', thinking(this.meta.effort))
    if (agentInstructions()) args.push('--append-system-prompt', agentInstructions())
    const p = new RpcProcess(args, this.cwd)
    p.onEvent = (e) => this.onEvent(e)
    p.onExit = () => {
      if (this.proc !== p) return
      this.proc = undefined
      this.streaming = false
      this.log.dropDrafts()
      this.log.settleRunning()
      this.status = 'idle'
      this.flush(true)
    }
    this.proc = p
  }

  private onEvent(e: any) {
    this.lastActive = Date.now()
    switch (e.type) {
      case 'agent_start':
        this.streaming = true
        this.setStatus('running')
        break
      case 'message_start':
        if (e.message?.role === 'assistant') {
          this.msgId = randomUUID()
          this.log.applyStreamEvent({ type: 'message_start', message: { id: this.msgId } })
        }
        break
      case 'message_update': {
        const a = e.assistantMessageEvent ?? {}
        const index = a.contentIndex
        if (a.type === 'text_start') this.log.applyStreamEvent({ type: 'content_block_start', index, content_block: { type: 'text' } })
        else if (a.type === 'thinking_start') this.log.applyStreamEvent({ type: 'content_block_start', index, content_block: { type: 'thinking' } })
        else if (a.type === 'toolcall_start') {
          const call = a.partial?.content?.[index] ?? {}
          this.log.applyStreamEvent({ type: 'content_block_start', index, content_block: { type: 'tool_use', id: call.id, name: call.name ? toolName(call.name, call.arguments) : '' } })
        } else if (a.type === 'text_delta') this.log.applyStreamEvent({ type: 'content_block_delta', index, delta: { type: 'text_delta', text: a.delta } })
        else if (a.type === 'thinking_delta') this.log.applyStreamEvent({ type: 'content_block_delta', index, delta: { type: 'thinking_delta', thinking: a.delta } })
        this.soon()
        break
      }
      case 'message_end': {
        const m = e.message
        if (m?.role === 'assistant' && this.msgId) {
          this.log.apply({ type: 'assistant', uuid: this.msgId, message: { id: this.msgId, role: 'assistant', content: assistantContent(m.content) } } as any)
          if ((m.stopReason === 'error' || m.stopReason === 'aborted') && m.errorMessage) {
            this.log.upsert({ kind: 'notice', id: `${this.msgId}:err`, level: m.stopReason === 'aborted' ? 'info' : 'error', text: String(m.errorMessage).slice(0, 2000) })
          }
          if (m.model) this.model = m.model
          this.msgId = null
          this.soon()
        }
        break
      }
      case 'tool_execution_start': {
        // A plugin tool: do its work here (pi's side only says ok).
        const def = agentToolFromCall(e.toolName)
        if (def) {
          Promise.resolve(def.run(e.args ?? {}, { session: this.info(), lastUserMessageId: lastUserMessageId(this.log) })).catch((err) =>
            console.error(`[pi] tool ${e.toolName} failed:`, err?.message ?? err),
          )
        }
        break
      }
      case 'tool_execution_update': {
        const item = this.log.get(e.toolCallId)
        const text = textOf(e.partialResult?.content)
        if (item?.kind === 'tool' && text) {
          this.log.upsert({ ...item, result: text.slice(-16_000) })
          this.soon()
        }
        break
      }
      case 'tool_execution_end':
        this.log.apply({ type: 'user', uuid: randomUUID(), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: e.toolCallId, content: resultContent(e.result?.content), is_error: !!e.isError }] } } as any)
        this.soon()
        break
      case 'agent_end':
        this.onTurnEnd()
        break
      case 'extension_ui_request':
        // Dialogs from pi extensions are not shown here yet; answer so pi goes on.
        if (['select', 'confirm', 'input', 'editor'].includes(e.method)) this.proc?.send({ type: 'extension_ui_response', id: e.id, cancelled: true })
        break
    }
  }

  private onTurnEnd() {
    this.streaming = false
    this.turns++
    this.persisted = true
    this.lastModified = Date.now()
    this.log.dropDrafts()
    this.log.settleRunning()
    this.status = 'idle'
    this.flush(true)
    const last = [...this.log.items].reverse().find((it) => it.kind === 'text')
    const text = last?.kind === 'text' ? last.text : ''
    const failed = this.log.items.at(-1)?.kind === 'notice'
    emit('turn.completed', { session: this.info(), text, error: failed })
    if (this.subscribers.size === 0) {
      void notify({ kind: 'done', title: this.title || t('notify.session'), body: text.slice(0, 120) || t('notify.done'), url: `/s/${this.id}`, sessionId: this.id })
    }
  }

  send(text: string, uploadIds: string[] = []) {
    const uploads = uploadIds.map(loadUpload).filter((u) => !!u)
    const lines = [text.trim(), ...uploads.map((u) => `[Attachment] ${u.path}`)].filter(Boolean)
    const images = uploads
      .filter((u) => u.isImage && u.size < 5 * 1024 * 1024)
      .map((u) => ({ type: 'image', data: readFileSync(u.path).toString('base64'), mimeType: u.mime }))
    const uuid = randomUUID()
    const shown = uploads.filter((u) => u.isImage).map((u) => ({ url: `/api/uploads/${u.id}` }))
    const files = uploads.filter((u) => !u.isImage).map((u) => u.path)
    this.log.upsert({ kind: 'user', id: uuid, text: text.trim(), images: shown.length ? shown : undefined, files: files.length ? files : undefined, ts: Date.now() })
    if (!this.proc) this.start()
    this.proc!.send({ type: 'prompt', message: lines.join('\n\n'), ...(images.length ? { images } : {}), ...(this.streaming ? { streamingBehavior: 'steer' } : {}) })
    this.lastActive = Date.now()
    this.status = 'running'
    this.flush(true)
    emit('message.sent', { session: this.info(), text: text.trim() })
  }

  async interrupt() {
    this.proc?.send({ type: 'abort' })
  }

  async update(patch: { model?: string; effort?: EffortLevel; provider?: string; permissionMode?: any; classifierModel?: string }) {
    if (patch.provider && !isPiProvider(patch.provider)) throw new Error(t('err.piSwitchAgent'))
    if (patch.provider) this.meta.provider = patch.provider
    if (patch.model) this.meta.model = patch.model
    if ((patch.provider || patch.model) && this.proc) {
      await this.proc.request({ type: 'set_model', provider: this.meta.provider.slice(PI_PREFIX.length), modelId: this.meta.model }).catch(() => undefined)
      this.model = this.meta.model
    }
    if (patch.effort) {
      this.meta.effort = patch.effort
      await this.proc?.request({ type: 'set_thinking_level', level: thinking(patch.effort) }).catch(() => undefined)
    }
    if (patch.permissionMode) this.meta.permissionMode = patch.permissionMode
    state.sessions[this.id] = { ...this.meta }
    save()
    this.flush(true)
  }

  // pi forks into a new session file: the rewound conversation is a new session.
  async rewind(messageId: string, opts: { files: boolean; conversation: boolean }): Promise<{ sessionId?: string; restart?: boolean }> {
    if (opts.files || !opts.conversation) throw new Error(t('err.piNoFileRewind'))
    if (this.status !== 'idle') throw new Error(t('err.waitToRewind'))
    const users = this.log.items.filter((it) => it.kind === 'user')
    const k = users.findIndex((it) => it.id === messageId)
    if (k < 0) throw new Error(t('err.messageNotFound'))
    if (k === 0) return { restart: true }
    if (!this.proc) this.start()
    const list = await this.proc!.request<{ messages: { entryId: string; text: string }[] }>({ type: 'get_fork_messages' })
    const entry = list.messages?.[k]
    if (!entry) throw new Error(t('err.messageNotFound'))
    const r = await this.proc!.request<{ cancelled: boolean }>({ type: 'fork', entryId: entry.entryId })
    if (r.cancelled) throw new Error(t('rewind.failed'))
    const st = await this.proc!.request<{ sessionFile: string }>({ type: 'get_state' })
    this.close()
    const uuid = st.sessionFile?.match(/_([0-9a-f-]{36})\.jsonl$/)?.[1]
    if (!uuid) throw new Error(t('rewind.failed'))
    const id = `pi-${uuid}`
    state.sessions[id] = { ...this.meta, title: undefined }
    save()
    return { sessionId: id }
  }

  rewindPreview() {
    return Promise.resolve({ canRewind: false })
  }

  async editText(): Promise<void> {
    throw new Error(t('err.piNoEdit'))
  }

  async mcpStatus() {
    return []
  }
  decide() {
    return false
  }
  answer() {
    return false
  }
  async stopTask() {
    throw new Error(t('err.processEnded'))
  }
  async taskOutput() {
    return { text: '', total: 0 }
  }
  async backgroundTool() {
    return false
  }
  respawnWhenIdle() {
    if (this.proc && this.status === 'idle') this.close()
  }
  async refreshTitle() {}
  truncateAt() {}

  close() {
    const p = this.proc
    this.proc = undefined
    this.streaming = false
    p?.kill()
  }
}

function thinking(e: EffortLevel | undefined) {
  return e === 'low' ? 'low' : e === 'medium' ? 'medium' : 'high'
}

export function openPiView(id: string, meta: SessionMeta): PiView | undefined {
  const file = fileOf(id)
  if (!file) return undefined
  let cwd = config.defaultCwd
  try {
    const head = JSON.parse(readFileSync(file, 'utf8').split('\n')[0])
    if (head.type === 'session' && head.cwd) cwd = head.cwd
  } catch {}
  const view = new PiView(id, file, cwd, meta, true)
  view.title = meta.title ?? state.titles[id] ?? ''
  view.load()
  view.lastModified = statSync(file).mtimeMs
  if (!meta.model && view.model) meta.model = view.model
  return view
}

export function createPiView(cwd: string, meta: SessionMeta, title: string): PiView {
  const uuid = randomUUID()
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const file = join(dirFor(cwd), `${stamp}_${uuid}.jsonl`)
  paths.set(uuid, file)
  const id = `pi-${uuid}`
  const view = new PiView(id, file, cwd, meta, false)
  view.title = title
  return view
}

export type { Item }
