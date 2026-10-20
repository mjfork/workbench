<div align="center">

# workbench

**Claude Code plugins for running many long sessions at once.**

[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

</div>

**Who it's for:** you run several Claude Code sessions side by side, often for hours, usually inside [herdr](https://herdr.dev) (a terminal workspace manager for coding agents).

**The problem:** at that scale you lose track. A session sits on a question in a pane you aren't looking at. A cache expires and the next prompt costs ten times as much. The context fills up and you can't see with what. Handing a big job to several agents at once means herding them by hand.

**What you get:** a footer in every session that shows all of that at a glance, and commands that split a spec's tickets, or a stack of PRs, across parallel agents at the lowest cost.

```
         cache 42m  herdr w8Q:p3  ⚑ 2  w6N:p7  w8R   ← cache-timer · herdr-jump: this pane, who is waiting on you
async  w6A:p1 704k 31m  w8N:p2 412k 4m  w8Q:p3 233k   ← turn-mode · ctx-heavy: your heaviest sessions, cache left
            $1.60 ████████████░░░░░░░░  359k/1000k   ← ctx-bar: what fills the context (hover a color)
```

**How to use it:** install `cockpit` (below) and keep working as usual; the footer appears in every session. Click `⚑ 2` to go to whoever is waiting on you. When you have a spec with tickets ready, run `/cockpit:implement-with-herdr <spec>`. Before merging an agent's PR, run `/vet:map`. No herdr? `cache-timer` and `vet` work anywhere.

## What's here

**Footer instruments.** Always on, in every session. Installed together by `cockpit`.

| Plugin | Shows you |
|---|---|
| `cache-timer` | How long until the prompt cache expires, and a confirm card before a prompt re-sends an expired one at full price |
| `ctx-bar` | What fills the context window, as a bar colored by source (file reads, shell output, subagents…); hover for the biggest chunks |
| `ctx-heavy` | Your heaviest sessions anywhere in herdr, with each one's cache time left; click to go |
| `herdr-jump` | Which panes are waiting on you (`⚑ N`), and `/jump` to any pane by name |
| `turn-mode` | How this session ends its turns: a summary and a clear ask (async), just stop (real-time), or one status line for a driving agent (agentic) |

**Workflows.** Commands you run, also in `cockpit`. They need herdr.

| Command | Does |
|---|---|
| `/cockpit:implement-with-herdr <spec>` | Drives a spec's tickets to merged, tested code in parallel herdr tabs, each ticket on the cheapest model that can do it |
| `/cockpit:vet-with-herdr <pr> <pr>…` | Takes several PRs through `vet` in parallel tabs, until each passes |
| `/cockpit:orchestrate` | Rules for splitting any implementation into parallel lanes, one worktree and tab each, driven from your window |
| `/lets-compact <what's next>` | Writes the best `/compact` (or `/clear`) for what you'll do next, for you to run |

**Review.** `vet`, a separate install. For changes an agent wrote.

| Command | Does |
|---|---|
| `/vet:map [<pr>]` | A fresh auditor maps the change's unstated decisions, blast radius and test gaming; a second agent checks every row; one map posts on the PR |
| `/vet:address [<pr>]` | Fixes every must-fix item, each re-checked, and answers the rest in one reply |
| `/vet:verify [<pr>]` | A fresh read-only agent confirms the map was answered honestly, and posts a pass/fail status you can require before merge |

## Install

```
/plugin marketplace add mjfork/workbench
/plugin install cockpit@mjfork
```

That brings all five footer plugins and the workflows. Without herdr, take just the parts that work anywhere:

```
/plugin install cache-timer@mjfork
/plugin install vet@mjfork
```

## Try it

1. Hover the footer bar's biggest color. That's what to stop reading into context.
2. In another pane, end a turn with a `## ⚑ Needs you` section. Watch `⚑ 1` appear here, then click it.
3. Set `cache-timer`'s `handoffLeadMinutes` to 10 and leave a big session idle for an hour. Just before the cache expires it writes a handoff note; come back, type, and pick **Resume from handoff**.

## The needs-you queue

One list, shared by every session in a herdr server, of the panes waiting on you.

| | |
|---|---|
| **Gets in** | An agent ends its turn with a `## ⚑ Needs you` section (`turn-mode`'s async mode asks for one whenever the turn waits on you), or a pane is stuck on a permission or question dialog |
| **Leaves** | You answer in that pane, typed there or sent from anywhere else; you click **dismiss**; or the pane closes |
| **Stays** | A later turn without the section leaves the ask alone: background wake-ups end turns too, and they say nothing about it |
| **Order** | Dialogs and the longest waits first. Go to one and leave it waiting, and it moves to the bottom until it asks again |
| **Driven sessions** | A session another agent drives (turn-mode's agentic) sends its asks to that agent, not to you. A dialog it's stuck on stays in your list, with the driver named as its owner |

Click `⚑ N` (or run `/needs-me`) to see the list, or `/needs-me-next` to go to the top item that isn't this pane. Something look wrong? Every add and clear is logged in `~/.herdr-queue/<herdr session>/.log`.

## Commands

The workflow and `vet` commands are listed above. The rest:

| Command | Plugin | What it does |
|---|---|---|
| `/needs-me` | `herdr-jump` | Opens the needs-you list: click one to go there, or dismiss an ask |
| `/needs-me-next` | `herdr-jump` | Goes to the top of that list, skipping this pane |
| `/jump` | `herdr-jump` | A picker of every herdr pane (workspace › tab › pane); type to filter |
| `/jump <pane \| workspace \| words>` | `herdr-jump` | Straight to a pane ID (`w8N:p2`), a workspace ID or number, or the one title the words match (several open the picker, filtered) |
| `/jump-back` | `herdr-jump` | Back to the pane you were in before |
| `/ctxbar` | `ctx-bar` | The context breakdown by source, with the biggest chunks of each |
| `/ctxbar toggle` | `ctx-bar` | Hides or shows the footer bar |

The footer is clickable too: `⚑ N` or `+N` opens the needs-you list, any pane ID goes to that pane, and `turn-mode`'s label swaps async and real-time.

## Settings

Change them in `/config`, or in `settings.json` under `pluginConfigs["<plugin>"].options`.

| Plugin | Setting | Default | Meaning |
|---|---|---|---|
| `cache-timer` | `handoffLeadMinutes` | 0 (off) | Minutes before expiry that the [handoff](docs/handoff.md) runs; 10 is a good start |
| | `handoffMinTokens` | 200000 | Smaller sessions get no handoff: rebuilding them costs little (0 = any) |
| `ctx-heavy` | `show` | `both` | After each pane: `context` (its size), `cache` (time left) or `both` |
| | `order` | `context` | `context` (biggest first) or `cache` (closest to expiring first) |
| | `expired` | `hide` | `hide` lists only sessions whose cache is still warm; `show` lists them all |

The other plugins have no settings.

## Bonus: the status line

A plugin can't install a status line, so this one is a plain script: directory, project, model and context; session and week usage with reset times, and cost; your login and organization.

<details>
<summary>Set it up</summary>

```
mkdir -p ~/.claude && cp statusline/statusline.sh ~/.claude/statusline.sh
```

Then in `settings.json`:

```json
"statusLine": { "type": "command", "command": "bash \"${CLAUDE_CONFIG_DIR:-$HOME/.claude}/statusline.sh\"" }
```

Using a profile in `CLAUDE_CONFIG_DIR`? Copy the script into that folder instead. Set `STATUSLINE_TZ` (e.g. `America/Chicago`) to pin the time zone. Needs `jq`.

</details>

<details>
<summary>Requirements</summary>

- Claude Code with plugin hooks.
- [herdr](https://herdr.dev) on `PATH`, with sessions started inside it, for everything but `cache-timer` and `vet`.
- `bash` and `jq` for the needs-you queue; no hook settings to add. The queue lives in `~/.herdr-queue/`, readable by you only.
- `nc` with `-U` (macOS's own; `netcat-openbsd` on Linux), so a footer redraws the moment you focus its pane. Without it, it redraws on your first keystroke there.
- `vet`: `gh`, `git`, Node 22+.

A footer plugin installs the ones it builds on (`turn-mode` → `ctx-bar` → `ctx-heavy` → `herdr-jump`), which also lines the footer up.

</details>

<details>
<summary>Removing</summary>

```
claude plugin uninstall cockpit
claude plugin prune -y
```

Uninstalling `cockpit` leaves what it installed; `prune` removes it. To remove the chain one at a time, go from the top: `turn-mode`, `ctx-bar`, `ctx-heavy`, `herdr-jump`.

</details>

<details>
<summary>Develop</summary>

```
claude plugin test plugins/<plugin>
claude plugin validate plugins/<plugin>
bash plugins/herdr-jump/tests/needs-you.smoke.sh
bash statusline/test.sh
```

</details>

## License

[MIT](LICENSE)
