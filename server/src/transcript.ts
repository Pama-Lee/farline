// Normalizes Claude Code messages (persisted transcript or live SDK stream)
// into the flat Item list the web client renders.
import type { Item, Patch, Question } from '../../shared/types.ts'

const RESULT_LIMIT = 16_000

type Block = Record<string, any>

export class ItemLog {
  items: Item[] = []
  private index = new Map<string, number>()
  private changed = new Set<string>()
  private removed = new Set<string>()
  // Streaming drafts per assistant message id, in block order. Tool blocks
  // use their real id so the final message merges into the same item.
  private drafts = new Map<string, string[]>()
  private streamMsgId: string | null = null
  private blockIds = new Map<number, string>()
  seq = 0
  private sessionId: string

  constructor(sessionId: string) {
    this.sessionId = sessionId
  }

  get(id: string): Item | undefined {
    const i = this.index.get(id)
    return i === undefined ? undefined : this.items[i]
  }

  upsert(item: Item) {
    const i = this.index.get(item.id)
    if (i === undefined) {
      this.index.set(item.id, this.items.length)
      this.items.push(item)
    } else {
      this.items[i] = item
    }
    this.changed.add(item.id)
    this.removed.delete(item.id)
  }

  remove(id: string) {
    const i = this.index.get(id)
    if (i === undefined) return
    this.items.splice(i, 1)
    this.index.clear()
    this.items.forEach((it, j) => this.index.set(it.id, j))
    this.changed.delete(id)
    this.removed.add(id)
  }

  hasChanges() {
    return this.changed.size > 0 || this.removed.size > 0
  }

  takePatch(): Patch {
    const patch: Patch = { seq: ++this.seq }
    if (this.changed.size) patch.upserts = [...this.changed].map((id) => this.get(id)!).filter(Boolean)
    if (this.removed.size) patch.removes = [...this.removed]
    this.changed.clear()
    this.removed.clear()
    return patch
  }

  discardChanges() {
    this.changed.clear()
    this.removed.clear()
  }

  // ---- persisted / complete messages ----

  apply(msg: { type: string; uuid?: string; message?: any; parent_tool_use_id?: string | null; timestamp?: string; isSynthetic?: boolean }) {
    if (msg.parent_tool_use_id) return
    const ts = msg.timestamp ? Date.parse(msg.timestamp) : undefined
    if (msg.type === 'assistant') this.applyAssistant(msg.uuid ?? cryptoId(), msg.message, ts)
    else if (msg.type === 'user' && !msg.isSynthetic) this.applyUser(msg.uuid ?? cryptoId(), msg.message, ts)
  }

  private applyAssistant(uuid: string, message: any, ts?: number) {
    const content: Block[] = Array.isArray(message?.content) ? message.content : []
    const pending = message?.id ? this.drafts.get(message.id) : undefined
    content.forEach((b, i) => {
      const draft = pending?.shift()
      if (draft?.startsWith('draft:')) this.remove(draft)
      const id = `${uuid}:${i}`
      if (b.type === 'text' && b.text?.trim()) this.upsert({ kind: 'text', id, text: b.text, ts })
      else if (b.type === 'thinking' && b.thinking?.trim()) this.upsert({ kind: 'thinking', id, text: b.thinking })
      else if (b.type === 'tool_use') this.applyToolUse(b)
    })
  }

  private applyToolUse(b: Block) {
    const prev = this.get(b.id)
    if (b.name === 'AskUserQuestion') {
      const questions: Question[] = Array.isArray(b.input?.questions) ? b.input.questions : []
      const p = prev?.kind === 'ask' ? prev : undefined
      this.upsert({ kind: 'ask', id: b.id, questions, status: p?.status ?? 'pending', reqId: p?.reqId, answer: p?.answer })
      return
    }
    const p = prev?.kind === 'tool' ? prev : undefined
    this.upsert({
      kind: 'tool',
      id: b.id,
      name: b.name,
      input: b.input ?? {},
      status: p?.status ?? 'running',
      result: p?.result,
      truncated: p?.truncated,
      permission: p?.permission,
    })
  }

  private applyUser(uuid: string, message: any, ts?: number) {
    const content = message?.content
    if (typeof content === 'string') return this.applyHuman(uuid, [{ type: 'text', text: content }], ts)
    if (!Array.isArray(content)) return
    const human: Block[] = []
    for (const b of content as Block[]) {
      if (b.type === 'tool_result') this.applyToolResult(b)
      else human.push(b)
    }
    if (human.length) this.applyHuman(uuid, human, ts)
  }

  private applyToolResult(b: Block) {
    const item = this.get(b.tool_use_id)
    if (!item) return
    const imageCount = Array.isArray(b.content) ? b.content.filter((c: Block) => c.type === 'image').length : 0
    const images = Array.from({ length: imageCount }, (_, i) => ({ url: `/api/sessions/${this.sessionId}/tool-images/${b.tool_use_id}/${i}` }))
    let text = typeof b.content === 'string' ? b.content : Array.isArray(b.content)
      ? b.content.map((c: Block) => (c.type === 'text' ? c.text : c.type === 'image' ? '[图片]' : '')).join('\n')
      : ''
    const truncated = text.length > RESULT_LIMIT
    if (truncated) text = text.slice(0, RESULT_LIMIT)
    if (item.kind === 'ask') {
      this.upsert({ ...item, status: b.is_error ? 'cancelled' : 'answered', answer: text, reqId: undefined })
    } else if (item.kind === 'tool') {
      const permission = item.permission?.status === 'pending' ? { ...item.permission, status: 'denied' as const } : item.permission
      this.upsert({ ...item, status: b.is_error ? 'error' : 'done', result: text, truncated, permission, ...(images.length ? { images } : {}) })
    }
  }

  private applyHuman(uuid: string, blocks: Block[], ts?: number) {
    let text = blocks.filter((b) => b.type === 'text').map((b) => b.text as string).join('\n')
    const imageCount = blocks.filter((b) => b.type === 'image').length
    if (/^\s*\[Request interrupted/.test(text)) {
      this.upsert({ kind: 'notice', id: uuid, level: 'info', text: '已中断' })
      return
    }
    const cmd = text.match(/<command-name>([^<]*)<\/command-name>/)
    if (cmd) {
      const args = text.match(/<command-args>([\s\S]*?)<\/command-args>/)?.[1] ?? ''
      text = `${cmd[1]} ${args}`.trim()
    } else if (/^\s*<(local-command|task-notification|bash-|user-memory|system-reminder)/.test(text) || /^Caveat:/.test(text)) {
      return
    }
    text = text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim()
    const files: string[] = []
    text = text.replace(/^\[附件\] (.+)$/gm, (_, p) => (files.push(p), '')).trim()
    if (!text && !imageCount && !files.length) return
    const images = Array.from({ length: imageCount }, (_, i) => ({ url: `/api/sessions/${this.sessionId}/images/${uuid}/${i}` }))
    this.upsert({ kind: 'user', id: uuid, text, images: images.length ? images : undefined, files: files.length ? files : undefined, ts })
  }

  // ---- live stream events ----

  applyStreamEvent(ev: any) {
    if (ev.type === 'message_start') {
      this.streamMsgId = ev.message?.id ?? null
      this.blockIds.clear()
      if (this.streamMsgId) this.drafts.set(this.streamMsgId, [])
    } else if (ev.type === 'content_block_start' && this.streamMsgId) {
      const b = ev.content_block
      const list = this.drafts.get(this.streamMsgId)!
      if (b.type === 'tool_use') {
        list.push(b.id)
        this.blockIds.set(ev.index, b.id)
        if (b.name !== 'AskUserQuestion' && !this.get(b.id)) this.upsert({ kind: 'tool', id: b.id, name: b.name, input: {}, status: 'running' })
      } else if (b.type === 'text' || b.type === 'thinking') {
        const id = `draft:${this.streamMsgId}:${ev.index}`
        list.push(id)
        this.blockIds.set(ev.index, id)
        this.upsert(b.type === 'text' ? { kind: 'text', id, text: '', streaming: true } : { kind: 'thinking', id, text: '', streaming: true })
      } else {
        list.push(`other:${ev.index}`)
      }
    } else if (ev.type === 'content_block_delta') {
      const id = this.blockIds.get(ev.index)
      const item = id ? this.get(id) : undefined
      if (!item) return
      if (item.kind === 'text' && ev.delta?.type === 'text_delta') this.upsert({ ...item, text: item.text + ev.delta.text })
      else if (item.kind === 'thinking' && ev.delta?.type === 'thinking_delta') this.upsert({ ...item, text: item.text + ev.delta.thinking })
    }
  }

  // Drafts that never got a final message (interrupt, error) must not linger.
  dropDrafts() {
    for (const it of [...this.items]) if (it.id.startsWith('draft:')) this.remove(it.id)
    this.drafts.clear()
  }

  // Tools still "running" when a turn ends were cut off.
  settleRunning() {
    for (const it of this.items) {
      if (it.kind === 'tool' && it.status === 'running') this.upsert({ ...it, status: 'error', permission: it.permission?.status === 'pending' ? { ...it.permission, status: 'denied' } : it.permission })
      if (it.kind === 'ask' && it.status === 'pending') this.upsert({ ...it, status: 'cancelled', reqId: undefined })
    }
  }
}

function cryptoId() {
  return Math.random().toString(36).slice(2)
}
