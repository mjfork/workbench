<div align="center">

# workbench

**Instruments for long Claude Code sessions.**

Know how full the context is, what filled it, when the cache dies, and which of your panes is waiting on you, without leaving the one you're in.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

</div>

```
         cache 42m  herdr w8Q:p3  ⚑ 2  w6N:p7  w8R   ← cache-timer · herdr-jump: this pane, who is waiting on you
async  w6A:p1 704k 31m  w8N:p2 412k 4m  w8Q:p3 233k   ← turn-mode · ctx-heavy: your heaviest sessions, cache left
            $1.60 ████████████░░░░░░░░  359k/1000k   ← ctx-bar: what fills the context (hover a color)
```

## Install (30 seconds)

```
/plugin marketplace add mjfork/workbench
/plugin install cockpit@mjfork
```

`cockpit` installs all five plugins. Four of them need [herdr](https://herdr.dev), the terminal workspace manager these sessions run in; `cache-timer` works anywhere, alone:

```
/plugin install cache-timer@mjfork
```

## Try it

1. Set `handoffLeadMinutes` to 10, then leave a big session idle for an hour. Before the cache expires, `cache-timer` writes a handoff note. Come back, type, and pick **Resume from handoff**.
2. Hover the bar's biggest color. That's what to stop reading into context.
3. End a turn in another pane with a `## ⚑ Needs you` section. Watch `⚑ 1` appear here, then click it.

That's the whole idea. If those three don't help you, the rest won't either.

## Why

Long sessions fail in boring, expensive ways. Each plugin fixes one.

### 1. The cache expires and you pay for it

A cached prompt is billed at a tenth of the input price. After an hour idle the cache is gone, and your next "ok, continue" re-sends 600k tokens at full price. You find out on the bill.

**`cache-timer`** counts the cache down in the footer (yellow in the last quarter, red once expired). It stops a prompt that would re-send an expired cache and asks first. Optionally (off by default, since Claude Code's auto-compact covers long sessions), it has the model write a [handoff note](docs/handoff.md) just before expiry, so you can resume in a fresh context for a fraction of the cost.

### 2. You can't see what's filling the context

"Context 72%" says nothing about why. Usually it's one file read four times, or a test log nobody needed.

**`ctx-bar`** draws the context window as a bar colored by what put each token there: the system prompt and tools, the conversation, shell output, file reads, subagents, MCP tools, edits. Hover a color for its biggest chunks. `/ctxbar` gives the full breakdown.

### 3. Something is waiting on you, somewhere

With a dozen sessions across workspaces, one of them has been sitting on a question for twenty minutes, and you're in another pane.

**`herdr-jump`** keeps a queue of every pane that ended its turn with a `## ⚑ Needs you` section or is stuck on a permission dialog. A session another agent drives (turn-mode's agentic) sends its asks to that driver instead; a dialog it is stuck on stays in your queue, owned by the driver, which is told so it can answer it first. `⚑ N` in the footer, one click to go there, `/needs-me-next` to work through them, `/jump` to go anywhere by name, `/jump-back` to return.

**`ctx-heavy`** lists your heaviest sessions anywhere in herdr, each with its cache's time left, so the one about to compact or go cold isn't a surprise. Sessions an agent drives (turn-mode's agentic, as `/cockpit:orchestrate` sets its workers) are left out: these are the places you might need to go.

### 4. Turns end the wrong way

Sometimes you want a summary and a clear ask. Sometimes you're watching and want it to just stop. Sometimes another agent is driving and wants one status line.

**`turn-mode`** is a footer toggle: async, real-time or agentic. In agentic mode, the session's asks go to its driver pane instead of to you.

## Plugins

| Plugin | What it does | Needs |
|---|---|---|
| `cockpit` | Installs the five below, plus `/cockpit:orchestrate`: process management for implementation skills: independent lanes run in parallel Herdr tabs, one worktree each, driven from your window; and `/cockpit:implement-with-herdr`: drives a spec's tickets to merged code at the lowest cost, each ticket on the cheapest model and effort that can do it; and `/lets-compact <what's next>`: the best `/compact` (or `/clear`) for what you do next, proposed for you to run | herdr, for four of them |
| `cache-timer` | Cache countdown, expired-cache confirm card, [handoff note](docs/handoff.md) | nothing |
| `ctx-bar` | Context bar by tool; hover cards; `/ctxbar` | herdr, `ctx-heavy` |
| `ctx-heavy` | Your heaviest sessions across herdr, with cache time left; click to go | herdr, `herdr-jump`; shows sessions that run `ctx-bar`; cache times from `cache-timer`; skips `turn-mode` agentic sessions |
| `herdr-jump` | Pane label; needs-you queue (`⚑ N`, `/needs-me`, `/needs-me-next`), redrawn when you focus a pane; `/jump`, `/jump-back` | herdr, `bash`, `jq`, `nc` |
| `turn-mode` | How a turn ends: async, real-time or agentic | herdr, `ctx-bar` |
| `review` | Review a change by its decisions, not its lines: `/review-map`, `/review-address`, `/review-verify` | `gh`, `git`, Node 22+; not part of `cockpit` |

A plugin installs what it needs. `turn-mode` → `ctx-bar` → `ctx-heavy` → `herdr-jump`, so installing any one brings the ones after it. That chain also sets the order they draw in, which is what lines the footer up on the right.

## Commands

| Command | Plugin | What it does |
|---|---|---|
| `/jump` | `herdr-jump` | Opens a picker of every herdr pane (workspace › tab › pane); type to filter, pick one to go there |
| `/jump <pane>` | `herdr-jump` | Goes straight to a pane by its ID, e.g. `/jump w8N:p2` |
| `/jump <workspace>` | `herdr-jump` | Goes to a workspace by its ID or number |
| `/jump <words>` | `herdr-jump` | Matches the words against workspace, tab and pane titles: one match jumps there, several open the picker already filtered |
| `/jump-back` | `herdr-jump` | Returns to the pane you were in before this one |
| `/needs-me` | `herdr-jump` | Lists every pane waiting on you, asks and permission dialogs; click one to go there, or dismiss an ask |
| `/needs-me-next` | `herdr-jump` | Jumps to the next pane waiting on you: dialogs first, then the longest wait; never this pane |
| `/ctxbar` | `ctx-bar` | Prints the context breakdown by kind, with the biggest chunks of each |
| `/ctxbar toggle` | `ctx-bar` | Hides or shows the footer bar |
| `/review-map [<pr>]` | `review` | A fresh Opus auditor maps the change's silent decisions, blast radius, door, contradictions and test gaming; an independent reviewer verdicts every row; three voters cut the noise; one map posts on the PR. `--litigate` debates to consensus; `--auto` runs with no human |
| `/review-address [<pr>]` | `review` | Fixes every MUST-FIX, each round re-checked by a fresh reviewer; gives every other item one closed answer; posts one reply, checked by script first. Escalates what only you can decide |
| `/review-verify [<pr>]` | `review` | A fresh read-only agent judges that the map was answered honestly and says whether a human must approve; `--post` writes the verdict and a `review-verify` status to require in branch protection |

The `herdr-jump` commands exist only in sessions running inside herdr.

The footer is clickable too:

- `⚑ N` or `+N` opens `/needs-me`; a pane ID next to it goes to that pane.
- A pane ID in `ctx-heavy`'s list goes to that pane.
- `turn-mode`'s label swaps async and real-time. Agentic is set by the driving agent; a click returns it to async.

## Settings

Change them in `/config`, or in `settings.json` under `pluginConfigs["<plugin>"].options`. A change reloads the plugin.

| Plugin | Setting | Default | Meaning |
|---|---|---|---|
| `cache-timer` | `handoffLeadMinutes` | 0 (off; e.g. 10 to turn it on) | Minutes before expiry that the [handoff](docs/handoff.md) runs |
| | `handoffMinTokens` | 200000 (0 = any) | Smaller sessions get no handoff: rebuilding them costs little |
| `ctx-heavy` | `show` | `both` | What each session shows after its pane: `context` (its size), `cache` (time left, from `cache-timer`) or `both` |
| | `order` | `context` | Which sessions, in what order: `context` (biggest first) or `cache` (warm caches closest to expiring first, then the rest) |
| | `expired` | `hide` | `hide` lists only sessions whose cache is still warm (or in use); `show` lists them all. Sessions without `cache-timer` are always listed |

The cache lifetime (1 hour or 5 minutes) is read from the transcript. The other plugins have no settings.

## Bonus: the status line

A plugin can't install a status line, so this one is a plain script. Three lines: directory, project, model and context; session and week usage with reset times, then cost; your Claude login and organization.

<details>
<summary>Set it up</summary>

```
mkdir -p ~/.claude && cp statusline/statusline.sh ~/.claude/statusline.sh
```

Then in `settings.json`:

```json
"statusLine": { "type": "command", "command": "bash \"${CLAUDE_CONFIG_DIR:-$HOME/.claude}/statusline.sh\"" }
```

Using a profile in `CLAUDE_CONFIG_DIR`? Copy the script into that folder instead; it reads the login from that profile's `.claude.json`. Set `STATUSLINE_TZ` (e.g. `America/Chicago`) to pin the time zone. Needs `jq`.

</details>

## Requirements

- Claude Code with plugin hooks. Plugin files live under `CLAUDE_CONFIG_DIR`, or `~/.claude` when it is unset.
- [herdr](https://herdr.dev) on `PATH`, with sessions started inside it, for everything except `cache-timer`.
- `bash` and `jq` for the needs-you queue. `herdr-jump` feeds it each finished turn and each prompt itself, so there are no hook settings to add. The queue lives in `~/.herdr-queue/`, readable by you only.
- `nc` with `-U` (macOS's own; `netcat-openbsd` on Linux) so a footer redraws its queue the moment you focus its pane. Without it, a footer refreshes on your first keystroke there instead.

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

<div align="center">

**Long sessions are where the real work is. Stop flying them blind.**

</div>
