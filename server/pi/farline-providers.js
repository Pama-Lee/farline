// Loaded into pi by Farline (pi -e). Registers the model providers set up in
// Farline (DeepSeek, custom Anthropic-compatible APIs) so pi sessions can use
// them. Farline passes them in FARLINE_PI_PROVIDERS; each key travels in its
// own environment variable, named by apiKey.
export default function (pi) {
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
