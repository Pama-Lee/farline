// Desktop: the session list lives in a fixed left column next to the thread.
import { Clock, Laptop, Plus, Search, Settings2, SlidersVertical, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Spinner, StatusGlyph } from '../components/bits.tsx'
import type { DeviceInfo } from '../lib/api.ts'
import { basename } from '../lib/format.ts'
import { navigate } from '../lib/router.ts'
import { useSessions } from '../lib/useSessions.ts'
import { DeviceSheet } from '../sheets/DeviceSheet.tsx'
import { FilterSheet, HistorySheet } from '../sheets/ListSheets.tsx'
import { SettingsSheet } from '../sheets/SettingsSheet.tsx'

export function Sidebar({ device, activeId, onLogout }: { device: DeviceInfo | null; activeId: string | null; onLogout: () => void }) {
  const { sessions, nextOffset, loading, loadMore } = useSessions()
  const [sheet, setSheet] = useState<'device' | 'settings' | 'filter' | 'history' | null>(null)
  const [filter, setFilter] = useState<string | null>(() => localStorage.getItem('farline.filter'))
  const [cwd, setCwd] = useState<string | null>(null)
  const [q, setQ] = useState('')

  const cwds = useMemo(() => [...new Set(sessions.map((s) => s.cwd).filter(Boolean))], [sessions])
  const shown = sessions.filter((s) => (!filter || s.cwd === filter) && (!q.trim() || s.title.toLowerCase().includes(q.trim().toLowerCase())))
  const newCwd = cwd ?? filter ?? device?.defaultCwd ?? ''

  return (
    <aside className="sidebar">
      <div className="sb-head">
        <span className="sb-title">Code</span>
        <div className="sb-icons">
          <button onClick={() => setSheet('history')} aria-label="历史" title="历史">
            <Clock size={18} strokeWidth={1.7} />
          </button>
          <button onClick={() => setSheet('filter')} aria-label="筛选" title="按目录筛选">
            <SlidersVertical size={18} strokeWidth={1.7} />
          </button>
          <button onClick={() => setSheet('settings')} aria-label="设置" title="设置">
            <Settings2 size={18} strokeWidth={1.7} />
          </button>
        </div>
      </div>

      <button className="sb-new" onClick={() => navigate(`/new?cwd=${encodeURIComponent(newCwd)}`)}>
        <Plus size={18} strokeWidth={2} /> 新建会话
      </button>

      <div className="sb-search">
        <Search size={16} strokeWidth={1.8} color="var(--text-2)" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索会话" />
        {q && (
          <button onClick={() => setQ('')} aria-label="清空">
            <X size={15} color="var(--text-2)" />
          </button>
        )}
      </div>

      <button className="sb-device" onClick={() => setSheet('device')}>
        <span className="device-icon">
          <Laptop size={18} strokeWidth={1.6} />
          <span className="dot" />
        </span>
        <span className="grow">{device?.name ?? '…'}</span>
        <span className="sb-dir">{basename(newCwd)}</span>
      </button>

      <div className="sb-label">
        <span>{filter ? basename(filter) : '会话'}</span>
        {filter && (
          <button
            onClick={() => {
              setFilter(null)
              localStorage.removeItem('farline.filter')
            }}
            aria-label="取消筛选"
          >
            <X size={14} />
          </button>
        )}
      </div>

      <div
        className="sb-list"
        onScroll={(e) => {
          const el = e.currentTarget
          if (el.scrollHeight - el.scrollTop - el.clientHeight < 300) void loadMore()
        }}
      >
        {loading && (
          <div className="empty">
            <Spinner />
          </div>
        )}
        {shown.map((s) => (
          <button key={s.id} className={`sb-row${s.id === activeId ? ' active' : ''}`} onClick={() => navigate(`/s/${s.id}`)} title={s.title}>
            <span className="glyph">
              <StatusGlyph status={s.status} />
            </span>
            <span style={{ minWidth: 0 }}>
              <div className="t">{s.title}</div>
              <div className="s">
                {basename(s.cwd) || device?.name}
                {s.providerLabel && <span className="tag">{s.providerLabel}</span>}
              </div>
            </span>
          </button>
        ))}
        {!loading && shown.length === 0 && <div className="empty">没有会话</div>}
      </div>

      {sheet === 'device' && device && (
        <DeviceSheet device={device.name} cwd={newCwd} sessions={sessions} onCwd={setCwd} onClose={() => setSheet(null)} />
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
    </aside>
  )
}
