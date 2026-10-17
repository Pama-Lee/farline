// Links in notifications sent outside the browser need the public address.
// FARLINE_PUBLIC_URL wins; otherwise use the Origin the browser last sent.
import { config } from './config.ts'

let seen = ''

export function noteOrigin(origin: string | undefined) {
  if (origin && /^https?:\/\/[^/]+$/.test(origin)) seen = origin
}

export function absoluteUrl(path: string): string {
  const base = config.publicUrl || seen
  return base && path.startsWith('/') ? base.replace(/\/$/, '') + path : path
}
