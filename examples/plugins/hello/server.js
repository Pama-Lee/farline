// Example plugin: a hook, a setting and an HTTP route for its browser half.
// Copy this directory to ~/.farline/plugins/hello and restart Farline.
// Text people see can be one string or one per language.

/** @type {import('../../../server/src/plugins/types.ts').PluginDefinition} */
export default {
  settings: [{ key: 'greeting', label: { en: 'Greeting', 'zh-CN': '问候语' }, type: 'text', placeholder: { en: 'Hello', 'zh-CN': '你好' } }],

  activate(ctx) {
    let turns = 0
    ctx.hooks.on('turn.completed', ({ session, error }) => {
      turns++
      ctx.log(`${session.title || session.id}: turn ${error ? 'failed' : 'done'}`)
    })
    ctx.http.get('/stats', (c) => c.json({ turns, greeting: ctx.settings.get().greeting || ctx.t({ en: 'Hello', 'zh-CN': '你好' }) }))
  },
}
