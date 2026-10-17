// The model picker as a menu anchored to the model button, for skins that ask
// for it (--fl-model-picker: menu). Settings first, the model one level down.
import { Check, ChevronLeft, ChevronRight } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { ModelOption } from '../../../shared/types.ts'
import { Popover } from '../components/Popover.tsx'
import { EFFORT_LABELS, EFFORT_ORDER, isCurrent, type ModelPickerProps } from './ModelSheet.tsx'
import { t } from '../i18n.ts'

export function wantsMenuPicker() {
  return getComputedStyle(document.documentElement).getPropertyValue('--fl-model-picker').trim() === 'menu'
}

export function ModelMenu(p: ModelPickerProps & { anchor: DOMRect }) {
  const [view, setView] = useState<'main' | 'model' | 'effort' | 'classifier'>('main')
  const [q, setQ] = useState('')
  const listRef = useRef<HTMLDivElement>(null)
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
      className={`menu-row${current === m ? ' current' : ''}`}
      key={m.provider + m.value}
      onClick={() => {
        p.onModel(m)
        p.onClose()
      }}
    >
      <span className="grow" title={m.label}>{m.label}</span>
      {current === m && check}
    </button>
  )

  // Open the model list at the current model.
  useEffect(() => {
    if (view === 'model' && !q) listRef.current?.querySelector('.current')?.scrollIntoView({ block: 'center' })
  }, [view])

  let body
  if (view === 'model') {
    // Every provider's models in one list, grouped; a search box once it gets long.
    const needle = q.trim().toLowerCase()
    const match = (m: ModelOption, label: string) => !needle || m.label.toLowerCase().includes(needle) || m.value.toLowerCase().includes(needle) || label.toLowerCase().includes(needle)
    const groups = available
      .map((pv) => ({ pv, models: p.models.filter((m) => m.provider === pv.id && match(m, pv.label)) }))
      .filter((g) => g.models.length > 0)
    body = (
      <>
        {back(t('model.model'))}
        {p.models.length > 8 && (
          <div className="menu-search">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('model.search')} autoFocus={!('ontouchstart' in window)} spellCheck={false} autoComplete="off" />
          </div>
        )}
        <div className="menu-scroll" ref={listRef}>
          {groups.map((g) => (
            <div className="menu-group" key={g.pv.id}>
              {available.length > 1 && <div className="menu-label">{g.pv.label}</div>}
              {g.models.map(modelRow)}
            </div>
          ))}
          {groups.length === 0 && <div className="menu-empty">{t('model.noMatch')}</div>}
        </div>
      </>
    )
  } else if (view === 'effort' && efforts) {
    body = (
      <>
        {back(t('model.effort'))}
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
        {back(t('model.classifier'))}
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
        {efforts && entry(t('model.effort'), p.effort ? EFFORT_LABELS[p.effort] : undefined, 'effort')}
        {classifiers.length > 1 && entry(t('model.classifier'), classifiers.find((m) => m.value === p.classifierModel)?.label, 'classifier')}
        {settings && <div className="menu-sep" />}
        {entry(t('model.model'), current?.label ?? p.model, 'model')}
      </>
    )
  }

  return (
    <Popover anchor={p.anchor} onClose={p.onClose}>
      <div className="menu">{body}</div>
    </Popover>
  )
}
