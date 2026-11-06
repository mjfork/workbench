---
name: map
description: "Vet a change by its decisions, not its lines: a fresh Opus auditor maps the silent decisions, blast radius, door, contradictions and test gaming; an independent reviewer verdicts every row (or litigates to consensus); three voters cut the noise; one review map posts on the PR. Use after code exists, before anyone reads it, especially code an agent wrote. /vet:map [<pr>] [--litigate] [--auto] [--reviewer fable]. Then /vet:address, then /vet:verify."
---

# /vet:map

The builder never grades itself. You (Opus, the driver) orchestrate and merge mechanically; a fresh auditor writes the map, an independent reviewer judges it, voters filter it. Code is read where a finding points. Ends at a posted map. Never fixes, never merges.

Flags (no others):
- `<pr>`: PR number or URL (GitHub or Azure DevOps). Omitted → the current branch's PR; none → local diff (say so on line one; nothing posts).
- `--litigate`: debate to consensus instead of one-shot review + vote. Spend it on payments, migrations, auth, load-bearing refactors.
- `--auto`: no human in the loop. Opus seats only; post without asking.
- `--reviewer fable`: the human's yes to Fable this run (deep only).

Seats, dispatch, identity and read-only checks: `${CLAUDE_PLUGIN_ROOT}/references/seats.md`. Map layout and ids: `${CLAUDE_PLUGIN_ROOT}/references/map-format.md`. Read both before stage 1.

## 0. Inputs and depth

1. `F="${CLAUDE_PLUGIN_ROOT}/scripts/forge.cjs"`: the only way vet talks to the code host (GitHub or Azure DevOps, picked from `origin`). Never call a host CLI yourself. `node "$F" pr-view <pr>` prints JSON: `number`, `url`, `title`, `body`, `headRefOid`, `baseRefName`, `author.login`, `closingIssues`, `comments`. Check out the head (`node "$F" pr-checkout <n>`); dirty tree → stop. `git fetch origin <base>`. Empty diff → stop.
2. Working dir, outside the tree so nothing gets committed: `R="$(git rev-parse --absolute-git-dir)/vet/<n>"; mkdir -p "$R"`. Write `$R/diff.patch` (`git diff origin/<base>...HEAD`), `$R/files.txt`.
3. **Ticket, verbatim**: the PR's `closingIssues` (`node "$F" issue-view <number>`), else an issue number or URL in the PR body (same command); a key the adapter can't read (e.g. a Jira key) → quote it from the PR body as-is and say it was not fetched. None → write "no ticket resolved". Never paraphrase from memory.
4. **Record**: ADRs (`docs/adr/`, `docs/decisions/`, `.factory/adrs/`, `*ADR*.md`); none → `CLAUDE.md` and convention docs are the record. Test strategy: its ADR or `CLAUDE.md` section.
5. **`REVIEW.md`**: the nearest one above each changed file. **Artifact page**: a link in the PR body or comments, else none.
6. **Depth, by script, never by you**: `node "${CLAUDE_PLUGIN_ROOT}/scripts/risk.cjs" --base origin/<base> > "$R/risk.json"`. `deep` = any RED file or >1,000 changed lines. RED globs come from `.vet/red-paths` on the base branch, else the defaults.
7. **Forks dump**, only if this session wrote the code: every fork the ticket was silent on, over-inclusively, including paths weighed and rejected that leave no trace. Otherwise write "No forks dump". It feeds the auditor; it is not the ledger.
8. **Reviewer seat**: Opus. `deep`, a human present, not `--auto`, no `--reviewer` → ask once: *"Deep run. Use Fable as reviewer?"*

## 1. Auditor writes the map

Hash, dispatch the auditor with `references/auditor-brief.md`, check identity and hashes. It returns: ledger, blast radius, door, contradictions, gaming first pass.

## 2. Independent review

Default: dispatch the reviewer with `references/reviewer-brief.md`. Every row verdicted, missed rows added, door checked, contradictions re-checked, every flag confirmed or refuted, RED hunks attacked if `deep`.

`--litigate`: `references/litigate-brief.md`, then continue the same seat per round.
- One message per round covering every open finding.
- Concede fast where it's right; push back where it's wrong. You defend your own work; resist that.
- No code changes during the debate. Fixes wait for `/vet:address`.
- Easy agreement is a shared blind spot. Challenge a clean round.
- Product or intent questions → escalations, not guesses.
- Cap 5 rounds (the opening is 1). Stop at green-light or the cap; at the cap, state exactly what is disputed. Never claim a consensus you lack.

## 3. Vote, then reconcile

Default only (litigation is the stronger filter; skip the vote). Dispatch three voters in parallel with `references/voter-brief.md`, every finding not withdrawn. Quorum: a finding on a RED file posts if **any one** votes REAL; elsewhere **2 of 3**. Ledger verdicts and gaming confirmations are not voted.

Reconcile into the map per `map-format.md`. The mapping is the whole of your judgment:

| Reviewer output | Goes to |
|---|---|
| Gaming / lying test confirmed | `G`, MUST-FIX |
| Gaming refuted | Not posted, with the reason |
| Contradiction standing | `C`, MUST-FIX, and Escalations (DECIDE A WINNER) |
| Ledger row WRONG | `L` row, MUST-FIX |
| Ledger row RISKY | `L` row, open |
| Important, passed vote | `R`, MUST-FIX |
| Nit or lower-ranked, passed vote | `S`, SHOULD-FIX or WON'T-FIX by the reviewer's rank |
| Pre-existing, passed vote | `P`; never blocks |
| Failed vote | Not posted |
| Litigation stalemate | `E`, YOUR CALL |
| Fits none | `E`; say so |

Never re-rank, soften, drop or decide a finding. Disagree → that is `--litigate`'s job, on the record.

Escalations, in this order: unclear gaming (BLOCK) · contradictions (DECIDE A WINNER) · stalemates (YOUR CALL) · RED hunks (READ LINE-BY-LINE) · merge on high blast or one-way door (APPROVE OR NOT, an `E` item). Then decisions to promote: load-bearing only (hard to reverse, built on, or RED), each with `scope:` (BLESS OR DROP; doesn't gate).

## 4. Post, then stop

Write `$R/map.md` and `$R/seats-<k>.md` (seat reports, ≤60,000 characters each; see map-format.md → "Seat reports"). Check the map parses: `node -e 'console.log(require(process.argv[1]).parseMap(require("fs").readFileSync(process.argv[2],"utf8")))' "${CLAUDE_PLUGIN_ROOT}/scripts/lib.cjs" "$R/map.md"` lists every item you meant, with `head`, `door`, `depth`.

Human present → show the map and ask once: *"Post this map on #<n>?"* `--auto` → post.

1. `node "$F" pr-comment <n> "$R/seats-1.md"` (then any further parts); it prints the comment URL: put the first in the map's Seat reports link. Then `node "$F" pr-comment <n> "$R/map.md"`.
2. Minimize earlier maps and seat comments as outdated: from a fresh `node "$F" pr-view <n>`, every comment with `trusted` true, `isMinimized` false, not one you just posted, whose first line is `<!-- vet-map -->` or starts `<!-- vet-map-seats`: `node "$F" pr-minimize <n> <comment id>`. Never edit a posted map.
3. Any RED file or a one-way door → `node "$F" pr-label <n> needs-human-review` (before the body edit, so a rejected body can't skip it).
4. PR body: replace or append the block between `<!-- vet-header -->` and `<!-- /vet-header -->` with the map's blast radius, door (the auditor's words) and undo path. Write the whole new body to `$R/body.md`, then `node "$F" pr-edit-body <n> "$R/body.md"`. If the host's description limit rejects it (Azure DevOps: 4,000 characters for the whole body), the command fails with the reason: tell the author to shorten the header or the body; never drop it silently, and don't re-post the map.

Local diff → nothing posts; say so. Then stop. Next: `/vet:address`.

## Red flags

| Thought | Reality |
|---|---|
| "I know this change; I'll write the map" | The map exists to route around your rationalization |
| "That flag is obviously fine; drop it" | Dropping is softening. Reconcile is mechanical |
| "This diff is small; call it light" | The script sets depth |
| "I'll fix it mid-debate" | Fixes wait for /vet:address |
| "We agree, so it's sound" | Same family, same blind spot |
| "Tidy the old map instead of posting a new one" | Never edit a posted map; /vet:verify fails an edited one |
