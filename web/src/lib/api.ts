import type {
  CreateBody,
  DeepSeekStatus,
  EffortLevel,
  DirListing,
  McpServer,
  ModelOption,
  PermissionMode,
  Provider,
  SendBody,
  SessionSnapshot,
  SessionState,
  SessionSummary,
  Upload,
} from '../../../shared/types.ts'

export const MODELS_CHANGED = 'farline:models'

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

let onUnauthorized: () => void = () => {}
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, headers: { 'x-farline': '1' }, credentials: 'same-origin' }
  if (body instanceof FormData) init.body = body
  else if (body !== undefined) {
    init.body = JSON.stringify(body)
    ;(init.headers as Record<string, string>)['content-type'] = 'application/json'
  }
  const res = await fetch(`/api${path}`, init)
  if (res.status === 401 && path !== '/login') onUnauthorized()
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new ApiError(res.status, data.error ?? `请求失败 (${res.status})`)
  return data as T
}

export interface DeviceInfo {
  name: string
  defaultCwd: string
  prefs: { lastCwd?: string; provider?: Provider; model?: string; permissionMode?: PermissionMode; effort?: EffortLevel; classifierModel?: string }
}

export const api = {
  me: () => req<{ authed: boolean }>('GET', '/me'),
  login: (password: string) => req<{ ok: true }>('POST', '/login', { password }),
  logout: () => req<{ ok: true }>('POST', '/logout'),
  device: () => req<DeviceInfo>('GET', '/device'),
  models: () => req<ModelOption[]>('GET', '/models'),
  deepseek: () => req<DeepSeekStatus>('GET', '/deepseek'),
  setDeepseekKey: (key: string) => req<DeepSeekStatus>('PUT', '/deepseek', { key }),
  clearDeepseekKey: () => req<DeepSeekStatus>('DELETE', '/deepseek'),
  sessions: (offset = 0, limit = 40) => req<{ sessions: SessionSummary[]; nextOffset: number | null }>('GET', `/sessions?offset=${offset}&limit=${limit}`),
  session: (id: string, all = false) => req<SessionSnapshot>('GET', `/sessions/${id}${all ? '?all=1' : ''}`),
  create: (body: CreateBody) => req<{ id: string }>('POST', '/sessions', body),
  send: (id: string, body: SendBody) => req<{ ok: true }>('POST', `/sessions/${id}/messages`, body),
  interrupt: (id: string) => req<{ ok: true }>('POST', `/sessions/${id}/interrupt`),
  decide: (id: string, reqId: string, decision: 'allow' | 'always' | 'deny') => req<{ ok: boolean }>('POST', `/sessions/${id}/permission`, { reqId, decision }),
  answer: (id: string, reqId: string, answers: Record<string, string> | null) => req<{ ok: boolean }>('POST', `/sessions/${id}/answer`, { reqId, answers }),
  update: (id: string, patch: { permissionMode?: PermissionMode; model?: string; effort?: EffortLevel; provider?: Provider; classifierModel?: string; title?: string; hidden?: boolean }) =>
    req<SessionState>('PATCH', `/sessions/${id}`, patch),
  mcp: (id: string) => req<McpServer[]>('GET', `/sessions/${id}/mcp`),
  dirs: (path?: string, hidden = false) => req<DirListing>('GET', `/fs?${new URLSearchParams({ ...(path ? { path } : {}), ...(hidden ? { hidden: '1' } : {}) })}`),
  upload: (file: Blob, name: string) => {
    const fd = new FormData()
    fd.append('file', file, name)
    return req<Upload>('POST', '/uploads', fd)
  },
  pushKey: () => req<{ key: string }>('GET', '/push/key'),
  pushSubscribe: (sub: PushSubscriptionJSON) => req<{ ok: true }>('POST', '/push/subscribe', sub),
  pushUnsubscribe: (endpoint: string) => req<{ ok: true }>('POST', '/push/unsubscribe', { endpoint }),
  pushTest: () => req<{ ok: true }>('POST', '/push/test'),
}
