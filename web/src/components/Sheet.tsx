import { ChevronLeft, X } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

interface Props {
  title?: ReactNode
  onClose: () => void
  onBack?: () => void
  action?: ReactNode
  footer?: ReactNode
  // auto: fits content; medium: half screen, drag up to expand; tall: ~3/4.
  size?: 'auto' | 'medium' | 'tall'
  children: ReactNode
}

export function Sheet({ title, onClose, onBack, action, footer, size = 'auto', children }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const drag = useRef<{ y: number; dy: number } | null>(null)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const onTouchStart = (e: React.TouchEvent) => {
    drag.current = { y: e.touches[0].clientY, dy: 0 }
  }
  const onTouchMove = (e: React.TouchEvent) => {
    if (!drag.current || !ref.current) return
    drag.current.dy = e.touches[0].clientY - drag.current.y
    if (drag.current.dy > 0) {
      ref.current.style.transition = 'none'
      ref.current.style.transform = `translateY(${drag.current.dy}px)`
    }
  }
  const onTouchEnd = () => {
    if (!drag.current || !ref.current) return
    const { dy } = drag.current
    drag.current = null
    ref.current.style.transition = ''
    if (dy < -50 && size === 'medium') setExpanded(true)
    if (dy > 110) {
      if (expanded) {
        setExpanded(false)
        ref.current.style.transform = ''
        return
      }
      ref.current.style.transition = 'transform 0.22s ease'
      ref.current.style.transform = 'translateY(110%)'
      setTimeout(onClose, 180)
    } else ref.current.style.transform = ''
  }

  return createPortal(
    <>
      <div className="sheet-backdrop" onClick={onClose} />
      <div className={`sheet ${size}${expanded ? ' expanded' : ''}`} ref={ref} role="dialog">
        <div onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
          <div className="grabber" />
          <div className="sheet-head">
            <button className="circle-btn" onClick={onBack ?? onClose} aria-label={onBack ? '返回' : '关闭'}>
              {onBack ? <ChevronLeft size={24} strokeWidth={1.8} /> : <X size={22} strokeWidth={1.8} />}
            </button>
            <h2>{title}</h2>
            <div className="head-action">{action}</div>
          </div>
        </div>
        <div className="sheet-body">{children}</div>
        {footer && <div className="sheet-foot">{footer}</div>}
      </div>
    </>,
    document.body,
  )
}
