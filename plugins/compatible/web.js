// Settings panel: add, edit and remove your own providers.
import { createElement as h, Fragment, useEffect, useState } from 'react'

const EMPTY = { name: '', baseUrl: '', apiKey: '', models: '', contextWindow: '' }

/** @param {import('../../web/src/plugins/types.ts').FarlineApp} app */
export function activate(app) {
  const L = (en, zh) => app.t({ en, 'zh-CN': zh })
  const call = async (path, init) => {
    const res = await app.fetch(path, init)
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || L(`Request failed (${res.status})`, `请求失败 (${res.status})`))
    return data
  }

  function Form({ entry, onDone }) {
    const [f, setF] = useState(entry ? { ...EMPTY, ...entry, apiKey: '', models: entry.models.join(', '), contextWindow: entry.contextWindow ? String(entry.contextWindow) : '' } : EMPTY)
    const [busy, setBusy] = useState(false)
    const [err, setErr] = useState('')
    const [found, setFound] = useState(null)
    const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }))
    const run = async (fn) => {
      setBusy(true)
      setErr('')
      try {
        await fn()
      } catch (e) {
        setErr(e.message)
      } finally {
        setBusy(false)
      }
    }
    const save = () =>
      run(async () => {
        await call(`/providers/${entry?.id ?? 'new'}`, { method: 'PUT', body: JSON.stringify(f) })
        app.refreshCatalog()
        app.toast(L('Saved', '已保存'))
        onDone()
      })
    const test = () =>
      run(async () => {
        const { models } = await call('/test', { method: 'POST', body: JSON.stringify({ id: entry?.id, baseUrl: f.baseUrl, apiKey: f.apiKey }) })
        setFound(models)
        app.toast(models.length ? L(`Connected, ${models.length} models`, `连接正常，${models.length} 个模型`) : L('Connected', '连接正常'))
      })
    const remove = () =>
      run(async () => {
        if (!confirm(L(`Delete "${entry.name}"?`, `确认删除「${entry.name}」？`))) return
        await call(`/providers/${entry.id}`, { method: 'DELETE' })
        app.refreshCatalog()
        onDone()
      })
    const chosen = f.models.split(/[\s,，]+/).filter(Boolean)
    const toggle = (m) => setF((s) => ({ ...s, models: (chosen.includes(m) ? chosen.filter((x) => x !== m) : [...chosen, m]).join(', ') }))
    const field = (label, k, props = {}) =>
      h(Fragment, null, h('div', { className: 'field-label' }, label), h('input', { className: 'path-input', value: f[k], onChange: set(k), autoComplete: 'off', autoCapitalize: 'off', spellCheck: false, ...props }))

    return h(
      'div',
      { className: 'plugin-form' },
      field(L('Name', '名称'), 'name', { placeholder: 'Kimi' }),
      field(L('API address', '接口地址'), 'baseUrl', { placeholder: 'https://example.com/v1', inputMode: 'url' }),
      field('API key', 'apiKey', { type: 'password', placeholder: entry?.keyHint || '' }),
      field(L('Models', '模型'), 'models', { placeholder: 'model-a, model-b' }),
      found &&
        found.length > 0 &&
        h(
          'div',
          { className: 'chips', style: { margin: '-2px 0 12px' } },
          found.map((m) => h('button', { key: m, type: 'button', className: `chip${chosen.includes(m) ? ' on' : ''}`, onClick: () => toggle(m) }, m)),
        ),
      field(L('Context length', '上下文长度'), 'contextWindow', { placeholder: '200000', inputMode: 'numeric' }),
      h('button', { className: 'black-pill wide', disabled: busy, onClick: save }, busy ? '…' : L('Save', '保存')),
      err && h('div', { className: 'err' }, err),
      h(
        'div',
        { className: 'group', style: { marginTop: 12 } },
        h('button', { className: 'option', onClick: test, disabled: busy }, h('span', { className: 'grow' }, L('Test the connection and fetch models', '测试连接，拉取模型列表'))),
        entry && h('button', { className: 'option', onClick: remove, disabled: busy }, h('span', { className: 'grow danger' }, L('Delete', '删除'))),
        h('button', { className: 'option', onClick: onDone }, h('span', { className: 'grow' }, L('Cancel', '取消'))),
      ),
    )
  }

  function Providers() {
    const [list, setList] = useState(null)
    const [editing, setEditing] = useState(null)
    const load = () => call('/providers').then(setList, (e) => app.toast(e.message))
    useEffect(() => void load(), [])
    if (editing) return h(Form, { entry: editing === 'new' ? null : editing, onDone: () => (setEditing(null), load()) })
    if (!list) return h('div', { className: 'empty' }, h(app.ui.Spinner))
    return h(
      Fragment,
      null,
      list.length > 0 &&
        h(
          'div',
          { className: 'group' },
          list.map((e) =>
            h(
              'button',
              { key: e.id, className: 'option tall', onClick: () => setEditing(e) },
              h('span', { className: 'grow' }, e.name, h('span', { className: 'desc' }, `${e.baseUrl.replace(/^https?:\/\//, '')} · ${L(`${e.models.length} ${e.models.length === 1 ? 'model' : 'models'}`, `${e.models.length} 个模型`)}`)),
            ),
          ),
        ),
      h('button', { className: 'row-btn', style: { marginTop: list.length ? 12 : 0 }, onClick: () => setEditing('new') }, h('span', { className: 'grow' }, L('Add a provider', '添加提供商'))),
    )
  }

  app.registerSettingsPanel(Providers)
}
