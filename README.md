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
- Reactions: the agent can put an emoji on your message (sometimes that's the whole answer), and you can react to any message
- Single-password sign-in

## Install

One line, on Linux or macOS. It installs Node.js if needed (into `~/.local`, no root), sets Farline up as a service that starts with the machine, and prints the address and a one-time setup code:

```sh
curl -fsSL https://raw.githubusercontent.com/Pama-Lee/farline/main/install.sh | bash
```

Or run it with npm (Node 22.18+):

```sh
npx farline            # http://127.0.0.1:3077
npx farline --lan      # reachable from other devices on your network
```

Open the address, enter the setup code printed in the terminal, and choose a password. The setup page then checks for [Claude Code](https://claude.com/claude-code) and [pi](https://pi.dev), installs either one with a click, and helps you add a model provider (a DeepSeek key, any Anthropic-compatible API, or the agent's own sign-in).

From source:

```sh
git clone https://github.com/Pama-Lee/farline && cd farline
(cd web && npm ci && npm run build)
cd server && npm ci
FARLINE_INSECURE_COOKIE=1 node src/main.ts     # http://127.0.0.1:3077
```

`FARLINE_INSECURE_COOKIE=1` (set by the installer and `npx farline`) allows sign-in over plain http. To use Farline from your phone away from home, put it behind HTTPS (Caddy, Cloudflare Tunnel, Tailscale…): cookies, the service worker and push notifications need it there. `deploy/` has systemd and Caddy examples; the reverse proxy must not buffer server-sent events.

Farline can read, write and run anything the user running it can. It is the same as handing out a shell on that machine: use a strong password, and HTTPS anywhere but your own network.

## Agents

- **Claude Code**: sessions run through the Claude Agent SDK. Sign in with a Claude account, or skip that and use any provider you add in Farline.
- **pi**: sessions run `pi --mode rpc`. pi's own models (from its settings) show up in the model picker, next to the providers you add in Farline, which are shared with pi. Rewinding a pi session forks it into a new one; file rewind and reply editing are Claude Code only for now.

## Configuration

| Variable | Default | |
| --- | --- | --- |
| `FARLINE_HOST` | `127.0.0.1` | Listen address |
| `FARLINE_PORT` | `3077` | Port |
| `FARLINE_DATA_DIR` | `~/.farline` | Password hash, cookie secret, push keys, uploads, preferences, plugins and their settings |
| `FARLINE_DEFAULT_CWD` | `~` | Default folder for new sessions |
| `FARLINE_FS_ROOT` | `/` | Root the folder picker and file endpoints can reach |
| `FARLINE_CLAUDE_PATH` | `~/.local/bin/claude` | Claude Code executable |
| `FARLINE_PI_PATH` | `pi` on `PATH` | pi executable |
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
