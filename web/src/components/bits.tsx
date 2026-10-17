import { LoaderCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { SessionStatus } from '../../../shared/types.ts'

export function Spinner({ size = 22 }: { size?: number }) {
  return <LoaderCircle size={size} strokeWidth={2} className="spin" />
}

export function StatusGlyph({ status }: { status: SessionStatus }) {
  if (status === 'running' || status === 'busy_elsewhere') return <Spinner size={15} />
  if (status === 'requires_action') return <span className="action-dot" />
  return <span className="idle-ring" />
}

let toastFn: ((msg: string) => void) | null = null

export function toast(msg: string) {
  toastFn?.(msg)
}

export function ToastHost() {
  const [msg, setMsg] = useState<string | null>(null)
  useEffect(() => {
    let t: number | undefined
    toastFn = (m) => {
      setMsg(m)
      clearTimeout(t)
      t = window.setTimeout(() => setMsg(null), 2200)
    }
    return () => {
      toastFn = null
    }
  }, [])
  return msg ? <div className="toast">{msg}</div> : null
}
