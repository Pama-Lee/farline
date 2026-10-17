# Farline

A self-hosted workspace for coding agents. Install it on your own server, use it from any browser on a phone or a computer, and run many sessions at once.

[简体中文](README.zh-CN.md)

## Features

- Parallel sessions sorted by latest activity, with a push notification when one finishes or needs you
- Start a session in any folder; the folder picker browses the whole server
- Tool calls, thinking, images, questions (AskUserQuestion) and permission prompts. Tool calls open in a sheet or inline in the conversation
- Background tasks (shell commands, subagents, monitors) listed on their own, with live output and a stop button each; a running command can be moved to the background
- Rewind to before any message: the conversation, the files the agent changed, or both
- Edit a reply: select text in a response and rewrite it; the next turn reads the edited version
- Files and folders mentioned in messages open in a viewer: a left panel on desktop, full screen on phones, with syntax highlighting and Markdown preview
- Switch model, effort and permission mode mid-session
- Models from Anthropic, DeepSeek (V4 Pro / Flash, 1M context, DeepSeek also judges auto mode), or any Anthropic-compatible API you add in Settings
- Plugins add model providers, notification channels, session hooks, UI extensions and skins. Install them from a GitHub repository or browse the ones published with the `farline-plugin` topic. See [docs/plugins.md](docs/plugins.md)
- English and Simplified Chinese, picked from the browser or chosen in Settings
- Installable PWA on phones; on desktop a resizable, collapsible sidebar next to the conversation
- Single-password sign-in

## Run it

Requires Node 22.18 or newer. The agent runtime is the Claude Code CLI, installed for the same user (`~/.local/bin/claude`).

```sh
git clone https://github.com/Pama-Lee/farline && cd farline
(cd web && npm ci && npm run build)
cd server && npm ci
node src/main.ts set-password 'your password'   # 12 characters or more
FARLINE_INSECURE_COOKIE=1 node src/main.ts     # http://127.0.0.1:3077
```

`FARLINE_INSECURE_COOKIE=1` is for plain-http testing on your own machine only. For real use, put Farline behind HTTPS: cookies, the service worker and push notifications all need it. `deploy/` has systemd and Caddy examples. Make sure the reverse proxy does not buffer server-sent events.

Farline can read, write and run anything the user running it can. It is the same as handing out a shell on that server: use a strong password and HTTPS only.

## Configuration

| Variable | Default | |
| --- | --- | --- |
| `FARLINE_HOST` | `127.0.0.1` | Listen address |
| `FARLINE_PORT` | `3077` | Port |
| `FARLINE_DATA_DIR` | `~/.farline` | Password hash, cookie secret, push keys, uploads, preferences, plugins and their settings |
| `FARLINE_DEFAULT_CWD` | `~` | Default folder for new sessions |
| `FARLINE_FS_ROOT` | `/` | Root the folder picker and file endpoints can reach |
| `FARLINE_CLAUDE_PATH` | `~/.local/bin/claude` | Agent runtime executable |
| `FARLINE_DEVICE_NAME` | host name | Device name shown in the app |
| `FARLINE_VAPID_SUBJECT` | `mailto:admin@example.com` | Contact for push services; use your own |
| `FARLINE_MAX_LIVE` | `6` | Session processes kept running at once |
| `FARLINE_IDLE_CLOSE_MS` | `1800000` | Idle time before a session's process is closed (the next message resumes it) |
| `FARLINE_PUBLIC_URL` | | Public address for links in notifications (WeCom and others); defaults to the address the browser used |
| `FARLINE_LANG` | `en` | Language for notifications sent before anyone has used the app; after that, the language last used in the app |
| `FARLINE_GITHUB_TOKEN` | | Token for installing plugins from private repositories and for higher GitHub rate limits |
| `DEEPSEEK_API_KEY` | | API key for the DeepSeek plugin; a key saved in Settings wins |
| `DEEPSEEK_BASE_URL` | `https://api.deepseek.com` | |

Restarting the server interrupts running sessions; each picks up from its transcript with the next message.

## Languages

All text lives in `shared/i18n/`: `en.ts` is the source, and each other language is a file with the same keys (`zh-CN.ts`). The type checker fails if a translation is missing a key. The server answers in the language the page sends; plugins can give text in several languages (see [docs/plugins.md](docs/plugins.md#languages)).

To add a language: copy `zh-CN.ts`, translate it, and register it in `shared/i18n/index.ts` (`LOCALES`, `pickLocale`, `isLocale`).

## Layout

- `server/`: Hono and `@anthropic-ai/claude-agent-sdk`, run directly with `node src/main.ts` (Node strips the types; there is no build step)
- `web/`: React and Vite; `npm run build` writes `web/dist`, which the server serves
- `shared/`: types and translations used by both
- `plugins/`: built-in plugins; `examples/plugins/`: an example plugin

## License

MIT
