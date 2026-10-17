# Farline

自托管的编程 Agent 工作台。装在自己的服务器上，手机和电脑的浏览器都能用，多个会话同时跑。

[English](README.md)

## 功能

- 多会话并行，列表按最近活动排序，跑完或需要你处理时推送通知
- 任意目录起会话，目录选择器可以浏览整台服务器
- 工具调用、思考过程、图片、提问（AskUserQuestion）、权限确认。工具调用可以弹窗查看，也可以在对话里直接展开
- 后台任务：后台命令、子代理、监控单独列出，看实时输出、单独停止，正在跑的命令可以转入后台
- 回退到任意一条消息之前：只回退对话、只回退 Agent 改过的文件，或者两样都回退
- 编辑回复：选中 AI 回复里的文字改写，下一轮读到的就是改过的内容
- 消息里提到的文件和目录可以点开：电脑上在左侧查看，手机上全屏；代码高亮带行号，Markdown 可预览
- 切模型、思考强度、权限模式，中途可改
- 模型可选 Anthropic、DeepSeek（V4 Pro / Flash，100 万上下文，自动模式的判断也由 DeepSeek 完成），或在设置里自己添加任意 Anthropic 兼容接口
- 插件：接新的模型提供商、通知渠道、会话钩子，扩展界面、换皮肤。可以直接从 GitHub 仓库安装，也可以浏览打了 `farline-plugin` 话题的插件。见 [docs/zh-CN/plugins.md](docs/zh-CN/plugins.md)
- 英文和简体中文，按浏览器语言自动选，也可以在设置里指定
- 手机装成 PWA；电脑上是侧栏 + 对话的布局，侧栏可收起、可拖动调宽
- 单密码登录

## 运行

需要 Node 22.18 以上。Agent 运行时用的是 Claude Code CLI，要在同一个用户下装好（`~/.local/bin/claude`）。

```sh
git clone https://github.com/Pama-Lee/farline && cd farline
(cd web && npm ci && npm run build)
cd server && npm ci
node src/main.ts set-password '你的密码'          # 至少 12 位
FARLINE_INSECURE_COOKIE=1 node src/main.ts   # http://127.0.0.1:3077
```

`FARLINE_INSECURE_COOKIE=1` 只在本机 http 调试时用。正式使用要放在 HTTPS 后面（Cookie、Service Worker 和推送都要求 HTTPS），见 `deploy/` 里的 systemd 和 Caddy 示例。SSE 不能被反向代理缓冲。

Farline 能以运行它的用户身份读写文件、执行命令，等同于把这台服务器的 shell 交出去。请设强密码，只在 HTTPS 下使用。

## 配置

| 环境变量 | 默认值 | |
| --- | --- | --- |
| `FARLINE_HOST` | `127.0.0.1` | 监听地址 |
| `FARLINE_PORT` | `3077` | 端口 |
| `FARLINE_DATA_DIR` | `~/.farline` | 密码哈希、Cookie 密钥、推送密钥、上传文件、偏好、插件及其设置 |
| `FARLINE_DEFAULT_CWD` | `~` | 新会话默认目录 |
| `FARLINE_FS_ROOT` | `/` | 目录选择器和文件接口能访问的根 |
| `FARLINE_CLAUDE_PATH` | `~/.local/bin/claude` | Agent 运行时的可执行文件 |
| `FARLINE_DEVICE_NAME` | 主机名 | 界面上显示的设备名 |
| `FARLINE_VAPID_SUBJECT` | `mailto:admin@example.com` | 推送发送方联系方式，换成你自己的 |
| `FARLINE_MAX_LIVE` | `6` | 同时保持的会话进程数 |
| `FARLINE_IDLE_CLOSE_MS` | `1800000` | 会话空闲多久关掉进程（再发消息会自动恢复） |
| `FARLINE_PUBLIC_URL` | | 公网地址，用于企业微信等通知里的链接；不设时取浏览器请求的来源 |
| `FARLINE_LANG` | `en` | 还没人用过界面时通知用的语言；用过之后跟随最近一次使用的语言 |
| `FARLINE_GITHUB_TOKEN` | | 从私有仓库安装插件、提高 GitHub 限流额度时用 |
| `DEEPSEEK_API_KEY` | | DeepSeek 插件的 API key；设置页填过的优先 |
| `DEEPSEEK_BASE_URL` | `https://api.deepseek.com` | |

重启服务会中断正在跑的会话，下次发消息时从记录恢复。

## 多语言

界面文字都在 `shared/i18n/`：`en.ts` 是基准，其他语言各一个文件、键完全相同（`zh-CN.ts`），少一个键类型检查就不通过。服务端按页面传来的语言回话；插件可以给文字提供多种语言（见 [插件文档](docs/zh-CN/plugins.md#多语言)）。

加一种语言：复制 `zh-CN.ts` 翻译，再在 `shared/i18n/index.ts` 里登记（`LOCALES`、`pickLocale`、`isLocale`）。

## 结构

- `server/`：Hono + `@anthropic-ai/claude-agent-sdk`，`node src/main.ts` 直接跑（Node 自带类型擦除，不用构建）
- `web/`：React + Vite，`npm run build` 输出到 `web/dist`，由服务端托管
- `shared/`：前后端共用的类型和翻译
- `plugins/`：内置插件；`examples/plugins/`：示例插件

## 许可

MIT
