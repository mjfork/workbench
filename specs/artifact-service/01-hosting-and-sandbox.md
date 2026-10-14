# 01 — Hosting, Serving and Sandbox

Everything here was **observed** on 2026-10-13: on a live private artifact, from the claude.ai viewer page, and by a probe page that inspected its own runtime (the probe saved what it found to its own `db`, which was read back with the agent tool). Opaque ids are shown as `<uuid>`, `<id>`, `<ver>`. Tokens were never recorded. Anything inferred rather than seen is marked **(inferred)**.

---

## 1. Two-origin architecture

| Role | Origin | What runs there |
|---|---|---|
| **Shell** (viewer chrome) | `https://claude.ai` | Top-level page at `/artifact/<shortId>` (also `/code/artifact/<uuid>`). Draws the title bar, share, comments, chat, permissions panel and dialogs. Owns every credential, calls every API, brokers every capability. |
| **Frame** (user content) | `https://<uuid>.frame.claudeusercontent.com` | The author's HTML in a sandboxed iframe. It holds **no** claude.ai credentials, and CSP blocks it from reaching claude.ai or any other API. |
| Shell static assets | `https://assets-proxy.anthropic.com/claude-ai/v2/assets/v1/<name>-<hash>.js` | Hashed shell bundles: `frame-shell`, `frame-shell-chrome`, `frame-shell-deferred`, `frame-shell-broker`, `shared-frame-boot`, `shared-frame`, `vendor-frame`, plus fonts. |
| Font proxy | `https://fonts.frame.claudeusercontent.com` | Allowed by the frame's `font-src` (inferred: a proxy or mirror for fonts). |

**Origin per artifact.** Every artifact gets its own subdomain (two artifacts showed two different `<uuid>` hosts). As a result, `localStorage`, IndexedDB and Cache Storage are isolated per artifact, persist across republishes of the same artifact (same origin), and are never shared between artifacts.

**Short id vs uuid.** The public URL uses a 22-character base58-like id (`8FCu4hQ6UpnXatNErUVPyY`). The API and the frame host use a uuid. The shell maps one to the other (inferred: server-side lookup during bootstrap).

### 1.1 Shell page metadata (claude.ai `/artifact/<id>`)

- `<title>`: the artifact's title (it starts as "Claude Artifact" and is replaced after bootstrap). `apple-mobile-web-app-title` = artifact title.
- `robots: noindex, nofollow` (twice), `referrer: no-referrer`. OG/Twitter tags are generic ("Claude Artifact", "Try out Artifacts created by Claude users") and do **not** leak the title or content.
- `build-timestamp`, `build-git-hash`, `frame-runtime-pin = manifest.<16hex>.json` (pins which frame-runtime manifest the shell injects), `frame-shell-i18n`, `shell-inline-span`.

---

## 2. Load sequence (observed timings from one warm load)

| t (ms) | Request | Purpose |
|---|---|---|
| 0 | `GET claude.ai/artifact/<shortId>` | Shell HTML (~10.8 KB transferred; TTFB 46 ms; DOMContentLoaded 185 ms). |
| ~100 | assets-proxy bundles + 2 woff2 | Shell code. |
| 156 | `GET /api/frame/<uuid>?org=<orgUuid>&via=user_open&bk=initial&actor=id&vt=1` | **Bootstrap**: one JSON payload with everything the shell needs (§3). Replaying the same URL from page script returned `404 not_found_error` with `x-should-retry: false`, so treat it as single-use or context-bound. |
| 157 | `iframe <uuid>.frame…/_warmup` | **Warm-up** iframe that opens TLS/H3 to the frame host in parallel with bootstrap. A tiny empty HTML page, `no-store`, its own strict CSP (§5.3), `timing-allow-origin: https://claude.ai, https://preview.claude.ai`. |
| 183 | `GET /api/account` | Viewer identity. |
| 337 | `iframe <uuid>.frame…/_t?__frame_t=<token>&v=<n>&__frame_v=<n>` | **Token exchange.** It ends at `/_f/<ver>/`, the page's location (inferred: `/_t` sets a frame-origin cookie, which matches the `"cred":"cookie"` preamble mode, and redirects; an alternative `"query"` mode exists). |
| 340 | `GET /api/frame/track?org=<orgUuid>` | View tracking. |
| 340 | `GET /images/artifact-icons/glyphs.svg?v=…` | Sprite holding the tab/gallery icon glyphs. |
| ~390 | frame loads `/_runtime/<cap>.<hash>.js` for **each declared capability** plus `permissions` and `_transforms` | Lazy capability modules (§4). |
| ~1150 | `GET /api/organizations/<org>/members/display_info?account_uuids[]=…`, `members_v2?limit=1&account_uuids[]=…&types[]=member` | Resolves the names of people shown in the chrome (owner and others). |
| ~6000 | frame loads `_comments.<hash>.js`, `_translate.<hash>.js` | Deferred runtime: comment-mode overlay and page translation. |
| ~6000 | `POST /api/frame/telemetry` | Batched telemetry (§6.4). |

The page became interactive within about 0.5 s. With 8 capabilities declared, `claude.use()` resolved in under 1 ms after load (memoized, modules already loaded).

---

## 3. Bootstrap payload (`GET /api/frame/<uuid>`)

Observed top-level fields. Token values were redacted and never stored.

```text
viewerPath          "/artifact/<shortId>"
kind                "authed"        (inferred other values: anonymous/public-link, guest)
ver                 "<unixSeconds>-<4hex>"   current version id
assetToken          <token>   authorizes asset (blob) calls
syncToken           <token>   authorizes db/sync calls (sent as body.token on db calls)
syncIdleHiddenMs    300000    live sync suspends after 5 min hidden
syncClient          true
presenceViewEnabled true
files[]             {path, size, contentType, sha256}   one per published file (fileCount=5 for the probe)
consentToken        <token>
consent             { self|sample|messages: {decisionSeq, granted, revoked}, sample.imagesGranted, sample.disclosure }
handoffToken        <token>   hot-reload state handoff between versions (inferred)
mcpFileArgs         true      feature flag: mcp tools may receive file args
title, favicon, icon ("Code"), tint ("magenta")
fileCount           5
perm {
  role "owner", level "owner", mode "owner",
  commenters[], commentersEnabled, viewers[], viewersEnabled,
  editors[], editorsEnabled, orgEditorEnabled,
  spaceReadLevel "commenter",           org-wide default access level
  peopleRoute, peopleRouteEnabled, peopleMax 200,
  notifyChoiceEnabled, … (more fields not captured)
}
```

Implementation notes:
- **Icon.** The publisher sends a generic word (`code`, `timer`). The server stores a canonical glyph name (`Code`) and **assigns a tint color** (`magenta`) itself.
- **Consent is persisted server-side** per (viewer, artifact, capability), with a monotonically increasing `decisionSeq` and a `revoked` flag, so a consent can be withdrawn and then given again.
- **Separate scoped tokens** for assets, sync/db, consent and handoff. Each is narrow and short-lived (inferred). The frame never sees any of them.

---

## 4. The served document

### 4.1 Paths on the frame origin

| Path | Behavior |
|---|---|
| `/_warmup` | Empty HTML, `no-store`, strict CSP. |
| `/_t?__frame_t=…&v=…&__frame_v=…` | Token exchange and entry (see §2). |
| `/_f/<ver>/` | The page (the published HTML wrapped in the skeleton, plus the injected runtime). |
| `/_f/<ver>/index.html` | Same document as `/_f/<ver>/`, same ETag (`index.html` is the page's published path). |
| `/_f/<ver>/<path>` | Each supporting file at its published path, e.g. `probe.css`, `data.json`, `ext.js`, `sub/page.html`. |
| `/_runtime/<module>.<hash>.js` | Frame runtime modules (§4.3). |
| `/_blob/<32hex>` | Uploaded assets, root-relative and unversioned. An unknown id returns 404. |
| `/` , `/_manifest.json`, anything unknown | `404` with body `not found`, `text/plain`, `cache-control: no-store`. |

**Versioned URLs.** Each version's files live under `/_f/<ver>/`, and the version id has the form `<unix seconds>-<4 hex>` (`1791926722-425e`). Every file is served `cache-control: private, max-age=31536000, immutable, no-transform`, which is safe because a new version gets a new path. Relative references in the HTML resolve against `/_f/<ver>/`, so `files` paths "just work".

ETags look like `"c-<24hex>"` (inferred: content hash).

### 4.2 Navigation vs. fetch (key security property)

The same URL is served **differently depending on `Sec-Fetch-Dest`/`Sec-Fetch-Mode`** (both appear in `Vary`):

- **Navigation (iframe document):** real HTML with the runtime injected and the full page CSP.
- **`fetch()`/XHR of any `.html` (the page itself, `index.html`, `sub/page.html`):** returned as `content-type: text/plain; charset=utf-8` with `content-security-policy: default-src 'none'; frame-ancestors 'none'; sandbox` and `content-disposition: inline; filename=download.html`. Fetched HTML can therefore never render as a document or run script, even if it is re-hosted or opened directly.
- Non-HTML files (`.css`, `.js`, `.json`) are served with their real `content-type` and the full page CSP. `Vary` for these is `Sec-Fetch-Dest, Accept-Encoding`.
- Every file carries `content-disposition: inline; filename=download.<ext>`.

### 4.3 Runtime injection

At navigation time the server prepends this to the start of `<head>`, before the skeleton's own meta tags:

```html
<!-- frame-runtime -->
<script>window.__FRAME_PREAMBLE = { v:1, cred:"cookie"|"query",
  capabilities: { <capName>: "<module>.<hash>.js", … },
  transforms:"_transforms.<hash>.js", comments:"_comments.<hash>.js",
  translate:"_translate.<hash>.js", ldx:"_ldx.<hash>.js" }</script>
<script>/* ~39 KB inline bootstrap: defines window.claude, postMessage bridge,
           live-DOM diff/patch helpers, hot-reload handoff */</script>
<!-- /frame-runtime -->
```

- The preamble's capability map lists **every** runtime module, including several the author never declares: `artifact`, `assets`, `comments`, `db`, `dictation`, `downloads`, `embed`, `endpoints`, `files`, `mcp`, `network`, `permissions`, `reads`, `room`, `sample`, `self` (same file as `artifact`), `user`. Only modules for declared capabilities, plus `permissions` and `_transforms`, are fetched at load.
- `window.claude` is the **only** global added (besides `__FRAME_PREAMBLE`). On the probe, `Object.keys(window.claude)` came back empty: `use` and `hot` are non-enumerable.
- `window.name` carries a JSON handshake: `{"hot":{"k":"<14 char key>","g":<generation>},"usable":[<capability names>],"n":"<nonce>"}`. `g` is the hot-reload generation (1 on first load, 2 after an in-place republish).
- Scripts in the final DOM: 2 runtime scripts, then the author's own scripts in order.

### 4.4 The skeleton (wrapping applied at publish)

The author writes **only body content**: no doctype, `html`, `head` or `body`. The service wraps it as:

```html
<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>
:root{color-scheme:light;box-sizing:border-box;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}
html{scroll-padding-top:env(safe-area-inset-top,0px)}
body{margin:0;padding:0;font:14px -apple-system,BlinkMacSystemFont,sans-serif;background:#fff;color:#000}
img{max-width:100%}
[hidden]:not([hidden=until-found]){display:none!important}   /* selector tail partially redacted in capture */
</style></head><body>
…author content verbatim, including its own <title>, <link>, <style>, <script>…
</body></html>
```

Rules derived from this:
- The page's `<title>` sits **inside body**. The service finds it by scanning **only the first 8 KB** of the file.
- When a page republishes itself, it must send exactly this skeleton with no extra whitespace or tags in head. The publisher recognizes the skeleton and **replaces it instead of nesting it** (idempotent wrapping).
- Files in `files` (including other `.html` pages) are **not** wrapped: they need their own doctype, charset and viewport.
- Markdown (`.md`) pages are also accepted (only when a skill asks for them). They are rendered by the service, and their filename becomes the title.

---

## 5. Security policy

### 5.1 iframe attributes (set by the shell)

```text
sandbox        = "allow-scripts allow-same-origin allow-forms allow-pointer-lock allow-popups"
allow          = "translator; language-detector; fullscreen; clipboard-write; gamepad; xr-spatial-tracking; screen-wake-lock"
referrerpolicy = "no-referrer"
credentialless   (attribute present)
title          = "User-generated artifact content"
name           = <JSON handshake, §4.3>
```

Consequences, observed or derived:
- **Missing `allow-modals`.** `alert()` is a no-op, `confirm()` returns `false`, `prompt()` returns `null`, and `print()` exists but does nothing.
- **Missing `allow-downloads`.** `<a download>` and script-started downloads are inert. A file can only be offered through the `downloads` capability, which the shell performs.
- **Missing `allow-top-navigation*` and `allow-popups-to-escape-sandbox`.** In the probe, `window.open()` returned `null`. Plain `<a href>` links open outside the frame (the shell intercepts them, inferred).
- **`allow-same-origin`** is safe only because the origin is a throwaway per-artifact subdomain. It lets storage, workers and same-origin `fetch` of the artifact's own files work.
- **`credentialless`.** `document.cookie` writes did not persist (read back `""`), and no ambient credentials go out.

### 5.2 Page CSP (navigation document and its subresources)

```text
default-src 'self';
script-src  'self' 'unsafe-inline' 'unsafe-eval' blob:
            https://cdnjs.cloudflare.com
            https://cdn.jsdelivr.net/pyodide/
            https://cdn.jsdelivr.net/gh/python-visualization/
            https://cdn.jsdelivr.net/npm/
            https://cdn.tailwindcss.com https://code.jquery.com
            https://unpkg.com https://cdn.plot.ly;
style-src   'self' 'unsafe-inline' https://fonts.googleapis.com;
img-src     'self' data: blob:;
font-src    'self' data: blob: https://fonts.gstatic.com https://fonts.frame.claudeusercontent.com;
media-src   'self' data: blob:;
connect-src 'self' blob: https://fonts.googleapis.com https://fonts.gstatic.com;
worker-src  'self' blob:;
form-action 'self';
frame-src   'self' blob: data:;
object-src  'none';
webrtc      'block';
base-uri    'self';
frame-ancestors 'self' https://claude.ai https://*.claude.ai
            chrome-extension://<id1> chrome-extension://<id2>
```

Two allowlist entries are **not mentioned in the authoring docs**: `cdn.jsdelivr.net/pyodide/`, `cdn.jsdelivr.net/gh/python-visualization/` (Folium) and `cdn.plot.ly`. The frame-ancestors list includes two Chrome-extension origins (Claude's browser extensions, inferred).

Probe results, all CSP-enforced (blocked loads raise a `securitypolicyviolation` and fail silently in the page):

| Attempt | Result |
|---|---|
| `<script>` from cdnjs, jsdelivr/npm, unpkg | load |
| `<script>` from jsdelivr/npm **without a version** | **load**: version pinning is *not* enforced by CSP (it is an authoring rule only, or a publish-time lint, inferred) |
| `<script>` from esm.sh, raw.githubusercontent.com | blocked (`script-src-elem`) |
| `<img>` from wikimedia, and **even from cdnjs** | blocked (`img-src`): images must be same-origin, `data:` or `blob:` |
| `fetch` to example.com, cdnjs, claude.ai/api, api.anthropic.com | blocked (`connect-src`) |
| `WebSocket` to an external echo server | blocked |
| `eval`, `new Function`, WebAssembly compile | allowed (`'unsafe-eval'`) |
| Worker from a `blob:` URL | allowed |
| Service-worker registration | fails: the frame host returns 403 for the script, and `service-worker-allowed: /__no_sw__/` scopes it to a path that never exists |

### 5.3 Other response headers on frame documents and files

```text
permissions-policy: camera=(), microphone=(), geolocation=(), display-capture=(), usb=(), hid=(),
                    serial=(), bluetooth=(), midi=(), payment=(), idle-detection=()
cross-origin-resource-policy: same-origin
origin-agent-cluster: ?1
referrer-policy: no-referrer
x-content-type-options: nosniff
x-dns-prefetch-control: off
x-robots-tag: noindex, nofollow
service-worker-allowed: /__no_sw__/
cache-control: private, max-age=31536000, immutable, no-transform
content-disposition: inline; filename=download.<ext>
vary: Sec-Fetch-Dest[, Sec-Fetch-Mode], Accept-Encoding
content-encoding: gzip | zstd (shell API)
```

`_warmup` CSP: `default-src 'none'; base-uri 'none'; form-action 'none'; webrtc 'block'; frame-ancestors <same list>`.

Device APIs (camera, microphone, geolocation, and so on) are denied by Permissions-Policy. The probe's `navigator.permissions.query({name:'geolocation'})` returned `denied`. Those devices can only be reached through a declared runtime capability, which the shell performs on the page's behalf.

### 5.4 Features the frame *does* get (from `document.featurePolicy.allowedFeatures()`)

`screen-wake-lock, translator, language-detector, fullscreen, clipboard-write, gamepad, xr-spatial-tracking, picture-in-picture, sync-xhr, storage-access, media-playback-while-not-visible, aria-notify`, plus client hints, `browsing-topics`, `interest-cohort` and private-state-token features (browser defaults).

`clipboard.writeText` without a user gesture is rejected (`NotAllowedError`). Inside a click handler it works.

### 5.5 Storage (per-artifact origin)

| API | Observed |
|---|---|
| localStorage / sessionStorage | work |
| IndexedDB, Cache Storage | available |
| cookies | writes don't stick (`credentialless`) |
| Service worker | blocked |

Pages must wrap all storage access in try/catch, because previews, thumbnail capture and private windows may throw.

---

## 6. Shell ⇄ frame bridge

### 6.1 Transport

`window.postMessage` between the frame and `parent` (origin `https://claude.ai`). There is no `MessagePort` (`ports: 0` on every message seen). Each envelope is a plain object identified by a single **marker key** set to `true` (or an object), with the rest of the fields alongside it.

### 6.2 Shell → frame messages (all observed)

| Marker | Fields | Meaning |
|---|---|---|
| `__frame_cap_r` | `id`, `result` (or error, inferred) | Response to a capability call. The id is a capability letter plus a counter: `r3`/`r4` (room), `p1` (permissions), `e1` (assets). |
| `__frame_room_ev` | `ev: {arm:"presence", peer, by, isMe, sameTab, kind, guest, p}` | Room event pushed to the page (presence arm observed; event and connection arms inferred). |
| `__frame_chrome_poke` | `words: ["readonly", …]` | Shell state flags for the frame (here: viewer is read-only for the page's purposes). |
| `__frame_viewport` | `bottomInset` | Viewport inset updates (keyboard, toolbars). |
| `__fc_mode` | `{on: boolean}` | Comment mode on or off. The frame runtime then enables click-to-anchor, the hover ring and the pin cursor. |
| `__frame_size_poke` | — | Asks the frame to re-measure (inferred: for auto-height or thumbnails). |
| `__frame_revealed` | — | Frame is now visible (after the hot-reload "held reveal"). |
| `__ft_cmd` | `{action:"probe", target:"en-US"}` | Page-translation command (Chrome Translator API, matching the `translator` permission). |

### 6.2a Frame → shell messages (observed in a second session, captured in the shell window)

| Marker | Fields | Meaning |
|---|---|---|
| `__frame_cred` | `"cookie"`, `exp:<unix seconds>` | Frame reports its credential mode and expiry. Observed `exp` ≈ load time + ~1 h, so frame credentials live about an hour and the shell must refresh them before expiry (inferred). |
| `__frame_connect` | — | Runtime bridge is up. |
| `__frame_alive` | — | Liveness ping. |
| `__frame_ready` | `nav:[<6 numbers>]`, `gate:"dcl"\|"caps"` | Page ready. `gate` names the readiness gate: `dcl` = DOMContentLoaded; `caps` was seen on a hot-swapped page that declares capabilities (inferred: ready once capability modules are bound). `nav` is a 6-number navigation-timing summary (first value 301 or 377, inferred: ms). |
| `__frame_engaged` | `true`, `kind:"pointer"\|"click"` | The viewer interacted with the frame. Sent on first pointer movement and on clicks, throttled. The shell turns it into a `frame_engaged` track event (§6.3). |
| `__fc_rects` | `{rects:{<path>:{top,left,width,height}}, spans:{}, labels:{<path>:{label, place, key, ord}}}` | **Comment mode only.** Geometry of every anchored element, keyed by anchor path, so the shell can draw pins over the iframe. Sent about every **500 ms** while comment mode is on, plus on change. `labels` gives the human label (`"Steep Timer › text \"4:00 …\""`), `place` (nearest heading text), `key` (`"<heading path>\|<ord>"`) and `ord`. Empty objects when there are no threads. |
| `__fc_hover` | `{rect:{top,left,width,height}, kind:"element", radii:[4 numbers]}` | **Comment mode only.** The element under the pointer. The shell draws the hover ring outside the frame using the rect and the element's corner radii. Sent on every pointer move. |
| `__fc_click` | `{path, x, y, pin:{x,y}, sig:{v:<number>, tag:"<tagName>"}, label, doc:{x,y}, rect}` | **Comment mode only.** The viewer clicked to place a pin. This becomes the stored anchor (05 §2.1). The shell opens its composer at `rect`. |
| `__frame_cap` | `id`, `cap`, `method`, `args[]`, `brokerGen`, optional `holds` | **Capability request.** `id` = capability letter + counter (`b` db, `e` assets, `p` permissions, `r` room). `brokerGen` is the shell broker generation the frame bound to; it was 3 after two hot swaps, so requests from a stale frame can be dropped. `holds` appeared on `assets.list` (inferred: transferable or held-blob references). Observed methods: `db.set` (args `[{path}, data]`), `assets.list`, `permissions.state`, `room.hello` (room join handshake), `room.presence`. |
| `__frame_hot` | `ready`, `accept`, `demand`, `booting`, `preflight` | Hot-reload readiness flags, sent as the page boots and registers `hot.ready`/`hot.accept`. |
| `__frame_hot_snapshotted` | `gen`, `handoff:"empty"\|…`, `bytes` | The outgoing frame's state snapshot was taken (size in bytes). |
| `__frame_reveal_hold` | — | New frame asks to stay hidden until it is ready. |
| `__frame_reveal_ready` | — | New frame is ready to show. The shell answers with `__frame_revealed`. |
| `__frame_morph_ready` | `arms:["move", …]` | Live-DOM morph/patch support is ready, listing the supported patch arms. |
| `__frame_size` | `h` | Content height in CSS px (e.g. 649, 5879), for auto-height and thumbnails. |
| `__ft_status` | `{state:"idle", lang:"en", usable:false}` | Page-translation status (sent repeatedly). |

**Room presence is re-asserted by the runtime**: a page that called `presence()` once produced 51 `room.presence` requests over about 40 s (inferred: a heartbeat or re-assertion that keeps presence alive on the server).

Shell → frame messages are delivered inside the frame's window, so a listener in the shell window sees only the frame → shell direction. The shell → frame set in §6.2 came from the probe page.

Hot-swap sequence as observed: publish → `ctrl:invalidate` on the live channel (§7.1) → shell re-fetches `GET /api/frame/<uuid>` (new bootstrap) and creates a new `/_t` iframe → new frame sends `__frame_reveal_hold`, then `__frame_hot`, then `__frame_reveal_ready` → old frame sends `__frame_hot_snapshotted` → shell sends `__frame_revealed` and removes the old frame.

### 6.3 Shell → backend calls that act for the frame (observed)

| Call | Body | Response |
|---|---|---|
| `POST /api/frame/db/<artifactUuid>/call` | `{token:<syncToken>, verb:"set"\|"get"\|…, idem:<16-byte base64url>, path:"coll/doc", data:{…}}` | `{usage:{documents, maxDocuments:25000, bytes, maxBytes:100000000, full:false}, version:<int>}` |
| `POST /api/frame/blob/<artifactUuid>/list` | `{}` | `{assets:[], usage:{files, bytes, max_files:5000, max_bytes:1073741824}, source_digests:true, outsideWriter:false}` |
| `POST /api/frame/telemetry` | `{events:[{code, detail, t, n}], buildSha, slug:<uuid>}` | `204` (once `503`) |
| `GET /api/frame/track?org=…` | — | view counter |

- **Idempotency**: every db write carries a client-generated `idem` key, so retries are safe.
- **Versioning**: every write returns the document's new integer `version`. Repeated `set`s on the same doc went 2 → 3.
- **Quota echo**: every write returns live quota usage, so the client can show "full" state without a separate call.
- The page's camelCase (`maxFiles`) is mapped from the API's snake_case (`max_files`) by the runtime.

### 6.4 Telemetry codes seen

`held-reveal` with detail `expired-swap-hid`: the hot-reload path, where the new version was held hidden until ready, then revealed.

---

## 7. Hot reload (live republish to open viewers)

Observed: a page open in the viewer swapped to the new version **without a manual refresh**, within a few seconds of a publish, and `/_f/<ver>/` changed.

- `window.claude.hot` = `{data, from:{ver:"<previous ver>", handoff:"empty"|…, seq}, gen, signal, snapshot(fn), ready(fn), accept(fn), restart(fn)}`.
- Protocol (from the type definitions and the observations above): the shell receives a "new version" event over its live channel, waits for a quiet moment, and loads the new version in a **held, hidden** frame. The old frame's `snapshot` callback serializes state, which is handed to the new frame as `hot.data` (`handoff` names the result; `"empty"` when no snapshot was registered). The new frame is revealed (`__frame_revealed`) and the old one is discarded. `gen` increments, and so does `window.name.hot.g`.
- `syncIdleHiddenMs = 300000`: live sync (db subscriptions, version notifications) suspends after the tab has been hidden for 5 minutes and resumes on return. Confirmed: after 5.6 minutes hidden, returning to the tab opened a **new** live-channel socket (§7.1).
- Timing: the new version's bootstrap request went out about 0.1 s after the `ctrl:invalidate` push, and the swap finished about 1 s later. The second swap's bootstrap re-fetched the comment list too (`GET /api/frame/comments/<uuid>`).

### 7.1 The live channel (`/api/frame/sync`)

Captured by wrapping the page's `WebSocket` constructor and forcing a reconnect, with the URL confirmed in DevTools.

**Connection**

- `wss://claude.ai/api/frame/sync?slug=<artifactUuid>`: on the **app** origin, opened by the shell, never by the frame. One socket per open artifact tab.
- When the viewer has used comment mode, the shell reconnects with **`&comment_hint=1`** added. The plain socket closes and the hinted one stays open (DevTools showed both: one finished, one pending). Inferred: the hint asks the server to also push comment-store changes on this socket.
- **Authentication is in the subprotocol, not the URL or cookie alone.** The constructor gets two subprotocols: `["frame-sync.v1", <sync token>]`, and the server picks `frame-sync.v1`. The token is the bootstrap's sync token. Its format is six dot-separated fields:
  `<base64url(uuid)>.<uuid>.<role>_id_<userId>.<issuedAtUnix>.<expiresAtUnix>.<mac>`
  The observed lifetime is **900 s** (exp − iat). A role (`owner`) and the user id are bound in, and the last field is a short (24-character) MAC. Putting the token in `Sec-WebSocket-Protocol` keeps it out of URLs and access logs, which is the standard browser workaround for not being able to set an `Authorization` header on a WebSocket.
- No extensions negotiated (`ws.extensions = ""`).

**Frames.** All are JSON text frames. Every one carries `kind`, and most carry `slug` (the artifact uuid).

| Dir | `kind` | Payload | Meaning |
|---|---|---|---|
| ↑ | `join` | `{slug}` | Sent immediately on open. Subscribes the socket to the artifact. |
| ↓ | `roster` | `{accountUuids:[…], agents:[{accountUuid, busy}], total}` | Who is here: viewers' account uuids, plus **agent sessions watching this artifact**, with a `busy` flag. Sent on join and again on change (about 1 s later in the capture). Inferred: this feeds the room peer list and `canSendToClaude()` (`"no_session"` when `agents` is empty). |
| ↓ | `ctrl:joined` | `{door:true, lane:"v1", stores:[…2 names], sendStores:[…1 name]}` | Join accepted. `stores` are the server-side data stores this socket receives (for example db and comments); `sendStores` are the ones it may write through. `door` (inferred: room presence/emit allowed) and `lane` (protocol lane) are flags. Store names are internal and opaque. |
| ↓ | `ctrl:invalidate` | `{tag:"INVALIDATE_TAG_LIVE", ver:"<unixSec>-<4hex>", replay?:true}` | **New version published.** `ver` is the new version id. On join it is replayed (`replay:true`) with the current version, so a reconnecting client can tell whether it missed a publish. |
| ↑ | `ping` | `{slug}` | Client keepalive, about every **30 s** (first one 30.5 s after join). |
| ↓ | `pong` | `{}` | Keepalive answer (about 65 ms round trip). |

Not captured: frames for db snapshots, room events and comment changes. The capture window had no such activity; comment changes were instead followed by HTTP re-fetches (05 §4).

**Suspension.** The socket is closed while the tab is hidden longer than `syncIdleHiddenMs`, and reopened (with a fresh join and replayed `ctrl:invalidate`) on return. Simulated `offline`/`online` events did **not** cause a reconnect.

---

## 8. Things not observable (left for the implementer to decide)

- The full list of `__frame_cap` methods. Only the ones the probe used were seen (§6.2a). The rest are presumably the capability verbs in 02, one-to-one.
- The live channel's db, room and comment frames (the connection, its auth and its version/roster/keepalive frames are in §7.1).
- The redirect and cookie mechanics of `/_t`. The frame credential reports an expiry about 1 h after load (`__frame_cred.exp`; 3601 s after the publish in a second capture), but how it is refreshed was not seen.
- Shell → frame comment-mode messages (`__fc_mode` and pin placement into the frame). Only the frame → shell half was captured (§6.2a, 05 §4).
- The anonymous viewer's bootstrap response itself. Its effect is known (§9).

---

## 9. Public-link (anonymous) viewing

Observed by switching a test artifact to "Anyone with the link" and opening it in a signed-out incognito window.

- The same two-origin structure: shell on `claude.ai`, frame on `<uuid>.frame.claudeusercontent.com` at `/_f/<ver>/`, with `ancestorOrigins` = `["https://claude.ai"]`.
- **Every capability resolves `null`**, including the built-in `permissions`, and including capabilities the page declares (`artifact`, `comments`, `db`, `downloads`, `room`, `user`). All resolved in about 196 ms (when the bootstrap answered), not after the 10 s fallback, so the shell answers "absent" explicitly.
- **Only the `_transforms` runtime module loads.** No capability modules, and no comment overlay.
- `document.cookie` stays empty inside the frame; `localStorage` works (per-viewer, per-artifact origin as usual).
- Share sheet (owner side): **Invite people by email**; **People with access** with a role per person; **General access** = `Only people invited` or `Anyone with the link` ("can view, but not edit"). The sheet also has an **Export** tab and a settings gear.
- Whether `/_f/<ver>/` URLs of old versions keep serving after a new publish (immutable caching suggests yes, while authorized).
