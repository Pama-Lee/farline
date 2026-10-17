import { createRoot } from 'react-dom/client'
import { App } from './App.tsx'
import { trackViewport } from './lib/device.ts'
import { preloadStyles } from './plugins/runtime.tsx'
import './styles.css'
import './theme.css'

trackViewport()
preloadStyles()

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register('/sw.js').catch(() => undefined)
}

createRoot(document.getElementById('root')!).render(<App />)
