import { Blocks, Camera, Check, ChevronRight, FileUp, Image, Zap } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { McpServer, PermissionMode } from '../../../shared/types.ts'
import { Sheet } from '../components/Sheet.tsx'
import { Spinner } from '../components/bits.tsx'
import { api } from '../lib/api.ts'

export const MODE_LABELS: Record<PermissionMode, string> = {
  default: '每次询问',
  auto: '自动',
  acceptEdits: '自动接受编辑',
  plan: '只做规划',
  bypassPermissions: '全部放行',
}

const MODE_ORDER: PermissionMode[] = ['auto', 'default', 'acceptEdits', 'plan', 'bypassPermissions']

interface Props {
  sessionId: string | null
  mode: PermissionMode
  onFiles: (files: File[]) => void
  onMode: (m: PermissionMode) => void
  onClose: () => void
}

export function ContextSheet(p: Props) {
  const [view, setView] = useState<'main' | 'mode' | 'mcp'>('main')
  const camera = useRef<HTMLInputElement>(null)
  const photos = useRef<HTMLInputElement>(null)
  const files = useRef<HTMLInputElement>(null)

  const pick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = Array.from(e.target.files ?? [])
    e.target.value = ''
    if (list.length) {
      p.onFiles(list)
      p.onClose()
    }
  }

  if (view === 'mode')
    return (
      <Sheet title="权限" onClose={p.onClose} onBack={() => setView('main')}>
        <div className="group">
          {MODE_ORDER.map((m) => (
            <button
              className="option"
              key={m}
              onClick={() => {
                p.onMode(m)
                setView('main')
              }}
            >
              <span className="grow">{MODE_LABELS[m]}</span>
              {m === p.mode && <Check size={20} strokeWidth={2.2} className="check" />}
            </button>
          ))}
        </div>
      </Sheet>
    )

  if (view === 'mcp' && p.sessionId) return <Connectors sessionId={p.sessionId} onBack={() => setView('main')} onClose={p.onClose} />

  return (
    <Sheet
      title="添加上下文"
      onClose={p.onClose}
      action={
        <button className="head-action" onClick={() => photos.current?.click()}>
          照片
        </button>
      }
    >
      <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={pick} />
      <input ref={photos} type="file" accept="image/*" multiple hidden onChange={pick} />
      <input ref={files} type="file" multiple hidden onChange={pick} />
      <div className="tiles">
        <button className="tile" onClick={() => camera.current?.click()}>
          <Camera size={24} strokeWidth={1.6} />
          相机
        </button>
        <button className="tile" onClick={() => photos.current?.click()}>
          <Image size={24} strokeWidth={1.6} />
          照片
        </button>
      </div>
      <button className="row-btn" onClick={() => files.current?.click()}>
        <FileUp size={19} strokeWidth={1.6} />
        <span className="grow">添加文件</span>
      </button>
      <button className="row-btn" onClick={() => setView('mode')}>
        <Zap size={19} strokeWidth={1.6} />
        <span className="grow">权限</span>
        <span className="value">{MODE_LABELS[p.mode]}</span>
        <ChevronRight size={18} color="var(--text-2)" />
      </button>
      {p.sessionId && (
        <button className="row-btn" onClick={() => setView('mcp')}>
          <Blocks size={19} strokeWidth={1.6} />
          <span className="grow">连接器</span>
          <ChevronRight size={18} color="var(--text-2)" />
        </button>
      )}
    </Sheet>
  )
}

const MCP_STATUS: Record<string, [string, string]> = {
  connected: ['已连接', 'var(--green)'],
  pending: ['连接中', 'var(--claude)'],
  'needs-auth': ['需要登录', 'var(--text-3)'],
  failed: ['连接失败', 'var(--red)'],
  disabled: ['已停用', 'var(--text-3)'],
}

function Connectors({ sessionId, onBack, onClose }: { sessionId: string; onBack: () => void; onClose: () => void }) {
  const [list, setList] = useState<McpServer[] | null>(null)
  useEffect(() => {
    api.mcp(sessionId).then(setList, () => setList([]))
  }, [sessionId])
  return (
    <Sheet title="连接器" onClose={onClose} onBack={onBack}>
      {!list && (
        <div className="empty">
          <Spinner />
        </div>
      )}
      {list && list.length === 0 && <div className="empty">发消息后显示</div>}
      {list && list.length > 0 && (
        <div className="group">
          {list.map((s) => {
            const [label, color] = MCP_STATUS[s.status] ?? [s.status, 'var(--text-3)']
            return (
              <div className="option" key={s.name}>
                <span className="status-dot" style={{ background: color }} />
                <span className="grow">{s.name.replace(/^claude\.ai /, '').replace(/^plugin:/, '')}</span>
                <span className="hint">{label}</span>
              </div>
            )
          })}
        </div>
      )}
    </Sheet>
  )
}
