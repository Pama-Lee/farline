import { Check } from 'lucide-react'
import type { SessionSummary } from '../../../shared/types.ts'
import { Sheet } from '../components/Sheet.tsx'
import { relTime, shortPath } from '../lib/format.ts'
import { navigate } from '../lib/router.ts'
import { groupByDay } from '../lib/useSessions.ts'
import { t } from '../i18n.ts'

export function HistorySheet({ sessions, hasMore, onMore, onClose }: { sessions: SessionSummary[]; hasMore: boolean; onMore: () => void; onClose: () => void }) {
  return (
    <Sheet title={t('nav.history')} onClose={onClose} size="tall">
      {groupByDay(sessions).map(([day, list]) => (
        <div key={day}>
          <div className="group-title">{day}</div>
          <div className="group">
            {list.map((s) => (
              <button
                className="option"
                key={s.id}
                onClick={() => {
                  onClose()
                  navigate(`/s/${s.id}`)
                }}
              >
                <span className="grow" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.title}</span>
                <span className="hint">{relTime(s.updatedAt)}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
      {hasMore && (
        <button className="steps-row" style={{ margin: '16px auto' }} onClick={onMore}>
          <span>{t('common.loadMore')}</span>
        </button>
      )}
    </Sheet>
  )
}

export function FilterSheet({ cwds, filter, onFilter, onClose }: { cwds: string[]; filter: string | null; onFilter: (cwd: string | null) => void; onClose: () => void }) {
  const pick = (c: string | null) => {
    onFilter(c)
    onClose()
  }
  return (
    <Sheet title={t('nav.folders')} onClose={onClose}>
      <div className="group">
        <button className="option" onClick={() => pick(null)}>
          <span className="grow">{t('common.all')}</span>
          {!filter && <Check size={20} strokeWidth={2.2} className="check" />}
        </button>
        {cwds.map((c) => (
          <button className="option" key={c} onClick={() => pick(c)}>
            <span className="grow">{shortPath(c)}</span>
            {filter === c && <Check size={20} strokeWidth={2.2} className="check" />}
          </button>
        ))}
      </div>
    </Sheet>
  )
}
