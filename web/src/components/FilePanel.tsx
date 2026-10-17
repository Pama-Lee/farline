// Files and folders opened from a conversation. Desktop: the left column, in
// place of the session list. Phones: full screen, sliding in from the left.
import { ChevronLeft, Copy, Download, File, FileCode2, Folder, X } from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { FileRead } from '../../../shared/types.ts'
import { api } from '../lib/api.ts'
import { FileLinkContext, closeFiles, popFile, pushFile, useFiles } from '../lib/files.ts'
import { basename, copyText, shortPath } from '../lib/format.ts'
import { Markdown, highlight } from './Markdown.tsx'
import { Spinner, toast } from './bits.tsx'

const LINE_H = 20
// Highlighting very large files freezes the page; show them plain.
const HIGHLIGHT_LIMIT = 300 * 1024
const MARKDOWN = /\.(md|mdx|markdown)$/i

function size(n: number) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

function lang(path: string) {
  const name = basename(path).toLowerCase()
  if (name === 'dockerfile') return 'dockerfile'
  if (name === 'makefile') return 'bash'
  return name.includes('.') ? name.split('.').pop()! : ''
}

function rawUrl(path: string, download = false) {
  return `/api/fs/raw?path=${encodeURIComponent(path)}${download ? '&download=1' : ''}`
}

export function FilePanel({ desktop }: { desktop: boolean }) {
  const st = useFiles()
  const cur = st?.stack[st.stack.length - 1]
  const [data, setData] = useState<FileRead | 'missing' | null>(null)
  const [source, setSource] = useState(false)

  useEffect(() => {
    if (!cur) return
    let alive = true
    setData(null)
    setSource(false)
    api.readFile(cur.path).then(
      (d) => alive && setData(d),
      () => alive && setData('missing'),
    )
    return () => {
      alive = false
    }
  }, [cur?.path])

  useEffect(() => {
    if (!st) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !document.querySelector('.sheet') && closeFiles()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [st])

  if (!st || !cur) return null
  const file = data && data !== 'missing' ? data : null
  const isMd = file?.kind === 'text' && MARKDOWN.test(file.path)
  const canGoBack = st.stack.length > 1

  return (
    <aside className={desktop ? 'file-panel' : 'file-full'} role="dialog" aria-label="文件">
      <div className="fp-head">
        {canGoBack || !desktop ? (
          <button className="fp-btn" onClick={canGoBack ? popFile : closeFiles} aria-label="返回" title="返回">
            <ChevronLeft size={22} strokeWidth={1.8} />
          </button>
        ) : null}
        <div className="fp-title">
          <div className="t">{basename(cur.path)}</div>
          <div className="s" title={cur.path}>
            {shortPath(cur.path)}
          </div>
        </div>
        {isMd && (
          <button className={`fp-toggle${source ? ' on' : ''}`} onClick={() => setSource((v) => !v)} title={source ? '预览' : '源码'}>
            <FileCode2 size={18} strokeWidth={1.7} />
          </button>
        )}
        <button
          className="fp-btn"
          onClick={async () => {
            await copyText(cur.path)
            toast('已复制路径')
          }}
          aria-label="复制路径"
          title="复制路径"
        >
          <Copy size={17} strokeWidth={1.7} />
        </button>
        {file && file.kind !== 'dir' && (
          <a className="fp-btn" href={rawUrl(cur.path, true)} aria-label="下载" title="下载">
            <Download size={18} strokeWidth={1.7} />
          </a>
        )}
        {desktop && (
          <button className="fp-btn" onClick={closeFiles} aria-label="关闭" title="关闭">
            <X size={20} strokeWidth={1.7} />
          </button>
        )}
      </div>

      <div className="fp-body">
        {data === null && (
          <div className="empty">
            <Spinner />
          </div>
        )}
        {data === 'missing' && <div className="empty">找不到这个文件</div>}
        {file?.kind === 'dir' && <DirView dir={file} />}
        {file?.kind === 'image' && (
          <div className="fp-image">
            <img src={rawUrl(file.path)} alt="" />
          </div>
        )}
        {file?.kind === 'binary' && (
          <div className="empty">
            无法预览这个文件
            <a className="fp-download" href={rawUrl(file.path, true)}>
              下载 · {size(file.size)}
            </a>
          </div>
        )}
        {file?.kind === 'text' &&
          (isMd && !source ? (
            <FileLinkContext.Provider value={{ sessionId: st.sessionId, base: file.path.replace(/\/[^/]*$/, '') }}>
              <div className="fp-md">
                <Markdown text={file.text ?? ''} />
              </div>
            </FileLinkContext.Provider>
          ) : (
            <CodeView text={file.text ?? ''} path={file.path} line={cur.line} />
          ))}
        {file?.truncated && <div className="fp-note">文件较大，只显示了开头 {size(file.text?.length ?? 0)}</div>}
      </div>
    </aside>
  )
}

function DirView({ dir }: { dir: FileRead }) {
  const entries = dir.entries ?? []
  if (!entries.length) return <div className="empty">空文件夹</div>
  return (
    <div className="fp-list">
      {entries.map((e) => (
        <button key={e.name} className={`fp-entry${e.name.startsWith('.') ? ' hidden' : ''}`} onClick={() => pushFile({ path: `${dir.path.replace(/\/$/, '')}/${e.name}` })}>
          {e.dir ? <Folder size={18} strokeWidth={1.6} /> : <File size={18} strokeWidth={1.6} />}
          <span className="n">{e.name}</span>
          {!e.dir && e.size !== undefined && <span className="sz">{size(e.size)}</span>}
        </button>
      ))}
    </div>
  )
}

function CodeView({ text, path, line }: { text: string; path: string; line?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const lines = useMemo(() => text.split('\n').length - (text.endsWith('\n') ? 1 : 0), [text])
  const html = useMemo(() => {
    const l = lang(path)
    return text.length <= HIGHLIGHT_LIMIT && l ? highlight(text, l) : highlight(text, '')
  }, [text, path])
  const gutter = useMemo(() => Array.from({ length: Math.max(lines, 1) }, (_, i) => i + 1).join('\n'), [lines])

  // Open at the line the message pointed to.
  useLayoutEffect(() => {
    const el = ref.current?.closest('.fp-body')
    if (el && line) el.scrollTop = Math.max(0, (line - 1) * LINE_H - 120)
  }, [line, html])

  return (
    <div className="fp-code" ref={ref}>
      <pre className="fp-gutter" aria-hidden>
        {gutter}
      </pre>
      <pre className="fp-src">
        <code dangerouslySetInnerHTML={{ __html: html }} />
      </pre>
      {line && line <= lines && <div className="fp-hl" style={{ top: 12 + (line - 1) * LINE_H }} />}
    </div>
  )
}
