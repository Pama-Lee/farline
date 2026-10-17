// Drag the sidebar's edge to resize it; drag far enough left to hide it.
// Double-click goes back to the default width.
import { SB_MAX, SB_MIN } from '../lib/prefs.ts'

export function SidebarResizer({ onWidth, onHide }: { onWidth: (w: number | null) => void; onHide: () => void }) {
  return (
    <div
      className="sb-resizer"
      role="separator"
      aria-orientation="vertical"
      onDoubleClick={() => onWidth(null)}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        e.preventDefault()
        const el = e.currentTarget
        el.setPointerCapture(e.pointerId)
        document.documentElement.classList.add('resizing')
        const move = (ev: PointerEvent) => {
          if (ev.clientX < SB_MIN / 2) return
          onWidth(Math.min(SB_MAX, Math.max(SB_MIN, ev.clientX)))
        }
        const up = (ev: PointerEvent) => {
          el.removeEventListener('pointermove', move)
          el.removeEventListener('pointerup', up)
          el.removeEventListener('pointercancel', up)
          document.documentElement.classList.remove('resizing')
          if (ev.clientX < SB_MIN / 2) onHide()
        }
        el.addEventListener('pointermove', move)
        el.addEventListener('pointerup', up)
        el.addEventListener('pointercancel', up)
      }}
    />
  )
}
