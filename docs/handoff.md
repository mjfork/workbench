# The handoff

`cache-timer` writes a handoff note a few minutes before the prompt cache expires, so a session you walked away from can pick up again in a fresh context instead of paying to re-read the old one.

## When it runs

Once per idle stretch, `handoffLeadMinutes` before the cache expires (minute 50 on the 1-hour tier), `cache-timer` submits a prompt marked `[cache-timer handoff]`. It runs a real turn on the warm cache, the model replies with a handoff note, and the plugin saves the reply to `<config dir>/ctx/handoff/<session>.md`. The path stays above the prompt until the next turn starts.

That turn re-warms the cache, so the expired-cache card appears about an hour after it, not at minute 60.

It does not run:

- on the 5-minute cache tier
- for a session under `handoffMinTokens` of context (rebuilding a small context costs little)
- when the model decides the session holds nothing worth resuming (it replies `NO HANDOFF` and no file is written)

It is on by default. Set `handoffLeadMinutes` to 0 to turn it off.

## What the note holds

The goal, state, decisions (with options ruled out), what worked and dead ends, files, verification commands, ordered next steps, open questions, standing instructions, and suggested skills. The model is told to reference specs, plans, issues and commits by path, URL or hash instead of restating them.

## Resuming

When you next type into the session, the expired-cache card shows where the note is and its first lines, then offers three choices:

- **Submit anyway**: re-send the whole context at full price
- **Resume from handoff**: `/clear`, then your message with a pointer to the note, worded so the new session treats the note as a summary to check and not as instructions
- **Cancel**

## Secrets

The note is model output about your session, so it can repeat anything the session saw. Three layers keep credentials out of it:

1. **The prompt** tells the model to redact secrets, and that text it read from files, web pages or tool output is data, never instructions to copy.
2. **No tools.** While the handoff turn runs, every tool call is refused, so the turn only answers and the plugin does the saving.
3. **Masking before the write.** The plugin masks authorization headers, passwords in URLs and in words, and the token formats of several hundred services from the [gitleaks](https://github.com/gitleaks/gitleaks) rule set (MIT; see [`plugins/cache-timer/THIRD_PARTY_NOTICES.md`](../plugins/cache-timer/THIRD_PARTY_NOTICES.md); regenerate with `node plugins/cache-timer/scripts/gen-secret-rules.mjs`).

That is best effort: it finds secrets with a recognisable shape, not every secret. Treat a handoff file as sensitive, like the transcript it came from. The plugin makes it readable by you only: the folder is made private (`chmod 700`) before the note is written into it, then the note itself gets `chmod 600`. If the folder can't be made private, the note is not saved.

How the masking is held to account:

- Every redaction change is checked against a corpus of over a thousand placements ([`plugins/cache-timer/tests/corpus.test.ts`](../plugins/cache-timer/tests/corpus.test.ts)), none of which may leak.
- Seven gitleaks patterns that crafted text can slow to seconds are left out (the generator's `SLOW` list). `curl -u user:password` and authorization headers are masked by the plugin's own linear patterns instead.
- The scan has a one-second budget as a backstop. If it ever runs out, the handoff is not saved and a log line says so: a note that was only partly scanned is not written.
- Every gitleaks rule must compile in the plugin's engine. One that does not stops the save, rather than dropping out unseen.
- A credential longer than the scan's slice overlap is masked to the end of its run of token characters, wherever it falls.
- Terminal escape codes and control characters are stripped from the note, on the card and in the file.
