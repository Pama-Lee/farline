import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import webpush from 'web-push'
import { config } from './config.ts'
import { absoluteUrl } from './origin.ts'
import { allChannels } from './plugins/registry.ts'
import type { Notification } from './plugins/types.ts'
import { save, state, type PushSub } from './store.ts'

const keyFile = join(config.dataDir, 'vapid.json')
if (!existsSync(keyFile)) writeFileSync(keyFile, JSON.stringify(webpush.generateVAPIDKeys()), { mode: 0o600 })
const keys: { publicKey: string; privateKey: string } = JSON.parse(readFileSync(keyFile, 'utf8'))
webpush.setVapidDetails(config.vapidSubject, keys.publicKey, keys.privateKey)

export const vapidPublicKey = keys.publicKey

export function subscribe(sub: PushSub) {
  state.pushSubs = state.pushSubs.filter((s) => s.endpoint !== sub.endpoint)
  state.pushSubs.push(sub)
  save()
}

export function unsubscribe(endpoint: string) {
  state.pushSubs = state.pushSubs.filter((s) => s.endpoint !== endpoint)
  save()
}

export async function notify(n: Notification) {
  await Promise.all([webPush(n), ...allChannels().map((ch) => sendTo(ch, n))])
}

export async function sendTo(ch: { label: string; send(n: Notification): Promise<void> }, n: Notification) {
  try {
    await ch.send({ ...n, url: absoluteUrl(n.url) })
  } catch (err: any) {
    console.error(`notification via ${ch.label} failed:`, err?.message ?? err)
    if (n.kind === 'test') throw err
  }
}

async function webPush(n: Notification) {
  const payload = JSON.stringify({ title: n.title, body: n.body, url: n.url })
  await Promise.all(
    state.pushSubs.map(async (sub) => {
      try {
        await webpush.sendNotification(sub, payload, { TTL: 3600, urgency: 'high' })
      } catch (err: any) {
        if (err?.statusCode === 404 || err?.statusCode === 410) unsubscribe(sub.endpoint)
        else console.error('push failed', err?.statusCode, err?.body ?? err?.message)
      }
    }),
  )
}
