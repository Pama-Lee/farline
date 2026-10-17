// One SessionView per opened session. A view becomes "live" when it owns a
// running Claude Code process (streaming-input query); otherwise it is a
// read-only projection of the persisted transcript.
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import {
  getSessionInfo,
  getSessionMessages,
  query,
  type CanUseTool,
  type ModelInfo,
  type PermissionResult,
  type PermissionUpdate,
  type Query,
  type SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk'
import { runningElsewhere } from './activity.ts'
import { config } from './config.ts'
import { deepseekKey } from './deepseek.ts'
import { notify } from './push.ts'
import { save, state, type SessionMeta } from './store.ts'
import { ItemLog } from './transcript.ts'
import { loadUpload } from './uploads.ts'
import type { EffortLevel, Item, McpServer, ModelOption, Patch, PermissionMode, Provider, SessionSnapshot, SessionState, SessionStatus } from '../../shared/types.ts'

const SNAPSHOT_ITEMS = 400

export const DEEPSEEK_MODELS: ModelOption[] = [
  { provider: 'deepseek', value: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro', desc: '推理和编码更强' },
  { provider: 'deepseek', value: 'deepseek-flash', label: 'DeepSeek V4.1 Flash', desc: '响应更快，更省' },
]

const EFFORTS: EffortLevel[] = ['low', 'medium', 'high', 'xhigh', 'max']

// Same wording as the Claude app's model picker.
const MAIN: Record<string, { label: string; desc: string; resolved: string }> = {
  opus: { label: 'Opus 5.5', desc: '适用于复杂工作与日常任务', resolved: 'claude-opus-5-5' },
  fable: { label: 'Fable 5.1', desc: '应对您最艰巨的挑战', resolved: 'claude-fable-5-1' },
  sonnet: { label: 'Sonnet 5.5', desc: '处理简单任务效率最高', resolved: 'claude-sonnet-5-5' },
  haiku: { label: 'Haiku 5.5', desc: '快速解答的最佳选择', resolved: 'claude-haiku-5-5' },
}

let claudeModels: ModelOption[] = Object.entries(MAIN).map(([value, m]) => ({ provider: 'claude', value, ...m, efforts: EFFORTS }))

export function models(): ModelOption[] {
  return [...claudeModels, ...(deepseekKey() ? DEEPSEEK_MODELS : [])]
}

class Channel<T> implements AsyncIterable<T> {
  private buf: T[] = []
  private waiter: ((r: IteratorResult<T>) => void) | null = null
  private closed = false
  push(v: T) {
    if (this.waiter) {
      const w = this.waiter
      this.waiter = null
      w({ value: v, done: false })
    } else this.buf.push(v)
  }
  close() {
    this.closed = true
    this.waiter?.({ value: undefined as never, done: true })
    this.waiter = null
  }
  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        if (this.buf.length) return Promise.resolve({ value: this.buf.shift()!, done: false })
        if (this.closed) return Promise.resolve({ value: undefined as never, done: true })
        return new Promise((r) => (this.waiter = r))
      },
    }
  }
}

type Subscriber = (patch: Patch) => void

interface Pending {
  kind: 'tool' | 'ask'
  itemId: string
  input: Record<string, unknown>
  suggestions?: PermissionUpdate[]
  resolve: (r: PermissionResult) => void
}

export class SessionView {
  readonly id: string
  log: ItemLog
  title: string
  cwd: string
  meta: SessionMeta
  persisted: boolean
  lastModified: number
  status: SessionStatus = 'idle'
  model = ''
  mcp: McpServer[] = []
  subscribers = new Set<Subscriber>()
  lastActive = Date.now()
  private q?: Query
  private input?: Channel<SDKUserMessage>
  private pending = new Map<string, Pending>()
  private flushTimer?: NodeJS.Timeout
  private turns = 0

  constructor(id: string, cwd: string, meta: SessionMeta, persisted: boolean) {
    this.id = id
    this.log = new ItemLog(id)
    this.cwd = cwd
    this.meta = meta
    this.persisted = persisted
    this.title = meta.title ?? ''
    this.lastModified = Date.now()
  }

  get live() {
    return !!this.q
  }

  sessionState(): SessionState {
    let status = this.status
    if (!this.live && this.persisted && this.lastModified > 0 && runningElsewhere(this.id)) status = 'busy_elsewhere'
    return {
      id: this.id,
      title: this.title,
      cwd: this.cwd,
      status,
      provider: this.meta.provider,
      model: this.model || this.meta.model,
      permissionMode: this.meta.permissionMode,
      effort: this.meta.provider === 'claude' ? (this.meta.effort ?? 'xhigh') : null,
      classifierModel: this.meta.provider === 'deepseek' ? (this.meta.classifierModel ?? 'deepseek-flash') : null,
      live: this.live,
    }
  }

  snapshot(all = false): SessionSnapshot {
    this.flushNow()
    const items = all ? this.log.items : this.log.items.slice(-SNAPSHOT_ITEMS)
    return { state: this.sessionState(), items, seq: this.log.seq, hasEarlier: items.length < this.log.items.length }
  }

  // ---- broadcasting ----

  private broadcast(withState = false) {
    if (!this.log.hasChanges() && !withState) return
    const patch = this.log.takePatch()
    if (withState) patch.state = this.sessionState()
    for (const s of this.subscribers) s(patch)
  }

  private scheduleFlush() {
    if (this.flushTimer) return
    this.flushTimer = setTimeout(() => {
      this.flushTimer = undefined
      this.broadcast()
    }, 80)
  }

  private flushNow(withState = false) {
    clearTimeout(this.flushTimer)
    this.flushTimer = undefined
    this.broadcast(withState)
  }

  private setStatus(status: SessionStatus) {
    if (this.status === status) return
    this.status = status
    this.flushNow(true)
  }

  // ---- running ----

  private options() {
    const env: Record<string, string | undefined> = { ...process.env }
    for (const k of Object.keys(env)) if (k.startsWith('FARLINE_') || k === 'DEEPSEEK_API_KEY') delete env[k]
    env.CLAUDE_AGENT_SDK_CLIENT_APP = 'farline/1.0'
    let model: string | undefined = this.meta.model === 'default' ? undefined : this.meta.model
    if (this.meta.provider === 'deepseek') {
      Object.assign(env, {
        ANTHROPIC_BASE_URL: `${config.deepseekBase}/anthropic`,
        ANTHROPIC_AUTH_TOKEN: deepseekKey(),
        ANTHROPIC_MODEL: this.meta.model,
        ANTHROPIC_DEFAULT_OPUS_MODEL: this.meta.model,
        // Claude Code's auto-mode classifier runs on the sonnet slot (checked
        // in 2.1.299: CLAUDE_CODE_AUTO_MODE_MODEL is not consulted).
        ANTHROPIC_DEFAULT_SONNET_MODEL: this.meta.classifierModel ?? 'deepseek-flash',
        ANTHROPIC_DEFAULT_HAIKU_MODEL: 'deepseek-flash',
        ANTHROPIC_SMALL_FAST_MODEL: 'deepseek-flash',
        CLAUDE_CODE_SUBAGENT_MODEL: this.meta.model,
        // There is no Anthropic server-side classifier behind DeepSeek; skip
        // the probe and classify locally from the first call.
        CLAUDE_CODE_AUTO_MODE_SERVER: '0',
        // Claude Code assumes 200k for models it does not recognise; DeepSeek
        // V4 Pro / V4.1 Flash take 1M, so compact against that instead.
        CLAUDE_CODE_MAX_CONTEXT_TOKENS: '1000000',
        CLAUDE_CODE_AUTO_COMPACT_WINDOW: '1000000',
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
        API_TIMEOUT_MS: '600000',
      })
      model = this.meta.model
    }
    return {
      cwd: this.cwd,
      env,
      model,
      ...(this.meta.provider === 'claude' ? { effort: this.meta.effort ?? 'xhigh' } : {}),
      pathToClaudeCodeExecutable: config.claudePath,
      permissionMode: this.meta.permissionMode,
      allowDangerouslySkipPermissions: true,
      includePartialMessages: true,
      systemPrompt: { type: 'preset' as const, preset: 'claude_code' as const, snapshot: true },
      canUseTool: this.canUseTool,
      ...(this.persisted ? { resume: this.id } : { sessionId: this.id }),
      stderr: (d: string) => {
        if (/error/i.test(d)) console.error(`[${this.id.slice(0, 8)}] ${d.trim().slice(0, 500)}`)
      },
    }
  }

  private start() {
    makeRoomForLive(this)
    this.input = new Channel<SDKUserMessage>()
    this.q = query({ prompt: this.input, options: this.options() })
    void this.consume(this.q)
  }

  private async consume(q: Query) {
    try {
      for await (const m of q as AsyncIterable<any>) {
        this.lastActive = Date.now()
        switch (m.type) {
          case 'system':
            if (m.subtype === 'init') {
              this.model = m.model
              this.mcp = (m.mcp_servers ?? []).map((s: any) => ({ name: s.name, status: s.status }))
              this.persisted = true
              if (m.permissionMode && m.permissionMode !== this.meta.permissionMode) this.meta.permissionMode = m.permissionMode
              void refreshClaudeModels(q)
              this.flushNow(true)
            } else if (m.subtype === 'session_state_changed') {
              this.setStatus(m.state === 'requires_action' ? 'requires_action' : m.state === 'running' ? 'running' : 'idle')
            }
            break
          case 'stream_event':
            if (!m.parent_tool_use_id) {
              this.log.applyStreamEvent(m.event)
              this.scheduleFlush()
            }
            break
          case 'assistant':
          case 'user':
            this.log.apply(m)
            this.scheduleFlush()
            break
          case 'result':
            this.onResult(m)
            break
        }
      }
    } catch (err: any) {
      this.log.upsert({ kind: 'notice', id: randomUUID(), level: 'error', text: String(err?.message ?? err).slice(0, 2000) })
    } finally {
      if (this.q === q) {
        this.q = undefined
        this.input = undefined
      }
      // A replacement process may already be running; leave its state alone.
      if (!this.q) {
        this.rejectAllPending()
        this.log.dropDrafts()
        this.log.settleRunning()
        this.status = 'idle'
        this.lastModified = 0
        this.flushNow(true)
      }
    }
  }

  private onResult(m: any) {
    this.turns++
    if (this.respawn) {
      this.respawn = false
      setTimeout(() => this.status === 'idle' && this.close(), 0)
    }
    this.log.dropDrafts()
    this.log.settleRunning()
    if (m.is_error || m.subtype !== 'success') {
      const text = m.subtype === 'success' ? m.result : (m.errors ?? []).join('\n') || m.subtype
      if (text && !this.log.items.some((it) => it.kind === 'text' && it.text === text)) {
        this.log.upsert({ kind: 'notice', id: randomUUID(), level: 'error', text: String(text).slice(0, 2000) })
      }
    }
    this.status = 'idle'
    this.flushNow(true)
    if (this.subscribers.size === 0) {
      const last = [...this.log.items].reverse().find((it) => it.kind === 'text')
      void notify(this.title || '会话', last?.kind === 'text' ? last.text.slice(0, 120) : '已完成', `/s/${this.id}`)
    }
    // Claude Code writes its generated title a few seconds after the turn.
    if (this.turns === 1) for (const ms of [0, 6000, 20000]) setTimeout(() => void this.refreshTitle(), ms)
  }

  async refreshTitle() {
    const info = await getSessionInfo(this.id).catch(() => undefined)
    const title = this.meta.title ?? info?.customTitle ?? state.titles[this.id] ?? info?.firstPrompt?.slice(0, 40)
    if (title && title !== this.title) {
      this.title = title
      this.flushNow(true)
    }
  }

  send(text: string, uploadIds: string[] = []) {
    const uploads = uploadIds.map(loadUpload).filter((u) => !!u)
    const content: any[] = []
    const lines = [text.trim(), ...uploads.map((u) => `[附件] ${u.path}`)].filter(Boolean)
    content.push({ type: 'text', text: lines.join('\n\n') })
    for (const u of uploads) {
      if (u.isImage && u.size < 5 * 1024 * 1024) {
        content.push({ type: 'image', source: { type: 'base64', media_type: u.mime, data: readFileSync(u.path).toString('base64') } })
      }
    }
    const uuid = randomUUID()
    const images = uploads.filter((u) => u.isImage).map((u) => ({ url: `/api/uploads/${u.id}` }))
    const files = uploads.filter((u) => !u.isImage).map((u) => u.path)
    this.log.upsert({ kind: 'user', id: uuid, text: text.trim(), images: images.length ? images : undefined, files: files.length ? files : undefined, ts: Date.now() })
    if (!this.q) this.start()
    this.input!.push({
      type: 'user',
      uuid: uuid as any,
      message: { role: 'user', content },
      parent_tool_use_id: null,
      origin: { kind: 'human' },
    } as SDKUserMessage)
    this.lastActive = Date.now()
    this.status = 'running'
    this.flushNow(true)
  }

  async interrupt() {
    this.rejectAllPending('已中断')
    await this.q?.interrupt().catch(() => undefined)
  }

  // Provider and classifier live in the process environment, so changing them
  // means a fresh Claude Code process that resumes this session.
  private respawn = false

  // The key is baked into the running process; pick up a new one.
  deepseekKeyChanged() {
    if (this.meta.provider === 'deepseek') this.respawnWhenIdle()
  }

  private respawnWhenIdle() {
    if (!this.q) return
    if (this.status === 'idle') this.close()
    else this.respawn = true
  }

  async update(patch: { permissionMode?: PermissionMode; model?: string; effort?: EffortLevel; provider?: Provider; classifierModel?: string }) {
    if (patch.provider && patch.provider !== this.meta.provider) {
      this.meta.provider = patch.provider
      this.meta.model = patch.model ?? (patch.provider === 'deepseek' ? 'deepseek-v4-pro' : 'opus')
      this.model = ''
      // Each provider brings its default permission mode along.
      if (!patch.permissionMode) {
        if (patch.provider === 'deepseek') this.meta.permissionMode = 'bypassPermissions'
        else if (this.meta.permissionMode === 'bypassPermissions') this.meta.permissionMode = 'auto'
      }
      this.respawnWhenIdle()
      patch = { ...patch, model: undefined }
    }
    if (patch.classifierModel && this.meta.provider === 'deepseek' && patch.classifierModel !== (this.meta.classifierModel ?? 'deepseek-flash')) {
      this.meta.classifierModel = patch.classifierModel
      this.respawnWhenIdle()
    }
    if (patch.effort && this.meta.provider === 'claude') {
      this.meta.effort = patch.effort
      await this.q?.applyFlagSettings({ effortLevel: patch.effort }).catch(() => undefined)
    }
    if (patch.permissionMode) {
      this.meta.permissionMode = patch.permissionMode
      await this.q?.setPermissionMode(patch.permissionMode).catch(() => undefined)
    }
    if (patch.model && patch.model !== this.meta.model) {
      this.meta.model = patch.model
      this.model = ''
      await this.q?.setModel(patch.model === 'default' ? undefined : patch.model).catch(() => undefined)
    }
    state.sessions[this.id] = { ...this.meta }
    save()
    this.flushNow(true)
  }

  async mcpStatus(): Promise<McpServer[]> {
    if (this.q) {
      const list = await this.q.mcpServerStatus().catch(() => undefined)
      if (list) this.mcp = list.map((s: any) => ({ name: s.name, status: s.status }))
    }
    return this.mcp
  }

  // Detach first so a message sent while the old process winds down starts a
  // fresh one instead of landing in a closed input.
  close() {
    const q = this.q
    this.input?.close()
    this.q = undefined
    this.input = undefined
    q?.close()
  }

  // ---- permissions & questions ----

  private canUseTool: CanUseTool = (toolName, input, opts) =>
    new Promise<PermissionResult>((resolve) => {
      const reqId = randomUUID()
      const itemId = opts.toolUseID
      if (toolName === 'AskUserQuestion') {
        const prev = this.log.get(itemId)
        const questions = Array.isArray((input as any).questions) ? (input as any).questions : []
        this.log.upsert({ kind: 'ask', id: itemId, questions, status: 'pending', reqId, answer: prev?.kind === 'ask' ? prev.answer : undefined })
        this.pending.set(reqId, { kind: 'ask', itemId, input, resolve })
        void this.alert('有问题需要你回答', questions[0]?.question ?? '')
      } else {
        const prev = this.log.get(itemId)
        const base: Item = prev?.kind === 'tool' ? prev : { kind: 'tool', id: itemId, name: toolName, input, status: 'running' }
        if (base.kind !== 'tool') return resolve({ behavior: 'deny', message: 'invalid state' })
        this.log.upsert({
          ...base,
          input: Object.keys(base.input).length ? base.input : input,
          permission: {
            reqId,
            title: opts.title,
            description: opts.description ?? opts.decisionReason,
            canAlways: !!opts.suggestions?.length && !opts.suppressAlwaysAllowRule,
            status: 'pending',
          },
        })
        this.pending.set(reqId, { kind: 'tool', itemId, input, suggestions: opts.suggestions, resolve })
        void this.alert('需要授权', opts.title ?? toolName)
      }
      this.status = 'requires_action'
      this.flushNow(true)
      opts.signal.addEventListener('abort', () => this.settle(reqId, { behavior: 'deny', message: 'aborted' }), { once: true })
    })

  private async alert(title: string, body: string) {
    if (this.subscribers.size === 0) await notify(`${title} · ${this.title || '会话'}`, body.slice(0, 120), `/s/${this.id}`)
  }

  private settle(reqId: string, result: PermissionResult) {
    const p = this.pending.get(reqId)
    if (!p) return false
    this.pending.delete(reqId)
    const item = this.log.get(p.itemId)
    if (item?.kind === 'tool' && item.permission) {
      this.log.upsert({ ...item, permission: { ...item.permission, status: result.behavior === 'allow' ? 'allowed' : 'denied' } })
    } else if (item?.kind === 'ask') {
      this.log.upsert({ ...item, reqId: undefined, status: result.behavior === 'allow' ? 'answered' : 'cancelled' })
    }
    if (this.pending.size === 0 && this.status === 'requires_action') this.status = 'running'
    p.resolve(result)
    this.flushNow(true)
    return true
  }

  decide(reqId: string, decision: 'allow' | 'always' | 'deny') {
    const p = this.pending.get(reqId)
    if (!p || p.kind !== 'tool') return false
    if (decision === 'deny') return this.settle(reqId, { behavior: 'deny', message: '用户拒绝了这次操作' })
    return this.settle(reqId, {
      behavior: 'allow',
      updatedInput: p.input,
      ...(decision === 'always' && p.suggestions ? { updatedPermissions: p.suggestions } : {}),
    })
  }

  answer(reqId: string, answers: Record<string, string> | null) {
    const p = this.pending.get(reqId)
    if (!p || p.kind !== 'ask') return false
    if (!answers) return this.settle(reqId, { behavior: 'deny', message: '用户跳过了这些问题' })
    const item = this.log.get(p.itemId)
    if (item?.kind === 'ask') {
      this.log.upsert({ ...item, answer: Object.entries(answers).map(([q, a]) => `${q}\n${a}`).join('\n\n') })
    }
    return this.settle(reqId, { behavior: 'allow', updatedInput: { ...p.input, answers } })
  }

  private rejectAllPending(message = '会话已结束') {
    for (const reqId of [...this.pending.keys()]) this.settle(reqId, { behavior: 'deny', message })
  }
}

// ---- registry ----

const views = new Map<string, SessionView>()

export function liveViews() {
  return [...views.values()].filter((v) => v.live)
}

export function allViews() {
  return [...views.values()]
}

export function cachedView(id: string) {
  return views.get(id)
}

function metaFor(id: string): SessionMeta {
  return state.sessions[id] ?? {
    provider: 'claude',
    model: 'default',
    permissionMode: state.prefs.permissionMode && state.prefs.permissionMode !== 'bypassPermissions' ? state.prefs.permissionMode : 'auto',
  }
}

export async function openView(id: string): Promise<SessionView | undefined> {
  const existing = views.get(id)
  if (existing) {
    existing.lastActive = Date.now()
    return existing
  }
  const info = await getSessionInfo(id)
  if (!info) return undefined
  const meta = metaFor(id)
  const view = new SessionView(id, info.cwd ?? config.defaultCwd, meta, true)
  view.title = meta.title ?? info.customTitle ?? state.titles[id] ?? info.firstPrompt?.slice(0, 40) ?? ''
  view.lastModified = info.lastModified
  const messages = await getSessionMessages(id)
  for (const m of messages) {
    view.log.apply(m as any)
    const model = (m as any).message?.model
    if (m.type === 'assistant' && typeof model === 'string' && !(m as any).parent_tool_use_id && model !== '<synthetic>') view.model = model
  }
  view.log.discardChanges()
  views.set(id, view)
  return view
}

export function createView(cwd: string, meta: SessionMeta): SessionView {
  const id = randomUUID()
  const view = new SessionView(id, cwd, meta, false)
  state.sessions[id] = { ...meta }
  save()
  views.set(id, view)
  return view
}

function makeRoomForLive(except: SessionView) {
  const live = liveViews().filter((v) => v !== except)
  if (live.length < config.maxLive) return
  const idle = live.filter((v) => v.status === 'idle' && v.subscribers.size === 0).sort((a, b) => a.lastActive - b.lastActive)
  idle[0]?.close()
}

// Ask Claude Code for its model list once at boot, without starting a turn.
export async function warmModels() {
  async function* never(): AsyncGenerator<SDKUserMessage> {
    await new Promise(() => {})
  }
  const q = query({ prompt: never(), options: { cwd: config.defaultCwd, pathToClaudeCodeExecutable: config.claudePath, persistSession: false } })
  try {
    await Promise.race([refreshClaudeModels(q), new Promise((r) => setTimeout(r, 30_000))])
  } finally {
    q.close()
  }
}

let modelsRefreshed = false
async function refreshClaudeModels(q: Query) {
  if (modelsRefreshed) return
  const list: ModelInfo[] | undefined = await q.supportedModels().catch(() => undefined)
  if (!list?.length) return
  modelsRefreshed = true
  const main = Object.keys(MAIN).filter((v) => list.some((m) => m.value === v))
  const rest = list.filter((m) => m.value !== 'default' && !MAIN[m.value])
  claudeModels = [
    ...main.map((value) => ({ provider: 'claude' as const, value, ...MAIN[value], resolved: list.find((m) => m.value === value)?.resolvedModel ?? MAIN[value].resolved, efforts: EFFORTS })),
    ...rest.map((m) => ({ provider: 'claude' as const, value: m.value, label: m.displayName, resolved: m.resolvedModel ?? m.value, more: true, efforts: m.supportsEffort ? (m.supportedEffortLevels as EffortLevel[]) : undefined })),
  ]
}

// Close idle processes and drop cold read-only views.
setInterval(() => {
  const now = Date.now()
  for (const v of views.values()) {
    if (v.subscribers.size) continue
    if (v.live && v.status === 'idle' && now - v.lastActive > config.idleCloseMs) v.close()
    else if (!v.live && now - v.lastActive > 10 * 60_000) views.delete(v.id)
  }
}, 60_000).unref()
