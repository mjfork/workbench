# 03 — Publishing & Control Plane (agent-facing contract)

This section covers the interface an **agent** (Claude Code) uses to create, update, read and manage artifacts, plus the server-side rules that contract implies. Sources: the agent tool contracts (`Artifact`, `ArtifactComments`, `ArtifactData`), real publish, read and list responses from 2026-10-13, and the probe in 01. Everything is restated in our own words.

The agent-side db and comment tools are specified in **02 §7**. Comments end to end are in **05**.

---

## 1. Resource model

```text
Owner (account) ─┬─ Artifact  (id: shortId[22, base58-like] + uuid; private by default)
                 │    ├─ title, description (≤1000 chars), icon (generic word → glyph + server tint)
                 │    ├─ type_url?        (created from an Artifact Type; the type's own files are fixed)
                 │    ├─ capabilities     (declaration, see 02 §2.2)
                 │    ├─ contract         (runtime version pin, e.g. "0.2.76")
                 │    ├─ sharing          (role grants; see §8)
                 │    ├─ Versions[]       (id "<unixSec>-<4hex>", immutable, optional label ≤60 chars)
                 │    │    └─ Files{path → bytes, contentType, sha256}   (index.html = the page)
                 │    ├─ Assets[]         (id 32hex, separate store, unversioned; /_blob/<id>)
                 │    ├─ DB               (document tree; versioned docs; rules)
                 │    ├─ Comment threads
                 │    └─ Pins (per user, sidebar)
                 └─ Gallery listing (mine | shared | all), sorted by last opened/updated
```

---

## 2. Agent tool: `Artifact` — actions

`action` is one of `publish` (the default), `read`, `list`, `delete`, `open`, `pin`, `unpin`, `quickstart`.

### 2.1 `publish`

| Param | Meaning / rule |
|---|---|
| `file_path` | Local page (`.html`; `.md` only when a skill asks for it). For a typed artifact, one of its data files. A short, distinctive basename doubles as a fallback title. |
| `url` | Update this existing artifact in place. Without it, the call creates a **new** artifact, except when redeploying the same `file_path` already published in this session (the session remembers path → url). |
| `icon` | One generic word (≤40 chars), required on a **first** publish and omitted on redeploys (the artifact keeps its icon). The server canonicalizes the word to a glyph and picks a tint. |
| `description` | One sentence (≤1000 chars), the gallery subtitle. |
| `title` | Fallback when the HTML has no `<title>` within its first 8 KB. Also the name used for a `type_url` create. |
| `label` | Short name for this version (≤60 chars), e.g. "Draft to legal". |
| `files` | Supporting files: map `{publishedPath: sourcePath \| {from, contentType} \| {artifact, path, ver?} \| null}` or a list `[{path, contentType?}]`. `null` removes a path, and paths left out are **kept** (merge semantics). |
| `root` | Base directory for relative `files` sources. It never changes published paths. |
| `capabilities` | Omit: carry forward. `{}`: clear all. Non-empty object: **full replacement** (anything stored but not restated is revoked). |
| `contract` | Omit: keep the current runtime version. `"latest"`: upgrade. `"X.Y.Z"`: pin or roll back. Format: `^\d{1,4}\.\d{1,5}\.\d{1,6}$`. |
| `force` | Overwrite a newer conflicting version (destructive). Only on explicit user instruction, and the server may still refuse when a page saved that version itself. |
| `overwrite_unread` | Paths this call may replace or remove even though the session has not read them (see §4). |
| `pin` | Also pin to the sidebar (on explicit request only). |
| `asset`, `file_paths`, `from_url`, `asset_ids` | Asset-store uploads (§5). |
| `type_url`, `auto_open` | Create from an Artifact Type (§6). |

**Publish response (observed text):**

```text
Published <local path> at https://claude.ai/artifact/<shortId> (Version <n>, version id <unixSec>-<4hex>) Icon: "<word>".
Stored — contract 0.2.76 · capabilities <list> · readable by only you[; the declaration was carried forward from the previous version …]
Live subscription: arming in the background | already connected …
To update: …
```

The integer version count (1, 2, 3, …) and the version id are both reported. Sharing state appears as text ("readable by only you").

### 2.2 `read`

- `url`: returns the published page. For the **caller's own** artifact (or one where they are a **writer**), the result is the raw HTML, and the header names a saved local file holding the full page for later republish. For **someone else's** artifact, the result is an *isolated summary* steered by a `prompt` parameter, and the content is treated as untrusted data. The header states whether the caller is a writer.
- `path`: fetch one published file or asset id and save it locally (default: the session scratchpad; elsewhere needs approval). Small text files come back inline.
- `paths`: up to 256 files in one call.
- `page: true`: return the rendered page where a read would otherwise return something else (for example, a typed artifact).
- `type_url` with no `url`: describe an Artifact Type.
- Accepted link forms: `claude.ai/artifact/<id>` and `claude.ai/code/artifact/<uuid>`. The docs type also accepts `…/artifact/<title>-<id>`. Never fetched with plain HTTP tools.

### 2.3 `list`

| `scope` | Returns |
|---|---|
| `mine` (default) | Caller's artifacts, most recently opened or updated first: title, URL, last-updated. |
| `shared` | Shared with the caller. Artifacts from another org may be missing, and an empty list proves nothing. |
| `all` | Both. |
| `files` (+`url`) | That artifact's published files. |
| `assets` (+`url`) | Its asset store, paginated with `after` (cursor `^[A-Za-z0-9_=-]{1,4096}$`). |
| `types` | Artifact Types available to this account, optionally narrowed with `type_query`. |

`limit` 1–200 (default 25). `type`/`type_url` lists artifacts made from that type.

### 2.4 `delete`

- `url` alone: **permanently** delete the artifact. The link dies for everyone, and it cannot be undone. Requires the user's explicit request and confirmation.
- `url` + `path` (asset id): delete one asset (only when it is no longer referenced).

### 2.5 `open`, `pin`, `unpin`

`open` shows an existing artifact to the user without changing it (client-side). `pin`/`unpin` toggle the per-user sidebar pin.

### 2.6 `quickstart`

Read-only. It takes `intent` (`document | slides | design | other`) and optionally `design_systems:false`. It returns the account's available Artifact Types with their `type_url`s and, for a plain page, the page-authoring contract (the rules collected in 01 §4–5 and §7 below). Observed core types: **Dashboard, Design, Design System, Docs, Slides**.

---

## 3. Publish pipeline (server behavior implied by the contract and observations)

1. **Authenticate** the caller and resolve `url` → artifact. A new artifact is created if `url` is absent and the path is unknown to the session.
2. **Concurrency check** (§4). Refuse if the artifact has a version the caller hasn't seen, and hand back that version.
3. **Validate**:
   - Page ≤ **16 MB** rendered (`data:` URIs count). Text files ≤ 16 MB, binary files ≤ **15 MB**.
   - Per publish: ≤ **255 files**, ≤ **64 MB**. Per version in total: ≤ **511 files**, ≤ **256 MB**. Larger sets go up across several publishes to the same URL (merge semantics).
   - Standard web media types only. Content type is inferred from the **published** extension, or given explicitly.
   - `preflight.js` at the root is reserved: an ES module ≤ **8 KiB** whose default export is a function, or the publish is refused. It runs against open pages when an update is published (inferred: a migration or compat hook for open viewers).
   - Capability declaration validated against the account's roster. Examples: `mcp` servers need a non-empty `tools` array; local host servers other than the allowed ones are refused; `files` requires project membership; an `mcp` manifest blocks public sharing.
   - Content policy: impersonation of real people or organizations, fabricated records, credential or payment harvesting, and targeting private individuals are refused. On refusal, no alternative hosting is suggested.
4. **Wrap** the page in the skeleton (01 §4.4). This is idempotent: an existing skeleton is detected and replaced, never nested.
5. **Extract the title** from the first 8 KB, else the `title` param, else the filename.
6. **Copy server-side** any `files` entries of the form `{artifact, path, ver?}`: the file is copied from another artifact the caller can open, keeping its content type, with no download. HTML and XML documents can't be copied this way. At most **4 source artifact versions** per publish.
7. **Create version** `<unixSec>-<4hex>` with an optional label. The file set = previous version's files + the sent files − paths sent as `null`.
8. **Persist** the declaration (`capabilities`) and the contract. Both carry forward unless explicitly changed.
9. **Notify** live subscribers: open viewers hot-reload (01 §7), and watching agent sessions record the new version.
10. **Respond** with the URL, version number and id, the stored contract and capabilities, the sharing summary, and the subscription status.

---

## 4. Concurrency & the "read before write" rule

- A session may publish to an artifact only if, in this session, it has **published** it or **read** it (`action:"read"`). Otherwise the publish is **refused**, and the refusal returns the live version. That refusal counts as the read. The caller merges its changes into it and republishes, never resending unchanged content.
- When the artifact has a newer version than the session last saw (another session, or the page saving itself through the `artifact` capability), the publish is **refused with a conflict** that hands back the newer content. `force:true` overwrites it, but only on explicit user instruction, and the server can still refuse when the newer version was saved from inside the page.
- **Per-path freshness for `files`**: every path a publish touches must be one the session read (`path`), saw in a `files` listing, or published itself, and it must be **unchanged since**. Otherwise nothing is sent and the refusal names each path. `overwrite_unread` exempts named paths only when the user explicitly said to replace them unseen, and never exempts a path that changed after it was read.
- Some results start with a line saying a newer version was published. The agent then re-reads (`Artifact read`, not its local file) and merges.

Implementation: keep a per-(session, artifact) "last seen version" and per-path "last seen sha256". Compare them server-side, or client-side with server confirmation using `if-match`-style preconditions.

---

## 5. Asset store (agent side)

- `publish` with `url` + `asset:true` + `file_path` uploads one file. With `file_paths`, up to **25** image, video, PDF, font, stylesheet or script files go in one call under one approval. CSV, Markdown, JSON or plain-text files, symlinks and hard links, and files outside the working directory each need a call of their own.
- The page must declare the `assets` capability.
- The result gives each asset's `id` (32 hex) and `url`. The page references the asset by that exact url (served at `/_blob/<id>` on the frame origin).
- **Copy between artifacts:** `from_url` + up to **10** `asset_ids`. This is a server-side copy, both artifacts must be openable by the caller, and the result gives new urls.
- Runtime limits (from the page side, 02 §5.2): 20 MiB per asset, CSS/JS 16 MiB, SVG 2 MiB (sanitized). Store quota observed: **5000 files, 1 GiB** per artifact.

---

## 6. Artifact Types (template artifacts)

- A **Type** is itself a published artifact (`type_url` = its claude.ai URL) holding a fixed page and fixed files, plus instructions for the agent.
- **Create:** `publish` with `type_url` + `title` + no files. This makes a new private artifact bound to the type. The result carries the new `url`, the type's instructions, the pages to read first, the design systems (for decks and designs), and how to fill it: either the type's own store (`db`, via `ArtifactData`) or data files published to that url.
- `auto_open: "after_first_write"` delays showing the artifact to the user until the first data write. `"at_create"` (the default) opens it right away. Omit it for connector-backed types (Docs).
- **Updates touch only the instance's own files.** The type's page and files stay fixed, and capabilities come from the type.
- Core types seen: **Dashboard** (charts, numbers and tables with provenance), **Design** (canvas of artboards), **Design System** (README, tokens, components, assets), **Docs** (content lives in the Docs service and is edited through the Docs MCP server; the artifact is the viewer, see 04), **Slides** (16:9 decks, downloadable as .pptx/PDF).
- A design system is reference material: an artifact made from the Design System type, listable with `list` + `type`.

---

## 7. Authoring contract enforced or assumed by the platform

These are the rules a self-hosted clone should publish to authors, with what the server does about each:

| Rule | Enforcement |
|---|---|
| Author HTML body content only; the skeleton is added | Server wraps (01 §4.4) |
| `<title>` within the first 8 KB, two to four words, a name rather than a caption | Server scans the first 8 KB; style is guidance only |
| External scripts only from the CDN allowlist; stylesheets only from Google Fonts | **CSP** (01 §5.2) |
| Pin exact library versions at least 2 weeks old | **Not enforced by CSP** (unpinned loaded). Guidance only, or a possible publish-time lint |
| No remote images, fetch, XHR or WebSocket | CSP `img-src`, `connect-src` |
| No `alert`/`confirm`/`prompt`/`print`, no downloads, no popups | iframe sandbox (01 §5.1) |
| No other-site iframes, `<object>` or `<embed>` | CSP `frame-src`, `object-src` |
| `mailto:`/`tel:`/custom schemes unreliable | Shell link handling; behavior varies by client |
| Only a bare `#token` hash reaches `location.hash`; no query string | Shell passes through only `#[A-Za-z0-9._~-]+` |
| Forms: handle `submit` in script; `action` must not leave | CSP `form-action 'self'` |
| Clipboard write only inside a gesture; no clipboard read (`paste` event works) | Browser + `allow=clipboard-write` |
| Device APIs only through capabilities | Permissions-Policy denies them all |
| Workers from own files or `blob:`; no service workers or WebRTC | CSP + SW 403 + `webrtc 'block'` |
| Storage only for per-viewer conveniences | Per-artifact origin; may throw |
| Page ≤ 16 MB | Publish validation |
| Theme: tokens on `:root`, dark-mode overrides via `prefers-color-scheme` and `[data-theme]`, explicit body background | Shell sets `data-theme="dark"\|"light"` on the frame's root element when the viewer chooses explicitly; nothing for "system" |
| Phone width ≈ 400 px, 16 px gutter, no horizontal scroll | Guidance (a preview checker reports overflow) |
| Safe-area padding on `:root` | Skeleton |
| Mermaid fences / `<pre class="mermaid">` render natively | Runtime transform (`_transforms` module, inferred) |
| Hot-reload state handoff (`claude.hot`) | Runtime |

**Preview/check tool** (`ArtifactCheck`, mentioned in the contract): renders desktop and phone widths in light and dark, and lists overflow, colors that ignore the theme, blocked loads and console errors, including script parse failures. A clone should provide the same as a headless-browser job.

---

## 8. Sharing & access

- **Private by default** ("readable by only you"). The agent **cannot** change sharing. Sharing is done in the shell's **Share** menu.
- Roles (from bootstrap `perm` and 02 §3): **Viewer**, **Commenter**, **Contributor** (`interact`), **Editor** (`admin`), **Owner** (`owner`). The level order is `view < interact < admin < owner`. Org-wide default (`spaceReadLevel`, observed `"commenter"`); explicit lists of `viewers`, `commenters` and `editors`, each with an enable flag; `orgEditorEnabled`; a people cap (`peopleMax` = 200); a notify-on-share choice.
- **Share sheet** (observed): tabs **Share** and **Export**, plus a settings gear. Share has *Invite people by email*, *People with access* (each person with a role dropdown; the owner shows `Owner`), and **General access** with two choices: `Only people invited` (default) or `Anyone with the link` ("People with the link can view, but not edit."). *Copy link* sits at the bottom.
- **Guests:** people invited from outside the owning organization (`guest:true` in user and room data). **Public link** visitors are anonymous and get `null` for **every** capability, including `permissions` and every declared one, with only the `_transforms` module loaded (01 §9).
- **Contract on new artifacts:** a new artifact published on 2026-10-14 was stored with runtime contract **0.2.78**, while existing artifacts stay pinned to the contract they were published with (0.2.76 here).
- A **writer** (Editor+) can republish. Viewers and commenters can't, and an agent acting for them publishes a separate artifact instead.
- **Duplicate:** viewers see a "Duplicate this artifact" action (make a copy you own, then edit and remix).

---

## 9. Live subscriptions ("watches") for agent sessions

- Each publish **starts subscribing** the publishing session to the artifact's live changes. The result says "arming", "already connected" or "skipped". A watch counts only once connected. Watches reconnect automatically.
- `ArtifactComments action:"watch"` with a `url` starts a watch; with `on:false` it stops one; with no url it lists them. Watches are **session-local**, shown in the client's task list, and survive `--resume`/`--continue` for the most recently published or read artifact and for watches that were auto-replying.
- A republish from elsewhere **does not start an agent turn**. It is recorded, and the next publish or read surfaces "a newer version was published".
- **Comment wake-ups:** a comment *sent to Claude* on a watched artifact wakes the session only while auto-replies are **armed** for it (§05). Plain comments never notify.
- Only main-loop sessions hold watches (not subagents, teammates or print-mode runs).
- Ctrl+C or Stop **pauses** auto-replies until the next user message. Killing the live-updates task or stopping the watch **stops** them. `replies:true` re-arms them, but only on explicit user request, with the same approval as a publish. A session-wide "kill all agents" disarm cannot be undone this way.

---

## 10. Client affordances (Claude Code)

- `/artifacts` lists owned and shared artifacts (`o` opens in the browser, `c` copies the link). **Ctrl+]** reopens the session's most recent artifact.
- Web gallery: `claude.ai/code/artifacts`.
- Publish approval: publishing is an approvable action (a prompt in default permission mode). Asset batches count as one approval.

---

## 11. Open questions

- Version retention and whether old version URLs stay reachable. Rollback beyond `contract` pinning.
- Exact rate limits on publish (a `rate_limited` code exists).
- What `preflight.js` receives and returns.
- Whether the server lints CDN version pinning at publish.
- The thumbnail and preview capture pipeline (it exists: "previews or thumbnail capture" can make storage throw).
