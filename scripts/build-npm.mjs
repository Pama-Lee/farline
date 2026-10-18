// Builds the npm package into dist-npm/: the server bundled to plain JS
// (Node won't strip types inside node_modules), built-in plugins compiled,
// the web app prebuilt, and a `farline` command. Publish with:
//   npm run build:npm && cd dist-npm && npm publish
import { execSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { build } from 'esbuild'

const root = new URL('..', import.meta.url).pathname
const out = join(root, 'dist-npm')
const server = JSON.parse(readFileSync(join(root, 'server/package.json'), 'utf8'))
const version = process.env.FARLINE_NPM_VERSION || server.version

rmSync(out, { recursive: true, force: true })
mkdirSync(out)

// Web app
execSync('npm run build', { cwd: join(root, 'web'), stdio: 'inherit' })
cpSync(join(root, 'web/dist'), join(out, 'web'), { recursive: true })

// Server: one file, dependencies stay external
await build({
  entryPoints: [join(root, 'server/src/main.ts')],
  outfile: join(out, 'dist/server.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  packages: 'external',
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: 'warning',
})
cpSync(join(root, 'server/pi'), join(out, 'pi'), { recursive: true })

// Built-in plugins: .ts entries become .js
for (const id of readdirSync(join(root, 'plugins'))) {
  const src = join(root, 'plugins', id)
  const dst = join(out, 'plugins', id)
  mkdirSync(dst, { recursive: true })
  const pkg = JSON.parse(readFileSync(join(src, 'package.json'), 'utf8'))
  for (const f of readdirSync(src)) {
    if (f === 'package.json' || f === 'node_modules') continue
    if (f.endsWith('.ts')) {
      await build({ entryPoints: [join(src, f)], outfile: join(dst, f.replace(/\.ts$/, '.js')), bundle: false, platform: 'node', format: 'esm', target: 'node22', logLevel: 'warning' })
    } else cpSync(join(src, f), join(dst, f), { recursive: true })
  }
  if (pkg.farline?.server) pkg.farline.server = pkg.farline.server.replace(/\.ts$/, '.js')
  writeFileSync(join(dst, 'package.json'), JSON.stringify(pkg, null, 2) + '\n')
}

// The command
mkdirSync(join(out, 'bin'))
writeFileSync(
  join(out, 'bin/farline.mjs'),
  `#!/usr/bin/env node
// farline [--port 3077] [--host 127.0.0.1 | --lan] [--data ~/.farline]
// farline set-password <password>
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const args = process.argv.slice(2)
const flag = (name) => {
  const i = args.indexOf(name)
  if (i < 0) return undefined
  const v = args[i + 1]
  args.splice(i, 2)
  return v
}
if (args.includes('--help') || args.includes('-h')) {
  console.log('Usage: farline [--port 3077] [--host 127.0.0.1] [--lan] [--data DIR]\\n       farline set-password <password>')
  process.exit(0)
}
const env = process.env
const port = flag('--port')
const host = flag('--host')
const data = flag('--data')
if (port) env.FARLINE_PORT = port
if (host) env.FARLINE_HOST = host
if (data) env.FARLINE_DATA_DIR = data
const lan = args.indexOf('--lan')
if (lan >= 0) {
  args.splice(lan, 1)
  env.FARLINE_HOST = '0.0.0.0'
}
env.FARLINE_WEB_DIR ??= root + 'web'
env.FARLINE_BUILTIN_PLUGINS ??= root + 'plugins'
// Plain http unless told it sits behind HTTPS.
env.FARLINE_INSECURE_COOKIE ??= env.FARLINE_HTTPS === '1' ? '0' : '1'
process.argv = [process.argv[0], process.argv[1], ...args]
await import('../dist/server.mjs')
`,
  { mode: 0o755 },
)

const pkg = {
  name: 'farline',
  version,
  description: 'A self-hosted workspace for coding agents (Claude Code, pi): use it from any browser on your phone or computer.',
  license: 'MIT',
  author: 'Pama Lee',
  repository: { type: 'git', url: 'https://github.com/Pama-Lee/farline' },
  homepage: 'https://github.com/Pama-Lee/farline',
  keywords: ['coding-agent', 'claude-code', 'pi', 'self-hosted', 'pwa', 'mobile'],
  type: 'module',
  bin: { farline: 'bin/farline.mjs' },
  files: ['bin', 'dist', 'web', 'plugins', 'pi', 'README.md', 'README.zh-CN.md', 'LICENSE'],
  engines: { node: '>=22.18' },
  dependencies: server.dependencies,
}
writeFileSync(join(out, 'package.json'), JSON.stringify(pkg, null, 2) + '\n')
for (const f of ['README.md', 'README.zh-CN.md', 'LICENSE']) if (existsSync(join(root, f))) cpSync(join(root, f), join(out, f))
console.log(`dist-npm ready: farline@${version}`)
