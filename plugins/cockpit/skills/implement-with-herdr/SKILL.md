---
name: implement-with-herdr
description: "Drive a spec's tickets to merged, tested code from inside Herdr at the lowest cost, then the least wall-clock time: independent lanes run in parallel Herdr tabs, each ticket on the cheapest model and effort that can do it, workers cleared between tickets and auto-compacting early. Invoke directly (/cockpit:implement-with-herdr <spec> [tickets]) when a spec with tickets (beads, /to-tickets issues, a superpowers plan, or another stack's tasks) is ready to build; add `using <stack>` to pick the build skill. Needs HERDR_ENV=1."
---

# Implement with Herdr: tickets to merged, cheapest first

Order of goals: fewest dollars, then fewest minutes. **Done** = every ticket merged on the integration branch, tests
green, one final review's findings fixed, tickets closed. Drive to done; stop early only for a decision only the
person can make.

Workers run the person's build skill, picked in §0. You choose where each ticket runs, on which model and effort,
and when context is cleared.

## No process porn

Every step must move a ticket toward merged. Write nothing but `.cockpit/implement.md` (the ticket table) and code.
No plan documents, design notes, status reports, approval gates, per-ticket reviews or chat summaries. A worker's
report is one status line. Rulings go in a ticket comment or a one-line file, not a document.

## 0. Pick the build skill

Take the first rule that gives one:

1. **Named in the prompt:** `using superpowers`, `using /gsd-execute-phase`. Not installed: say so and ask; don't
   fall back to another.
2. **The input's format:**

   | Input | Stack | Build skill |
   |---|---|---|
   | /to-tickets issues, beads | mattpocock | `/mattpocock-skills:implement <ticket>` (typed: see §5) |
   | a writing-plans plan | superpowers | `/superpowers:subagent-driven-development <lane file>` (`executing-plans` for one small lane) |
   | `SPEC.md` + /plan tasks | addyosmani | `/agent-skills:build` (the next task; not `build auto`) |
   | `.planning/` phase `PLAN.md` | gsd | `/gsd-execute-phase <phase>` |
   | a ce-plan plan | compound_engineering | `/compound-engineering:ce-work <plan>` |
   | `.specify/`, `specs/*/tasks.md` | spec_kit | `/speckit-implement` |
   | BMad epics and stories, `_bmad/` | bmad | `/bmad-build <story>` |

3. **The `stack` option:** it is set to `${user_config.stack}`. Not installed: say so and ask, as in 1. `auto`,
   empty, or still the literal `${user_config...}` text (not substituted): go to 4.
4. **Nothing picked:** the first installed of mattpocock, then superpowers. Neither: Claude Code's own steps, with
   no skill (§5).

Installed means a line `❯ <plugin>@` in `claude plugin list`, or the skill's file on disk; gsd, spec_kit and bmad
install per project, so look in the repo's `.claude/` too. Use the form that's on disk: gsd is `/gsd-<cmd>`
(`/gsd-core:gsd-<cmd>` as a plugin, `/gsd:<cmd>` on the old get-shit-done-cc), spec-kit is `/speckit-<x>` from
`.claude/skills` (`/speckit.<x>` from older `.claude/commands`), bmad is `/bmad-build` (`/bmad-method:bmad-build` as
a plugin). gstack has no build skill: for its plans use Claude Code's own steps.

Then read the picked skill's SKILL.md, as orchestrate §0 says, every run; the file wins over this table. It settles
the unit a worker gets (a ticket, a phase, a whole tasks file), whether the skill fans out by itself (then give it one
lane), and its closing review, which workers skip.

## 1. Read the tickets, once

Read the spec, then each ticket's title, acceptance criteria, blocking edges and the files it touches. Don't explore
the codebase; workers do that. Keep the table out of git (`echo .cockpit/ >> "$(git rev-parse --git-common-dir)/info/exclude"`)
and write it: ticket, tier, lane, depends on, status, usd. Above the table, under **Rules**, copy every standing rule
the person has given for this work (in the prompt, this conversation, the spec, or CLAUDE.md lines a worker
won't see in its worktree, such as "no PRs", "don't touch infra/"), one line each, verbatim. Workers start from an
empty context and know only what their prompt says. Trust the file and `git log` after any compaction.

## 2. Tier each ticket

The cheapest model that won't flail. Cheap models take 2-3× the turns on multi-step work, so the default is the middle tier.

| Tier | Flags | Ticket |
|---|---|---|
| low | `--model haiku --effort low` | one or two files, complete spec, existing pattern: config, copy, renames, fixtures, boilerplate |
| mid (default) | `--model sonnet --effort medium` | a normal feature or fix with clear acceptance criteria |
| high | `--model opus --effort medium` | design judgment, concurrency, security, data migrations, bugs of unknown cause |

Always set effort: an omitted one inherits the person's default, often xhigh. Never start a worker above medium:
on the same ticket Opus at high cost 43% more than Opus at medium, for no better result. Escalate a ticket one step
(low → mid → high → opus at `--effort high`) when its worker reports `BLOCKED` or fails the same tests twice; past
that, ask the person.

Model and effort are start flags. Never send `/model` or `/effort` to a running worker: you can't see whether it
took. A tier change restarts the worker (§4).

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
me=<your session name: ListAgents' first line, "This session is <name>">   # how workers SendMessage you
wt="$(git rev-parse --show-toplevel).w1"
git worktree add -b lane-a "$wt" <integration-branch>
tab=$(herdr tab create --workspace "$HERDR_WORKSPACE_ID" --cwd "$wt" --label w1 --no-focus)
pane=$(printf '%s' "$tab" | jq -r '.result.root_pane.pane_id')
herdr agent start w1 --kind claude --pane "$pane" -- --model sonnet --effort medium --autocompact 250k \
  || { sleep 2; herdr agent start w1 --kind claude --pane "$pane" -- --model sonnet --effort medium --autocompact 250k; }
"$tm" w1 agentic --driver "$HERDR_PANE_ID" --driver-name "$me"
```

**Restart on a tier change** (same pane, worktree and branch; a new session costs about what `/clear` does):

```bash
herdr agent prompt w1 "/exit"; sleep 3
herdr agent start w1 --kind claude --pane "$pane" -- --model <m> --effort <e> --autocompact 250k \
  || { sleep 2; herdr agent start w1 --kind claude --pane "$pane" -- --model <m> --effort <e> --autocompact 250k; }
"$tm" w1 agentic --driver "$HERDR_PANE_ID" --driver-name "$me"
```

Name workers (`w1`, `w2`), not lanes: a worker outlives its first lane. Record each worker's pane, worktree and
current branch in the table. A start that fails twice means the shell wasn't ready; read the pane before trying again.

`--autocompact` makes a runaway context compact long before each turn's re-read gets expensive (default: about 967k
on a 1M window; floor 100k). Set it to the starting context plus 150k, rounded up to 50k (`tokens` in this session's
own ctx file, read before your first tool call, is a fair stand-in): compaction fires about 33k below the window, so
a window near the starting context compacts over and over. 150k on a repo that starts at 80k compacted one ticket 6
times. Use the same value for every worker in the run. `agentic` makes each turn end on `DONE`, `BLOCKED: <why>`,
`NEEDS-INPUT: <why>` or `WAITING: <job>` and keeps the worker out of the person's queue.

## 5. Feed one ticket at a time

This is the main cost lever: a ticket starts from a near-empty context instead of carrying every earlier ticket.

```bash
herdr agent prompt w1 "<build skill> <ticket-id>
Part of <spec path>; you are on branch lane-a in your own worktree. Skip the skill's closing review: one runs on the
whole branch at the end. Commit as '<ticket-id>: <title>'. Before DONE, run 'git merge <integration-branch>' and
resolve any conflicts. Do not open tabs or sessions.
Rules: <the Rules lines from .cockpit/implement.md, verbatim>
Waiting on a long job (a CI run, an ix-tester job): watch it with a background task or monitor, end the turn
'WAITING: <job>', and once it ends, stop every monitor and background wait you started for it before going on.
After the DONE line: 'DECISIONS: <each choice you made that the ticket or spec didn't settle, or none>'."
```

The first line is the slash command itself, typed: never "use the implement skill". `/mattpocock-skills:implement`
is slash-only (`disable-model-invocation`), so a worker asked to load it can't. If the worker reports it didn't run,
resend with `/mattpocock-skills:tdd <ticket-id>` as the first line. With no build skill, the first line is
`Build ticket <ticket-id>: write failing tests for its acceptance criteria, make them pass, run the full test suite.`
and the rest is the same.

Before each prompt, note the pane's `usd` from `${CLAUDE_CONFIG_DIR:-$HOME/.claude}/ctx/<pane>.json`. The ticket's cost is
the reading at `DONE` minus that one, or the whole reading if it went down (a `/clear` started a new session).

On `DONE`:
1. Record the ticket's usd.
2. Send `/clear`, not `/compact`. The ticket's state lives in git and the tracker, so the next ticket doesn't need the old
   context, and `/clear` is free while `/compact` re-reads the whole context.
3. If the next ticket's tier differs, restart the worker on the new flags (§4) instead.
4. Send the next ticket's prompt.

**SDD lanes** (a superpowers plan): write the lane's tasks to `<plan>.lane-a.md` and send
`/superpowers:subagent-driven-development <plan>.lane-a.md` once. SDD picks its subagents' models itself; the
controller runs at mid tier. Its ledger survives compaction, so `--autocompact` covers it; send `/compact` only to a
worker that is idle between tasks and above 100k.

## 6. Run the loop thin

- **Wait on every worker at once:** one background `worker-wait.sh w1` per worker (`run_in_background`; it is on
  PATH from cockpit's `bin/`), so whichever finishes first wakes you. It prints `w1 <status line>` once the worker ends
  a turn on `DONE`, `BLOCKED` or `NEEDS-INPUT`, and waits straight through `WAITING` turns: a worker waiting on a CI
  run or a test job is not done. A bare `herdr agent wait` wakes you on every `WAITING` turn instead. Exit 124 is
  its timeout (30 minutes; `--timeout MS`): check the ctx file's `at`; still advancing means it's working, so wait
  again; stalled means read the pane. After `DONE`, read the `DECISIONS:` line too
  (`herdr agent read w1 --source recent-unwrapped --lines 10`): a choice that contradicts the spec or a Rules line
  goes back to the worker before you merge. Never read a transcript; pull detail only to settle a specific problem.
- **`DONE`:** merge here (`git merge lane-a`; the worker already merged the integration tip, so this rarely
  conflicts), run the tests, start the lanes it unblocked.
- **`BLOCKED`:** escalate per §2: restart on the next tier (§4), then the ticket prompt plus the blocker line.
- **`NEEDS-INPUT`:** answer from the spec or ticket if they settle it. Otherwise ask the person, naming the ticket and
  the worker's tab.
- **A worker with nothing left in its lane** takes the next queued lane: here, `git -C <wt> switch -c lane-c
  <integration-branch>`, then `/clear` (or a restart, if its tier differs), prompt. Once nothing is queued, close its tab
  (`herdr tab close <tab_id>`).
- Compact yourself after a merge once the table is current and your context is over 100k.

## 7. Finish

1. After the last merge, review in a warm worker, not here (this context is the largest): `git -C <wt> switch -c review
   <integration-branch>`, then `/clear` (a restart on `--model sonnet --effort medium` if it runs another tier), and
   `/code-review medium --fix` (base: the branch the integration branch will merge into). Merge `review`, then run the tests.
2. Close the tickets the way the tracker closes work. Close the tabs you opened, then `git worktree remove` each worktree
   and `git branch -d` each merged lane and review branch.
3. Report the table: ticket, tier, lane, result, commit, usd, plus the total (workers plus this session's own ctx
   file). List the three costliest tickets with their tier: that is where the tiering was wrong, if anywhere.

## When not to

- Not in Herdr (`HERDR_ENV` unset): run the build skill (§0) as written.
- One chain of three tickets or fewer: start one worker anyway (§4-5) if the tickets differ in tier; otherwise run
  the build skill here.
