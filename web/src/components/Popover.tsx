// A small panel anchored to the element that opened it: below when there is
// room, otherwise above. Clicking outside or pressing Escape closes it.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

const GAP = 8
const MARGIN = 10

export function Popover({ anchor, onClose, children }: { anchor: DOMRect; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Re-placed whenever the content changes size (submenus).
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const place = () => {
      const { width, height } = el.getBoundingClientRect()
      const below = anchor.bottom + GAP
      const top = below + height <= window.innerHeight - MARGIN ? below : Math.max(MARGIN, anchor.top - GAP - height)
      const left = Math.min(Math.max(MARGIN, anchor.left - 8), window.innerWidth - width - MARGIN)
      setPos({ top, left })
    }
    place()
    const ro = new ResizeObserver(place)
    ro.observe(el)
    return () => ro.disconnect()
  }, [anchor])

  return createPortal(
    <>
      <div className="popover-backdrop" onClick={onClose} />
      <div ref={ref} className="popover" role="menu" style={pos ? { top: pos.top, left: pos.left } : { visibility: 'hidden', top: 0, left: 0 }}>
        {children}
      </div>
    </>,
    document.body,
  )
}
