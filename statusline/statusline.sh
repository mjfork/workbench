#!/bin/bash
# Claude Code status line: directory, project, model and context on line 1; session/week usage and cost on line 2;
# the Claude login (email, organization) on line 3. Needs jq. Times use the machine time zone, or STATUSLINE_TZ (e.g. America/Chicago).
exec 2>/dev/null
command -v jq >/dev/null || exit 0
input=$(cat)
# Every string drawn is stripped of control and invisible characters: a directory or org name with an escape
# sequence in it would otherwise drive the terminal (clear it, move the cursor, retitle the window).
clean='def clean: if type == "string" then gsub("[\\p{Cc}\\p{Cf}\\x{2028}\\x{2029}]"; "") else . end;'
q() { printf '%s' "$input" | jq -r "$clean $1 | clean"; }
k() { awk -v n="$1" 'BEGIN{ if (n>=1e6) printf "%.1fM", n/1e6; else if (n>=1e3) printf "%dk", int(n/1e3+0.5); else printf "%d", n }'; }
ts() { ( [ -n "${STATUSLINE_TZ:-}" ] && export TZ="$STATUSLINE_TZ"; date -d "@$1" "$2" || date -r "$1" "$2" ); }
E=$(printf '\033'); R="$E[0m"; G="$E[1;32m"; B="$E[1;34m"; M="$E[1;35m"; C="$E[1;36m"; Y="$E[1;33m"
cwd=$(q '.workspace.current_dir // .cwd // empty | strings')
proj=$(q '.workspace.project_dir // empty | strings')
model=$(q '.model.display_name // empty | strings')
pct=$(q '.context_window.used_percentage // empty | numbers | round')
used=$(q '.context_window.total_input_tokens // empty | numbers')
size=$(q '.context_window.context_window_size // empty | numbers')
cost=$(q '.cost.total_cost_usd // empty | numbers')
s5=$(q '.rate_limits.five_hour.used_percentage // empty | numbers | round')
r5=$(q '.rate_limits.five_hour.resets_at // empty | numbers | floor')
s7=$(q '.rate_limits.seven_day.used_percentage // empty | numbers | round')
r7=$(q '.rate_limits.seven_day.resets_at // empty | numbers | floor')
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
[ -n "$proj" ] && l1="$l1 $M[$(basename "$proj")]$R"
[ -n "$model" ] && l1="$l1 $C$model$R"
if [ -n "$pct" ]; then
  if [ -n "$used" ] && [ -n "$size" ]; then l1="$l1 ${Y}ctx $pct% ($(k "$used")/$(k "$size"))$R"
  else l1="$l1 ${Y}ctx $pct%$R"; fi
fi
# Line 2: session and week usage with reset times, then cost
l2=""
add2() { [ -n "$l2" ] && l2="$l2 · "; l2="$l2$1"; }
if [ -n "$s5" ]; then
  t=""; [ -n "$r5" ] && t=$(ts "$r5" '+%-I:%M %p %Z')
  if [ -n "$t" ]; then add2 "${C}session $s5% (resets $t)$R"; else add2 "${C}session $s5%$R"; fi
fi
if [ -n "$s7" ]; then
  t=""; [ -n "$r7" ] && t=$(ts "$r7" '+%a %-I:%M %p %Z')
  if [ -n "$t" ]; then add2 "${Y}week $s7% (resets $t)$R"; else add2 "${Y}week $s7%$R"; fi
fi
[ -n "$cost" ] && add2 "$M$(printf '$%.2f' "$cost")$R"
# Line 3: the Claude login (email, org)
l3=""
us=$(printf '\037')
acct=$(jq -r "$clean"' [.oauthAccount.emailAddress // "", .oauthAccount.organizationName // ""] | map(strings | clean) | join("\u001f")' "${CLAUDE_CONFIG_DIR:-$HOME}/.claude.json")
email=${acct%%"$us"*}; org=${acct#*"$us"}
[ -n "$email" ] && l3="$G$email$R"
[ -n "$org" ] && l3="${l3:+$l3 · }$B$org$R"
printf '%s' "$l1"
[ -n "$l2" ] && printf '\n%s' "$l2"
[ -n "$l3" ] && printf '\n%s' "$l3"
exit 0

