// A small menu over text selected inside one reply: copy it, or edit the reply.
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { toast } from './bits.tsx'
import { copyText } from '../lib/format.ts'

interface Sel {
  itemId: string
  text: string
  rect: DOMRect
}

export function SelectionMenu({ enabled, onEdit }: { enabled: boolean; onEdit: (itemId: string, selected: string) => void }) {
  const [sel, setSel] = useState<Sel | null>(null)

  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined
    const read = () => {
      const s = window.getSelection()
      if (!s || s.isCollapsed || !s.rangeCount) return setSel(null)
      const reply = (n: Node | null) => (n instanceof Element ? n : n?.parentElement)?.closest<HTMLElement>('.msg-text[data-item]')
      const a = reply(s.anchorNode)
      if (!a || a !== reply(s.focusNode)) return setSel(null)
      const text = s.toString().trim()
      if (!text) return setSel(null)
      setSel({ itemId: a.dataset.item!, text, rect: s.getRangeAt(0).getBoundingClientRect() })
    }
    const onChange = () => {
      clearTimeout(t)
      t = setTimeout(read, 180)
    }
    const hide = () => setSel(null)
    document.addEventListener('selectionchange', onChange)
    window.addEventListener('scroll', hide, true)
    return () => {
      clearTimeout(t)
      document.removeEventListener('selectionchange', onChange)
      window.removeEventListener('scroll', hide, true)
    }
  }, [])

  if (!sel || !enabled) return null
  // Above the selection; below on touch screens, where the system menu sits above.
  const touch = window.matchMedia('(hover: none)').matches
  const top = touch || sel.rect.top < 60 ? sel.rect.bottom + 8 : sel.rect.top - 44
  const left = Math.min(Math.max(10, sel.rect.left + sel.rect.width / 2 - 70), window.innerWidth - 150)
  return createPortal(
    <div className="sel-menu" style={{ top, left }} onMouseDown={(e) => e.preventDefault()}>
      <button
        onClick={async () => {
          await copyText(sel.text)
          toast('已复制')
          setSel(null)
        }}
      >
        复制
      </button>
      <button
        onClick={() => {
          onEdit(sel.itemId, sel.text)
          window.getSelection()?.removeAllRanges()
          setSel(null)
        }}
      >
        编辑
      </button>
    </div>,
    document.body,
  )
}
