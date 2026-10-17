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
import { Marked } from 'marked'
import { memo, useMemo } from 'react'
import { openViewer } from '../lib/viewer.ts'

const langs = { bash, css, diff, go, javascript, json, python, sql, swift, typescript, xml, yaml }
for (const [name, lang] of Object.entries(langs)) hljs.registerLanguage(name, lang)
hljs.registerAliases(['sh', 'shell', 'zsh', 'console'], { languageName: 'bash' })
hljs.registerAliases(['js', 'jsx', 'mjs'], { languageName: 'javascript' })
hljs.registerAliases(['ts', 'tsx'], { languageName: 'typescript' })
hljs.registerAliases(['html', 'vue', 'svg'], { languageName: 'xml' })
hljs.registerAliases(['yml', 'hcl'], { languageName: 'yaml' })
hljs.registerAliases(['py'], { languageName: 'python' })

const marked = new Marked({
  gfm: true,
  renderer: {
    code({ text, lang }) {
      const l = (lang ?? '').split(/\s/)[0]
      const html = l && hljs.getLanguage(l) ? hljs.highlight(text, { language: l }).value : escapeHtml(text)
      return `<pre><code>${html}</code></pre>`
    },
    link({ href, text }) {
      return `<a href="${escapeAttr(href)}" target="_blank" rel="noopener noreferrer">${text}</a>`
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
  return (
    <div
      className="md"
      dangerouslySetInnerHTML={{ __html: html }}
      onClick={(e) => {
        const el = e.target as HTMLElement
        if (el.tagName !== 'IMG') return
        e.preventDefault()
        const all = [...(e.currentTarget as HTMLElement).querySelectorAll('img')].map((img) => ({ url: img.src, name: img.alt || undefined }))
        openViewer(all, all.findIndex((im) => im.url === (el as HTMLImageElement).src))
      }}
    />
  )
})
