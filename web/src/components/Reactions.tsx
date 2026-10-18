// Emoji reactions under a message, and the picker to add one.
import { SmilePlus } from 'lucide-react'
import { useState } from 'react'
import type { Reaction } from '../../../shared/types.ts'
import { toast } from './bits.tsx'
import { Popover } from './Popover.tsx'
import { api } from '../lib/api.ts'
import { t } from '../i18n.ts'

const QUICK = ['❤️', '👍', '😂', '🎉', '👀', '🚀', '🙏']

export function ReactionPills({ reactions, sessionId, itemId }: { reactions?: Reaction[]; sessionId: string | null; itemId: string }) {
  if (!reactions?.length) return null
  const groups = new Map<string, { n: number; agent: boolean; mine: boolean }>()
  for (const r of reactions) {
    const g = groups.get(r.emoji) ?? { n: 0, agent: false, mine: false }
    g.n++
    if (r.by === 'agent') g.agent = true
    else g.mine = true
    groups.set(r.emoji, g)
  }
  return (
    <div className="reactions">
      {[...groups].map(([emoji, g]) => (
        <button
          key={emoji}
          className={`reaction${g.agent ? ' agent' : ''}${g.mine ? ' mine' : ''}`}
          title={g.agent ? t('reactions.byAgent') : undefined}
          onClick={() => sessionId && void api.react(sessionId, itemId, emoji).catch((e) => toast(e?.message ?? t('common.failed')))}
        >
          <span className="e">{emoji}</span>
          <span className="n">{g.n}</span>
        </button>
      ))}
    </div>
  )
}

export function ReactButton({ sessionId, itemId, size = 16 }: { sessionId: string; itemId: string; size?: number }) {
  const [at, setAt] = useState<DOMRect | null>(null)
  return (
    <>
      <button onClick={(e) => setAt(e.currentTarget.getBoundingClientRect())} aria-label={t('reactions.add')} title={t('reactions.add')}>
        <SmilePlus size={size} strokeWidth={1.6} />
      </button>
      {at && (
        <Popover anchor={at} onClose={() => setAt(null)}>
          <div className="emoji-row">
            {QUICK.map((e) => (
              <button
                key={e}
                onClick={() => {
                  setAt(null)
                  void api.react(sessionId, itemId, e).catch((err) => toast(err?.message ?? t('common.failed')))
                }}
              >
                {e}
              </button>
            ))}
          </div>
        </Popover>
      )}
    </>
  )
}
