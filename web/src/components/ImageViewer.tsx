import { ChevronLeft, ChevronRight, ExternalLink, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { closeViewer, setViewerIndex, stepViewer, useViewer } from '../lib/viewer.ts'
import { t } from '../i18n.ts'

function nameOf(url: string, name?: string) {
  if (name) return name.split('/').pop() || name
  return t('common.image')
}

export function ImageViewer({ desktop }: { desktop: boolean }) {
  const s = useViewer()
  const [actual, setActual] = useState(false)
  const touch = useRef<{ x: number; y: number; t: number } | null>(null)
  const lastTap = useRef(0)

  useEffect(() => setActual(false), [s?.index, s?.images])

  useEffect(() => {
    if (!s) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeViewer()
      else if (e.key === 'ArrowLeft') stepViewer(-1)
      else if (e.key === 'ArrowRight') stepViewer(1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [s])

  if (!s) return null
  const img = s.images[s.index]
  const many = s.images.length > 1

  if (desktop)
    return (
      <aside className="viewer-panel" role="dialog" aria-label={t('common.image')}>
        <div className="vp-head">
          <span className="vp-title" title={img.name}>
            {nameOf(img.url, img.name)}
            {many && <span className="vp-count">{` ${s.index + 1} / ${s.images.length}`}</span>}
          </span>
          <a className="vp-btn" href={img.url} target="_blank" rel="noreferrer" aria-label={t('file.openInNewTab')} title={t('file.openInNewTab')}>
            <ExternalLink size={18} strokeWidth={1.7} />
          </a>
          <button className="vp-btn" onClick={closeViewer} aria-label={t('common.close')} title={t('common.close')}>
            <X size={20} strokeWidth={1.7} />
          </button>
        </div>
        <div className={`vp-body${actual ? ' actual' : ''}`}>
          <img src={img.url} alt="" onClick={() => setActual((a) => !a)} />
          {many && (
            <>
              <button className="vp-nav left" onClick={() => stepViewer(-1)} aria-label={t('image.prev')}>
                <ChevronLeft size={22} strokeWidth={1.8} />
              </button>
              <button className="vp-nav right" onClick={() => stepViewer(1)} aria-label={t('image.next')}>
                <ChevronRight size={22} strokeWidth={1.8} />
              </button>
            </>
          )}
        </div>
        {many && (
          <div className="vp-strip">
            {s.images.map((im, i) => (
              <button key={im.url} className={i === s.index ? 'on' : undefined} onClick={() => setViewerIndex(i)}>
                <img src={im.url} alt="" />
              </button>
            ))}
          </div>
        )}
      </aside>
    )

  return (
    <div
      className="viewer-full"
      onTouchStart={(e) => {
        touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() }
      }}
      onTouchEnd={(e) => {
        const t = touch.current
        touch.current = null
        if (!t || actual) return
        const dx = e.changedTouches[0].clientX - t.x
        const dy = e.changedTouches[0].clientY - t.y
        if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) && many) stepViewer(dx < 0 ? 1 : -1)
        else if (dy > 110 && Math.abs(dy) > Math.abs(dx)) closeViewer()
      }}
    >
      <div className="vf-head">
        <button className="vf-btn" onClick={closeViewer} aria-label={t('common.close')}>
          <X size={22} strokeWidth={1.8} />
        </button>
        {many && <span className="vf-count">{`${s.index + 1} / ${s.images.length}`}</span>}
        <span style={{ width: 44 }} />
      </div>
      <div className={`vf-body${actual ? ' actual' : ''}`}>
        <img
          src={img.url}
          alt=""
          onClick={() => {
            const now = Date.now()
            if (now - lastTap.current < 300) setActual((a) => !a)
            lastTap.current = now
          }}
        />
      </div>
    </div>
  )
}
