// The agent runtimes Farline drives: Claude Code and pi. Finds them, reports
// their versions, and installs them for the user from the setup page.
import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import type { AgentStatus } from '../../shared/types.ts'
import { config } from './config.ts'
import { piPath, piVersion, invalidatePiModels } from './pi.ts'

type Id = AgentStatus['id']

const HOME = homedir()
const LOCAL_BIN = join(HOME, '.local/bin')

// Official installers. pi goes to ~/.local so no root is needed.
const NPM = existsSync(join(dirname(process.execPath), 'npm')) ? join(dirname(process.execPath), 'npm') : 'npm'
const INSTALL: Record<Id, string> = {
  claude: 'curl -fsSL https://claude.ai/install.sh | bash',
  pi: `"${NPM}" install -g --prefix "${join(HOME, '.local')}" @mariozechner/pi-coding-agent`,
}
const NAMES: Record<Id, string> = { claude: 'Claude Code', pi: 'pi' }
const HOMEPAGES: Record<Id, string> = { claude: 'https://claude.com/claude-code', pi: 'https://pi.dev' }

const jobs = new Map<Id, { running: boolean; log: string; error?: string }>()
let claudeCache: { version?: string } | null = null

function claudeVersion(fresh = false) {
  if (!fresh && claudeCache) return claudeCache.version
  let version: string | undefined
  if (existsSync(config.claudePath)) {
    const r = spawnSync(config.claudePath, ['--version'], { encoding: 'utf8', timeout: 15_000 })
    version = r.status === 0 ? r.stdout.trim().split(/\s+/)[0] : undefined
  }
  claudeCache = { version }
  return version
}

export function agentStatus(id: Id, fresh = false): AgentStatus {
  const job = jobs.get(id)
  const path = id === 'claude' ? (existsSync(config.claudePath) ? config.claudePath : undefined) : piPath()
  const version = id === 'claude' ? claudeVersion(fresh) : piVersion(fresh)
  return {
    id,
    name: NAMES[id],
    homepage: HOMEPAGES[id],
    installed: !!path,
    version,
    path,
    installing: !!job?.running,
    log: job?.log ?? '',
    error: job?.error,
  }
}

export function agents(fresh = false): AgentStatus[] {
  return (['claude', 'pi'] as Id[]).map((id) => agentStatus(id, fresh))
}

export function install(id: Id, onDone: () => void) {
  if (jobs.get(id)?.running) return
  const job: { running: boolean; log: string; error?: string } = { running: true, log: `$ ${INSTALL[id]}\n` }
  jobs.set(id, job)
  const env: Record<string, string | undefined> = { ...process.env, PATH: [LOCAL_BIN, dirname(process.execPath), process.env.PATH].join(delimiter) }
  for (const k of Object.keys(env)) if (k.startsWith('FARLINE_')) delete env[k]
  const p = spawn('bash', ['-lc', INSTALL[id]], { cwd: HOME, env, stdio: ['ignore', 'pipe', 'pipe'] })
  const add = (d: Buffer) => {
    // Progress bars redraw with \r; keep the last state of each line.
    job.log = (job.log + d.toString()).replace(/[^\n]*\r(?!\n)/g, '').slice(-12_000)
  }
  p.stdout.on('data', add)
  p.stderr.on('data', add)
  p.on('error', (e) => {
    job.running = false
    job.error = e.message
  })
  p.on('close', (code) => {
    job.running = false
    if (code !== 0) job.error = `exit ${code}`
    claudeCache = null
    piVersion(true)
    invalidatePiModels()
    onDone()
  })
}
