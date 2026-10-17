import { useCallback, useEffect, useState } from 'react'
import type { Catalog } from '../../shared/types.ts'
import { Spinner, ToastHost } from './components/bits.tsx'
import { CATALOG_CHANGED, api, setUnauthorizedHandler, type DeviceInfo } from './lib/api.ts'
import { useRoute } from './lib/router.ts'
import { useDesktop } from './lib/useDesktop.ts'
import { closeViewer, useViewer } from './lib/viewer.ts'
import { FilePanel } from './components/FilePanel.tsx'
import { ImageViewer } from './components/ImageViewer.tsx'
import { closeFiles, useFiles } from './lib/files.ts'
import { syncPlugins } from './plugins/runtime.tsx'
import { Home } from './screens/Home.tsx'
import { Login } from './screens/Login.tsx'
import { SessionScreen } from './screens/Session.tsx'
import { Sidebar } from './screens/Sidebar.tsx'

export function App() {
  const [authed, setAuthed] = useState<boolean | null>(null)
  const [device, setDevice] = useState<DeviceInfo | null>(null)
  const [catalog, setCatalog] = useState<Catalog>({ providers: [], models: [] })
  const route = useRoute()
  const desktop = useDesktop()
  const viewer = useViewer()
  const files = useFiles()

  // Viewers belong to the thread they were opened from.
  const routeKey = route.name === 'session' ? route.id : route.name
  useEffect(() => {
    closeViewer()
    closeFiles()
  }, [routeKey])
  // Files on the left and an image on the right would squeeze the thread.
  const openedFile = files?.stack[0]?.path
  useEffect(() => {
    if (openedFile && desktop) closeViewer()
  }, [openedFile, desktop])

  const boot = useCallback(async () => {
    try {
      const { authed } = await api.me()
      setAuthed(authed)
      if (!authed) return
      const [d, c, plugins] = await Promise.all([api.device(), api.catalog(), api.plugins()])
      setDevice(d)
      setCatalog(c)
      void syncPlugins(plugins)
    } catch {
      setAuthed((a) => a ?? false)
    }
  }, [])

  useEffect(() => {
    setUnauthorizedHandler(() => setAuthed(false))
    void boot()
  }, [boot])

  // Turning plugins on or off, or setting a key, changes providers and plugin code.
  useEffect(() => {
    const refresh = () => {
      api.catalog().then(setCatalog, () => undefined)
      api.plugins().then(syncPlugins, () => undefined)
    }
    window.addEventListener(CATALOG_CHANGED, refresh)
    return () => window.removeEventListener(CATALOG_CHANGED, refresh)
  }, [])

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
        <SessionScreen key={route.id} id={route.id} device={device} catalog={catalog} />
      ) : (
        <SessionScreen key={`new:${route.name === 'new' ? route.cwd : ''}`} id={null} newCwd={route.name === 'new' ? route.cwd || undefined : undefined} device={device} catalog={catalog} />
      )
    body = (
      <div className={`desktop${viewer ? ' with-panel' : ''}${files ? ' with-files' : ''}`}>
        {files ? <FilePanel desktop /> : <Sidebar device={device} activeId={route.name === 'session' ? route.id : null} onLogout={() => setAuthed(false)} />}
        <main className="main-pane">{main}</main>
      </div>
    )
  } else if (route.name === 'session') body = <SessionScreen key={route.id} id={route.id} device={device} catalog={catalog} />
  else if (route.name === 'new') body = <SessionScreen key="new" id={null} newCwd={route.cwd || undefined} device={device} catalog={catalog} />
  else body = <Home device={device} onLogout={() => setAuthed(false)} />

  return (
    <>
      {body}
      {authed && <ImageViewer desktop={desktop} />}
      {authed && !desktop && <FilePanel desktop={false} />}
      <ToastHost />
    </>
  )
}
