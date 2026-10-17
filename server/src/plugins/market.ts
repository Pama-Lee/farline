// Plugins anyone has published: GitHub repositories tagged with the topic
// farline-plugin whose root package.json has a "farline" field. Name,
// description and author come from that package.json; "engines.farline"
// (a semver range) and "farline.apiVersion" say which Farline it runs on.
import type { MarketPlugin } from '../../../shared/types.ts'
import { API_VERSION, listPlugins } from './host.ts'
import { FARLINE_VERSION, satisfies } from './semver.ts'

export const TOPIC = process.env.FARLINE_PLUGIN_TOPIC || 'farline-plugin'

const LIST_TTL = 10 * 60_000

function headers(): Record<string, string> {
  const token = process.env.FARLINE_GITHUB_TOKEN
  return { accept: 'application/vnd.github+json', 'user-agent': 'farline', ...(token ? { authorization: `Bearer ${token}` } : {}) }
}

// ---- the list ----

interface Repo {
  full_name: string
  description: string | null
  stargazers_count: number
  pushed_at: string
  default_branch: string
  html_url: string
  owner: { login: string }
}

const manifests = new Map<string, { pushedAt: string; pkg: any }>()
let cached: { at: number; repos: Repo[] } | null = null

async function searchRepos(): Promise<Repo[]> {
  if (cached && Date.now() - cached.at < LIST_TTL) return cached.repos
  const res = await fetch(`https://api.github.com/search/repositories?q=${encodeURIComponent(`topic:${TOPIC}`)}&sort=stars&per_page=50`, { headers: headers(), signal: AbortSignal.timeout(20_000) })
  if (res.status === 403 || res.status === 429) {
    if (cached) return cached.repos
    throw new Error('GitHub 限流了，过一会儿再试')
  }
  if (!res.ok) throw new Error(`GitHub 返回 ${res.status}`)
  const repos: Repo[] = (await res.json()).items ?? []
  cached = { at: Date.now(), repos }
  return repos
}

// Raw files are not counted against the API rate limit.
async function packageJson(r: Repo): Promise<any | null> {
  const hit = manifests.get(r.full_name)
  if (hit && hit.pushedAt === r.pushed_at) return hit.pkg
  const res = await fetch(`https://raw.githubusercontent.com/${r.full_name}/${r.default_branch}/package.json`, { headers: { 'user-agent': 'farline' }, signal: AbortSignal.timeout(15_000) }).catch(() => null)
  let pkg: any = null
  if (res?.ok) pkg = await res.json().catch(() => null)
  manifests.set(r.full_name, { pushedAt: r.pushed_at, pkg })
  return pkg
}

function authorName(a: unknown): string | undefined {
  if (typeof a === 'string') return a.replace(/\s*[<(].*$/, '').trim() || undefined
  if (a && typeof a === 'object' && typeof (a as any).name === 'string') return (a as any).name
  return undefined
}

export async function marketPlugins(refresh = false): Promise<MarketPlugin[]> {
  if (refresh) cached = null
  const repos = await searchRepos()
  const installed = listPlugins()
  const out = await Promise.all(
    repos.map(async (r): Promise<MarketPlugin | null> => {
      const pkg = await packageJson(r)
      const f = pkg?.farline
      if (!f || typeof f !== 'object' || typeof f.id !== 'string') return null
      const engines = typeof pkg.engines?.farline === 'string' ? pkg.engines.farline : undefined
      const apiVersion = typeof f.apiVersion === 'number' ? f.apiVersion : 1
      const compatible = apiVersion === API_VERSION && (!engines || satisfies(FARLINE_VERSION, engines))
      const mine = installed.find((p) => p.id === f.id)
      return {
        id: f.id,
        name: f.name || f.id,
        description: f.description || pkg.description || r.description || '',
        author: authorName(pkg.author) ?? r.owner.login,
        version: typeof pkg.version === 'string' ? pkg.version : '',
        repo: r.full_name,
        url: r.html_url,
        stars: r.stargazers_count,
        updatedAt: Date.parse(r.pushed_at),
        skin: f.skin === true,
        engines,
        apiVersion,
        compatible,
        installed: mine ? { version: mine.version, fromHere: mine.remote?.repo === r.full_name } : undefined,
      }
    }),
  )
  return out.filter((x) => !!x)
}
