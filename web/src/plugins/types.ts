// The browser half of the plugin API (apiVersion 1). A plugin's web entry is
// an ES module exporting activate(app). It may import 'react',
// 'react/jsx-runtime' and 'react-dom'; the page maps those to its own copy,
// so build plugin code with them marked external. Every register call
// returns a function that undoes it; activate may return one more cleanup.
import type { ComponentType, ReactNode } from 'react'
import type { Item, SessionState } from '../../../shared/types.ts'

export type ToolItem = Extract<Item, { kind: 'tool' }>

export interface ToolRendererProps {
  tool: ToolItem
  sessionId: string | null
}

export interface SessionAction {
  label: string
  icon?: ReactNode
  run(session: SessionState): unknown
}

export interface FarlineApp {
  readonly id: string
  ui: {
    Sheet: ComponentType<{ title?: ReactNode; onClose: () => void; onBack?: () => void; size?: 'auto' | 'medium' | 'tall'; children: ReactNode }>
    Spinner: ComponentType<{ size?: number }>
    Markdown: ComponentType<{ text: string }>
  }
  toast(message: string): void
  navigate(path: string): void
  // fetch() against the plugin's own routes: /api/ext/<id><path>.
  fetch(path: string, init?: RequestInit): Promise<Response>
  // Replaces the detail view of matching tool calls.
  registerToolRenderer(match: string | string[] | ((toolName: string) => boolean), component: ComponentType<ToolRendererProps>): () => void
  // A row in a session's "…" menu.
  registerSessionAction(action: SessionAction): () => void
  // Shown on the plugin's settings page, under the generated fields.
  registerSettingsPanel(component: ComponentType): () => void
}

export interface WebPlugin {
  activate(app: FarlineApp): void | (() => void) | Promise<void | (() => void)>
}
