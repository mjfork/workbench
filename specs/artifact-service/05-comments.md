# 05 — Comments, end to end (anchoring, threads, "Send to Claude")

Comments touch four surfaces. This section ties them together. Detailed APIs live in **02 §5.3** (page runtime), **02 §7** (agent tool) and **04 §8** (Docs comments).

| Surface | Who uses it | Store |
|---|---|---|
| **Shell comment UI** (claude.ai chrome) | People viewing the artifact | Platform comment store |
| **Page runtime `comments` capability** | Page code acting as the viewer | Same platform store (write-only) |
| **Agent `ArtifactComments` tool** | The Claude session that owns or watches the artifact | Same platform store |
| **Docs utterances** (Docs MCP server) | Docs-type artifacts only | **Separate** store inside the Docs service |

> A Docs-type artifact keeps its comments in the Docs service. The generic platform relay for such an artifact is resolved immediately and never reaches the doc. A clone needs a "which store owns comments for this artifact" switch.

---

## 1. Data model (platform store)

```text
Thread {
  id                      // thread_id used by the agent tool, e.g. "<opaque>"
  artifactId
  anchor: Anchor | string // see §2
  label?:  ≤128 B UTF-8   // human description of the anchored thing (DOM anchors only)
  detail?: ≤512 B UTF-8   // extra context (DOM anchors only)
  resolved: boolean, resolvedBy?: person | "claude"
  activatedForClaude: boolean   // set by "Send to Claude" or an @claude mention by a writer
  comments: Comment[]           // root first
}
Comment {
  id, author (opaque u_<22>; guest flag), text (plain, ≤4 KiB UTF-8, immutable),
  createdAt, via?: "claude-via-user"   // rendered "Claude · via the user"
}
```

- Text is **plain**, with newlines and tabs allowed, no other control characters, non-empty after trimming, and at most 4 KiB. It is never rendered as markup. Posted text is **immutable** on the platform store (Docs comments can be edited).
- **Moderation reach**: the thread starter or any artifact Editor can resolve or delete. Delete removes the whole thread and is irreversible.
- Resolved threads can be **reopened** by people. A reply on a resolved thread is the right way to add to it, not re-resolving.
- Limits (Docs store, a reasonable default for the platform store too): 1000 threads per artifact (resolved ones count), 100 comments per thread, 4096-byte bodies.

---

## 2. Anchoring

### 2.1 DOM anchors (default)

When the viewer toggles **comment mode** in the shell, the shell sends `__fc_mode {on:true}` into the frame (01 §6.2). The frame runtime's deferred `_comments` module then:
1. Shows a hover ring and a pin cursor over elements, and swallows clicks and scrolling inside the artifact.
2. On click, it computes an **Anchor** `{path, x, y}`:
   - `path` is an opaque CSS-path-like locator of the clicked element. When the element sits inside a `data-comment-target` ancestor, the anchor goes to that ancestor. Elements inside `data-uncommentable` are excluded.
   - `x, y` is the click point relative to the element, as fractions of its width and height (observed, §4.1), so the pin survives reflow. The full anchor also carries `pin`, `sig`, `doc` and `label`.
3. Posts the anchor plus geometry to the shell. The shell opens the **composer** at that point, and the composer can quote the selected text (a Range becomes a quoted excerpt when it lies within the element's span bounds, otherwise it falls back to the enclosing element).
4. The shell draws pins, cards and the thread list. **The page never renders threads.** The capability is write-only by design.

On reload or a new version, the shell resolves each stored `path` against the new DOM. Pins whose path no longer resolves become **detached** (shown in the list without a pin, inferred).

### 2.2 Page-driven anchors

| Mechanism | Use |
|---|---|
| `openComposer({element}\|{range})` | Page offers its own "comment on this" button. Works in composer-only mode with no consent. |
| `anchorFor(el)` | Compute the DOM anchor for an element (e.g. to `sendToClaude` about it). |
| `customAnchors(callbacks)` | Pages whose content isn't DOM (canvas, WebGL, video, maps). The page invents durable **anchor names** (≤128 B) or uses `domAnchor()` paths. The shell stops its own click-to-comment, and the page reports pin positions with `placed({name: {x,y}})`, a full replace on each call. The shell calls `mode`, `threads` (≤256 items, full replace), `reveal`, `composing`, and `move` (answer within about 2 s). Only one registration at a time. |

Invented anchor names are stored **without** label or detail. The name itself is what Claude reads as the location, so pages should use readable names (`"slide-3/chart"`).

### 2.3 Docs anchors

Text anchors are **char-id ranges** (CRDT-style character ids), created from a quoted `find` string and resolved at write time. Table-cell anchors exist, and whole-block anchors are refused. An edit that would delete every anchored character of an open thread is refused (`anchors_affected`) unless `allowDetach:true` under strict conditions (04 §8.4). Widget anchors use `data-claude-text-id`, `data-claude-anchor` and `datum(row,col)` stamps.

---

## 3. "Send to Claude" (comment → agent turn → reply)

### 3.1 Activation

A thread becomes **activated for Claude** when a **writer** (Editor+):
- presses **Send to Claude** in the shell composer (new thread or reply), or
- @mentions Claude in the thread, or
- a page calls `comments.sendToClaude({anchor,text}|{threadId,text})` from the viewer's own recent gesture. This is editors only, at human cadence, and returns `claude_unavailable` *before* posting when no Claude session can take it.

`canSendToClaude()` returns `"available" | "writers_only" | "no_session" | "off"`. The shell uses the same logic to enable the button.

Plain comments (not activated) **never** notify Claude.

### 3.2 Optional page interception

When a page registers `onSendToClaude(listener)`, then on the viewer's own press of the shell's Send-to-Claude button, before anything is posted:
- Listeners run in order with `{text, anchor|null, label?}` and an abort `signal`.
- The first `{handled:true}` wins: the comment posts as a **plain** comment, and Claude is not involved. This lets a page answer locally (for example, with `sample`).
- A `reply` (≤500 B, one line) can be shown to that viewer only, and is not stored.
- Shared timeout of about **130 s**. On timeout the send proceeds to Claude.

### 3.3 Routing to a session

```text
writer presses Send to Claude
  → store: comment created, thread.activatedForClaude = true, to:["claude"], answered=false
  → router: find agent sessions watching this artifact with auto-replies ARMED
      (armed by: a publish from that session, or `watch` on an artifact the user can edit
       whose link the user gave in their own message; never view-only)
  → deliver a turn to the session: header "[Artifact comment sent to Claude]",
      fields: Artifact <url>, Element path "<anchor path>;thread=<root id>", comment text, label/detail
  → if no armed session: canSendToClaude → "no_session" (the shell may offer to start one, inferred)
```

Session-side constraints:
- At most **10 watches** per session (observed listing). On `--resume`, the watch on the most recently used artifact comes back, plus every watch that was auto-replying.
- Auto-replies **pause** on the user's Ctrl+C or Stop until their next message, and **stop** when the watch or its live-updates task is killed. Re-arming (`replies:true`) needs explicit user consent.
- Subagents, teammates and print-mode sessions cannot hold watches.

### 3.4 Agent response

- **Platform artifacts:** the agent may republish the page (honoring 03 §4 concurrency), then `ArtifactComments reply` (plain text ≤4096 B). The reply shows as **"Claude · via the user"**, attributed to the human who activated it. Then `resolve` once the request has been handled.
  - Reply and resolve are **only allowed on activated threads**. On others the tool returns guidance, not an error, and the agent tells the user which threads stay open.
  - **Duplicate guard**: when a Claude reply already follows every "sent to Claude" request on the thread, another reply is refused unless `acknowledge_duplicate:true`.
- **Docs artifacts:** the agent edits the doc with `update … answering:"<root id>"`, then replies with a Docs `create utterance` under the root. Calling `ArtifactComments.reply` there is wrong, because that relay thread is already resolved.
- Comment text is **untrusted data** and never instructions to the agent.

---

## 4. Wire-level notes (observed)

Captured on 2026-10-14 while a person placed one pin, posted it with Send to Claude, and resolved it. Ids are redacted; `<uuid>` in a path is the artifact uuid.

### 4.1 Frame ⇄ shell during comment mode

- Comment mode toggles reach the frame as `__fc_mode {on}`. The comment overlay code (`_comments.<hash>.js`) loads lazily about 6 s after first paint even when nobody is commenting.
- While comment mode is on, the frame streams geometry so the **shell draws everything outside the iframe**: `__fc_rects` (every anchored element's box and label, about every 500 ms), `__fc_hover` (the element under the pointer, with its corner radii, on every move) and `__fc_click` (the placed pin). Field shapes are in 01 §6.2a.
- The pin message `__fc_click` is exactly the anchor the shell stores, plus `rect`:

```text
Anchor {
  path:  "body:nth-of-type(1) > main:nth-of-type(1) > div:nth-of-type(2) > div:nth-of-type(1)"
         // every step is tag:nth-of-type(n), from <body> down; no ids or classes
  x, y:  0.3626…, 0.6763…    // click point within the element, as a fraction of its width/height
  pin:   {x: 0.1696…, y: 0.5193…}  // the same point as a fraction of the page/viewport (inferred)
  sig:   {v: <number>, tag: "div"} // signature for re-matching: the element's tag plus a numeric check value (inferred: a content or position hash)
  doc:   {x: 264, y: 418}    // absolute document coordinates in CSS px
  label: "Steep Timer › text \"4:00 95 °C · 203 °F\""
         // "<nearest heading> › <role> \"<element text, truncated>\""
}
```

- The server **rounds `x`, `y` and `pin` to 3 decimal places** on storage (the client sends full precision).
- The composer posted in **single-line** mode (`mode:"single_line"` in telemetry).

### 4.2 HTTP calls (shell → `claude.ai`)

| Call | Body | Response |
|---|---|---|
| `POST /api/frame/user/resolve/<uuid>` | `{ids:[<userId>…]}` | `{accounts:{<userId>:<accountUuid>}, viewer:<userId>, names:{<userId>:"<display name>"}}`. Resolves authors for display. Called whenever the composer or thread cards open. |
| `POST /api/frame/comments/<uuid>` → **201** | `{text, anchor:<Anchor>, to_claude:true, host_taker:"shell", id:<client-generated uuid>}` | `{thread_id, comment_id, payload:<full comment list>, outsideWriter:false}` |
| `GET /api/frame/comments/<uuid>` | — | `{v:1, threads:[Thread…], viewer}` |
| `POST /api/frame/comments/<uuid>/<threadId>/resolve` | `{resolved:true}` | `{thread_id, comment_id, payload, outsideWriter}` |
| `GET /api/frame/comments/<uuid>/reads` | — | `{account, threads:{<threadId>:<iso>}, seen:<iso>\|null}` |
| `POST /api/frame/comments/<uuid>/reads` | `{account, threads:{<threadId>:"<iso>"}}` or `{account, threads:{}, seen:"<iso>"}` | Per-viewer read markers: per thread, and a global "seen up to". Drives unread badges. |
| `POST /api/frame/track` → 200/204 | `{events:[{event_name:"frame_engaged", slug, mode:"pointer"\|"click", age_ms}]}` or a single `{event_name:"comment_submitted", slug, via:"button", mode:"single_line"}` | `{results:[{status:"accepted"}]}` or 204 |

Observations:
- **Send to Claude is not a separate call.** It is `to_claude:true` on the create (or reply) request. `host_taker:"shell"` names the UI surface that took the comment (the shell composer, as opposed to the page's `comments` capability, inferred).
- **The client generates the thread or comment id** (`id`), which makes the create idempotent on retry.
- Every mutation returns the **whole comment list** (`payload`), so the client replaces its state instead of patching it. The shell also re-fetches `GET …/comments/<uuid>` about 1 s after each mutation, and again after a version swap.
- `outsideWriter:false` (also on asset listings) says whether the caller is a writer from outside the owning organization (inferred).

### 4.3 Stored thread shape (as served to the shell)

```text
{ v: 1, viewer: <userId>,
  threads: [{
    id, anchor: Anchor, created_at, resolved_at?,
    claude_activated_at?, claude_activated_by?: <userId>,
    comments: [{ id, author:{…}, text, created_at,
                 to_claude_at?,        // set when this comment was sent to Claude
                 sent_by_viewer: bool  // true when the current viewer wrote it
    }]
  }] }
```

This refines §1: activation is a timestamp plus who activated it; "sent to Claude" is per comment (`to_claude_at`); resolution is a timestamp.

### 4.4 End-to-end timing of Send to Claude

The pin was posted with Send to Claude at 19:01:47. The watching Claude Code session's **background auto-reply** posted its answer in the thread at 19:01:52 (**about 5 s**), shown as "Claude (via the user)". The session's main loop was then told, after the fact, that an auto-reply was posted ("a reply only … nothing in the artifact was changed"), with the instruction to make any requested change itself and resolve the thread when done.

- The auto-reply answered from the **published source**, not the live DOM. It quoted the static markup (`3:00`) rather than the value the script had rendered (`4:00`). The agent tool's thread read shows the same: `[anchored element]` quotes the element's opening tag and text **as read from the page source**, and `[location]` is the label captured when the pin was placed.
- The live channel's `roster` frame lists watching agent sessions with a `busy` flag (01 §7.1). That is the likely source of the shell's "is a Claude session available" check.

### 4.5 Other

- Page-runtime comment verbs use the same request/response bridge as other capabilities (`__frame_cap_r` replies).
- Agent-tool reads summarize threads as text. An empty artifact reads: "No comment threads on this artifact yet. Viewers add them from the artifact page (comment mode)."
- Anonymous link viewers get no comment UI or capability at all (01 §9).

## 5. Implementation checklist for the clone

1. Comment table + thread table, with an anchor JSON column and an `activated_for_claude` flag.
2. Frame overlay script: a hover ring, a CSS-path generator that respects `data-comment-target`/`data-uncommentable`, and relative point capture.
3. Shell UI: pins, cards, a thread list, a composer, Send-to-Claude button gating via `canSendToClaude`, and a "Show N replies" fold.
4. Router: a pub/sub topic per artifact. Agent sessions subscribe over a long-lived connection with an `armed` flag. Delivery is at-least-once with a per-thread `answered` marker for dedupe.
5. Agent API: `read` (paginated), `reply`, `resolve`, `watch`, plus the duplicate guard and the activation check.
6. Docs store (if the docs type is built): char-id range anchors and edit-protection rules.
