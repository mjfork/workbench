<div align="center">

# workbench

**Instruments for long Claude Code sessions.**

Know how full the context is, what filled it, when the cache dies, and which of your panes is waiting on you, without leaving the one you're in.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

</div>

```
   cache 42m  herdr w8Q:p3  ⚑ 2  w6N:p7  w8R   ← cache-timer · herdr-jump: this pane, who is waiting on you
async  w6A:p1 704k  w8N:p2 412k  w8Q:p3 233k   ← turn-mode · ctx-heavy: your heaviest sessions
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

1. Leave a big session idle for an hour. Before the cache expires, `cache-timer` writes a handoff note. Come back, type, and pick **Resume from handoff**.
2. Hover the bar's biggest color. That's what to stop reading into context.
3. End a turn in another pane with a `## ⚑ Needs you` section. Watch `⚑ 1` appear here, then click it.

That's the whole idea. If those three don't help you, the rest won't either.

## Why

Long sessions fail in boring, expensive ways. Each plugin fixes one.

### 1. The cache expires and you pay for it

A cached prompt is billed at a tenth of the input price. After an hour idle the cache is gone, and your next "ok, continue" re-sends 600k tokens at full price. You find out on the bill.

**`cache-timer`** counts the cache down in the footer (yellow in the last quarter, red once expired). It stops a prompt that would re-send an expired cache and asks first. And just before expiry, it has the model write a [handoff note](docs/handoff.md), so you can resume in a fresh context for a fraction of the cost.

### 2. You can't see what's filling the context

"Context 72%" says nothing about why. Usually it's one file read four times, or a test log nobody needed.

**`ctx-bar`** draws the context window as a bar colored by what put each token there: the system prompt and tools, the conversation, shell output, file reads, subagents, MCP tools, edits. Hover a color for its biggest chunks. `/ctxbar` gives the full breakdown.

### 3. Something is waiting on you, somewhere

With a dozen sessions across workspaces, one of them has been sitting on a question for twenty minutes, and you're in another pane.

**`herdr-jump`** keeps a queue of every pane that ended its turn with a `## ⚑ Needs you` section or is stuck on a permission dialog. `⚑ N` in the footer, one click to go there, `/needs-me-next` to work through them, `/jump` to go anywhere by name, `/jump-back` to return.

**`ctx-heavy`** lists your heaviest sessions anywhere in herdr, so the one about to compact isn't a surprise.

### 4. Turns end the wrong way

Sometimes you want a summary and a clear ask. Sometimes you're watching and want it to just stop. Sometimes another agent is driving and wants one status line.

**`turn-mode`** is a footer toggle: async, real-time or agentic. In agentic mode, the session's asks go to its driver pane instead of to you.

## Plugins

| Plugin | What it does | Needs |
|---|---|---|
| `cockpit` | Installs the five below. No code of its own | herdr, for four of them |
| `cache-timer` | Cache countdown, expired-cache confirm card, [handoff note](docs/handoff.md) | nothing |
| `ctx-bar` | Context bar by tool; hover cards; `/ctxbar` | herdr, `ctx-heavy` |
| `ctx-heavy` | Heaviest sessions across herdr; click to go | herdr, `herdr-jump`; shows sessions that run `ctx-bar` |
| `herdr-jump` | Pane label; needs-you queue (`⚑ N`, `/needs-me`, `/needs-me-next`); `/jump`, `/jump-back` | herdr, `bash`, `jq` |
| `turn-mode` | How a turn ends: async, real-time or agentic | herdr, `ctx-bar` |

A plugin installs what it needs. `turn-mode` → `ctx-bar` → `ctx-heavy` → `herdr-jump`, so installing any one brings the ones after it. That chain also sets the order they draw in, which is what lines the footer up on the right.

## Settings

Change them in `/config`, or in `settings.json` under `pluginConfigs["<plugin>"].options`. A change reloads the plugin.

| Plugin | Setting | Default | Meaning |
|---|---|---|---|
| `cache-timer` | `handoffLeadMinutes` | 5 (0 = off) | Minutes before expiry that the [handoff](docs/handoff.md) runs |
| | `handoffMinTokens` | 200000 (0 = any) | Smaller sessions get no handoff: rebuilding them costs little |

The cache lifetime (1 hour or 5 minutes) is read from the transcript. The other plugins have no settings.

## Bonus: the status line

A plugin can't install a status line, so this one is a plain script. Three lines: directory, project, model and context; cost and session/week usage with reset times; `user@host` and your Claude login.

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
