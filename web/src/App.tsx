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
import { SidebarResizer } from './components/SidebarResizer.tsx'
import { useSidebarLayout } from './lib/prefs.ts'
import { PanelLeftOpen } from 'lucide-react'
import { t, useLocale } from './i18n.ts'
import { Onboarding } from './screens/Onboarding.tsx'

export function App() {
  // Everything below reads the language at render time.
  useLocale()
  const [authed, setAuthed] = useState<boolean | null>(null)
  const [needsSetup, setNeedsSetup] = useState(false)
  const [onboarding, setOnboarding] = useState(false)
  const [device, setDevice] = useState<DeviceInfo | null>(null)
  const [catalog, setCatalog] = useState<Catalog>({ providers: [], models: [] })
  const route = useRoute()
  const desktop = useDesktop()
  const viewer = useViewer()
  const files = useFiles()
  const sb = useSidebarLayout()

  // Cmd/Ctrl+B shows or hides the sidebar.
  useEffect(() => {
    if (!desktop) return
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'b') {
        e.preventDefault()
        sb.setHidden(!sb.hidden)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [desktop, sb])

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
      const { authed, needsSetup } = await api.me()
      setNeedsSetup(needsSetup)
      setAuthed(authed)
      if (!authed) return
      const [d, c, plugins, ag] = await Promise.all([api.device(), api.catalog(), api.plugins(), api.agents()])
      setDevice(d)
      setCatalog(c)
      setOnboarding(!ag.onboarded)
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
  else if (!authed) body = <Login onDone={boot} setup={needsSetup} />
  else if (onboarding) body = <Onboarding onDone={() => setOnboarding(false)} />
  else if (desktop) {
    // Desktop: sidebar + thread. With nothing selected the pane is a new session.
    const main =
      route.name === 'session' ? (
        <SessionScreen key={route.id} id={route.id} device={device} catalog={catalog} />
      ) : (
        <SessionScreen key={`new:${route.name === 'new' ? route.cwd : ''}`} id={null} newCwd={route.name === 'new' ? route.cwd || undefined : undefined} device={device} catalog={catalog} />
      )
    body = (
      <div
        className={`desktop${viewer ? ' with-panel' : ''}${files ? ' with-files' : ''}${sb.hidden && !files ? ' sb-hidden' : ''}`}
        style={sb.width ? ({ '--sb-w': `${sb.width}px` } as React.CSSProperties) : undefined}
      >
        {files ? (
          <FilePanel desktop />
        ) : (
          !sb.hidden && <Sidebar device={device} activeId={route.name === 'session' ? route.id : null} onLogout={() => setAuthed(false)} onHide={() => sb.setHidden(true)} />
        )}
        <main className="main-pane">
          {main}
          {sb.hidden && !files && (
            <button className="sb-show" onClick={() => sb.setHidden(false)} aria-label={t('nav.showSidebar')} title={`${t('nav.showSidebar')} (⌘B)`}>
              <PanelLeftOpen size={19} strokeWidth={1.7} />
            </button>
          )}
        </main>
        {!files && !sb.hidden && <SidebarResizer onWidth={sb.setWidth} onHide={() => sb.setHidden(true)} />}
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
