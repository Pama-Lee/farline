// What a transcript says about a session: when someone last actually talked
// in it, and whether another Claude Code process (Claude app bridge,
// terminal) is mid-turn. File mtime alone lies here: idle bridge processes
// keep appending status lines, so look at the last conversational record.
import { closeSync, existsSync, openSync, readdirSync, readSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const PROJECTS = join(homedir(), '.claude', 'projects')
const STALE_MS = 10 * 60_000
const paths = new Map<string, string>()

interface Activity {
  // Timestamp of the last user/assistant message, 0 when none was found.
  at: number
  running: boolean
}

const cache = new Map<string, { mtimeMs: number; size: number; act: Activity }>()

function sessionFile(id: string): string | undefined {
  const cached = paths.get(id)
  if (cached && existsSync(cached)) return cached
  for (const dir of readdirSync(PROJECTS)) {
    const f = join(PROJECTS, dir, `${id}.jsonl`)
    if (existsSync(f)) {
      paths.set(id, f)
      return f
    }
  }
  return undefined
}

function scan(file: string, size: number, bytes: number): Activity | undefined {
  const len = Math.min(size, bytes)
  const buf = Buffer.alloc(len)
  const fd = openSync(file, 'r')
  try {
    readSync(fd, buf, 0, len, size - len)
  } finally {
    closeSync(fd)
  }
  for (const line of buf.toString('utf8').split('\n').reverse()) {
    if (!line.startsWith('{')) continue
    let d: any
    try {
      d = JSON.parse(line)
    } catch {
      continue
    }
    if (d.isSidechain || d.isMeta || (d.type !== 'assistant' && d.type !== 'user')) continue
    const at = Date.parse(d.timestamp ?? '') || 0
    if (d.type === 'assistant') {
      const stop = d.message?.stop_reason
      const done = d.isApiErrorMessage || stop === 'end_turn' || stop === 'stop_sequence' || stop === 'max_tokens' || stop === 'refusal'
      return { at, running: !done }
    }
    const c = d.message?.content
    const text = typeof c === 'string' ? c : Array.isArray(c) ? c.map((b: any) => b.text ?? '').join('') : ''
    const idle = /^\s*\[Request interrupted/.test(text) || /^\s*<(local-command|command-name)/.test(text)
    return { at, running: !idle }
  }
  return undefined
}

export function sessionActivity(id: string): Activity {
  const file = sessionFile(id)
  if (!file) return { at: 0, running: false }
  const { size, mtimeMs } = statSync(file)
  const hit = cache.get(id)
  if (hit && hit.mtimeMs === mtimeMs && hit.size === size) return hit.act
  // Status lines can pile up after the last message; widen the window once.
  const act = scan(file, size, 256 * 1024) ?? (size > 256 * 1024 ? scan(file, size, 4 * 1024 * 1024) : undefined) ?? { at: 0, running: false }
  cache.set(id, { mtimeMs, size, act })
  return act
}

export function runningElsewhere(id: string): boolean {
  const file = sessionFile(id)
  if (!file || Date.now() - statSync(file).mtimeMs > STALE_MS) return false
  return sessionActivity(id).running
}
