// Loads plugins' browser code and keeps what they register.
import * as React from 'react'
import * as ReactDOM from 'react-dom'
import * as JSXRuntime from 'react/jsx-runtime'
import { Component, useSyncExternalStore, type ComponentType, type ErrorInfo, type ReactNode } from 'react'
import type { PluginInfo } from '../../../shared/types.ts'
import { Markdown } from '../components/Markdown.tsx'
import { Sheet } from '../components/Sheet.tsx'
import { Spinner, toast } from '../components/bits.tsx'
import { navigate } from '../lib/router.ts'
import type { FarlineApp, SessionAction, ToolRendererProps, WebPlugin } from './types.ts'

// The import map in index.html points 'react' and friends at small modules
// that read these, so plugins share the page's React.
;(window as any).__FARLINE__ = { modules: { react: React, 'react-dom': ReactDOM, 'react/jsx-runtime': JSXRuntime } }

interface Owned {
  pluginId: string
}
interface ToolRenderer extends Owned {
  match: (name: string) => boolean
  component: ComponentType<ToolRendererProps>
}
type Action = SessionAction & Owned
interface Panel extends Owned {
  component: ComponentType
}

interface Snapshot {
  toolRenderers: ToolRenderer[]
  sessionActions: Action[]
  settingsPanels: Panel[]
  errors: Record<string, string>
}

let snap: Snapshot = { toolRenderers: [], sessionActions: [], settingsPanels: [], errors: {} }
const listeners = new Set<() => void>()

function update(fn: (s: Snapshot) => Snapshot) {
  snap = fn(snap)
  for (const l of listeners) l()
}

export function usePlugins(): Snapshot {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => snap,
  )
}

function add<K extends 'toolRenderers' | 'sessionActions' | 'settingsPanels'>(key: K, entry: Snapshot[K][number]): () => void {
  update((s) => ({ ...s, [key]: [...s[key], entry] }))
  return () => update((s) => ({ ...s, [key]: (s[key] as Snapshot[K][number][]).filter((e) => e !== entry) }))
}

function matcher(m: string | string[] | ((name: string) => boolean)) {
  if (typeof m === 'function') return m
  const names = Array.isArray(m) ? m : [m]
  return (name: string) => names.includes(name)
}

function makeApp(id: string, cleanups: (() => void)[]): FarlineApp {
  const keep = (fn: () => void) => (cleanups.push(fn), fn)
  return {
    id,
    ui: { Sheet, Spinner, Markdown },
    toast,
    navigate: (path) => navigate(path),
    fetch: (path, init = {}) => {
      const headers = new Headers(init.headers)
      headers.set('x-farline', '1')
      if (typeof init.body === 'string' && !headers.has('content-type')) headers.set('content-type', 'application/json')
      return fetch(`/api/ext/${id}${path.startsWith('/') ? path : `/${path}`}`, { ...init, headers, credentials: 'same-origin' })
    },
    registerToolRenderer: (match, component) => keep(add('toolRenderers', { pluginId: id, match: matcher(match), component })),
    registerSessionAction: (action) => keep(add('sessionActions', { ...action, pluginId: id })),
    registerSettingsPanel: (component) => keep(add('settingsPanels', { pluginId: id, component })),
  }
}

const loaded = new Map<string, { url: string; cleanup: () => void }>()

function setError(id: string, message: string | null) {
  update((s) => {
    const errors = { ...s.errors }
    if (message) errors[id] = message
    else delete errors[id]
    return { ...s, errors }
  })
}

function unload(id: string) {
  loaded.get(id)?.cleanup()
  loaded.delete(id)
  setError(id, null)
}

async function load(id: string, url: string) {
  const cleanups: (() => void)[] = []
  const cleanup = () => {
    for (const fn of cleanups.splice(0).reverse()) {
      try {
        fn()
      } catch {}
    }
  }
  loaded.set(id, { url, cleanup })
  try {
    const mod: WebPlugin = await import(/* @vite-ignore */ url)
    if (typeof mod.activate !== 'function') throw new Error('web entry has no activate()')
    const ret = await mod.activate(makeApp(id, cleanups))
    if (typeof ret === 'function') cleanups.push(ret)
    setError(id, null)
  } catch (e: any) {
    console.error(`[plugin ${id}]`, e)
    cleanup()
    setError(id, String(e?.message ?? e).slice(0, 300))
  }
}

// Bring loaded browser code in line with the server's plugin list.
export async function syncPlugins(list: PluginInfo[]) {
  for (const [id, l] of loaded) if (!list.some((p) => p.id === id && p.web === l.url)) unload(id)
  await Promise.all(list.filter((p) => p.web && !loaded.has(p.id)).map((p) => load(p.id, p.web!)))
}

// A broken plugin component shows its fallback instead of taking the page down.
export class PluginBoundary extends Component<{ pluginId: string; fallback?: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[plugin ${this.props.pluginId}]`, error, info.componentStack)
  }
  render() {
    if (this.state.failed) return this.props.fallback ?? <div className="notice error">插件「{this.props.pluginId}」出错了</div>
    return this.props.children
  }
}
