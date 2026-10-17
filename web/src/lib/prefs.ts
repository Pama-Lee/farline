// Per-device preferences, kept in localStorage.
import { useEffect, useState } from 'react'
import { useDesktop } from './useDesktop.ts'

export type StepsView = 'auto' | 'sheet' | 'inline'

const KEY = 'farline.stepsView'
const EVENT = 'farline:prefs'

export function getStepsView(): StepsView {
  const v = localStorage.getItem(KEY)
  return v === 'sheet' || v === 'inline' ? v : 'auto'
}

export function setStepsView(v: StepsView) {
  if (v === 'auto') localStorage.removeItem(KEY)
  else localStorage.setItem(KEY, v)
  window.dispatchEvent(new Event(EVENT))
}

export function useStepsView() {
  const [v, setV] = useState(getStepsView)
  useEffect(() => {
    const on = () => setV(getStepsView())
    window.addEventListener(EVENT, on)
    window.addEventListener('storage', on)
    return () => {
      window.removeEventListener(EVENT, on)
      window.removeEventListener('storage', on)
    }
  }, [])
  return v
}

// Tool calls open in place on wide screens unless set otherwise.
export function useInlineSteps() {
  const v = useStepsView()
  const desktop = useDesktop()
  return v === 'inline' || (v === 'auto' && desktop)
}

// The desktop sidebar: hidden or not, and how wide.
const SB_W = 'farline.sbWidth'
const SB_HIDDEN = 'farline.sbHidden'
export const SB_MIN = 220
export const SB_MAX = 520

export function useSidebarLayout() {
  const [width, setWidthState] = useState<number | null>(() => Number(localStorage.getItem(SB_W)) || null)
  const [hidden, setHiddenState] = useState(() => localStorage.getItem(SB_HIDDEN) === '1')
  const setWidth = (w: number | null) => {
    setWidthState(w)
    if (w) localStorage.setItem(SB_W, String(Math.round(w)))
    else localStorage.removeItem(SB_W)
  }
  const setHidden = (h: boolean) => {
    setHiddenState(h)
    if (h) localStorage.setItem(SB_HIDDEN, '1')
    else localStorage.removeItem(SB_HIDDEN)
  }
  return { width, hidden, setWidth, setHidden }
}
