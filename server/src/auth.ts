import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
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

export function setPassword(password: string) {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, 32).toString('hex')
  writeFileSync(authFile, JSON.stringify({ salt, hash }), { mode: 0o600 })
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
