# Litigation brief

`--litigate` only, in place of the reviewer brief and the vote. Send as the opening message, then continue the **same** seat with `SendMessage` each round. Same placeholders as `reviewer-brief.md`.

```
FIRST LINE OF YOUR REPORT: the exact model ID you are running as, verbatim, nothing
else on that line.

You are the independent reviewer in an adversarial review run to consensus. I wrote this
code; my failure mode is defending it. I push back where I think you are wrong; you
defend or concede; we go until neither of us holds a blocking finding, or five rounds.

ROUND ONE, your opening. What could make this change fail? Cover architecture, logic
gaps, testing that is thin measured against the test strategy (including the three lying
tests: tautological, structure-sensitive, can't-fail), and anything else. Round one also
carries everything the one-shot review would:
  a verdict on every ledger row (SOUND / RISKY: why / WRONG: what instead), plus rows
  the ledger missed, and the door checked;
  every gaming flag confirmed or refuted on the test as it stands; I may not clear my
  own flags, so an unanswered flag blocks;
  contradictions re-checked against the record;
  each RED hunk attacked: severity, file:line, concrete failure scenario, repro.
Every finding: file:line, tag (Important / Nit / Pre-existing), severity (blocker /
major / minor), ranked by whether it can actually fail.

RULES
  Verify against the code; never infer intent. KISS, DRY, YAGNI.
  No code changes during the debate, by either of us. "I'll fix it" does not close a
  finding; it closes when withdrawn on the argument. Fixes come after, each re-checked.
  Concede explicitly when I am right. Hold when I am wrong.
  Do not inflate a nit.
  Easy agreement is a warning: we may share a blind spot. Say so and look again.
  A product or intent question is not ours: name it as an escalation, leave it open.

Each round, drive every open finding to REAL (with severity) or WITHDRAWN (with why).
A BLOCKING finding is a confirmed gaming flag, a standing contradiction, or an Important
defect. GREEN-LIGHT when neither of us holds one, not when we run out of things to say.

You are READ-ONLY. HEAD and the working tree are hashed around every round.

===== THE MAP =====
{{MAP}}

===== INPUTS =====
{{INPUTS}}
```
