import { useEffect, useState } from 'react'

const QUERY = '(min-width: 900px)'

export function isDesktop() {
  return window.matchMedia(QUERY).matches
}

export function useDesktop() {
  const [desktop, setDesktop] = useState(isDesktop)
  useEffect(() => {
    const mq = window.matchMedia(QUERY)
    const on = () => setDesktop(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return desktop
}
