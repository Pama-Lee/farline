// DeepSeek through its Anthropic-compatible API.
import type { PluginDefinition } from '../../server/src/plugins/types.ts'

const BASE = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com'
const CURRENCY: Record<string, string> = { CNY: '¥', USD: '$' }

const MODELS = [
  { value: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro', desc: '推理和编码更强' },
  { value: 'deepseek-flash', label: 'DeepSeek V4.1 Flash', desc: '响应更快，更省' },
]

class KeyError extends Error {}

async function balance(key: string) {
  const res = await fetch(`${BASE}/user/balance`, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(8000) }).catch(() => {
    throw new Error('连不上 DeepSeek')
  })
  if (res.status === 401) throw new KeyError('API key 无效')
  if (!res.ok) throw new Error(`DeepSeek 返回 ${res.status}`)
  const data = (await res.json()) as { is_available: boolean; balance_infos: { currency: string; total_balance: string }[] }
  return { available: data.is_available, text: data.balance_infos.map((b) => `${CURRENCY[b.currency] ?? `${b.currency} `}${b.total_balance}`).join(' / ') }
}

export default {
  settings: [{ key: 'apiKey', label: 'API key', type: 'secret', placeholder: 'sk-…', env: 'DEEPSEEK_API_KEY' }],
  links: [
    { label: '创建 API key', url: 'https://platform.deepseek.com/api_keys' },
    { label: '充值', url: 'https://platform.deepseek.com/top_up' },
  ],

  async validateSettings(values) {
    const key = String(values.apiKey ?? '')
    if (!key) return
    if (!/^[\x21-\x7e]{8,200}$/.test(key)) throw new Error('API key 格式不对')
    await balance(key)
  },

  async status(ctx) {
    const key = String(ctx.settings.get().apiKey ?? '')
    if (!key) return { summary: '未设置' }
    try {
      const b = await balance(key)
      const tone = b.available ? undefined : ('danger' as const)
      return { summary: b.text, tone, rows: [{ label: '余额', value: b.text, tone }] }
    } catch (e) {
      if (e instanceof KeyError) return { summary: 'API key 无效', tone: 'danger' }
      return { rows: [{ label: '余额', value: '查询失败' }] }
    }
  },

  activate(ctx) {
    const key = () => String(ctx.settings.get().apiKey ?? '')
    ctx.providers.register({
      id: 'deepseek',
      label: 'DeepSeek',
      available: () => !!key(),
      models: () => MODELS,
      classifierModels: ['deepseek-flash', 'deepseek-v4-pro'],
      // DeepSeek sessions run with every permission open unless told otherwise.
      defaultPermissionMode: 'bypassPermissions',
      env: ({ model, classifierModel }) =>
        ctx.helpers.anthropicCompatible({
          baseUrl: `${BASE}/anthropic`,
          token: key(),
          model,
          smallModel: 'deepseek-flash',
          classifierModel,
          // V4 Pro and V4.1 Flash both take 1M tokens.
          contextWindow: 1_000_000,
        }),
    })
  },
} satisfies PluginDefinition
