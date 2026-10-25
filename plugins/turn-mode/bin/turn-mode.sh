#!/usr/bin/env bash
# turn-mode.sh <pane | agent name>                         print its turn mode
# turn-mode.sh <pane | agent name> async|realtime         set it
# turn-mode.sh <pane | agent name> agentic --driver <pane | agent name> [--driver-name <session name>]
# How the session's turns end (the turn-mode mod): async (the default; summary, then a
# Needs-you ask or possible next steps), real-time (just ends), agentic (one status
# line; its Needs-you asks go to the driver, not the user). A driver sets agentic when it
# starts or adopts a session; it holds until cleared. Takes effect on the next prompt.
# --driver-name: the driver's session name as SendMessage takes it (ListAgents); without it the worker is told to look it up.
set -euo pipefail
dir="${TURN_MODE_DIR:-${CLAUDE_CONFIG_DIR:-$HOME/.claude}/ctx/mode}"
usage() { sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'; exit 2; }
pane_of() {
  local p; p="$(herdr agent get "$1" 2>/dev/null | jq -r '.result.agent.pane_id // empty' 2>/dev/null || true)"
  [[ -z "$p" && "$1" =~ ^w[A-Za-z0-9]+:p[0-9]+$ ]] && p="$1"
  [[ -n "$p" ]] || { echo "no live pane or agent named '$1'" >&2; exit 2; }
  printf '%s' "$p"
}
[[ $# -ge 1 && "$1" != -h && "$1" != --help ]] || usage
pane="$(pane_of "$1")"; file="$dir/$pane.json"
if [[ $# -eq 1 ]]; then
  if [[ -f "$file" ]]; then
    jq -r '"\(.pane) \(.mode)\(if .driver then " (driver \(.driver)\(if .driverName then ", \(.driverName)" else "" end))" else "" end), set by \(.setBy)"' "$file"
  else
    echo "$pane async (default)"
  fi
  exit 0
fi
mode="$2"; driver=""; name=""; shift 2
while [[ $# -gt 0 ]]; do
  case "$1" in
    --driver)      driver="$(pane_of "${2:?--driver needs a pane or agent name}")"; shift 2 ;;
    --driver-name) name="${2:?--driver-name needs a session name}"; shift 2
                   [[ "$name" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$ ]] || { echo "--driver-name: not a session name: $name" >&2; exit 2; } ;;
    *) usage ;;
  esac
done
[[ -z "$name" || -n "$driver" ]] || { echo "--driver-name goes with --driver" >&2; exit 2; }
case "$mode" in
  async|realtime) [[ -z "$driver" ]] || { echo "--driver goes with agentic only" >&2; exit 2; } ;;
  agentic) [[ -n "$driver" ]] || { echo "agentic needs --driver <pane | agent name>" >&2; exit 2; } ;;
  *) usage ;;
esac
mkdir -p "$dir"
jq -n --arg pane "$pane" --arg mode "$mode" --arg driver "$driver" --arg name "$name" --arg by "${HERDR_PANE_ID:-cli}" --argjson at "$(( $(date +%s) * 1000 ))" \
  '{pane: $pane, mode: $mode, driver: (if $driver == "" then null else $driver end), driverName: (if $name == "" then null else $name end), setBy: $by, at: $at}' > "$file.tmp" && mv "$file.tmp" "$file"
echo "$pane $mode${driver:+ (driver $driver${name:+, $name})}"
