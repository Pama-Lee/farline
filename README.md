# Farline

在手机和浏览器里用自己服务器上的 Claude Code。

界面照 Claude App 的 Code 标签页做，后端通过 Claude Agent SDK 在你的服务器上起 Claude Code 会话。会话就是服务器上普通的 Claude Code 会话：终端里 `claude -r` 能接着用，终端里开的会话这里也能看到、能继续。

[English](#english)

## 功能

- 多会话并行，列表按最近活动排序，后台跑完推送通知
- 任意目录起会话，目录选择器可以浏览整台服务器
- 工具调用、思考过程、图片、提问（AskUserQuestion）、权限确认
- 切模型、思考强度、权限模式，中途可改
- 两个提供商，底下都是 Claude Code：
  - **Claude**：用服务器上已登录的 Claude Code 账号
  - **DeepSeek**：走 DeepSeek 的 Anthropic 兼容接口，V4 Pro / Flash，100 万上下文；自动模式的判断模型也换成 DeepSeek
- 手机装成 PWA；电脑上是侧栏 + 对话的布局，回车发送
- 单密码登录

## 运行

需要 Node 22.18 以上，以及在同一个用户下装好并登录过的 Claude Code（`~/.local/bin/claude`）。

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
| `FARLINE_DATA_DIR` | `~/.farline` | 密码哈希、Cookie 密钥、推送密钥、上传文件、偏好 |
| `FARLINE_DEFAULT_CWD` | `~` | 新会话默认目录 |
| `FARLINE_FS_ROOT` | `/` | 目录选择器和文件接口能访问的根 |
| `FARLINE_CLAUDE_PATH` | `~/.local/bin/claude` | Claude Code 可执行文件 |
| `FARLINE_DEVICE_NAME` | 主机名 | 界面上显示的设备名 |
| `FARLINE_VAPID_SUBJECT` | `mailto:admin@example.com` | 推送发送方联系方式，换成你自己的 |
| `FARLINE_MAX_LIVE` | `6` | 同时保持的会话进程数 |
| `FARLINE_IDLE_CLOSE_MS` | `1800000` | 会话空闲多久关掉进程（再发消息会自动恢复） |
| `DEEPSEEK_API_KEY` | | 设了才出现 DeepSeek |
| `DEEPSEEK_BASE_URL` | `https://api.deepseek.com` | |

重启服务会中断正在跑的会话，下次发消息时从记录恢复。

## 结构

- `server/`：Hono + `@anthropic-ai/claude-agent-sdk`，`node src/main.ts` 直接跑（Node 自带类型擦除，不用构建）
- `web/`：React + Vite，`npm run build` 输出到 `web/dist`，由服务端托管
- `shared/types.ts`：前后端共用的类型

---

## English

Use Claude Code on your own server from a phone or a browser.

The UI follows the Code tab of the Claude app. The server starts Claude Code sessions through the Claude Agent SDK, so every session is an ordinary Claude Code session on that machine: `claude -r` picks it up in a terminal, and sessions started in a terminal show up here too.

- Parallel sessions, sorted by latest activity, push notification when one finishes
- Start a session in any directory on the server
- Tool calls, thinking, images, AskUserQuestion, permission prompts
- Switch model, effort and permission mode mid-session
- Two providers, both running Claude Code: your logged-in Claude account, or DeepSeek through its Anthropic-compatible API (V4 Pro / Flash, 1M context, DeepSeek also judges auto mode)
- Installable PWA on phones; sidebar layout on desktop

Requires Node 22.18+ and Claude Code installed and logged in as the same user. Build with the commands above, set a password (12+ characters), and serve it behind HTTPS (see `deploy/`). Configuration is the environment variables in the table above.

Farline can read, write and run anything the user running it can. Treat the password like SSH access.

Not affiliated with Anthropic.

## License

MIT
