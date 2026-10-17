import { Clock, Laptop, Plus, Search, SlidersVertical, TextAlignStart, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Spinner, StatusGlyph } from '../components/bits.tsx'
import type { DeviceInfo } from '../lib/api.ts'
import { basename } from '../lib/format.ts'
import { navigate } from '../lib/router.ts'
import { useSessions } from '../lib/useSessions.ts'
import { DeviceSheet } from '../sheets/DeviceSheet.tsx'
import { FilterSheet, HistorySheet } from '../sheets/ListSheets.tsx'
import { SettingsSheet } from '../sheets/SettingsSheet.tsx'

export function Home({ device, onLogout }: { device: DeviceInfo | null; onLogout: () => void }) {
  const { sessions, nextOffset, loading, loadMore } = useSessions()
  const [sheet, setSheet] = useState<'device' | 'settings' | 'filter' | 'history' | null>(null)
  const [cwd, setCwd] = useState<string | null>(null)
  const [filter, setFilter] = useState<string | null>(() => localStorage.getItem('farline.filter'))
  const [searching, setSearching] = useState(false)
  const [q, setQ] = useState('')
  const cwds = useMemo(() => [...new Set(sessions.map((s) => s.cwd).filter(Boolean))], [sessions])
  const shown = sessions.filter((s) => (!filter || s.cwd === filter) && (!q.trim() || s.title.toLowerCase().includes(q.trim().toLowerCase())))
  const deviceCwd = cwd ?? filter ?? device?.defaultCwd ?? ''

  return (
    <div className="screen home">


      <div
        className="scroll"
        onScroll={(e) => {
          const el = e.currentTarget
          if (el.scrollHeight - el.scrollTop - el.clientHeight < 400) void loadMore()
        }}
      >
        {searching && (
          <div className="search-bar">
            <Search size={20} color="var(--text-2)" />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索会话" enterKeyHint="search" />
            <button
              onClick={() => {
                setSearching(false)
                setQ('')
              }}
            >
              <X size={20} color="var(--text-2)" />
            </button>
          </div>
        )}
        <div style={{ height: searching ? 8 : 22 }} />
        {!searching && (
          <>
            <div className="section-label">
              设备
              <button onClick={() => setSheet('device')} aria-label="新建会话">
                <Plus size={21} strokeWidth={1.6} color="var(--text)" />
              </button>
            </div>
            <button className="device-chip" onClick={() => setSheet('device')}>
              <span className="device-icon">
                <Laptop size={20} strokeWidth={1.6} />
                <span className="dot" />
              </span>
              {device?.name ?? '…'}
            </button>
          </>
        )}
        <div className="section-label" style={{ marginTop: searching ? 0 : 28, marginBottom: 12 }}>
          <span>{filter ? basename(filter) : '会话'}</span>
          {filter && (
            <button onClick={() => (setFilter(null), localStorage.removeItem('farline.filter'))}>
              <X size={18} />
            </button>
          )}
        </div>
        {loading && (
          <div className="empty">
            <Spinner />
          </div>
        )}
        {shown.map((s) => (
          <button key={s.id} className="session-row" onClick={() => navigate(`/s/${s.id}`)}>
            <span className="glyph">
              <StatusGlyph status={s.status} />
            </span>
            <span style={{ minWidth: 0 }}>
              <div className="t">{s.title}</div>
              <div className="s">
                {basename(s.cwd) || device?.name}
                <Laptop size={15} strokeWidth={1.7} color="var(--green)" style={{ opacity: s.status === 'idle' ? 0.55 : 1, flex: 'none' }} />
                {s.providerLabel && <span className="tag">{s.providerLabel}</span>}
                {!!s.tasks && <span className="tag">后台 {s.tasks}</span>}
              </div>
            </span>
          </button>
        ))}
        {!loading && shown.length === 0 && <div className="empty">没有会话</div>}
        <div style={{ height: 110 }} />
      </div>

      <header className="topbar">
        <div className="left">
          <button className="circle-btn" onClick={() => setSheet('settings')} aria-label="设置">
            <TextAlignStart size={22} strokeWidth={1.6} />
          </button>
        </div>
        <div className="title">
          <h1 className="home-title">Farline</h1>
        </div>
        <div className="right">
          <div className="pill-btns">
            <button onClick={() => setSheet('history')} aria-label="历史">
              <Clock size={21} strokeWidth={1.6} />
            </button>
            <button onClick={() => setSheet('filter')} aria-label="筛选">
              <SlidersVertical size={21} strokeWidth={1.6} />
            </button>
          </div>
        </div>
      </header>
      <div className="fab-row">
        <button className="circle-btn fab-search" onClick={() => setSearching((v) => !v)} aria-label="搜索">
          <Search size={19} strokeWidth={1.8} />
        </button>
        <button className="black-pill" onClick={() => setSheet('device')}>
          <Plus size={18} strokeWidth={2} /> 新建会话
        </button>
      </div>

      {sheet === 'device' && device && (
        <DeviceSheet device={device.name} cwd={deviceCwd} sessions={sessions} onCwd={setCwd} onClose={() => setSheet(null)} />
      )}
      {sheet === 'settings' && <SettingsSheet onClose={() => setSheet(null)} onLogout={onLogout} />}
      {sheet === 'history' && <HistorySheet sessions={sessions} hasMore={nextOffset !== null} onMore={() => void loadMore()} onClose={() => setSheet(null)} />}
      {sheet === 'filter' && (
        <FilterSheet
          cwds={cwds}
          filter={filter}
          onFilter={(c) => {
            setFilter(c)
            if (c) localStorage.setItem('farline.filter', c)
            else localStorage.removeItem('farline.filter')
          }}
          onClose={() => setSheet(null)}
        />
      )}
    </div>
  )
}

