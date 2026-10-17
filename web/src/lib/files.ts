// Local files mentioned in messages: which ones exist (resolved in batches
// and cached), and the file panel's state — the left column on desktop,
// full screen on phones.
import { createContext, useEffect, useState } from 'react'
import type { ResolvedPath } from '../../../shared/types.ts'

// Where relative paths in rendered Markdown are looked up: the session's
// working places, or the directory of the file being previewed.
export interface FileLinkScope {
  sessionId: string | null
  base?: string
}

export const FileLinkContext = createContext<FileLinkScope | null>(null)

const PATHISH = /^(?:~|\.{1,2})?\/?(?:[\w@.+-]+\/)*[\w@.+-]+\/?(?::\d+(?::\d+)?|#L\d+(?:-L?\d+)?)?$/
const EXT = /\.[A-Za-z][A-Za-z0-9]{0,7}(?::\d+(?::\d+)?|#L\d+(?:-L?\d+)?)?$/

// `src/a.ts`, `package.json`, `~/x/`, `a.ts:42` — not `npm i` or `1.2.3`.
export function looksLikePath(t: string): boolean {
  return t.length < 300 && PATHISH.test(t) && (t.includes('/') || EXT.test(t)) && !/^\d+(\.\d+)*$/.test(t)
}

export function isLocalHref(href: string): boolean {
  return !!href && !/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(href)
}

const cache = new Map<string, { at: number; value: ResolvedPath | null }>()
const pending = new Map<string, { scope: FileLinkScope; raws: Set<string>; waiters: (() => void)[] }>()

const scopeKey = (s: FileLinkScope) => `${s.sessionId ?? ''}\n${s.base ?? ''}`

function cached(key: string): ResolvedPath | null | undefined {
  const hit = cache.get(key)
  // Misses expire: the file may have been written since.
  if (!hit || (hit.value === null && Date.now() - hit.at > 60_000)) return undefined
  return hit.value
}

async function flush(key: string) {
  const job = pending.get(key)
  if (!job) return
  pending.delete(key)
  const raws = [...job.raws]
  try {
    const res = await fetch('/api/fs/resolve', {
      method: 'POST',
      headers: { 'x-farline': '1', 'content-type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ paths: raws, sessionId: job.scope.sessionId, base: job.scope.base }),
    })
    const data: Record<string, ResolvedPath | null> = res.ok ? await res.json() : {}
    for (const r of raws) cache.set(`${key}\n${r}`, { at: Date.now(), value: data[r] ?? null })
  } catch {}
  job.waiters.forEach((w) => w())
}

export async function resolveFiles(raws: string[], scope: FileLinkScope): Promise<Record<string, ResolvedPath | null>> {
  const key = scopeKey(scope)
  const missing = raws.filter((r) => cached(`${key}\n${r}`) === undefined)
  if (missing.length) {
    await new Promise<void>((done) => {
      let job = pending.get(key)
      if (!job) {
        job = { scope, raws: new Set(), waiters: [] }
        pending.set(key, job)
        setTimeout(() => void flush(key), 60)
      }
      missing.forEach((r) => job.raws.add(r))
      job.waiters.push(done)
    })
  }
  return Object.fromEntries(raws.map((r) => [r, cached(`${key}\n${r}`) ?? null]))
}

// ---- the panel ----

export interface FileTarget {
  path: string
  line?: number
}

export interface FilesState {
  // Directories and files opened from one another; the last one shows.
  stack: FileTarget[]
  sessionId: string | null
}

let current: FilesState | null = null
const listeners = new Set<(s: FilesState | null) => void>()

function emit(s: FilesState | null) {
  current = s
  listeners.forEach((l) => l(s))
}

export function openFile(target: FileTarget, sessionId: string | null) {
  emit({ stack: [target], sessionId })
}

export function pushFile(target: FileTarget) {
  if (current) emit({ ...current, stack: [...current.stack, target] })
}

export function popFile() {
  if (current && current.stack.length > 1) emit({ ...current, stack: current.stack.slice(0, -1) })
}

export function closeFiles() {
  emit(null)
}

export function useFiles() {
  const [s, set] = useState(current)
  useEffect(() => {
    listeners.add(set)
    return () => {
      listeners.delete(set)
    }
  }, [])
  return s
}
