#!/usr/bin/env bash
# Smoke test for bin/turn-mode.sh's mode file (--driver-name). A stub herdr knows no agents, so pane ids are used as given.
set -u
S="$(cd "$(dirname "$0")/.." && pwd)/bin/turn-mode.sh"
T=$(mktemp -d) && [[ -d $T && $T == /* ]] || exit 2
trap 'rm -rf "$T"' EXIT
mkdir -p "$T/bin"; printf '#!/bin/sh\nexit 1\n' > "$T/bin/herdr"; chmod +x "$T/bin/herdr"
export PATH="$T/bin:$PATH" TURN_MODE_DIR="$T/mode" HERDR_PANE_ID=w9:p9
fails=0
ok() { if eval "$2"; then echo "ok   $1"; else echo "FAIL $1"; fails=$((fails+1)); fi; }
bash "$S" w1:p2 agentic --driver w1:p1 --driver-name lead-driver >/dev/null
ok "agentic with a name writes driverName" '[[ $(jq -r .driverName "$T/mode/w1:p2.json") == lead-driver && $(jq -r .driver "$T/mode/w1:p2.json") == w1:p1 ]]'
ok "read-back shows the name" '[[ $(bash "$S" w1:p2) == "w1:p2 agentic (driver w1:p1, lead-driver), set by w9:p9" ]]'
bash "$S" w1:p2 agentic --driver w1:p1 >/dev/null
ok "without a name, driverName is null" '[[ $(jq -r .driverName "$T/mode/w1:p2.json") == null ]]'
ok "--driver-name order doesn't matter" 'bash "$S" w1:p3 agentic --driver-name lead-driver --driver w1:p1 >/dev/null && [[ $(jq -r .driverName "$T/mode/w1:p3.json") == lead-driver ]]'
ok "--driver-name without --driver is refused" '! bash "$S" w1:p4 agentic --driver-name lead-driver 2>/dev/null'
ok "a pane id is not a session name" '! bash "$S" w1:p4 agentic --driver w1:p1 --driver-name w1:p1 2>/dev/null'
ok "async still refuses --driver" '! bash "$S" w1:p4 async --driver w1:p1 2>/dev/null'
ok "async clears the file's driver" 'bash "$S" w1:p2 async >/dev/null && [[ $(jq -r .driver "$T/mode/w1:p2.json") == null ]]'
[[ $fails == 0 ]] && echo PASS || { echo "$fails failed"; exit 1; }
