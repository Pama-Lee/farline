// One list of a session's background tasks: what the transcript says
// (tool calls that went to the background, their notifications) merged with
// the live state of the running process.
import type { BackgroundTask, Item, TaskEndStatus } from '../../../shared/types.ts'

export interface TaskView {
  id: string
  type: string
  description: string
  status: 'running' | TaskEndStatus | 'ended'
  toolUseId?: string
  startedAt?: number
  endedAt?: number
  summary?: string
  result?: string
  command?: string
  prompt?: string
  lastTool?: string
  tokens?: number
  toolUses?: number
}

const TOOL_TYPES: Record<string, string> = { Bash: 'local_bash', Agent: 'local_agent', Task: 'local_agent', Monitor: 'monitor' }

export const TYPE_LABELS: Record<string, string> = {
  local_bash: '命令',
  local_agent: '子代理',
  monitor: '监控',
  local_workflow: '工作流',
  mcp_task: 'MCP',
}

export const STATUS_LABELS: Record<TaskView['status'], string> = {
  running: '运行中',
  completed: '已完成',
  failed: '失败',
  stopped: '已停止',
  ended: '已结束',
}

const str = (v: unknown) => (typeof v === 'string' ? v : undefined)

export function collectTasks(items: Item[], live: BackgroundTask[]): TaskView[] {
  const byId = new Map<string, TaskView>()
  const order: string[] = []
  const get = (id: string) => {
    let t = byId.get(id)
    if (!t) {
      t = { id, type: 'task', description: '', status: 'ended' }
      byId.set(id, t)
      order.push(id)
    }
    return t
  }
  for (const it of items) {
    if (it.kind === 'tool' && it.taskId) {
      const t = get(it.taskId)
      t.type = TOOL_TYPES[it.name] ?? t.type
      t.toolUseId = it.id
      t.command = str(it.input.command)
      t.prompt = str(it.input.prompt)
      t.description = str(it.input.description) || t.command || t.prompt || it.name
    } else if (it.kind === 'task' && it.status) {
      const t = get(it.taskId)
      t.status = it.status
      t.summary = it.summary
      if (it.result) t.result = it.result
      t.endedAt = it.ts
    }
  }
  for (const l of live) {
    const t = get(l.id)
    Object.assign(t, {
      type: l.type,
      description: l.description || t.description,
      status: l.status,
      startedAt: l.startedAt,
      endedAt: l.endedAt ?? t.endedAt,
      summary: l.summary ?? t.summary,
      lastTool: l.lastTool,
      tokens: l.tokens,
      toolUses: l.toolUses,
    })
  }
  // Not in the live list and no ending on record: it died with an earlier process.
  for (const t of byId.values()) if (t.status === 'running' && !live.some((l) => l.id === t.id)) t.status = 'ended'
  const rank = (t: TaskView) => (t.status === 'running' ? 0 : 1)
  return order
    .map((id) => byId.get(id)!)
    .reverse()
    .sort((a, b) => rank(a) - rank(b))
}

export function duration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s} 秒`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} 分 ${s % 60} 秒`
  return `${Math.floor(m / 60)} 小时 ${m % 60} 分`
}
