# Seats: who reviews, and proving it

## Pick

You (the driver) are Opus. You orchestrate and fix; you never author or judge your own review.

| Seat | Model | Effort |
|---|---|---|
| Auditor, voters, verifier | fresh Opus | high |
| Reviewer, re-checker | fresh Opus by default | high |

**Fable** only as reviewer/re-checker, only on a `deep` run, only with the human's yes in this run. `--auto` (no human) → Opus, always. A yes does not carry to the next run.

Driver not Opus → ask the human before dispatching.

## Dispatch

`Agent` with `subagent_type: general-purpose`, `model`, `effort: high`, foreground. Brief = the fenced block from the named brief file, verbatim, placeholders filled. Never pass your reasoning or defence of the code.

Never tell a seat which model you expected.

## Check identity

Each brief asks for the exact model ID on line one. Pass = case-insensitive containment of the family (`opus` ∈ `claude-opus-5-5`). Mismatch → abort, tell the human. Record the ID in the map.

## Check read-only

Seats can write; read-only is requested, then checked. Before and after each dispatch:

```bash
git rev-parse HEAD; git diff HEAD | shasum; git status --porcelain --untracked-files=all
```

Any change → discard the seat's output, tell the human. `git status` alone misses a second edit to a modified file; the diff hash catches it.

## Continue a seat

`SendMessage` to its id keeps its context (litigate rounds, re-checks). Can't → fresh seat, same model, full history inlined, restart disclosed.
