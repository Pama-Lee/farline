// In-page image viewer state: a right-hand panel on desktop, full screen on phones.
import { useEffect, useState } from 'react'

export interface ViewerImage {
  url: string
  name?: string
}

export interface ViewerState {
  images: ViewerImage[]
  index: number
}

let current: ViewerState | null = null
const listeners = new Set<(s: ViewerState | null) => void>()

function emit(s: ViewerState | null) {
  current = s
  listeners.forEach((l) => l(s))
}

export function openViewer(images: ViewerImage[], index = 0) {
  if (images.length) emit({ images, index: Math.max(0, Math.min(index, images.length - 1)) })
}

export function closeViewer() {
  emit(null)
}

export function stepViewer(delta: number) {
  if (!current) return
  const n = current.images.length
  emit({ ...current, index: (current.index + delta + n) % n })
}

export function setViewerIndex(index: number) {
  if (current) emit({ ...current, index })
}

export function useViewer() {
  const [s, set] = useState(current)
  useEffect(() => {
    listeners.add(set)
    return () => {
      listeners.delete(set)
    }
  }, [])
  return s
}
