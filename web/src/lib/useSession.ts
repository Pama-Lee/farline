// Snapshot + SSE patches for one session. Any gap (server restart, iOS
// suspending the page) is healed by refetching the snapshot.
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Item, Patch, SessionState } from '../../../shared/types.ts'
import { api } from './api.ts'
import { t } from '../i18n.ts'

export interface SessionData {
  state: SessionState | null
  items: Item[]
  hasEarlier: boolean
  error: string | null
  loadAll: () => void
  refresh: () => void
  setState: (s: SessionState) => void
}

export function useSession(id: string | null): SessionData {
  const [state, setState] = useState<SessionState | null>(null)
  const [items, setItems] = useState<Item[]>([])
  const [hasEarlier, setHasEarlier] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const seqRef = useRef(0)
  const esRef = useRef<EventSource | null>(null)
  const allRef = useRef(false)
  const genRef = useRef(0)

  const connect = useCallback(async () => {
    if (!id) return
    const gen = ++genRef.current
    esRef.current?.close()
    esRef.current = null
    try {
      const snap = await api.session(id, allRef.current)
      if (gen !== genRef.current) return
      setState(snap.state)
      setItems(snap.items)
      setHasEarlier(snap.hasEarlier)
      setError(null)
      seqRef.current = snap.seq
      const es = new EventSource(`/api/sessions/${id}/events?since=${snap.seq}`)
      esRef.current = es
      es.addEventListener('patch', (e) => {
        const p: Patch = JSON.parse((e as MessageEvent).data)
        if (p.seq !== seqRef.current + 1) {
          void connect()
          return
        }
        seqRef.current = p.seq
        if (p.state) setState(p.state)
        if (p.upserts || p.removes) setItems((prev) => applyPatch(prev, p))
      })
      es.addEventListener('reset', () => void connect())
      es.onerror = () => {
        if (es.readyState === EventSource.CLOSED && gen === genRef.current) setTimeout(() => void connect(), 1500)
      }
    } catch (err: any) {
      if (gen === genRef.current) setError(err?.message ?? t('common.loadFailed'))
    }
  }, [id])

  useEffect(() => {
    allRef.current = false
    setState(null)
    setItems([])
    void connect()
    const onVisible = () => {
      if (document.visibilityState === 'visible') void connect()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      genRef.current++
      esRef.current?.close()
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [connect])

  const loadAll = useCallback(() => {
    allRef.current = true
    void connect()
  }, [connect])

  const refresh = useCallback(() => void connect(), [connect])

  return { state, items, hasEarlier, error, loadAll, refresh, setState }
}

function applyPatch(prev: Item[], p: Patch): Item[] {
  let next = prev
  if (p.removes?.length) {
    const rm = new Set(p.removes)
    next = next.filter((it) => !rm.has(it.id))
  }
  if (p.upserts?.length) {
    next = next === prev ? [...prev] : next
    const index = new Map(next.map((it, i) => [it.id, i]))
    for (const it of p.upserts) {
      const i = index.get(it.id)
      if (i === undefined) {
        index.set(it.id, next.length)
        next.push(it)
      } else next[i] = it
    }
  }
  return next
}
