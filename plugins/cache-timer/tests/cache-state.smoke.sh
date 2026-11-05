#!/usr/bin/env bash
# Smoke test for bin/cache-state.sh: colon pane ids read the underscore-named state file, warm and expired both come back,
# and a jq that writes CRLF (native Windows) or rejects -b (an older jq) changes nothing. A stub herdr knows no agents.
# Run: bash tests/cache-state.smoke.sh
set -u
S="$(cd "$(dirname "$0")/.." && pwd)/bin/cache-state.sh"
T=$(mktemp -d) && [[ -d $T && $T == /* ]] || exit 2
trap 'rm -rf "$T"' EXIT
mkdir -p "$T/bin" "$T/cache"; printf '#!/bin/sh\nexit 1\n' > "$T/bin/herdr"; chmod +x "$T/bin/herdr"
REAL_JQ=$(command -v jq); export REAL_JQ
export PATH="$T/bin:$PATH" CACHE_STATE_DIR="$T/cache"
fails=0
ok() { if eval "$2"; then echo "ok   $1"; else echo "FAIL $1"; fails=$((fails+1)); fi; }
# Carriage returns are counted with tr: MSYS grep ignores them, and $(...) drops the last one.
has_cr() { [ "$(tr -cd '\r' < "$1" | wc -c)" -gt 0 ]; }
# Runs the script with the given arguments: its output lands in $T/out (read with `out`), its exit code in $rc.
run() { bash "$S" "$@" > "$T/out"; rc=$?; }
out() { cat "$T/out" | tr -d '\r'; }
now=$(( $(date +%s) * 1000 ))
state() { printf '{"pane":"%s","session":"s1","isWorking":false,"lastResponseAt":%s,"ttlMs":3600000,"expiresAt":%s}\n' "$1" "$((now - 1000))" "$2" > "$3"; }

state w1:p1 "$((now + 1830000))" "$T/cache/w1_p1.json"
state w1:p2 "$((now - 60000))" "$T/cache/w1_p2.json"
state w1:p3 "$((now + 1830000))" "$T/cache/w1:p3.json"

run w1:p1
ok "warm: found through the underscore name" '[[ $rc == 0 && $(out) == "w1:p1 warm, 30m left (ttl 60m)" ]]'
run w1:p2
ok "expired: exit 1 and says so" '[[ $rc == 1 && $(out) == "w1:p2 expired "* ]]'
run w1:p3
ok "an old colon-named file is ignored, not migrated" '[[ $rc == 2 && $(out) == "w1:p3 unknown"* ]]'
run w1:p1 --json
ok "--json keeps the real pane id inside" '[[ $("$REAL_JQ" -r .pane "$T/out") == w1:p1 ]]'
ok "no carriage return in any of it" '! has_cr "$T/out"'

# A jq that writes CRLF unless it is given -b (the native Windows build), and one that rejects -b (an older jq).
mkdir -p "$T/fake"
cat > "$T/fake/jq" <<'FAKE'
#!/usr/bin/env bash
bin=0; for a in "$@"; do [[ $a == -b || $a == --binary ]] && bin=1; done
if [[ ${FAKE_JQ_OLD:-0} == 1 ]]; then
  [[ $bin == 1 ]] && { echo "jq: Unknown arguments" >&2; exit 2; }
  exec "$REAL_JQ" -b "$@"   # what an older jq does everywhere else: plain LF output
fi
[[ $bin == 1 ]] && exec "$REAL_JQ" "$@"
out=$(mktemp); "$REAL_JQ" "$@" > "$out"; rc=$?
awk '{ printf "%s\r\n", $0 }' "$out"; rm -f "$out"; exit $rc
FAKE
chmod +x "$T/fake/jq"
export PATH_PLAIN="$PATH"
PATH="$T/fake:$PATH_PLAIN" run w1:p1
ok "CRLF jq: warm, no carriage return, exit 0" '[[ $rc == 0 && $(out) == "w1:p1 warm, 30m left (ttl 60m)" ]] && ! has_cr "$T/out"'
PATH="$T/fake:$PATH_PLAIN" run w1:p2
ok "CRLF jq: expired, no carriage return, exit 1" '[[ $rc == 1 && $(out) == "w1:p2 expired "* ]] && ! has_cr "$T/out"'
PATH="$T/fake:$PATH_PLAIN" run w1:p1 --json
ok "CRLF jq: --json has no carriage return" '! has_cr "$T/out"'
FAKE_JQ_OLD=1 PATH="$T/fake:$PATH_PLAIN" run w1:p1
ok "an old jq without -b: warm, exit 0" '[[ $rc == 0 && $(out) == "w1:p1 warm, 30m left (ttl 60m)" ]] && ! has_cr "$T/out"'
FAKE_JQ_OLD=1 PATH="$T/fake:$PATH_PLAIN" run w1:p2
ok "an old jq without -b: expired, exit 1" '[[ $rc == 1 && $(out) == "w1:p2 expired "* ]] && ! has_cr "$T/out"'
[[ $fails == 0 ]] && echo PASS || { echo "$fails failed"; exit 1; }
