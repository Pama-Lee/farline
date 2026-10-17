// Wire types shared by server and web.

export type Provider = 'claude' | 'deepseek'

export type PermissionMode = 'default' | 'auto' | 'acceptEdits' | 'plan' | 'bypassPermissions'

export type EffortLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export type SessionStatus = 'idle' | 'running' | 'requires_action' | 'busy_elsewhere'

export interface ImageRef {
  url: string
}

export interface QuestionOption {
  label: string
  description?: string
}

export interface Question {
  question: string
  header?: string
  multiSelect?: boolean
  options: QuestionOption[]
}

export interface PermissionAsk {
  reqId: string
  title?: string
  description?: string
  canAlways: boolean
  status: 'pending' | 'allowed' | 'denied'
}

export type Item =
  | { kind: 'user'; id: string; text: string; images?: ImageRef[]; files?: string[]; ts?: number }
  | { kind: 'text'; id: string; text: string; streaming?: boolean; ts?: number }
  | { kind: 'thinking'; id: string; text: string; streaming?: boolean }
  | {
      kind: 'tool'
      id: string
      name: string
      input: Record<string, unknown>
      status: 'running' | 'done' | 'error'
      result?: string
      truncated?: boolean
      // Images the tool returned (e.g. Read on a screenshot), served from the transcript.
      images?: ImageRef[]
      permission?: PermissionAsk
    }
  | {
      kind: 'ask'
      id: string
      reqId?: string
      questions: Question[]
      status: 'pending' | 'answered' | 'cancelled'
      answer?: string
    }
  | { kind: 'notice'; id: string; level: 'info' | 'error'; text: string }

export interface SessionSummary {
  id: string
  title: string
  cwd: string
  updatedAt: number
  status: SessionStatus
  provider: Provider
}

export interface SessionState {
  id: string
  title: string
  cwd: string
  status: SessionStatus
  provider: Provider
  model: string
  permissionMode: PermissionMode
  effort: EffortLevel | null
  // DeepSeek sessions: model used by Claude Code's auto-mode classifier.
  classifierModel: string | null
  live: boolean
}

export interface SessionSnapshot {
  state: SessionState
  items: Item[]
  seq: number
  hasEarlier: boolean
}

export interface Patch {
  seq: number
  upserts?: Item[]
  removes?: string[]
  state?: SessionState
}

export interface ModelOption {
  provider: Provider
  value: string
  label: string
  desc?: string
  // Shown under "更多模型" instead of the main list.
  more?: boolean
  resolved?: string
  efforts?: EffortLevel[]
}

export interface McpServer {
  name: string
  status: string
}

export interface DirListing {
  path: string
  parent: string | null
  dirs: { name: string; path: string; hidden?: boolean }[]
}

export interface Upload {
  id: string
  name: string
  path: string
  mime: string
  size: number
  isImage: boolean
}

export interface SendBody {
  text: string
  uploads?: string[]
}

export interface CreateBody extends SendBody {
  cwd: string
  provider: Provider
  model: string
  permissionMode: PermissionMode
  effort?: EffortLevel
  classifierModel?: string
}

export interface DeepSeekStatus {
  // Where the API key comes from: the settings page or DEEPSEEK_API_KEY.
  source: 'saved' | 'env' | null
  hint?: string
  invalid?: boolean
  balance?: { available: boolean; balances: { currency: string; total: string }[] }
}
