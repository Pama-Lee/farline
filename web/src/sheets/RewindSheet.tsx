// Go back to just before a message: the conversation, the code, or both.
import { useEffect, useState } from 'react'
import { Sheet } from '../components/Sheet.tsx'
import { Spinner, toast } from '../components/bits.tsx'
import { api, type RewindPreview } from '../lib/api.ts'
import { navigate } from '../lib/router.ts'

export const DRAFT_EVENT = 'farline:draft'

// Put text back in a session's composer.
export function setDraft(sessionId: string | null, text: string) {
  const key = `farline.draft.${sessionId ?? 'new'}`
  sessionStorage.setItem(key, text)
  window.dispatchEvent(new CustomEvent(DRAFT_EVENT, { detail: { key, text } }))
}

export function RewindSheet({ sessionId, cwd, messageId, text, onClose }: { sessionId: string; cwd: string; messageId: string; text: string; onClose: () => void }) {
  const [preview, setPreview] = useState<RewindPreview | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    api.rewindPreview(sessionId, messageId).then(setPreview, () => setPreview({ canRewind: false }))
  }, [sessionId, messageId])

  const n = preview?.filesChanged?.length ?? 0
  const code = !!preview?.canRewind && n > 0
  const stat = code ? `${n} 个文件 +${preview!.insertions ?? 0} −${preview!.deletions ?? 0}` : ''

  const run = async (key: string, files: boolean, conversation: boolean) => {
    if (busy) return
    setBusy(key)
    try {
      const r = await api.rewind(sessionId, { messageId, files, conversation })
      if (conversation) {
        if (r.restart) {
          setDraft(null, text)
          navigate(`/new?cwd=${encodeURIComponent(cwd)}`)
        } else setDraft(sessionId, text)
      }
      toast(files && conversation ? '已回退对话和代码' : files ? '已回退代码' : '已回退对话')
      onClose()
    } catch (e: any) {
      toast(e?.message ?? '回退失败')
      setBusy(null)
    }
  }

  const row = (key: string, label: string, files: boolean, conversation: boolean, value?: string) => (
    <button className="option" key={key} disabled={!!busy} onClick={() => void run(key, files, conversation)}>
      <span className="grow">{label}</span>
      {busy === key ? <Spinner size={18} /> : value && <span className="hint">{value}</span>}
    </button>
  )

  return (
    <Sheet title="回退到这条消息之前" onClose={onClose}>
      <div className="rewind-quote">{text}</div>
      {!preview ? (
        <div className="empty">
          <Spinner />
        </div>
      ) : (
        <div className="group">
          {code && row('both', '回退对话和代码', true, true, stat)}
          {row('conversation', '只回退对话', false, true)}
          {code && row('code', '只回退代码', true, false, stat)}
        </div>
      )}
    </Sheet>
  )
}
