import { locale, t } from '../i18n.ts'

export function relTime(ms: number): string {
  const d = Date.now() - ms
  if (d < 60_000) return t('time.justNow')
  const rtf = new Intl.RelativeTimeFormat(locale(), { numeric: 'auto' })
  if (d < 3600_000) return rtf.format(-Math.floor(d / 60_000), 'minute')
  if (d < 86400_000) return rtf.format(-Math.floor(d / 3600_000), 'hour')
  const days = Math.floor(d / 86400_000)
  if (days < 7) return rtf.format(-days, 'day')
  return new Intl.DateTimeFormat(locale(), { month: 'short', day: 'numeric' }).format(ms)
}

export function basename(p: string): string {
  if (!p) return ''
  const parts = p.replace(/\/+$/, '').split('/')
  return parts[parts.length - 1] || '/'
}

export function shortPath(p: string): string {
  return p.replace(/^\/home\/[^/]+/, '~')
}

export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    const ta = document.createElement('textarea')
    ta.value = text
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    ta.remove()
  }
}
