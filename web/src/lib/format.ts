export function relTime(ms: number): string {
  const d = Date.now() - ms
  if (d < 60_000) return '刚刚'
  if (d < 3600_000) return `${Math.floor(d / 60_000)} 分钟前`
  if (d < 86400_000) return `${Math.floor(d / 3600_000)} 小时前`
  const days = Math.floor(d / 86400_000)
  if (days < 7) return `${days} 天前`
  const dt = new Date(ms)
  return `${dt.getMonth() + 1}月${dt.getDate()}日`
}

export function basename(p: string): string {
  if (!p) return ''
  const parts = p.replace(/\/+$/, '').split('/')
  return parts[parts.length - 1] || '/'
}

export function shortPath(p: string): string {
  return p.replace(/^\/home\/[^/]+/, '~')
}

export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    const ta = document.createElement('textarea')
    ta.value = text
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    ta.remove()
  }
}
