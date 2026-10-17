// The server half of the plugin API (apiVersion 1). A plugin's server entry
// default-exports a PluginDefinition. The module is imported at startup for
// every installed plugin, so keep side effects inside activate(); everything
// registered through the context is undone when the plugin is disabled.
import type { Hono } from 'hono'
import type { PermissionMode, PluginStatus, SessionState, SettingType } from '../../../shared/types.ts'

// Text shown to people: one string, or one per language, e.g.
// { en: 'Balance', 'zh-CN': '余额' }. The page's language is picked, then
// English, then whatever there is.
export type Text = string | Partial<Record<string, string>>

export interface Disposable {
  dispose(): void
}

export interface SettingField {
  key: string
  label: Text
  type: SettingType
  placeholder?: Text
  options?: { value: string; label: Text }[]
  default?: string | number | boolean
  // Fall back to this environment variable when nothing is saved. It is also
  // kept out of the environment of agent processes.
  env?: string
}

export type SettingValues = Record<string, string | number | boolean | undefined>

export interface PluginDefinition {
  settings?: SettingField[]
  // Throw an Error with a user-facing message to refuse the values. Receives
  // the values as they would be after saving, env fallbacks included.
  validateSettings?(values: SettingValues, i18n: Localizer): Promise<void> | void
  // Only asked while the plugin is enabled.
  status?(ctx: PluginContext): Promise<StatusReport> | StatusReport
  links?: { label: Text; url: string }[]
  activate(ctx: PluginContext): Promise<void> | void
  deactivate?(): Promise<void> | void
}

export interface Localizer {
  locale(): string
  t(text: Text): string
}

export interface StatusReport {
  summary?: Text
  tone?: PluginStatus['tone']
  rows?: { label: Text; value: Text; tone?: 'danger' }[]
}

// locale(): the language of the request being handled (or the owner's usual
// one), e.g. 'en' or 'zh-CN'. t(): pick the right string for it. Use them for
// errors you throw and text you build.
export interface PluginContext extends Localizer {
  readonly id: string
  // Private directory for the plugin's own files, created on first use.
  readonly dataDir: string
  log(...args: unknown[]): void
  settings: {
    // Saved values, else the env fallback, else the field default.
    get(): SettingValues
    onChange(fn: (values: SettingValues) => void): Disposable
  }
  providers: { register(provider: ProviderDefinition): Disposable }
  notifications: { register(channel: ChannelDefinition): Disposable }
  hooks: { on<E extends HookName>(event: E, handler: (payload: HookPayloads[E]) => unknown): Disposable }
  // Routes served at /api/ext/<plugin id>/…, behind the app's login.
  http: Hono
  sessions: {
    get(id: string): SessionState | undefined
    // Send a user message, starting the session's process if needed.
    send(id: string, text: string): Promise<void>
  }
  helpers: {
    // Environment that points Claude Code at an Anthropic-compatible API.
    anthropicCompatible(opts: AnthropicCompatibleOptions): Record<string, string>
  }
}

// ---- model providers ----

export interface ProviderModel {
  value: string
  label: Text
  desc?: Text
  // Listed under "More models".
  more?: boolean
}

export interface ProviderDefinition {
  id: string
  label: Text
  // False hides the provider, e.g. while no API key is set.
  available(): boolean
  models(): ProviderModel[]
  // Model values the auto-mode classifier may use; the first is the default.
  classifierModels?: string[]
  defaultPermissionMode?: PermissionMode
  // Extra environment for the agent process of a session.
  env(session: { model: string; classifierModel?: string }): Record<string, string>
}

export interface AnthropicCompatibleOptions {
  baseUrl: string
  token: string
  model: string
  // Background work (titles, summaries); defaults to model.
  smallModel?: string
  classifierModel?: string
  // Claude Code assumes 200k for models it does not know.
  contextWindow?: number
}

// ---- notifications ----

export interface Notification {
  kind: 'done' | 'attention' | 'test'
  title: string
  body: string
  // Absolute when the public address is known, else a path like /s/<id>.
  url: string
  sessionId?: string
}

export interface ChannelDefinition {
  id: string
  label: Text
  send(n: Notification): Promise<void>
}

// ---- hooks ----

export interface SessionInfo {
  id: string
  title: string
  cwd: string
  provider: string
  model: string
}

export interface HookPayloads {
  'session.created': { session: SessionInfo }
  'message.sent': { session: SessionInfo; text: string }
  'turn.completed': { session: SessionInfo; text: string; error: boolean }
  attention: { session: SessionInfo; kind: 'permission' | 'question'; title: string }
}

export type HookName = keyof HookPayloads
