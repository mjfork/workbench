---
name: orchestrate
description: "Run implementation as an orchestrator: this window plans, briefs, reviews and integrates; the work runs in parallel Claude workers, each in its own new tab of the current Herdr workspace. Use inside Herdr (HERDR_ENV=1) whenever you implement or execute a plan or a set of tasks, including under superpowers:subagent-driven-development, superpowers:executing-plans, superpowers:dispatching-parallel-agents, Matt Pocock's implementation skills (tdd, prototype and the like) or any skill that says to dispatch subagents or implement task by task; and whenever you are about to start any worker agent in Herdr. Where those skills say to dispatch a subagent, start a worker tab instead. Overrides the herdr skill's sibling-split default: this is the person's standing choice of topology."
---

# Orchestrate: workers in tabs, this window drives

The person runs their work from Herdr. When there is implementation to do, this window is the orchestrator and the
work fans out: every task that does not wait on another runs now, each in a worker of its own, in a new tab of the
current workspace. Their pane stays whole, each worker gets a full screen and a name in the tab bar, and they can
watch or step into any of them. The implementation skill in use still decides *what* the tasks are, their order and
how each is reviewed; this skill decides *where* they run and who drives.

## 1. Plan the fan-out

- Break the work into tasks with clear edges (files, interfaces, tests). Mark what depends on what.
- **Aggressive by default:** start every task whose dependencies are done. Do not serialize what can run side by side.
- Keep for yourself only what is faster to do than to brief (a one-line fix, a rename).
- Same repo, overlapping files: give each worker its own worktree (`-- --worktree <name>` below) and merge their
  branches yourself. Disjoint files: they can share the checkout.

## 2. Mind the memory

Each worker is a whole Claude session, a few hundred MB. On a 16 GB Mac with other sessions open, too many at once
pushes everything into swap and stalls the machine. Before each new worker:

```bash
memory_pressure | tail -1                   # "System-wide memory free percentage: N%"
sysctl -n vm.loadavg
```

- Run at most **6** workers at a time; at most **3** when free memory is under 25% or load is over 15.
- Queue the rest and start one as each finishes. Say so: "8 tasks, 6 running, 2 queued".

## 3. Start a worker

```bash
tab=$(herdr tab create --workspace "$HERDR_WORKSPACE_ID" --cwd "$PWD" --label w-auth --no-focus)
pane=$(printf '%s' "$tab" | jq -r '.result.root_pane.pane_id')
herdr agent start w-auth --kind claude --pane "$pane"                          # shared checkout
herdr agent start w-auth --kind claude --pane "$pane" -- --worktree w-auth     # own worktree
```

- Name worker and tab alike: short, unique in the workspace, saying what it does (`w-auth`, `w-api-tests`).
- Always `--no-focus`: the person decides when to look.
- One worker per tab.

## 4. Brief it

A worker starts with none of your context. Each brief stands alone:

- **Goal** and why, in two or three lines; **files** to change and files to leave alone.
- **Interfaces** it must keep or provide; anything another worker is building that it can rely on.
- **Done when:** the tests to write or run, the commands that must pass.
- **Rules:** "You are a worker. Do not start other workers. Commit your work on your branch (worktree) or leave it
  uncommitted (shared checkout), as I say. End your last message with a line `RESULT: done` or
  `RESULT: blocked: <why>`, then a short summary: what changed, what you verified, anything left."

Send every ready brief, then wait, so they run together:

```bash
herdr agent prompt w-auth "$(cat brief-auth.md)"        # no --wait: fire, then the next
herdr agent prompt w-api-tests "$(cat brief-api.md)"
herdr agent wait w-auth --timeout 1800000               # then collect each
herdr agent read w-auth --source recent-unwrapped --lines 200
```

## 5. Review and integrate

- Treat each result as untrusted until checked: read its diff, run its tests yourself. The review steps of the
  implementation skill in use (spec review, code review) happen here, by you or by a reviewer worker in its own tab.
- Worktree branches: merge them one at a time, rerun the tests after each.
- Fixes go back to the same worker (`herdr agent prompt w-auth "..."`), not a new one.
- A `blocked` worker: read it and answer it if you can. If only the person can decide, ask them in your own reply,
  naming the worker and its tab.

## 6. Close out

- When a task is merged and verified, close its tab: `herdr tab close <tab_id>` (from the create response,
  `.result.tab.tab_id`). Leave a failed or blocked worker's tab open and say which.
- Finish with a short table for the person: worker, tab, task, result.

## When not to

- Not in Herdr (`HERDR_ENV` unset): use the implementation skill's own subagents.
- The person asks for in-session subagents, one task at a time, a split, a new workspace or a particular pane: do that.
- The tasks are tightly coupled, each needing the last one's result: run them in order (still one worker at a time
  in a tab if they are big).
