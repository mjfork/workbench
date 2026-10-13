---
name: herdr-worker-tabs
description: "Where to put a worker in Herdr: its own tab, not a split of this pane. Use whenever you are about to start another agent (a worker, reviewer, researcher, or any `herdr agent start`) or a long-running command for the person inside Herdr (HERDR_ENV=1), before you run `herdr pane split` or `herdr agent start`. This is the person's standing choice of topology, so it overrides the herdr skill's sibling-pane default."
---

# Workers go in their own tab

The person runs many sessions in Herdr and works pane by pane. A split shrinks the pane they are reading and stacks
workers into slivers; a tab keeps their pane whole and gives each worker a full screen and a name in the tab bar. So
this is their standing request for topology, the "explicitly requested" case the herdr skill waits for: start each
worker in a new tab of the current workspace, one worker per tab.

## How

```bash
# A tab in this workspace, in this directory, named for the worker; the person keeps their focus.
tab=$(herdr tab create --workspace "$HERDR_WORKSPACE_ID" --cwd "$PWD" --label reviewer --no-focus)
pane=$(printf '%s' "$tab" | jq -r '.result.root_pane.pane_id')

# Then start the worker in that tab's pane, as the herdr skill describes.
herdr agent start reviewer --kind claude --pane "$pane"
```

- **Label** the tab with the worker's name: short, unique in the workspace, the same name you give `agent start`.
- **Directory:** `--cwd "$PWD"` unless the task belongs somewhere else.
- **Focus:** always `--no-focus`. The person decides when to look.
- **Several workers:** one tab each, created one after another. Never several workers in one tab.
- **Say where it is:** tell the person the tab label and pane ID you started it in.

## When not to

- The person asks for a split, a side-by-side view or a particular pane: do exactly that.
- The person asks for a new workspace or a worktree: do that instead; this skill does not create either.
- Not in Herdr (`HERDR_ENV` unset): this skill does not apply.
- Reusing an idle shell pane the person pointed you to: use it; no new tab.
