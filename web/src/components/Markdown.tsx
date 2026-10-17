import DOMPurify from 'dompurify'
import hljs from 'highlight.js/lib/core'
import bash from 'highlight.js/lib/languages/bash'
import css from 'highlight.js/lib/languages/css'
import diff from 'highlight.js/lib/languages/diff'
import go from 'highlight.js/lib/languages/go'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import python from 'highlight.js/lib/languages/python'
import sql from 'highlight.js/lib/languages/sql'
import swift from 'highlight.js/lib/languages/swift'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'
import yaml from 'highlight.js/lib/languages/yaml'
import cpp from 'highlight.js/lib/languages/cpp'
import dockerfile from 'highlight.js/lib/languages/dockerfile'
import ini from 'highlight.js/lib/languages/ini'
import java from 'highlight.js/lib/languages/java'
import kotlin from 'highlight.js/lib/languages/kotlin'
import markdown from 'highlight.js/lib/languages/markdown'
import rust from 'highlight.js/lib/languages/rust'
import { Marked } from 'marked'
import { memo, useContext, useEffect, useMemo, useRef } from 'react'
import { FileLinkContext, isLocalHref, looksLikePath, openFile, pushFile, resolveFiles } from '../lib/files.ts'
import { openViewer } from '../lib/viewer.ts'
import { toast } from './bits.tsx'

const langs = { bash, cpp, css, diff, dockerfile, go, ini, java, javascript, json, kotlin, markdown, python, rust, sql, swift, typescript, xml, yaml }
for (const [name, lang] of Object.entries(langs)) hljs.registerLanguage(name, lang)
hljs.registerAliases(['sh', 'shell', 'zsh', 'console'], { languageName: 'bash' })
hljs.registerAliases(['js', 'jsx', 'mjs'], { languageName: 'javascript' })
hljs.registerAliases(['ts', 'tsx'], { languageName: 'typescript' })
hljs.registerAliases(['html', 'vue', 'svg'], { languageName: 'xml' })
hljs.registerAliases(['yml', 'hcl'], { languageName: 'yaml' })
hljs.registerAliases(['py'], { languageName: 'python' })
hljs.registerAliases(['cjs'], { languageName: 'javascript' })
hljs.registerAliases(['md', 'mdx'], { languageName: 'markdown' })
hljs.registerAliases(['rs'], { languageName: 'rust' })
hljs.registerAliases(['kt', 'kts'], { languageName: 'kotlin' })
hljs.registerAliases(['c', 'h', 'cc', 'hpp'], { languageName: 'cpp' })
hljs.registerAliases(['toml', 'conf', 'env'], { languageName: 'ini' })

const marked = new Marked({
  gfm: true,
  renderer: {
    code({ text, lang }) {
      const l = (lang ?? '').split(/\s/)[0]
      const html = l && hljs.getLanguage(l) ? hljs.highlight(text, { language: l }).value : escapeHtml(text)
      return `<pre><code>${html}</code></pre>`
    },
    link({ href, tokens }) {
      return `<a href="${escapeAttr(href)}" target="_blank" rel="noopener noreferrer">${this.parser.parseInline(tokens)}</a>`
    },
  },
})

export function highlight(code: string, lang: string): string {
  return DOMPurify.sanitize(hljs.getLanguage(lang) ? hljs.highlight(code, { language: lang }).value : escapeHtml(code))
}

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function escapeAttr(s: string) {
  return escapeHtml(s).replace(/"/g, '&quot;')
}

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank')
    node.setAttribute('rel', 'noopener noreferrer')
  }
})

export const Markdown = memo(function Markdown({ text }: { text: string }) {
  const html = useMemo(() => DOMPurify.sanitize(marked.parse(text, { async: false }) as string), [text])
  const scope = useContext(FileLinkContext)
  const ref = useRef<HTMLDivElement>(null)

  // Paths in inline code and relative links become file links once the
  // server confirms they exist.
  useEffect(() => {
    const el = ref.current
    if (!el || !scope) return
    if (scope.base) {
      for (const img of el.querySelectorAll('img')) {
        const src = img.getAttribute('src') ?? ''
        if (isLocalHref(src)) img.src = `/api/fs/raw?path=${encodeURIComponent(src.startsWith('/') ? src : `${scope.base}/${src}`)}`
      }
    }
    const targets: { el: HTMLElement; raw: string }[] = []
    for (const c of el.querySelectorAll('code')) {
      const t = c.textContent?.trim() ?? ''
      if (!c.closest('pre') && looksLikePath(t)) targets.push({ el: c, raw: t })
    }
    for (const a of el.querySelectorAll('a[href]')) {
      const href = a.getAttribute('href') ?? ''
      if (isLocalHref(href)) targets.push({ el: a as HTMLElement, raw: safeDecode(href) })
    }
    if (!targets.length) return
    let alive = true
    void resolveFiles([...new Set(targets.map((t) => t.raw))], scope).then((found) => {
      if (!alive) return
      for (const t of targets) {
        const r = found[t.raw]
        if (!r) {
          t.el.dataset.missing = '1'
          continue
        }
        t.el.classList.add('file-link')
        t.el.dataset.file = r.path
        if (r.line) t.el.dataset.line = String(r.line)
        t.el.title = r.path
      }
    })
    return () => {
      alive = false
    }
  }, [html, scope])

  return (
    <div
      ref={ref}
      className="md"
      dangerouslySetInnerHTML={{ __html: html }}
      onClick={(e) => {
        const el = e.target as HTMLElement
        const file = el.closest<HTMLElement>('[data-file]')
        if (file) {
          e.preventDefault()
          const target = { path: file.dataset.file!, line: Number(file.dataset.line) || undefined }
          // Inside the file panel, keep the way back to the document.
          if (scope?.base) pushFile(target)
          else openFile(target, scope?.sessionId ?? null)
          return
        }
        const a = el.closest('a')
        if (a && isLocalHref(a.getAttribute('href') ?? '')) {
          e.preventDefault()
          if (a.dataset.missing) toast('找不到这个文件')
          return
        }
        if (el.tagName !== 'IMG') return
        e.preventDefault()
        const all = [...(e.currentTarget as HTMLElement).querySelectorAll('img')].map((img) => ({ url: img.src, name: img.alt || undefined }))
        openViewer(all, all.findIndex((im) => im.url === (el as HTMLImageElement).src))
      }}
    />
  )
})

function safeDecode(s: string) {
  try {
    return decodeURI(s)
  } catch {
    return s
  }
}
