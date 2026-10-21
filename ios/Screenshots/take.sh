#!/bin/bash
# Screenshots of the app against the fake server: take.sh <simulator udid> <Farline.app> <out dir>
set -euo pipefail
SIM=$1
APP=$2
OUT=$3
BUNDLE=dev.farline.app
HERE=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$OUT"

node "$HERE/fake-server.mjs" 4010 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null || true' EXIT

xcrun simctl boot "$SIM" 2>/dev/null || true
xcrun simctl bootstatus "$SIM" -b
xcrun simctl status_bar "$SIM" override --time 9:41 --batteryState charged --batteryLevel 100 --cellularBars 4 --wifiBars 3
xcrun simctl install "$SIM" "$APP"
# Skip the keyboard's first-run "slide to type" card.
xcrun simctl spawn "$SIM" defaults write com.apple.keyboard.preferences DidShowContinuousPathIntroduction -bool true

running() { pgrep -f 'Farline.app/Farline' >/dev/null; }

# The first launches after boot are slow enough that the simulator can kill
# the app before it draws: launch once to warm up.
xcrun simctl launch "$SIM" "$BUNDLE" >/dev/null || true
sleep 20

shot() {
  local name=$1 appearance=$2
  shift 2
  xcrun simctl ui "$SIM" appearance "$appearance"
  for attempt in 1 2 3; do
    xcrun simctl terminate "$SIM" "$BUNDLE" 2>/dev/null || true
    env "$@" xcrun simctl launch "$SIM" "$BUNDLE" -AppleLanguages "(zh-Hans)" -AppleLocale zh_CN >/dev/null || true
    sleep 8
    # Not running: it crashed or was killed while launching.
    if ! running; then
      echo "$name: app not running (attempt $attempt)"
      local report
      report=$(ls -t ~/Library/Logs/DiagnosticReports/Farline* 2>/dev/null | head -1 || true)
      [ -n "$report" ] && { echo "$report"; head -c 4000 "$report"; echo; } || true
      continue
    fi
    xcrun simctl io "$SIM" screenshot "$OUT/$name.png"
    # A blank launch screen is a few KB: give it more time.
    if [ "$(stat -f%z "$OUT/$name.png")" -lt 120000 ]; then
      echo "$name: still on the launch screen (attempt $attempt)"
      sleep 10
      xcrun simctl io "$SIM" screenshot "$OUT/$name.png"
    fi
    echo "took $name"
    return
  done
  echo "could not take $name"
  return 1
}

S=SIMCTL_CHILD_FARLINE_SERVER=http://127.0.0.1:4010
shot connect light
shot home light $S
shot session light $S SIMCTL_CHILD_FARLINE_OPEN_SESSION=s1
shot done light $S SIMCTL_CHILD_FARLINE_OPEN_SESSION=s4
shot ask light $S SIMCTL_CHILD_FARLINE_OPEN_SESSION=s2
shot steps-sheet light $S SIMCTL_CHILD_FARLINE_OPEN_SESSION=s1 SIMCTL_CHILD_FARLINE_SHEET=steps
shot model-sheet light $S SIMCTL_CHILD_FARLINE_OPEN_SESSION=s1 SIMCTL_CHILD_FARLINE_SHEET=models
shot context-sheet light $S SIMCTL_CHILD_FARLINE_OPEN_SESSION=s1 SIMCTL_CHILD_FARLINE_SHEET=context
shot context-sheet-dark dark $S SIMCTL_CHILD_FARLINE_OPEN_SESSION=s1 SIMCTL_CHILD_FARLINE_SHEET=context
shot device-sheet light $S SIMCTL_CHILD_FARLINE_SHEET=device
shot settings-sheet light $S SIMCTL_CHILD_FARLINE_SHEET=settings
shot history-sheet light $S SIMCTL_CHILD_FARLINE_SHEET=history
shot session-dark dark $S SIMCTL_CHILD_FARLINE_OPEN_SESSION=s1
shot home-dark dark $S
