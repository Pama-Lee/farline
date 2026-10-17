import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import webpush from 'web-push'
import { config } from './config.ts'
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

export async function notify(title: string, body: string, url: string) {
  const payload = JSON.stringify({ title, body, url })
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
