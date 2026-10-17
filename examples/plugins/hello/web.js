// Browser half of the example. Plain ES module, no build step: 'react'
// resolves to the page's own React through its import map.
import { createElement as h, useEffect, useState } from 'react'

/** @param {import('../../../web/src/plugins/types.ts').FarlineApp} app */
export function activate(app) {
  const stats = () => app.fetch('/stats').then((r) => r.json())

  app.registerSettingsPanel(function Stats() {
    const [s, setS] = useState(null)
    useEffect(() => void stats().then(setS), [])
    return h('div', { className: 'group' }, h('div', { className: 'option' }, h('span', { className: 'grow' }, '完成的轮次'), h('span', { className: 'hint' }, s ? String(s.turns) : '…')))
  })

  app.registerSessionAction({
    label: '打个招呼',
    async run(session) {
      const s = await stats()
      app.toast(`${s.greeting}，${session.title}`)
    },
  })

  // Shell commands as a terminal transcript.
  app.registerToolRenderer('Bash', function Terminal({ tool }) {
    return h(
      'pre',
      { className: 'field-box', style: { marginTop: 10, background: '#1d1d1b', color: '#e9e9e6', border: 0 } },
      `$ ${tool.input.command}\n${tool.result ?? ''}`,
    )
  })
}
