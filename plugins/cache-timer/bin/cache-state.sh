#!/usr/bin/env bash
# cache-state.sh <pane | agent name> [--json]
# Whether a session's prompt cache is still warm, before you message it: an
# expired target re-sends its whole context at full price on its next turn.
# Reads $CLAUDE_CONFIG_DIR/ctx/cache/<pane>.json (written by the cache-timer mod).
# Prints one line; exit 0 warm or working, 1 expired, 2 unknown.
set -euo pipefail
target="${1:-}"; json="${2:-}"
if [[ -z "$target" || "$target" == -h || "$target" == --help ]]; then
  sed -n '2,6p' "$0" | sed 's/^# \{0,1\}//'; exit 2
fi
dir="${CACHE_STATE_DIR:-${CLAUDE_CONFIG_DIR:-$HOME/.claude}/ctx/cache}"
info="$(herdr agent get "$target" 2>/dev/null || true)"
pane="$(jq -r '.result.agent.pane_id // empty' <<<"$info" 2>/dev/null || true)"
session="$(jq -r '.result.agent.agent_session.value // empty' <<<"$info" 2>/dev/null || true)"
[[ -z "$pane" && "$target" =~ ^w[A-Za-z0-9]+:p[0-9]+$ ]] && pane="$target"
file="$dir/$pane.json"
if [[ -z "$pane" || ! -f "$file" ]]; then
  echo "${pane:-$target} unknown (no cache state recorded)"; exit 2
fi
now_ms=$(( $(date +%s) * 1000 ))
jq -r --arg want "$session" --argjson now "$now_ms" --arg json "$json" '
  def mins: (. / 60000 | floor);
  def ago: if mins < 1 then "just now" elif mins < 120 then "\(mins)m ago" else "\(mins / 60 | floor)h ago" end;
  def left: if . < 60000 then "<1m" else "\(mins)m" end;
  (if $want != "" and .session != $want then "unknown"
   elif .isWorking then "working"
   elif .expiresAt == null then "unknown"
   elif .expiresAt <= $now then "expired" else "warm" end) as $s
  | if $json == "--json" then (. + {state: $s, leftMs: (if .expiresAt == null then null else .expiresAt - $now end)}) | tojson
    elif $s == "warm" then "\(.pane) warm, \((.expiresAt - $now) | left) left (ttl \(.ttlMs | mins)m)"
    elif $s == "expired" then "\(.pane) expired \(($now - .expiresAt) | ago) (ttl \(.ttlMs | mins)m): a message re-sends its whole context"
    elif $s == "working" then "\(.pane) working (cache in use)"
    else "\(.pane) unknown (\(if $want != "" and .session != $want then "the pane runs a newer session" else "no response yet" end))" end
' "$file"
state="$(jq -r --arg want "$session" --argjson now "$now_ms" 'if $want != "" and .session != $want then "unknown" elif .isWorking then "working" elif .expiresAt == null then "unknown" elif .expiresAt <= $now then "expired" else "warm" end' "$file")"
case "$state" in warm|working) exit 0 ;; expired) exit 1 ;; *) exit 2 ;; esac
