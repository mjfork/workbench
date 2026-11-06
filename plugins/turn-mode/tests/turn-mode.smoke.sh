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
ok "agentic with a name writes driverName" '[[ $(jq -r .driverName "$T/mode/w1_p2.json") == lead-driver && $(jq -r .driver "$T/mode/w1_p2.json") == w1:p1 ]]'
ok "read-back shows the name" '[[ $(bash "$S" w1:p2) == "w1:p2 agentic (driver w1:p1, lead-driver), set by w9:p9" ]]'
bash "$S" w1:p2 agentic --driver w1:p1 >/dev/null
ok "without a name, driverName is null" '[[ $(jq -r .driverName "$T/mode/w1_p2.json") == null ]]'
ok "--driver-name order doesn't matter" 'bash "$S" w1:p3 agentic --driver-name lead-driver --driver w1:p1 >/dev/null && [[ $(jq -r .driverName "$T/mode/w1_p3.json") == lead-driver ]]'
ok "--driver-name without --driver is refused" '! bash "$S" w1:p4 agentic --driver-name lead-driver 2>/dev/null'
ok "a pane id is not a session name" '! bash "$S" w1:p4 agentic --driver w1:p1 --driver-name w1:p1 2>/dev/null'
ok "async still refuses --driver" '! bash "$S" w1:p4 async --driver w1:p1 2>/dev/null'
ok "async clears the file's driver" 'bash "$S" w1:p2 async >/dev/null && [[ $(jq -r .driver "$T/mode/w1_p2.json") == null ]]'

# The file name: a pane id's colon becomes an underscore (NTFS reads a colon as a data stream); the id inside stays real.
bash "$S" w1:p5 realtime >/dev/null
ok "the mode file is named with an underscore" '[[ -f "$T/mode/w1_p5.json" && $(jq -r .pane "$T/mode/w1_p5.json") == w1:p5 ]]'
ok "set then read round-trips through it" '[[ $(bash "$S" w1:p5) == "w1:p5 realtime, set by w9:p9" ]]'
printf '{"pane":"w1:p6","mode":"agentic","driver":"w1:p1","setBy":"old","at":0}\n' > "$T/mode/w1:p6.json"
ok "an old colon-named file is ignored, not migrated" '[[ $(bash "$S" w1:p6) == "w1:p6 async (default)" ]]'

# A jq that writes CRLF unless it is given -b (the native Windows build), and one that rejects -b (an older jq).
REAL_JQ=$(command -v jq)
fake_jq() {
  mkdir -p "$1"
  cat > "$1/jq" <<'FAKE'
#!/usr/bin/env bash
# The real jq gets -b only if it knows it (jq 1.7 and later; Debian's 1.6 does not), and never twice.
bin=0; args=(); for a in "$@"; do if [[ $a == -b || $a == --binary ]]; then bin=1; else args+=("$a"); fi; done
rb=(); "$REAL_JQ" -b -n . >/dev/null 2>&1 && rb=(-b)
if [[ ${FAKE_JQ_OLD:-0} == 1 ]]; then
  [[ $bin == 1 ]] && { echo "jq: Unknown arguments" >&2; exit 2; }
  exec "$REAL_JQ" ${rb[@]+"${rb[@]}"} ${args[@]+"${args[@]}"}   # what an older jq does everywhere else: plain LF output
fi
[[ $bin == 1 ]] && exec "$REAL_JQ" ${rb[@]+"${rb[@]}"} ${args[@]+"${args[@]}"}
out=$(mktemp); "$REAL_JQ" ${args[@]+"${args[@]}"} > "$out"; rc=$?
awk '{ printf "%s\r\n", $0 }' "$out"; rm -f "$out"; exit $rc
FAKE
  chmod +x "$1/jq"
}
fake_jq "$T/fake"
export REAL_JQ
# Carriage returns are counted with tr: MSYS grep ignores them, and $(...) drops the last one.
has_cr() { [ "$(tr -cd '\r' < "$1" | wc -c)" -gt 0 ]; }
PATH="$T/fake:$PATH" bash "$S" w1:p7 agentic --driver w1:p1 --driver-name lead-driver >/dev/null
ok "CRLF jq: the stored file has no carriage return" '! has_cr "$T/mode/w1_p7.json" && [[ $("$REAL_JQ" -r .driverName "$T/mode/w1_p7.json") == lead-driver ]]'
PATH="$T/fake:$PATH" bash "$S" w1:p7 > "$T/out"
ok "CRLF jq: the read-back has no carriage return" '! has_cr "$T/out" && [[ $(< "$T/out") == "w1:p7 agentic (driver w1:p1, lead-driver), set by w9:p9" ]]'
FAKE_JQ_OLD=1 PATH="$T/fake:$PATH" bash "$S" w1:p8 agentic --driver w1:p1 >/dev/null
ok "an old jq without -b still sets the mode" '! has_cr "$T/mode/w1_p8.json" && [[ $("$REAL_JQ" -r .driver "$T/mode/w1_p8.json") == w1:p1 ]]'
FAKE_JQ_OLD=1 PATH="$T/fake:$PATH" bash "$S" w1:p8 > "$T/out"
ok "an old jq without -b still reads it back" '! has_cr "$T/out" && [[ $(< "$T/out") == "w1:p8 agentic (driver w1:p1), set by w9:p9" ]]'
[[ $fails == 0 ]] && echo PASS || { echo "$fails failed"; exit 1; }
