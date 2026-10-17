// Notifications to a WeCom (企业微信) group robot webhook.
import type { PluginDefinition } from '../../server/src/plugins/types.ts'

const L = (en: string, zh: string) => ({ en, 'zh-CN': zh })

const WEBHOOK = /^https:\/\/qyapi\.weixin\.qq\.com\/cgi-bin\/webhook\/send\?key=[\w-]+$/

export default {
  settings: [{ key: 'webhook', label: L('Webhook URL', 'Webhook 地址'), type: 'secret', placeholder: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=…' }],

  validateSettings(v, i18n) {
    if (v.webhook && !WEBHOOK.test(String(v.webhook))) throw new Error(i18n.t(L("That isn't a WeCom robot webhook URL", 'Webhook 地址不对')))
  },

  status(ctx) {
    return ctx.settings.get().webhook ? {} : { summary: L('Not set', '未设置') }
  },

  activate(ctx) {
    ctx.notifications.register({
      id: 'wecom',
      label: L('WeCom', '企业微信'),
      async send(n) {
        const webhook = String(ctx.settings.get().webhook ?? '')
        if (!webhook) {
          if (n.kind === 'test') throw new Error(ctx.t(L('Set the webhook URL first', '先填 Webhook 地址')))
          return
        }
        const link = /^https?:/.test(n.url) ? `\n[${ctx.t(L('Open', '打开'))}](${n.url})` : ''
        const res = await fetch(webhook, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ msgtype: 'markdown', markdown: { content: `**${n.title}**\n${n.body}${link}` } }),
          signal: AbortSignal.timeout(8000),
        })
        const data = (await res.json().catch(() => ({}))) as { errcode?: number; errmsg?: string }
        if (!res.ok || data.errcode) throw new Error(ctx.t(L(`WeCom returned ${data.errmsg ?? res.status}`, `企业微信返回 ${data.errmsg ?? res.status}`)))
      },
    })
  },
} satisfies PluginDefinition
