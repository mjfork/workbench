---
name: lets-compact
description: "Write the best compaction for this session given what you'll do next: /lets-compact <what's next>. Returns one ready-to-run /compact line with focus instructions (or /clear when nothing here is needed next) for you to run yourself."
argument-hint: "<what you'll do next>"
disable-model-invocation: true
---

# Let's compact

Next step, in the person's words: $ARGUMENTS

If that is empty, take the next step from the last few turns and say your guess in the closing line. Don't ask.

## 1. Compact or clear

- **`/clear`** when the next step needs nothing from this conversation that isn't already in files, git or memory (another
  repo, an unrelated task). It is free; `/compact` re-reads the whole context once to summarize it. Never `/clear` on a
  guessed next step.
- **`/compact <instructions>`** otherwise.

Size: `tokens` in `${CLAUDE_CONFIG_DIR:-$HOME/.claude}/ctx/$HERDR_PANE_ID.json`, when it exists.

## 2. Write the instructions

Only what the next step needs from this conversation:

- **Next:** the goal, in the person's words.
- **Decided:** choices already made and why, so they aren't reopened.
- **Verbatim:** paths, branches, commit SHAs, PR and ticket ids, URLs, commands that worked, error text still open.
- **State:** done, in progress, not started.
- **Preferences:** corrections and preferences the person gave this session.
- **Dead ends:** one line each, only for ones the next step might retry ("tried X: fails because Y").

Leave out finished work the next step doesn't touch, tool output, and anything CLAUDE.md, memory or a file already
holds: name the file instead ("results: COMPARE.md"). One line, as short as covers it, in the form
`/compact Next: … Keep: … Verbatim: … Drop: …`.

## 3. Hand it over

Reply with the command in a code block, then one line: size, and why compact rather than clear (or the reverse).
Nothing else. Don't run it, and don't type it into their prompt: they read it, edit it if they want, and run it themselves.
