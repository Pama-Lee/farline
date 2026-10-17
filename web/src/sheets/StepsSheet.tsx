import { Bot, Brain, CheckCircle2, ChevronRight, Circle, CircleDot, FilePen, FileText, Globe, ListTodo, Plug, Search, SquareTerminal, Wrench } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { highlight } from '../components/Markdown.tsx'
import { Sheet } from '../components/Sheet.tsx'
import { Spinner, toast } from '../components/bits.tsx'
import { api } from '../lib/api.ts'
import { openFile } from '../lib/files.ts'
import { openViewer } from '../lib/viewer.ts'
import { PluginBoundary, usePlugins } from '../plugins/runtime.tsx'
import { category, stepLabel, stepsSummary, type StepItem } from '../lib/steps.ts'

const ICONS: Record<string, ReactNode> = {
  web: <Globe size={19} strokeWidth={1.6} />,
  bash: <SquareTerminal size={19} strokeWidth={1.6} />,
  read: <FileText size={19} strokeWidth={1.6} />,
  edit: <FilePen size={19} strokeWidth={1.6} />,
  search: <Search size={19} strokeWidth={1.6} />,
  agent: <Bot size={19} strokeWidth={1.6} />,
  think: <Brain size={19} strokeWidth={1.6} />,
  todo: <ListTodo size={19} strokeWidth={1.6} />,
  other: <Wrench size={19} strokeWidth={1.6} />,
}

const ICONS_SM: Record<string, ReactNode> = Object.fromEntries(
  Object.entries({ web: Globe, bash: SquareTerminal, read: FileText, edit: FilePen, search: Search, agent: Bot, think: Brain, todo: ListTodo, other: Wrench }).map(([k, I]) => [k, <I size={16} strokeWidth={1.6} />]),
)

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
  const title = step.kind === 'thinking' ? '思考' : step.name.replace(/^mcp__(.+?)__/, '$1 · ')
  return (
    <Sheet title={title} onClose={rest.onClose} onBack={onBack} size="medium">
      <StepBody step={step} {...rest} />
    </Sheet>
  )
}

// The steps of a group, opened in the conversation instead of a sheet.
export function InlineSteps({ steps, ...rest }: Props) {
  const [open, setOpen] = useState<Set<string>>(() => new Set(steps.length === 1 ? [steps[0].id] : []))
  if (steps.length === 1)
    return (
      <div className="inline-steps single">
        <StepBody step={steps[0]} {...rest} />
      </div>
    )
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
        const running = s.kind === 'tool' ? s.status === 'running' : s.streaming
        const isOpen = open.has(s.id)
        return (
          <div key={s.id} className={`is-item${isOpen ? ' open' : ''}`}>
            <button className={`is-head${s.kind === 'tool' && s.status === 'error' ? ' error' : ''}`} onClick={() => toggle(s.id)}>
              <span className="ic">{running ? <Spinner size={15} /> : s.kind === 'tool' && s.name.startsWith('mcp__') ? <Plug size={16} strokeWidth={1.6} /> : ICONS_SM[category(s)]}</span>
              <span className="l1">{l1}</span>
              {l2 && <span className="l2">{l2}</span>}
              <ChevronRight size={15} strokeWidth={1.7} className="chev" />
            </button>
            {isOpen && (
              <div className="is-body">
                <StepBody step={s} {...rest} />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function StepBody({ step, sessionId, live, onOpenTask, onClose }: Omit<Props, 'steps'> & { step: StepItem }) {
  const { toolRenderers } = usePlugins()
  const [moving, setMoving] = useState(false)
  if (step.kind === 'thinking') return <Field label="内容" plain>{step.text}</Field>
  const i = step.input
  const out = step.result !== undefined ? step.result + (step.truncated ? '\n…（已截断）' : '') : step.status === 'running' ? null : ''
  const movable = !step.taskId && step.status === 'running' && live && !!sessionId && ['Bash', 'Agent', 'Task'].includes(step.name)
  const moveToBackground = async () => {
    if (moving || !sessionId) return
    setMoving(true)
    try {
      const { ok } = await api.backgroundTool(sessionId, step.id)
      if (!ok) toast('暂时不能转入后台')
    } catch (e: any) {
      toast(e?.message ?? '操作失败')
    } finally {
      setMoving(false)
    }
  }
  const output = step.taskId ? (
    <button className="row-btn" style={{ marginTop: 16 }} onClick={() => onOpenTask(step.taskId!)}>
      <span className="grow">查看后台任务</span>
      <ChevronRight size={18} color="var(--text-3)" />
    </button>
  ) : movable ? (
    <button className="row-btn" style={{ marginTop: 16 }} onClick={moveToBackground} disabled={moving}>
      <span className="grow">转入后台</span>
      {moving && <Spinner size={18} />}
    </button>
  ) :
    out === null ? null : step.images?.length ? (
      <>
        <div className="field-label">输出</div>
        <div className="detail-images">
          {step.images.map((im, i) => (
            <button key={im.url} onClick={() => openViewer(step.images!.map((x) => ({ url: x.url, name: s(step.input.file_path) || undefined })), i)} aria-label="查看图片">
              <img src={im.url} alt="" />
            </button>
          ))}
        </div>
      </>
    ) : (
      <Field label="输出">{out || '（无输出）'}</Field>
    )
  let body: ReactNode
  switch (step.name) {
    case 'Bash':
      body = (
        <>
          {!!i.description && <Field label="描述" plain>{s(i.description)}</Field>}
          <Field label="命令">
            <span dangerouslySetInnerHTML={{ __html: highlight(s(i.command), 'bash') }} />
          </Field>
          {output}
        </>
      )
      break
    case 'WebSearch':
      body = (
        <>
          <Field label="查询">{s(i.query)}</Field>
          {output}
        </>
      )
      break
    case 'WebFetch':
      body = (
        <>
          <Field label="网址">{s(i.url)}</Field>
          {!!i.prompt && <Field label="要求" plain>{s(i.prompt)}</Field>}
          {output}
        </>
      )
      break
    case 'Read':
      body = (
        <>
          <Field label="文件">
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
          <Field label="文件">
            <FilePath path={i.file_path} sessionId={sessionId} onClose={onClose} />
          </Field>
          <Field label="修改"><Diff oldText={s(i.old_string)} newText={s(i.new_string)} /></Field>
          {output}
        </>
      )
      break
    case 'MultiEdit':
      body = (
        <>
          <Field label="文件">
            <FilePath path={i.file_path} sessionId={sessionId} onClose={onClose} />
          </Field>
          {Array.isArray(i.edits) &&
            i.edits.map((e: any, k: number) => (
              <Field key={k} label={`修改 ${k + 1}`}><Diff oldText={s(e.old_string)} newText={s(e.new_string)} /></Field>
            ))}
          {output}
        </>
      )
      break
    case 'Write':
      body = (
        <>
          <Field label="文件">
            <FilePath path={i.file_path} sessionId={sessionId} onClose={onClose} />
          </Field>
          <Field label="内容">{s(i.content)}</Field>
          {output}
        </>
      )
      break
    case 'Grep':
    case 'Glob':
      body = (
        <>
          <Field label="模式">{s(i.pattern)}</Field>
          {!!i.path && <Field label="路径">{s(i.path)}</Field>}
          {output}
        </>
      )
      break
    case 'Agent':
    case 'Task':
      body = (
        <>
          {!!i.description && <Field label="描述" plain>{s(i.description)}</Field>}
          <Field label="指令" plain>{s(i.prompt)}</Field>
          {output}
        </>
      )
      break
    case 'TodoWrite':
      body = (
        <div className="group" style={{ marginTop: 10 }}>
          {Array.isArray(i.todos) &&
            i.todos.map((t: any, k: number) => (
              <div className="option" key={k}>
                {t.status === 'completed' ? <CheckCircle2 size={20} color="var(--green)" /> : t.status === 'in_progress' ? <CircleDot size={20} /> : <Circle size={20} color="var(--text-3)" />}
                <span className="grow">{s(t.content)}</span>
              </div>
            ))}
        </div>
      )
      break
    default:
      body = (
        <>
          <Field label="输入">{JSON.stringify(i, null, 2)}</Field>
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
