// Translations shared by the server and the web app. English is the source:
// every key lives in en.ts, and each other locale must cover all of them
// (the type checker enforces it). A message is a string with {name}
// placeholders, or a function when the wording depends on a number.
import { en } from './en.ts'
import { zhCN } from './zh-CN.ts'

export type Locale = 'en' | 'zh-CN'
export const LOCALES: { id: Locale; label: string }[] = [
  { id: 'en', label: 'English' },
  { id: 'zh-CN', label: '简体中文' },
]
export const DEFAULT_LOCALE: Locale = 'en'

export type MessageKey = keyof typeof en
type Vars = Record<string, string | number>
export type Message = string | ((v: any) => string)
export type Messages = { [K in MessageKey]: (typeof en)[K] extends string ? string : (v: any) => string }

const catalogs: Record<Locale, Messages> = { en, 'zh-CN': zhCN }

// The best locale we have for a list of preferences like navigator.languages
// or an Accept-Language header.
export function pickLocale(prefs: readonly (string | undefined | null)[]): Locale {
  for (const raw of prefs) {
    const p = raw?.trim().toLowerCase()
    if (!p) continue
    if (p === 'en' || p.startsWith('en-')) return 'en'
    if (p === 'zh' || p.startsWith('zh-')) return 'zh-CN'
  }
  return DEFAULT_LOCALE
}

export function isLocale(v: unknown): v is Locale {
  return v === 'en' || v === 'zh-CN'
}

export function hasMessage(key: string): key is MessageKey {
  return key in en
}

export function translate(locale: Locale, key: MessageKey, vars?: Vars): string {
  const msg: Message = catalogs[locale][key] ?? en[key]
  if (typeof msg === 'function') return msg(vars ?? {})
  return vars ? msg.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : msg
}

// Text a plugin gives in several languages: "Hi" or { en: "Hi", "zh-CN": "你好" }.
export type LocalizedText = string | Partial<Record<string, string>>

export function localize(text: LocalizedText | undefined, locale: Locale): string {
  if (text === undefined || text === null) return ''
  if (typeof text === 'string') return text
  const lang = locale.split('-')[0]
  const key = Object.keys(text).find((k) => k === locale) ?? Object.keys(text).find((k) => k.split('-')[0] === lang)
  return (key && text[key]) || text.en || Object.values(text).find((v) => !!v) || ''
}
