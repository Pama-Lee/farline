# Plugins

[简体中文](zh-CN/plugins.md)

A plugin can add:

- **Model providers**: any Anthropic-compatible API, which then shows up in the model picker
- **Notification channels**: somewhere else to send "finished" and "needs you" alerts, besides browser push
- **Session hooks**: your own code when a session is created, a message is sent, a turn ends, or the agent is waiting on you
- **UI extensions**: how a tool result is shown, actions in a session's menu, the plugin's own settings panel
- **Skins**: a different look for the whole app, switched in Settings → Appearance

The DeepSeek provider, custom providers and WeCom notifications are themselves plugins; their code in [`plugins/`](../plugins) makes a good template. [`examples/plugins/hello`](../examples/plugins/hello) uses a hook, an HTTP route and all three UI extensions, and needs no build step: copy it and it runs.

## Trust

Plugin code is not sandboxed. Server code runs inside the Farline process with the same rights as the user running Farline; browser code runs in the page and can call every endpoint. Install only plugins you trust.

## Installing

A plugin is a folder whose `package.json` has a `farline` field. Farline looks in three places at startup:

| Where | |
| --- | --- |
| `plugins/` in this repository | Built-in plugins |
| `~/.farline/plugins/<folder>` | Local plugins |
| `~/.farline/plugins/node_modules/` | Packages installed with `npm i` inside `~/.farline/plugins` |

`~/.farline` is the data folder (`FARLINE_DATA_DIR`). A local plugin with the same id as a built-in one replaces it.

### From GitHub

Settings → Plugins → Install from GitHub takes a repository; no restart needed. Any of these work:

```
owner/repo
owner/repo#v1.2.0                      a branch, tag or commit
owner/repo/path/to/plugin              a folder inside the repository
https://github.com/owner/repo/tree/main/path/to/plugin
```

Given only a repository, Farline installs the root if it is a plugin; otherwise it looks inside, installs the plugin if there is exactly one, and lists them for you to pick from if there are several.

It downloads the source of that commit, unpacks it to `~/.farline/plugins/<id>`, and if there are `dependencies` runs `npm install --omit=dev --ignore-scripts` once. Install scripts do not run, so ship built code. Where it came from is kept in `~/.farline/plugins/.remote.json`; the plugin's page can check for updates (the newest commit on the same branch or tag) and uninstall it.

A plugin from GitHub may replace a built-in plugin with the same id, which comes back when it is uninstalled. An id clash with a local or npm plugin is refused. Private repositories need `FARLINE_GITHUB_TOKEN`.

### Discovering plugins

Settings → Plugins → Discover plugins lists GitHub repositories with the topic `farline-plugin`; Install runs the steps above. To list your plugin there:

1. Put the plugin at the root of the repository (the root `package.json` has the `farline` field)
2. Add the topic `farline-plugin` in the repository's About box

Everything in the list comes from that root `package.json`:

```json
{
  "name": "farline-plugin-todo",
  "version": "0.3.1",
  "description": "Sync todos from sessions to Things",
  "author": "Alice <alice@example.com>",
  "engines": { "farline": ">=1.0.0" },
  "farline": {
    "id": "todo",
    "name": { "en": "Todo sync", "zh-CN": "待办同步" },
    "description": { "en": "Sync todos from sessions to Things", "zh-CN": "把会话里的待办同步到 Things" },
    "apiVersion": 1,
    "server": "./server.js"
  }
}
```

| Field | Shown as |
| --- | --- |
| `farline.name` | Name |
| `farline.description`, else `description`, else the repository description | One-line description |
| `author` (a string or `{ "name" }`), else the repository owner | Author |
| `version` | Version |
| `engines.farline` | Farline versions it supports, as a semver range (`>=1.0.0`, `^1.2`, `1.x`, `>=1 <3`, `a \|\| b`) |
| `farline.apiVersion` | Plugin API version, 1 by default |

Plugins whose `engines.farline` or `apiVersion` don't match are still listed, with the version they need, but can't be installed; installed by hand, they won't start. The list is cached on the server for 10 minutes. For testing, `FARLINE_PLUGIN_TOPIC` switches to another topic.

After installing a local or npm plugin, restart Farline and turn it on in Settings → Plugins. Turning plugins on and off needs no restart: turning one off undoes everything it registered, and turning it back on loads its server code again, so off and on picks up code changes. Browser code changes need a page reload.

## Manifest

```json
{
  "name": "farline-plugin-hello",
  "version": "0.1.0",
  "type": "module",
  "farline": {
    "id": "hello",
    "name": "Hello",
    "apiVersion": 1,
    "server": "./server.js",
    "web": "./web.js",
    "enabledByDefault": true
  }
}
```

| Field | |
| --- | --- |
| `id` | Lowercase letters, digits and hyphens; unique |
| `name` | Name shown in Settings: a string, or one per language |
| `apiVersion` | Plugin API version, currently `1`; plugins that don't match are not turned on |
| `server` | Server entry, optional |
| `web` | Browser entry, optional |
| `styles` | A stylesheet added to the page, optional |
| `skin` | `true` makes it a skin, see below |
| `enabledByDefault` | Whether it starts on when first found; `true` by default, `false` for skins |

The server entry can be `.js` or `.ts` (Node strips types itself, so only erasable syntax works). Packages under `node_modules` must use `.js`.

## Languages

Anything a plugin shows to people can be a plain string or one string per language:

```ts
const L = (en: string, zh: string) => ({ en, 'zh-CN': zh })

settings: [{ key: 'webhook', label: L('Webhook URL', 'Webhook 地址'), type: 'secret' }]
```

Farline picks the page's language, then English, then whatever there is. This works for the manifest `name` and `description`, setting labels, placeholders and options, `links`, what `status()` returns, provider and model labels and descriptions, and channel labels.

For text you build or errors you throw, `ctx.t(text)` picks the string for the current request, and `ctx.locale()` returns its language (`'en'`, `'zh-CN'`). `validateSettings` gets the same pair as its second argument. In the browser it's `app.t(text)` and `app.locale`; the page re-renders when the language changes, so call them while rendering.

## Server

The entry's default export:

```ts
const L = (en: string, zh: string) => ({ en, 'zh-CN': zh })

export default {
  settings: [{ key: 'apiKey', label: 'API key', type: 'secret', env: 'EXAMPLE_API_KEY' }],
  links: [{ label: L('Create an API key', '创建 API key'), url: 'https://example.com/keys' }],
  async validateSettings(values, i18n) {
    if (values.apiKey && !(await check(values.apiKey))) throw new Error(i18n.t(L('Invalid API key', 'API key 无效')))
  },
  async status(ctx) {
    return { summary: '$12.00', rows: [{ label: L('Balance', '余额'), value: '$12.00' }] }
  },
  activate(ctx) {
    // register providers, channels, hooks and routes here
  },
  deactivate() {},
}
```

The server entry of every installed plugin is imported at startup (to read its settings), but only enabled ones get `activate`. Keep side effects inside `activate`, not at module top level.

The full types are in [`server/src/plugins/types.ts`](../server/src/plugins/types.ts).

### Settings

Each item in `settings` becomes a field on the plugin's settings page. Values are stored in `plugins.json` in the data folder.

| `type` | Input |
| --- | --- |
| `text` | Text |
| `secret` | Password field; the API only ever returns a hint like `sk-…324c`, never the value |
| `number` | Number |
| `boolean` | Switch |
| `select` | One of `options: [{ value, label }]` |

`env` names an environment variable to fall back on when nothing is saved. Declared variables are kept out of agent processes. `default` applies when there is neither.

`validateSettings(values, i18n)` runs before saving, with the complete values as they would be after saving (fallbacks included). Throw an `Error` to refuse; its message is shown to the user. `status(ctx)` returns a `summary` for the plugin's row on the main settings page and `rows` for its own page.

### Context

`activate(ctx)` receives:

| | |
| --- | --- |
| `ctx.id` | Plugin id |
| `ctx.dataDir` | The plugin's private folder, created on first use |
| `ctx.log(...)` | Log lines prefixed with the plugin id |
| `ctx.locale()` / `ctx.t(text)` | The current language, and the string for it (see [Languages](#languages)) |
| `ctx.settings.get()` | Current settings (saved → environment → default) |
| `ctx.settings.onChange(fn)` | Called after settings are saved |
| `ctx.providers.register(def)` | Register a model provider |
| `ctx.notifications.register(def)` | Register a notification channel |
| `ctx.hooks.on(event, fn)` | Subscribe to session events |
| `ctx.http` | A [Hono](https://hono.dev) app, mounted at `/api/ext/<id>/` behind sign-in |
| `ctx.sessions.get(id)` | Read a session's state |
| `ctx.sessions.send(id, text)` | Send a message to a session as the user |
| `ctx.sessions.react(id, messageId, emoji)` | Put the agent's reaction on a message |
| `ctx.agentTools.register(def)` | Give the agent a tool (see below) |
| `ctx.helpers.anthropicCompatible(opts)` | Environment that points the agent at an Anthropic-compatible API |

`register` and `on` return `{ dispose() }`, which is called for you when the plugin is turned off.

### Model providers

```ts
ctx.providers.register({
  id: 'example',
  label: 'Example',
  available: () => !!ctx.settings.get().apiKey,
  models: () => [
    { value: 'example-pro', label: 'Example Pro', desc: L('Stronger', '更强') },
    { value: 'example-mini', label: 'Example Mini', more: true },
  ],
  classifierModels: ['example-mini', 'example-pro'],
  defaultPermissionMode: 'bypassPermissions',
  env: ({ model, classifierModel }) =>
    ctx.helpers.anthropicCompatible({
      baseUrl: 'https://api.example.com/anthropic',
      token: String(ctx.settings.get().apiKey),
      model,
      smallModel: 'example-mini',
      classifierModel,
      contextWindow: 1_000_000,
    }),
})
```

- While `available()` is false the provider is left out of the model picker and can't start sessions.
- With two or more `classifierModels`, the model picker gains an "Auto mode check" choice for which model judges auto mode; the first is the default.
- `defaultPermissionMode` is the permission mode a session switches to with this provider.
- `env()` runs when a session's process starts. Environment only takes effect at process start, so after settings are saved or the plugin is turned on or off, sessions using the provider restart their process when idle and carry on with the next message.
- Give `contextWindow`: for models it doesn't know, the agent assumes 200k and long sessions keep compacting.
- `pi()` shares the provider with pi sessions: return `{ baseUrl, apiKey, models }` for its Anthropic-compatible endpoint (base URL without `/v1`). Leave it out to keep the provider Claude Code only.

### Agent tools

Give the agent a tool. It works in Claude Code sessions (as `mcp__farline__<name>`) and pi sessions (as `farline_<name>`); the tool runs in Farline either way.

```ts
ctx.agentTools.register({
  name: 'react',
  description: "Put an emoji reaction on the user's latest message.",
  params: { emoji: { type: 'string', description: 'One emoji' } },
  hidden: true,                         // not shown as a tool call in the conversation
  instructions: 'You can react to …',   // added to the agent's system prompt
  async run(args, call) {
    await ctx.sessions.react(call.session.id, call.lastUserMessageId!, String(args.emoji))
    return 'Reacted.'                   // goes back to the agent
  },
})
```

`params` maps argument names to `{ type: 'string' | 'number' | 'boolean', description?, optional?, enum? }`. Tools are set when a session's process starts.

### Notification channels

```ts
ctx.notifications.register({
  id: 'example',
  label: 'Example',
  async send(n) {
    // n.kind: 'done' | 'attention' | 'test'
    // n.url is a full link when the public address is known, else a path like /s/<id>
    await fetch(webhook, { method: 'POST', body: JSON.stringify({ text: `${n.title}\n${n.body}\n${n.url}` }) })
  },
})
```

Like browser push, notifications go out only when nobody has the session open. A plugin with a channel gets "Send test notification" on its page; errors thrown by `send` during a test are shown to the user. Notification text is in the language last used in the app.

The public address is `FARLINE_PUBLIC_URL`, or else the `Origin` of the browser's latest request.

### Hooks

```ts
ctx.hooks.on('turn.completed', ({ session, text, error }) => {})
```

| Event | Payload |
| --- | --- |
| `session.created` | `{ session }` |
| `message.sent` | `{ session, text }` |
| `turn.completed` | `{ session, text, error }`; `text` is the last reply |
| `attention` | `{ session, kind: 'permission' \| 'question', title }` |

`session` is `{ id, title, cwd, provider, model }`. Hooks run asynchronously and never hold a session up; errors are only logged.

### HTTP routes

```ts
ctx.http.get('/stats', (c) => c.json({ turns }))
ctx.http.post('/run', async (c) => c.json(await doSomething(await c.req.json())))
```

Call them from the browser with `app.fetch('/stats')`. Like every endpoint they need sign-in, and non-GET requests need the header `x-farline: 1` (`app.fetch` adds it, along with the page's language).

## Browser

The entry is an ES module that exports `activate(app)`:

```js
import { createElement as h } from 'react'

export function activate(app) {
  app.registerToolRenderer('Bash', ({ tool }) => h('pre', null, tool.input.command))
  app.registerSessionAction({ label: { en: 'Export', 'zh-CN': '导出' }, run: (session) => app.fetch(`/export/${session.id}`) })
  app.registerSettingsPanel(() => h('div', null, app.t({ en: 'Hello', 'zh-CN': '你好' })))
  return () => {
    // optional: clean up when turned off
  }
}
```

These packages can be imported directly and resolve to the page's own copy; don't bundle them:

- `react`
- `react/jsx-runtime`
- `react-dom`

For JSX, build an ES module with any bundler and mark those three external, for example:

```sh
npx esbuild src/web.tsx --bundle --format=esm --jsx=automatic --external:react --external:react-dom --external:react/jsx-runtime --outfile=web.js
```

Split output files can sit in the plugin folder; relative imports work.

The full types are in [`web/src/plugins/types.ts`](../web/src/plugins/types.ts).

### app

| | |
| --- | --- |
| `app.id` | Plugin id |
| `app.locale` / `app.t(text)` | The page's language, and the string for it (see [Languages](#languages)) |
| `app.ui.Sheet` / `Spinner` / `Markdown` | The page's own components, to match the rest of the app |
| `app.toast(text)` | A short message at the bottom |
| `app.navigate(path)` | Go to a page, e.g. `/s/<id>` |
| `app.fetch(path, init)` | Request the plugin's own `/api/ext/<id><path>` |
| `app.registerToolRenderer(match, Component)` | Replace how matching tool calls are shown. `match` is a tool name, a list of names, or a function; the component gets `{ tool, sessionId }` |
| `app.registerSessionAction({ label, icon, run })` | A row in a session's "…" menu; errors thrown by `run(session)` are shown to the user |
| `app.registerSettingsPanel(Component)` | Shown on the plugin's settings page, below the generated fields |
| `app.refreshCatalog()` | Reload providers and models after the plugin changed them |

Each `register*` returns a function that undoes it. A plugin component that throws only breaks itself: tool views fall back to the default, other places show a one-line error.

The page's class names are fair game for styling: `group`, `option`, `row-btn`, `field-label`, `field-box`, `hint`.

## Skins

A skin is a plugin that brings a stylesheet:

```json
{
  "name": "farline-skin-paper",
  "version": "1.0.0",
  "farline": { "id": "paper", "name": { "en": "Paper", "zh-CN": "纸" }, "apiVersion": 1, "skin": true, "styles": "./skin.css" }
}
```

Styles come in two layers: `web/src/styles.css` handles layout and a plain base look, and Farline's default look is `web/src/theme.css` on top. With a skin on, the root element gets `data-skin="<id>"`, the default layer switches off entirely, and the skin's stylesheet loads after the base. So a skin builds on the base without undoing the default theme: start with the variables in the base `:root` (`--bg`, `--surface`, `--text`, `--line`, …), then write specific rules where needed.

One skin is on at a time; turning one on turns the others off. A skin can also have `server` and `web` entries.

Some layout choices are made by the skin through CSS variables on `:root`:

| Variable | Value | |
| --- | --- | --- |
| `--fl-model-picker` | `menu` | The model picker becomes a menu next to the model button (effort and model one level apart) instead of a bottom sheet |

The menu's classes are `.popover`, `.menu`, `.menu-row`, `.menu-sep`, `.menu-head`, `.menu-search`, `.menu-group`, `.menu-label`.

## Built-in plugins

| id | Name | Default | |
| --- | --- | --- | --- |
| `deepseek` | DeepSeek | On | V4 Pro / V4.1 Flash, 1M context, shows the balance; falls back to `DEEPSEEK_API_KEY` |
| `compatible` | Custom providers | On | Add as many Anthropic-compatible APIs as you like in Settings (relays, proxies, other vendors), with a connection test and model listing |
| `wecom` | WeCom | Off | Sends notifications to a WeCom group robot |
| `reactions` | Reactions | On | The agent can react to your messages with an emoji (`react` tool); you can react to any message |
