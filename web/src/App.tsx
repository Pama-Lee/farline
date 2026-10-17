import { useCallback, useEffect, useState } from 'react'
import type { ModelOption } from '../../shared/types.ts'
import { Spinner, ToastHost } from './components/bits.tsx'
import { api, setUnauthorizedHandler, type DeviceInfo } from './lib/api.ts'
import { useRoute } from './lib/router.ts'
import { useDesktop } from './lib/useDesktop.ts'
import { closeViewer, useViewer } from './lib/viewer.ts'
import { ImageViewer } from './components/ImageViewer.tsx'
import { Home } from './screens/Home.tsx'
import { Login } from './screens/Login.tsx'
import { SessionScreen } from './screens/Session.tsx'
import { Sidebar } from './screens/Sidebar.tsx'

export function App() {
  const [authed, setAuthed] = useState<boolean | null>(null)
  const [device, setDevice] = useState<DeviceInfo | null>(null)
  const [models, setModels] = useState<ModelOption[]>([])
  const route = useRoute()
  const desktop = useDesktop()
  const viewer = useViewer()

  // A viewer belongs to the thread it was opened from.
  const routeKey = route.name === 'session' ? route.id : route.name
  useEffect(() => closeViewer(), [routeKey])

  const boot = useCallback(async () => {
    try {
      const { authed } = await api.me()
      setAuthed(authed)
      if (!authed) return
      const [d, m] = await Promise.all([api.device(), api.models()])
      setDevice(d)
      setModels(m)
    } catch {
      setAuthed((a) => a ?? false)
    }
  }, [])

  useEffect(() => {
    setUnauthorizedHandler(() => setAuthed(false))
    void boot()
  }, [boot])

  // Refresh prefs (last directory, model) whenever we come back home.
  useEffect(() => {
    if (authed && route.name === 'home') api.device().then(setDevice, () => undefined)
  }, [authed, route.name])

  let body
  if (authed === null)
    body = (
      <div className="screen login">
        <Spinner />
      </div>
    )
  else if (!authed) body = <Login onDone={boot} />
  else if (desktop) {
    // Desktop: sidebar + thread. With nothing selected the pane is a new session.
    const main =
      route.name === 'session' ? (
        <SessionScreen key={route.id} id={route.id} device={device} models={models} />
      ) : (
        <SessionScreen key={`new:${route.name === 'new' ? route.cwd : ''}`} id={null} newCwd={route.name === 'new' ? route.cwd || undefined : undefined} device={device} models={models} />
      )
    body = (
      <div className={`desktop${viewer ? ' with-panel' : ''}`}>
        <Sidebar device={device} activeId={route.name === 'session' ? route.id : null} onLogout={() => setAuthed(false)} />
        <main className="main-pane">{main}</main>
      </div>
    )
  } else if (route.name === 'session') body = <SessionScreen key={route.id} id={route.id} device={device} models={models} />
  else if (route.name === 'new') body = <SessionScreen key="new" id={null} newCwd={route.cwd || undefined} device={device} models={models} />
  else body = <Home device={device} onLogout={() => setAuthed(false)} />

  return (
    <>
      {body}
      {authed && <ImageViewer desktop={desktop} />}
      <ToastHost />
    </>
  )
}
