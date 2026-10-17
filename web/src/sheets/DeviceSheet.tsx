import { ChevronRight, CornerLeftUp, Eye, EyeOff, Folder, Laptop, Plus } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { DirListing, SessionSummary } from '../../../shared/types.ts'
import { Sheet } from '../components/Sheet.tsx'
import { Spinner, StatusGlyph } from '../components/bits.tsx'
import { api } from '../lib/api.ts'
import { relTime, shortPath } from '../lib/format.ts'
import { navigate } from '../lib/router.ts'
import { t } from '../i18n.ts'

interface Props {
  device: string
  cwd: string
  sessions: SessionSummary[]
  onCwd: (cwd: string) => void
  onClose: () => void
}

export function DeviceSheet({ device, cwd, sessions, onCwd, onClose }: Props) {
  const [picking, setPicking] = useState(false)
  const inDir = sessions.filter((s) => s.cwd === cwd && (s.status !== 'idle' || Date.now() - s.updatedAt < 7 * 86400_000)).slice(0, 12)

  if (picking)
    return (
      <DirPicker
        start={cwd}
        onBack={() => setPicking(false)}
        onClose={onClose}
        onPick={(p) => {
          onCwd(p)
          setPicking(false)
        }}
      />
    )

  return (
    <Sheet
      title={device}
      onClose={onClose}
      size="tall"
      footer={
        <button
          className="black-pill"
          onClick={() => {
            onClose()
            navigate(`/new?cwd=${encodeURIComponent(cwd)}`)
          }}
        >
          <Plus size={19} strokeWidth={2} /> {t('nav.newSession')}
        </button>
      }
    >
      <div className="field-label">{t('nav.folders')}</div>
      <button className="row-btn row-fill" onClick={() => setPicking(true)}>
        <span className="grow">{cwd}</span>
        <ChevronRight size={19} color="var(--text-2)" />
      </button>
      {inDir.length > 0 && <div className="field-label" style={{ marginTop: 22 }}>{t('device.activeSessions', { n: inDir.length })}</div>}
      {inDir.map((s) => (
        <button
          key={s.id}
          className="card"
          onClick={() => {
            onClose()
            navigate(`/s/${s.id}`)
          }}
        >
          <div className="top">
            {s.status === 'idle' ? <span className="small-dot" /> : <StatusGlyph status={s.status} />}
            <span className="t">{s.title}</span>
            <span className="when">{s.status === 'idle' ? relTime(s.updatedAt) : `${t(s.status === 'requires_action' ? 'device.waiting' : 'device.working')} · ${relTime(s.updatedAt)}`}</span>
          </div>
          <div className="path">
            <Laptop size={14} strokeWidth={1.7} color="var(--green)" />
            {shortPath(s.cwd)}
          </div>
        </button>
      ))}
    </Sheet>
  )
}

export function DirPicker({ start, onPick, onBack, onClose }: { start: string; onPick: (p: string) => void; onBack: () => void; onClose: () => void }) {
  const [listing, setListing] = useState<DirListing | null>(null)
  const [path, setPath] = useState(start)
  const [typed, setTyped] = useState(start)
  const [hidden, setHidden] = useState(() => localStorage.getItem('farline.hiddenDirs') === '1')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setListing(null)
    api
      .dirs(path, hidden)
      .then((l) => {
        if (!alive) return
        setListing(l)
        setTyped(l.path)
        setError(null)
      })
      .catch((e) => alive && setError(e.message))
    return () => {
      alive = false
    }
  }, [path, hidden])

  return (
    <Sheet
      title={t('device.chooseFolder')}
      onClose={onClose}
      onBack={onBack}
      size="tall"
      action={
        <button
          className="head-action"
          aria-label={t(hidden ? 'device.hideHidden' : 'device.showHidden')}
          onClick={() => {
            localStorage.setItem('farline.hiddenDirs', hidden ? '0' : '1')
            setHidden(!hidden)
          }}
        >
          {hidden ? <Eye size={21} strokeWidth={1.7} /> : <EyeOff size={21} strokeWidth={1.7} color="var(--text-2)" />}
        </button>
      }
      footer={
        <button className="black-pill" disabled={!listing} onClick={() => listing && onPick(listing.path)}>
          {t('device.useFolder')}
        </button>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (typed.trim()) setPath(typed.trim())
        }}
      >
        <input
          className="path-input"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="go"
        />
      </form>
      {error && <div className="empty">{error}</div>}
      {!listing && !error && (
        <div className="empty">
          <Spinner />
        </div>
      )}
      {listing && (
        <div className="group">
          {listing.parent && (
            <button className="option" onClick={() => setPath(listing.parent!)}>
              <CornerLeftUp size={19} color="var(--text-2)" />
              <span className="grow">{t('device.up')}</span>
            </button>
          )}
          {listing.dirs.map((d) => (
            <button className="option" key={d.path} onClick={() => setPath(d.path)} style={d.hidden ? { color: 'var(--text-2)' } : undefined}>
              <Folder size={19} color="var(--text-2)" />
              <span className="grow">{d.name}</span>
              <ChevronRight size={17} color="var(--text-3)" />
            </button>
          ))}
          {listing.dirs.length === 0 && <div className="empty">{t('device.noSubfolders')}</div>}
        </div>
      )}
    </Sheet>
  )
}
