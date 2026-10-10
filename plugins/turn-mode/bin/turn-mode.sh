#!/usr/bin/env bash
# turn-mode.sh <pane | agent name>                         print its turn mode
# turn-mode.sh <pane | agent name> async|realtime         set it
# turn-mode.sh <pane | agent name> agentic --driver <pane | agent name>
# How the session's turns end (the turn-mode mod): async (the default; summary, then a
# Needs-you ask or possible next steps), real-time (just ends), agentic (one status
# line; its Needs-you asks go to the driver, not the user). A driver sets agentic when it
# starts or adopts a session; it holds until cleared. Takes effect on the next prompt.
set -euo pipefail
dir="${TURN_MODE_DIR:-${CLAUDE_CONFIG_DIR:-$HOME/.claude}/ctx/mode}"
usage() { sed -n '2,8p' "$0" | sed 's/^# \{0,1\}//'; exit 2; }
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
    jq -r '"\(.pane) \(.mode)\(if .driver then " (driver \(.driver))" else "" end), set by \(.setBy)"' "$file"
  else
    echo "$pane async (default)"
  fi
  exit 0
fi
mode="$2"; driver=""
[[ "${3:-}" == --driver ]] && driver="$(pane_of "${4:?--driver needs a pane or agent name}")"
case "$mode" in
  async|realtime) [[ -z "$driver" ]] || { echo "--driver goes with agentic only" >&2; exit 2; } ;;
  agentic) [[ -n "$driver" ]] || { echo "agentic needs --driver <pane | agent name>" >&2; exit 2; } ;;
  *) usage ;;
esac
mkdir -p "$dir"
jq -n --arg pane "$pane" --arg mode "$mode" --arg driver "$driver" --arg by "${HERDR_PANE_ID:-cli}" --argjson at "$(( $(date +%s) * 1000 ))" \
  '{pane: $pane, mode: $mode, driver: (if $driver == "" then null else $driver end), setBy: $by, at: $at}' > "$file.tmp" && mv "$file.tmp" "$file"
echo "$pane $mode${driver:+ (driver $driver)}"
