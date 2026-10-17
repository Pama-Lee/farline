import { Bell, LogOut } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Sheet } from '../components/Sheet.tsx'
import { toast } from '../components/bits.tsx'
import { api } from '../lib/api.ts'
import { currentPushSubscription, disablePush, enablePush, isStandalone, pushSupported } from '../lib/device.ts'

export function SettingsSheet({ onClose, onLogout }: { onClose: () => void; onLogout: () => void }) {
  const [push, setPush] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    currentPushSubscription().then((s) => setPush(!!s), () => setPush(false))
  }, [])

  const togglePush = async () => {
    if (busy) return
    if (!pushSupported()) {
      toast(isStandalone() ? '这台设备不支持通知' : '先添加到主屏幕，再从主屏幕打开')
      return
    }
    setBusy(true)
    try {
      if (push) {
        await disablePush()
        setPush(false)
      } else {
        const ok = await enablePush()
        setPush(ok)
        if (ok) await api.pushTest()
        else toast('通知权限未开启')
      }
    } catch (e: any) {
      toast(e?.message ?? '操作失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet title="设置" onClose={onClose}>
      <button className="row-btn" onClick={togglePush}>
        <Bell size={19} strokeWidth={1.6} />
        <span className="grow">通知</span>
        <span className={`switch${push ? ' on' : ''}`} />
      </button>
      <button
        className="row-btn"
        onClick={async () => {
          await api.logout().catch(() => undefined)
          onLogout()
        }}
      >
        <LogOut size={19} strokeWidth={1.6} />
        <span className="grow">退出登录</span>
      </button>
    </Sheet>
  )
}
