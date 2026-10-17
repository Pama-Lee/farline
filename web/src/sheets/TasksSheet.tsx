import { Activity, Bot, ListTodo, SquareTerminal, Workflow } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { TaskOutput } from '../../../shared/types.ts'
import { Markdown, highlight } from '../components/Markdown.tsx'
import { Sheet } from '../components/Sheet.tsx'
import { Spinner, toast } from '../components/bits.tsx'
import { api } from '../lib/api.ts'
import { STATUS_LABELS, TYPE_LABELS, duration, type TaskView } from '../lib/tasks.ts'
import { Field } from './StepsSheet.tsx'
import { t } from '../i18n.ts'

export function TaskIcon({ task, size = 19 }: { task: Pick<TaskView, 'type' | 'status'>; size?: number }) {
  if (task.status === 'running') return <Spinner size={size - 2} />
  const p = { size, strokeWidth: 1.6 }
  if (task.type === 'local_bash') return <SquareTerminal {...p} />
  if (task.type === 'local_agent') return <Bot {...p} />
  if (task.type === 'monitor') return <Activity {...p} />
  if (task.type === 'local_workflow') return <Workflow {...p} />
  return <ListTodo {...p} />
}

function subtitle(task: TaskView) {
  const parts = [STATUS_LABELS[task.status], TYPE_LABELS[task.type]]
  if (task.status === 'running' && task.startedAt) parts.push(duration(Date.now() - task.startedAt))
  if (task.status === 'running' && task.summary && task.type === 'local_agent') parts.push(task.summary)
  return parts.filter(Boolean).join(' · ')
}

interface Props {
  sessionId: string
  tasks: TaskView[]
  // Process alive: running tasks can be stopped and polled.
  live: boolean
  openId?: string | null
  onClose: () => void
}

export function TasksSheet({ sessionId, tasks, live, openId: initial, onClose }: Props) {
  const [openId, setOpenId] = useState<string | null>(initial ?? (tasks.length === 1 ? tasks[0].id : null))
  // Keep running durations fresh.
  const [, tick] = useState(0)
  useEffect(() => {
    if (!tasks.some((t) => t.status === 'running')) return
    const timer = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(timer)
  }, [tasks])

  const open = tasks.find((x) => x.id === openId)
  if (open)
    return <TaskDetail sessionId={sessionId} task={open} live={live} onClose={onClose} onBack={tasks.length > 1 || !initial ? () => setOpenId(null) : undefined} />
  return (
    <Sheet title={t('tasks.title')} onClose={onClose} size="medium">
      {tasks.length === 0 ? (
        <div className="empty">{t('tasks.none')}</div>
      ) : (
        <div className="group">
          {tasks.map((task) => (
            <button className="option tall" key={task.id} onClick={() => setOpenId(task.id)}>
              <span className={`task-ic${task.status === 'failed' ? ' danger' : ''}`}>
                <TaskIcon task={task} />
              </span>
              <span className="grow">
                <span className="one-line">{task.description || task.id}</span>
                <span className={`desc one-line${task.status === 'failed' ? ' danger' : ''}`}>{subtitle(task)}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </Sheet>
  )
}

function TaskDetail({ sessionId, task, live, onClose, onBack }: { sessionId: string; task: TaskView; live: boolean; onClose: () => void; onBack?: () => void }) {
  const [output, setOutput] = useState<TaskOutput | null>(null)
  const [stopping, setStopping] = useState(false)
  const running = task.status === 'running'

  // Poll while it runs and the page is visible; read once more when it ends.
  useEffect(() => {
    let alive = true
    const load = () => api.taskOutput(sessionId, task.id).then((o) => alive && setOutput(o), () => undefined)
    void load()
    if (!running) return () => void (alive = false)
    const timer = setInterval(() => document.visibilityState === 'visible' && void load(), 2000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [sessionId, task.id, running])

  const stop = async () => {
    if (stopping || !confirm(t('tasks.confirmStop'))) return
    setStopping(true)
    try {
      await api.stopTask(sessionId, task.id)
    } catch (e: any) {
      toast(e?.message ?? t('tasks.stopFailed'))
    } finally {
      setStopping(false)
    }
  }

  const agent = task.type === 'local_agent'
  const elapsed = task.startedAt ? (task.endedAt ?? Date.now()) - task.startedAt : undefined
  const text = output?.text.split('\n').slice(-300).join('\n') ?? ''
  const cut = output && output.total > new TextEncoder().encode(output.text).length

  return (
    <Sheet title={task.description || task.id} onClose={onClose} onBack={onBack} size="tall">
      <div className="group">
        <div className="option">
          <span className="grow">{t('tasks.status')}</span>
          <span className={`hint${task.status === 'failed' ? ' danger' : ''}`}>{STATUS_LABELS[task.status]}</span>
        </div>
        {TYPE_LABELS[task.type] && (
          <div className="option">
            <span className="grow">{t('tasks.type')}</span>
            <span className="hint">{TYPE_LABELS[task.type]}</span>
          </div>
        )}
        {elapsed !== undefined && (
          <div className="option">
            <span className="grow">{t('tasks.duration')}</span>
            <span className="hint">{duration(elapsed)}</span>
          </div>
        )}
        {agent && task.toolUses !== undefined && (
          <div className="option">
            <span className="grow">{t('tasks.toolUses')}</span>
            <span className="hint">{t('tasks.toolUseCount', { n: task.toolUses })}</span>
          </div>
        )}
      </div>

      {running && live && (
        <button className="row-btn task-stop" onClick={stop} disabled={stopping}>
          <span className="grow danger">{t('tasks.stop')}</span>
          {stopping && <Spinner size={18} />}
        </button>
      )}

      {task.command && (
        <Field label={t('field.command')}>
          <span dangerouslySetInnerHTML={{ __html: highlight(task.command, 'bash') }} />
        </Field>
      )}
      {!task.command && task.prompt && (
        <Field label={t('field.instructions')} plain>
          {task.prompt}
        </Field>
      )}
      {task.summary && !running && (
        <Field label={t('field.summary')} plain>
          {task.summary}
        </Field>
      )}
      {task.result && (
        <>
          <div className="field-label">{t('field.result')}</div>
          <div className="field-box plain">
            <Markdown text={task.result} />
          </div>
        </>
      )}
      {task.type !== 'monitor' || text ? (
        <Field label={t(agent ? 'field.progress' : 'field.output')}>{output === null ? '…' : text ? `${cut ? '…\n' : ''}${text}` : t('tasks.noOutputYet')}</Field>
      ) : null}
    </Sheet>
  )
}
