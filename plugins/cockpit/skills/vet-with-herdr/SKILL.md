---
name: vet-with-herdr
description: "Take several PRs from code to ready-for-you in parallel Herdr tabs at the lowest cost: per PR, one worker runs /vet:map, then /vet:address, then /vet:verify from a cleared context, looping until verify passes. The map, fixes and verdict land on each PR; you read only PRs that passed. Invoke directly (/cockpit:vet-with-herdr <pr> <pr> ...). Needs HERDR_ENV=1 and the vet plugin."
---

# Vet with Herdr: PRs to verified, cheapest first

**Done** = every PR has a posted map, an address reply, and a `vet-verify` PASS on its current head, or is handed to the person with exactly why not. You never fix, review or judge; workers and their seats do. Stop early only for a call only the person can make.

## No process porn

Write nothing but `.cockpit/review.md` (the PR table: pr, worker, stage, verify, rounds, usd). State lives on the PR. A worker's report is one status line.

## 1. Read the PRs, once

`gh pr view <n> --json number,title,headRefName,baseRefName,isDraft,state` each. Closed or draft → skip, say so. Keep the table out of git (`echo .cockpit/ >> "$(git rev-parse --git-common-dir)/info/exclude"`).

## 2. Start a worker per PR

At most 6 at once; 3 when `memory_pressure | tail -1` shows under 25% free or `sysctl -n vm.loadavg` is over 15. Queue the rest. Stagger starts by a few seconds.

```bash
tm=$(ls -d "${CLAUDE_CONFIG_DIR:-$HOME/.claude}"/plugins/cache/*/turn-mode/*/bin/turn-mode.sh | sort -V | tail -1)
me=<your session name: ListAgents' first line, "This session is <name>">   # how workers SendMessage you
wt="$(git rev-parse --show-toplevel).r<n>"
git worktree add --detach "$wt" && git -C "$wt" fetch -q origin && (cd "$wt" && gh pr checkout <n> --branch pr-<n>)
tab=$(herdr tab create --workspace "$HERDR_WORKSPACE_ID" --cwd "$wt" --label r<n> --no-focus)
pane=$(printf '%s' "$tab" | jq -r '.result.root_pane.pane_id')
herdr agent start r<n> --kind claude --pane "$pane" -- --model opus --effort medium --autocompact <k> \
  || { sleep 2; herdr agent start r<n> --kind claude --pane "$pane" -- --model opus --effort medium --autocompact <k>; }
"$tm" r<n> agentic --driver "$HERDR_PANE_ID" --driver-name "$me"
```

- Opus at medium: the review skills need an Opus driver; their seats run at high by themselves. Never start above medium.
- `--branch pr-<n>` lets the worktree hold the PR even if its branch is checked out elsewhere; the worker pushes with `git push origin HEAD:<headRefName>`.
- `<k>` = this session's starting context plus 150k, rounded up to 50k (see `implement-with-herdr` §4).

## 3. Feed one stage at a time

`/clear` before every stage: the map, reply and verdict live on the PR, so no stage needs the last one's context. Note the pane's `usd` from `${CLAUDE_CONFIG_DIR:-$HOME/.claude}/ctx/<pane>.json` before each prompt.

| Stage | Prompt |
|---|---|
| map | `/vet:map <n> --auto` + worktree line |
| address | `/vet:address <n> --auto` + worktree line |
| verify | `/vet:verify <n> --post` + worktree line |

Worktree line: `You are already on PR <n>'s head as branch pr-<n> in your own worktree: skip gh pr checkout; git pull --ff-only first; push with 'git push origin HEAD:<headRefName>'. Do not open tabs or sessions.`

`--auto` keeps every seat on Opus and posts without asking. Verify runs from a cleared context and dispatches its own fresh verifier, so nothing that fixed the code judges it.

## 4. Run the loop thin

- **Wait on every worker at once:** one background `worker-wait.sh r<n>` each (`run_in_background`; cockpit's `bin/`, on PATH). It prints the status line and waits through `WAITING` turns (a worker watching CI). Exit 124 is a timeout → ctx file's `at` still advancing means working, wait again; stalled → read the pane. Never read a transcript.
- **map `DONE`** → `/clear`, address.
- **address `DONE`** → `/clear`, verify. Escalations left open → `NEEDS-INPUT`: see below.
- **verify PASS** → done; record `HUMAN` (RED or one-way door → needs your approval).
- **verify FAIL** → `/clear`, `/vet:address <n> --auto` + worktree line + `Fix what /vet:verify failed: <its PROBLEMS lines>`, then verify again. Two FAILs → stop that PR, hand it over.
- **`BLOCKED`** → `/effort high` and resend the stage once; again → hand it over.
- **`NEEDS-INPUT`** or open escalations → ask the person, one question per escalation, naming the PR and the item. Send the answers as `/vet:address <n>` (no `--auto`) + worktree line + `The human decided: <id>: <answer>; ...`.
- **A free worker** takes the next queued PR: `git -C <wt> fetch -q origin`, `(cd <wt> && gh pr checkout <m> --branch pr-<m>)`, `/clear`, map. Nothing queued → close its tab.
- Compact yourself once the table is current and your context is over 100k.

## 5. Finish

1. Close the tabs you opened; `git worktree remove` each worktree; `git branch -D pr-<n>`.
2. Report the table: PR, verify, human needed (why), rounds, usd, plus the total (workers plus this session's ctx file). Link each PASS: those are the ones to read now, RED hunks first.

## When not to

- Not in Herdr (`HERDR_ENV` unset): run the three skills in order yourself, `/clear` between them.
- One PR: start one worker anyway; this context stays small.
