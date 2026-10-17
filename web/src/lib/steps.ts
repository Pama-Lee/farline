// Turns the flat item list into render blocks and gives tool calls the
// Chinese labels the Claude app uses ("已运行", "已搜索网页"...).
import type { Item } from '../../../shared/types.ts'

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
  if (s.kind === 'thinking') return { l1: s.streaming ? '正在思考' : '已思考', l2: s.text.replace(/\s+/g, ' ').slice(0, 80) }
  const i = s.input
  const done = s.status !== 'running'
  if (s.taskId) return { l1: s.name === 'Monitor' ? '已开始监控' : '已转入后台', l2: str(i.description) || str(i.command) || str(i.prompt) }
  switch (s.name) {
    case 'Bash':
      return { l1: done ? '已运行' : '正在运行', l2: str(i.description) || str(i.command) }
    case 'WebSearch':
      return { l1: done ? '已搜索网页' : '正在搜索网页', l2: str(i.query) }
    case 'WebFetch':
      return { l1: done ? '已打开网页' : '正在打开网页', l2: str(i.url) }
    case 'Read':
      return { l1: done ? '已读取' : '正在读取', l2: fileName(str(i.file_path)) }
    case 'Edit':
    case 'MultiEdit':
      return { l1: done ? '已编辑' : '正在编辑', l2: fileName(str(i.file_path)) }
    case 'Write':
      return { l1: done ? '已写入' : '正在写入', l2: fileName(str(i.file_path)) }
    case 'NotebookEdit':
      return { l1: done ? '已编辑' : '正在编辑', l2: fileName(str(i.notebook_path)) }
    case 'Grep':
      return { l1: done ? '已搜索代码' : '正在搜索代码', l2: str(i.pattern) }
    case 'Glob':
      return { l1: done ? '已查找文件' : '正在查找文件', l2: str(i.pattern) }
    case 'Agent':
    case 'Task':
      return { l1: done ? '子任务已完成' : '子任务进行中', l2: str(i.description) }
    case 'TodoWrite':
      return { l1: '已更新待办', l2: Array.isArray(i.todos) ? `${i.todos.length} 项` : '' }
    case 'Skill':
      return { l1: '已使用技能', l2: str(i.skill) || str(i.command) }
    case 'ToolSearch':
      return { l1: '已加载工具', l2: str(i.query) }
    default: {
      const mcp = s.name.match(/^mcp__(.+?)__(.+)$/)
      if (mcp) return { l1: done ? `已调用 ${mcp[1].replace(/^claude_ai_/, '')}` : `正在调用 ${mcp[1].replace(/^claude_ai_/, '')}`, l2: mcp[2] }
      return { l1: done ? `已调用 ${s.name}` : `正在调用 ${s.name}`, l2: '' }
    }
  }
}

const SUMMARY: Record<Category, (n: number) => string> = {
  web: () => '已浏览网页',
  bash: (n) => `运行了 ${n} 条命令`,
  read: (n) => `读取了 ${n} 个文件`,
  edit: (n) => `编辑了 ${n} 个文件`,
  search: () => '搜索了代码',
  agent: (n) => `完成了 ${n} 个子任务`,
  think: () => '已思考',
  todo: () => '更新了待办',
  other: (n) => `调用了 ${n} 个工具`,
}

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
  return [...counts.entries()].map(([c, n]) => SUMMARY[c](n)).join(', ')
}

export function runningStep(items: StepItem[]): StepItem | undefined {
  return [...items].reverse().find((s) => (s.kind === 'tool' ? s.status === 'running' : s.streaming))
}
