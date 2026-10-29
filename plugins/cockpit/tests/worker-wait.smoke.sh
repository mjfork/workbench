#!/usr/bin/env bash
# Smoke test for bin/worker-wait.sh. A stub herdr plays a script of turn ends: each `agent wait` takes the next
# line of $T/script (a status line for the pane, "-" for a wait that fails), and `agent read` prints the last one.
set -u
S="$(cd "$(dirname "$0")/.." && pwd)/bin/worker-wait.sh"
T=$(mktemp -d) && [[ -d $T && $T == /* ]] || exit 2
trap 'rm -rf "$T"' EXIT
mkdir -p "$T/bin"
cat > "$T/bin/herdr" <<'STUB'
#!/usr/bin/env bash
T=${STUB_DIR:?}
case "$2" in
  wait)
    echo "$*" >> "$T/calls"
    n=$(( $(cat "$T/n" 2>/dev/null || echo 0) + 1 )); echo $n > "$T/n"
    line=$(sed -n "${n}p" "$T/script")
    [[ -z $line || $line == - ]] && exit 1
    [[ $line == '~' ]] || printf '%s\n' "$line" > "$T/screen" ;;
  read) printf 'some output\n'; cat "$T/screen" 2>/dev/null ;;
esac
STUB
chmod +x "$T/bin/herdr"
export PATH="$T/bin:$PATH" STUB_DIR="$T"
fails=0
ok() { if eval "$2"; then echo "ok   $1"; else echo "FAIL $1"; fails=$((fails+1)); fi; }
# Every run starts with a wait for the worker to start working ("~": no change on the pane).
play() { rm -f "$T/n" "$T/screen" "$T/calls"; printf '%s\n' '~' "$@" > "$T/script"; }

play '⏺ DONE'
ok "DONE comes back at once" '[[ $(bash "$S" w1) == "w1 DONE" ]]'
play '  BLOCKED: tests fail twice'
ok "BLOCKED keeps its reason, without the indent" '[[ $(bash "$S" w1) == "w1 BLOCKED: tests fail twice" ]]'
play '⏺ WAITING: ix-tester job 42' '~' '⏺ DONE'
ok "WAITING waits through to the next turn end" '[[ $(bash "$S" w1) == "w1 DONE" ]]'
ok "it waits for working first, then a turn end; after WAITING, working again, then a turn end" '[[ $(sed -n 1p "$T/calls") == *"--until working"* && $(sed -n 2p "$T/calls") == *"--until idle"* && $(sed -n 3p "$T/calls") == *"--until working"* && $(sed -n 4p "$T/calls") == *"--until idle"* ]]'
play '⏺ WAITING: CI run' '~' '⏺ WAITING: CI run, again' '~' '⏺ NEEDS-INPUT: which schema?'
ok "two WAITING turns, then NEEDS-INPUT" '[[ $(bash "$S" w1) == "w1 NEEDS-INPUT: which schema?" ]]'
play '⏺ WAITING: CI run' '-'
out=$(bash "$S" --timeout 5000 w1); rc=$?
ok "a wait that runs out exits 124 with the last status" '[[ $rc == 124 && $out == "w1 TIMEOUT (last: WAITING: CI run)" ]]'
play 'just text'
ok "a turn end without a status line says so" '[[ $(bash "$S" w1) == "w1 no status line" ]]'
rm -f "$T/n" "$T/screen" "$T/calls"; printf '%s\n' - '⏺ DONE' > "$T/script"
ok "a worker that finished before the waiter started still reports" '[[ $(bash "$S" w1) == "w1 DONE" ]]'
ok "no worker is a usage error" 'bash "$S" >/dev/null 2>&1; [[ $? == 2 ]]'
[[ $fails == 0 ]] && echo PASS || { echo "$fails failed"; exit 1; }
