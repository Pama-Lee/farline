// First run after the password: get an agent runtime (Claude Code or pi)
// and somewhere for its models to come from. The agent part also lives in
// Settings → Agents.
import { ArrowUpRight, Check, Download, KeyRound, Plug, Terminal } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { AgentStatus, PluginInfo } from '../../../shared/types.ts'
import { Spinner, toast } from '../components/bits.tsx'
import { CATALOG_CHANGED, api } from '../lib/api.ts'
import { t } from '../i18n.ts'
import { PluginBoundary, usePlugins } from '../plugins/runtime.tsx'

export function useAgents() {
  const [data, setData] = useState<{ agents: AgentStatus[]; models: number; onboarded: boolean } | null>(null)
  const load = useCallback((fresh = false) => api.agents(fresh).then(setData, () => undefined), [])
  useEffect(() => void load(true), [load])
  // Poll while an install runs.
  const installing = data?.agents.some((a) => a.installing)
  useEffect(() => {
    if (!installing) return
    const timer = setInterval(() => void load(), 1000)
    return () => clearInterval(timer)
  }, [installing, load])
  const wasInstalling = useRef(false)
  useEffect(() => {
    if (wasInstalling.current && !installing) window.dispatchEvent(new Event(CATALOG_CHANGED))
    wasInstalling.current = !!installing
  }, [installing])
  return { data, load }
}

export function AgentsPanel({ data, load }: ReturnType<typeof useAgents>) {
  if (!data)
    return (
      <div className="empty">
        <Spinner />
      </div>
    )
  return (
    <div className="agents">
      {data.agents.map((a) => (
        <div className="agent-card" key={a.id}>
          <div className="agent-head">
            <Terminal size={20} strokeWidth={1.7} />
            <div className="grow">
              <div className="agent-name">
                {a.name}
                <a href={a.homepage} target="_blank" rel="noreferrer" aria-label={a.homepage}>
                  <ArrowUpRight size={15} />
                </a>
              </div>
              <div className={`agent-state${a.installed ? ' ok' : ''}`}>
                {a.installing ? t('agents.installing') : a.installed ? t('agents.installed', { version: a.version ?? '' }) : t('agents.missing')}
              </div>
            </div>
            {a.installed && !a.installing ? (
              <Check size={20} className="check" />
            ) : (
              <button
                className="mk-btn"
                disabled={a.installing}
                onClick={async () => {
                  try {
                    await api.installAgent(a.id)
                    await load()
                  } catch (e: any) {
                    toast(e?.message ?? t('common.failed'))
                  }
                }}
              >
                {a.installing ? <Spinner size={15} /> : t('common.install')}
              </button>
            )}
          </div>
          {a.installing || a.error ? <pre className={`agent-log${a.error ? ' failed' : ''}`}>{a.log.split('\n').slice(-12).join('\n')}</pre> : null}
          {a.error && !a.installing && <div className="err">{t('agents.failed', { error: a.error })}</div>}
          <div className="agent-desc">{t(a.id === 'claude' ? 'agents.claudeDesc' : 'agents.piDesc')}</div>
        </div>
      ))}
    </div>
  )
}

// Where models come from: a key for DeepSeek, any Anthropic-compatible API,
// or the agents' own sign-in.
function ModelSources({ models, plugins, onChange }: { models: number; plugins: PluginInfo[]; onChange: () => void }) {
  const [key, setKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [custom, setCustom] = useState(false)
  const { settingsPanels } = usePlugins()
  const deepseek = plugins.find((p) => p.id === 'deepseek' && p.state === 'active')
  const hasDeepseekKey = deepseek?.settings.some((f) => f.key === 'apiKey' && f.source)
  const panel = settingsPanels.find((p) => p.pluginId === 'compatible')
  return (
    <div className="sources">
      <div className={`agent-state${models ? ' ok' : ''}`} style={{ margin: '0 2px 10px' }}>
        {models ? t('onboard.modelsReady', { n: models }) : t('onboard.noModels')}
      </div>
      {deepseek && (
        <div className="source">
          <KeyRound size={18} strokeWidth={1.7} />
          <div className="grow">
            <div className="agent-name">DeepSeek</div>
            {hasDeepseekKey ? (
              <div className="agent-state ok">{t('onboard.keySaved')}</div>
            ) : (
              <form
                className="inline-key"
                onSubmit={async (e) => {
                  e.preventDefault()
                  if (!key.trim() || saving) return
                  setSaving(true)
                  try {
                    await api.savePluginSettings('deepseek', { apiKey: key.trim() })
                    setKey('')
                    toast(t('common.saved'))
                    onChange()
                  } catch (err: any) {
                    toast(err?.message ?? t('common.saveFailed'))
                  } finally {
                    setSaving(false)
                  }
                }}
              >
                <input className="path-input" type="password" placeholder="API key" value={key} onChange={(e) => setKey(e.target.value)} autoComplete="off" />
                <button className="mk-btn" disabled={!key.trim() || saving}>
                  {saving ? <Spinner size={15} /> : t('common.save')}
                </button>
              </form>
            )}
          </div>
        </div>
      )}
      {panel && (
        <div className="source">
          <Plug size={18} strokeWidth={1.7} />
          <div className="grow">
            <button className="agent-name plain-btn" onClick={() => setCustom((v) => !v)}>
              {t('onboard.custom')}
            </button>
            <div className="agent-desc">{t('onboard.customDesc')}</div>
            {custom && (
              <div className="plugin-panel" style={{ marginTop: 10 }}>
                <PluginBoundary pluginId="compatible">
                  <panel.component />
                </PluginBoundary>
              </div>
            )}
          </div>
        </div>
      )}
      <div className="source">
        <Download size={18} strokeWidth={1.7} />
        <div className="grow">
          <div className="agent-name">{t('onboard.ownLogin')}</div>
          <div className="agent-desc">{t('onboard.ownLoginDesc')}</div>
        </div>
      </div>
    </div>
  )
}

export function Onboarding({ onDone }: { onDone: () => void }) {
  const agents = useAgents()
  const [plugins, setPlugins] = useState<PluginInfo[]>([])
  const loadPlugins = useCallback(() => api.plugins().then(setPlugins, () => undefined), [])
  useEffect(() => void loadPlugins(), [loadPlugins])
  // Adding a provider changes the model count.
  useEffect(() => {
    const on = () => {
      void agents.load()
      void loadPlugins()
    }
    window.addEventListener(CATALOG_CHANGED, on)
    return () => window.removeEventListener(CATALOG_CHANGED, on)
  }, [agents.load, loadPlugins])
  const anyAgent = agents.data?.agents.some((a) => a.installed)
  const finish = async () => {
    await api.finishOnboarding().catch(() => undefined)
    window.dispatchEvent(new Event(CATALOG_CHANGED))
    onDone()
  }
  return (
    <div className="screen onboarding">
      <div className="ob-inner">
        <img src="/icons/icon-192.png" alt="" className="ob-icon" />
        <h1>{t('onboard.title')}</h1>
        <p className="ob-sub">{t('onboard.sub')}</p>

        <div className="ob-step">
          <span className="ob-n">1</span>
          {t('onboard.stepAgent')}
        </div>
        <AgentsPanel {...agents} />

        <div className="ob-step">
          <span className="ob-n">2</span>
          {t('onboard.stepModels')}
        </div>
        <ModelSources
          models={agents.data?.models ?? 0}
          plugins={plugins}
          onChange={() => {
            window.dispatchEvent(new Event(CATALOG_CHANGED))
            void agents.load()
            void loadPlugins()
          }}
        />

        <button className="black-pill wide ob-go" disabled={!anyAgent} onClick={() => void finish()}>
          {t('onboard.go')}
        </button>
        <button className="ob-skip" onClick={() => void finish()}>
          {t('onboard.skip')}
        </button>
      </div>
    </div>
  )
}
