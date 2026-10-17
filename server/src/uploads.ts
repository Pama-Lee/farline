import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { config, underFsRoot } from './config.ts'
import type { DirListing, Upload } from '../../shared/types.ts'

const dir = join(config.dataDir, 'uploads')
mkdirSync(dir, { recursive: true, mode: 0o700 })

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp'])

export async function saveUpload(file: File): Promise<Upload> {
  const id = randomBytes(9).toString('base64url')
  const safe = (file.name || 'file').replace(/[^\w.\-一-龥]+/g, '_').slice(-80)
  const day = new Date().toISOString().slice(0, 10)
  mkdirSync(join(dir, day), { recursive: true })
  const path = join(dir, day, `${id}-${safe}`)
  writeFileSync(path, Buffer.from(await file.arrayBuffer()))
  const upload: Upload = { id, name: file.name || safe, path, mime: file.type || 'application/octet-stream', size: file.size, isImage: IMAGE_TYPES.has(file.type) }
  writeFileSync(join(dir, `${id}.json`), JSON.stringify(upload))
  return upload
}

export function loadUpload(id: string): Upload | undefined {
  if (!/^[\w-]+$/.test(id)) return undefined
  const f = join(dir, `${id}.json`)
  return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : undefined
}

export function listDirs(path: string | undefined, showHidden = false): DirListing | undefined {
  const expanded = path?.replace(/^~(?=\/|$)/, homedir())
  const target = resolve(expanded || config.defaultCwd)
  if (!underFsRoot(target)) return undefined
  let entries: string[]
  try {
    entries = readdirSync(target)
  } catch {
    return undefined
  }
  const dirs = entries
    .filter((n) => showHidden || (!n.startsWith('.') && n !== 'node_modules'))
    .filter((n) => {
      try {
        return statSync(join(target, n)).isDirectory()
      } catch {
        return false
      }
    })
    .sort((a, b) => a.localeCompare(b))
    .map((name) => ({ name, path: join(target, name), ...(name.startsWith('.') ? { hidden: true } : {}) }))
  const parent = target === config.fsRoot || target === '/' ? null : resolve(target, '..')
  return { path: target, parent, dirs }
}
