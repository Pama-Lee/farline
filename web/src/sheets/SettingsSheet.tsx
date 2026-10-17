import { ArrowUpRight, Bell, Check, ChevronRight, Compass, Download, Languages, ListTree, LogOut, Palette, Puzzle } from 'lucide-react'
import { Fragment, useCallback, useEffect, useState } from 'react'
import type { MarketPlugin, PluginInfo, PluginStatus, SettingFieldView } from '../../../shared/types.ts'
import { Sheet } from '../components/Sheet.tsx'
import { Spinner, toast } from '../components/bits.tsx'
import { CATALOG_CHANGED, api } from '../lib/api.ts'
import { currentPushSubscription, disablePush, enablePush, isStandalone, pushSupported } from '../lib/device.ts'
import { PluginBoundary, syncPlugins, usePlugins } from '../plugins/runtime.tsx'
import { setStepsView, useStepsView, type StepsView } from '../lib/prefs.ts'
import { LOCALES } from '../../../shared/i18n/index.ts'
import { labelMap, langPref, setLangPref, t, type MessageKey } from '../i18n.ts'

type View = { name: 'main' } | { name: 'plugins' } | { name: 'install' } | { name: 'market' } | { name: 'skins' } | { name: 'steps' } | { name: 'language' } | { name: 'plugin'; id: string; back: 'main' | 'plugins' }

const STEPS_VIEWS: { id: StepsView; label: MessageKey }[] = [
  { id: 'auto', label: 'common.auto' },
  { id: 'sheet', label: 'settings.toolCalls.sheet' },
  { id: 'inline', label: 'settings.toolCalls.inline' },
]

const SOURCE = labelMap<PluginInfo['source']>('plugins.source.')

export function SettingsSheet({ onClose, onLogout }: { onClose: () => void; onLogout: () => void }) {
  const [push, setPush] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [view, setView] = useState<View>({ name: 'main' })
  const [plugins, setPlugins] = useState<PluginInfo[] | null>(null)
  const [statuses, setStatuses] = useState<Record<string, PluginStatus>>({})
  const { settingsPanels } = usePlugins()
  const stepsView = useStepsView()
  // The skin being switched to (null: the default look) while it loads.
  const [switching, setSwitching] = useState<string | null | undefined>(undefined)

  const loadStatus = useCallback((p: PluginInfo) => {
    if (p.state !== 'active' || !p.hasStatus) return
    api.pluginStatus(p.id).then((st) => setStatuses((s) => ({ ...s, [p.id]: st })), () => undefined)
  }, [])

  useEffect(() => {
    currentPushSubscription().then((s) => setPush(!!s), () => setPush(false))
    api.plugins().then((list) => {
      setPlugins(list)
      list.forEach(loadStatus)
    }, () => setPlugins([]))
  }, [loadStatus])

  // Providers, models and plugin code may all have changed.
  const changed = (info: PluginInfo) => {
    setPlugins((list) => list?.map((p) => (p.id === info.id ? info : p)) ?? null)
    setStatuses(({ [info.id]: _, ...rest }) => rest)
    loadStatus(info)
    window.dispatchEvent(new Event(CATALOG_CHANGED))
  }

  const togglePush = async () => {
    if (busy) return
    if (!pushSupported()) {
      toast(t(isStandalone() ? 'settings.noPush' : 'settings.addToHome'))
      return
    }
    setBusy(true)
    try {
      if (push) {
        await disablePush()
        setPush(false)
      } else {
        const ok = await enablePush()
        setPush(ok)
        if (ok) await api.pushTest()
        else toast(t('settings.pushDenied'))
      }
    } catch (e: any) {
      toast(e?.message ?? t('common.failed'))
    } finally {
      setBusy(false)
    }
  }

  // The switch flips at once; it flips back if the server says no.
  const toggle = async (p: PluginInfo) => {
    setPlugins((list) => list?.map((x) => (x.id === p.id ? { ...x, enabled: !p.enabled } : x)) ?? null)
    try {
      changed(await api.setPluginEnabled(p.id, !p.enabled))
    } catch (e: any) {
      setPlugins((list) => list?.map((x) => (x.id === p.id ? { ...x, enabled: p.enabled } : x)) ?? null)
      toast(e?.message ?? t('common.failed'))
    }
  }

  if (view.name === 'plugin') {
    const p = plugins?.find((x) => x.id === view.id)
    if (p)
      return (
        <Sheet title={p.name} onClose={onClose} onBack={() => setView(view.back === 'main' ? { name: 'main' } : { name: 'plugins' })} size={p.settings.length > 2 || settingsPanels.some((x) => x.pluginId === p.id) ? 'tall' : 'auto'}>
          <PluginDetail
            info={p}
            status={statuses[p.id]}
            onToggle={() => void toggle(p)}
            onChange={changed}
            onRemoved={async () => {
              setPlugins(await api.plugins().catch(() => null))
              window.dispatchEvent(new Event(CATALOG_CHANGED))
              setView({ name: 'plugins' })
            }}
          />
        </Sheet>
      )
  }

  const skins = (plugins ?? []).filter((p) => p.skin)
  const activeSkin = skins.find((p) => p.enabled && p.state === 'active')

  // Stays busy until the new look is on screen.
  const pickSkin = async (id: string | null) => {
    if (switching !== undefined || (activeSkin?.id ?? null) === id) return
    setSwitching(id)
    try {
      if (id) await api.setPluginEnabled(id, true)
      else if (activeSkin) await api.setPluginEnabled(activeSkin.id, false)
      const list = await api.plugins()
      await syncPlugins(list)
      setPlugins(list)
      window.dispatchEvent(new Event(CATALOG_CHANGED))
    } catch (e: any) {
      toast(e?.message ?? t('common.failed'))
    } finally {
      setSwitching(undefined)
    }
  }

  if (view.name === 'skins')
    return (
      <Sheet title={t('settings.appearance')} onClose={onClose} onBack={() => setView({ name: 'main' })}>
        <div className="group">
          {[{ id: null, name: t('common.default') }, ...skins].map((k) => {
            const target = switching !== undefined ? switching : (activeSkin?.id ?? null)
            return (
              <button className="option" key={k.id ?? 'default'} disabled={switching !== undefined && switching !== k.id} onClick={() => void pickSkin(k.id)}>
                <span className="grow">{k.name}</span>
                {switching === k.id ? <Spinner size={18} /> : target === k.id && <Check size={20} strokeWidth={2.2} className="check" />}
              </button>
            )
          })}
        </div>
      </Sheet>
    )

  if (view.name === 'language')
    return (
      <Sheet title={t('settings.language')} onClose={onClose} onBack={() => setView({ name: 'main' })}>
        <div className="group">
          {[{ id: 'auto' as const, label: t('common.auto') }, ...LOCALES].map((o) => (
            <button
              className="option"
              key={o.id}
              onClick={() => {
                setLangPref(o.id)
                // Plugin names and model labels come from the server in the new language.
                api.plugins().then(setPlugins, () => undefined)
                window.dispatchEvent(new Event(CATALOG_CHANGED))
              }}
            >
              <span className="grow">{o.label}</span>
              {langPref() === o.id && <Check size={20} strokeWidth={2.2} className="check" />}
            </button>
          ))}
        </div>
      </Sheet>
    )

  if (view.name === 'steps')
    return (
      <Sheet title={t('settings.toolCalls')} onClose={onClose} onBack={() => setView({ name: 'main' })}>
        <div className="group">
          {STEPS_VIEWS.map((o) => (
            <button className="option" key={o.id} onClick={() => setStepsView(o.id)}>
              <span className="grow">{t(o.label)}</span>
              {stepsView === o.id && <Check size={20} strokeWidth={2.2} className="check" />}
            </button>
          ))}
        </div>
      </Sheet>
    )

  if (view.name === 'market')
    return (
      <Sheet title={t('plugins.discover')} onClose={onClose} onBack={() => setView({ name: 'plugins' })} size="tall">
        <Market
          onInstalled={(info) => {
            setPlugins((list) => [...(list ?? []).filter((x) => x.id !== info.id), info])
            loadStatus(info)
            window.dispatchEvent(new Event(CATALOG_CHANGED))
          }}
          onOpen={(id) => setView({ name: 'plugin', id, back: 'plugins' })}
        />
      </Sheet>
    )

  if (view.name === 'install')
    return (
      <Sheet title={t('plugins.installFromGitHub')} onClose={onClose} onBack={() => setView({ name: 'plugins' })}>
        <InstallForm
          onInstalled={(info) => {
            setPlugins((list) => [...(list ?? []).filter((x) => x.id !== info.id), info])
            loadStatus(info)
            window.dispatchEvent(new Event(CATALOG_CHANGED))
            setView({ name: 'plugin', id: info.id, back: 'plugins' })
          }}
        />
      </Sheet>
    )

  if (view.name === 'plugins')
    return (
      <Sheet title={t('settings.plugins')} onClose={onClose} onBack={() => setView({ name: 'main' })}>
        {!plugins ? (
          <div className="empty">
            <Spinner />
          </div>
        ) : plugins.length === 0 ? (
          <div className="empty">{t('plugins.none')}</div>
        ) : (
          <div className="group">
            {plugins.map((p) => (
              <div className="option tall" key={p.id}>
                <button className="grow plain" onClick={() => setView({ name: 'plugin', id: p.id, back: 'plugins' })}>
                  {p.name}
                  <span className={`desc${p.state === 'error' ? ' danger' : ''}`}>
                    {p.state === 'error' ? t('plugins.error') : `${p.version} · ${SOURCE[p.source]}`}
                  </span>
                </button>
                <button className={`switch${p.enabled ? ' on' : ''}`} onClick={() => void toggle(p)} aria-label={t(p.enabled ? 'common.disable' : 'common.enable')} />
              </div>
            ))}
          </div>
        )}
        <button className="row-btn" style={{ marginTop: 12 }} onClick={() => setView({ name: 'market' })}>
          <Compass size={19} strokeWidth={1.6} />
          <span className="grow">{t('plugins.discover')}</span>
          <ChevronRight size={18} color="var(--text-3)" />
        </button>
        <button className="row-btn" onClick={() => setView({ name: 'install' })}>
          <Download size={19} strokeWidth={1.6} />
          <span className="grow">{t('plugins.installFromGitHub')}</span>
          <ChevronRight size={18} color="var(--text-3)" />
        </button>
      </Sheet>
    )

  // Enabled plugins with something to set or show get a row of their own.
  const configurable = (plugins ?? []).filter(
    (p) => p.state === 'active' && (p.settings.length > 0 || p.hasStatus || settingsPanels.some((x) => x.pluginId === p.id)),
  )

  return (
    <Sheet title={t('settings.title')} onClose={onClose}>
      <button className="row-btn" onClick={togglePush}>
        <Bell size={19} strokeWidth={1.6} />
        <span className="grow">{t('settings.notifications')}</span>
        <span className={`switch${push ? ' on' : ''}`} />
      </button>
      {configurable.length > 0 && (
        <div className="group">
          {configurable.map((p) => {
            const st = statuses[p.id]
            return (
              <button className="option" key={p.id} onClick={() => setView({ name: 'plugin', id: p.id, back: 'main' })}>
                <span className="grow">{p.name}</span>
                {st?.summary && <span className={`hint${st.tone === 'danger' ? ' danger' : ''}`}>{st.summary}</span>}
                <ChevronRight size={18} color="var(--text-3)" />
              </button>
            )
          })}
        </div>
      )}
      {skins.length > 0 && (
        <button className="row-btn" onClick={() => setView({ name: 'skins' })}>
          <Palette size={19} strokeWidth={1.6} />
          <span className="grow">{t('settings.appearance')}</span>
          <span className="value">{activeSkin?.name ?? t('common.default')}</span>
        </button>
      )}
      <button className="row-btn" onClick={() => setView({ name: 'language' })}>
        <Languages size={19} strokeWidth={1.6} />
        <span className="grow">{t('settings.language')}</span>
        <span className="value">{langPref() === 'auto' ? t('common.auto') : LOCALES.find((l) => l.id === langPref())?.label}</span>
      </button>
      <button className="row-btn" onClick={() => setView({ name: 'steps' })}>
        <ListTree size={19} strokeWidth={1.6} />
        <span className="grow">{t('settings.toolCalls')}</span>
        <span className="value">{t(STEPS_VIEWS.find((o) => o.id === stepsView)!.label)}</span>
      </button>
      <button className="row-btn" onClick={() => setView({ name: 'plugins' })}>
        <Puzzle size={19} strokeWidth={1.6} />
        <span className="grow">{t('settings.plugins')}</span>
        <span className="value">{plugins ? plugins.filter((p) => p.state === 'active').length : ''}</span>
      </button>
      <button
        className="row-btn"
        onClick={async () => {
          await api.logout().catch(() => undefined)
          onLogout()
        }}
      >
        <LogOut size={19} strokeWidth={1.6} />
        <span className="grow">{t('settings.signOut')}</span>
      </button>
    </Sheet>
  )
}

function Market({ onInstalled, onOpen }: { onInstalled: (p: PluginInfo) => void; onOpen: (id: string) => void }) {
  const [list, setList] = useState<MarketPlugin[] | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const load = (refresh = false) =>
    api.market(refresh).then(
      (l) => (setList(l), setErr('')),
      (e) => setErr(e?.message ?? t('common.loadFailed')),
    )
  useEffect(() => void load(), [])

  const install = async (m: MarketPlugin) => {
    if (busy || !confirm(t('plugins.confirmInstallNamed', { name: m.name }))) return
    setBusy(m.repo)
    try {
      const info = await api.installPlugin(m.repo)
      toast(t('plugins.installed', { name: info.name }))
      onInstalled(info)
      await load()
    } catch (e: any) {
      toast(e?.message ?? t('plugins.installFailed'))
    } finally {
      setBusy(null)
    }
  }

  if (err && !list) return <div className="empty">{err}</div>
  if (!list)
    return (
      <div className="empty">
        <Spinner />
      </div>
    )
  if (!list.length) return <div className="empty">{t('plugins.marketEmpty')}</div>
  return (
    <div className="group">
      {list.map((m) => {
        const meta = [m.author, m.version && `v${m.version}`, m.stars ? `★ ${m.stars}` : '', m.skin ? t('plugins.skin') : ''].filter(Boolean).join(' · ')
        return (
          <div className="option market-item" key={m.repo}>
            <a className="grow plain" href={m.url} target="_blank" rel="noreferrer">
              <span className="mk-name">{m.name}</span>
              {m.description && <span className="desc mk-desc">{m.description}</span>}
              <span className="desc">{meta}</span>
              {!m.compatible && <span className="desc danger">{m.engines ? t('plugins.needsFarline', { range: m.engines }) : t('plugins.needsApi', { v: m.apiVersion })}</span>}
            </a>
            {m.installed?.fromHere || (m.installed && !m.compatible) ? (
              <button className="mk-btn ghost" onClick={() => onOpen(m.id)}>
                {t('common.installed')}
              </button>
            ) : m.installed ? (
              <button className="mk-btn ghost" disabled title={t('plugins.sameId')}>
                {t('common.installed')}
              </button>
            ) : (
              <button className="mk-btn" disabled={!m.compatible || !!busy} onClick={() => void install(m)}>
                {busy === m.repo ? <Spinner size={15} /> : t('common.install')}
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}

function InstallForm({ onInstalled }: { onInstalled: (p: PluginInfo) => void }) {
  const [source, setSource] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const install = async () => {
    if (busy || !source.trim()) return
    if (!confirm(t('plugins.confirmInstall'))) return
    setBusy(true)
    setErr('')
    try {
      const info = await api.installPlugin(source.trim())
      toast(t('plugins.installed', { name: info.name }))
      onInstalled(info)
    } catch (e: any) {
      setErr(e?.message ?? t('plugins.installFailed'))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="plugin-form">
      <input
        className="path-input"
        value={source}
        onChange={(e) => setSource(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && void install()}
        placeholder="owner/repo"
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        autoFocus
      />
      <button className="black-pill wide" disabled={busy || !source.trim()} onClick={() => void install()}>
        {busy ? <Spinner size={18} /> : t('common.install')}
      </button>
      {err && <div className="err">{err}</div>}
    </div>
  )
}

function RemoteRows({ info, onChange, onRemoved }: { info: PluginInfo; onChange: (p: PluginInfo) => void; onRemoved: () => void }) {
  const [busy, setBusy] = useState<'update' | 'remove' | null>(null)
  const r = info.remote!
  const update = async () => {
    if (busy) return
    setBusy('update')
    try {
      const res = await api.updatePlugin(info.id)
      onChange(res.plugin)
      toast(res.updated ? t('plugins.updatedTo', { version: res.plugin.version }) : t('plugins.upToDate'))
    } catch (e: any) {
      toast(e?.message ?? t('plugins.updateFailed'))
    } finally {
      setBusy(null)
    }
  }
  const remove = async () => {
    if (busy || !confirm(t('plugins.confirmUninstall', { name: info.name }))) return
    setBusy('remove')
    try {
      await api.uninstallPlugin(info.id)
      toast(t('plugins.uninstalled'))
      onRemoved()
    } catch (e: any) {
      toast(e?.message ?? t('plugins.uninstallFailed'))
      setBusy(null)
    }
  }
  const url = `https://github.com/${r.repo}${r.ref || r.path ? `/tree/${r.ref ?? r.commit}${r.path ? `/${r.path}` : ''}` : ''}`
  return (
    <div className="group" style={{ marginTop: 12 }}>
      <a className="option" href={url} target="_blank" rel="noreferrer">
        <span className="grow">{r.repo}</span>
        <span className="hint">
          {r.ref ? `${r.ref} · ` : ''}
          {r.commit.slice(0, 7)}
        </span>
        <ArrowUpRight size={18} color="var(--text-2)" />
      </a>
      <button className="option" onClick={() => void update()} disabled={!!busy}>
        <span className="grow">{t('plugins.checkUpdates')}</span>
        {busy === 'update' && <Spinner size={18} />}
      </button>
      <button className="option" onClick={() => void remove()} disabled={!!busy}>
        <span className="grow danger">{t('plugins.uninstall')}</span>
        {busy === 'remove' && <Spinner size={18} />}
      </button>
    </div>
  )
}

function PluginDetail({ info, status, onToggle, onChange, onRemoved }: { info: PluginInfo; status?: PluginStatus; onToggle: () => void; onChange: (p: PluginInfo) => void; onRemoved: () => void }) {
  const { settingsPanels, errors } = usePlugins()
  const [testing, setTesting] = useState(false)
  const error = info.error ?? errors[info.id]
  const panels = settingsPanels.filter((x) => x.pluginId === info.id)
  const savedSecrets = info.settings.filter((f) => f.type === 'secret' && f.source === 'saved')

  const remove = async (f: SettingFieldView) => {
    if (!confirm(t('plugins.confirmRemoveSetting', { label: f.label }))) return
    try {
      onChange(await api.savePluginSettings(info.id, { [f.key]: null }))
    } catch (e: any) {
      toast(e?.message ?? t('plugins.removeFailed'))
    }
  }

  const test = async () => {
    if (testing) return
    setTesting(true)
    try {
      await api.testPluginNotification(info.id)
      toast(t('common.sent'))
    } catch (e: any) {
      toast(e?.message ?? t('common.sendFailed'))
    } finally {
      setTesting(false)
    }
  }

  const active = info.state === 'active'
  const hasLinks = info.links.length > 0 || (active && info.notifies) || savedSecrets.length > 0

  return (
    <>
      <button className="row-btn" onClick={onToggle}>
        <span className="grow">{t('plugins.enabled')}</span>
        <span className={`switch${info.enabled ? ' on' : ''}`} />
      </button>
      {error && <div className="notice error plugin-error">{error}</div>}

      {active && !!status?.rows?.length && (
        <div className="group">
          {status.rows.map((r) => (
            <div className="option" key={r.label}>
              <span className="grow">{r.label}</span>
              <span className={`hint${r.tone === 'danger' ? ' danger' : ''}`}>{r.value}</span>
            </div>
          ))}
        </div>
      )}

      {info.settings.length > 0 && <SettingsForm info={info} onSaved={onChange} />}

      {hasLinks && (
        <div className="group">
          {info.links.map((l) => (
            <a className="option" key={l.url} href={l.url} target="_blank" rel="noreferrer">
              <span className="grow">{l.label}</span>
              <ArrowUpRight size={18} color="var(--text-2)" />
            </a>
          ))}
          {active && info.notifies && (
            <button className="option" onClick={test}>
              <span className="grow">{t('plugins.sendTest')}</span>
              {testing && <Spinner size={18} />}
            </button>
          )}
          {savedSecrets.map((f) => (
            <button className="option" key={f.key} onClick={() => void remove(f)}>
              <span className="grow danger">{t('plugins.removeSetting', { label: f.label })}</span>
            </button>
          ))}
        </div>
      )}

      {active &&
        panels.map((x, i) => {
          const Panel = x.component
          return (
            <div className="plugin-panel" key={i}>
              <PluginBoundary pluginId={info.id}>
                <Panel />
              </PluginBoundary>
            </div>
          )
        })}

      {info.remote && <RemoteRows info={info} onChange={onChange} onRemoved={onRemoved} />}
    </>
  )
}

type FormValue = string | boolean

function initial(f: SettingFieldView): FormValue {
  if (f.type === 'boolean') return f.value === true
  if (f.type === 'secret') return ''
  return f.value === undefined ? '' : String(f.value)
}

function SettingsForm({ info, onSaved }: { info: PluginInfo; onSaved: (p: PluginInfo) => void }) {
  const [values, setValues] = useState<Record<string, FormValue>>(() => Object.fromEntries(info.settings.map((f) => [f.key, initial(f)])))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  // Only what was touched; an emptied text field clears the saved value.
  const changes: Record<string, string | boolean | null> = {}
  for (const f of info.settings) {
    const v = values[f.key]
    if (f.type === 'secret') {
      if (typeof v === 'string' && v.trim()) changes[f.key] = v.trim()
    } else if (v !== initial(f)) changes[f.key] = typeof v === 'string' && !v.trim() ? null : v
  }
  const dirty = Object.keys(changes).length > 0
  const set = (key: string, v: FormValue) => setValues((s) => ({ ...s, [key]: v }))

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!dirty || busy) return
    setBusy(true)
    setErr('')
    try {
      const next = await api.savePluginSettings(info.id, changes)
      setValues(Object.fromEntries(next.settings.map((f) => [f.key, initial(f)])))
      onSaved(next)
      toast(t('common.saved'))
    } catch (e: any) {
      setErr(e?.message ?? t('common.saveFailed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="plugin-form" onSubmit={save}>
      {info.settings.map((f) => {
        const v = values[f.key]
        if (f.type === 'boolean')
          return (
            <button type="button" className="row-btn" key={f.key} onClick={() => set(f.key, !v)}>
              <span className="grow">{f.label}</span>
              <span className={`switch${v ? ' on' : ''}`} />
            </button>
          )
        if (f.type === 'select')
          return (
            <Fragment key={f.key}>
              <div className="field-label">{f.label}</div>
              <div className="group">
                {(f.options ?? []).map((o) => (
                  <button type="button" className="option" key={o.value} onClick={() => set(f.key, o.value)}>
                    <span className="grow">{o.label}</span>
                    {v === o.value && <Check size={20} strokeWidth={2.2} className="check" />}
                  </button>
                ))}
              </div>
            </Fragment>
          )
        return (
          <Fragment key={f.key}>
            <div className="field-label">{f.label}</div>
            <input
              className={`path-input${f.type === 'secret' ? '' : ' plain'}`}
              type={f.type === 'secret' ? 'password' : 'text'}
              inputMode={f.type === 'number' ? 'numeric' : undefined}
              name={`${info.id}-${f.key}`}
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              placeholder={f.hint ?? f.placeholder}
              value={String(v)}
              onChange={(e) => set(f.key, e.target.value)}
            />
          </Fragment>
        )
      })}
      <button className="black-pill wide" disabled={!dirty || busy}>
        {busy ? <Spinner size={20} /> : t('common.save')}
      </button>
      {err && <div className="err">{err}</div>}
    </form>
  )
}
