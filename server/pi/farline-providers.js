// Loaded into pi by Farline (pi -e). Registers the model providers set up in
// Farline (DeepSeek, custom Anthropic-compatible APIs) so pi sessions can use
// them. Farline passes them in FARLINE_PI_PROVIDERS; each key travels in its
// own environment variable, named by apiKey.
//
// Also registers the tools Farline plugins give the agent (FARLINE_PI_TOOLS).
// They do their work in Farline, which watches pi's tool calls; here they
// only answer so the turn goes on.
import { Type } from 'typebox'

export default function (pi) {
  let tools = []
  try {
    tools = JSON.parse(process.env.FARLINE_PI_TOOLS || '[]')
  } catch {}
  for (const t of tools) {
    const props = {}
    for (const [k, p] of Object.entries(t.params)) {
      const opts = p.description ? { description: p.description } : {}
      let s = p.type === 'number' ? Type.Number(opts) : p.type === 'boolean' ? Type.Boolean(opts) : Type.String(p.enum ? { ...opts, enum: p.enum } : opts)
      props[k] = p.optional ? Type.Optional(s) : s
    }
    pi.registerTool({
      name: t.name,
      label: t.name,
      description: t.description,
      parameters: Type.Object(props),
      async execute() {
        return { content: [{ type: 'text', text: 'ok' }], details: {} }
      },
    })
  }

  let list = []
  try {
    list = JSON.parse(process.env.FARLINE_PI_PROVIDERS || '[]')
  } catch {}
  for (const p of list) {
    pi.registerProvider(p.id, {
      name: p.name,
      baseUrl: p.baseUrl,
      apiKey: p.apiKey,
      api: 'anthropic-messages',
      models: p.models.map((m) => ({
        id: m.id,
        name: m.name || m.id,
        reasoning: m.reasoning ?? false,
        input: ['text', 'image'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: m.contextWindow || 200000,
        maxTokens: 32000,
      })),
    })
  }
}
