// Phone-specific glue: keyboard-aware viewport, image downscaling, web push.
import { api } from './api.ts'

// The app shell (#root) always covers exactly the visible area: when the iOS
// keyboard opens, the visual viewport shrinks (and may shift down inside the
// layout viewport), so the shell follows both its height and its offset and
// the composer, pinned to the shell's bottom, sits right above the keyboard.
// Sheets are fixed to the layout viewport, so they lift by --kb instead.
export function trackViewport() {
  const vv = window.visualViewport
  const root = document.documentElement
  // Some iOS versions shrink innerHeight along with the keyboard, so compare
  // against the tallest viewport seen in this orientation instead.
  let fullH = 0
  const update = () => {
    const h = vv ? vv.height : window.innerHeight
    const top = vv ? vv.offsetTop : 0
    fullH = Math.max(fullH, h, window.innerHeight)
    root.style.setProperty('--app-h', `${h}px`)
    root.style.setProperty('--app-top', `${top}px`)
    root.style.setProperty('--kb', `${Math.max(0, window.innerHeight - h - top)}px`)
    root.classList.toggle('keyboard-open', fullH - h > 120)
  }
  update()
  vv?.addEventListener('resize', update)
  vv?.addEventListener('scroll', update)
  window.addEventListener('resize', update)
  window.addEventListener('orientationchange', () => {
    fullH = 0
    setTimeout(update, 300)
  })
}

export async function downscaleImage(file: File, max = 2048, quality = 0.85): Promise<{ blob: Blob; name: string }> {
  if (!file.type.startsWith('image/') || file.type === 'image/gif') return { blob: file, name: file.name }
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height))
    if (scale === 1 && file.size < 1.5 * 1024 * 1024 && file.type !== 'image/heic') return { blob: file, name: file.name }
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('encode failed'))), 'image/jpeg', quality))
    return { blob, name: file.name.replace(/\.\w+$/, '') + '.jpg' }
  } catch {
    return { blob: file, name: file.name }
  }
}

export function pushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

export async function currentPushSubscription() {
  if (!pushSupported()) return null
  const reg = await navigator.serviceWorker.ready
  return reg.pushManager.getSubscription()
}

function b64ToBytes(b64: string) {
  const s = atob((b64 + '='.repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(s, (c) => c.charCodeAt(0))
}

export async function enablePush(): Promise<boolean> {
  if (!pushSupported()) return false
  const perm = await Notification.requestPermission()
  if (perm !== 'granted') return false
  const reg = await navigator.serviceWorker.ready
  const { key } = await api.pushKey()
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(key) }))
  await api.pushSubscribe(sub.toJSON())
  return true
}

export async function disablePush() {
  const sub = await currentPushSubscription()
  if (!sub) return
  await api.pushUnsubscribe(sub.endpoint).catch(() => undefined)
  await sub.unsubscribe()
}

export function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true
}
