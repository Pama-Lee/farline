import { useEffect, useState } from 'react'

export type Route = { name: 'home' } | { name: 'session'; id: string } | { name: 'new'; cwd: string }

function parse(): Route {
  const { pathname, search } = window.location
  const m = pathname.match(/^\/s\/([\w-]+)/)
  if (m) return { name: 'session', id: m[1] }
  if (pathname === '/new') return { name: 'new', cwd: new URLSearchParams(search).get('cwd') ?? '' }
  return { name: 'home' }
}

const listeners = new Set<() => void>()
// In-app history depth, so "back" never leaves the app on a cold start.
let depth = 0

window.addEventListener('popstate', () => {
  depth = Math.max(0, depth - 1)
  listeners.forEach((l) => l())
})

export function navigate(path: string, replace = false) {
  if (replace) history.replaceState(null, '', path)
  else {
    history.pushState(null, '', path)
    depth++
  }
  listeners.forEach((l) => l())
}

export function back() {
  if (depth > 0) history.back()
  else navigate('/', true)
}

export function useRoute(): Route {
  const [route, setRoute] = useState(parse)
  useEffect(() => {
    const update = () => setRoute(parse())
    listeners.add(update)
    return () => {
      listeners.delete(update)
    }
  }, [])
  return route
}
