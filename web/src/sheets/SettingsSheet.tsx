import { ArrowUpRight, Bell, KeyRound, LogOut } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { DeepSeekStatus } from '../../../shared/types.ts'
import { Sheet } from '../components/Sheet.tsx'
import { Spinner, toast } from '../components/bits.tsx'
import { MODELS_CHANGED, api } from '../lib/api.ts'
import { currentPushSubscription, disablePush, enablePush, isStandalone, pushSupported } from '../lib/device.ts'

const PLATFORM = 'https://platform.deepseek.com'
const CURRENCY: Record<string, string> = { CNY: '¥', USD: '$' }

function balanceText(s: DeepSeekStatus | null): string {
  if (!s) return ''
  if (!s.source) return '未设置'
  if (s.invalid) return 'API key 无效'
  return s.balance?.balances.map((b) => `${CURRENCY[b.currency] ?? `${b.currency} `}${b.total}`).join(' / ') ?? ''
}

export function SettingsSheet({ onClose, onLogout }: { onClose: () => void; onLogout: () => void }) {
  const [push, setPush] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [view, setView] = useState<'main' | 'deepseek'>('main')
  const [deepseek, setDeepseek] = useState<DeepSeekStatus | null>(null)

  useEffect(() => {
    currentPushSubscription().then((s) => setPush(!!s), () => setPush(false))
    api.deepseek().then(setDeepseek, () => undefined)
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

  if (view === 'deepseek')
    return (
      <Sheet title="DeepSeek" onClose={onClose} onBack={() => setView('main')}>
        <DeepSeekSettings
          status={deepseek}
          onChange={(s) => {
            setDeepseek(s)
            window.dispatchEvent(new Event(MODELS_CHANGED))
          }}
        />
      </Sheet>
    )

  return (
    <Sheet title="设置" onClose={onClose}>
      <button className="row-btn" onClick={togglePush}>
        <Bell size={19} strokeWidth={1.6} />
        <span className="grow">通知</span>
        <span className={`switch${push ? ' on' : ''}`} />
      </button>
      <button className="row-btn" onClick={() => setView('deepseek')}>
        <KeyRound size={19} strokeWidth={1.6} />
        <span className="grow">DeepSeek</span>
        <span className="value">{balanceText(deepseek)}</span>
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

function DeepSeekSettings({ status, onChange }: { status: DeepSeekStatus | null; onChange: (s: DeepSeekStatus) => void }) {
  const [editing, setEditing] = useState(false)
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  if (!status)
    return (
      <div className="empty">
        <Spinner />
      </div>
    )

  const entering = editing || !status.source || status.invalid

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!key.trim() || busy) return
    setBusy(true)
    setErr('')
    try {
      onChange(await api.setDeepseekKey(key))
      setKey('')
      setEditing(false)
    } catch (e: any) {
      setErr(e?.message ?? '保存失败')
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (busy || !confirm('确认移除 API key？')) return
    setBusy(true)
    try {
      onChange(await api.clearDeepseekKey())
    } catch (e: any) {
      toast(e?.message ?? '移除失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {status.source && (
        <div className="group">
          <div className="option">
            <span className="grow">API key</span>
            <span className="hint mono">{status.hint}</span>
          </div>
          <div className="option">
            <span className="grow">余额</span>
            <span className={`hint${status.invalid || status.balance?.available === false ? ' danger' : ''}`}>{balanceText(status)}</span>
          </div>
        </div>
      )}

      {entering && (
        <form className="key-form" onSubmit={save}>
          <input
            className="path-input"
            type="password"
            name="deepseek-api-key"
            autoComplete="off"
            spellCheck={false}
            placeholder="sk-…"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            autoFocus={!status.source}
          />
          <button className="black-pill wide" disabled={!key.trim() || busy}>
            {busy ? <Spinner size={20} /> : '保存'}
          </button>
          {err && <div className="err">{err}</div>}
        </form>
      )}

      <div className="group link-group">
        {entering && (
          <a className="option" href={`${PLATFORM}/api_keys`} target="_blank" rel="noreferrer">
            <span className="grow">创建 API key</span>
            <ArrowUpRight size={18} color="var(--text-2)" />
          </a>
        )}
        {status.source && (
          <a className="option" href={`${PLATFORM}/top_up`} target="_blank" rel="noreferrer">
            <span className="grow">充值</span>
            <ArrowUpRight size={18} color="var(--text-2)" />
          </a>
        )}
        {status.source && !entering && (
          <button className="option" onClick={() => setEditing(true)}>
            <span className="grow">更换 API key</span>
          </button>
        )}
        {status.source === 'saved' && (
          <button className="option" onClick={remove}>
            <span className="grow danger">移除 API key</span>
          </button>
        )}
      </div>
    </>
  )
}
