#!/bin/bash
# Runs statusline.sh on sample input in a throwaway HOME. Run: bash statusline/test.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
fail() { echo "FAIL: $1" >&2; echo "$out" >&2; exit 1; }
plain() { sed $'s/\033\\[[0-9;]*m//g'; }
mkdir -p "$tmp/profile"
echo '{"oauthAccount":{"emailAddress":"dev@example.com","organizationName":"Example Org"}}' > "$tmp/profile/.claude.json"
in='{"workspace":{"current_dir":"'"$tmp"'/work/alpha/beta/app","project_dir":"'"$tmp"'/work/alpha/beta/app"},"model":{"display_name":"Opus"},"context_window":{"used_percentage":42.4,"total_input_tokens":424000,"context_window_size":1000000},"cost":{"total_cost_usd":3.456},"rate_limits":{"five_hour":{"used_percentage":12.2,"resets_at":1800000000},"seven_day":{"used_percentage":55.5,"resets_at":1800500000}}}'

out="$(echo "$in" | HOME="$tmp" CLAUDE_CONFIG_DIR="$tmp/profile" STATUSLINE_TZ=UTC bash "$here/statusline.sh" | plain)"
[ "$(printf '%s\n' "$out" | wc -l | tr -d ' ')" = 3 ] || fail "three lines"
l1="$(sed -n 1p <<<"$out")"; l2="$(sed -n 2p <<<"$out")"; l3="$(sed -n 3p <<<"$out")"
grep -q 'ctx 42% (424k/1.0M)' <<<"$l1" || fail "context on line 1"
grep -q '\[app\]' <<<"$l1" || fail "project on line 1"
grep -q 'Opus' <<<"$l1" || fail "model on line 1"
grep -q '/…/app' <<<"$l1" || fail "a deep directory shows its first and last parts"
grep -q 'session 12% (resets .* UTC)' <<<"$l2" || fail "session usage in the chosen time zone"
grep -q 'week 56%' <<<"$l2" || fail "week usage"
grep -q '^session .* · week .* · \$3.46$' <<<"$l2" || fail "line 2 is session, week, then cost"
[ "$l3" = 'dev@example.com · Example Org' ] || fail "line 3 is the login alone, read from CLAUDE_CONFIG_DIR"

# A directory of 20 characters or fewer is shown whole.
short='{"workspace":{"current_dir":"/srv/a/b/c","project_dir":"/srv/a/b/c"}}'
out="$(echo "$short" | HOME="$tmp" CLAUDE_CONFIG_DIR="$tmp/profile" bash "$here/statusline.sh" | plain)"
grep -q '^/srv/a/b/c \[c\]' <<<"$out" || fail "a short directory is shown whole"

# With no profile set, the login is read from $HOME/.claude.json.
cp "$tmp/profile/.claude.json" "$tmp/.claude.json"
out="$(echo "$in" | env -u CLAUDE_CONFIG_DIR HOME="$tmp" bash "$here/statusline.sh" | plain)"
grep -q 'dev@example.com' <<<"$out" || fail "login read from HOME when CLAUDE_CONFIG_DIR is unset"

# Missing fields leave their parts out and never fail.
out="$(echo '{}' | HOME="$tmp" bash "$here/statusline.sh" | plain)"; [ $? -eq 0 ] || fail "empty input"
# Names with escape sequences or invisible characters in them are drawn as text: only the script's own colors reach the terminal.
mkdir -p "$tmp/evil"
echo '{"oauthAccount":{"emailAddress":"dev@example.com","organizationName":"Org\u001b]0;pwned\u0007‮"}}' > "$tmp/evil/.claude.json"
bad='{"workspace":{"current_dir":"/srv/a\u001b[2Jb","project_dir":"/srv/p\u001b[Hq"},"model":{"display_name":"Opus\u001b[31m​"}}'
out="$(echo "$bad" | HOME="$tmp" CLAUDE_CONFIG_DIR="$tmp/evil" bash "$here/statusline.sh" | plain)"
! printf '%s' "$out" | LC_ALL=C grep -q $'[\001-\010\013-\037\177]' || fail "no control characters but the script's colors"
! printf '%s' "$out" | grep -q $'‮\|​' || fail "no invisible characters"
grep -q 'a\[2Jb' <<<"$out" && grep -q 'Opus\[31m' <<<"$out" && grep -q 'Org\]0;pwned' <<<"$out" || fail "the names are still shown, as text"

# The status line is redrawn often in every session: a redraw with nothing new runs jq once and date not at all. The
# login is read again once .claude.json changes, and a reset time is formatted again once it moves.
mkdir -p "$tmp/bin" "$tmp/count"
for t in jq date; do printf '#!/bin/bash\necho x >> "%s/count/%s"\nexec %s "$@"\n' "$tmp" "$t" "$(command -v $t)" > "$tmp/bin/$t"; chmod +x "$tmp/bin/$t"; done
mkdir -p "$tmp/cached"; cp "$tmp/profile/.claude.json" "$tmp/cached/.claude.json"
draw() { echo "$1" | PATH="$tmp/bin:$PATH" HOME="$tmp" CLAUDE_CONFIG_DIR="$tmp/cached" STATUSLINE_TZ=UTC bash "$here/statusline.sh" | plain; }
runs() { wc -l < "$tmp/count/$1" 2>/dev/null | tr -d ' ' || echo 0; }
first="$(draw "$in")"; rm -f "$tmp/count/"*
out="$(draw "$in")"
[ "$out" = "$first" ] || fail "a cached redraw draws the same"
[ "$(runs jq)" = 1 ] || fail "a redraw with nothing new runs jq once (ran $(runs jq))"
[ "$(runs date)" = 0 ] || fail "a redraw with nothing new runs date not at all (ran $(runs date))"
sleep 1; echo '{"oauthAccount":{"emailAddress":"new@example.com","organizationName":"New Org"}}' > "$tmp/cached/.claude.json"
out="$(draw "$in")"; grep -q 'new@example.com · New Org' <<<"$out" || fail "a changed login shows at the next redraw"
moved="${in/1800000000/1800003600}"
out="$(draw "$moved")"; [ "$(sed -n 2p <<<"$out")" != "$(sed -n 2p <<<"$first")" ] || fail "a moved reset time shows at the next redraw"
: > "$tmp/cached/.statusline-cache"; out="$(draw "$in")"; [ "$out" = "$(draw "$in")" ] && grep -q 'session 12%' <<<"$out" || fail "an empty cache file is ignored"
echo "statusline.sh: all checks passed"
