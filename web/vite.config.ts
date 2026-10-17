import { createRequire } from 'node:module'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

// Modules plugin code may import bare; index.html maps each to a stub under
// /plugin-runtime/ that re-exports the page's own instance.
const require = createRequire(import.meta.url)
const SHARED = ['react', 'react-dom', 'react/jsx-runtime']
const stubName = (name: string) => `${name.replace(/\//g, '-')}.js`

function stub(name: string) {
  const names = Object.keys(require(name)).filter((k) => k !== 'default' && /^[A-Za-z_$][\w$]*$/.test(k))
  return `const m = window.__FARLINE__.modules[${JSON.stringify(name)}]\nexport default m\nexport const { ${names.join(', ')} } = m\n`
}

function pluginRuntime(): Plugin {
  return {
    name: 'farline-plugin-runtime',
    generateBundle() {
      for (const name of SHARED) this.emitFile({ type: 'asset', fileName: `plugin-runtime/${stubName(name)}`, source: stub(name) })
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const name = SHARED.find((n) => req.url?.split('?')[0] === `/plugin-runtime/${stubName(n)}`)
        if (!name) return next()
        res.setHeader('content-type', 'text/javascript')
        res.end(stub(name))
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), pluginRuntime()],
  server: {
    host: '127.0.0.1',
    port: 5178,
    fs: { allow: ['..'] },
    proxy: { '/api': { target: 'http://127.0.0.1:3078', changeOrigin: false } },
  },
  build: { target: 'safari16', chunkSizeWarningLimit: 900 },
})
