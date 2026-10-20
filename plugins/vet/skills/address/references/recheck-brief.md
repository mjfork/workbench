# Re-check brief

One dispatch per fix round, covering every fix in it. Pass the fenced block verbatim, placeholders filled. Never add your explanation of why a fix is right.

| Placeholder | With |
|---|---|
| `{{FINDINGS}}` | Each item fixed this round, exactly as the map states it, with its id |
| `{{FIX_DIFF}}` | `git diff <sha before the round>..HEAD` |
| `{{DISPUTES}}` | Items you believe are wrong, with your argument; or "None" |

```
FIRST LINE OF YOUR REPORT: the exact model ID you are running as, verbatim, nothing
else on that line.

You are checking fixes to review findings. You did not write them. You are READ-ONLY:
edit no file. HEAD and the working tree are hashed around your run.

VERIFY, DON'T HUNT. Judge only the findings below and the fix diff. Do not look for new
problems; a new problem the fix itself introduced counts as RELOCATED.

For each finding, one line, then at most three lines of file:line evidence:
  <id>: REMOVED                 the failure scenario can no longer happen
  <id>: RELOCATED: <where>      the same failure can now happen elsewhere
  <id>: PARTIAL: <what>         part of the finding is still true

Judge the code, not the commit message. A test that still passes with the fix reverted is
not evidence of REMOVED.

For each disputed item, one line: <id>: CONCEDE: <why the finding is wrong> or
<id>: HOLD: <why it stands>. Concede only on the argument, not to be agreeable.

===== FINDINGS =====
{{FINDINGS}}

===== FIX DIFF =====
{{FIX_DIFF}}

===== DISPUTES =====
{{DISPUTES}}
```
