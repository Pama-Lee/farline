import { useState } from 'react'
import { Spinner } from '../components/bits.tsx'
import { api } from '../lib/api.ts'

export function Login({ onDone }: { onDone: () => void }) {
  const [pw, setPw] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <div className="screen login">
      <img src="/icons/icon-192.png" alt="" />
      <form
        onSubmit={async (e) => {
          e.preventDefault()
          if (!pw || busy) return
          setBusy(true)
          setErr('')
          try {
            await api.login(pw)
            onDone()
          } catch (e: any) {
            setErr(e.message)
          } finally {
            setBusy(false)
          }
        }}
      >
        <input type="password" autoComplete="current-password" placeholder="密码" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus />
        <button className="black-pill" style={{ justifyContent: 'center' }} disabled={!pw || busy}>
          {busy ? <Spinner size={20} /> : '登录'}
        </button>
        <div className="err">{err}</div>
      </form>
    </div>
  )
}
