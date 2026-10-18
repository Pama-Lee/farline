// Emoji reactions, like in a chat app. The agent gets a react tool for the
// user's latest message; a reaction alone is a fine answer to "thanks" or
// "done". The picker for the user's own reactions is part of the page.
import type { PluginDefinition } from '../../server/src/plugins/types.ts'

const INSTRUCTIONS = `You can put an emoji reaction on the user's latest message with the react tool (mcp__farline__react, or farline_react), the way a person would in a chat app: 👍 to acknowledge, ❤️ for thanks, 🎉 for good news, 👀 when you start looking into something, 🚀 when something ships.

When the message only needs an acknowledgement (thanks, ok, "logged in", "done", "got it"), the reaction is your whole answer: react, then end your turn without writing any text. Don't add "you're welcome" or a summary.

Otherwise react only when it adds something, then carry on with the work as usual. Don't react to every message.`

export default {
  activate(ctx) {
    ctx.agentTools.register({
      name: 'react',
      description: "Put an emoji reaction on the user's latest message. A new reaction replaces your previous one on that message.",
      params: { emoji: { type: 'string', description: 'One emoji, e.g. 👍' } },
      hidden: true,
      instructions: INSTRUCTIONS,
      async run(args, call) {
        const emoji = String(args.emoji ?? '').trim()
        if (!emoji || !call.lastUserMessageId) return 'Nothing to react to.'
        await ctx.sessions.react(call.session.id, call.lastUserMessageId, emoji)
        return 'Reacted. If the message only needed an acknowledgement, end your turn now without writing any text.'
      },
    })
  },
} satisfies PluginDefinition
