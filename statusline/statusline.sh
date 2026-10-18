#!/bin/bash
# Claude Code status line: directory, project, model and context (measured against the auto-compact level) on line 1; session/week usage and cost on line 2;
# the Claude login (email, organization) on line 3. Needs jq. Times use the machine time zone, or STATUSLINE_TZ (e.g. America/Chicago).
exec 2>/dev/null
command -v jq >/dev/null || exit 0
# Every string drawn is stripped of control and invisible characters: a directory or org name with an escape
# sequence in it would otherwise drive the terminal (clear it, move the cursor, retitle the window).
clean='def clean: if type == "string" then gsub("[\\p{Cc}\\p{Cf}\\x{2028}\\x{2029}]"; "") else . end;'
k='def k: if . >= 1e6 then ((. / 1e5 | round) / 10 | tostring | if test("\\.") then . else . + ".0" end) + "M" elif . >= 1e3 then "\(. / 1e3 + 0.5 | floor)k" else "\(floor)" end;'
ts() { ( [ -n "${STATUSLINE_TZ:-}" ] && export TZ="$STATUSLINE_TZ"; date -d "@$1" "$2" || date -r "$1" "$2" ); }
E=$'\033'; R="$E[0m"; G="$E[1;32m"; B="$E[1;34m"; M="$E[1;35m"; C="$E[1;36m"; Y="$E[1;33m"
us=$'\037'
# What changes rarely is kept between redraws, one line in the config folder: the login (read again once .claude.json
# is newer than this file) and the two reset times as drawn (formatted again once one moves, or the time zone changes).
# Checks and reads are shell builtins, so a redraw with nothing new starts jq once and nothing else.
cfg="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"; acct_json="${CLAUDE_CONFIG_DIR:-$HOME}/.claude.json"; cache="$cfg/.statusline-cache"
IFS="$us" read -r c_v c_email c_org c_r5 c_t5 c_r7 c_t7 c_tz < "$cache" || true
[ "${c_v:-}" = v1 ] || { c_email=""; c_org=""; c_r5=""; c_t5=""; c_r7=""; c_t7=""; c_tz=""; }
# Every field in one jq run, reading the input straight from stdin (the status line is redrawn often, and each extra
# process costs about as much as jq itself): joined by the unit separator, which clean() strips from the values, so a
# field can never split. An absent field is empty.
# Context is drawn against the auto-compact level, the tokens at which Claude Code compacts: CLAUDE_CODE_AUTO_COMPACT_WINDOW,
# else the window settings.json saves for the model (/autocompact) or for every model, else the tuned default (about 967k
# on a 1M window, the window itself otherwise); capped at the window, then lowered by CLAUDE_AUTOCOMPACT_PCT_OVERRIDE.
# (A --autocompact flag, or a window set in project settings, is not visible to a status line.)
settings="$cfg/settings.json"
if [ -f "$settings" ]; then st=(--rawfile st "$settings"); else st=(--arg st ""); fi
prog="$clean $k"'
  def f(g): [g][0] // "" | tostring | clean;
  def win: if type == "number" and . >= 1e5 and . <= 1e6 then . else null end;
  ([.context_window.context_window_size | numbers][0]) as $size
  | ([try ($st | fromjson) catch null | objects][0] // {}) as $s
  | ([.model.id | strings][0] // "" | sub("\\[1m\\]$"; "") | sub("-[0-9]{8}$"; "")) as $id
  | (($acw | tonumber? | win)
     // ($s.modelSettings[$id]?.autoCompactWindow? | win)
     // ($s.autoCompactWindow? | win)
     // (if $size == null then null elif $size >= 1e6 then 967000 else $size end)) as $w
  | (if $w == null then null elif $size != null and $w > $size then $size else $w end) as $w
  | ([$acp | tonumber? | select(. >= 1 and . < 100)][0]) as $p | (if $w != null and $p != null then $w * $p / 100 | floor else $w end) as $level
  | ([.context_window.total_input_tokens | numbers][0]
     // (if $size != null and (.context_window.used_percentage | type) == "number" then .context_window.used_percentage * $size / 100 else null end)) as $used
  | [
  f(.workspace.current_dir // .cwd // empty | strings),
  f(.workspace.project_dir // empty | strings),
  f(.model.display_name // empty | strings),
  f(if $used != null and $level != null and $level > 0 then $used * 100 / $level else .context_window.used_percentage // empty | numbers end | round),
  f($used // empty | k),
  f($level // empty | k),
  f(.cost.total_cost_usd // empty | numbers),
  f(.rate_limits.five_hour.used_percentage // empty | numbers | round),
  f(.rate_limits.five_hour.resets_at // empty | numbers | floor),
  f(.rate_limits.seven_day.used_percentage // empty | numbers | round),
  f(.rate_limits.seven_day.resets_at // empty | numbers | floor)
] | join("\u001f")'
# jq starts about 5ms sooner on a program it reads from a file than on one given as an argument, so the program goes in
# on fd 3, a here-string bash writes itself. A native Windows jq.exe cannot open /dev/fd/3: it is given the argument.
acw="${CLAUDE_CODE_AUTO_COMPACT_WINDOW:-}"; acp="${CLAUDE_AUTOCOMPACT_PCT_OVERRIDE:-}"
case "${OSTYPE:-}" in
  msys*|cygwin*) fields=$(jq -r "${st[@]}" --arg acw "$acw" --arg acp "$acp" "$prog") ;;
  *) fields=$(jq -r "${st[@]}" --arg acw "$acw" --arg acp "$acp" -f /dev/fd/3 3<<<"$prog") ;;
esac
fields=${fields%$'\r'}   # a native Windows jq.exe ends its output with CRLF
IFS="$us" read -r cwd proj model pct used size cost s5 r5 s7 r7 <<<"$fields"
# Line 1: directory (first and last component only once it is over 20 characters), project, model, context
l1=""
if [ -n "$cwd" ]; then
  case "$cwd" in "$HOME") d="~" ;; "$HOME"/*) d="~${cwd#"$HOME"}" ;; *) d=$cwd ;; esac
  case "$d" in "~/"*) root="~/"; rest=${d#"~/"} ;; /*) root="/"; rest=${d#/} ;; *) root=""; rest="" ;; esac
  if [ -n "$rest" ] && [ "${#d}" -gt 20 ]; then
    first=${rest%%/*}; last=${rest##*/}
    mid=${rest#"$first"}; mid=${mid%"$last"}
    [ -n "$mid" ] && [ "$mid" != "/" ] && d="$root$first/…/$last"
  fi
  l1="$B$d$R"
fi
[ -n "$proj" ] || proj=$cwd
[ -n "$proj" ] && { p=${proj%/}; l1="$l1 $M[${p##*/}]$R"; }
[ -n "$model" ] && l1="$l1 $C$model$R"
if [ -n "$pct" ]; then
  if [ -n "$used" ] && [ -n "$size" ]; then l1="$l1 ${Y}ctx $pct% ($used/$size)$R"
  else l1="$l1 ${Y}ctx $pct%$R"; fi
fi
# Line 2: session and week usage with reset times, then cost
l2=""
add2() { [ -n "$l2" ] && l2="$l2 · "; l2="$l2$1"; }
tz="${STATUSLINE_TZ:-}"
if [ -n "$s5" ]; then
  t=""
  if [ -n "$r5" ] && [ "$r5" = "$c_r5" ] && [ "$tz" = "$c_tz" ] && [ -n "$c_t5" ]; then t=$c_t5
  elif [ -n "$r5" ]; then t=$(ts "$r5" '+%-I:%M %p %Z'); fi
  c_t5=$t
  if [ -n "$t" ]; then add2 "${C}session $s5% (resets $t)$R"; else add2 "${C}session $s5%$R"; fi
fi
if [ -n "$s7" ]; then
  t=""
  if [ -n "$r7" ] && [ "$r7" = "$c_r7" ] && [ "$tz" = "$c_tz" ] && [ -n "$c_t7" ]; then t=$c_t7
  elif [ -n "$r7" ]; then t=$(ts "$r7" '+%a %-I:%M %p %Z'); fi
  c_t7=$t
  if [ -n "$t" ]; then add2 "${Y}week $s7% (resets $t)$R"; else add2 "${Y}week $s7%$R"; fi
fi
[ -n "$cost" ] && add2 "$M$(printf '$%.2f' "$cost")$R"
# Line 3: the Claude login (email, org)
l3=""
if [ "${c_v:-}" = v1 ] && ! [ "$acct_json" -nt "$cache" ]; then email=$c_email; org=$c_org
else
  acct=$(jq -r "$clean"' [.oauthAccount.emailAddress // "", .oauthAccount.organizationName // ""] | map(strings | clean) | join("\u001f")' "$acct_json")
  acct=${acct%$'\r'}
  email=${acct%%"$us"*}; org=${acct#*"$us"}
fi
new_cache="v1$us$email$us$org$us$r5$us${c_t5:-}$us$r7$us${c_t7:-}$us$tz"
[ "$new_cache" = "v1$us$c_email$us$c_org$us$c_r5$us$c_t5$us$c_r7$us$c_t7$us$c_tz" ] && ! [ "$acct_json" -nt "$cache" ] ||
  printf '%s\n' "$new_cache" > "$cache"
[ -n "$email" ] && l3="$G$email$R"
[ -n "$org" ] && l3="${l3:+$l3 · }$B$org$R"
printf '%s' "$l1"
[ -n "$l2" ] && printf '\n%s' "$l2"
[ -n "$l3" ] && printf '\n%s' "$l3"
exit 0

