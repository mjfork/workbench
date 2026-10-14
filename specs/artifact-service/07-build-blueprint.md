# 07 — Build blueprint for the self-hosted clone

A suggested architecture that meets the external interfaces in 01–06. This is our design, not something observed. Names are placeholders: `app.example` is the shell and `*.usercontent.example` hosts frames.

## 1. Components

| # | Component | Responsibility | Interfaces it must match |
|---|---|---|---|
| 1 | **Control-plane API** | Artifacts, versions, files, sharing, types, quotas, publish pipeline | 03 §2–§8 |
| 2 | **Frame host** (`<uuid>.usercontent.example`) | Serves `/_warmup`, `/_t`, `/_f/<ver>/…`, `/_runtime/…`, `/_blob/<id>` with navigation/fetch split, CSP, sandbox headers, runtime injection | 01 §4–§5 |
| 3 | **Shell web app** (`app.example/artifact/<shortId>`) | Chrome, iframe host, postMessage broker, consent dialogs, comment UI, share sheet, hot reload | 01 §2, §6–§7; 05 |
| 4 | **Frame runtime** (injected JS + lazy modules) | `window.claude.use`, `hot`, capability shims, comment overlay, transforms (mermaid), live-doc sync | 02 |
| 5 | **Realtime gateway** | WebSocket per shell at `/api/frame/sync?slug=<uuid>[&comment_hint=1]`, token in the subprotocol (`frame-sync.v1`): `join`, `roster` (viewers + watching agents), `ctrl:joined`, `ctrl:invalidate` (version push, replayed on join), `ping`/`pong`; plus db snapshots, room presence/events, comments, agent watches | 01 §7.1; 02 §5.4, §5.8; 03 §9; 05 §3 |
| 6 | **Document DB service** | Per-artifact document tree, rules engine, versions, leases, quotas | 02 §5.4; 06 |
| 7 | **Asset/blob store** | Per-artifact uploads, sanitization (SVG), quotas | 02 §5.2; 03 §5 |
| 8 | **Comment service** | Threads, anchors, activation, routing to agent sessions | 05 |
| 9 | **Agent gateway (MCP server)** | Exposes `Artifact`, `ArtifactData`, `ArtifactComments` as MCP tools for Claude Code (or any agent) | 03; 02 §7 |
| 10 | **Sample proxy** | `sample` capability → your LLM endpoint, with consent, caching and rate limits | 02 §5.9 |
| 11 | **Connector proxy** | `mcp` capability → the viewer's connected MCP servers | 02 §5.7 |
| 12 | **Docs service** (optional phase) | Block/CRDT doc store + Docs MCP server | 04 |
| 13 | **Preview/check worker** | Headless render at desktop and phone widths, light and dark; reports overflow, theme leaks, CSP blocks, console errors; thumbnails | 03 §7 |

## 2. Storage schema (minimum)

```sql
artifacts(id uuid pk, short_id char(22) unique, owner_id, org_id, title, description,
          icon_glyph, tint, type_url null, contract text, capabilities jsonb,
          current_version text, created_at, updated_at, deleted_at)
versions(artifact_id, ver text /* '<unixSec>-<4hex>' */, n int, label varchar(60),
         created_by, created_via /* agent|page|ui */, created_at, pk(artifact_id, ver))
version_files(artifact_id, ver, path, sha256, size, content_type, pk(artifact_id, ver, path))
blobs_cas(sha256 pk, bytes_ref, size)                      -- content-addressed, dedupes copies
assets(id char(32) pk, artifact_id, sha256, content_type, size, uploader_id, created_at)
shares(artifact_id, principal /* user|org|link */, level /* view|comment|interact|admin */)
consents(viewer_id, artifact_id, capability, decision_seq, granted, revoked, extra jsonb)
db_docs(artifact_id, path text, version bigint, body jsonb, updated_by, updated_at, pk(artifact_id, path))
db_rules(artifact_id, rules jsonb)                          -- from the capabilities declaration
idempotency(artifact_id, idem char(22), result jsonb, expires_at)
threads(id, artifact_id, anchor jsonb, label, detail, resolved, resolved_by,
        activated_for_claude bool, answered bool, created_at)
comments(id, thread_id, author_id, via text null, text varchar(4096), created_at)
watches(session_id, artifact_id, armed bool, connected_at)   -- ≤10 per session
pins(user_id, artifact_id)
```

## 3. Key flows

### 3.1 View

1. `GET /artifact/<shortId>` serves the shell. The shell calls `GET /api/frame/<uuid>` (bootstrap: version, file manifest, perm, consent, scoped tokens; 01 §3) and, in parallel, loads `<uuid>.usercontent/_warmup`.
2. The shell creates the iframe at `/_t?token=…` with the attributes from 01 §5.1. The frame host validates the short-lived token, sets a partitioned frame-origin cookie, and 302s to `/_f/<ver>/`.
3. The frame host builds the document: `<!-- frame-runtime -->` preamble + bootstrap + skeleton + author body. It sets the CSP and the other headers.
4. The runtime loads modules for declared capabilities. Each capability call goes over postMessage to the shell (`{__frame_cap:true, id, cap, method, args, brokerGen}` → `{__frame_cap_r:true, id, result|error}`; see 01 §6.2a). The shell checks the origin, consent and level, then calls the backend with the scoped token.

### 3.2 Publish (agent)

The agent calls the MCP tool `Artifact.publish`, and the control plane runs the 03 §3 pipeline, including the concurrency checks in 03 §4. It writes the version and files (CAS), then fans a `version` event out on the realtime gateway. Shells hot-swap (01 §7). Agent watches get the version recorded without starting a turn.

### 3.3 Page self-publish (`artifact` capability)

The frame sends the full document to the shell, which publishes it as a new version with `created_via=page`. Requests carry the base version, and a mismatch returns `conflict`. Every view, including the sender, reloads to the winner.

### 3.4 Comment → Claude

See 05 §3. Router: comment service → realtime gateway → agent gateway → session turn.

## 4. Security checklist (do not skip)

- [ ] **One registrable domain for frames, separate from the app domain**, with a **subdomain per artifact**. Add the user-content domain to the Public Suffix List (or the equivalent cookie isolation) so frames can't set cookies for each other.
- [ ] iframe `sandbox` **without** `allow-modals`, `allow-downloads`, `allow-top-navigation*`, `allow-popups-to-escape-sandbox`. Set `credentialless`, `referrerpolicy=no-referrer`.
- [ ] CSP per 01 §5.2. `connect-src` must exclude your API hosts, so all capability traffic goes through the shell broker. `frame-ancestors` limited to the shell origin.
- [ ] HTML returned to non-navigation requests as `text/plain` + `CSP: sandbox` (01 §4.2).
- [ ] Service workers disabled (403 + `Service-Worker-Allowed: /__no_sw__/`).
- [ ] Permissions-Policy denies every device API. Devices only through capabilities, with shell-side consent.
- [ ] Shell validates `event.origin` and `event.source === iframe.contentWindow` on every message, and keeps tokens out of the frame entirely.
- [ ] Scoped, short-lived tokens per concern (assets, sync, consent, handoff), all bound to (viewer, artifact, version). The sync token rides in `Sec-WebSocket-Protocol` (never the URL), binds role and user, and lives 15 minutes.
- [ ] Anonymous link viewers: the shell answers `null` for every capability, including `permissions`, and loads no capability modules (01 §9).
- [ ] `robots: noindex`, generic OG tags (no title or content leakage), `x-robots-tag` on the frame host.
- [ ] SVG sanitization on upload. Reject binary payloads starting with `<`. Strict content-type allowlist.
- [ ] Comment, presence and db content treated as untrusted. Render with `textContent`. Agents treat it as data, never instructions.
- [ ] Content-policy screening at publish (impersonation, phishing forms).

## 5. Suggested build order

1. **MVP-view**: control plane (publish/read/list/delete), frame host with headers/CSP/skeleton, shell with iframe, private sharing. An MCP tool `publish` for Claude Code.
2. **Hot reload + versions**: realtime gateway, version events, `hot` handoff.
3. **Comments**: DOM anchors, shell UI, agent `read/reply/resolve/watch`, Send-to-Claude routing.
4. **db + user + permissions**: rules engine, versions, `if_version`, subscriptions.
5. **assets, downloads, artifact (self-publish), room**.
6. **sample, mcp, files** (heavier: LLM proxy, connector auth).
7. **Types** (Dashboard/Slides/…) and the **Docs** service.
8. Preview/check worker, thumbnails, gallery, pins, duplicate.

## 6. Conformance tests (port the probe)

Re-run `probe.html` (the page used to gather 01; in `specs/artifact-service/probe/`) against the clone. Each recorded field (headers, CSP violations, dialog results, storage, capability namespaces, message markers, db write response shape) becomes an assertion.
