// One SessionView per opened session. A view becomes "live" when it owns a
// running Claude Code process (streaming-input query); otherwise it is a
// read-only projection of the persisted transcript.
import { randomUUID } from 'node:crypto'
import { closeSync, existsSync, openSync, readFileSync, readSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import {
  getSessionInfo,
  getSessionMessages,
  query,
  type CanUseTool,
  type ModelInfo,
  type PermissionResult,
  type PermissionUpdate,
  type Query,
  type RewindFilesResult,
  type SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk'
import { runningElsewhere, sessionFile } from './activity.ts'
import { config, underFsRoot } from './config.ts'
import { allProviders, emit, provider as pluginProvider, secretEnv } from './plugins/registry.ts'
import type { SessionInfo } from './plugins/types.ts'
import { notify } from './push.ts'
import { save, state, type SessionMeta } from './store.ts'
import { ItemLog } from './transcript.ts'
import { loadUpload } from './uploads.ts'
import type { BackgroundTask, Catalog, EffortLevel, Item, McpServer, ModelOption, Patch, PermissionMode, Provider, ProviderInfo, SessionSnapshot, SessionState, SessionStatus, TaskOutput } from '../../shared/types.ts'
import { t, tx } from './i18n.ts'
import type { MessageKey } from '../../shared/i18n/index.ts'

const SNAPSHOT_ITEMS = 400

const EFFORTS: EffortLevel[] = ['low', 'medium', 'high', 'xhigh', 'max']

// Same wording as the Claude app's model picker.
// desc is a message key, worded per request in catalog().
const MAIN: Record<string, { label: string; desc: MessageKey; resolved: string }> = {
  opus: { label: 'Opus 5.5', desc: 'model.desc.opus', resolved: 'claude-opus-5-5' },
  fable: { label: 'Fable 5.1', desc: 'model.desc.fable', resolved: 'claude-fable-5-1' },
  sonnet: { label: 'Sonnet 5.5', desc: 'model.desc.sonnet', resolved: 'claude-sonnet-5-5' },
  haiku: { label: 'Haiku 5.5', desc: 'model.desc.haiku', resolved: 'claude-haiku-5-5' },
}

let claudeModels: ModelOption[] = Object.entries(MAIN).map(([value, m]) => ({ provider: 'claude', value, ...m, efforts: EFFORTS }))

// Plugin providers that are ready to use (for example, have a key).
function readyProviders() {
  return allProviders().filter((p) => {
    try {
      return p.available()
    } catch {
      return false
    }
  })
}

export function catalog(): Catalog {
  const providers: ProviderInfo[] = [{ id: 'claude', label: 'Claude' }]
  const models: ModelOption[] = claudeModels.map((m) => (MAIN[m.value] ? { ...m, desc: t(MAIN[m.value].desc) } : m))
  for (const p of readyProviders()) {
    let list: ModelOption[]
    try {
      list = p.models().map((m) => ({ ...m, label: tx(m.label), desc: m.desc === undefined ? undefined : tx(m.desc), provider: p.id }))
    } catch {
      continue
    }
    if (!list.length) continue
    providers.push({ id: p.id, label: tx(p.label), classifierModels: p.classifierModels, defaultPermissionMode: p.defaultPermissionMode })
    models.push(...list)
  }
  return { providers, models }
}

export function models(): ModelOption[] {
  return catalog().models
}

export function providerReady(id: Provider): boolean {
  return id === 'claude' || catalog().providers.some((p) => p.id === id)
}

export function providerLabel(id: Provider): string {
  const p = id === 'claude' ? undefined : pluginProvider(id)
  return id === 'claude' ? 'Claude' : p ? tx(p.label) : id
}

export function defaultModel(id: Provider): string {
  return id === 'claude' ? 'opus' : (models().find((m) => m.provider === id && !m.more)?.value ?? '')
}

function classifierFor(meta: SessionMeta): string | undefined {
  const list = meta.provider === 'claude' ? undefined : pluginProvider(meta.provider)?.classifierModels
  if (!list?.length) return undefined
  return meta.classifierModel && list.includes(meta.classifierModel) ? meta.classifierModel : list[0]
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

interface TaskEntry extends BackgroundTask {
  // Foreground tasks (a blocking Agent call) show as steps, not here.
  background: boolean
}

const OUTPUT_TAIL = 16 * 1024

// The end of a task's output file. Subagent files are transcripts (JSONL);
// show what the agent said and which tools it used instead.
function readTaskFile(file: string | undefined, taskId: string): TaskOutput {
  if (!file || basename(file) !== `${taskId}.output` || !underFsRoot(file) || !existsSync(file)) return { text: '', total: 0 }
  const total = statSync(file).size
  const agent = /^a[0-9a-f]{8,}$/.test(taskId)
  const size = Math.min(total, agent ? 4 * 1024 * 1024 : OUTPUT_TAIL)
  const buf = Buffer.alloc(size)
  const fd = openSync(file, 'r')
  try {
    readSync(fd, buf, 0, size, total - size)
  } finally {
    closeSync(fd)
  }
  const raw = buf.toString('utf8')
  if (!agent) return { text: raw, total }
  const lines: string[] = []
  for (const line of raw.split('\n')) {
    let m: any
    try {
      m = JSON.parse(line)
    } catch {
      continue
    }
    if (m.type !== 'assistant' || !Array.isArray(m.message?.content)) continue
    for (const b of m.message.content) {
      if (b.type === 'text' && b.text?.trim()) lines.push(b.text.trim())
      else if (b.type === 'tool_use') lines.push(`→ ${b.name}${b.input?.description ? `  ${b.input.description}` : b.input?.file_path ? `  ${b.input.file_path}` : ''}`)
    }
  }
  const text = lines.join('\n\n')
  return { text: text.length > OUTPUT_TAIL ? text.slice(-OUTPUT_TAIL) : text, total }
}

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
  // Background tasks of the current process. bgRunning follows the CLI's
  // level signal (background_tasks_changed), the rest its task_* events.
  private tasks = new Map<string, TaskEntry>()
  private bgRunning = new Set<string>()

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
      classifierModel: classifierFor(this.meta) ?? null,
      live: this.live,
      tasks: this.live ? this.visibleTasks() : [],
    }
  }

  // Closing the process would kill these.
  get runningTasks() {
    return this.bgRunning.size
  }

  private visibleTasks(): BackgroundTask[] {
    return [...this.tasks.values()]
      .filter((t) => t.background)
      .map(({ background, ...t }) => (this.bgRunning.has(t.id) ? { ...t, status: 'running' as const } : t))
      .sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0))
  }

  info(): SessionInfo {
    return { id: this.id, title: this.title, cwd: this.cwd, provider: this.meta.provider, model: this.model || this.meta.model }
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
    for (const k of Object.keys(env)) if (k.startsWith('FARLINE_') || secretEnv.has(k)) delete env[k]
    env.CLAUDE_AGENT_SDK_CLIENT_APP = 'farline/1.0'
    let model: string | undefined = this.meta.model === 'default' ? undefined : this.meta.model
    if (this.meta.provider !== 'claude') {
      const p = pluginProvider(this.meta.provider)
      if (!p || !providerReady(p.id)) throw new Error(t('err.providerCheck', { name: providerLabel(this.meta.provider) }))
      Object.assign(env, p.env({ model: this.meta.model, classifierModel: classifierFor(this.meta) }))
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
      // Each background task gets its own stop button, so Stop only ends the
      // turn and running background work carries on.
      perTaskStopAffordance: true,
      agentProgressSummaries: true,
      includePartialMessages: true,
      systemPrompt: { type: 'preset' as const, preset: 'claude_code' as const, snapshot: true },
      canUseTool: this.canUseTool,
      enableFileCheckpointing: true,
      ...(this.persisted ? { resume: this.id } : { sessionId: this.id }),
      ...(this.persisted && this.meta.rewind ? { resumeSessionAt: this.meta.rewind.at } : {}),
      stderr: (d: string) => {
        if (/error/i.test(d)) console.error(`[${this.id.slice(0, 8)}] ${d.trim().slice(0, 500)}`)
      },
    }
  }

  private onTaskEvent(m: any) {
    const t = this.tasks.get(m.task_id)
    switch (m.subtype) {
      case 'task_started':
        if (m.skip_transcript || m.ambient) return
        this.tasks.set(m.task_id, {
          id: m.task_id,
          type: m.task_type ?? 'task',
          description: m.description ?? '',
          status: 'running',
          toolUseId: m.tool_use_id,
          startedAt: Date.now(),
          background: !!m.is_backgrounded || this.bgRunning.has(m.task_id),
        })
        break
      case 'task_updated': {
        if (!t) return
        const p = m.patch ?? {}
        if (p.description) t.description = p.description
        if (p.is_backgrounded) t.background = true
        if (p.status === 'completed' || p.status === 'failed' || p.status === 'killed') {
          t.status = p.status === 'killed' ? 'stopped' : p.status
          t.endedAt = p.end_time ?? Date.now()
        }
        if (p.error) t.summary = p.error
        break
      }
      case 'task_progress':
        if (!t) return
        if (m.summary) t.summary = m.summary
        if (m.last_tool_name) t.lastTool = m.last_tool_name
        if (m.usage) Object.assign(t, { tokens: m.usage.total_tokens, toolUses: m.usage.tool_uses })
        break
      case 'task_notification':
        if (m.skip_transcript || m.ambient) return
        if (t) Object.assign(t, { status: m.status, summary: m.summary, endedAt: t.endedAt ?? Date.now() })
        if (m.usage && t) Object.assign(t, { tokens: m.usage.total_tokens, toolUses: m.usage.tool_uses })
        if (!t || t.background) this.log.applyTaskEnd(m)
        break
      case 'background_tasks_changed':
        this.bgRunning = new Set()
        for (const x of m.tasks ?? []) {
          if (x.ambient) continue
          this.bgRunning.add(x.task_id)
          const e = this.tasks.get(x.task_id)
          if (e) Object.assign(e, { background: true, description: x.description || e.description })
          else this.tasks.set(x.task_id, { id: x.task_id, type: x.task_type, description: x.description, status: 'running', startedAt: Date.now(), background: true })
        }
        if (!this.bgRunning.size && this.respawn && this.status === 'idle') setTimeout(() => this.runningTasks === 0 && this.status === 'idle' && this.close(), 0)
        break
      default:
        return
    }
    // Keep the newest few that have ended.
    const ended = [...this.tasks.values()].filter((x) => x.status !== 'running' && !this.bgRunning.has(x.id))
    for (const x of ended.slice(0, Math.max(0, ended.length - 30))) this.tasks.delete(x.id)
    this.flushNow(true)
  }

  async stopTask(taskId: string) {
    if (!this.q) throw new Error(t('err.processEnded'))
    await this.q.stopTask(taskId)
  }

  // Ctrl+B: let a long foreground command or subagent go on in the background.
  async backgroundTool(toolUseId?: string): Promise<boolean> {
    if (!this.q) return false
    return this.q.backgroundTasks(toolUseId)
  }

  async taskOutput(taskId: string): Promise<TaskOutput> {
    const t = this.tasks.get(taskId)
    if (this.q && t?.type !== 'local_agent') {
      try {
        const r = await (this.q as any).getTaskOutput(taskId)
        return { text: r.output ?? '', total: r.total_bytes ?? 0 }
      } catch {}
    }
    // Ended, or from an earlier process: read the file the CLI wrote.
    const known = this.log.taskFiles.get(taskId)
    const sibling = this.log.taskFiles.values().next().value
    return readTaskFile(known ?? (sibling ? join(dirname(sibling), `${taskId}.output`) : undefined), taskId)
  }

  private start() {
    makeRoomForLive(this)
    this.tasks.clear()
    this.bgRunning.clear()
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
              if (this.meta.rewind) {
                delete this.meta.rewind
                state.sessions[this.id] = { ...this.meta }
                save()
              }
              if (m.permissionMode && m.permissionMode !== this.meta.permissionMode) this.meta.permissionMode = m.permissionMode
              void refreshClaudeModels(q)
              this.flushNow(true)
            } else if (m.subtype === 'session_state_changed') {
              this.setStatus(m.state === 'requires_action' ? 'requires_action' : m.state === 'running' ? 'running' : 'idle')
            } else if (/^task_|^background_tasks_changed$/.test(m.subtype)) {
              this.onTaskEvent(m)
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
        this.tasks.clear()
        this.bgRunning.clear()
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
    // Background tasks die with the process; wait for them to finish.
    if (this.respawn && this.runningTasks === 0) {
      this.respawn = false
      setTimeout(() => this.status === 'idle' && this.runningTasks === 0 && this.close(), 0)
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
    const last = [...this.log.items].reverse().find((it) => it.kind === 'text')
    const text = last?.kind === 'text' ? last.text : ''
    emit('turn.completed', { session: this.info(), text, error: !!m.is_error || m.subtype !== 'success' })
    if (this.subscribers.size === 0) {
      void notify({ kind: 'done', title: this.title || t('notify.session'), body: text.slice(0, 120) || t('notify.done'), url: `/s/${this.id}`, sessionId: this.id })
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
    if (!this.q && !providerReady(this.meta.provider)) throw new Error(t('err.providerCheck', { name: providerLabel(this.meta.provider) }))
    const uploads = uploadIds.map(loadUpload).filter((u) => !!u)
    const content: any[] = []
    const lines = [text.trim(), ...uploads.map((u) => `[Attachment] ${u.path}`)].filter(Boolean)
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
    emit('message.sent', { session: this.info(), text: text.trim() })
  }

  async interrupt() {
    this.rejectAllPending('Interrupted by the user')
    await this.q?.interrupt().catch(() => undefined)
  }

  // Provider and classifier live in the process environment, so changing them
  // means a fresh Claude Code process that resumes this session.
  private respawn = false

  respawnWhenIdle() {
    if (!this.q) return
    if (this.status === 'idle' && this.runningTasks === 0) this.close()
    else this.respawn = true
  }

  async update(patch: { permissionMode?: PermissionMode; model?: string; effort?: EffortLevel; provider?: Provider; classifierModel?: string }) {
    if (patch.provider && patch.provider !== this.meta.provider) {
      this.meta.provider = patch.provider
      this.meta.model = patch.model ?? defaultModel(patch.provider)
      this.model = ''
      // Each provider brings its default permission mode along.
      if (!patch.permissionMode) {
        const preferred = patch.provider === 'claude' ? undefined : pluginProvider(patch.provider)?.defaultPermissionMode
        if (preferred) this.meta.permissionMode = preferred
        else if (this.meta.permissionMode === 'bypassPermissions') this.meta.permissionMode = 'auto'
      }
      this.respawnWhenIdle()
      patch = { ...patch, model: undefined }
    }
    if (patch.classifierModel && patch.classifierModel !== classifierFor(this.meta)) {
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

  // ---- rewind ----

  // The session's own process, or a short-lived one that only resumes it.
  private async withProcess<T>(fn: (q: Query) => Promise<T>): Promise<T> {
    if (this.q) return fn(this.q)
    const env: Record<string, string | undefined> = { ...process.env }
    for (const k of Object.keys(env)) if (k.startsWith('FARLINE_') || secretEnv.has(k)) delete env[k]
    async function* never(): AsyncGenerator<SDKUserMessage> {
      await new Promise(() => {})
    }
    const q = query({ prompt: never(), options: { cwd: this.cwd, env, pathToClaudeCodeExecutable: config.claudePath, resume: this.id, enableFileCheckpointing: true } })
    try {
      return await Promise.race([fn(q), new Promise<never>((_, rej) => setTimeout(() => rej(new Error(t('err.timeout'))), 60_000))])
    } finally {
      q.close()
    }
  }

  // What rewinding the code to before this message would change.
  async rewindPreview(messageId: string): Promise<RewindFilesResult> {
    if (!this.persisted) return { canRewind: false }
    return this.withProcess((q) => q.rewindFiles(messageId, { dryRun: true })).catch((e) => ({ canRewind: false, error: String(e?.message ?? e) }))
  }

  // Go back to just before a user message: its files, the conversation, or both.
  async rewind(messageId: string, opts: { files: boolean; conversation: boolean }): Promise<{ restart?: boolean; files?: RewindFilesResult }> {
    if (this.status !== 'idle' || (!this.live && runningElsewhere(this.id))) throw new Error(t('err.waitToRewind'))
    const i = this.log.items.findIndex((it) => it.id === messageId && it.kind === 'user')
    if (i < 0) throw new Error(t('err.messageNotFound'))
    const parent = opts.conversation ? parentOf(this.id, messageId) : undefined
    if (opts.conversation && parent === undefined) throw new Error(t('err.messageNotFound'))
    if (opts.conversation && this.runningTasks) throw new Error(t('err.tasksRunning'))
    let files: RewindFilesResult | undefined
    if (opts.files) {
      files = await this.withProcess((q) => q.rewindFiles(messageId))
      if (!files.canRewind) throw new Error(files.error || t('err.nothingToRewind'))
    }
    if (!opts.conversation) return { files }
    // Rewinding to the first message leaves nothing; start over instead.
    if (parent === null) return { files, restart: true }
    this.close()
    this.meta.rewind = { at: parent!, from: messageId }
    state.sessions[this.id] = { ...this.meta }
    save()
    this.truncateAt(messageId)
    this.flushNow(true)
    return { files }
  }

  // Rewrite a reply in the transcript. The model reads the transcript again
  // when the next process resumes, so the next turn sees the new text.
  async editText(itemId: string, text: string) {
    if (this.status !== 'idle' || (!this.live && runningElsewhere(this.id))) throw new Error(t('err.waitToEdit'))
    const item = this.log.get(itemId)
    if (item?.kind !== 'text' || item.streaming) throw new Error(t('err.replyNotFound'))
    if (!text.trim()) throw new Error(t('err.emptyText'))
    const m = itemId.match(/^(.+):(\d+)$/)
    const file = sessionFile(this.id)
    if (!m || !file) throw new Error(t('err.replyNotFound'))
    if (this.live) {
      if (this.runningTasks) throw new Error(t('err.tasksRunning'))
      this.close()
      // Let the process finish its last writes.
      await new Promise((r) => setTimeout(r, 500))
    }
    const [, uuid, idx] = m
    let found = false
    const lines = readFileSync(file, 'utf8').split('\n')
    for (let i = 0; i < lines.length && !found; i++) {
      if (!lines[i].includes(uuid)) continue
      let e: any
      try {
        e = JSON.parse(lines[i])
      } catch {
        continue
      }
      const block = e.uuid === uuid && e.type === 'assistant' ? e.message?.content?.[Number(idx)] : undefined
      if (block?.type !== 'text') continue
      block.text = text
      lines[i] = JSON.stringify(e)
      found = true
    }
    if (!found) throw new Error(t('err.replyNotFound'))
    const tmp = `${file}.farline-edit`
    writeFileSync(tmp, lines.join('\n'), { mode: statSync(file).mode })
    renameSync(tmp, file)
    this.log.upsert({ ...item, text, edited: true })
    this.meta.edited = [...new Set([...(this.meta.edited ?? []), itemId])].slice(-200)
    state.sessions[this.id] = { ...this.meta }
    save()
    this.flushNow(true)
  }

  truncateAt(messageId: string) {
    const i = this.log.items.findIndex((it) => it.id === messageId)
    if (i < 0) return
    for (const it of this.log.items.slice(i)) this.log.remove(it.id)
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
        void this.alert('question', t('notify.question'), questions[0]?.question ?? '')
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
        void this.alert('permission', t('notify.permission'), opts.title ?? toolName)
      }
      this.status = 'requires_action'
      this.flushNow(true)
      opts.signal.addEventListener('abort', () => this.settle(reqId, { behavior: 'deny', message: 'aborted' }), { once: true })
    })

  private async alert(kind: 'permission' | 'question', title: string, body: string) {
    emit('attention', { session: this.info(), kind, title: body })
    if (this.subscribers.size === 0) {
      await notify({ kind: 'attention', title: `${title} · ${this.title || t('notify.session')}`, body: body.slice(0, 120), url: `/s/${this.id}`, sessionId: this.id })
    }
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
    if (decision === 'deny') return this.settle(reqId, { behavior: 'deny', message: 'The user denied this action' })
    return this.settle(reqId, {
      behavior: 'allow',
      updatedInput: p.input,
      ...(decision === 'always' && p.suggestions ? { updatedPermissions: p.suggestions } : {}),
    })
  }

  answer(reqId: string, answers: Record<string, string> | null) {
    const p = this.pending.get(reqId)
    if (!p || p.kind !== 'ask') return false
    if (!answers) return this.settle(reqId, { behavior: 'deny', message: 'The user skipped these questions' })
    const item = this.log.get(p.itemId)
    if (item?.kind === 'ask') {
      this.log.upsert({ ...item, answer: Object.entries(answers).map(([q, a]) => `${q}\n${a}`).join('\n\n') })
    }
    return this.settle(reqId, { behavior: 'allow', updatedInput: { ...p.input, answers } })
  }

  private rejectAllPending(message = 'The session ended') {
    for (const reqId of [...this.pending.keys()]) this.settle(reqId, { behavior: 'deny', message })
  }
}

// The transcript entry a message follows: undefined when it is not found,
// null for the first one.
function parentOf(sessionId: string, uuid: string): string | null | undefined {
  const file = sessionFile(sessionId)
  if (!file) return undefined
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.includes(uuid)) continue
    try {
      const e = JSON.parse(line)
      if (e.uuid === uuid) return e.parentUuid ?? null
    } catch {}
  }
  return undefined
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
  if (meta.rewind) view.truncateAt(meta.rewind.from)
  for (const itemId of meta.edited ?? []) {
    const it = view.log.get(itemId)
    if (it?.kind === 'text') view.log.upsert({ ...it, edited: true })
  }
  view.log.discardChanges()
  views.set(id, view)
  return view
}

export function createView(cwd: string, meta: SessionMeta, title: string): SessionView {
  const id = randomUUID()
  const view = new SessionView(id, cwd, meta, false)
  view.title = title
  state.sessions[id] = { ...meta }
  save()
  views.set(id, view)
  emit('session.created', { session: view.info() })
  return view
}

function makeRoomForLive(except: SessionView) {
  const live = liveViews().filter((v) => v !== except)
  if (live.length < config.maxLive) return
  const idle = live.filter((v) => v.status === 'idle' && v.runningTasks === 0 && v.subscribers.size === 0).sort((a, b) => a.lastActive - b.lastActive)
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
    if (v.live && v.status === 'idle' && v.runningTasks === 0 && now - v.lastActive > config.idleCloseMs) v.close()
    else if (!v.live && now - v.lastActive > 10 * 60_000) views.delete(v.id)
  }
}, 60_000).unref()
