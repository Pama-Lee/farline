// Turns the flat item list into render blocks and gives tool calls short
// labels ("Ran", "Searched the web"...).
import type { Item } from '../../../shared/types.ts'
import { t } from '../i18n.ts'

export type StepItem = Extract<Item, { kind: 'tool' } | { kind: 'thinking' }>

export type Block =
  | { type: 'user'; item: Extract<Item, { kind: 'user' }> }
  | { type: 'text'; item: Extract<Item, { kind: 'text' }>; last: boolean }
  | { type: 'steps'; id: string; items: StepItem[] }
  | { type: 'ask'; item: Extract<Item, { kind: 'ask' }> }
  | { type: 'notice'; item: Extract<Item, { kind: 'notice' }> }
  | { type: 'task'; item: Extract<Item, { kind: 'task' }> }

export function toBlocks(items: Item[]): Block[] {
  const blocks: Block[] = []
  let steps: StepItem[] = []
  const flush = () => {
    if (steps.length) blocks.push({ type: 'steps', id: steps[0].id, items: steps })
    steps = []
  }
  for (const it of items) {
    if (it.kind === 'tool' || it.kind === 'thinking') {
      if (it.kind === 'thinking' && !it.text.trim()) continue
      steps.push(it)
      continue
    }
    flush()
    if (it.kind === 'user') blocks.push({ type: 'user', item: it })
    else if (it.kind === 'text') blocks.push({ type: 'text', item: it, last: false })
    else if (it.kind === 'ask') blocks.push({ type: 'ask', item: it })
    else if (it.kind === 'notice') blocks.push({ type: 'notice', item: it })
    else if (it.kind === 'task') blocks.push({ type: 'task', item: it })
  }
  flush()
  // The last text block before each user turn (or the end) gets actions.
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]
    if (b.type !== 'text') continue
    const next = blocks.slice(i + 1).find((x) => x.type !== 'notice' && x.type !== 'task')
    if (!next || next.type === 'user') b.last = true
  }
  return blocks
}

type Category = 'web' | 'bash' | 'read' | 'edit' | 'search' | 'agent' | 'think' | 'todo' | 'other'

export function category(s: StepItem): Category {
  if (s.kind === 'thinking') return 'think'
  const n = s.name
  if (n === 'WebSearch' || n === 'WebFetch') return 'web'
  if (n === 'Bash' || n === 'BashOutput' || n === 'KillShell' || n === 'KillBash') return 'bash'
  if (n === 'Read' || n === 'NotebookRead') return 'read'
  if (n === 'Edit' || n === 'Write' || n === 'MultiEdit' || n === 'NotebookEdit') return 'edit'
  if (n === 'Grep' || n === 'Glob' || n === 'LS') return 'search'
  if (n === 'Agent' || n === 'Task') return 'agent'
  if (n === 'TodoWrite') return 'todo'
  return 'other'
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function fileName(p: string) {
  return p.split('/').pop() || p
}

export function stepLabel(s: StepItem): { l1: string; l2: string } {
  if (s.kind === 'thinking') return { l1: t(s.streaming ? 'step.thinking' : 'step.thought'), l2: s.text.replace(/\s+/g, ' ').slice(0, 80) }
  const i = s.input
  const done = s.status !== 'running'
  if (s.taskId) return { l1: t(s.name === 'Monitor' ? 'step.monitorStarted' : 'step.backgrounded'), l2: str(i.description) || str(i.command) || str(i.prompt) }
  switch (s.name) {
    case 'Bash':
      return { l1: t(done ? 'step.ran' : 'step.running'), l2: str(i.description) || str(i.command) }
    case 'WebSearch':
      return { l1: t(done ? 'step.searchedWeb' : 'step.searchingWeb'), l2: str(i.query) }
    case 'WebFetch':
      return { l1: t(done ? 'step.fetched' : 'step.fetching'), l2: str(i.url) }
    case 'Read':
      return { l1: t(done ? 'step.read' : 'step.reading'), l2: fileName(str(i.file_path)) }
    case 'Edit':
    case 'MultiEdit':
      return { l1: t(done ? 'step.edited' : 'step.editing'), l2: fileName(str(i.file_path)) }
    case 'Write':
      return { l1: t(done ? 'step.wrote' : 'step.writing'), l2: fileName(str(i.file_path)) }
    case 'NotebookEdit':
      return { l1: t(done ? 'step.edited' : 'step.editing'), l2: fileName(str(i.notebook_path)) }
    case 'Grep':
      return { l1: t(done ? 'step.searchedCode' : 'step.searchingCode'), l2: str(i.pattern) }
    case 'Glob':
      return { l1: t(done ? 'step.foundFiles' : 'step.findingFiles'), l2: str(i.pattern) }
    case 'Agent':
    case 'Task':
      return { l1: t(done ? 'step.subtaskDone' : 'step.subtaskRunning'), l2: str(i.description) }
    case 'TodoWrite':
      return { l1: t('step.updatedTodos'), l2: Array.isArray(i.todos) ? t('step.todoCount', { n: i.todos.length }) : '' }
    case 'Skill':
      return { l1: t('step.usedSkill'), l2: str(i.skill) || str(i.command) }
    case 'ToolSearch':
      return { l1: t('step.loadedTools'), l2: str(i.query) }
    default: {
      const mcp = s.name.match(/^mcp__(.+?)__(.+)$/)
      if (mcp) return { l1: t(done ? 'step.called' : 'step.calling', { name: mcp[1].replace(/^claude_ai_/, '') }), l2: mcp[2] }
      return { l1: t(done ? 'step.called' : 'step.calling', { name: s.name }), l2: '' }
    }
  }
}

const SUMMARY = (c: Category, n: number) => t(`steps.${c}`, { n })

export function stepsSummary(items: StepItem[]): string {
  const counts = new Map<Category, number>()
  for (const s of items) {
    const c = category(s)
    counts.set(c, (counts.get(c) ?? 0) + (c === 'edit' && s.kind === 'tool' ? 0 : 1))
  }
  const edited = new Set(items.filter((s) => s.kind === 'tool' && category(s) === 'edit').map((s) => str((s as any).input.file_path)))
  if (counts.has('edit')) counts.set('edit', edited.size || 1)
  // Thinking only shows up in the summary when nothing else happened.
  if (counts.size > 1) counts.delete('think')
  return t('common.list', { items: [...counts.entries()].map(([c, n]) => SUMMARY(c, n)) })
}

export function runningStep(items: StepItem[]): StepItem | undefined {
  return [...items].reverse().find((s) => (s.kind === 'tool' ? s.status === 'running' : s.streaming))
}
