import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { config } from './config.ts'
import type { EffortLevel, PermissionMode, Provider } from '../../shared/types.ts'

export interface SessionMeta {
  provider: Provider
  model: string
  permissionMode: PermissionMode
  effort?: EffortLevel
  classifierModel?: string
  hidden?: boolean
  title?: string
  // Rewound: the next process resumes at `at`, and the transcript is shown
  // without `from` (the user message rewound to) and what followed it.
  rewind?: { at: string; from: string }
  // Reply text the user rewrote, by item id.
  edited?: string[]
}

interface State {
  sessions: Record<string, SessionMeta>
  // Generated titles for sessions created elsewhere (Claude app, terminal).
  titles: Record<string, string>
  pushSubs: PushSub[]
  prefs: { lastCwd?: string; provider?: Provider; model?: string; permissionMode?: PermissionMode; effort?: EffortLevel; classifierModel?: string }
}

export interface PushSub {
  endpoint: string
  keys: { p256dh: string; auth: string }
}

const file = join(config.dataDir, 'state.json')

function load(): State {
  try {
    return { sessions: {}, titles: {}, pushSubs: [], prefs: {}, ...JSON.parse(readFileSync(file, 'utf8')) }
  } catch {
    return { sessions: {}, titles: {}, pushSubs: [], prefs: {} }
  }
}

export const state = load()

let timer: NodeJS.Timeout | undefined
export function save() {
  clearTimeout(timer)
  timer = setTimeout(() => {
    const tmp = `${file}.tmp`
    writeFileSync(tmp, JSON.stringify(state, null, 1), { mode: 0o600 })
    renameSync(tmp, file)
  }, 200)
}
