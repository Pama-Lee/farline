import { ArrowUpRight, Bell, Check, ChevronRight, LogOut, Puzzle } from 'lucide-react'
import { Fragment, useCallback, useEffect, useState } from 'react'
import type { PluginInfo, PluginStatus, SettingFieldView } from '../../../shared/types.ts'
import { Sheet } from '../components/Sheet.tsx'
import { Spinner, toast } from '../components/bits.tsx'
import { CATALOG_CHANGED, api } from '../lib/api.ts'
import { currentPushSubscription, disablePush, enablePush, isStandalone, pushSupported } from '../lib/device.ts'
import { PluginBoundary, usePlugins } from '../plugins/runtime.tsx'

type View = { name: 'main' } | { name: 'plugins' } | { name: 'plugin'; id: string; back: 'main' | 'plugins' }

const SOURCE: Record<PluginInfo['source'], string> = { builtin: '内置', local: '本地', npm: 'npm' }

// A space between Chinese and a Latin word: 移除 API key.
const join = (zh: string, label: string) => (/^[A-Za-z0-9]/.test(label) ? `${zh} ${label}` : `${zh}${label}`)

export function SettingsSheet({ onClose, onLogout }: { onClose: () => void; onLogout: () => void }) {
  const [push, setPush] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [view, setView] = useState<View>({ name: 'main' })
  const [plugins, setPlugins] = useState<PluginInfo[] | null>(null)
  const [statuses, setStatuses] = useState<Record<string, PluginStatus>>({})
  const { settingsPanels } = usePlugins()

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
      toast(isStandalone() ? '这台设备不支持通知' : '先添加到主屏幕，再从主屏幕打开')
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
        else toast('通知权限未开启')
      }
    } catch (e: any) {
      toast(e?.message ?? '操作失败')
    } finally {
      setBusy(false)
    }
  }

  const toggle = async (p: PluginInfo) => {
    try {
      changed(await api.setPluginEnabled(p.id, !p.enabled))
    } catch (e: any) {
      toast(e?.message ?? '操作失败')
    }
  }

  if (view.name === 'plugin') {
    const p = plugins?.find((x) => x.id === view.id)
    if (p)
      return (
        <Sheet title={p.name} onClose={onClose} onBack={() => setView(view.back === 'main' ? { name: 'main' } : { name: 'plugins' })} size={p.settings.length > 2 ? 'tall' : 'auto'}>
          <PluginDetail info={p} status={statuses[p.id]} onToggle={() => void toggle(p)} onChange={changed} />
        </Sheet>
      )
  }

  if (view.name === 'plugins')
    return (
      <Sheet title="插件" onClose={onClose} onBack={() => setView({ name: 'main' })}>
        {!plugins ? (
          <div className="empty">
            <Spinner />
          </div>
        ) : plugins.length === 0 ? (
          <div className="empty">没有插件</div>
        ) : (
          <div className="group">
            {plugins.map((p) => (
              <div className="option tall" key={p.id}>
                <button className="grow plain" onClick={() => setView({ name: 'plugin', id: p.id, back: 'plugins' })}>
                  {p.name}
                  <span className={`desc${p.state === 'error' ? ' danger' : ''}`}>
                    {p.state === 'error' ? '出错' : `${p.version} · ${SOURCE[p.source]}`}
                  </span>
                </button>
                <button className={`switch${p.enabled ? ' on' : ''}`} onClick={() => void toggle(p)} aria-label={p.enabled ? '停用' : '启用'} />
              </div>
            ))}
          </div>
        )}
      </Sheet>
    )

  // Enabled plugins with something to set or show get a row of their own.
  const configurable = (plugins ?? []).filter(
    (p) => p.state === 'active' && (p.settings.length > 0 || p.hasStatus || settingsPanels.some((x) => x.pluginId === p.id)),
  )

  return (
    <Sheet title="设置" onClose={onClose}>
      <button className="row-btn" onClick={togglePush}>
        <Bell size={19} strokeWidth={1.6} />
        <span className="grow">通知</span>
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
      <button className="row-btn" onClick={() => setView({ name: 'plugins' })}>
        <Puzzle size={19} strokeWidth={1.6} />
        <span className="grow">插件</span>
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
        <span className="grow">退出登录</span>
      </button>
    </Sheet>
  )
}

function PluginDetail({ info, status, onToggle, onChange }: { info: PluginInfo; status?: PluginStatus; onToggle: () => void; onChange: (p: PluginInfo) => void }) {
  const { settingsPanels, errors } = usePlugins()
  const [testing, setTesting] = useState(false)
  const error = info.error ?? errors[info.id]
  const panels = settingsPanels.filter((x) => x.pluginId === info.id)
  const savedSecrets = info.settings.filter((f) => f.type === 'secret' && f.source === 'saved')

  const remove = async (f: SettingFieldView) => {
    if (!confirm(`${join('确认移除', f.label)}？`)) return
    try {
      onChange(await api.savePluginSettings(info.id, { [f.key]: null }))
    } catch (e: any) {
      toast(e?.message ?? '移除失败')
    }
  }

  const test = async () => {
    if (testing) return
    setTesting(true)
    try {
      await api.testPluginNotification(info.id)
      toast('已发送')
    } catch (e: any) {
      toast(e?.message ?? '发送失败')
    } finally {
      setTesting(false)
    }
  }

  const active = info.state === 'active'
  const hasLinks = info.links.length > 0 || (active && info.notifies) || savedSecrets.length > 0

  return (
    <>
      <button className="row-btn" onClick={onToggle}>
        <span className="grow">启用</span>
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
              <span className="grow">发送测试通知</span>
              {testing && <Spinner size={18} />}
            </button>
          )}
          {savedSecrets.map((f) => (
            <button className="option" key={f.key} onClick={() => void remove(f)}>
              <span className="grow danger">{join('移除', f.label)}</span>
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
      toast('已保存')
    } catch (e: any) {
      setErr(e?.message ?? '保存失败')
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
        {busy ? <Spinner size={20} /> : '保存'}
      </button>
      {err && <div className="err">{err}</div>}
    </form>
  )
}
