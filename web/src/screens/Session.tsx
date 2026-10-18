import { ArrowUp, ChevronLeft, ChevronRight, Copy, EyeOff, FileText, ListChecks, Mic, MoreHorizontal, PencilLine, Play, Plus, Puzzle, RefreshCw, Square, Undo2, X } from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Catalog, EffortLevel, Item, ModelOption, PermissionMode, Provider, ProviderInfo, SessionState } from '../../../shared/types.ts'
import { Markdown } from '../components/Markdown.tsx'
import { Sheet } from '../components/Sheet.tsx'
import { Spinner, toast } from '../components/bits.tsx'
import { api, type DeviceInfo } from '../lib/api.ts'
import { downscaleImage } from '../lib/device.ts'
import { basename, copyText, shortPath } from '../lib/format.ts'
import { back, navigate } from '../lib/router.ts'
import { runningStep, stepLabel, stepsSummary, toBlocks, type StepItem } from '../lib/steps.ts'
import { useDesktop } from '../lib/useDesktop.ts'
import { useSession } from '../lib/useSession.ts'
import { openViewer, type ViewerImage } from '../lib/viewer.ts'
import { FileLinkContext } from '../lib/files.ts'
import { PluginBoundary, usePlugins } from '../plugins/runtime.tsx'
import { DirPicker } from '../sheets/DeviceSheet.tsx'
import { ContextSheet } from '../sheets/ContextSheet.tsx'
import { EFFORT_LABELS, ModelSheet, isCurrent } from '../sheets/ModelSheet.tsx'
import { ModelMenu, wantsMenuPicker } from '../sheets/ModelMenu.tsx'
import { InlineSteps, StepsSheet } from '../sheets/StepsSheet.tsx'
import { DRAFT_EVENT, RewindSheet } from '../sheets/RewindSheet.tsx'
import { ReplyEditor } from '../components/ReplyEditor.tsx'
import { SelectionMenu } from '../components/SelectionMenu.tsx'
import { useInlineSteps } from '../lib/prefs.ts'
import { TaskIcon, TasksSheet } from '../sheets/TasksSheet.tsx'
import { collectTasks, type TaskView } from '../lib/tasks.ts'
import { t, tx } from '../i18n.ts'
import { ReactButton, ReactionPills } from '../components/Reactions.tsx'

interface Props {
  id: string | null
  newCwd?: string
  device: DeviceInfo | null
  catalog: Catalog
}

type ToolItem = Extract<Item, { kind: 'tool' }>
type AskItem = Extract<Item, { kind: 'ask' }>
type TaskItem = Extract<Item, { kind: 'task' }>

const IMAGE_RE = /\.(png|jpe?g|gif|webp)$/i

export function SessionScreen({ id, newCwd, device, catalog }: Props) {
  const { models, providers } = catalog
  const session = useSession(id)
  const { state, items } = session
  const prefs = device?.prefs ?? {}
  const [draft, setDraft] = useState<{ provider: Provider; model: string; mode: PermissionMode; effort: EffortLevel; classifierModel: string }>(() => ({
    provider: prefs.provider ?? 'claude',
    model: prefs.model && prefs.model !== 'default' ? prefs.model : 'opus',
    mode: defaultMode(providers, prefs.provider ?? 'claude', prefs.permissionMode),
    effort: prefs.effort ?? 'xhigh',
    classifierModel: prefs.classifierModel ?? '',
  }))
  const [steps, setSteps] = useState<StepItem[] | null>(null)
  const [stepsId, setStepsId] = useState<string | null>(null)
  const [rewindAt, setRewindAt] = useState<{ id: string; text: string } | null>(null)
  const [editing, setEditing] = useState<{ id: string; select?: string } | null>(null)
  const canReact = usePlugins().active.includes('reactions')
  const [menu, setMenu] = useState(false)
  // Background tasks sheet, optionally opened on one task.
  const [taskSheet, setTaskSheet] = useState<{ openId: string | null } | null>(null)
  const [pickDir, setPickDir] = useState(false)
  const desktop = useDesktop()
  const scrollRef = useRef<HTMLDivElement>(null)
  const screenRef = useRef<HTMLDivElement>(null)
  const composerRef = useRef<HTMLDivElement>(null)
  const nearBottom = useRef(true)
  const firstPaint = useRef(true)

  const cwd = state?.cwd ?? newCwd ?? device?.defaultCwd ?? ''
  const provider = state?.provider ?? draft.provider
  const model = state ? state.model : draft.model
  const mode = state?.permissionMode ?? draft.mode
  const effort = state ? state.effort : provider === 'claude' ? draft.effort : null
  const classifierModel = state ? state.classifierModel : classifierOf(providers, provider, draft.classifierModel)
  const status = state?.status ?? 'idle'
  const busy = status === 'running' || status === 'requires_action'

  const fileScope = useMemo(() => (id ? { sessionId: id } : null), [id])
  const blocks = useMemo(() => toBlocks(items), [items])
  const tasks = useMemo(() => collectTasks(items, state?.tasks ?? []), [items, state?.tasks])
  const runningTasks = tasks.filter((x) => x.status === 'running').length
  const pendingPerm = items.find((it): it is ToolItem => it.kind === 'tool' && it.permission?.status === 'pending')

  useEffect(() => {
    if (!stepsId) return
    const b = blocks.find((x) => x.type === 'steps' && x.id === stepsId)
    if (b?.type === 'steps') setSteps(b.items)
  }, [blocks, stepsId])

  useEffect(() => {
    if (status !== 'busy_elsewhere' || !id) return
    const timer = setInterval(() => document.visibilityState === 'visible' && session.refresh(), 6000)
    return () => clearInterval(timer)
  }, [status, id, session.refresh])

  // The thread scrolls under the floating composer; pad by its height.
  useLayoutEffect(() => {
    const el = composerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => screenRef.current?.style.setProperty('--composer-h', `${el.offsetHeight}px`))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Keyboard open/close resizes the thread; stay pinned to the bottom.
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      if (nearBottom.current) el.scrollTop = el.scrollHeight
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    if (firstPaint.current && items.length) {
      el.scrollTop = el.scrollHeight
      firstPaint.current = false
    } else if (nearBottom.current) el.scrollTop = el.scrollHeight
  }, [items, pendingPerm, busy])

  const current = models.find((m) => isCurrent(m, provider, model))
  const modelLabel = current?.label ?? prettyModel(model)

  const changeModel = async (m: ModelOption) => {
    if (!id) return setDraft((d) => ({ ...d, provider: m.provider, model: m.value, mode: m.provider === d.provider ? d.mode : defaultMode(providers, m.provider, d.mode) }))
    try {
      session.setState(await api.update(id, m.provider === provider ? { model: m.value } : { provider: m.provider, model: m.value }))
      if (m.provider !== provider) toast(t('composer.switchedTo', { model: m.label }))
    } catch (e: any) {
      toast(e.message)
    }
  }
  const changeMode = async (m: PermissionMode) => {
    if (!id) return setDraft((d) => ({ ...d, mode: m }))
    try {
      session.setState(await api.update(id, { permissionMode: m }))
    } catch (e: any) {
      toast(e.message)
    }
  }
  const changeClassifier = async (model: string) => {
    if (!id) return setDraft((d) => ({ ...d, classifierModel: model }))
    try {
      session.setState(await api.update(id, { classifierModel: model }))
    } catch (err: any) {
      toast(err.message)
    }
  }
  const changeEffort = async (e: EffortLevel) => {
    if (!id) return setDraft((d) => ({ ...d, effort: e }))
    try {
      session.setState(await api.update(id, { effort: e }))
    } catch (err: any) {
      toast(err.message)
    }
  }

  const send = async (text: string, uploads: string[]) => {
    nearBottom.current = true
    if (!id) {
      const res = await api.create({ cwd, provider: draft.provider, model: draft.model, permissionMode: draft.mode, effort: draft.effort, classifierModel: classifierModel ?? undefined, text, uploads })
      navigate(`/s/${res.id}`, true)
      return
    }
    await api.send(id, { text, uploads })
  }

  const lastUserTs = [...items].reverse().find((it) => it.kind === 'user')?.ts
  const streamingText = items.some((it) => it.kind === 'text' && it.streaming)
  const title = state?.title || (id ? '' : t('session.newTitle'))

  return (
    <FileLinkContext.Provider value={fileScope}>
      <div className="screen" ref={screenRef}>
        <div
          className="scroll"
          ref={scrollRef}
          onScroll={(e) => {
            const el = e.currentTarget
            nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 140
          }}
        >
          <div className="thread" style={{ paddingBottom: 'calc(var(--composer-h, 120px) + 16px)' }}>
            {session.hasEarlier && (
              <button className="steps-row" style={{ margin: '4px auto 12px' }} onClick={session.loadAll}>
                <span className="lbl">{t('session.loadEarlier')}</span>
              </button>
            )}
            {id && !state && !session.error && (
              <div className="empty">
                <Spinner />
              </div>
            )}
            {session.error && <div className="empty">{session.error}</div>}
            {blocks.map((b, i) => {
              if (b.type === 'user')
                return (
                  <UserMsg
                    key={b.item.id}
                    item={b.item}
                    sessionId={id}
                    canReact={canReact}
                    onRewind={
                      id && !busy
                        ? () => setRewindAt({ id: b.item.id, text: b.item.text })
                        : undefined
                    }
                  />
                )
              if (b.type === 'text') {
                if (id && editing?.id === b.item.id)
                  return (
                    <div className="msg-text" key={b.item.id}>
                      <ReplyEditor sessionId={id} itemId={b.item.id} text={b.item.text} select={editing.select} onDone={() => setEditing(null)} />
                    </div>
                  )
                const editable = !!id && !busy && !b.item.streaming
                return (
                  <div className="msg-text" key={b.item.id} data-item={editable ? b.item.id : undefined}>
                    <Markdown text={b.item.text} />
                    {b.item.edited && <div className="edited-tag">{t('session.edited')}</div>}
                    <ReactionPills reactions={b.item.reactions} sessionId={id} itemId={b.item.id} />
                    {b.last && !b.item.streaming && !(busy && i === blocks.length - 1) && (
                      <MsgActions text={b.item.text} onEdit={editable ? () => setEditing({ id: b.item.id }) : undefined} react={canReact && id ? { sessionId: id, itemId: b.item.id } : undefined} />
                    )}
                  </div>
                )
              }
              if (b.type === 'steps')
                return (
                  <StepsRow
                    key={b.id}
                    items={b.items}
                    live={busy}
                    sessionId={id}
                    processLive={!!state?.live}
                    onOpenTask={(taskId) => setTaskSheet({ openId: taskId })}
                    onOpen={() => {
                      setSteps(b.items)
                      setStepsId(b.id)
                    }}
                  />
                )
              if (b.type === 'ask') return <AskCard key={b.item.id} item={b.item} sessionId={id!} />
              if (b.type === 'task')
                return <TaskRow key={b.item.id} item={b.item} task={tasks.find((x) => x.id === b.item.taskId)} onOpen={() => setTaskSheet({ openId: b.item.taskId })} />
              return (
                <div key={b.item.id} className={`notice${b.item.level === 'error' ? ' error' : ''}`}>
                  {b.item.code ? t(`notice.${b.item.code}`) : b.item.text}
                </div>
              )
            })}
            {status === 'running' && !streamingText && <Thinking since={lastUserTs} />}
          </div>
        </div>

        <header className="topbar">
          <div className="left">
            <button className="circle-btn" onClick={back} aria-label={t('common.back')}>
              <ChevronLeft size={25} strokeWidth={1.8} />
            </button>
          </div>
          <div className="title">
            <h1>{title}</h1>
            {!id && desktop ? (
              <button className="sub sub-link" onClick={() => setPickDir(true)}>
                {device?.name ?? ''} · {shortPath(cwd)}
              </button>
            ) : (
              <div className="sub">{device?.name ?? ''}</div>
            )}
          </div>
          <div className="right">
            {busy && (
              <span className="circle-btn">
                <span className="ring" />
              </span>
            )}
            {id && (
              <button className="circle-btn" onClick={() => setMenu(true)} aria-label={t('common.more')}>
                <MoreHorizontal size={22} strokeWidth={2} />
              </button>
            )}
          </div>
        </header>

        <div className="composer-wrap" ref={composerRef}>
          {runningTasks > 0 && (
            <button className="tasks-pill" onClick={() => setTaskSheet({ openId: null })}>
              <Spinner size={14} />
              {t('session.backgroundTasks', { n: runningTasks })}
            </button>
          )}
          {pendingPerm && id && <PermissionCard tool={pendingPerm} sessionId={id} />}
          {status === 'busy_elsewhere' ? (
            <div className="busy-note">
              <span className="ring" style={{ width: 16, height: 16, borderWidth: 2 }} /> {t('session.runningElsewhere')}
            </div>
          ) : (
            <Composer
              key={id ?? 'new'}
              busy={busy}
              sessionId={id}
              provider={provider}
              model={model}
              modelLabel={modelLabel}
              effort={effort}
              classifierModel={classifierModel}
              mode={mode}
              models={models}
              providers={providers}
              onModel={changeModel}
              onEffort={changeEffort}
              onClassifier={changeClassifier}
              onMode={changeMode}
              onSend={send}
              onStop={() => id && void api.interrupt(id)}
              autoFocus={!id || desktop}
              enterSends={desktop}
            />
          )}
        </div>

        {steps && (
          <StepsSheet
            steps={steps}
            sessionId={id}
            live={!!state?.live}
            onOpenTask={(taskId) => {
              setSteps(null)
              setStepsId(null)
              setTaskSheet({ openId: taskId })
            }}
            onClose={() => {
              setSteps(null)
              setStepsId(null)
            }}
          />
        )}
        <SelectionMenu enabled={!!id && !busy && !editing} onEdit={(itemId, select) => setEditing({ id: itemId, select })} />
        {rewindAt && id && state && <RewindSheet sessionId={id} cwd={state.cwd} messageId={rewindAt.id} text={rewindAt.text} onClose={() => setRewindAt(null)} />}
        {taskSheet && id && <TasksSheet sessionId={id} tasks={tasks} live={!!state?.live} openId={taskSheet.openId} onClose={() => setTaskSheet(null)} />}
        {menu && id && state && (
          <SessionMenu
            state={state}
            taskCount={tasks.length}
            onTasks={() => {
              setMenu(false)
              setTaskSheet({ openId: null })
            }}
            onClose={() => setMenu(false)}
            onState={session.setState}
          />
        )}
        {pickDir && (
          <DirPicker
            start={cwd}
            onBack={() => setPickDir(false)}
            onClose={() => setPickDir(false)}
            onPick={(p) => {
              setPickDir(false)
              navigate(`/new?cwd=${encodeURIComponent(p)}`, true)
            }}
          />
        )}
      </div>
    </FileLinkContext.Provider>
  )
}

// A provider may bring its own default (DeepSeek opens every permission);
// others never inherit that from a previous draft.
function defaultMode(providers: ProviderInfo[], provider: Provider, previous?: PermissionMode): PermissionMode {
  const preferred = providers.find((p) => p.id === provider)?.defaultPermissionMode
  if (preferred) return preferred
  return previous && previous !== 'bypassPermissions' ? previous : 'auto'
}

function classifierOf(providers: ProviderInfo[], provider: Provider, wanted: string): string | null {
  const list = providers.find((p) => p.id === provider)?.classifierModels
  if (!list?.length) return null
  return list.includes(wanted) ? wanted : list[0]
}

function prettyModel(model: string) {
  const m = model.match(/^claude-(\w+)-(\d+)(?:-(\d+))?/)
  if (m) return `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}${m[3] ? `.${m[3]}` : ''}`
  if (model === 'default') return 'Opus 5.5'
  return model
}

function StepsRow(p: { items: StepItem[]; live: boolean; sessionId: string | null; processLive: boolean; onOpenTask: (taskId: string) => void; onOpen: () => void }) {
  const { items, live } = p
  const inline = useInlineSteps()
  const [expanded, setExpanded] = useState(false)
  const run = live ? runningStep(items) : undefined
  // Prefer the image kept in the transcript; the file itself may be gone.
  const images: ViewerImage[] = items.flatMap((s) => {
    if (s.kind !== 'tool' || s.status !== 'done') return []
    const name = typeof s.input.file_path === 'string' ? s.input.file_path : undefined
    if (s.images?.length) return s.images.map((im) => ({ url: im.url, name }))
    return s.name === 'Read' && name && IMAGE_RE.test(name) ? [{ url: `/api/file?path=${encodeURIComponent(name)}`, name }] : []
  }).filter((im, i, all) => all.findIndex((x) => x.url === im.url) === i)
  let label: React.ReactNode
  if (run) {
    const l = stepLabel(run)
    label = `${l.l1} ${l.l2}`.trim()
  } else if (items.length === 1) {
    const s = items[0]
    const l = stepLabel(s)
    const failed = s.kind === 'tool' && s.status === 'error'
    label = (
      <>
        <span className={failed ? 'err' : undefined}>{l.l1}</span> {l.l2}
      </>
    )
  } else label = stepsSummary(items)
  return (
    <>
      <button className={`steps-row${inline && expanded ? ' open' : ''}`} onClick={inline ? () => setExpanded((x) => !x) : p.onOpen}>
        {run && <Spinner size={16} />}
        <span className="lbl">{label}</span>
        <ChevronRight size={17} strokeWidth={1.7} className="chev" />
      </button>
      {inline && expanded && <InlineSteps steps={items} sessionId={p.sessionId} live={p.processLive} onOpenTask={p.onOpenTask} onClose={() => undefined} />}
      {images.length > 0 && (
        <div className="thumbs">
          {images.map((im, i) => (
            <button key={im.url} onClick={() => openViewer(images, i)} aria-label={t('common.viewImage')}>
              <img src={im.url} loading="lazy" alt="" />
            </button>
          ))}
        </div>
      )}
    </>
  )
}

function TaskRow({ item, task, onOpen }: { item: TaskItem; task?: TaskView; onOpen: () => void }) {
  // No status: a monitor reporting an event rather than an ending.
  const event = !item.status
  const label = t(event ? 'session.monitor' : item.status === 'completed' ? 'session.taskCompleted' : item.status === 'failed' ? 'session.taskFailed' : 'session.taskStopped')
  const detail = event ? item.summary.replace(/^Monitor event:\s*/, '') : task?.description || item.summary
  return (
    <button className="steps-row task-row" onClick={onOpen}>
      <TaskIcon task={{ type: task?.type ?? (event ? 'monitor' : 'task'), status: item.status ?? 'completed' }} size={16} />
      <span className="lbl">
        <span className={item.status === 'failed' ? 'err' : undefined}>{label}</span> {detail}
      </span>
      <ChevronRight size={17} strokeWidth={1.7} style={{ flex: 'none' }} />
    </button>
  )
}

function Thinking({ since }: { since?: number }) {
  const start = useRef(since && Date.now() - since < 3600_000 ? since : Date.now())
  const [, tick] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(timer)
  }, [])
  const secs = Math.max(0, Math.floor((Date.now() - start.current) / 1000))
  const elapsed = t('time.duration', { secs })
  return (
    <div className="thinking">
      <span className="dots">
        <i />
        <i />
        <i />
      </span>
      {elapsed} · {t(secs < 20 ? 'session.thinking' : 'session.stillThinking')}
    </div>
  )
}

function UserMsg({ item, onRewind, sessionId, canReact }: { item: Extract<Item, { kind: 'user' }>; onRewind?: () => void; sessionId: string | null; canReact: boolean }) {
  const files = (item.files ?? []).filter((f) => !/\.(jpe?g|png|gif|webp|heic)$/i.test(f))
  // Touch screens: tap the bubble for its actions.
  const [shown, setShown] = useState(false)
  return (
    <div className={`msg-user${shown ? ' shown' : ''}`}>
      {item.images && (
        <div className="msg-images">
          {item.images.map((im, i) => (
            <button key={im.url} onClick={() => openViewer(item.images!, i)} aria-label={t('common.viewImage')}>
              <img src={im.url} loading="lazy" alt="" />
            </button>
          ))}
        </div>
      )}
      {files.map((f) => (
        <div className="file-chip" key={f}>
          <FileText size={15} /> {basename(f).replace(/^[\w-]{12}-/, '')}
        </div>
      ))}
      {item.text && (
        <div className="bubble" onClick={() => setShown((x) => !x)}>
          {item.text}
        </div>
      )}
      <ReactionPills reactions={item.reactions} sessionId={sessionId} itemId={item.id} />
      <div className="msg-actions user">
        {canReact && sessionId && <ReactButton sessionId={sessionId} itemId={item.id} />}
        {item.text && (
          <button
            onClick={async () => {
              await copyText(item.text)
              toast(t('common.copied'))
            }}
            aria-label={t('common.copy')}
            title={t('common.copy')}
          >
            <Copy size={16} strokeWidth={1.6} />
          </button>
        )}
        {onRewind && (
          <button onClick={onRewind} aria-label={t('session.rewindHere')} title={t('session.rewindHere')}>
            <Undo2 size={16} strokeWidth={1.6} />
          </button>
        )}
      </div>
    </div>
  )
}

function MsgActions({ text, onEdit, react }: { text: string; onEdit?: () => void; react?: { sessionId: string; itemId: string } }) {
  const [speaking, setSpeaking] = useState(false)
  const speak = () => {
    const synth = window.speechSynthesis
    if (!synth) return
    if (speaking) {
      synth.cancel()
      setSpeaking(false)
      return
    }
    const plain = text.replace(/```[\s\S]*?```/g, '').replace(/[`*_#>|-]/g, ' ')
    const u = new SpeechSynthesisUtterance(plain)
    u.lang = /[一-龥]/.test(plain) ? 'zh-CN' : 'en-US'
    u.onend = () => setSpeaking(false)
    synth.speak(u)
    setSpeaking(true)
  }
  return (
    <div className="msg-actions">
      <button
        onClick={async () => {
          await copyText(text)
          toast(t('common.copied'))
        }}
        aria-label={t('common.copy')}
      >
        <Copy size={17} strokeWidth={1.6} />
      </button>
      <button onClick={speak} aria-label={t('session.readAloud')}>
        {speaking ? <Square size={17} strokeWidth={1.7} /> : <Play size={17} strokeWidth={1.6} />}
      </button>
      {react && <ReactButton sessionId={react.sessionId} itemId={react.itemId} size={17} />}
      {onEdit && (
        <button onClick={onEdit} aria-label={t('common.edit')} title={t('common.edit')}>
          <PencilLine size={17} strokeWidth={1.6} />
        </button>
      )}
    </div>
  )
}

function AskCard({ item, sessionId }: { item: AskItem; sessionId: string }) {
  const [picked, setPicked] = useState<Record<string, string[]>>({})
  const [other, setOther] = useState<Record<string, string>>({})
  const [sending, setSending] = useState(false)
  const pending = item.status === 'pending' && !!item.reqId

  if (!pending) {
    const answers = parseAnswers(item.answer)
    return (
      <div className="ask-card">
        <div className="label">{t('ask.question')}</div>
        {item.questions.map((q) => (
          <div key={q.question}>
            <div className="q">{q.question}</div>
            <div className="a">{answers[q.question] ?? (item.status === 'cancelled' ? t('ask.skipped') : '')}</div>
          </div>
        ))}
      </div>
    )
  }

  const answerFor = (q: string) => [...(picked[q] ?? []), ...(other[q]?.trim() ? [other[q].trim()] : [])].join(', ')
  const ready = item.questions.every((q) => answerFor(q.question))

  const submit = async (skip = false) => {
    setSending(true)
    try {
      const answers = skip ? null : Object.fromEntries(item.questions.map((q) => [q.question, answerFor(q.question)]))
      await api.answer(sessionId, item.reqId!, answers)
    } catch (e: any) {
      toast(e.message)
      setSending(false)
    }
  }

  return (
    <div className="ask-card">
      <div className="label">{t('ask.question')}</div>
      {item.questions.map((q) => (
        <div key={q.question} style={{ marginBottom: 16 }}>
          <div className="q active">{q.question}</div>
          <div className="chips">
            {q.options.map((o) => {
              const on = picked[q.question]?.includes(o.label)
              return (
                <button
                  key={o.label}
                  className={`chip${on ? ' on' : ''}`}
                  onClick={() =>
                    setPicked((p) => {
                      const cur = p[q.question] ?? []
                      const next = q.multiSelect ? (on ? cur.filter((x) => x !== o.label) : [...cur, o.label]) : on ? [] : [o.label]
                      return { ...p, [q.question]: next }
                    })
                  }
                >
                  {o.label}
                  {o.description && <small>{o.description}</small>}
                </button>
              )
            })}
          </div>
          <textarea rows={1} placeholder={t('ask.other')} value={other[q.question] ?? ''} onChange={(e) => setOther((o) => ({ ...o, [q.question]: e.target.value }))} />
        </div>
      ))}
      <div className="btn-row">
        <button className="btn" disabled={sending} onClick={() => submit(true)}>
          {t('ask.skip')}
        </button>
        <button className="btn primary" disabled={!ready || sending} onClick={() => submit()}>
          {t('ask.submit')}
        </button>
      </div>
    </div>
  )
}

function parseAnswers(text?: string): Record<string, string> {
  const out: Record<string, string> = {}
  if (!text) return out
  // Live answers are stored as "question\nanswer" blocks; transcripts carry
  // Claude Code's `"question"="answer"` sentence.
  for (const m of text.matchAll(/"([^"]+)"="([^"]*)"/g)) out[m[1]] = m[2]
  if (Object.keys(out).length) return out
  for (const block of text.split('\n\n')) {
    const [q, ...rest] = block.split('\n')
    if (rest.length) out[q] = rest.join('\n')
  }
  return out
}

function permissionText(tool: ToolItem): { head: string; body: string } {
  const i = tool.input as Record<string, any>
  switch (tool.name) {
    case 'Bash':
      return { head: t('perm.runCommand'), body: i.command ?? '' }
    case 'Write':
      return { head: t('perm.writeFile'), body: i.file_path ?? '' }
    case 'Edit':
    case 'MultiEdit':
      return { head: t('perm.editFile'), body: i.file_path ?? '' }
    case 'WebFetch':
      return { head: t('perm.openUrl'), body: i.url ?? '' }
    case 'ExitPlanMode':
      return { head: t('perm.startPlan'), body: i.plan ?? '' }
    default:
      return { head: t('perm.useTool', { tool: tool.name.replace(/^mcp__(.+?)__/, '$1 · ') }), body: JSON.stringify(i, null, 2) }
  }
}

function PermissionCard({ tool, sessionId }: { tool: ToolItem; sessionId: string }) {
  const [sending, setSending] = useState(false)
  const perm = tool.permission!
  const { head, body } = permissionText(tool)
  const decide = async (d: 'allow' | 'always' | 'deny') => {
    setSending(true)
    try {
      await api.decide(sessionId, perm.reqId, d)
    } catch (e: any) {
      toast(e.message)
    } finally {
      setSending(false)
    }
  }
  return (
    <div className="perm-card">
      <div className="h">{perm.title || head}</div>
      {perm.description && !body.endsWith(perm.description) && <div className="d">{perm.description}</div>}
      {body && <pre>{body}</pre>}
      <div className="btn-row">
        <button className="btn" disabled={sending} onClick={() => decide('deny')}>
          {t('perm.deny')}
        </button>
        <button className="btn primary" disabled={sending} onClick={() => decide('allow')}>
          {t('perm.allow')}
        </button>
      </div>
      {perm.canAlways && (
        <button className="always" disabled={sending} onClick={() => decide('always')}>
          {t('perm.always')}
        </button>
      )}
    </div>
  )
}

interface Attachment {
  key: string
  name: string
  preview?: string
  uploadId?: string
  failed?: boolean
}

function useDictation(onText: (t: string) => void) {
  const [on, setOn] = useState(false)
  const rec = useRef<any>(null)
  const Ctor = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition
  const toggle = () => {
    if (!Ctor) return toast(t('composer.noDictation'))
    if (on) {
      rec.current?.stop()
      return
    }
    const r = new Ctor()
    r.lang = 'zh-CN'
    r.interimResults = false
    r.continuous = true
    r.onresult = (e: any) => {
      for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) onText(e.results[i][0].transcript)
    }
    r.onend = () => setOn(false)
    r.onerror = () => setOn(false)
    rec.current = r
    r.start()
    setOn(true)
  }
  useEffect(() => () => rec.current?.stop(), [])
  return { on, toggle }
}

function Composer(p: {
  busy: boolean
  sessionId: string | null
  provider: Provider
  model: string
  modelLabel: string
  effort: EffortLevel | null
  classifierModel: string | null
  mode: PermissionMode
  models: ModelOption[]
  providers: ProviderInfo[]
  onModel: (m: ModelOption) => void
  onEffort: (e: EffortLevel) => void
  onClassifier: (model: string) => void
  onMode: (m: PermissionMode) => void
  onSend: (text: string, uploads: string[]) => Promise<void>
  onStop: () => void
  autoFocus?: boolean
  enterSends?: boolean
}) {
  const storeKey = `farline.draft.${p.sessionId ?? 'new'}`
  const [text, setText] = useState(() => sessionStorage.getItem(storeKey) ?? '')
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<{ key: string; text: string }>).detail
      if (d.key !== storeKey) return
      setText(d.text)
      ta.current?.focus()
    }
    window.addEventListener(DRAFT_EVENT, on)
    return () => window.removeEventListener(DRAFT_EVENT, on)
  }, [storeKey])
  const [atts, setAtts] = useState<Attachment[]>([])
  const [sheet, setSheet] = useState<'context' | 'model' | null>(null)
  const [menuAt, setMenuAt] = useState<DOMRect | null>(null)
  const [sending, setSending] = useState(false)
  const ta = useRef<HTMLTextAreaElement>(null)
  const dictation = useDictation((said) => setText((cur) => (cur ? `${cur}${said}` : said)))

  // Grow with the text; scroll only past the cap. Measured again when the
  // box changes width or a skin changes its padding.
  useLayoutEffect(() => {
    const el = ta.current
    if (!el) return
    const fit = () => {
      el.style.height = 'auto'
      const max = window.innerHeight * 0.38
      el.style.height = `${Math.min(el.scrollHeight, max)}px`
      el.style.overflowY = el.scrollHeight > max ? 'auto' : 'hidden'
    }
    fit()
    let w = el.clientWidth
    const ro = new ResizeObserver(() => {
      if (el.clientWidth !== w) {
        w = el.clientWidth
        fit()
      }
    })
    ro.observe(el)
    const onStyles = () => requestAnimationFrame(fit)
    document.addEventListener('load', onStyles, true)
    return () => {
      ro.disconnect()
      document.removeEventListener('load', onStyles, true)
    }
  }, [text])

  useEffect(() => {
    sessionStorage.setItem(storeKey, text)
  }, [text, storeKey])

  const addFiles = (files: File[]) => {
    for (const f of files) {
      const key = Math.random().toString(36).slice(2)
      const preview = f.type.startsWith('image/') ? URL.createObjectURL(f) : undefined
      setAtts((a) => [...a, { key, name: f.name, preview }])
      void (async () => {
        try {
          const { blob, name } = await downscaleImage(f)
          const up = await api.upload(blob, name)
          setAtts((a) => a.map((x) => (x.key === key ? { ...x, uploadId: up.id } : x)))
        } catch (e: any) {
          toast(e?.message ?? t('composer.uploadFailed'))
          setAtts((a) => a.map((x) => (x.key === key ? { ...x, failed: true } : x)))
        }
      })()
    }
  }

  const uploading = atts.some((a) => !a.uploadId && !a.failed)
  const hasContent = !!text.trim() || atts.some((a) => a.uploadId)
  const ready = hasContent && !uploading && !sending

  const submit = async () => {
    if (!ready) return
    setSending(true)
    try {
      await p.onSend(text, atts.filter((a) => a.uploadId).map((a) => a.uploadId!))
      setText('')
      sessionStorage.removeItem(storeKey)
      atts.forEach((a) => a.preview && URL.revokeObjectURL(a.preview))
      setAtts([])
    } catch (e: any) {
      toast(e?.message ?? t('common.sendFailed'))
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="composer">
      {atts.length > 0 && (
        <div className="attach-row">
          {atts.map((a) => (
            <div className="attach" key={a.key}>
              {a.preview ? (
                <img src={a.preview} alt="" />
              ) : (
                <div className="file">
                  <FileText size={16} style={{ flex: 'none' }} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.name}</span>
                </div>
              )}
              {!a.uploadId && !a.failed && (
                <div className="busy">
                  <Spinner size={18} />
                </div>
              )}
              <button className="x" onClick={() => setAtts((all) => all.filter((x) => x.key !== a.key))} aria-label={t('common.remove')}>
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
      <textarea
        ref={ta}
        rows={1}
        value={text}
        autoFocus={p.autoFocus}
        spellCheck={false}
        data-gramm="false"
        data-gramm_editor="false"
        data-enable-grammarly="false"
        placeholder={t(p.sessionId ? 'composer.reply' : 'composer.newPrompt')}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' || e.nativeEvent.isComposing || e.keyCode === 229) return
          // Desktop: Enter sends, Shift+Enter breaks the line. Phone: only Cmd/Ctrl+Enter.
          if (e.metaKey || e.ctrlKey || (p.enterSends && !e.shiftKey)) {
            e.preventDefault()
            void submit()
          }
        }}
        onPaste={(e) => {
          const files = Array.from(e.clipboardData.files)
          if (files.length) {
            e.preventDefault()
            addFiles(files)
          }
        }}
      />
      <div className="bar">
        <button className="round" onClick={() => setSheet('context')} aria-label={t('composer.add')}>
          <Plus size={21} strokeWidth={1.8} />
        </button>
        <button
          className="model-pill"
          onClick={(e) => {
            // Some skins want a menu at the button instead of a sheet.
            if (wantsMenuPicker()) setMenuAt(e.currentTarget.getBoundingClientRect())
            else setSheet('model')
          }}
        >
          <span className="ml">{p.modelLabel}</span>
          {p.effort && <span className="eff">{EFFORT_LABELS[p.effort]}</span>}
        </button>
        <span className="spacer" />
        <button className={`round mic${dictation.on ? ' on' : ''}`} onClick={dictation.toggle} aria-label={t('composer.dictate')}>
          <Mic size={19} strokeWidth={1.8} />
        </button>
        {p.busy && !hasContent ? (
          <button className="round stop" onClick={p.onStop} aria-label={t('composer.stop')}>
            <Square size={14} fill="currentColor" />
          </button>
        ) : (
          <button className="round send" disabled={!ready} onClick={() => void submit()} aria-label={t('composer.send')}>
            {sending ? <Spinner size={18} /> : <ArrowUp size={21} strokeWidth={2.4} />}
          </button>
        )}
      </div>
      {sheet === 'context' && <ContextSheet sessionId={p.sessionId} mode={p.mode} onFiles={addFiles} onMode={p.onMode} onClose={() => setSheet(null)} />}
      {menuAt && (
        <ModelMenu
          anchor={menuAt}
          lockAgent={!!p.sessionId}
          models={p.models}
          providers={p.providers}
          provider={p.provider}
          model={p.model}
          effort={p.effort}
          classifierModel={p.classifierModel}
          onModel={p.onModel}
          onEffort={p.onEffort}
          onClassifier={p.onClassifier}
          onClose={() => setMenuAt(null)}
        />
      )}
      {sheet === 'model' && (
        <ModelSheet
          lockAgent={!!p.sessionId}
          models={p.models}
          providers={p.providers}
          provider={p.provider}
          model={p.model}
          effort={p.effort}
          classifierModel={p.classifierModel}
          onModel={p.onModel}
          onEffort={p.onEffort}
          onClassifier={p.onClassifier}
          onClose={() => setSheet(null)}
        />
      )}
    </div>
  )
}

function SessionMenu({ state, taskCount, onTasks, onClose, onState }: { state: SessionState; taskCount: number; onTasks: () => void; onClose: () => void; onState: (s: SessionState) => void }) {
  const { sessionActions } = usePlugins()
  const [renaming, setRenaming] = useState(false)
  const [title, setTitle] = useState(state.title)
  if (renaming)
    return (
      <Sheet
        title={t('session.rename')}
        onClose={onClose}
        onBack={() => setRenaming(false)}
        footer={
          <button
            className="black-pill"
            disabled={!title.trim()}
            onClick={async () => {
              onState(await api.update(state.id, { title }))
              onClose()
            }}
          >
            {t('common.save')}
          </button>
        }
      >
        <input className="text-input" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} />
      </Sheet>
    )
  return (
    <Sheet title={state.title} onClose={onClose}>
      <button className="row-btn" onClick={() => setRenaming(true)}>
        <PencilLine size={19} strokeWidth={1.6} />
        <span className="grow">{t('session.rename')}</span>
      </button>
      {taskCount > 0 && (
        <button className="row-btn" onClick={onTasks}>
          <ListChecks size={19} strokeWidth={1.6} />
          <span className="grow">{t('session.tasks')}</span>
          <span className="value">{taskCount}</span>
        </button>
      )}
      <button
        className="row-btn"
        onClick={async () => {
          await copyText(state.id)
          toast(t('session.idCopied'))
          onClose()
        }}
      >
        <Copy size={19} strokeWidth={1.6} />
        <span className="grow">{t('session.copyId')}</span>
      </button>
      <button
        className="row-btn"
        onClick={async () => {
          await api.update(state.id, { hidden: true })
          onClose()
          navigate('/', true)
        }}
      >
        <EyeOff size={19} strokeWidth={1.6} />
        <span className="grow">{t('session.hide')}</span>
      </button>
      {state.status === 'busy_elsewhere' && (
        <button className="row-btn" onClick={() => location.reload()}>
          <RefreshCw size={19} strokeWidth={1.6} />
          <span className="grow">{t('common.refresh')}</span>
        </button>
      )}
      {sessionActions.map((a, i) => (
        <PluginBoundary key={`${a.pluginId}:${i}`} pluginId={a.pluginId} fallback={null}>
          <button
            className="row-btn"
            onClick={async () => {
              onClose()
              try {
                await a.run(state)
              } catch (e: any) {
                toast(e?.message ?? t('common.failed'))
              }
            }}
          >
            {a.icon ?? <Puzzle size={19} strokeWidth={1.6} />}
            <span className="grow">{tx(a.label)}</span>
          </button>
        </PluginBoundary>
      ))}
    </Sheet>
  )
}
