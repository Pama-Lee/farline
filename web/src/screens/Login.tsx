import { useState } from 'react'
import { Spinner } from '../components/bits.tsx'
import { api } from '../lib/api.ts'
import { t } from '../i18n.ts'

// Sign in, or on first run set the password with the setup code printed
// where Farline was started.
export function Login({ onDone, setup }: { onDone: () => void; setup: boolean }) {
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [code, setCode] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const ready = setup ? !!code && pw.length >= 8 && pw === pw2 : !!pw
  return (
    <div className="screen login">
      <img src="/icons/icon-192.png" alt="" />
      <div className="login-name">Farline</div>
      {setup && <div className="login-sub">{t('setup.intro')}</div>}
      <form
        onSubmit={async (e) => {
          e.preventDefault()
          if (!ready || busy) return
          setBusy(true)
          setErr('')
          try {
            if (setup) await api.setup(code, pw)
            else await api.login(pw)
            onDone()
          } catch (e: any) {
            setErr(e.message)
          } finally {
            setBusy(false)
          }
        }}
      >
        {setup && (
          <input className="code" autoComplete="one-time-code" autoCapitalize="characters" spellCheck={false} placeholder={t('setup.code')} value={code} onChange={(e) => setCode(e.target.value)} autoFocus />
        )}
        <input
          type="password"
          autoComplete={setup ? 'new-password' : 'current-password'}
          placeholder={t(setup ? 'setup.newPassword' : 'login.password')}
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          autoFocus={!setup}
        />
        {setup && <input type="password" autoComplete="new-password" placeholder={t('setup.repeatPassword')} value={pw2} onChange={(e) => setPw2(e.target.value)} />}
        <button className="black-pill" style={{ justifyContent: 'center' }} disabled={!ready || busy}>
          {busy ? <Spinner size={20} /> : t(setup ? 'setup.start' : 'login.signIn')}
        </button>
        <div className="err">{err || (setup && pw2 && pw !== pw2 ? t('setup.mismatch') : setup && pw && pw.length < 8 ? t('setup.shortPassword', { n: 8 }) : '')}</div>
        {setup && <div className="login-hint">{t('setup.where')}</div>}
      </form>
    </div>
  )
}
