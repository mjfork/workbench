#!/usr/bin/env bash
# worker-wait.sh [--timeout MS] <worker>
# Waits until a driven worker (turn-mode agentic) ends a turn on DONE, BLOCKED or NEEDS-INPUT, and prints
# "<worker> <status line>". A WAITING turn is not the end of the task: its job is still running and the worker
# wakes itself when it ends, so this waits for the worker to start working again and then for its next turn end.
# Exit 0 on a status; 124 on timeout (printing the last status seen, or "TIMEOUT"); 2 on bad usage.
set -u
timeout_ms=1800000
[[ ${1-} == --timeout ]] && { timeout_ms=${2-}; shift 2; }
worker=${1-}
[[ -n $worker && $timeout_ms =~ ^[0-9]+$ ]] || { echo "usage: worker-wait.sh [--timeout MS] <worker>" >&2; exit 2; }

now_ms() { echo $(( $(date +%s) * 1000 )); }
deadline=$(( $(now_ms) + timeout_ms ))
left() { local l=$(( deadline - $(now_ms) )); (( l > 0 )) && echo "$l" || echo 0; }

# The last status line on the pane; the terminal may put a bullet or spaces before it.
status() {
  herdr agent read "$worker" --source recent-unwrapped --lines 40 2>/dev/null \
    | grep -oE '^[^A-Za-z]*(DONE|BLOCKED:|NEEDS-INPUT:|WAITING:).*' | sed -E 's/^[^A-Za-z]*//' | tail -1
}

# Run right after a prompt, the worker may not have started yet, and the pane still shows the last ticket's
# status. Give it a minute to start; one that finished within it is already idle, and the loop reads its status.
herdr agent wait "$worker" --until working --timeout "$(( timeout_ms < 60000 ? timeout_ms : 60000 ))" >/dev/null 2>&1

last=
while :; do
  l=$(left); (( l > 0 )) || break
  herdr agent wait "$worker" --until idle --until done --until blocked --timeout "$l" >/dev/null 2>&1 || break
  last=$(status)
  case $last in
    WAITING:*) ;;
    DONE*|BLOCKED:*|NEEDS-INPUT:*) echo "$worker $last"; exit 0 ;;
    *) echo "$worker ${last:-no status line}"; exit 0 ;;  # a turn end without a status: the driver reads the pane
  esac
  # WAITING: the worker is idle until its job's wake-up starts a new turn. Wait for that, then for its end.
  l=$(left); (( l > 0 )) || break
  herdr agent wait "$worker" --until working --timeout "$l" >/dev/null 2>&1 || break
done
echo "$worker TIMEOUT${last:+ (last: $last)}"
exit 124
