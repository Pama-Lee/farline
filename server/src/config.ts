import { mkdirSync } from 'node:fs'
import { homedir, hostname } from 'node:os'
import { join, resolve, sep } from 'node:path'

const env = process.env

export const config = {
  host: env.FARLINE_HOST ?? '127.0.0.1',
  port: Number(env.FARLINE_PORT ?? 3077),
  dataDir: env.FARLINE_DATA_DIR ?? join(homedir(), '.farline'),
  webDir: env.FARLINE_WEB_DIR ?? new URL('../../web/dist', import.meta.url).pathname,
  defaultCwd: env.FARLINE_DEFAULT_CWD ?? homedir(),
  fsRoot: resolve(env.FARLINE_FS_ROOT ?? '/'),
  claudePath: env.FARLINE_CLAUDE_PATH ?? join(homedir(), '.local/bin/claude'),
  // pi (pi.dev); found on PATH when not set.
  piPath: env.FARLINE_PI_PATH ?? '',
  // Where pi keeps its settings and sessions.
  piAgentDir: env.PI_CODING_AGENT_DIR ?? join(homedir(), '.pi/agent'),
  deviceName: env.FARLINE_DEVICE_NAME ?? hostname(),
  // Plugins shipped with Farline; user plugins live in <dataDir>/plugins.
  builtinPluginsDir: env.FARLINE_BUILTIN_PLUGINS ?? new URL('../../plugins', import.meta.url).pathname,
  // Public address for links in notifications sent outside the browser.
  publicUrl: env.FARLINE_PUBLIC_URL ?? '',
  // Cookies get `Secure` unless explicitly running over plain HTTP locally.
  insecureCookie: env.FARLINE_INSECURE_COOKIE === '1',
  // Web push providers want a contact for the sender; set your own address.
  vapidSubject: env.FARLINE_VAPID_SUBJECT ?? 'mailto:admin@example.com',
  maxLive: Number(env.FARLINE_MAX_LIVE ?? 6),
  idleCloseMs: Number(env.FARLINE_IDLE_CLOSE_MS ?? 30 * 60_000),
}

export function underFsRoot(path: string): boolean {
  return config.fsRoot === sep || path === config.fsRoot || path.startsWith(config.fsRoot + sep)
}

mkdirSync(config.dataDir, { recursive: true, mode: 0o700 })
