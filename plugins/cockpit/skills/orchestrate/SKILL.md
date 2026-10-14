---
name: orchestrate
description: "Process management for implementation in Herdr: decide what runs in parallel and where (this session, in-session subagents, or Claude sessions in new tabs of the current workspace), keep this window as a thin orchestrator, and spend the fewest tokens and the least wall-clock time. Use inside Herdr (HERDR_ENV=1) whenever a plan, spec or set of tickets is about to be implemented, including with superpowers:subagent-driven-development, superpowers:executing-plans, superpowers:dispatching-parallel-agents or Matt Pocock's /implement and /tdd, and whenever you are about to start a worker agent in Herdr. It does not replace those skills: they still do the work, the reviews and the verification; this decides how they run. Overrides the herdr skill's sibling-split default."
---

# Orchestrate: run the implementation skills in parallel, cheaply

You manage the process. The implementation skill (subagent-driven-development, executing-plans, /implement, /tdd)
still does every step it describes: briefs, TDD, reviews, ledgers, the final review. You decide **how many copies of
it run, where, on which slice of the work, and when context gets cleared**, so the whole job finishes sooner and
costs fewer tokens.

## 0. Know the skill you are managing: read it, every run

Profiles of popular skills are below, as a starting point. Skills change between versions and the person may use one
that is not listed, so before cutting lanes, **read the SKILL.md of the skill actually in play** (and the files it
links: prompts, scripts) and check these facts against it:

| Fact | Look for | Why it matters |
|---|---|---|
| **Parallel implementers** | "never dispatch … in parallel", one worktree | if forbidden, parallelism comes only from lanes in separate worktrees |
| **Recovery state** | a ledger, progress file, todos; what it is keyed to (plan file, branch) | each lane needs its own; it is what you and the worker trust after `/compact` |
| **Per-task gates** | per-task reviewers, TDD, type-checks | they stay inside each lane; never duplicate them |
| **Final step** | whole-branch review, /code-review, finish-branch | run once, by you, after the last merge |
| **Invocation** | `disable-model-invocation: true` means slash-only | a worker can only be started on it by a typed `/plugin:skill` prompt |
| **Stop rules** | what it escalates to the person | a blocked lane surfaces through you |
| **Its own fan-out** | does it already dispatch parallel subagents? | then give it one lane, do not stack tabs on top |

Where the file disagrees with a profile, **the file wins**; say so in one line ("SDD 6.5 now allows …; adjusting").
Unknown skill: derive the facts from its file; if it says nothing about parallel edits, assume one implementer per
worktree. Find the file from the skill listing's plugin and name, under
`$CLAUDE_CONFIG_DIR/plugins/cache/<marketplace>/<plugin>/<version>/skills/**/<name>/SKILL.md` (newest version).

**Profiles** (checked against superpowers 6.4.1 and mattpocock-skills 1.2.3):

- **superpowers:subagent-driven-development (SDD):** one controller; one implementer subagent at a time per
  worktree (parallel implementers forbidden: they conflict); a reviewer subagent per task; final whole-branch review.
  Ledger at `<repo>/.superpowers/sdd/<plan>/progress.md`, keyed to the plan file, survives compaction.
- **superpowers:executing-plans:** the same work inline; one context, one final review. Cheapest, no parallelism.
- **superpowers:dispatching-parallel-agents:** short, independent investigations as in-session subagents.
- **mattpocock-skills:implement:** one session works the tickets with /tdd, type-checks, runs /code-review, commits.
  Slash-only (`disable-model-invocation`). Tickets from /to-tickets carry blocking edges: those are the lane graph.

With the usual "one implementer per worktree", parallelism comes from **lanes**.

## 1. Cut the work into lanes

From the plan's tasks or the tickets' blocking edges, build the dependency graph, then:

- A **lane** is a chain of tasks that must run in order; tasks in different lanes share no files or interfaces
  that are still changing. Tasks the plan marks independent but that touch the same files go in the same lane.
- Write each lane's tasks to its own file next to the plan (`<plan>.lane-a.md`, verbatim task text plus the plan's
  Global Constraints and the spec path). SDD's ledger is keyed to the plan file, so each lane gets its own ledger.
- Write the lane table to `.cockpit/orchestrate.md` in the repo (git-ignored): lane, tasks, depends on, tab,
  worktree, branch, status. That file is your memory; trust it and `git log` after any compaction.

## 2. Pick where each piece runs

| Work | Runs in | Why |
|---|---|---|
| One lane, or the whole job under about 30 minutes | **this session**, the skill as-is | a worker session's startup and memory are not worth it |
| Two or more lanes of real work | **one Herdr tab per lane**, each in its own worktree, each running the skill on its lane file | the only way to run implementers in parallel without conflicts |
| Investigations, one-off reviews, lookups | **in-session subagents** (Task tool) | no session startup, no extra process, results come back to you |
| Lanes waiting on another lane | **queued** until it merges | start them from the merged branch |

## 3. Start the lanes

Stagger starts by a few seconds; each worker is a whole Claude session (a few hundred MB). Run at most **6** at
once, **3** when `memory_pressure | tail -1` shows under 25% free or `sysctl -n vm.loadavg` is over 15. Queue the rest.

```bash
tab=$(herdr tab create --workspace "$HERDR_WORKSPACE_ID" --cwd "$PWD" --label lane-a --no-focus)
pane=$(printf '%s' "$tab" | jq -r '.result.root_pane.pane_id')
herdr agent start lane-a --kind claude --pane "$pane" -- --worktree lane-a
turn-mode.sh lane-a agentic --driver "$HERDR_PANE_ID"
herdr agent prompt lane-a "/superpowers:subagent-driven-development docs/plans/x.lane-a.md
You are lane A of plan docs/plans/x.md, in your own worktree. Only the tasks in the lane file. Do not start other
sessions or tabs. When done: commit on your branch."
```

`turn-mode.sh … agentic` marks the worker as yours, not the person's: each turn ends on one status line (`DONE`,
`BLOCKED: <why>` or `NEEDS-INPUT: <why>`), its asks come to this pane instead of the person's queue, and ctx-heavy
leaves it out of their footer. Hand a tab back (`turn-mode.sh lane-a async`) only if the person
takes it over.

Use the skill the person chose for the job (`/mattpocock-skills:implement <tickets>` works the same way). The prompt
carries the slash command, the lane file path, and those three rules; nothing pasted from your context.

## 4. Keep your own context thin

- **Never read a worker's transcript.** Read its lane ledger, its status line
  (`herdr agent read lane-a --source recent-unwrapped --lines 30`), and `git log --oneline` / `git diff --stat` of its
  branch. Pull detail only to settle a specific problem.
- **Wait in bounded stretches:** `herdr agent wait lane-a --timeout 600000`, one status line between stretches.
  Lanes that finish arrive on their own; do not poll in short loops.
- **Hand over files, not text:** lane files, rulings and fixes go into files the worker reads.
- **Compact yourself** (`/compact`) after each lane merges, once `.cockpit/orchestrate.md` is current.

## 5. Keep the workers lean

- cockpit's ctx-bar writes each session's context size to `$CLAUDE_CONFIG_DIR/ctx/<pane>.json` (`tokens`, `window`).
  Check it instead of asking. A worker over about 60% that is between tasks and idle: send `/compact`.
- A finished lane's tab is a warm session: for the next queued lane, `herdr agent prompt lane-a "/clear"`, then send
  the new lane's prompt. No startup, no new process. Close a tab (`herdr tab close <tab_id>`) only when nothing is
  queued for it.

## 6. Merge and finish

- Merge each lane's branch into the orchestrating branch **as soon as it reports done** (not at the end), so
  conflicts surface early and dependent lanes can start from it. Rerun the tests after each merge.
- A merge conflict: use /resolving-merge-conflicts in this session.
- A `blocked` lane: read its ledger, rule if you can (write the ruling to a file, send the path); if only the person
  can decide, ask them, naming the lane and its tab.
- After the last merge, run the skill's own final step once on the whole branch (SDD's final review, /code-review for
  /implement), in this session. Lanes do not each run it.
- Finish with the lane table: lane, tab, tasks, result, merged commit.

## When not to

- Not in Herdr (`HERDR_ENV` unset), or the person asks for in-session subagents or one task at a time: run the skill
  as written.
- The tasks form a single chain: one lane, in this session.
- The person asks for a split, a workspace or a particular pane: do that.
