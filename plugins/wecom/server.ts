// Notifications to a WeCom group robot (群机器人 webhook).
import type { PluginDefinition } from '../../server/src/plugins/types.ts'

const WEBHOOK = /^https:\/\/qyapi\.weixin\.qq\.com\/cgi-bin\/webhook\/send\?key=[\w-]+$/

export default {
  settings: [{ key: 'webhook', label: 'Webhook 地址', type: 'secret', placeholder: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=…' }],

  validateSettings(v) {
    if (v.webhook && !WEBHOOK.test(String(v.webhook))) throw new Error('Webhook 地址不对')
  },

  status(ctx) {
    return ctx.settings.get().webhook ? {} : { summary: '未设置' }
  },

  activate(ctx) {
    ctx.notifications.register({
      id: 'wecom',
      label: '企业微信',
      async send(n) {
        const webhook = String(ctx.settings.get().webhook ?? '')
        if (!webhook) {
          if (n.kind === 'test') throw new Error('先填 Webhook 地址')
          return
        }
        const link = /^https?:/.test(n.url) ? `\n[打开](${n.url})` : ''
        const res = await fetch(webhook, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ msgtype: 'markdown', markdown: { content: `**${n.title}**\n${n.body}${link}` } }),
          signal: AbortSignal.timeout(8000),
        })
        const data = (await res.json().catch(() => ({}))) as { errcode?: number; errmsg?: string }
        if (!res.ok || data.errcode) throw new Error(`企业微信返回 ${data.errmsg ?? res.status}`)
      },
    })
  },
} satisfies PluginDefinition
