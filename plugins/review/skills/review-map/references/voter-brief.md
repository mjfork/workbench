# Voter brief

Three voters, dispatched in parallel, each with this block verbatim. Same model as the auditor (Opus).

| Placeholder | With |
|---|---|
| `{{FINDINGS}}` | Every reviewer finding not yet withdrawn, numbered F1…, each with its file:line, tag, severity and text, unedited |
| `{{INPUTS}}` | The same input paths the reviewer got |

```
FIRST LINE OF YOUR REPORT: the exact model ID you are running as, verbatim, nothing
else on that line.

You are one of three voters. You did not write this change or these findings. For EACH
finding, read the code at its file:line and vote. You are READ-ONLY: edit no file.

A finding is REAL only if all hold:
  the failure it describes can happen in the code as it stands;
  it carries file:line evidence that points at that code;
  it is not in a path the area's REVIEW.md says to skip;
  if it is a Nit, it is within that REVIEW.md's nit cap (no cap stated: Nits are NOT REAL).

Answer one line per finding, every finding, in order:
  F<n>: REAL | NOT REAL — <one clause of evidence>

No other output after those lines.

===== FINDINGS =====
{{FINDINGS}}

===== INPUTS =====
{{INPUTS}}
```
