// DeepSeek through its Anthropic-compatible API.
import type { Localizer, PluginDefinition } from '../../server/src/plugins/types.ts'

const L = (en: string, zh: string) => ({ en, 'zh-CN': zh })

const BASE = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com'
const CURRENCY: Record<string, string> = { CNY: '¥', USD: '$' }

const MODELS = [
  { value: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro', desc: L('Stronger at reasoning and code', '推理和编码更强') },
  { value: 'deepseek-flash', label: 'DeepSeek V4.1 Flash', desc: L('Faster and cheaper', '响应更快，更省') },
]

class KeyError extends Error {}

const INVALID_KEY = L('Invalid API key', 'API key 无效')

async function balance(key: string, i18n: Localizer) {
  const res = await fetch(`${BASE}/user/balance`, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(8000) }).catch(() => {
    throw new Error(i18n.t(L("Can't reach DeepSeek", '连不上 DeepSeek')))
  })
  if (res.status === 401) throw new KeyError(i18n.t(INVALID_KEY))
  if (!res.ok) throw new Error(i18n.t(L(`DeepSeek returned ${res.status}`, `DeepSeek 返回 ${res.status}`)))
  const data = (await res.json()) as { is_available: boolean; balance_infos: { currency: string; total_balance: string }[] }
  return { available: data.is_available, text: data.balance_infos.map((b) => `${CURRENCY[b.currency] ?? `${b.currency} `}${b.total_balance}`).join(' / ') }
}

export default {
  settings: [{ key: 'apiKey', label: 'API key', type: 'secret', placeholder: 'sk-…', env: 'DEEPSEEK_API_KEY' }],
  links: [
    { label: L('Create an API key', '创建 API key'), url: 'https://platform.deepseek.com/api_keys' },
    { label: L('Top up', '充值'), url: 'https://platform.deepseek.com/top_up' },
  ],

  async validateSettings(values, i18n) {
    const key = String(values.apiKey ?? '')
    if (!key) return
    if (!/^[\x21-\x7e]{8,200}$/.test(key)) throw new Error(i18n.t(L("That doesn't look like an API key", 'API key 格式不对')))
    await balance(key, i18n)
  },

  async status(ctx) {
    const key = String(ctx.settings.get().apiKey ?? '')
    if (!key) return { summary: L('Not set', '未设置') }
    const label = L('Balance', '余额')
    try {
      const b = await balance(key, ctx)
      const tone = b.available ? undefined : ('danger' as const)
      return { summary: b.text, tone, rows: [{ label, value: b.text, tone }] }
    } catch (e) {
      if (e instanceof KeyError) return { summary: INVALID_KEY, tone: 'danger' }
      return { rows: [{ label, value: L("Couldn't check", '查询失败') }] }
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
