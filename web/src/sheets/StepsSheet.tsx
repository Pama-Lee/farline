import { Bot, CheckCircle2, Clock, ChevronRight, Circle, CircleDot, FilePen, FileText, Globe, ListTodo, Plug, Search, SquareTerminal, Wrench } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { highlight } from '../components/Markdown.tsx'
import { Sheet } from '../components/Sheet.tsx'
import { Spinner, toast } from '../components/bits.tsx'
import { api } from '../lib/api.ts'
import { openFile } from '../lib/files.ts'
import { openViewer } from '../lib/viewer.ts'
import { PluginBoundary, usePlugins } from '../plugins/runtime.tsx'
import { category, stepLabel, stepsSummary, type StepItem } from '../lib/steps.ts'
import { t } from '../i18n.ts'

const ICONS: Record<string, ReactNode> = {
  web: <Globe size={19} strokeWidth={1.6} />,
  bash: <SquareTerminal size={19} strokeWidth={1.6} />,
  read: <FileText size={19} strokeWidth={1.6} />,
  edit: <FilePen size={19} strokeWidth={1.6} />,
  search: <Search size={19} strokeWidth={1.6} />,
  agent: <Bot size={19} strokeWidth={1.6} />,
  think: <Clock size={19} strokeWidth={1.6} />,
  todo: <ListTodo size={19} strokeWidth={1.6} />,
  other: <Wrench size={19} strokeWidth={1.6} />,
}

interface Props {
  steps: StepItem[]
  sessionId: string | null
  // The session's process is running, so a running call can be moved to the background.
  live: boolean
  onOpenTask: (taskId: string) => void
  onClose: () => void
}

export function StepsSheet({ steps, sessionId, live, onOpenTask, onClose }: Props) {
  const [openId, setOpenId] = useState<string | null>(steps.length === 1 ? steps[0].id : null)
  const open = steps.find((s) => s.id === openId)
  if (open)
    return <StepDetail step={open} sessionId={sessionId} live={live} onOpenTask={onOpenTask} onClose={onClose} onBack={steps.length > 1 ? () => setOpenId(null) : undefined} />
  return (
    <Sheet title={stepsSummary(steps)} onClose={onClose} size="medium">
      <div className="timeline">
        {steps.map((s) => {
          const { l1, l2 } = stepLabel(s)
          const cat = category(s)
          const running = s.kind === 'tool' ? s.status === 'running' : s.streaming
          return (
            <button key={s.id} className={`tl-item${s.kind === 'tool' && s.status === 'error' ? ' error' : ''}`} onClick={() => setOpenId(s.id)}>
              <span className="ic">{running ? <Spinner size={17} /> : s.kind === 'tool' && s.name.startsWith('mcp__') ? <Plug size={19} strokeWidth={1.6} /> : ICONS[cat]}</span>
              <span style={{ minWidth: 0 }}>
                <div className="l1">{l1}</div>
                {l2 && <div className="l2">{l2}</div>}
              </span>
            </button>
          )
        })}
      </div>
    </Sheet>
  )
}

export function Field({ label, children, plain }: { label: string; children: ReactNode; plain?: boolean }) {
  return (
    <>
      <div className="field-label">{label}</div>
      <div className={`field-box${plain ? ' plain' : ''}`}>{children}</div>
    </>
  )
}

// A path in a step's details opens in the file panel.
function FilePath({ path, line, sessionId, onClose }: { path: unknown; line?: unknown; sessionId: string | null; onClose: () => void }) {
  const p = s(path)
  if (!p.startsWith('/')) return <>{p}</>
  return (
    <button
      className="field-file"
      onClick={() => {
        onClose()
        openFile({ path: p, line: typeof line === 'number' ? line : undefined }, sessionId)
      }}
    >
      {p}
    </button>
  )
}

function s(v: unknown) {
  return typeof v === 'string' ? v : v === undefined ? '' : JSON.stringify(v, null, 2)
}

function Diff({ oldText, newText }: { oldText: string; newText: string }) {
  return (
    <>
      {oldText.split('\n').map((l, i) => (
        <span className="diff-del" key={`o${i}`}>- {l}</span>
      ))}
      {newText.split('\n').map((l, i) => (
        <span className="diff-add" key={`n${i}`}>+ {l}</span>
      ))}
    </>
  )
}

function StepDetail({ step, onBack, ...rest }: Omit<Props, 'steps'> & { step: StepItem; onBack?: () => void }) {
  const title = step.kind === 'thinking' ? t('step.thinking') : step.name.replace(/^mcp__(.+?)__/, '$1 · ')
  return (
    <Sheet title={title} onClose={rest.onClose} onBack={onBack} size="medium">
      <StepBody step={step} {...rest} />
    </Sheet>
  )
}

// The steps of a group, opened in the conversation instead of a sheet: a
// card of rows, each one opening in place.
export function InlineSteps({ steps, ...rest }: Props) {
  const [open, setOpen] = useState<Set<string>>(() => new Set(steps.length === 1 ? [steps[0].id] : []))
  const toggle = (id: string) =>
    setOpen((o) => {
      const n = new Set(o)
      if (!n.delete(id)) n.add(id)
      return n
    })
  return (
    <div className="inline-steps">
      {steps.map((s) => {
        const { l1, l2 } = stepLabel(s)
        const failed = s.kind === 'tool' && s.status === 'error'
        const running = s.kind === 'tool' ? s.status === 'running' : s.streaming
        const label = s.kind === 'thinking' ? l1 : s.kind === 'tool' && s.name === 'Bash' && !s.taskId ? l2 || l1 : `${l1} ${l2}`.trim()
        const isOpen = open.has(s.id)
        return (
          <div key={s.id} className={`is-item${isOpen ? ' open' : ''}`}>
            <button className="is-head" onClick={() => toggle(s.id)}>
              {running && <Spinner size={14} />}
              <span className="l">{label}</span>
              {failed && <span className="err">{t('step.failed')}</span>}
              <ChevronRight size={15} strokeWidth={1.7} className="chev" />
            </button>
            {isOpen && (
              <div className="is-body">
                <StepBody step={s} compact {...rest} />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function StepBody({ step, sessionId, live, onOpenTask, onClose, compact }: Omit<Props, 'steps'> & { step: StepItem; compact?: boolean }) {
  const { toolRenderers } = usePlugins()
  const [moving, setMoving] = useState(false)
  if (step.kind === 'thinking') return compact ? <div className="is-text">{step.text}</div> : <Field label={t('field.content')} plain>{step.text}</Field>
  const i = step.input
  const out = step.result !== undefined ? step.result + (step.truncated ? t('step.truncated') : '') : step.status === 'running' ? null : ''
  const movable = !step.taskId && step.status === 'running' && live && !!sessionId && ['Bash', 'Agent', 'Task'].includes(step.name)
  const moveToBackground = async () => {
    if (moving || !sessionId) return
    setMoving(true)
    try {
      const { ok } = await api.backgroundTool(sessionId, step.id)
      if (!ok) toast(t('step.cantBackground'))
    } catch (e: any) {
      toast(e?.message ?? t('common.failed'))
    } finally {
      setMoving(false)
    }
  }
  const output = step.taskId ? (
    <button className="row-btn" style={{ marginTop: 16 }} onClick={() => onOpenTask(step.taskId!)}>
      <span className="grow">{t('step.viewTask')}</span>
      <ChevronRight size={18} color="var(--text-3)" />
    </button>
  ) : movable ? (
    <button className="row-btn" style={{ marginTop: 16 }} onClick={moveToBackground} disabled={moving}>
      <span className="grow">{t('step.moveToBackground')}</span>
      {moving && <Spinner size={18} />}
    </button>
  ) :
    out === null ? null : step.images?.length ? (
      <>
        <div className="field-label">{t('field.output')}</div>
        <div className="detail-images">
          {step.images.map((im, i) => (
            <button key={im.url} onClick={() => openViewer(step.images!.map((x) => ({ url: x.url, name: s(step.input.file_path) || undefined })), i)} aria-label={t('common.viewImage')}>
              <img src={im.url} alt="" />
            </button>
          ))}
        </div>
      </>
    ) : (
      <Field label={t('field.output')}>{out || t('step.noOutput')}</Field>
    )
  let body: ReactNode
  switch (step.name) {
    case 'Bash':
      body = compact ? (
        <>
          <div className="is-cmd">
            <span className="ps">$</span>
            <span dangerouslySetInnerHTML={{ __html: highlight(s(i.command), 'bash') }} />
          </div>
          {step.taskId || movable || step.images?.length ? output : out ? <div className="is-out">{out}</div> : null}
        </>
      ) : (
        <>
          {!!i.description && <Field label={t('field.description')} plain>{s(i.description)}</Field>}
          <Field label={t('field.command')}>
            <span dangerouslySetInnerHTML={{ __html: highlight(s(i.command), 'bash') }} />
          </Field>
          {output}
        </>
      )
      break
    case 'WebSearch':
      body = (
        <>
          <Field label={t('field.query')}>{s(i.query)}</Field>
          {output}
        </>
      )
      break
    case 'WebFetch':
      body = (
        <>
          <Field label={t('field.url')}>{s(i.url)}</Field>
          {!!i.prompt && <Field label={t('field.prompt')} plain>{s(i.prompt)}</Field>}
          {output}
        </>
      )
      break
    case 'Read':
      body = (
        <>
          <Field label={t('field.file')}>
            <FilePath path={i.file_path} line={i.offset} sessionId={sessionId} onClose={onClose} />
            {i.offset ? `  (${s(i.offset)}–)` : ''}
          </Field>
          {output}
        </>
      )
      break
    case 'Edit':
      body = (
        <>
          <Field label={t('field.file')}>
            <FilePath path={i.file_path} sessionId={sessionId} onClose={onClose} />
          </Field>
          <Field label={t('field.change')}><Diff oldText={s(i.old_string)} newText={s(i.new_string)} /></Field>
          {output}
        </>
      )
      break
    case 'MultiEdit':
      body = (
        <>
          <Field label={t('field.file')}>
            <FilePath path={i.file_path} sessionId={sessionId} onClose={onClose} />
          </Field>
          {Array.isArray(i.edits) &&
            i.edits.map((e: any, k: number) => (
              <Field key={k} label={t('field.changeN', { n: k + 1 })}><Diff oldText={s(e.old_string)} newText={s(e.new_string)} /></Field>
            ))}
          {output}
        </>
      )
      break
    case 'Write':
      body = (
        <>
          <Field label={t('field.file')}>
            <FilePath path={i.file_path} sessionId={sessionId} onClose={onClose} />
          </Field>
          <Field label={t('field.content')}>{s(i.content)}</Field>
          {output}
        </>
      )
      break
    case 'Grep':
    case 'Glob':
      body = (
        <>
          <Field label={t('field.pattern')}>{s(i.pattern)}</Field>
          {!!i.path && <Field label={t('field.path')}>{s(i.path)}</Field>}
          {output}
        </>
      )
      break
    case 'Agent':
    case 'Task':
      body = (
        <>
          {!!i.description && <Field label={t('field.description')} plain>{s(i.description)}</Field>}
          <Field label={t('field.instructions')} plain>{s(i.prompt)}</Field>
          {output}
        </>
      )
      break
    case 'TodoWrite':
      body = (
        <div className="group" style={{ marginTop: 10 }}>
          {Array.isArray(i.todos) &&
            i.todos.map((td: any, k: number) => (
              <div className="option" key={k}>
                {td.status === 'completed' ? <CheckCircle2 size={20} color="var(--green)" /> : td.status === 'in_progress' ? <CircleDot size={20} /> : <Circle size={20} color="var(--text-3)" />}
                <span className="grow">{s(td.content)}</span>
              </div>
            ))}
        </div>
      )
      break
    default:
      body = (
        <>
          <Field label={t('field.input')}>{JSON.stringify(i, null, 2)}</Field>
          {output}
        </>
      )
  }
  // A plugin may take over the view; if it breaks, the default shows instead.
  const custom = toolRenderers.find((r) => r.match(step.name))
  if (custom) {
    const View = custom.component
    body = (
      <PluginBoundary pluginId={custom.pluginId} fallback={body}>
        <View tool={step} sessionId={sessionId} />
      </PluginBoundary>
    )
  }
  return body
}
