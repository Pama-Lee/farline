// Just enough semver for "engines.farline" ranges: >=, >, <=, <, =, ^, ~,
// x wildcards, space for AND and || for OR.
import { existsSync, readFileSync } from 'node:fs'

// server/package.json from source; the package's own when bundled for npm.
function version(): string {
  for (const rel of ['../../package.json', '../package.json']) {
    const url = new URL(rel, import.meta.url)
    if (!existsSync(url)) continue
    const pkg = JSON.parse(readFileSync(url, 'utf8'))
    if (/^farline/.test(pkg.name ?? '')) return pkg.version
  }
  return '0.0.0'
}

export const FARLINE_VERSION: string = version()

type V = [number, number, number]

function parse(v: string): V | null {
  const m = v.trim().replace(/^v/, '').match(/^(\d+)(?:\.(\d+|[x*]))?(?:\.(\d+|[x*]))?/)
  if (!m) return null
  const n = (s?: string) => (s === undefined || s === 'x' || s === '*' ? 0 : Number(s))
  return [n(m[1]), n(m[2]), n(m[3])]
}

function cmp(a: V, b: V) {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2]
}

function satisfiesOne(v: V, c: string): boolean {
  const m = c.match(/^(>=|<=|>|<|=|\^|~)?\s*(.+)$/)
  if (!m) return false
  const [, op = '', raw] = m
  if (raw === '*' || raw === 'x') return true
  const t = parse(raw)
  if (!t) return false
  const parts = raw.replace(/^v/, '').split('.')
  const wild = parts.length < 3 || parts.some((p) => p === 'x' || p === '*')
  switch (op) {
    case '>=':
      return cmp(v, t) >= 0
    case '>':
      return cmp(v, t) > 0
    case '<=':
      return cmp(v, t) <= 0
    case '<':
      return cmp(v, t) < 0
    case '^':
      return cmp(v, t) >= 0 && (t[0] > 0 ? v[0] === t[0] : t[1] > 0 ? v[0] === 0 && v[1] === t[1] : v[0] === 0 && v[1] === 0 && v[2] === t[2])
    case '~':
      return cmp(v, t) >= 0 && v[0] === t[0] && v[1] === t[1]
    default:
      if (!wild) return cmp(v, t) === 0
      // 1 or 1.x: same major; 1.2 or 1.2.x: same major and minor.
      return v[0] === t[0] && (parts.length < 2 || parts[1] === 'x' || parts[1] === '*' || v[1] === t[1])
  }
}

export function satisfies(version: string, range: string): boolean {
  const v = parse(version)
  if (!v) return false
  return range.split('||').some((alt) => {
    const cs = alt.trim().replace(/(>=|<=|>|<|=|\^|~)\s+/g, '$1').split(/\s+/).filter(Boolean)
    return cs.length === 0 || cs.every((c) => satisfiesOne(v, c))
  })
}

