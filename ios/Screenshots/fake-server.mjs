// A stand-in Farline server with fixed data, for simulator screenshots.
// node fake-server.mjs [port]
import { createServer } from 'node:http'
import { existsSync, readFileSync } from 'node:fs'
import { extname, join } from 'node:path'

const port = Number(process.argv[2] ?? 4010)
// Optional: a built web/dist to serve too, to compare against the web app.
const webDist = process.argv[3]
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json' }
const now = Date.now()
const min = 60_000

const sessions = [
  { id: 's1', title: '给登录页加上限流', cwd: '/home/pama/farline', updatedAt: now - 2 * min, status: 'requires_action', provider: 'claude' },
  { id: 's2', title: '重构会话列表的排序', cwd: '/home/pama/farline', updatedAt: now - 9 * min, status: 'requires_action', provider: 'claude', tasks: 1 },
  { id: 's3', title: 'DeepSeek 余额显示', cwd: '/home/pama/farline/plugins/deepseek', updatedAt: now - 52 * min, status: 'idle', provider: 'deepseek', providerLabel: 'DeepSeek' },
  { id: 's4', title: '修复 iOS 键盘遮挡输入框', cwd: '/home/pama/farline/web', updatedAt: now - 3 * 60 * min, status: 'idle', provider: 'claude' },
  { id: 's5', title: '写插件文档的英文版', cwd: '/home/pama/farline/docs', updatedAt: now - 26 * 60 * min, status: 'idle', provider: 'pi:anthropic', providerLabel: 'pi' },
  { id: 's6', title: 'Caddy 反向代理配置', cwd: '/etc/caddy', updatedAt: now - 3 * 24 * 60 * min, status: 'idle', provider: 'claude' },
]

const reply = `登录接口现在没有任何限流，我看了 \`server/src/auth.ts\`：

1. \`limited()\` 只按 IP 计数，**10 分钟窗口**里最多 8 次
2. 全局上限是 40 次，超出返回 \`429\`

不过反向代理后面拿到的 IP 都是 \`127.0.0.1\`，所以要先信任 \`X-Forwarded-For\`：

\`\`\`ts
export function clientIp(c: Context): string {
  return c.req.header('cf-connecting-ip')
    ?? c.req.header('x-forwarded-for')?.split(',')[0]?.trim()
    ?? 'local'
}
\`\`\`

接下来我跑一下测试确认没有破坏登录流程。`

const items = [
  { kind: 'user', id: 'u1', text: '登录接口有被暴力破解的风险吗？帮我看看，需要的话加上限流。', ts: now - 6 * min },
  { kind: 'thinking', id: 't1', text: '先看 auth.ts 里登录是怎么处理的。' },
  { kind: 'tool', id: 'r1', name: 'Read', input: { file_path: '/home/pama/farline/server/src/auth.ts' }, status: 'done', result: '…' },
  { kind: 'tool', id: 'g1', name: 'Grep', input: { pattern: 'clientIp' }, status: 'done', result: 'server/src/auth.ts' },
  { kind: 'tool', id: 'e1', name: 'Edit', input: { file_path: '/home/pama/farline/server/src/auth.ts' }, status: 'done', result: 'ok' },
  { kind: 'text', id: 'm1:0', text: reply, ts: now - 3 * min, reactions: [{ emoji: '👍', by: 'user' }] },
  {
    kind: 'tool',
    id: 'b1',
    name: 'Bash',
    input: { command: 'cd server && npm run check && node --test', description: '类型检查并运行测试' },
    status: 'running',
    permission: { reqId: 'p1', canAlways: true, status: 'pending' },
  },
]

// A finished turn, and one waiting on an answer.
const doneItems = [
  ...items.slice(0, 6),
  { kind: 'tool', id: 'b2', name: 'Bash', input: { command: 'cd server && npm run check', description: '类型检查' }, status: 'done', result: 'ok' },
  { kind: 'text', id: 'm2:0', text: '类型检查通过，登录限流已经加上。', ts: now - 1 * min },
]
const askItems = [
  { kind: 'user', id: 'u9', text: '把会话列表改成按最近消息排序。', ts: now - 12 * min },
  {
    kind: 'ask',
    id: 'q1',
    reqId: 'q1',
    status: 'pending',
    questions: [
      {
        question: '置顶的会话也参与排序吗？',
        options: [
          { label: '保持置顶', description: '置顶的永远在最上面' },
          { label: '一起排序', description: '只看最近消息时间' },
        ],
      },
    ],
  },
]
const itemsFor = { s1: items, s2: askItems, s4: doneItems }

const state = (s) => ({
  id: s.id,
  title: s.title,
  cwd: s.cwd,
  status: s.status,
  provider: s.provider,
  model: 'default',
  permissionMode: 'default',
  effort: 'xhigh',
  classifierModel: null,
  live: true,
  tasks: [],
})

const catalog = {
  providers: [
    { id: 'claude', label: 'Anthropic' },
    { id: 'deepseek', label: 'DeepSeek', classifierModels: ['deepseek-v4-flash'] },
    { id: 'pi:openrouter', label: 'pi · OpenRouter' },
  ],
  models: [
    { provider: 'claude', value: 'default', label: 'Opus 5.5', efforts: ['low', 'medium', 'high', 'xhigh', 'max'] },
    { provider: 'claude', value: 'claude-sonnet-5-5', label: 'Sonnet 5.5', efforts: ['low', 'medium', 'high', 'xhigh', 'max'] },
    { provider: 'claude', value: 'claude-haiku-5-5', label: 'Haiku 5.5' },
    { provider: 'deepseek', value: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro' },
    { provider: 'deepseek', value: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash' },
    { provider: 'pi:openrouter', value: 'openai/gpt-5.5', label: 'GPT-5.5' },
  ],
}

const json = (res, body, status = 200) => {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

createServer((req, res) => {
  const url = new URL(req.url, 'http://x')
  const p = url.pathname
  if (p === '/api/me') return json(res, { authed: true, needsSetup: false })
  if (p === '/api/device') return json(res, { name: 'pama-server', defaultCwd: '/home/pama', prefs: { lastCwd: '/home/pama/farline' } })
  if (p === '/api/models') return json(res, catalog)
  if (p === '/api/agents') return json(res, { agents: [{ id: 'claude', name: 'Claude Code', homepage: '', installed: true, installing: false, log: '' }], models: catalog.models.length, onboarded: true })
  if (p === '/api/plugins') return json(res, [])
  if (p === '/api/fs/resolve') return json(res, [])
  if (/^\/api\/sessions\/[^/]+\/mcp$/.test(p)) return json(res, [])
  if (p === '/api/sessions') return json(res, { sessions, nextOffset: null })
  let m = p.match(/^\/api\/sessions\/([^/]+)$/)
  if (m) {
    const s = sessions.find((x) => x.id === m[1])
    if (!s) return json(res, { error: 'not found' }, 404)
    return json(res, { state: state(s), items: itemsFor[s.id] ?? [], seq: 1, hasEarlier: false })
  }
  m = p.match(/^\/api\/sessions\/([^/]+)\/events$/)
  if (m) {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
    const ping = setInterval(() => res.write('event: ping\ndata: \n\n'), 15_000)
    req.on('close', () => clearInterval(ping))
    return
  }
  if (webDist && !p.startsWith('/api/')) {
    const file = join(webDist, p)
    const path = p !== '/' && existsSync(file) ? file : join(webDist, 'index.html')
    res.writeHead(200, { 'content-type': types[extname(path)] ?? 'application/octet-stream' })
    return res.end(readFileSync(path))
  }
  json(res, { error: 'not found' }, 404)
}).listen(port, '127.0.0.1', () => console.log(`fake farline on http://127.0.0.1:${port}`))
