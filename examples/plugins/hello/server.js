// Example plugin: a hook, a setting and an HTTP route for its browser half.
// Copy this directory to ~/.farline/plugins/hello and restart Farline.

/** @type {import('../../../server/src/plugins/types.ts').PluginDefinition} */
export default {
  settings: [{ key: 'greeting', label: '问候语', type: 'text', placeholder: '你好' }],

  activate(ctx) {
    let turns = 0
    ctx.hooks.on('turn.completed', ({ session, error }) => {
      turns++
      ctx.log(`${session.title || session.id}: turn ${error ? 'failed' : 'done'}`)
    })
    ctx.http.get('/stats', (c) => c.json({ turns, greeting: ctx.settings.get().greeting || '你好' }))
  },
}
