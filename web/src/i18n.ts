// The page's language: chosen in Settings, or picked from the browser.
import { useSyncExternalStore } from 'react'
import { hasMessage, isLocale, localize, pickLocale, translate, type LocalizedText, type Locale, type MessageKey } from '../../shared/i18n/index.ts'

export type { Locale, MessageKey }
export type LangPref = 'auto' | Locale

const KEY = 'farline.lang'
const listeners = new Set<() => void>()

export function langPref(): LangPref {
  const v = localStorage.getItem(KEY)
  return isLocale(v) ? v : 'auto'
}

function resolve(): Locale {
  const p = langPref()
  return p === 'auto' ? pickLocale(navigator.languages?.length ? navigator.languages : [navigator.language]) : p
}

let current = resolve()
// Bumped on every change, so a new choice of "Auto" re-renders too.
let version = 0
document.documentElement.lang = current

export function locale(): Locale {
  return current
}

export function setLangPref(p: LangPref) {
  if (p === 'auto') localStorage.removeItem(KEY)
  else localStorage.setItem(KEY, p)
  current = resolve()
  document.documentElement.lang = current
  version++
  for (const fn of listeners) fn()
}

export function t(key: MessageKey, vars?: Record<string, unknown>): string {
  return translate(current, key, vars as any)
}

// Plugin text that may come in several languages.
export function tx(text: LocalizedText | undefined): string {
  return localize(text, current)
}

// Re-render when the language changes.
export function useLocale(): Locale {
  useSyncExternalStore(
    (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    () => `${current}:${version}`,
  )
  return current
}

// A label lookup like { low: 'Low', … } that reads the current language:
// labelMap('effort.') answers EFFORT['high'] with t('effort.high').
export function labelMap<K extends string>(prefix: string, fixed: Record<string, string> = {}): Record<K, string> {
  return new Proxy({} as Record<K, string>, {
    get: (_, k) => {
      if (typeof k !== 'string') return undefined
      if (k in fixed) return fixed[k]
      const key = prefix + k
      return hasMessage(key) ? t(key) : undefined
    },
  })
}
