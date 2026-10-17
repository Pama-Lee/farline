import { useState } from 'react'
import { Spinner } from '../components/bits.tsx'
import { api } from '../lib/api.ts'
import { t } from '../i18n.ts'

export function Login({ onDone }: { onDone: () => void }) {
  const [pw, setPw] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <div className="screen login">
      <img src="/icons/icon-192.png" alt="" />
      <div className="login-name">Farline</div>
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
        <input type="password" autoComplete="current-password" placeholder={t('login.password')} value={pw} onChange={(e) => setPw(e.target.value)} autoFocus />
        <button className="black-pill" style={{ justifyContent: 'center' }} disabled={!pw || busy}>
          {busy ? <Spinner size={20} /> : t('login.signIn')}
        </button>
        <div className="err">{err}</div>
      </form>
    </div>
  )
}
