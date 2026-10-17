import { Check, ChevronRight } from 'lucide-react'
import { useState } from 'react'
import type { EffortLevel, ModelOption, Provider, ProviderInfo } from '../../../shared/types.ts'
import { Sheet } from '../components/Sheet.tsx'

export const EFFORT_LABELS: Record<EffortLevel, string> = {
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '超高',
  max: '最大',
}

export const EFFORT_ORDER: EffortLevel[] = ['low', 'medium', 'high', 'xhigh', 'max']

export interface ModelPickerProps {
  models: ModelOption[]
  providers: ProviderInfo[]
  provider: Provider
  model: string
  effort: EffortLevel | null
  classifierModel: string | null
  onModel: (m: ModelOption) => void
  onEffort: (e: EffortLevel) => void
  onClassifier: (model: string) => void
  onClose: () => void
}

export function isCurrent(m: ModelOption, provider: Provider, model: string) {
  return m.provider === provider && (m.value === model || (!!m.resolved && m.resolved === model))
}

export function ModelSheet(p: ModelPickerProps) {
  const [tab, setTab] = useState<Provider>(p.provider)
  const [view, setView] = useState<'main' | 'effort' | 'more' | 'classifier'>('main')
  const available = p.providers.filter((pv) => p.models.some((m) => m.provider === pv.id))
  const inTab = p.models.filter((m) => m.provider === tab)
  const main = inTab.filter((m) => !m.more)
  const more = inTab.filter((m) => m.more)
  const current = p.models.find((m) => isCurrent(m, p.provider, p.model))
  // Models the current provider's auto-mode classifier may run on.
  const classifiers = (p.providers.find((pv) => pv.id === p.provider)?.classifierModels ?? [])
    .map((v) => p.models.find((m) => m.provider === p.provider && m.value === v))
    .filter((m) => !!m)

  const pick = (m: ModelOption) => {
    p.onModel(m)
    p.onClose()
  }

  const check = <Check size={20} strokeWidth={2.2} className="check" />
  const row = (m: ModelOption) => (
    <button className={`option${m.desc ? ' tall' : ''}`} key={m.provider + m.value} onClick={() => pick(m)}>
      <span className="grow">
        {m.label}
        {m.desc && <span className="desc">{m.desc}</span>}
      </span>
      {current === m && check}
    </button>
  )

  if (view === 'effort')
    return (
      <Sheet title="思考强度" onClose={p.onClose} onBack={() => setView('main')}>
        <div className="group">
          {(current?.efforts ?? EFFORT_ORDER).map((e) => (
            <button
              className="option"
              key={e}
              onClick={() => {
                p.onEffort(e)
                setView('main')
              }}
            >
              <span className="grow">{EFFORT_LABELS[e]}</span>
              {p.effort === e && check}
            </button>
          ))}
        </div>
      </Sheet>
    )

  if (view === 'classifier')
    return (
      <Sheet title="自动模式判断" onClose={p.onClose} onBack={() => setView('main')}>
        <div className="group">
          {classifiers.map((m) => (
            <button
              className="option"
              key={m.value}
              onClick={() => {
                p.onClassifier(m.value)
                setView('main')
              }}
            >
              <span className="grow">{m.label}</span>
              {p.classifierModel === m.value && check}
            </button>
          ))}
        </div>
      </Sheet>
    )

  if (view === 'more')
    return (
      <Sheet title="更多模型" onClose={p.onClose} onBack={() => setView('main')}>
        <div className="group">{more.map(row)}</div>
      </Sheet>
    )

  const classifierLabel = classifiers.find((m) => m.value === p.classifierModel)?.label

  return (
    <Sheet title="选择模型" onClose={p.onClose}>
      {available.length > 1 && (
        <div className="segmented">
          {available.map((pv) => (
            <button key={pv.id} className={tab === pv.id ? 'on' : undefined} onClick={() => setTab(pv.id)}>
              {pv.label}
            </button>
          ))}
        </div>
      )}
      {main.length > 0 && <div className="group">{main.map(row)}</div>}
      {tab === 'claude' && p.provider === 'claude' && p.effort && current?.efforts && (
        <button className="row-btn" style={{ marginTop: 14 }} onClick={() => setView('effort')}>
          <span className="grow">思考强度</span>
          <span className="value">{EFFORT_LABELS[p.effort]}</span>
          <ChevronRight size={18} color="var(--text-2)" />
        </button>
      )}
      {tab === p.provider && classifiers.length > 1 && (
        <button className="row-btn" style={{ marginTop: 14 }} onClick={() => setView('classifier')}>
          <span className="grow">自动模式判断</span>
          <span className="value">{classifierLabel}</span>
          <ChevronRight size={18} color="var(--text-2)" />
        </button>
      )}
      {more.length > 0 && (
        <button className="row-btn" style={{ marginTop: 14 }} onClick={() => setView('more')}>
          <span className="grow">更多模型</span>
          {current?.more && current.provider === tab && <span className="value">{current.label}</span>}
          <ChevronRight size={18} color="var(--text-2)" />
        </button>
      )}
    </Sheet>
  )
}
