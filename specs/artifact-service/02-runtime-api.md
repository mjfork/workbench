# 02 — Page Runtime API (`window.claude`)

Clean-room behavioral spec of the in-page runtime that a published artifact
page talks to. Derived from the platform's published type definitions for
runtime contract **0.2.76**, the authoring guidance that ships with them, and
the agent-side tool contracts (Artifact / ArtifactData / ArtifactComments).
Everything here is restated; names of identifiers, methods, error codes and
numeric limits are reproduced because they *are* the interface.

Conventions:
- `T?` = optional member. `Promise<T>` resolves T, rejects with the
  capability's error object `{code, message, ...}` unless stated otherwise.
- "Shell" = the host app (claude.ai web, desktop, mobile) that frames the
  page. "Frame" / "page" = the artifact document running in a sandboxed
  iframe on its own origin. "Control plane" = the server storing versions,
  manifests, sharing.
- Levels: `view < interact < admin < owner` (see §3).

---

## 1. Architecture of the runtime surface

```
 ┌──────────────── shell (claude.ai) ────────────────┐
 │ sharing/ACL, consent dialogs, comment UI, chat    │
 │   ▲ postMessage bridge (RPC + events)             │
 │ ┌─┴──────────── sandboxed iframe ───────────────┐ │
 │ │ artifact origin (per-artifact host)           │ │
 │ │ window.claude = { use }   (injected pre-script)│ │
 │ │ capability modules loaded lazily on use()     │ │
 │ └───────────────────────────────────────────────┘ │
 └───────────────────────────────────────────────────┘
```

- The page never holds credentials. Every privileged action is an RPC to the
  shell, which performs it with the viewer's own session and stamps
  attribution server-side.
- Capability code is versioned as a "runtime contract" (semver string, e.g.
  `0.2.76`), pinned per artifact (§2.4).
- A distinct, older "chat artifact" runtime exposes a flat `window.claude`
  with no `use()`; it is out of scope and must not be conflated.

### 1.1 Serving contexts

| Context | `window.claude` | `use(x)` result |
|---|---|---|
| Framed inside a Claude viewer (normal) | present before any page script | namespace or `null` per grant |
| Served top-level by the platform on the artifact's own host | present (only `use`) | currently `null` for all, except `mcp` may resolve when the platform lets the artifact act as the signed-in viewer (with extra top-level error codes, §5.8) |
| Any other copy (saved file, other host) | absent | n/a |
| Framed by a host that never answers | present | `null` after **10 s** |

---

## 2. Loader, declaration, and versioning

### 2.1 `claude.use(name)`

```ts
interface Claude { use<K extends CapabilityName>(name: K): Promise<NS[K] | null> }
interface Window { claude: Claude }
```

Semantics:
- Answers only "can this view run the capability's code?". Never prompts.
  Consent, rate limits, and policy refusals surface on the first *call*.
- `null` for: not served in this view, not granted at init, module failed to
  load, unknown name. Causes are deliberately indistinguishable.
- Resolution is always asynchronous: never during the page script's first
  synchronous run; unordered relative to `DOMContentLoaded`.
- For a served capability the promise is memoized (same promise object each
  call). Unserved names resolve `null` with no stable identity.
- Resolved namespace is a frozen, platform-owned object: assignment,
  `defineProperty`, or member replacement throws or silently no-ops.
- `window.claude` exposes **only** `use`. No `window.claude.db`, `.room`,
  `.artifact`, `.self` is promised (some legacy pages had `.self`).
- Capability registry pattern: each capability's contract augments a
  `CapabilityMap` interface by declaration merging.

Capability names for this contract: `artifact`, `assets`, `comments`, `db`,
`downloads`, `files`, `mcp`, `room`, `sample`, `self` (alias), `user`,
plus the built-in, never-declared `permissions`.

### 2.2 Declaration (publish-time manifest)

Declared by the publisher on the publish call as `capabilities: {name: config}`.

| Gesture | Meaning |
|---|---|
| field omitted on a republish | keep stored declaration unchanged (and the stored contract pin) |
| `{}` | explicit clear-all |
| non-empty object | full-set replace: anything not restated is revoked |

Per-capability config shapes (complete list of keys observed):

| Capability | Config | Notes |
|---|---|---|
| `artifact` / `self` | `{}` | |
| `assets` | `{}` or `{upload: "interact"}` | `upload: "admin"` ≡ omitted; any other value refused at publish |
| `comments` | `{}` (full) / `{composer_only: true}`; either + `customAnchors: true` | publish can be refused with `capabilities.comments: unavailable` when customAnchors not offered |
| `db` | `{}` or `{rules: Rule[]}` | ≤64 rules; `{}` restores defaults |
| `downloads` | `true` (boolean) | |
| `files` | `{project: "chan_..."}` | only project members may publish this |
| `mcp` | `{servers: [{server, tools: string[]}]}` | `tools` must be non-empty; `server` = connector display name or `host:<name>`; empty/omitted `tools` refused; declaring a non-allowlisted built-in app server refused |
| `room` | `{}` or `{topics: {<topic>: "interact"}}` | ≤16 exact-match topics |
| `sample` | `{}` or `{images: true}` | |
| `user` | `{}` or `{scopes: ["profile"]}` or `{scopes: ["profile","email"]}` | |
| `permissions` | never declared | built in |

Side effects of declaration on sharing: an `mcp` manifest is a
viewer-consented grant that **bars public link sharing** of the artifact.

### 2.3 `window.claude.hot` (live-reload state handoff)

Separate from `use()`; not a capability. Present only inside a viewer.
- `claude.hot.snapshot(fn)` — register a function producing serializable state
  to carry across a republish-driven reload.
- `claude.hot.ready(start)` — boot callback receiving the carried data; pages
  fall back to `start(claude.hot?.data ?? {})` when `ready` is absent.
- `claude.hot.data` — the carried object.
- Republishes are delivered to open viewers "at their next quiet moment".

### 2.4 Contract versioning

- Every artifact stores a runtime contract version (e.g. `0.2.76`).
- Publish parameter `contract`: omitted = keep current; `"latest"` = upgrade;
  exact `MAJOR.MINOR.PATCH` = pin or roll back. Grammar accepted:
  `^(0|[1-9]\d{0,3})\.(0|[1-9]\d{0,4})\.(0|[1-9]\d{0,5})$`.
- Moving the contract is a deliberate act, never a side effect of an edit.
- Older runtimes surface missing methods as `capability_removed`; older
  shells surface unknown RPC methods as `bad_request` / `invalid_argument`
  ("unknown method"). Pages must branch on codes, not probe members (except
  `comments.onSendToClaude`, which is feature-detected with `in`).
- Renames keep aliases forever (`self` → `artifact` at 0.2.0).

### 2.5 Common lifecycle error codes (all capabilities)

| Code | Meaning | Retry |
|---|---|---|
| `not_granted` | session did not grant capability to this frame | never |
| `capability_disabled` | granted but unusable here (old runtime, module failed, platform off) | never |
| `capability_removed` | method absent from serving runtime | never |
| `transform_error` | arguments could not be marshalled (structured clone) | treat as caller bug |
| `queue_overflow` | too many calls queued before runtime ready (db listeners, sample) | terminal for that call/listener |

Unknown codes map to each capability's catch-all (`upstream_error` or
`unavailable`, stated per capability).

---

## 3. Identity, sharing levels, and guests (cross-cutting)

### 3.1 Level lattice

| Share-menu role | Level | Notes |
|---|---|---|
| (signed-out visitor) | none | no data, no room, no user id |
| Viewer | `view` | read only |
| Commenter | `view` | can comment in shell; writes no data |
| Contributor | `interact` | uses page, writes shared db by default |
| Editor | `admin` | publishes versions & assets |
| Owner (granted via share menu) | `admin` | not `owner` |
| Artifact's own owner | `owner` | single person, or every member who can post in the owning channel/project |

Additional rules:
- Organization member arriving by public link → `interact`.
- Signed-in visitor from outside the org (public link or email invite) →
  `view`, except an outside **Editor** invited by email holds `admin` only
  while the artifact is *not* also shared by public link.
- A member admitted by general access (org-wide or link) holds the max of
  their own row and the general-access level.
- Owner meets every level; only `{self}` privacy limits the owner.
- Owner row is shown first in the share list and is immutable.

### 3.2 Guests

"Guest" = invited from outside the owning organization. Surfaces as
`guest: true` on `user.Profile` (needs `profile` scope) and on room
`Sender`. Display data only, never authority.

### 3.3 Opaque user ids

- Format `u_` + 22 chars. Issued per **scope** (today: owning
  organization). Stable forever within scope; never compare across scopes;
  never parse; never display.
- The same id keys `db` `data/users/<id>`, room `Sender.by`, and
  `ArtifactData.profiles`.

---

## 4. Capability: `permissions` (built in)

```ts
type PermissionState = "granted" | "prompt" | "denied" | "unavailable";
state(): Promise<Record<string, PermissionState>>;   // omits unavailable keys
state(name: string): Promise<PermissionState>;       // unknown → "unavailable"
request(names?: string[]): Promise<Record<string, PermissionState>>;
manage(): Promise<void>;
```

- `granted`: consented, or a capability that confirms each use itself.
- `prompt`: first use or `request` will ask.
- `denied`: declined this load, or standing refusal for the artifact
  (lifted only in the artifact's Permissions menu).
- `unavailable`: undeclared or not offered (indistinguishable).
- Scoped names `"<cap>:<resource>"` (parsed at first colon), e.g.
  `mcp:<server display name>`, `mcp:host:filesystem`. Bare `mcp` = aggregate
  (granted only when all declared servers granted; requesting asks all).
- `request` shows at most one batched dialog; never re-asks granted or
  unavailable names; names denied this load stay denied with no dialog;
  never rejects on "no"; may stay pending as long as the viewer takes.
- `manage` opens the shell's Permissions panel; resolves when closed;
  rejects `unavailable` if it did not open (platform dialog open, opened too
  often, or no panel); older platforms reject `upstream_error`. Open count is
  rate-limited per page load.
- Default consent model is **lazy** (first use asks). Grants are UX consent,
  not authorization: server checks still apply.

---

## 5. Capabilities

### 5.1 `artifact` (alias `self`) — page republishes itself

Declare `{artifact: {}}`. Read-only views still get the namespace; writes
reject `not_granted` / `not_writer`.

**Methods**

```ts
publish(html: string): Promise<PublishResult>;                 // html form
publish(files: Record<string, PublishFile | PublishDelete | null>): Promise<PublishResult>; // files form
edit(ops: EditOp[]): Promise<EditResult>;                       // live docs only
sync(fn: () => unknown): Promise<void>;                         // live docs only

type PublishFile = string | Blob | { content: string | Blob; contentType?: string; ifMatch?: string | null };
type PublishDelete = { delete: true; ifMatch?: string };
interface PublishResult { version: string; changed?: {path; sha256: string|null}[]; shas?: Record<string,string> }
interface EditResult { seq: number; created: string[] }
```

**html form**
- Must be a complete document beginning with `<!doctype html>`.
- Compare-and-set against the version the view loaded; if anything was
  published since → `conflict` (with `live` = winning version id) and every
  open view reloads to the winner.
- On success **every** open view, including the caller, reloads.
- Runs with viewer authority; each version is attributed; atomic full replace.
- Canonical self-republish document shape (so the agent publish path can
  recognize and replace the wrapper instead of nesting it):
  `<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>RESET</style></head><body>` + page content as authored (its `<title>` and `<style>` first) + `</body></html>`, no whitespace between those tags, nothing else in head. RESET is the skeleton reset described in 03/page-contract (light color-scheme, safe-area padding on `:root`, zero body margin, 14px system font, `img{max-width:100%}`, `[hidden]{display:none!important}`).

**files form**
- Map of relative path → new content, `null` (delete), or `{delete:true, ifMatch}`.
- Unnamed paths carry over.
- Content-type inference by extension for: html, htm, css, js, mjs, json,
  webmanifest, txt, md, xml, svg, png, jpg, jpeg, gif, webp, avif, ico, woff,
  woff2, ttf, otf, mp3, wav, mp4, webm, pdf, wasm. Otherwise explicit
  `contentType` required (bare type, no parameters; strings require a text
  type). Only servable web media types stored.
- Default precondition: whole-version CAS. If **every** entry carries
  `ifMatch` (sha256 of the replaced copy; `null` = create), switches to
  per-file preconditions: writers touching different files both land.
- On success the **calling view keeps running** (other views reload); its
  relative URLs still serve its loaded version. If the save landed over
  someone else's, the caller moves to the new version (reload unless the page
  takes updates in place).
- `shas` returned when any `ifMatch` was present: stored sha256 of every file
  written (`{}` if none); use as next `ifMatch`.
- `changed`: when all entries had ifMatch, files changed by others since the
  view's version.
- Unavailable (host doesn't enable it, read-only view, or artifact shared
  publicly) → `capability_disabled`.
- On an artifact created from a **type**: type paths (incl. `index.html`) are
  read-only → `read_only_path`; html form always refused there.

**Error codes**

| Code | When | Retry |
|---|---|---|
| `conflict` | newer version published first; fields `live`, `paths: {path, expected, actual}[]`, `changed` | no (reload delivers truth); for `edit`, re-issuing is safe |
| `not_writer` | viewer lacks write | no; switch to read-only UI |
| `not_declared` | republish dropped the capability | no |
| `too_large` | html / files total over limit | no |
| `invalid_content` | not a doctype page; malformed path/content/type; bad edit op; op targets vanished id; not a live doc; over live budget. Fields `opIndex`, `target` when attributable | no |
| `read_only_path` | type-owned path or html form on typed artifact | no |
| `rate_limited` | publishing too often | slow cadence |
| `consent_required` | legacy; treat as `not_granted` | no |
| `upstream_error` | anything else | once, randomized delay |
| lifecycle codes | §2.5 | never |

**Live docs** (`edit` / `sync`) — only on artifacts the platform created as
live docs; content is an append-only edit journal, no versions.
- Server stamps a `data-id` on every served element.
- `EditOp`:
  - `{op:"set-text", target, text}` — U+00A0 vs space difference alone is not
    an edit.
  - `{op:"set-attr", target, key, val}` / `{op:"del-attr", target, key}` —
    not `data-id`.
  - `{op:"create-element", target, tag, text?, attrs? (≤16), before?|after?|index?}`
    — at most one placement; server returns ids in `created` (op order);
    `newId` retired/refused.
  - `{op:"remove", target}`.
- ≤ **32 ops** per call. `upstream_error` after one internal retry with same
  idempotency key: outcome unknown; only idempotent ops safe to retry.
- Caller must apply its own change to its DOM (not re-rendered for own edits).
  Others' edits are applied in place and fire `document` event
  `claude:edit` `{detail: {seq, targets: string[]}}`; unappliable edits reload
  the view. Text edits on `<script>`, `<style>`, `<textarea>`, `<title>`
  always reload other views.
- Budgets: ≤ 524,288 text chars (all text nodes incl. script/style),
  ≤ 131,072 elements+attributes+text runs, ≤ 8 MiB rendered; cumulative
  removed-content ≤ 4 MiB (then remove/move refused); ≤ 65,536 child
  placements per parent over document life; ≤ 16,384 chars per `set-text`
  (caps script/style bodies). Only re-creating the doc resets lifetime budgets.
- `sync` (zero-API capture): `<body>` is auto-marked `artifact-sync`; served
  children are the document; script-appended direct children of body stay
  local.
  - Local islands: `<artifact-local>` element / `artifact-local` attribute,
    any `data-local-*` attribute, `open` on details/dialog, password /
    hidden / payment-autocomplete inputs. Nested `<artifact-sync>` /
    `artifact-sync` re-shares; innermost wins; markers are `display:contents`.
  - Lanes: `discrete` (trusted user events: click, key, input, change,
    paste, drop; control input/change incl. programmatic `.click()`;
    `sync(fn)` writes) journal immediately, unbudgeted. `default` (timers,
    effects, rAF, pointermove/scroll/hover until a `continuous` lane exists):
    attributes coalesce **1.5 s**; ≤ **60 journaled writes/min per element**,
    beyond which only latest value kept, landing ≤1.5 s after window frees,
    one console warning. `idle`: local islands, never journaled.
  - Re-renders reconciled by `data-key`/`id`, else content, else position.
  - Script-built markup with no gesture is never saved; an element found
    holding it is switched off: `artifact-sync-state="off"`, event
    `claude:sync-off` bubbles.
  - Attributes that patch in place: `class`, `hidden`, `data-*`, `aria-*`,
    `value`, `checked`, `style`, `title`, `alt`, `placeholder`, `lang`, `dir`,
    `role`, `tabindex`, `disabled`, `readonly`, `contenteditable`, `open`,
    `colspan`, `rowspan`. Any other attribute change (`on*`, `href`, `src`,
    `id`, `type`, …) reloads other views.
  - Mixed text+element content not capturable (console warning).
    `<textarea>`/`<select>` values and canvas pixels not captured.
  - Read-only viewer's first attempt turns capture off for every region.
  - Events: `claude:sync-lost` `{code, count}` (transient, retried with next
    batch); `claude:sync-dropped` `{reason: "invalid_content"|"mixed"|"script_built", count, targets?}`.
  - Paste into editable markup lands as plain text.

### 5.2 `assets` — per-artifact blob store

Declare `{assets: {}}` (editors/owner only) or `{assets: {upload: "interact"}}`.

```ts
upload(blob: Blob, opts?: {type?: string}): Promise<{id; url; sizeBytes; contentType}>;
list(): Promise<{assets: {id; url; contentType; sizeBytes; createdAt}[]; usage: {files; bytes; maxFiles; maxBytes}}>;
delete(ref: string /* id or exact url */): Promise<{deleted: boolean}>;
```

- `id`: opaque 32-char (hex in agent-side tool), durable, never expires.
- Display URL derivable as root-relative `"/_blob/" + id` (the one
  root-relative path served from every page/version). Store id, not url.
- Accepted types (closed set): `image/png`, `image/jpeg`, `image/gif`,
  `image/webp`, `image/svg+xml`, `video/mp4`, `video/webm`,
  `application/pdf`, `font/woff2`, `font/woff`, `font/ttf`, `font/otf`,
  `text/csv`, `text/markdown`, `application/json`, `text/plain`, `text/css`,
  `text/javascript`. Exact spelling, no parameters; platform aliases
  (`application/vnd.ms-excel`, `application/javascript`) rejected.
- Size caps: SVG 2 MiB; CSS/JS 16 MiB; others 20 MiB; min 1 byte.
- Text types must be valid UTF-8 (BOM ok). CSS/JS must read as text and not
  start with markup. Binary types whose body starts with `<` rejected unless
  `image/svg+xml`. The four data types are not inspected.
- SVG sanitized and re-encoded: strips scripts, event handlers,
  `<foreignObject>`, `<style>`/`<link>`, animation elements, external
  `<use>`, `javascript:`/`data:` URLs (embedded rasters render blank).
  Served only as image (never document).
- Text assets served byte-for-byte under declared type, never rendered as a
  page; CSS/JS take effect same-origin when referenced.
- Lifetime: survive reloads and republishes; deleted with the artifact.
- Order: `list` oldest first. Listing has no names/ownership.
- `delete` idempotent; irreversible; artifact-wide 404 afterwards.
- `upload: "interact"` mode:
  - Contributors (org members, signed in) may upload; can list/delete only
    their own; `usage` counts whole artifact.
  - Gate housekeeping on `user.can("assets.write")` (false for them).
  - Their uploads are served **only** to signed-in org members (not public
    visitors, not outside invitees, not cookie-less requests).
  - Security invariant: on an artifact that declares or ever declared
    `interact`, pages must never execute an asset as script/module/worker,
    load it as stylesheet, or inject its text as HTML.
  - Admission follows the version people are served (a pinned "Shared
    version", if any). Not enabled everywhere; on ownerless artifacts only
    editors get it.
- Viewers at Viewer/Commenter, outside non-editors, signed-out → `null`.
- Outside-invited Editors delete only their own (`not_uploader`) and do not
  see Contributors' files in list or usage.

| Code | When |
|---|---|
| `invalid_request` | not a Blob, empty, bad options, non-UTF-8 text, bad delete ref |
| `too_large` | per-file cap |
| `unsupported_type` | outside set / parameterized / SVG not SVG / markup under binary type / CSS-JS not text |
| `quota_or_state` | quota or file count exhausted; artifact unpublished/being deleted/retired |
| `not_uploader` | deleting someone else's |
| `rate_limited` | too often |
| `upstream_auth` | could not authenticate; reload/sign in |
| `capability_disabled` | |
| `store_unavailable` | transient; the **only** retry-once code |
| `upstream_error` | catch-all, incl. unanswered call |
| `not_granted`, `capability_removed`, `transform_error` (→ upstream_error) | lifecycle |

### 5.3 `comments` — write into the shell's comment store

Write-only by design: no list/read/edit/watch verbs. Shell renders all
threads; posted text is immutable (nobody can edit, including the author).

Declaration forms:
- Full `{comments: {}}`: all verbs; consent prompt at **first write** (call
  stays pending while viewer decides). Available to owner and, on multi-member
  plans, members who can open the artifact (default excludes view-only).
  Public-link visitors and email invitees get `null`.
- Composer-only `{comments: {composer_only: true}}`: only `openComposer`,
  `anchorFor`, and (where offered) `onSendToClaude`; write verbs reject
  `not_granted`; `canSendToClaude` resolves `"off"`; never prompts.
- Either + `customAnchors: true` → `customAnchors()`.

Types:

```ts
interface Anchor { path: string; x: number; y: number }       // opaque; CSS-path + point
type ComposerTarget = { element: Element } | { range: Range };
type SendToClaudeTarget = { anchor: Anchor; text: string } | { threadId: string; text: string };
type CanSendToClaude = "available" | "writers_only" | "no_session" | "off";
interface DocPoint { x: number; y: number }                   // document CSS px incl. scroll
```

Methods:

| Method | Returns | Notes |
|---|---|---|
| `openComposer(target)` | `{opened: boolean}` | opens shell composer as if comment-mode click; no consent; Range text becomes quoted excerpt if within span bounds, else degrades to enclosing element; `data-comment-target` ignored here; rate-limited; rejects `unavailable` (no comments UI) / `invalid` |
| `anchorFor(el)` | `Anchor` | page-side, geometry read now; rejects `invalid` if detached |
| `create({anchor, text})` | `{threadId, commentId}` | |
| `reply(threadId, text)` | `{commentId}` | `not_found` for unknown/deleted |
| `sendToClaude(target)` | `{threadId, commentId}` | posts AND sends to Claude; editors only; from viewer's own recent gesture; human cadence; `claude_unavailable` decided before any write |
| `canSendToClaude()` | `CanSendToClaude` | snapshot, cheap, never prompts; can change after load |
| `onSendToClaude?(listener)` | unsubscribe fn | feature-detect with `in`; see below |
| `resolve(threadId, resolved)` | void | viewer's moderation reach; idempotent |
| `delete(threadId)` | void | irreversible; whole thread |
| `customAnchors(callbacks)` | `CustomAnchors` | see below |

Soft refusal `{opened:false}`: page not focused/engaged, composer already holds
typed text, target inside `data-uncommentable` subtree, or (with
customAnchors live) the call acted as a click closing an empty composer or
card.

Text rules: plain text, newlines/tabs allowed, no other control chars,
non-empty after trim, ≤ **4 KiB UTF-8**; no markup rendered. Writing
"@Claude" in page text does not summon Claude.

Moderation reach for resolve/delete: thread starter or artifact editor.

`onSendToClaude` interception hook:
- Fires only on the viewer's own press of "Send to Claude" in the shell
  composer (not "Send all", not page `sendToClaude`, not others' comments),
  **before** anything is posted.
- Listener receives `{text (≤4 KiB), anchor: string|null, label?}` and
  `ctx.signal`. Mentions arrive as display form `@Name`; no account ids or
  author.
- Listeners asked sequentially in subscription order; first
  `{handled: true}` wins → comment posted as a plain comment, Claude not
  brought in. Otherwise send proceeds unchanged.
- Shared bound ~**130 s**; on timeout send proceeds to Claude.
- `reply` ≤ **500 bytes UTF-8**, sanitized to one plain line (strips control,
  invisible, `<`, `>`, mention `@`); shown only to that viewer, not stored.
  If none handled, first kept declining-listener line is shown.
- `signal` aborts on Stop, timeout, or last unsubscribe.
- Follow-ups in the same thread are asked individually (no prior thread text).
- Only for viewers who may send to Claude (editors). Shell shows Stop and a
  working row meanwhile.

Custom anchors (`customAnchors(callbacks)`):

```ts
interface CustomAnchorsCallbacks {
  mode(on: boolean): void;
  threads(list: {id; anchor: string; resolved: boolean; active: boolean}[]): void; // ≤256, full replace
  reveal(id: string): void;
  composing?(open: boolean): void;
  move?(id: string, at: DocPoint): MoveResult | null | Promise<...>;  // answer within ~2 s
}
interface CustomAnchors {
  compose(anchor: string, at: Element | DocPoint, opts?: {label?; detail?; area?}): Promise<{opened}>;
  open(id: string, at: Element | DocPoint): Promise<void>;
  placed(map: Record<string, DocPoint>): void;     // full replace each call
  domAnchor(el: Element, ev?: {clientX; clientY}): [anchor: string, at: DocPoint];
  exitMode(): void;
  release(): void;                                 // idempotent
  readonly areas: boolean;
}
```

- Anchor names: page-invented durable strings, non-empty, ≤128 bytes UTF-8,
  no control/invisible chars; or a `domAnchor` CSS-path. Composer-only form
  keeps only domAnchor paths.
- `label`/`detail` ≤1024 UTF-16 units input; stored trimmed to 128 / 512
  bytes UTF-8 after whitespace collapse and char stripping; stored only beside
  domAnchor paths (beside invented names, only the name is stored and is what
  Claude reads as location); Send to Claude from the composer carries both.
- Thread handles are per registration, not store ids.
- Shell stops its own click-to-comment, hover ring, pin cursor, and
  scrolling inside the artifact; page reports pin positions; shell draws
  pins/cards/lists.
- Callbacks receive current state immediately after registration; exceptions
  swallowed.
- Second registration before `release` → `invalid`; missing required
  callback → `invalid`.
- After release: compose/open reject `invalid`, placed/exitMode no-op,
  `areas` false.

| Code | When | Retry |
|---|---|---|
| `consent_required` | not (yet) allowed; dismissed prompt not re-shown this load | no |
| `forbidden` | refused, no access, no longer declared; or no moderation reach for that thread | no |
| `invalid` | bad text/anchor/threadId/non-plain-data | no |
| `not_found` | thread missing/invisible | no |
| `rate_limited` | | slow down |
| `unavailable` | degraded, commenting off, consent prompt couldn't show | once, fresh gesture |
| `upstream_error` | other; thread/reply limits; unanswered call | once, fresh gesture |
| `claude_unavailable` | sendToClaude only; nothing posted | no |
| lifecycle | | never |

Shell-side markup hooks: `data-comment-target` (comment-mode clicks inside
anchor to the marked element), `data-uncommentable` (subtree excluded).

### 5.4 `db` — per-artifact realtime document store

Declare `{db: {}}` or `{db: {rules}}`; usually with `user: {}`.

**Path grammar**
- Segments: `[A-Za-z0-9_\-.~:@+]`, not `.` or `..` alone, ≤200 bytes each;
  ≤1000 bytes and ≤16 segments per path (agent tool: collection paths have
  1–15 odd segments).
- Even segment count = document; odd = collection.
- Builders throw `TypeError` synchronously on grammar violations (never a
  network call).
- No pre-creation needed; deleting a doc does not delete nested docs.

**Data model and limits**
- Body: plain JSON object at top level; ≤ **256 KiB** serialized; ≤ **32**
  levels deep. Numbers are doubles.
- ≤ **25,000** documents per artifact database; also per-collection count,
  per-org database count, and total-size caps (exact values not published).
- Store created on first write; erased with the artifact; survives
  republishes.
- Writes last-writer-wins, no transactions (page API). Agent-side writes use
  per-document integer `version` with `if_version` CAS (§7).

**API**

```ts
db.doc(path): DocRef;  db.collection(path): CollRef;
DocRef { id; path; get(); set(data); update(data); delete(); acquire(opts); onSnapshot(next, err?); collection(path) }
CollRef = Query & { path; doc(id?); add(data) }
Query { where(field, op, value); orderBy(field, dir?); limit(n); get(); onSnapshot(next, err?) }
DocumentSnapshot { id; exists; data(); metadata: {fromCache; hasPendingWrites} }
QuerySnapshot { docs; size; empty; docChanges(): {type: "added"|"modified"|"removed"; doc; oldIndex; newIndex}[]; metadata }
acquire({holder, ttlMs?, data?}) → {acquired; version?; expiresAt?; holder?}
```

- `set` = full replace / create. `update` = recursive merge of nested
  objects, arrays replaced wholesale, requires existence (else
  `invalid_argument`). `delete` idempotent.
- `doc()` with no id mints a client-generated id; `add` = `doc().set()`.
- Queries: ≤10 `where`; operators `==, !=, <, <=, >, >=, in, not-in,
  array-contains` (`in`/`not-in` arrays ≤30); one `orderBy` (missing field
  sorts last; default order = doc id asc); `limit` 1–1000. Top-level fields
  only; unindexed scan → keep collections ≤ low thousands; over-scan →
  `resource_exhausted`. Ordered+limited = window.
- Snapshots frozen; unchanged docs are identical objects across deliveries.
  First query snapshot all `added`. `removed` covers delete, leaving query,
  or losing visibility, and carries the last seen body.
- Delivery: realtime stream, fallback polling ~**30 s** foreground; own
  writes latency-compensated (`hasPendingWrites`).
- ≤ **64** active subscriptions per view (65th → `resource_exhausted` on error
  callback).
- Leases (`acquire`): cooperative only; `ttlMs` default 30000, clamped
  [1000, 600000]; same holder renews; busy → `{acquired:false, expiresAt}`
  without revealing holder; `data` merged on each grant; no release verb.
- Invisible ≡ nonexistent: no permission-denied or not-found codes on reads.

**Access rules**

```ts
type Level = "view" | "interact" | "admin" | "owner";
type Rule = { path: string; read?: Level; write?: Level };   // path "" = root; may end in "/{self}"
```

- Defaults: root `read: "view"`, `write: "interact"`; `data/users/{self}`
  private per viewer (even from owner).
- A rule covers its path and below; deeper rules override (looser or
  stricter); unset levels inherit from nearest ancestor rule.
- `write` ≥ `read` always.
- `{self}` must be the last segment; works under any prefix; siblings
  private unless a rule at the prefix opens them; a rule declared exactly at a
  `{self}` prefix must set both `read` and `write` (else publish rejected).
- Locking root write also blocks lower levels' own subtree unless a
  `data/users/{self}` rule restores it.
- ≤64 rules. Rules effective for the live version on the next call after it
  goes live. Typed artifacts may ship rules in their manifest.
- Below-minimum: read → appears nonexistent; write → `invalid_argument`.
- `data/users/<id>` requires the awaited `user.id()`; null id → no private
  subtree. View-only members have an id but cannot write.

| Code | When |
|---|---|
| `invalid_argument` | grammar, body, depth, size, filter count, page size, below-min write, update on missing doc |
| `resource_exhausted` | call rate, 64-sub cap, concurrent writes/leases, over-scan |
| `quota_exceeded` | doc count per collection/artifact, org database count, artifact size |
| `unavailable` | transient (verbs retry once); listeners only if bridge dead |
| `revoked` | grant withdrawn mid-session; terminal |
| lifecycle | incl. `queue_overflow` on listeners |

Also reachable via `mcp` as artifact server `artifacts_data` (§5.8).

### 5.5 `downloads` — offer a generated file

Declare `{downloads: true}`.

```ts
save({filename: string, data: string | Blob | ArrayBuffer | ArrayBufferView, request?: string}): Promise<{status: "saved" | "delivered"}>;
```

- Viewer confirmation dialog shows final filename + size; one undecided
  prompt at a time (first wins).
- Filename sanitized: invisible chars dropped, whitespace runs collapsed,
  ≤240 bytes UTF-8; viewer may see a different final name. >512 chars input
  → `bad_request`.
- Extension allowlist tier 1: `gif png jpg jpeg webp mp4 webm txt json md`;
  tier 2 (platform-switchable): `docx pptx epub csv ttf html svg pdf xlsx zip`.
  MIME from extension; Blob type / File name ignored.
- Strings UTF-8; ArrayBuffer transferred (detached); views copied; Blob passed
  through unread (read into one buffer when `request` set).
- No size limit except: export answers (`request` set) ≤ 16 MiB today;
  Android app writes ≤ 200 MiB.
- Export-request flow: the platform can ask the page for an export with an
  opaque token; page answers via `save({..., request: token})` → `"delivered"`.
  Unknown/expired token → `request_unknown`.
- Hosts: browser download, iOS share sheet, Android app file write.

Codes: `rejected_extension`, `extension_not_enabled`, `too_large`,
`declined`, `rate_limited`, `bad_request`, `request_unknown`,
`unavailable`, `not_granted`, `capability_disabled`, `capability_removed`,
`transform_error`.

### 5.6 `files` — read a Claude Code project's files

Declare `{files: {project: "chan_..."}}` (publisher must be a project member).

```ts
list({path?, recursive?, cursor?}): Promise<{entries: {path; isDirectory; size; createdAt?}[]; cursor?}>; // ≤500/page
read(path, {offset?, length?}): Promise<{bytes: Uint8Array; size; revision}>;   // length ≤ 26214400 (25 MiB)
download(path): Promise<{status: "saved"}>;   // page never gets bytes
asSampleTools(): Promise<SampleTool[]>;       // list_project_files, read_project_file (~12 KB/call); needs sample
```

- Viewers outside the org → `null`. Non-members get `not_found` everywhere,
  never prompted. Members prompted once at first call.
- Eventual consistency: new/edited files may lag a few seconds.
- `revision` opaque; changes with contents.
- Download limit 512 MiB (≈210 MB on Android). Executable/script types
  (`.exe`, `.js`, `.bat`, …) refused → `bad_request`.
- Codes: `not_found`, `not_granted`, `changed`, `rate_limited`
  (+`retryAfterMs`), `too_large`, `declined`, `bad_request`, `unavailable`,
  `capability_disabled`, `capability_removed`, `transform_error`.
- Privacy guidance: never copy file contents into artifact data/assets/versions.

### 5.7 `mcp` — call the viewer's connectors from the page

Declare `{mcp: {servers: [{server, tools: [...]}]}}`.

```ts
callTool(server, tool, input?, {cache?: false | {staleTime?, gcTime?, refresh?}, signal?}): Promise<CallToolResult>;
watchTool(server, tool, input, handler: (ev: {type:"data"; result} | {type:"error"; error}) => void,
          {cache?: {staleTime?, gcTime?}, refetchInterval?}): Unsubscribe;   // sync return
invalidate(server?, tool?, input?): Promise<void>;
listTools(server?): Promise<{servers: ServerInfo[]; fileArgs?: true}>;
server(name): Promise<ServerHandle>;           // frozen object, one method per tool → payload
describeTool(server, tool): Promise<{name; description; annotations?; inputSchema; outputSchema?}>;

CallToolResult { content: ({type:"text"; text} | {type:"image"; data; mimeType} | {type; ...})[];
                 structuredContent?; payload?; cache?: {storedAt: number; revalidating: boolean} }
ServerInfo { server /* display name */; kind?: "connector" | "artifact"; authStatus: "connected"|"needs_reauth"|"unknown"; tools: {name; description; annotations?: {readOnlyHint?; destructiveHint?}}[] }
FileArgument { $file: { data: Blob|ArrayBuffer|ArrayBufferView; name; type } }   // one leaf per call, ≤16 MiB
```

Addressing: `server` is the connector **display name** permanently (never a
per-account id). `host:<name>` = local MCP server on the viewer's device via
the Claude desktop app (name chars outside `[A-Za-z0-9_-]` → `_`).

Behavior:
- Inputs plain JSON only (`Map`, `Set`, `Date`, typed arrays, `BigInt` →
  `bad_request`); 1 MiB input limit (file args excluded).
- `payload` = `structuredContent`, else first text block JSON-parsed, else
  raw text.
- Tool-level failure rejects `tool_error` with full envelope in `.result`.
- Caching: per viewer + artifact, successful results only, order-insensitive
  input identity, best-effort, cleared on logout/account change/denial.
  `readOnlyHint: true` tools default `{staleTime: 0, gcTime: 5 min}`;
  unannotated and writes uncached by default; explicit `readOnlyHint: false`
  never cached (object ignored). `staleTime` cap 300000 ms; `gcTime` default
  300000, cap 86400000; ≤0 disables. `callTool` never serves stale.
- `watchTool`: replays cache (with `revalidating`), executes when missing or
  stale, delivers updates from its own runs, polls (`refetchInterval` floor
  ~**30 s**, paused while hidden, catch-up on return), coalesced per
  identity; fed by other cached callers and `invalidate`. Rejects (via error
  event) on `readOnlyHint: false` tools. ≤ **64** watches per view.
  First delivery ≥ one microtask after registration. Non-function handler →
  synchronous `TypeError` (only sync throw).
- Watches never prompt; `approval_required` delivered instead.
- `retryable: true` stamped only when unattended repeat may succeed;
  `retryAfterMs` clamped ≤ 60 s.
- Shell reply budget ~**130 s** → `upstream_error`.
- No `timeoutMs`; use `AbortSignal` → `cancelled` (outcome unknown).
- Consent per connector via `permissions` scoped `mcp:<server>`; first call
  on a connector asks and waits. `listTools` never asks; unasked connectors
  list from manifest with `authStatus: "unknown"`, empty descriptions.
- Duplicate same-name connectors: listed with empty tools; calls
  `selection_required`; shell prompts once per loaded version.
- Artifact servers (`kind: "artifact"`): today `artifacts_data` (this
  artifact's store, when `db` declared). No manifest entry, no consent, never
  bars public sharing, self-scoped. No watch/invalidate/cache. Listed first.
  Example tool names seen: `set`, `query`. Error readings differ (see table).
- `self_only`: artifacts connector tools `get_artifact` and
  `publish_version` and Claude Docs `export` only work on the page's own
  artifact from a page.
- Host servers: only the artifact owner may use them; outside the app every
  call → `server_not_connected`; app may confirm non-read-only calls
  (`cancelled` on decline); service sees tool name but not args once routed
  to device. Built-in exception host server `host:claude_browser` (Cowork
  sessions) with tools `read_page`, `get_page_text`, `find`, `preview_start`,
  `navigate`, `computer`, `form_input`.

| Code | Meaning |
|---|---|
| `needs_reauth` | token lapsed |
| `server_not_connected` | no connector by that name / no host bridge |
| `selection_required` | duplicate connectors, none chosen |
| `server_not_found` | removed upstream |
| `server_unavailable` | upstream 5xx/timeout; retryable |
| `not_in_manifest` | outside manifest or consent scope (artifact server: data no longer reachable) |
| `blocked_by_policy` | org policy |
| `self_only` | artifact/Docs connector used on another artifact |
| `approval_required` | per-call approval not given |
| `tool_error` | tool reported failure (artifact server: store error envelope JSON in message) |
| `bad_request` | caller bug, dup watch, 64-watch limit, unknown method |
| `cancelled` | signal fired, or host confirm declined |
| `rate_limited` | reserved, not returned today |
| `upstream_error` | other; also consent couldn't be asked (retryable, safe) |
| `not_granted` / `capability_disabled` / `capability_removed` / `transform_error` | lifecycle |
| `consent_required` | top-level only; consent declined or ~10 min wait |
| `user_changed` | top-level only; signed-in account changed |

### 5.8 `room` — ephemeral realtime presence & events

Declare `{room: {}}` or `{room: {topics: {name: "interact"}}}`.

```ts
emit(topic, data?): Promise<void>;
on(topic, handler, onError?): Unsubscribe;
presence(patch): Promise<void>;
peers(): readonly Peer[];                     // synchronous getter
onPeers(handler: (c: {peers; joined; left; updated}) => void, onError?): Unsubscribe;
connected(): boolean;  onConnection(handler, onError?): Unsubscribe;
join(name): Promise<NamedRoom>;               // same surface + leave()
sendToClaudeSession(data: {label?: string; [k]: Json}, {deliver?: "stage"|"send", onStatus?}): Promise<{to: "pane"|"session"|"new"; id?}>;
canSendToClaudeSession(): Promise<"available"|"available_if_summoned"|"available_if_opened"|"no_session"|"unsupported"|"off">;

Sender { peer: string; by: string | null; isMe; sameTab; kind: "viewer" | "agent"; guest: boolean }
Message = Sender & { topic; data? }
Peer = Sender & { presence: Readonly<Record<string, Json>>; updatedAt: number }
```

- Topic grammar `^[a-z][a-z0-9_.-]{0,47}$` (no colon; platform kinds use a
  colon). Room-name grammar `^[a-z0-9][a-z0-9_.-]{0,47}$`.
- Sending events is admin-only unless topic opened to `interact` (≤16
  topics). Presence settable by everyone. Platform enforces; disallowed
  messages never arrive. Receivers get everything.
- Sender fields stamped by platform: `peer` = per-open-document label (stable
  across reconnect, new on reload, same on everyone's page); `by` = user id
  only if artifact declares `user`, else null; `kind: "agent"` = the
  publishing Claude Code session (flag-gated, off by default; reads a
  batched digest; never joins named rooms).
- `emit`: `data` ≤ **4 KiB** JSON; echoes to self (`isMe && sameTab`); drops
  (no queue, no echo) while disconnected; no delivery guarantee.
- Budget: emits + presence ≈ **40/s**, burst **80**; excess emits dropped
  (reported once per load via `reportError`), presence waits.
- `presence`: per-field merge, top-level `null` deletes; merged object ≤
  **4 KiB**; applied locally immediately; sent coalesced ~**30 Hz**;
  re-asserted on reconnect; cleared on leave. Shell may forward the viewer's
  own lobby presence (minus `cursor`, `who`) to their adjacent Claude
  conversation if it meets bounds: identifier-like keys, strings ≤1 KiB with
  no control/invisible chars, nesting ≤8, total ≤4 KiB, all-or-nothing.
- `peers()` frozen snapshot, same object until change; complete up to ~256.
- `onPeers` ≤ once per animation frame, net change; first delivery presents
  everyone as `joined`; more joins trickle over a second or two.
- `connected()` false at load is normal (true within ~1 s); treat a
  disconnect only after ~2 s persistent false; periodic refreshes are normal.
- Named rooms: ≤16 per page; join timeout 10 s → `upstream_error`;
  auto-rejoin after reconnect, failure ends that room with one error to its
  listeners. Topic rights, peer labels, budget shared with lobby; presence per
  room.
- A new published version reloads every view and empties the room.
- Admission: signed-in org members, admitted guests; not signed-out or
  public-link visitors (→ `not_granted`).
- `sendToClaudeSession`: must be called synchronously inside the viewer's
  gesture (gesture proven from call). `stage` (default): attachment in
  viewer's composer; newer replaces older; may open viewer's chat for the
  artifact (navigating away). `send`: platform dialog shows payload and asks;
  platform's own page types may skip the dialog. Non-editor org members may
  be served where enabled (Claude asked to answer, not edit); never outside
  visitors; never on public-link artifacts for `available_if_opened`.
  Payload bounds: ≤4 KiB JSON, depth ≤8, ≤64 keys/object, ≤64
  entries/array, key grammar `[A-Za-z_][A-Za-z0-9_-]*` ≤64 chars (no
  prototype names), restricted string chars (no control except tab/LF/CR, no
  private-use, no format chars except emoji/script joiners and variation
  selectors ≤8 non-consecutive). `label` shown to viewer truncated to 120
  chars. Lobby presence attached automatically. `onStatus` receives
  `{state: "working"|"sent"|"failed", reason?: "signed_out"|"reauth"|"refused"|"unavailable"|"unconfirmed"|..., shell?}`.
  Works independent of room connection.

Codes: `invalid_argument`, `not_permitted`, `limit_reached`,
`upstream_error`, `claude_unavailable`, `rate_limited` (non-terminal);
`revoked`, `not_granted`, `capability_disabled`, `capability_removed`,
`transform_error` (terminal: every listener hears once, `peers()` decays to
self, `connected()` false). `onError` fires at most once per listener.

### 5.9 `sample` — page asks Claude on the viewer's account

Declare `{sample: {}}` or `{sample: {images: true}}`.

```ts
sample(input: string | {role: "user"|"assistant"; content: string}[], opts?): Promise<{text; truncated; modelTierApplied; modelApplied?}>;
sample.json<T>(input, opts?): Promise<T>;
sample.limits(): Promise<{maxPromptBytes: 262144; images?: {maxCount; maxInputBytes; mediaTypes}; tools?: {maxCount}}>;

opts = { onText?({text, delta}); signal?: AbortSignal; images?: Blob | Blob[] | FileList;
         modelTier?: "default"|"complex"|"quick"; model?: string; effort?: "low"|"medium"|"high";
         cache?: boolean | {gcTime?; refresh?}; tools?: {name; description; inputSchema?; execute(input, {signal})}[] }
```

- Memoryless; fixed platform framing; no page system prompt; no browsing.
- Turn arrays must start and end with `user`; consecutive same-role turns
  merged; no `system` role.
- Input ≤ **256 KiB** UTF-8 total.
- Request dispatched on next microtask; abort in same sync block sends
  nothing.
- Consent: first call per view asks; decline → `not_granted` for the view;
  `use()` itself never asks. Declaring images re-prompts viewers who allowed
  earlier without images.
- Concurrency: a couple run concurrently per viewer, a few queue, flood →
  `rate_limited`.
- Timing: quick ~1–2 s; default/complex first text 5–60 s (≤2 min), each
  round capped ~5 min. No page timeout option.
- `onText`: ≤ a few/s, `text` cumulative, `delta` non-empty, never sync,
  never after settle/abort, ≥1 call before success with final text.
- Cache (default on): key = input (all turns) + tier + model + effort +
  images bytes + verb; window = min of storing and asking call `gcTime`
  (default 5 min, max 24 h); `false` disables; `{gcTime, refresh: true}`
  forces; `gcTime: 0` invalid; in-flight dedupe; per viewer/artifact/browser;
  cleared on sign-out; only successes (incl. truncated) stored. Tools calls
  never cached; `cache` other than `false` with tools → `invalid_request`.
- `json`: tolerant parse (whole reply, else one code fence, else first
  `{`/`[` to last `}`/`]`); failure or truncation → `invalid_json` with raw
  text; never cached.
- Images: JPEG/PNG/WebP/GIF; downsized to ~1.2 MP, orientation applied, first
  frame, metadata stripped; >20 MB / >10,000 px side / >64 MP →
  `image_rejected`; attached to final user turn; not re-sent across chat
  turns.
- `model`: API model id; falls back silently to `modelTier` if not pickable,
  retired, overloaded; outside-org pages only released models. Rate-limit
  accounting by model family tier (Haiku→quick, Sonnet→default,
  Opus→complex) or requested tier if higher.
- `effort` applies to named models / thinking tiers; invalid → ignored with
  warning.
- Tools: name `[A-Za-z0-9_-]{1,128}` unique; description ≤1 KB; inputSchema
  ≤4 KB (not enforced); result string/JSON ≤32 KB; throw → "Error: msg" to
  Claude; execute signal aborts on Stop/settle/**150 s**; concurrent per
  round; "a handful" of rounds, last forced to answer; text across rounds
  joined by blank line.

Codes: `cancelled`; `invalid_request`, `prompt_too_large`,
`transform_error`, `queue_overflow` (page bug); `not_granted`,
`sampling_disabled`, `not_declared`, `capability_disabled`,
`capability_removed`, `images_unavailable`, `tools_unavailable` (hide);
`rate_limited`, `session_expired`, `image_rejected`, `refused` (partial
withdrawn, no `text`), `empty_completion`, `invalid_json`, `upstream_error`
(only transient). Error shape `{code, message, text?}` (plain object).

### 5.10 `user` — who is viewing

Declare nothing (booleans only), `{user: {}}` (+ids), `{scopes:["profile"]}`
(+names, avatars, search, guest flag), `{scopes:["profile","email"]}` (+email,
subject to org policy). Scopes are ceilings.

```ts
isOwner(): Promise<boolean>;  canEdit(): Promise<boolean>;            // canEdit = admin level
can(name: "data.write"|"files.write"|"assets.write"|"people.add"|string): Promise<boolean|null>;
me(): Promise<{id: string|null; name: string; avatarUrl: string; color: string; email: string|null; isOwner; canEdit}>;
id(): Promise<string|null>;  name(): Promise<string>;  avatarUrl(): Promise<string|null>;  email(): Promise<string|null>;
profiles(ids: string[] | string): Promise<Record<string, {id; name; avatarUrl; color; email: string|null; isMe; guest}>>;
search(q: string): Promise<Profile[]>;    // ≤8, org typeahead
```

- Reads never reject. Missing → `""` (strings), `null` (optional data),
  `false`, `[]`.
- `can()`: `null` means platform said nothing (older host, top-level, outside
  viewer, no viewer) — then all names null; unknown names → false when the
  platform answers. Fixed per view. Advisory only.
- `avatarUrl` always renderable: served from the artifact's own origin, or a
  `data:` URL with initials on `color` / generic mark.
- `color` stable per account across all artifacts and viewers; theme-safe.
- `profiles`: batch-only; keys exactly the unique input ids; cached for page
  lifetime, coalesced, background-refreshed; unresolvable → name `""`.
  Visibility: members see colleagues and named guests; guests see whoever the
  platform shows them.
- `search("")` → default set (you + ids already resolved). Returns `[]` when
  signed out, other org, neither edit nor comment, non-editor where outside
  people participated, non-editor after **3,000** calls per load, or org
  withholds directory. Debounced; superseded calls resolve with the newer
  result. Hits always have non-empty names.
- Store only ids.

---

## 6. Shell-side DOM conventions and events (summary)

| Hook | Kind | Purpose |
|---|---|---|
| `data-id` | attr (server-stamped) | live-doc element identity |
| `artifact-sync` / `<artifact-sync>` | attr/element | shared sync region |
| `artifact-local` / `<artifact-local>` | attr/element | per-view island |
| `data-local-*` | attr | per-view attribute |
| `artifact-sync-state="off"` | attr (runtime-set) | capture disabled |
| `data-comment-target` | attr | comment-mode anchors to this element |
| `data-uncommentable` | attr | exclude subtree from commenting |
| `data-key` | attr | reconciliation key for re-renders |
| `claude:edit` | event on document | `{seq, targets}` |
| `claude:sync-off` | bubbling event | region switched off |
| `claude:sync-lost` | event | `{code, count}` |
| `claude:sync-dropped` | event | `{reason, count, targets?}` |

---

## 7. Agent-side mirrors of runtime state

These are the control-plane interfaces Claude (the publishing agent) uses
against the same stores; an in-house implementation needs them too.

**ArtifactData** (db as the user): actions `get`, `list`, `query`, `set`,
`update`, `str_replace`, `delete`, `batch`, `profiles`.
- Every document carries an integer `version` (1 … 2^53−1). Writes to an
  existing doc **require** `if_version` (refused otherwise); mismatch writes
  nothing and returns current version. Omit only on create.
- `update` field deletion via `{"__delete__": true}` at any depth (not inside
  arrays; rejected in `set`).
- `str_replace` on one top-level string field: `old_str` must occur exactly
  once unless `replace_all`; field name 1–200 bytes, no dots/slashes/
  brackets/quotes/backslashes/control/invisible chars, not reserved
  `__name__`; old/new ≤ 262,144 chars.
- `batch`: 1–50 writes, each doc at most once, ≤1 MiB body, atomic where
  supported, else sequential (only when no entry pinned); result says which.
- `query`: `limit` 1–1000 (default 100), `cursor`/`next_cursor`, `where`
  ≤10 triples (ops include `eq ne in not-in lt lte gt gte array-contains`
  and symbolic forms), `order_by {field, direction}` (single page, no
  cursor).
- `as_level`: `view` | `interact` | `admin` — narrows access to test rules;
  refused writes read as not found, refused reads as empty; `me` unchanged.
- `profiles`: 1–64 ids → `{guest, display name}`.
- `out_dir`: dump docs to `<out_dir>/<collection>/<doc_id>.json`.

**ArtifactComments** (agent side): `read` (all threads, or one by
`thread_id`, paginated by `cursor`), `reply` (plain text ≤4096 bytes UTF-8;
refused as duplicate if a Claude reply already follows every
"sent to Claude" request unless `acknowledge_duplicate`), `resolve`,
`watch` (subscribe/list/stop; `replies: true` re-arms auto-reply).
- Threads are **activated for Claude** only by a writer pressing "Send to
  Claude" or mentioning `@claude`; reply/resolve only work on activated
  threads (else guidance, not error). Replies display as
  "Claude · via the user". Resolved threads can be reopened by people.
- Watches are session-local subscriptions to republishes and to activated
  comments ("auto-replies armed"); reconnect automatically; Ctrl+C pauses
  auto-replies until the user's next message.

---

## 8. Open questions / not observable from the contract

1. Wire protocol of the shell↔frame bridge (message names, envelope,
   correlation ids, origin checks) — needs browser observation.
2. Exact artifact origin scheme (per-artifact subdomain?) and iframe
   `sandbox` / `allow` attributes; CSP header exact text.
3. Exact numeric values for: per-collection doc cap, artifact db size cap,
   per-org database cap, asset `maxFiles` / `maxBytes`, rate limits for
   publish/comments/openComposer/assets/db call rate, html/files `too_large`
   threshold (Artifact tool says 16 MB page / 16 MB text file / 15 MB binary;
   is the runtime the same?).
4. How `hot.snapshot/ready` serialize state and what "quiet moment" means.
5. Consent persistence: where per-artifact grants are stored, scope (per
   account vs per device), and how the Permissions panel revokes.
6. db realtime transport (WebSocket/SSE?) and the polling interval source.
7. Comment store schema (thread/comment ids, anchor persistence format,
   label/detail storage), thread and reply count limits.
8. How "Send to Claude" reaches a watching Claude Code session (push channel)
   and how sessions are discovered for `canSendToClaude` / `no_session`.
9. How the agent peer is admitted to `room` (flag) and its digest format.
10. Live-doc creation path ("platform created as a live doc") — which
    surfaces create them.
11. `sample` model routing, tier substitution rules, and per-viewer slot
    counts ("a couple"/"a few").
12. Export-request flow for `downloads` (who issues the token, delivery
    destinations).
13. What "Shared version" pinning is (a share-menu feature that pins which
    version viewers get) and its API.
14. Type-artifact manifest format (typed artifacts ship rules/capabilities).
