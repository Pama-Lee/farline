// The language of the request being handled. Pages send it as
// x-farline-lang; work with no request behind it (notifications from a
// running session) uses the language the owner last used, then FARLINE_LANG.
import { AsyncLocalStorage } from 'node:async_hooks'
import type { Context, Next } from 'hono'
import { isLocale, localize, pickLocale, translate, type LocalizedText, type Locale, type MessageKey } from '../../shared/i18n/index.ts'
import { save, state } from './store.ts'

const als = new AsyncLocalStorage<Locale>()

function fallback(): Locale {
  const saved = state.prefs.lang
  if (isLocale(saved)) return saved
  return pickLocale([process.env.FARLINE_LANG])
}

export function currentLocale(): Locale {
  return als.getStore() ?? fallback()
}

export function t(key: MessageKey, vars?: Record<string, unknown>): string {
  return translate(currentLocale(), key, vars as any)
}

export function tx(text: LocalizedText | undefined): string {
  return localize(text, currentLocale())
}

export function withLocale<T>(locale: Locale, fn: () => T): T {
  return als.run(locale, fn)
}

export async function localeMiddleware(c: Context, next: Next) {
  const sent = c.req.header('x-farline-lang')
  const locale = isLocale(sent) ? sent : pickLocale((c.req.header('accept-language') ?? '').split(',').map((s) => s.split(';')[0]))
  if (isLocale(sent) && state.prefs.lang !== sent) {
    state.prefs.lang = sent
    save()
  }
  await als.run(locale, next)
}
