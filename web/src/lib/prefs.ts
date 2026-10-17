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
