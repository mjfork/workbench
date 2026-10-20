---
name: address
description: "Answer a posted review map: fix every MUST-FIX, each round re-checked by a fresh reviewer (verify, don't hunt), dispose of every other item, and post one reply that names a closed answer for each, checked by script before it posts. Escalates what only a human can decide. Use after /vet:map has posted, or when /vet:verify failed a reply. /vet:address [<pr>] [--auto]. Then /vet:verify."
---

# /vet:address

Every item on the map gets exactly one closed answer; the reply proves it. No human approves fixes; a human sees only escalations. Never merges, never edits the map.

Flags: `<pr>` (omitted → current branch's PR), `--auto` (no human: escalations post as questions and the run stops).

Read `${CLAUDE_PLUGIN_ROOT}/references/map-format.md` (ids, allowed answers, reply skeleton) and `${CLAUDE_PLUGIN_ROOT}/references/seats.md` first.

## 1. Load the map

`gh pr checkout <n>`; `git fetch origin <base>`. Working dir: `R="$(git rev-parse --absolute-git-dir)/vet/<n>"; mkdir -p "$R"`.

Newest comment by a trusted poster (`map-format.md` → "Trusted posters") whose first line is `<!-- vet-map -->` (`gh pr view <n> --json author,baseRefName,comments,commits,headRefOid`). Save it to `$R/map.md`; list items with `parseMap` (see `/vet:map` stage 4). Note `depth`: round cap is **2** light, **5** deep. A map whose Head is no longer on the PR → stop, run `/vet:map`.

## 2. Plan each item

| Item | Default |
|---|---|
| MUST-FIX (`G`, `R`, WRONG `L` rows) | Fix. A WRONG row can't be kept |
| `C` contradiction | Escalate: the human picks the winner. Never you |
| RISKY `L` row | `kept: <reason>` or fix, on the merits |
| `S` SHOULD-FIX | Fix only if cheap; else `deferred to <issue>: <reason>` or `won't fix: <reason>`. A Nit never starts a round |
| `P` pre-existing | `gh issue create`, then `filed as #<n>` |
| `E` escalation | The human's call (step 4) |
| A finding you think is wrong | Dispute it with the re-checker. Never dismiss on your own |

A reason says what the finding didn't. Product or intent questions → escalate.

## 3. Fix loop

Each round:
1. Note the starting sha. Fix the queued items, smallest change that removes the failure. Commit.
2. Hash, dispatch the re-checker with `references/recheck-brief.md`: this round's findings, `git diff <start>..HEAD`, your disputes. Seat: fresh Opus; Fable only on a `deep` map, with a human present, not `--auto`, and their yes this run. Keep each report for the reply.
3. `REMOVED` → `fixed in <sha>` (`changed in <sha>` for `L` and `C`). `RELOCATED`/`PARTIAL` → next round. `CONCEDE` → `dismissed: <the re-checker's reason>`. `HOLD` → fix it next round, or it stalemates.

Stop at all clear or the cap. Past the cap, or a dispute still held → **stalemate**: `escalated: <exactly what you and the reviewer disagree on>?`. Count rounds-to-pass.

Push every commit before drafting. A code push after the reply voids it; docs-only does not (a RED path like `SKILL.md` is never docs).

## 4. Escalations

Human present → ask each now, one question naming the item and its terminal action (DECIDE A WINNER, YOUR CALL…), and turn the answer into a closed disposition (`decided: <their call>` for an `E` item). A fix they choose → back to step 3. `--auto` → leave `escalated: <question>?`.

## 5. Draft, check, post

Write `$R/reply.md` per the reply skeleton, one block per item in map order, every re-check report fenced at the end. Write each **Detail** from the commit as you read it, not from memory. Then:

```bash
gh pr view <n> --json commits --jq '.commits[].oid' > "$R/commits.txt"
node "${CLAUDE_PLUGIN_ROOT}/scripts/check-reply.cjs" --map "$R/map.md" --reply "$R/reply.md" --commits "$R/commits.txt"
```

Post only on `OK`. A failure is a missing decision, not a wording problem: decide it, never reword a placeholder past the checker.

Human present → show the reply, ask once: *"Post this reply on #<n>?"* `--auto` → post. `gh pr comment <n> --body-file "$R/reply.md"`.

Then stop. No escalations → next is `/vet:verify`. Escalations open → the human answers, then `/vet:address` runs again. Pushing code now voids the reply.

## Red flags

| Thought | Reality |
|---|---|
| "I'll mark the rest still open" | Every item gets one closed answer or an escalation question |
| "This finding is wrong; dismiss it" | Dispute it with the re-checker. Its concession is the reason |
| "While I'm here, fix this other thing" | Verify, don't hunt. New problems are a new review |
| "Contradiction: the diff is obviously right" | The human picks the winner |
| "Round 6 will get it" | Past the cap is a stalemate. Escalate |
| "Checker flagged it; rephrase" | Rephrasing a non-answer is still a non-answer |
| "One more small fix after posting" | Voids the reply. Fix, push, rerun |
