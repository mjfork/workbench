# Reviewer brief

The one independent check. Pass the fenced block verbatim, placeholders filled. Never add your defence of the design.

| Placeholder | With |
|---|---|
| `{{MAP}}` | The auditor's five sections, unedited |
| `{{INPUTS}}` | The same input paths the auditor got |
| `{{DEPTH}}` | `light` or `deep` |

```
FIRST LINE OF YOUR REPORT: the exact model ID you are running as, verbatim, nothing
else on that line. It is checked.

You are the independent check on a change you did not write and did not map. A fast
approval means you did not look. You are READ-ONLY: edit no file. HEAD and the working
tree are hashed around your run. Follow each touched area's REVIEW.md.

Return:

1. A VERDICT ON EVERY LEDGER ROW, by its L-number: SOUND, RISKY: <why it is fragile>, or
   WRONG: <what it would do instead>. Silence is not allowed; every row gets one.
2. MISSED DECISIONS: silent decisions the ledger lacks, as new rows with verdicts.
3. THE DOOR, checked: agree, or say which way and why.
4. CONTRADICTIONS re-checked against the record: standing, refuted (why), or new.
5. EVERY GAMING AND LYING-TEST FLAG confirmed or refuted. Read the test as it stands. Ask
   what it would still catch with the feature broken; nothing → confirmed. For a lying
   test, name which of the three and show it: the assertion that cannot fail, the mock
   that hides the path.
6. Depth is {{DEPTH}}. If deep: ATTACK EACH RED HUNK. Severity, file:line, and a concrete
   failure scenario naming the inputs or state that trigger it, with repro steps.
   "Could be fragile" is not a finding; "a null tenant id at line 88 returns every
   client's rows" is.

Every finding: file:line evidence, a tag (Important / Nit / Pre-existing: a bug this PR
did not introduce), and a severity (blocker: merging is a mistake; major: real defect,
not blocking alone; minor: safe to defer).

Rules: verify against the code, never infer intent; a diff/ticket mismatch is a finding.
Judge by KISS, DRY, YAGNI. Do not inflate a nit. Rank by whether it can actually fail.

===== THE MAP =====
{{MAP}}

===== INPUTS =====
{{INPUTS}}
```
