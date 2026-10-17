// The model picker as a menu anchored to the model button, for skins that ask
// for it (--fl-model-picker: menu). Settings first, the model one level down.
import { Check, ChevronLeft, ChevronRight } from 'lucide-react'
import { useState } from 'react'
import type { ModelOption, Provider } from '../../../shared/types.ts'
import { Popover } from '../components/Popover.tsx'
import { EFFORT_LABELS, EFFORT_ORDER, isCurrent, type ModelPickerProps } from './ModelSheet.tsx'

export function wantsMenuPicker() {
  return getComputedStyle(document.documentElement).getPropertyValue('--fl-model-picker').trim() === 'menu'
}

export function ModelMenu(p: ModelPickerProps & { anchor: DOMRect }) {
  const [view, setView] = useState<'main' | 'model' | 'effort' | 'classifier'>('main')
  const [tab, setTab] = useState<Provider>(p.provider)
  const available = p.providers.filter((pv) => p.models.some((m) => m.provider === pv.id))
  const current = p.models.find((m) => isCurrent(m, p.provider, p.model))
  const classifiers = (p.providers.find((pv) => pv.id === p.provider)?.classifierModels ?? [])
    .map((v) => p.models.find((m) => m.provider === p.provider && m.value === v))
    .filter((m) => !!m)
  const efforts = p.provider === 'claude' && p.effort && current?.efforts ? (current.efforts ?? EFFORT_ORDER) : null

  const check = <Check size={15} strokeWidth={2.2} className="menu-check" />
  const back = (title: string) => (
    <button className="menu-head" onClick={() => setView('main')}>
      <ChevronLeft size={15} strokeWidth={2} />
      {title}
    </button>
  )
  const entry = (label: string, value: string | undefined, to: typeof view) => (
    <button className="menu-row" onClick={() => setView(to)}>
      <span className="grow">{label}</span>
      {value && <span className="v">{value}</span>}
      <ChevronRight size={15} strokeWidth={1.8} className="menu-chev" />
    </button>
  )
  const modelRow = (m: ModelOption) => (
    <button
      className="menu-row"
      key={m.provider + m.value}
      onClick={() => {
        p.onModel(m)
        p.onClose()
      }}
    >
      <span className="grow">{m.label}</span>
      {current === m && check}
    </button>
  )

  let body
  if (view === 'model') {
    const inTab = p.models.filter((m) => m.provider === tab)
    const more = inTab.filter((m) => m.more)
    body = (
      <>
        {back('模型')}
        {available.length > 1 && (
          <div className="menu-tabs">
            {available.map((pv) => (
              <button key={pv.id} className={tab === pv.id ? 'on' : undefined} onClick={() => setTab(pv.id)}>
                {pv.label}
              </button>
            ))}
          </div>
        )}
        {inTab.filter((m) => !m.more).map(modelRow)}
        {more.length > 0 && <div className="menu-sep" />}
        {more.map(modelRow)}
      </>
    )
  } else if (view === 'effort' && efforts) {
    body = (
      <>
        {back('思考强度')}
        {efforts.map((e) => (
          <button
            className="menu-row"
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
      </>
    )
  } else if (view === 'classifier') {
    body = (
      <>
        {back('自动模式判断')}
        {classifiers.map((m) => (
          <button
            className="menu-row"
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
      </>
    )
  } else {
    const settings = !!efforts || classifiers.length > 1
    body = (
      <>
        {efforts && entry('思考强度', p.effort ? EFFORT_LABELS[p.effort] : undefined, 'effort')}
        {classifiers.length > 1 && entry('自动模式判断', classifiers.find((m) => m.value === p.classifierModel)?.label, 'classifier')}
        {settings && <div className="menu-sep" />}
        {entry('模型', current?.label ?? p.model, 'model')}
      </>
    )
  }

  return (
    <Popover anchor={p.anchor} onClose={p.onClose}>
      <div className="menu">{body}</div>
    </Popover>
  )
}
