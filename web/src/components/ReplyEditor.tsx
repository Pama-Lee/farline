// Rewrite a reply in place. The next turn reads the rewritten text.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Spinner, toast } from './bits.tsx'
import { api } from '../lib/api.ts'
import { t } from '../i18n.ts'

export function ReplyEditor({ sessionId, itemId, text, select, onDone }: { sessionId: string; itemId: string; text: string; select?: string; onDone: () => void }) {
  const [value, setValue] = useState(text)
  const [saving, setSaving] = useState(false)
  const ta = useRef<HTMLTextAreaElement>(null)

  const fit = () => {
    const el = ta.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight + 2}px`
  }
  useLayoutEffect(fit, [value])

  // Start with the selected words selected, when they can be found.
  useEffect(() => {
    const el = ta.current
    if (!el) return
    el.focus({ preventScroll: true })
    const at = select ? text.indexOf(select) : -1
    if (at >= 0) el.setSelectionRange(at, at + select!.length)
    else el.setSelectionRange(text.length, text.length)
  }, [])

  const save = async () => {
    if (saving) return
    if (value === text) return onDone()
    setSaving(true)
    try {
      await api.editText(sessionId, itemId, value)
      toast(t('common.saved'))
      onDone()
    } catch (e: any) {
      toast(e?.message ?? t('common.saveFailed'))
      setSaving(false)
    }
  }

  return (
    <div className="reply-editor">
      <textarea
        ref={ta}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onDone()
          else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            void save()
          }
        }}
        spellCheck={false}
        data-gramm="false"
        data-gramm_editor="false"
        data-enable-grammarly="false"
      />
      <div className="re-actions">
        <button className="re-btn" onClick={onDone} disabled={saving}>
          {t('common.cancel')}
        </button>
        <button className="re-btn primary" onClick={() => void save()} disabled={saving || !value.trim()}>
          {saving ? <Spinner size={15} /> : t('common.save')}
        </button>
      </div>
    </div>
  )
}
