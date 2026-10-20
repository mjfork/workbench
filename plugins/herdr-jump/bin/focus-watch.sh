#!/bin/bash
# Prints "focused" each time herdr focuses this pane or its tab. The herdr-jump mod runs one per session
# and redraws its footer from the shared needs-you list on each line, so a pane you switch to shows asks you cleared
# elsewhere at once. Claude Code has no terminal-focus event, and a timer would wake ~55 idle sessions all day; this
# is a blocked read on herdr's socket, which runs nothing between focus changes.
#
# Every click emits pane_focused, tab_focused and workspace_focused, each with workspace_id: matching the workspace
# would wake every session in it. Matching the tab gives one line per click (pane_focused carries no tab_id) and also
# redraws a split pane that is visible but not focused; the pane is the fallback when herdr gives no tab.
set -u
sock="${HERDR_SOCKET_PATH:?}"
p="${HERDR_PANE_ID:?}" t="${HERDR_TAB_ID:-}"
req='{"id":"focus-watch","method":"events.subscribe","params":{"subscriptions":[{"type":"pane.focused"},{"type":"tab.focused"}]}}'
# The pipeline runs as its own process group (job control on), and only that group is killed on the way out: `tail`
# holds the socket's input open and would outlive a dead `nc`. Never `kill 0`: that is the caller's group, the session.
set -m
{ printf '%s\n' "$req"; exec tail -f /dev/null; } | nc -U "$sock" |
  jq --unbuffered -r --arg p "$p" --arg t "$t" '
    select(if $t != "" then .data.tab_id? == $t else .data.pane_id? == $p end) | "focused"' &
pg=$(ps -o pgid= -p $! | tr -d ' ')
trap '[ -n "$pg" ] && kill -- "-$pg" 2>/dev/null' EXIT TERM INT HUP
# `wait` returns on a signal, so the trap runs at once; a foreground pipeline would hold it until the pipe ended.
wait $!
