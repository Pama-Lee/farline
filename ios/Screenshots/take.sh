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

shot() {
  local name=$1 appearance=$2
  shift 2
  xcrun simctl ui "$SIM" appearance "$appearance"
  xcrun simctl terminate "$SIM" "$BUNDLE" 2>/dev/null || true
  env "$@" xcrun simctl launch "$SIM" "$BUNDLE" -AppleLanguages "(zh-Hans)" -AppleLocale zh_CN >/dev/null
  sleep 8
  xcrun simctl io "$SIM" screenshot "$OUT/$name.png"
  echo "took $name"
}

S=SIMCTL_CHILD_FARLINE_SERVER=http://127.0.0.1:4010
shot connect light
shot home light $S
shot session light $S SIMCTL_CHILD_FARLINE_OPEN_SESSION=s1
shot done light $S SIMCTL_CHILD_FARLINE_OPEN_SESSION=s4
shot ask light $S SIMCTL_CHILD_FARLINE_OPEN_SESSION=s2
shot steps-sheet light $S SIMCTL_CHILD_FARLINE_OPEN_SESSION=s1 SIMCTL_CHILD_FARLINE_SHEET=steps
shot device-sheet light $S SIMCTL_CHILD_FARLINE_SHEET=device
shot settings-sheet light $S SIMCTL_CHILD_FARLINE_SHEET=settings
shot history-sheet light $S SIMCTL_CHILD_FARLINE_SHEET=history
shot session-dark dark $S SIMCTL_CHILD_FARLINE_OPEN_SESSION=s1
shot home-dark dark $S
