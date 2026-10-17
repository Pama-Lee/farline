// Installing plugins straight from a GitHub repository:
//   owner/repo, owner/repo#ref, owner/repo/sub/dir#ref,
//   https://github.com/owner/repo, …/tree/<ref>/<sub/dir>
// The repository (or the directory) must hold a package.json with a
// "farline" field. Dependencies are installed without running scripts.
import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import type { RemoteSource } from '../../../shared/types.ts'
import { installDir, userPluginsDir } from './host.ts'
import { t } from '../i18n.ts'

const run = promisify(execFile)
const MAX_BYTES = 50 * 1024 * 1024
const NAME = /^[A-Za-z0-9._-]+$/

export interface Spec {
  repo: string
  ref?: string
  path?: string
}

export function parseSpec(input: string): Spec {
  let s = input.trim().replace(/^github:/, '')
  let ref: string | undefined
  const hash = s.indexOf('#')
  if (hash >= 0) {
    ref = s.slice(hash + 1) || undefined
    s = s.slice(0, hash)
  }
  const url = s.match(/^(?:https?:\/\/)?(?:www\.)?github\.com\/(.+)$/i)
  let parts = (url ? url[1] : s).replace(/\.git$/, '').split('/').filter(Boolean)
  if (url && parts[2] === 'tree' && parts[3]) {
    ref ??= parts[3]
    parts = [parts[0], parts[1], ...parts.slice(4)]
  }
  const [owner, name, ...rest] = parts
  if (!owner || !name || !NAME.test(owner) || !NAME.test(name.replace(/\.git$/, ''))) throw new Error(t('err.repoSpec'))
  const path = rest.join('/') || undefined
  if (path && path.split('/').some((x) => x === '..' || x === '.')) throw new Error(t('err.badPath'))
  if (ref && !/^[\w./-]+$/.test(ref)) throw new Error(t('err.badRef'))
  return { repo: `${owner}/${name.replace(/\.git$/, '')}`, ref, path }
}

function headers(accept: string): Record<string, string> {
  const token = process.env.FARLINE_GITHUB_TOKEN
  return { accept, 'user-agent': 'farline', ...(token ? { authorization: `Bearer ${token}` } : {}) }
}

export async function latestCommit(spec: Spec): Promise<string> {
  const res = await fetch(`https://api.github.com/repos/${spec.repo}/commits/${encodeURIComponent(spec.ref ?? 'HEAD')}`, {
    headers: headers('application/vnd.github.sha'),
    signal: AbortSignal.timeout(20_000),
  })
  if (res.status === 404 || res.status === 422) throw new Error(spec.ref ? t('err.repoOrRefNotFound', { repo: spec.repo, ref: spec.ref }) : t('err.repoNotFound', { repo: spec.repo }))
  if (res.status === 403 || res.status === 429) throw new Error(t('err.githubLimited'))
  if (!res.ok) throw new Error(t('err.githubStatus', { status: res.status }))
  const sha = (await res.text()).trim()
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error(t('err.githubBadResponse'))
  return sha
}

async function download(repo: string, sha: string, file: string) {
  const res = await fetch(`https://api.github.com/repos/${repo}/tarball/${sha}`, { headers: headers('application/vnd.github+json'), signal: AbortSignal.timeout(120_000) })
  if (!res.ok || !res.body) throw new Error(t('err.downloadFailed', { status: res.status }))
  const chunks: Buffer[] = []
  let size = 0
  for await (const c of res.body as any as AsyncIterable<Uint8Array>) {
    size += c.byteLength
    if (size > MAX_BYTES) throw new Error(t('err.repoTooLarge'))
    chunks.push(Buffer.from(c))
  }
  writeFileSync(file, Buffer.concat(chunks))
}

function isPlugin(dir: string) {
  try {
    return !!JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).farline
  } catch {
    return false
  }
}

// The repository root, or the one plugin somewhere below it.
function findPlugin(tree: string, repo: string): string {
  if (isPlugin(tree)) return tree
  const found: string[] = []
  const walk = (dir: string, depth: number) => {
    for (const d of readdirSync(dir, { withFileTypes: true })) {
      if (!d.isDirectory() || d.name.startsWith('.') || d.name === 'node_modules') continue
      const sub = join(dir, d.name)
      if (isPlugin(sub)) found.push(sub)
      else if (depth < 3) walk(sub, depth + 1)
    }
  }
  walk(tree, 1)
  if (found.length === 1) return found[0]
  if (found.length > 1) {
    const rel = found.map((f) => f.slice(tree.length + 1).split(sep).join('/'))
    throw new Error(t('err.manyPlugins', { n: found.length, list: rel.slice(0, 5).map((r) => `${repo}/${r}`) }))
  }
  return tree
}

function npmBin() {
  const local = join(dirname(process.execPath), 'npm')
  return existsSync(local) ? local : 'npm'
}

export async function installFromGitHub(input: string | Spec, known?: string) {
  let spec = typeof input === 'string' ? parseSpec(input) : input
  const commit = await latestCommit(spec)
  if (known === commit) return { updated: false as const }
  // Hidden, so plugin discovery never sees a half-unpacked tree.
  const work = join(userPluginsDir, `.install-${Date.now().toString(36)}`)
  mkdirSync(work, { recursive: true })
  try {
    const tarball = join(work, 'src.tar.gz')
    await download(spec.repo, commit, tarball)
    const tree = join(work, 'tree')
    mkdirSync(tree)
    await run('tar', ['-xzf', tarball, '-C', tree, '--strip-components=1', '--no-same-owner', '--no-same-permissions'], { timeout: 60_000 })
    // Links could point outside the plugin; a plugin has no need for them.
    await run('find', [tree, '-type', 'l', '-delete'])
    const dir = spec.path ? resolve(tree, spec.path) : findPlugin(tree, spec.repo)
    if (dir !== tree && !dir.startsWith(tree + sep)) throw new Error(t('err.badPath'))
    if (!isPlugin(dir)) throw new Error(spec.path ? t('err.noPluginAt', { path: spec.path }) : t('err.noPluginInRepo'))
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
    spec = { ...spec, path: spec.path ?? (dir === tree ? undefined : dir.slice(tree.length + 1).split(sep).join('/')) }
    if (pkg.dependencies && Object.keys(pkg.dependencies).length) {
      await run(npmBin(), ['install', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', '--no-package-lock'], { cwd: dir, timeout: 180_000 }).catch((e) => {
        throw new Error(t('err.depsFailed', { detail: String(e?.stderr || e?.message || e).trim().split('\n').pop() }))
      })
    }
    const remote: RemoteSource = { repo: spec.repo, ...(spec.ref ? { ref: spec.ref } : {}), ...(spec.path ? { path: spec.path } : {}), commit, installedAt: Date.now() }
    const p = await installDir(dir, remote)
    return { updated: true as const, plugin: p }
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}
