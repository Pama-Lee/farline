// Session list shared by the phone home screen and the desktop sidebar.
import { useCallback, useEffect, useRef, useState } from 'react'
import type { SessionSummary } from '../../../shared/types.ts'
import { api } from './api.ts'
import { t } from '../i18n.ts'

// Survives remounts (navigating into a session and back on the phone).
let cache: { sessions: SessionSummary[]; nextOffset: number | null } | null = null

export function useSessions() {
  const [sessions, setSessions] = useState<SessionSummary[]>(cache?.sessions ?? [])
  const [nextOffset, setNextOffset] = useState<number | null>(cache?.nextOffset ?? null)
  const [loading, setLoading] = useState(!cache)
  const loadingMore = useRef(false)
  const count = useRef(sessions.length)
  count.current = sessions.length

  const refresh = useCallback(async () => {
    try {
      const page = await api.sessions(0, Math.max(40, count.current))
      setSessions(page.sessions)
      setNextOffset(page.nextOffset)
      cache = page
    } catch {
      /* keep the stale list */
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
    const t = setInterval(() => document.visibilityState === 'visible' && void refresh(), 8000)
    const onVisible = () => document.visibilityState === 'visible' && void refresh()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(t)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [refresh])

  const loadMore = useCallback(async () => {
    if (nextOffset === null || loadingMore.current) return
    loadingMore.current = true
    try {
      const page = await api.sessions(nextOffset, 40)
      setSessions((prev) => {
        const seen = new Set(prev.map((s) => s.id))
        const merged = [...prev, ...page.sessions.filter((s) => !seen.has(s.id))]
        cache = { sessions: merged, nextOffset: page.nextOffset }
        return merged
      })
      setNextOffset(page.nextOffset)
    } finally {
      loadingMore.current = false
    }
  }, [nextOffset])

  return { sessions, nextOffset, loading, refresh, loadMore }
}

export function groupByDay(list: SessionSummary[]): [string, SessionSummary[]][] {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  const today = start.getTime()
  const label = (at: number) => t(at >= today ? 'time.today' : at >= today - 86400_000 ? 'time.yesterday' : at >= today - 6 * 86400_000 ? 'time.thisWeek' : at >= today - 29 * 86400_000 ? 'time.thisMonth' : 'time.earlier')
  const groups = new Map<string, SessionSummary[]>()
  for (const s of list) {
    const k = label(s.updatedAt)
    groups.set(k, [...(groups.get(k) ?? []), s])
  }
  return [...groups.entries()]
}
