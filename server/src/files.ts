// Local files mentioned in a conversation: turn what the model wrote
// (`docs/plugins.md`, `server/src/main.ts:42`, ~/x) into real paths, and
// read files and directories for the viewer.
import { closeSync, existsSync, openSync, readSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, extname, isAbsolute, join, resolve } from 'node:path'
import type { FileEntry, FileRead, ResolvedPath } from '../../shared/types.ts'
import { underFsRoot } from './config.ts'
import type { SessionView } from './live.ts'

const READ_LIMIT = 2 * 1024 * 1024
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'])

function expand(p: string) {
  return p.replace(/^~(?=\/|$)/, homedir())
}

function kindOf(p: string): 'file' | 'dir' | null {
  if (!underFsRoot(p)) return null
  try {
    const st = statSync(p)
    return st.isDirectory() ? 'dir' : st.isFile() ? 'file' : null
  } catch {
    return null
  }
}

// Absolute paths a session has touched or mentioned, newest first: tool
// inputs (file_path, path), `cd` targets and absolute paths in commands.
function sessionPaths(view: Pick<SessionView, 'log' | 'cwd'>): string[] {
  const out: string[] = []
  const items = view.log.items
  for (let i = items.length - 1; i >= 0 && out.length < 400; i--) {
    const it = items[i]
    if (it.kind !== 'tool') continue
    for (const k of ['file_path', 'notebook_path', 'path']) {
      const v = it.input[k]
      if (typeof v === 'string' && v) out.push(isAbsolute(expand(v)) ? expand(v) : join(view.cwd, v))
    }
    const cmd = it.input.command
    if (typeof cmd === 'string') {
      for (const m of cmd.matchAll(/(?:^|[\s;&|(])cd\s+("[^"]+"|'[^']+'|[^\s;&|)]+)/g)) {
        const p = expand(m[1].replace(/^["']|["']$/g, ''))
        if (isAbsolute(p)) out.push(p)
      }
      for (const m of cmd.matchAll(/(?<![\w./-])((?:~|\/(?:home|tmp|opt|srv|var|etc|usr|root|data|mnt|workspace))\/[\w.@+\/-]*)/g)) out.push(expand(m[1]))
    }
  }
  return [...new Set(out)]
}

// "src/a.ts:42", "src/a.ts:42:7", "src/a.ts#L42" → path and line.
function splitLine(raw: string): { path: string; line?: number } {
  const m = raw.match(/^(.*?)(?::(\d+)(?::\d+)?|#L(\d+)(?:-L?\d+)?)$/)
  if (!m) return { path: raw }
  return { path: m[1], line: Number(m[2] ?? m[3]) }
}

export function resolvePaths(raws: string[], opts: { view?: Pick<SessionView, 'log' | 'cwd'>; base?: string; cwd?: string }): Record<string, ResolvedPath | null> {
  const known = opts.view ? sessionPaths(opts.view) : []
  const cwd = opts.view?.cwd ?? opts.cwd
  // Directories to try relative paths against: the given base, where the
  // session has been working (and a few levels up, for project roots), then cwd.
  let dirs: string[] | undefined
  const contextDirs = () => {
    if (dirs) return dirs
    const list: string[] = []
    if (opts.base) list.push(opts.base)
    for (const p of known) {
      let d = kindOf(p) === 'dir' ? p : dirname(p)
      for (let up = 0; up < 4 && d !== '/'; up++, d = dirname(d)) list.push(d)
    }
    if (cwd) list.push(cwd)
    dirs = [...new Set(list)]
    return dirs
  }
  const out: Record<string, ResolvedPath | null> = {}
  for (const raw of raws.slice(0, 200)) {
    const { path, line } = splitLine(raw.trim())
    const clean = expand(path.replace(/^\.\//, ''))
    let found: string | undefined
    if (isAbsolute(clean)) {
      if (kindOf(clean)) found = clean
    } else if (clean && !clean.startsWith('../')) {
      const tail = `/${clean.replace(/\/$/, '')}`
      found = known.find((k) => k.endsWith(tail) && kindOf(k))
      found ??= contextDirs()
        .map((d) => join(d, clean))
        .find((p) => kindOf(p))
    } else if (clean.startsWith('../') && (opts.base || cwd)) {
      const p = resolve(opts.base ?? cwd!, clean)
      if (kindOf(p)) found = p
    }
    const kind = found && kindOf(found)
    out[raw] = found && kind ? { path: resolve(found), dir: kind === 'dir', ...(line ? { line } : {}) } : null
  }
  return out
}

export function readPath(p: string): FileRead | null {
  const path = resolve(expand(p))
  const kind = kindOf(path)
  if (!kind) return null
  const st = statSync(path)
  if (kind === 'dir') {
    const entries: FileEntry[] = []
    for (const d of readdirSync(path, { withFileTypes: true })) {
      let size: number | undefined
      let dir = d.isDirectory()
      if (d.isSymbolicLink()) {
        try {
          const t = statSync(join(path, d.name))
          dir = t.isDirectory()
          size = t.isFile() ? t.size : undefined
        } catch {
          continue
        }
      } else if (d.isFile()) {
        try {
          size = statSync(join(path, d.name)).size
        } catch {}
      } else if (!dir) continue
      entries.push({ name: d.name, dir, ...(size !== undefined ? { size } : {}) })
    }
    entries.sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name))
    return { path, kind: 'dir', size: 0, mtime: st.mtimeMs, entries }
  }
  const base = { path, size: st.size, mtime: st.mtimeMs }
  if (IMAGE_EXT.has(extname(path).toLowerCase())) return { ...base, kind: 'image' }
  const len = Math.min(st.size, READ_LIMIT)
  const buf = Buffer.alloc(len)
  const fd = openSync(path, 'r')
  try {
    readSync(fd, buf, 0, len, 0)
  } finally {
    closeSync(fd)
  }
  if (buf.subarray(0, 8192).includes(0)) return { ...base, kind: 'binary' }
  return { ...base, kind: 'text', text: buf.toString('utf8'), truncated: st.size > READ_LIMIT }
}

export function existsFile(p: string) {
  const path = resolve(expand(p))
  return kindOf(path) === 'file' && existsSync(path) ? path : null
}
