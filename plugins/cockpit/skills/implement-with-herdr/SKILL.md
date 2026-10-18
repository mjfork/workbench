---
name: implement-with-herdr
description: "Drive a spec's tickets to merged, tested code from inside Herdr at the lowest cost, then the least wall-clock time: independent lanes run in parallel Herdr tabs, each ticket on the cheapest model and effort that can do it, workers cleared between tickets and auto-compacting early. Invoke directly (/cockpit:implement-with-herdr <spec> [tickets]) when a spec with tickets (beads, /to-tickets issues, or a superpowers plan) is ready to build. Needs HERDR_ENV=1."
---

# Implement with Herdr: tickets to merged, cheapest first

Order of goals: fewest dollars, then fewest minutes. **Done** = every ticket merged on the integration branch, tests
green, one final review's findings fixed, tickets closed. Drive to done; stop early only for a decision only the
person can make.

Workers run the person's implementation skill: `/mattpocock-skills:implement` per ticket, or
`/superpowers:subagent-driven-development` per lane when the input is a superpowers plan. You choose where each
ticket runs, on which model and effort, and when context is cleared.

## No process porn

Every step must move a ticket toward merged. Write nothing but `.cockpit/implement.md` (the ticket table) and code.
No plan documents, design notes, status reports, approval gates, per-ticket reviews or chat summaries. A worker's
report is one status line. Rulings go in a ticket comment or a one-line file, not a document.

## 1. Read the tickets, once

Read the spec, then each ticket's title, acceptance criteria, blocking edges and the files it touches. Don't explore
the codebase; workers do that. Keep the table out of git (`echo .cockpit/ >> "$(git rev-parse --git-common-dir)/info/exclude"`)
and write it: ticket, tier, lane, depends on, status, usd. Trust it and `git log` after any compaction.

## 2. Tier each ticket

The cheapest model that won't flail. Cheap models take 2-3× the turns on multi-step work, so the default is the middle tier.

| Tier | Flags | Ticket |
|---|---|---|
| low | `--model haiku --effort low` | one or two files, complete spec, existing pattern: config, copy, renames, fixtures, boilerplate |
| mid (default) | `--model sonnet --effort medium` | a normal feature or fix with clear acceptance criteria |
| high | `--model opus --effort high` | design judgment, concurrency, security, data migrations, bugs of unknown cause |

Always set effort: an omitted one inherits the person's default, often xhigh. Never give a worker xhigh or max.
Escalate a ticket one tier when its worker reports `BLOCKED` or fails the same tests twice; past high, ask the person.

## 3. Cut lanes

- A lane is a chain of tickets that must run in order (blocking edges, or shared files still changing). A ticket with
  no edges is a lane of one. Independent lanes run in parallel.
- Within a lane, order tickets so the tier changes as few times as the edges allow.
- At most 6 workers at once; 3 when `memory_pressure | tail -1` shows under 25% free or `sysctl -n vm.loadavg` is over
  15. Queued lanes go to the first worker that frees up (§6): a warm tab skips a session start.

## 4. Start a worker

Create the integration branch first and stay on it here. Each worker gets its own worktree, branched from it, so no
worker has to check its base. Stagger starts by a few seconds.

```bash
tm=$(ls -d "${CLAUDE_CONFIG_DIR:-$HOME/.claude}"/plugins/cache/*/turn-mode/*/bin/turn-mode.sh | sort -V | tail -1)
wt="$(git rev-parse --show-toplevel).w1"
git worktree add -b lane-a "$wt" <integration-branch>
tab=$(herdr tab create --workspace "$HERDR_WORKSPACE_ID" --cwd "$wt" --label w1 --no-focus)
pane=$(printf '%s' "$tab" | jq -r '.result.root_pane.pane_id')
herdr agent start w1 --kind claude --pane "$pane" -- --model sonnet --effort medium --autocompact 150k \
  || { sleep 2; herdr agent start w1 --kind claude --pane "$pane" -- --model sonnet --effort medium --autocompact 150k; }
"$tm" w1 agentic --driver "$HERDR_PANE_ID"
```

Name workers (`w1`, `w2`), not lanes: a worker outlives its first lane. Record each worker's pane, worktree and
current branch in the table. A start that fails twice means the shell wasn't ready; read the pane before trying again.

`--autocompact 150k` (floor 100k; default is about 967k on a 1M window) makes a runaway context compact long before
each turn's re-read gets expensive. `agentic` makes each turn end on `DONE`, `BLOCKED: <why>` or `NEEDS-INPUT: <why>`
and keeps the worker out of the person's queue.

## 5. Feed one ticket at a time

This is the main cost lever: a ticket starts from a near-empty context instead of carrying every earlier ticket.

```bash
herdr agent prompt w1 "/mattpocock-skills:implement <ticket-id>
Part of <spec path>; you are on branch lane-a in your own worktree. Skip the closing /code-review: one runs on the
whole branch at the end. Commit as '<ticket-id>: <title>'. Before DONE, run 'git merge <integration-branch>' and
resolve any conflicts. Do not open tabs or sessions."
```

Before each prompt, note the pane's `usd` from `${CLAUDE_CONFIG_DIR:-$HOME/.claude}/ctx/<pane>.json`. The ticket's cost is
the reading at `DONE` minus that one, or the whole reading if it went down (a `/clear` started a new session).

On `DONE`:
1. Record the ticket's usd.
2. Send `/clear`, not `/compact`. The ticket's state lives in git and the tracker, so the next ticket doesn't need the old
   context, and `/clear` is free while `/compact` re-reads the whole context.
3. If the next ticket's tier differs, send `/model <m>` and `/effort <e>`.
4. Send the next ticket's prompt.

**SDD lanes** (a superpowers plan): write the lane's tasks to `<plan>.lane-a.md` and send
`/superpowers:subagent-driven-development <plan>.lane-a.md` once. SDD picks its subagents' models itself; the
controller runs at mid tier. Its ledger survives compaction, so `--autocompact` covers it; send `/compact` only to a
worker that is idle between tasks and above 100k.

## 6. Run the loop thin

- **Wait on every worker at once:** one background `herdr agent wait w1 --timeout 1800000` per worker
  (`run_in_background`), so whichever finishes first wakes you. Then read the last status line only:
  `herdr agent read w1 --source recent-unwrapped --lines 5`. On a timeout, check the ctx file's `at`: still
  advancing means it's working, so wait again; stalled means read the pane. Never read a transcript; pull detail only
  to settle a specific problem.
- **`DONE`:** merge here (`git merge lane-a`; the worker already merged the integration tip, so this rarely
  conflicts), run the tests, start the lanes it unblocked.
- **`BLOCKED`:** escalate per §2 (`/clear`, `/model`, `/effort`, the ticket prompt plus the blocker line).
- **`NEEDS-INPUT`:** answer from the spec or ticket if they settle it. Otherwise ask the person, naming the ticket and
  the worker's tab.
- **A worker with nothing left in its lane** takes the next queued lane: here, `git -C <wt> switch -c lane-c
  <integration-branch>`, then `/clear`, set model and effort, prompt. Once nothing is queued, close its tab
  (`herdr tab close <tab_id>`).
- Compact yourself after a merge once the table is current and your context is over 100k.

## 7. Finish

1. After the last merge, review in a warm worker, not here (this context is the largest): `git -C <wt> switch -c review
   <integration-branch>`, then `/clear`, `/model sonnet`, `/effort medium`, and
   `/code-review medium --fix` (base: the branch the integration branch will merge into). Merge `review`, then run the tests.
2. Close the tickets the way the tracker closes work. Close the tabs you opened, then `git worktree remove` each worktree.
3. Report the table: ticket, tier, lane, result, commit, usd, plus the total (workers plus this session's own ctx
   file). List the three costliest tickets with their tier: that is where the tiering was wrong, if anywhere.

## When not to

- Not in Herdr (`HERDR_ENV` unset): run the implementation skill as written.
- One chain of three tickets or fewer: start one worker anyway (§4-5) if the tickets differ in tier; otherwise run
  the implementation skill here.
