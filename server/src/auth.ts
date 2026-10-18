import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Context, Next } from 'hono'
import { getCookie, setCookie } from 'hono/cookie'
import { config } from './config.ts'
import { t } from './i18n.ts'

const COOKIE = 'farline'
const MAX_AGE_S = 180 * 24 * 3600

const secretFile = join(config.dataDir, 'secret')
if (!existsSync(secretFile)) writeFileSync(secretFile, randomBytes(32).toString('hex'), { mode: 0o600 })
const secret = readFileSync(secretFile, 'utf8').trim()

const authFile = join(config.dataDir, 'auth.json')

export const MIN_PASSWORD = 8

export function setPassword(password: string) {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, 32).toString('hex')
  writeFileSync(authFile, JSON.stringify({ salt, hash }), { mode: 0o600 })
  rmSync(setupFile, { force: true })
}

// ---- first run ----
// Until a password is set, the browser can set one with a one-time code
// that only the person who started Farline can see (terminal or log, and
// <dataDir>/setup-code).

const setupFile = join(config.dataDir, 'setup-code')

export function needsSetup() {
  return !existsSync(authFile)
}

export function setupCode(): string | undefined {
  if (!needsSetup()) return undefined
  if (!existsSync(setupFile)) {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
    const code = Array.from(randomBytes(8), (b) => alphabet[b % alphabet.length]).join('')
    writeFileSync(setupFile, `${code.slice(0, 4)}-${code.slice(4)}\n`, { mode: 0o600 })
  }
  return readFileSync(setupFile, 'utf8').trim()
}

export async function setup(c: Context) {
  const ip = clientIp(c)
  if (limited(`setup:${ip}`, 8) || limited('setup', 40)) return c.json({ error: t('auth.tooMany') }, 429)
  if (!needsSetup()) return c.json({ error: t('setup.done') }, 409)
  const { code, password } = await c.req.json<{ code?: string; password?: string }>().catch(() => ({}) as { code?: string; password?: string })
  const want = Buffer.from((setupCode() ?? '').replace(/-/g, '').toUpperCase())
  const got = Buffer.from(String(code ?? '').replace(/[-\s]/g, '').toUpperCase())
  if (got.length !== want.length || !timingSafeEqual(got, want)) return c.json({ error: t('setup.badCode') }, 401)
  if (typeof password !== 'string' || password.length < MIN_PASSWORD) return c.json({ error: t('setup.shortPassword', { n: MIN_PASSWORD }) }, 400)
  setPassword(password)
  setCookie(c, COOKIE, issue(), { httpOnly: true, secure: !config.insecureCookie, sameSite: 'Lax', path: '/', maxAge: MAX_AGE_S })
  return c.json({ ok: true })
}

function checkPassword(password: string): boolean {
  if (!existsSync(authFile)) return false
  const { salt, hash } = JSON.parse(readFileSync(authFile, 'utf8'))
  const got = scryptSync(password, salt, 32)
  return timingSafeEqual(got, Buffer.from(hash, 'hex'))
}

function sign(payload: string) {
  return createHmac('sha256', secret).update(payload).digest('base64url')
}

function issue(): string {
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + MAX_AGE_S * 1000 })).toString('base64url')
  return `${payload}.${sign(payload)}`
}

function valid(token: string | undefined): boolean {
  if (!token) return false
  const [payload, sig] = token.split('.')
  if (!payload || !sig) return false
  const expected = Buffer.from(sign(payload))
  const actual = Buffer.from(sig)
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return false
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString()).exp > Date.now()
  } catch {
    return false
  }
}

// Fixed-window limiter: login is the only unauthenticated write.
const attempts = new Map<string, { n: number; reset: number }>()
function limited(key: string, max: number): boolean {
  const now = Date.now()
  const a = attempts.get(key)
  if (!a || a.reset < now) {
    attempts.set(key, { n: 1, reset: now + 10 * 60_000 })
    return false
  }
  a.n++
  return a.n > max
}

export function clientIp(c: Context): string {
  return c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local'
}

export async function login(c: Context) {
  const ip = clientIp(c)
  if (limited(`ip:${ip}`, 8) || limited('global', 40)) return c.json({ error: t('auth.tooMany') }, 429)
  const { password } = await c.req.json<{ password?: string }>().catch(() => ({ password: undefined }))
  if (typeof password !== 'string' || !checkPassword(password)) return c.json({ error: t('auth.wrongPassword') }, 401)
  setCookie(c, COOKIE, issue(), {
    httpOnly: true,
    secure: !config.insecureCookie,
    sameSite: 'Lax',
    path: '/',
    maxAge: MAX_AGE_S,
  })
  return c.json({ ok: true })
}

export function logout(c: Context) {
  setCookie(c, COOKIE, '', { path: '/', maxAge: 0, secure: !config.insecureCookie, httpOnly: true, sameSite: 'Lax' })
  return c.json({ ok: true })
}

export function isAuthed(c: Context): boolean {
  return valid(getCookie(c, COOKIE))
}

export async function requireAuth(c: Context, next: Next) {
  if (!isAuthed(c)) return c.json({ error: 'unauthorized' }, 401)
  // Mutations must come from our own fetch() calls, not cross-site forms.
  if (c.req.method !== 'GET' && c.req.header('x-farline') !== '1') return c.json({ error: 'forbidden' }, 403)
  await next()
}
