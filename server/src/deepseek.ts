// DeepSeek API key: saved from the settings page, else DEEPSEEK_API_KEY.
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { config } from './config.ts'
import type { DeepSeekStatus } from '../../shared/types.ts'

const file = join(config.dataDir, 'deepseek.json')

function load(): string {
  try {
    return JSON.parse(readFileSync(file, 'utf8')).key ?? ''
  } catch {
    return ''
  }
}

let saved = load()

export function deepseekKey(): string {
  return saved || config.deepseekKey
}

export class KeyError extends Error {}

async function balance(key: string) {
  const res = await fetch(`${config.deepseekBase}/user/balance`, {
    headers: { authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(8000),
  }).catch(() => {
    throw new Error('连不上 DeepSeek')
  })
  if (res.status === 401) throw new KeyError('API key 无效')
  if (!res.ok) throw new Error(`DeepSeek 返回 ${res.status}`)
  const data = (await res.json()) as { is_available: boolean; balance_infos: { currency: string; total_balance: string }[] }
  return { available: data.is_available, balances: data.balance_infos.map((b) => ({ currency: b.currency, total: b.total_balance })) }
}

export async function status(): Promise<DeepSeekStatus> {
  const key = deepseekKey()
  if (!key) return { source: null }
  const base = { source: saved ? ('saved' as const) : ('env' as const), hint: `${key.slice(0, 3)}…${key.slice(-4)}` }
  try {
    return { ...base, balance: await balance(key) }
  } catch (e) {
    return { ...base, invalid: e instanceof KeyError }
  }
}

export async function saveKey(key: string) {
  key = key.trim()
  if (!/^[\x21-\x7e]{8,200}$/.test(key)) throw new KeyError('API key 格式不对')
  await balance(key)
  writeFileSync(file, JSON.stringify({ key }), { mode: 0o600 })
  saved = key
}

export function clearKey() {
  if (existsSync(file)) rmSync(file)
  saved = ''
}
