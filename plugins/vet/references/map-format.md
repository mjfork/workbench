# Review map and reply format

One source for `/vet:map` (writes the map), `/vet:address` (answers it) and `/vet:verify` (judges both). `scripts/lib.cjs` parses the map; `scripts/check-reply.cjs` checks the reply. Change this file and those together.

## Item ids

`<PREFIX><n>[suffix]`: `G1`, `C2`, `C2a`. Never `C-A`, `G 1`, `#1`. Number each prefix from 1 in map order; a finding whose parts close differently splits `C2a`, `C2b`.

| Prefix | Kind | Is an item when | Answers allowed |
|---|---|---|---|
| `L` | row | ledger row verdicted RISKY or WRONG | `changed in <sha>` · `kept: <reason>` (RISKY only) · `dismissed: <concession>` · `escalated: <question>?` |
| `G` | gaming | confirmed gaming or lying test | `fixed in <sha>` · `dismissed: <reason>` · `escalated: …?` |
| `C` | contradiction | standing after re-check | `changed in <sha>` (record wins) · `record updated in <sha>` (diff wins) · `ticket now says: "<quote>"` · `dismissed: <reason>` · `escalated: …?` |
| `R` | red | `Important` defect that passed the vote | `fixed in <sha>` · `dismissed: <reason>` · `escalated: …?` |
| `S` | other | SHOULD-FIX or WON'T-FIX | `fixed in <sha>` · `deferred to <#123 \| ABC-123>: <reason>` · `won't fix: <reason>` · `dismissed: <concession>` · `escalated: …?` |
| `P` | preexisting | a bug this PR didn't introduce | `filed as <#123 \| ABC-123>` · `fixed in <sha>` |
| `E` | escalation | a human call that is no other item (stalemate, unplaced finding, merge approval) | `decided: <the human's call>` · `escalated: …?` |

- An item is a `### <id> · <title>` block, or (`L` only) a ledger table row whose verdict cell starts `RISKY` or `WRONG`.
- SOUND rows, withdrawn findings and findings that failed the vote get no id.
- Fix buckets name items by id only; each item has one heading.
- A sha is a commit on the PR. A reason says what the finding didn't. An escalation is a question the human can answer as written.
- `dismissed` on `G`, `R`, `L`, `S` is only the re-checker's concession; the reply carries the re-check reports that show it.
- Decisions to promote don't gate the PR: the human blesses or drops them.

## Map skeleton

````markdown
<!-- vet-map -->
## Review map · <pr-ref> · <YYYY-MM-DD>

**Head:** <sha>
**Blast radius:** <high | medium | low> (<why>) · **Door:** <one-way | two-way> (<why, and how to undo>) · **Depth:** <light | deep>
Auditor <model id> · Reviewer <model id> · Voters <ids> · <one-shot | litigate, N rounds, green-light | stalemate>
Evidence: <artifact page link | none> · Seat reports: <comment link> · <Supersedes <comment link> | First map on this PR>

## 1. Decisions to check

| # | Decision | Guessed (alternatives) | Why | Verdict | Resolution |
|---|---|---|---|---|---|
| L3 | <decision> | <alternatives> | <why> | WRONG: <what it would do instead> | MUST-FIX |
| L1 | <decision> | <alternatives> | <why> | RISKY: <why fragile> | open |

<details><summary>SOUND (<n>)</summary>

| # | Decision | Why | Verdict |
|---|---|---|---|
| L2 | <decision> | <why> | SOUND |

</details>

## 2. Where to concentrate

| File | Tier | Why |
|---|---|---|
| `<path>` | RED | <what it can break>. Read every line |

## 3. Resolve before merge

### G1 · <gaming or lying-test title>
**Where:** `<file:line>` · **Tag:** Important
**Finding:** <what the test now proves; what it no longer catches; which lying test, shown>
**Reviewer:** confirmed. <reason>

### C1 · <contradiction title>
**Record:** <quote> (`<source>`)
**Diff:** <quote> (`<file:line>`)
**Reviewer:** standing. <reason>

## 4. Independent review

### R1 · <title>
**Where:** `<file:line>` · **Tag:** Important · **Severity:** <blocker | major | minor> · **Votes:** <n>/3
**Failure scenario:** <inputs or state, and what goes wrong>
**Repro:** <steps, or link on the artifact page>

### S1 · <title>
**Bucket:** <SHOULD-FIX | WON'T-FIX> · **Where:** `<file:line>` · **Tag:** <Important | Nit> · **Votes:** <n>/3
**Finding:** <one or two sentences>

### P1 · <title>
**Where:** `<file:line>` · **Tag:** Pre-existing
**Finding:** <one or two sentences>

## 5. Escalations

<in order: BLOCK, DECIDE A WINNER, YOUR CALL, READ LINE-BY-LINE, APPROVE OR NOT. Items above by id with their terminal action; anything else as an E item. Or "None">

- C1: DECIDE A WINNER

### E1 · <the call>
**Call:** <exactly what the human must decide, and why>. <terminal action>

## Fix buckets

- **MUST-FIX:** <ids>
- **SHOULD-FIX:** <ids>
- **WON'T-FIX:** <ids, or none>

## Not posted

<withdrawn flags and findings that failed the vote: one bullet each, the reason, no ids. Or "None">

## Decisions to promote

<load-bearing decisions only (hard to reverse, built on, or RED), each with a one-line why and the `scope:` paths that send a later diff back through review. BLESS OR DROP. Or "None">
````

Empty sections stay, with "None". Wording comes from the seats: shortened, never softened.

## Trusted posters

Maps, seat reports and replies count only from logins in `.vet/posters` (one per line, read from the base branch), else from comments whose `authorAssociation` is `OWNER`, `MEMBER` or `COLLABORATOR`. A CI app that runs these skills goes in `.vet/posters`. `.vet/**` is RED, so changing the list needs a human. The PR author is usually trusted by default, so their account (or an agent on it) can still post a fake map; to close that, post from a bot or CI account and list only it.

## Seat reports

Posted as their own comment(s) right after the map, first line `<!-- vet-map-seats <head sha> -->`, each seat's report verbatim (auditor, reviewer or litigation rounds, voters), each in its own ````text fence. Split across comments at 60,000 characters; GitHub caps a comment at 65,536. The map links the first. They let `/vet:verify` see that the map came from the seats and wasn't softened.

## Reply skeleton

````markdown
<!-- vet-address -->
Response to the review map posted <date>. All fixes pushed.
**Head:** <sha>
**Rounds-to-pass:** <n>

### G1 · <title as the map names it>
**Disposition:** fixed in 93e9048
**Detail:** <what changed, read from the commit; or the reason in full>

<details><summary>Re-check reports</summary>

<each round's re-check report verbatim, in its own ````text fence>

</details>
````

One block per item, map order. Every `fixed`/`changed` sha and the Head are pushed before the reply posts.
