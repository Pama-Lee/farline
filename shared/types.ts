// Wire types shared by server and web.

// 'claude' is built in; any other id comes from a plugin.
export type Provider = string

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
  // Set for plugin providers, so lists can tag them without the catalog.
  providerLabel?: string
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
  // Plugin providers with a classifier choice: model used by Claude Code's
  // auto-mode classifier.
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

export interface ProviderInfo {
  id: Provider
  label: string
  // Models the auto-mode classifier may run on; the first is the default.
  classifierModels?: string[]
  defaultPermissionMode?: PermissionMode
}

export interface Catalog {
  providers: ProviderInfo[]
  models: ModelOption[]
}

// ---- plugins ----

export type SettingType = 'text' | 'secret' | 'number' | 'boolean' | 'select'

export interface SettingFieldView {
  key: string
  label: string
  type: SettingType
  placeholder?: string
  options?: { value: string; label: string }[]
  // Plain values are sent as is; secrets only as a hint like "sk-…324c".
  value?: string | number | boolean
  hint?: string
  source?: 'saved' | 'env'
}

export interface PluginStatus {
  // Short text for the settings row, e.g. a balance.
  summary?: string
  tone?: 'danger'
  rows?: { label: string; value: string; tone?: 'danger' }[]
}

export interface PluginInfo {
  id: string
  name: string
  version: string
  source: 'builtin' | 'local' | 'npm'
  enabled: boolean
  state: 'active' | 'disabled' | 'error'
  error?: string
  // URL of the browser entry, versioned for caching.
  web?: string
  settings: SettingFieldView[]
  links: { label: string; url: string }[]
  hasStatus: boolean
  // Registers a notification channel, so "send test" makes sense.
  notifies: boolean
}
