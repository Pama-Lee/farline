# 插件

插件能给 Farline 加四类东西：

- **模型提供商**：任何 Anthropic 兼容接口，接进来后出现在模型选择里
- **通知渠道**：会话完成或需要你处理时，除浏览器推送外再发到别处
- **会话钩子**：会话创建、发消息、一轮结束、等待确认时执行自己的逻辑
- **界面扩展**：工具结果的显示、会话菜单里的操作、插件自己的设置面板
- **皮肤**：换掉整个界面的样子，在「设置 → 外观」里切换

DeepSeek、兼容接口、企业微信这三个内置功能本身就是插件，代码在 [`plugins/`](../plugins)，可以直接当样板看。[`examples/plugins/hello`](../examples/plugins/hello) 用到了钩子、HTTP 接口和全部三种界面扩展，不用构建，复制过去就能跑。

## 信任

插件代码不做隔离。服务端代码跑在 Farline 进程里，权限和运行 Farline 的用户一样；前端代码跑在页面里，能调所有接口。只装你信得过的插件。

## 安装

插件是一个目录，`package.json` 里有 `farline` 字段。Farline 启动时从三处找：

| 位置 | 说明 |
| --- | --- |
| 仓库的 `plugins/` | 内置插件 |
| `~/.farline/plugins/<目录>` | 本地插件 |
| `~/.farline/plugins/node_modules/` | 在 `~/.farline/plugins` 里 `npm i` 装的包 |

`~/.farline` 指数据目录（`FARLINE_DATA_DIR`）。本地插件和内置插件 id 相同时，用本地的。

装好后重启 Farline，到「设置 → 插件」里开关。启停不用重启：停用时插件注册的东西全部撤掉，再启用会重新加载服务端代码，所以改了代码停用再启用就能生效。前端代码改了要刷新页面。

## 清单

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

| 字段 | |
| --- | --- |
| `id` | 小写字母、数字、连字符，全局唯一 |
| `name` | 设置里显示的名字 |
| `apiVersion` | 插件接口版本，目前是 `1`；不匹配的插件不会启用 |
| `server` | 服务端入口，可省略 |
| `web` | 前端入口，可省略 |
| `styles` | 加到页面上的样式表，可省略 |
| `skin` | 为 `true` 时是皮肤，见下文 |
| `enabledByDefault` | 第一次发现时是否启用，默认 `true`；皮肤默认 `false` |

服务端入口可以是 `.js`，也可以是 `.ts`（Node 自带类型擦除，只支持可擦除的语法）。装在 `node_modules` 里的包只能用 `.js`。

## 服务端

入口默认导出一个对象：

```ts
export default {
  settings: [{ key: 'apiKey', label: 'API key', type: 'secret', env: 'EXAMPLE_API_KEY' }],
  links: [{ label: '创建 API key', url: 'https://example.com/keys' }],
  async validateSettings(values) {
    if (values.apiKey && !(await check(values.apiKey))) throw new Error('API key 无效')
  },
  async status(ctx) {
    return { summary: '¥12.00', rows: [{ label: '余额', value: '¥12.00' }] }
  },
  activate(ctx) {
    // 在这里注册提供商、通知渠道、钩子和路由
  },
  deactivate() {},
}
```

所有已安装插件的服务端入口都会在启动时被导入（为了读设置项），只有启用的才会调用 `activate`。所以副作用都放进 `activate`，不要写在模块顶层。

完整类型见 [`server/src/plugins/types.ts`](../server/src/plugins/types.ts)。

### 设置项

`settings` 里的每一项会在插件的设置页生成一个输入框，值存在数据目录的 `plugins.json` 里。

| `type` | 输入方式 |
| --- | --- |
| `text` | 文本 |
| `secret` | 密码框；接口只回传 `sk-…324c` 这样的提示，不回传原值 |
| `number` | 数字 |
| `boolean` | 开关 |
| `select` | 单选，配 `options: [{ value, label }]` |

`env` 指定一个环境变量作回退：设置里没填时用它。声明过的环境变量不会传给 Agent 进程。`default` 是两者都没有时的默认值。

保存前会调用 `validateSettings(values)`，拿到的是保存后的完整取值（含回退）；抛出带中文说明的 `Error` 即拒绝保存，说明会显示给用户。`status(ctx)` 返回的 `summary` 显示在设置首页这个插件的那一行，`rows` 显示在插件详情页。

### 上下文

`activate(ctx)` 拿到的 `ctx`：

| | |
| --- | --- |
| `ctx.id` | 插件 id |
| `ctx.dataDir` | 插件私有目录，第一次访问时创建 |
| `ctx.log(...)` | 带插件前缀的日志 |
| `ctx.settings.get()` | 当前设置（保存值 → 环境变量 → 默认值） |
| `ctx.settings.onChange(fn)` | 设置保存后回调 |
| `ctx.providers.register(def)` | 注册模型提供商 |
| `ctx.notifications.register(def)` | 注册通知渠道 |
| `ctx.hooks.on(event, fn)` | 订阅会话事件 |
| `ctx.http` | 一个 [Hono](https://hono.dev) 实例，路由挂在 `/api/ext/<id>/` 下，需要登录 |
| `ctx.sessions.get(id)` | 读会话状态 |
| `ctx.sessions.send(id, text)` | 以用户身份往会话里发一条消息 |
| `ctx.helpers.anthropicCompatible(opts)` | 生成指向 Anthropic 兼容接口的环境变量 |

`register` / `on` 都返回 `{ dispose() }`，停用插件时会自动调用，一般不用自己管。

### 模型提供商

```ts
ctx.providers.register({
  id: 'example',
  label: 'Example',
  available: () => !!ctx.settings.get().apiKey,
  models: () => [
    { value: 'example-pro', label: 'Example Pro', desc: '更强' },
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

- `available()` 为假时，这个提供商不出现在模型选择里，也不能新建会话。
- `classifierModels` 给了两个以上时，模型选择里会多出「自动模式判断」，让用户选自动模式的判断用哪个模型；第一个是默认值。
- `defaultPermissionMode` 是切到这个提供商时的默认权限模式。
- `env()` 在会话进程启动时调用。环境变量只在进程启动时生效，所以保存设置、启停插件后，用到这个提供商的会话会在空闲时重启进程，下一条消息自动接上。
- `contextWindow` 要给：不认识的模型，Agent 按 20 万上下文计算，长会话会反复压缩。

### 通知渠道

```ts
ctx.notifications.register({
  id: 'example',
  label: 'Example',
  async send(n) {
    // n.kind: 'done' | 'attention' | 'test'
    // n.url 在知道公网地址时是完整链接，否则是 /s/<id> 这样的路径
    await fetch(webhook, { method: 'POST', body: JSON.stringify({ text: `${n.title}\n${n.body}\n${n.url}` }) })
  },
})
```

只在没人打开这个会话时发送，和浏览器推送一样。注册了渠道的插件，详情页会多出「发送测试通知」，测试时 `send` 抛出的错误会显示给用户。

公网地址取 `FARLINE_PUBLIC_URL`；没设时用浏览器最近一次请求带的 `Origin`。

### 钩子

```ts
ctx.hooks.on('turn.completed', ({ session, text, error }) => {})
```

| 事件 | 参数 |
| --- | --- |
| `session.created` | `{ session }` |
| `message.sent` | `{ session, text }` |
| `turn.completed` | `{ session, text, error }`，`text` 是最后一条回复 |
| `attention` | `{ session, kind: 'permission' \| 'question', title }` |

`session` 是 `{ id, title, cwd, provider, model }`。钩子异步执行，不会拖慢会话，出错只记日志。

### HTTP 接口

```ts
ctx.http.get('/stats', (c) => c.json({ turns }))
ctx.http.post('/run', async (c) => c.json(await doSomething(await c.req.json())))
```

浏览器里用 `app.fetch('/stats')` 调。和其他接口一样需要登录，非 GET 请求要带 `x-farline: 1` 头（`app.fetch` 会自动带上）。

## 前端

入口是一个 ES 模块，导出 `activate(app)`：

```js
import { createElement as h, useState } from 'react'

export function activate(app) {
  app.registerToolRenderer('Bash', ({ tool }) => h('pre', null, tool.input.command))
  app.registerSessionAction({ label: '导出', run: (session) => app.fetch(`/export/${session.id}`) })
  app.registerSettingsPanel(() => h('div', null, '…'))
  return () => {
    // 可选：停用时的清理
  }
}
```

模块里可以直接 `import` 这几个包，拿到的是页面自己那份，不要打包进插件：

- `react`
- `react/jsx-runtime`
- `react-dom`

写 JSX 的话用任意打包工具输出 ES 模块，把上面三个标成 external，例如：

```sh
npx esbuild src/web.tsx --bundle --format=esm --jsx=automatic --external:react --external:react-dom --external:react/jsx-runtime --outfile=web.js
```

打包出的多个文件放在插件目录里，相对路径导入可以正常用。

完整类型见 [`web/src/plugins/types.ts`](../web/src/plugins/types.ts)。

### app

| | |
| --- | --- |
| `app.id` | 插件 id |
| `app.ui.Sheet` / `Spinner` / `Markdown` | 页面自带的组件，用它们能和其他界面保持一致 |
| `app.toast(text)` | 底部提示 |
| `app.navigate(path)` | 跳转，例如 `/s/<id>` |
| `app.fetch(path, init)` | 请求插件自己的 `/api/ext/<id><path>` |
| `app.registerToolRenderer(match, Component)` | 替换匹配工具的详情显示。`match` 可以是工具名、工具名数组或函数；组件拿到 `{ tool, sessionId }` |
| `app.registerSessionAction({ label, icon, run })` | 在会话的「…」菜单里加一行，`run(session)` 抛出的错误会提示给用户 |
| `app.registerSettingsPanel(Component)` | 显示在插件设置页，自动生成的设置项下面 |

每个 `register*` 返回一个撤销函数。插件组件出错时只影响它自己：工具显示退回默认样式，其他位置显示一行错误。

样式可以直接用页面的类名：`group`、`option`、`row-btn`、`field-label`、`field-box`、`hint`。

## 皮肤

皮肤是只带样式表的插件：

```json
{
  "name": "farline-skin-paper",
  "version": "1.0.0",
  "farline": { "id": "paper", "name": "纸", "apiVersion": 1, "skin": true, "styles": "./skin.css" }
}
```

界面的样式分两层：底层 `web/src/styles.css` 管布局和一套基础样子，Farline 默认的样子是叠在上面的 `web/src/theme.css`。启用皮肤时页面根元素带上 `data-skin="<id>"`，默认那一层整个失效，皮肤的样式表接在底层后面加载。所以皮肤是在底层上改，不用去抵消默认主题；颜色、圆角这类先改底层 `:root` 里的变量（`--bg`、`--surface`、`--text`、`--line` 等），不够再写具体规则。

同时只能启用一个皮肤，启用一个会自动停用别的。皮肤也可以同时带 `server` / `web` 入口。

有些地方的结构由皮肤用 CSS 变量选择，写在 `:root` 里：

| 变量 | 取值 | |
| --- | --- | --- |
| `--fl-model-picker` | `menu` | 模型选择改成模型按钮旁的弹出菜单（思考强度、模型分两级），默认是底部弹层 |

弹出菜单的样式类是 `.popover`、`.menu`、`.menu-row`、`.menu-sep`、`.menu-head`、`.menu-tabs`。

## 内置插件

| id | 名称 | 默认 | |
| --- | --- | --- | --- |
| `deepseek` | DeepSeek | 启用 | V4 Pro / V4.1 Flash，100 万上下文，显示余额；回退 `DEEPSEEK_API_KEY` |
| `compatible` | 兼容接口 | 停用 | 填地址、key 和模型名，接任意 Anthropic 兼容接口 |
| `wecom` | 企业微信 | 停用 | 通知发到企业微信群机器人 |
