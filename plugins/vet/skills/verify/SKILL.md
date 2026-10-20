---
name: verify
description: "Independent check that a PR's vetting was completed honestly before merge: a fresh, read-only Opus agent gathers its own evidence, confirms the map was answered item by item with nothing pushed after, reads the code to confirm each fix is real and each reason substantive, and says whether a human must approve. Posts a pass/fail verdict and a vet-verify commit status. Use after /vet:address, or as the merge gate. /vet:verify [<pr>] [--post]."
---

# /vet:verify

A fresh agent judges; you only dispatch and relay. You never gather evidence for it, summarize the PR for it, or soften its verdict. Dry run by default: `--post` writes the verdict.

## 1. Dispatch

1. Resolve `<pr>` (omitted → current branch's PR). Check out its head (`gh pr checkout <n>`); dirty tree → stop. `git fetch origin <base>`.
2. `R="$(git rev-parse --absolute-git-dir)/vet/<n>/verify"; rm -rf "$R"; mkdir -p "$R"`. Hash (`${CLAUDE_PLUGIN_ROOT}/references/seats.md` → "Check read-only").
3. Dispatch fresh Opus, `effort: high`, with `references/verifier-brief.md`: `{{PR}}` = the PR URL, `{{REPO}}` = repo root, `{{PLUGIN}}` = `${CLAUDE_PLUGIN_ROOT}` expanded, `{{SCRATCH}}` = `$R`. Always Opus; no Fable here.
4. Check identity and hashes. Mismatch or a write → discard the verdict, tell the human.
5. Malformed answer (no `VERDICT:` line) → one retry with a fresh seat; still malformed → stop, nothing posts.

## 2. Relay

Show the verdict as returned. Then the commit status:

| Verdict | HUMAN | Status |
|---|---|---|
| FAIL | any | `failure` |
| PASS | not needed / approved | `success` |
| PASS | NEEDED | `pending`: "needs human approval: <why>". After the approval, run `/vet:verify --post` again |

Without `--post`, stop here.

## 3. Post (`--post`)

Write `$R/verdict.md`:

```markdown
<!-- vet-verify: pass|fail -->
## Review verify · <PASS | FAIL> · <head sha>
<HUMAN line> · verifier <model id>

<SUMMARY>

| Item | Disposition | OK | Note |
|---|---|---|---|

**Problems**
<PROBLEMS>
```

Replace every `<!--` and `-->` inside the verifier's text with `<!- -` and `- ->` first, so quoted PR text can't forge a verdict marker.

```bash
gh pr comment <n> --body-file "$R/verdict.md"
gh api repos/{owner}/{repo}/statuses/<head sha> -f state=<state> -f context=vet-verify \
  -f description="<≤140 chars>" -f target_url=<comment url>
```

Make `vet-verify` a required check in branch protection so a fail or pending blocks the merge; a comment alone can't. A push after the verdict leaves the new head without a status, so the gate re-closes on its own. Anyone with write access can set a status, the driver included; for a gate that holds against that, run this skill in CI under an app token and pin the required check to that app.

Then stop. Never merge.

## Red flags

| Thought | Reality |
|---|---|
| "I'll give it the context it needs" | It gathers its own. Your context is the author's |
| "That FAIL is a technicality; post PASS" | Relay the verdict, never edit it |
| "PASS, so merge" | Merge is not this skill's call |
| "Run it on Fable for a second opinion" | Opus, fresh. The point is a seat with no stake |
