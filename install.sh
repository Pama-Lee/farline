#!/usr/bin/env bash
# Farline installer.
#
#   curl -fsSL https://raw.githubusercontent.com/Pama-Lee/farline/main/install.sh | bash
#
# Installs Node.js if needed (into ~/.local, no root), downloads Farline,
# builds it, runs it as a user service (systemd on Linux, launchd on macOS)
# and prints the address and the one-time setup code. Run it again to update.
#
# Options (environment variables):
#   FARLINE_PORT=3077           port
#   FARLINE_HOST=127.0.0.1      listen address; 0.0.0.0 to reach it from other devices
#   FARLINE_REF=main            branch or tag to install
#   FARLINE_APP_DIR             where the code goes (~/.local/share/farline)
#   FARLINE_DATA_DIR            where settings and data go (~/.farline)
#   FARLINE_NO_SERVICE=1        install only; print the command to start it
set -euo pipefail

PORT="${FARLINE_PORT:-3077}"
HOST="${FARLINE_HOST:-127.0.0.1}"
REF="${FARLINE_REF:-main}"
APP_DIR="${FARLINE_APP_DIR:-$HOME/.local/share/farline}"
DATA_DIR="${FARLINE_DATA_DIR:-$HOME/.farline}"
NODE_DIR="$HOME/.local/node"
REPO="Pama-Lee/farline"
NODE_MAJOR=22
NODE_MIN="22.18.0"

say() { printf '\033[1m%s\033[0m\n' "$*"; }
die() { printf '\033[31m%s\033[0m\n' "$*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "Farline needs $1. Install it and run this again."; }

need curl
need tar

case "$(uname -s)" in
  Linux) OS=linux ;;
  Darwin) OS=darwin ;;
  *) die "Farline runs on Linux and macOS." ;;
esac
case "$(uname -m)" in
  x86_64 | amd64) ARCH=x64 ;;
  aarch64 | arm64) ARCH=arm64 ;;
  *) die "Unsupported CPU: $(uname -m)" ;;
esac

version_ge() { [ "$(printf '%s\n%s\n' "$2" "$1" | sort -V | head -1)" = "$2" ]; }

# ---- Node.js ----
NODE=""
for candidate in "$NODE_DIR/bin/node" "$(command -v node 2>/dev/null || true)"; do
  [ -n "$candidate" ] && [ -x "$candidate" ] || continue
  v="$("$candidate" --version | tr -d v)"
  if version_ge "$v" "$NODE_MIN"; then NODE="$candidate"; break; fi
done
if [ -z "$NODE" ]; then
  say "Installing Node.js $NODE_MAJOR into $NODE_DIR"
  base="https://nodejs.org/dist/latest-v$NODE_MAJOR.x"
  file="$(curl -fsSL "$base/SHASUMS256.txt" | awk '{print $2}' | grep -E "^node-v[0-9.]+-$OS-$ARCH\.tar\.gz$" | head -1)"
  [ -n "$file" ] || die "Couldn't find a Node.js build for $OS-$ARCH"
  tmp="$(mktemp -d)"
  curl -fsSL "$base/$file" -o "$tmp/node.tar.gz"
  rm -rf "$NODE_DIR"
  mkdir -p "$NODE_DIR"
  tar -xzf "$tmp/node.tar.gz" -C "$NODE_DIR" --strip-components=1
  rm -rf "$tmp"
  NODE="$NODE_DIR/bin/node"
fi
NODE_BIN="$(dirname "$NODE")"
NPM="$NODE_BIN/npm"
export PATH="$NODE_BIN:$HOME/.local/bin:$PATH"
say "Node.js $("$NODE" --version)"

# ---- Farline ----
say "Downloading Farline ($REF)"
tmp="$(mktemp -d)"
curl -fsSL "https://codeload.github.com/$REPO/tar.gz/$REF" -o "$tmp/farline.tar.gz"
mkdir -p "$tmp/src"
tar -xzf "$tmp/farline.tar.gz" -C "$tmp/src" --strip-components=1
say "Building"
(cd "$tmp/src/web" && "$NPM" ci --no-audit --no-fund --loglevel=error && "$NPM" run build --silent)
(cd "$tmp/src/server" && "$NPM" ci --omit=dev --no-audit --no-fund --loglevel=error)
rm -rf "$APP_DIR.old"
[ -d "$APP_DIR" ] && mv "$APP_DIR" "$APP_DIR.old"
mkdir -p "$(dirname "$APP_DIR")"
mv "$tmp/src" "$APP_DIR"
rm -rf "$tmp" "$APP_DIR.old"
mkdir -p "$DATA_DIR"

# Plain http is fine on this machine; behind HTTPS, drop FARLINE_INSECURE_COOKIE.
ENV_VARS=(
  "FARLINE_HOST=$HOST"
  "FARLINE_PORT=$PORT"
  "FARLINE_DATA_DIR=$DATA_DIR"
  "FARLINE_INSECURE_COOKIE=1"
  "PATH=$NODE_BIN:$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin"
)
START=("$NODE" "$APP_DIR/server/src/main.ts")

# ---- service ----
started=0
if [ -n "${FARLINE_NO_SERVICE:-}" ]; then
  :
elif [ "$OS" = linux ] && command -v systemctl >/dev/null 2>&1 && systemctl --user show-environment >/dev/null 2>&1; then
  unit="$HOME/.config/systemd/user/farline.service"
  mkdir -p "$(dirname "$unit")"
  {
    echo "[Unit]"
    echo "Description=Farline"
    echo "After=network-online.target"
    echo
    echo "[Service]"
    for v in "${ENV_VARS[@]}"; do echo "Environment=\"$v\""; done
    echo "ExecStart=${START[*]}"
    echo "Restart=on-failure"
    echo "RestartSec=3"
    echo
    echo "[Install]"
    echo "WantedBy=default.target"
  } > "$unit"
  systemctl --user daemon-reload
  systemctl --user enable farline.service >/dev/null 2>&1
  systemctl --user restart farline.service
  # Keep running after logout.
  loginctl enable-linger "$USER" >/dev/null 2>&1 || true
  started=1
  LOGS="journalctl --user -u farline -f"
elif [ "$OS" = darwin ]; then
  plist="$HOME/Library/LaunchAgents/dev.farline.plist"
  mkdir -p "$(dirname "$plist")" "$DATA_DIR"
  {
    echo '<?xml version="1.0" encoding="UTF-8"?>'
    echo '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">'
    echo '<plist version="1.0"><dict>'
    echo '<key>Label</key><string>dev.farline</string>'
    echo '<key>ProgramArguments</key><array>'
    for a in "${START[@]}"; do echo "<string>$a</string>"; done
    echo '</array>'
    echo '<key>EnvironmentVariables</key><dict>'
    for v in "${ENV_VARS[@]}"; do echo "<key>${v%%=*}</key><string>${v#*=}</string>"; done
    echo '</dict>'
    echo '<key>RunAtLoad</key><true/><key>KeepAlive</key><true/>'
    echo "<key>StandardOutPath</key><string>$DATA_DIR/farline.log</string>"
    echo "<key>StandardErrorPath</key><string>$DATA_DIR/farline.log</string>"
    echo '</dict></plist>'
  } > "$plist"
  launchctl unload "$plist" >/dev/null 2>&1 || true
  launchctl load "$plist"
  started=1
  LOGS="tail -f $DATA_DIR/farline.log"
fi

if [ "$started" = 0 ]; then
  say "Start Farline with:"
  echo "  env ${ENV_VARS[*]} ${START[*]}"
  exit 0
fi

# ---- done ----
for _ in $(seq 1 40); do
  curl -fsS "http://127.0.0.1:$PORT/api/me" >/dev/null 2>&1 && break
  sleep 0.5
done
echo
say "Farline is running: http://$([ "$HOST" = 0.0.0.0 ] && echo "<this machine's address>" || echo 127.0.0.1):$PORT"
if [ -f "$DATA_DIR/setup-code" ]; then
  echo
  say "  Setup code: $(cat "$DATA_DIR/setup-code")"
  echo "  Open the address above, enter the code and choose a password."
fi
echo
echo "  Logs:    $LOGS"
echo "  Update:  run this installer again"
if [ "$HOST" = 127.0.0.1 ]; then
  echo "  Phone:   put it behind HTTPS (Caddy, Cloudflare Tunnel, Tailscale) or reinstall with FARLINE_HOST=0.0.0.0"
fi
