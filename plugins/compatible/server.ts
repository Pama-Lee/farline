// Any Anthropic-compatible API: give it an address, a key and model ids.
import type { PluginDefinition } from '../../server/src/plugins/types.ts'

const list = (v: unknown) =>
  String(v ?? '')
    .split(/[\s,，]+/)
    .filter(Boolean)

export default {
  settings: [
    { key: 'name', label: '名称', type: 'text', placeholder: '兼容接口' },
    { key: 'baseUrl', label: '接口地址', type: 'text', placeholder: 'https://example.com/anthropic' },
    { key: 'apiKey', label: 'API key', type: 'secret' },
    { key: 'models', label: '模型', type: 'text', placeholder: 'model-a, model-b' },
    { key: 'contextWindow', label: '上下文长度', type: 'number', placeholder: '200000' },
  ],

  validateSettings(v) {
    if (v.baseUrl && !/^https?:\/\/[^\s]+$/.test(String(v.baseUrl))) throw new Error('接口地址要以 http:// 或 https:// 开头')
    if (v.contextWindow !== undefined && (Number(v.contextWindow) < 100_000 || Number(v.contextWindow) > 1_000_000)) {
      throw new Error('上下文长度要在 100000 到 1000000 之间')
    }
  },

  activate(ctx) {
    const s = () => ctx.settings.get()
    ctx.providers.register({
      id: 'compatible',
      get label() {
        return String(s().name || '兼容接口')
      },
      available: () => !!(s().baseUrl && s().apiKey && list(s().models).length),
      models: () => list(s().models).map((value) => ({ value, label: value })),
      env: ({ model }) => {
        const models = list(s().models)
        return ctx.helpers.anthropicCompatible({
          baseUrl: String(s().baseUrl).replace(/\/$/, ''),
          token: String(s().apiKey),
          model,
          smallModel: models[models.length - 1],
          contextWindow: s().contextWindow ? Number(s().contextWindow) : undefined,
        })
      },
    })
  },
} satisfies PluginDefinition
