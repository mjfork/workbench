# 06 — Limits, quotas and timeouts (consolidated)

Every number found in one place. **Src** marks where each comes from: **O** = observed on the wire or by the probe (01), **T** = the agent tool contract (03), **R** = the runtime type definitions (02), **D** = Docs MCP server (04). A "~" means approximate as documented.

## 1. Timeouts and timing

| What | Value | Behavior at expiry | Src |
|---|---|---|---|
| `claude.use(name)` when no viewer answers | **10 s** | resolves `null` | R |
| `claude.use` resolution in a normal viewer | <1 ms after modules load (~0.4 s from navigation) | — | O |
| Live sync suspension while the tab is hidden | **300 000 ms** (`syncIdleHiddenMs`) | db subscriptions and version notices pause, resume on return | O |
| db realtime fallback polling | ~**30 s** in the foreground | — | R |
| db lease (`acquire`) TTL | default **30 000 ms** (clamped) | lease lapses | R |
| mcp `watchTool` `refetchInterval` floor | ~**30 s**; paused while hidden; catch-up on return | — | R |
| mcp cache `staleTime` cap / `gcTime` default / cap | 300 000 ms / 300 000 ms / 86 400 000 ms | — | R |
| mcp shell reply budget | ~**130 s** | `upstream_error` | R |
| mcp `retryAfterMs` clamp | ≤ **60 s** | — | R |
| mcp top-level consent wait | ~**10 min** | `consent_required` | R |
| comments `onSendToClaude` interception | ~**130 s** shared | send proceeds to Claude | R |
| comments `customAnchors.move` answer | ~**2 s** | — | R |
| room `connected()` true after load | ~**1 s**; treat as disconnected only after ~**2 s** persistently false | — | R |
| room named-room join | **10 s** | `upstream_error` | R |
| room presence send cadence | coalesced ~**30 Hz** | — | R |
| room emit+presence budget | ≈ **40/s**, burst **80** | excess emits dropped, presence waits | R |
| sample first text, quick tier | ~1–2 s | — | R |
| sample first text, default/complex tier | 5–60 s (≤ 2 min); each round capped ~**5 min** | — | R |
| sample page-tool `execute` | aborts at **150 s** | — | R |
| sample cache window | default **5 min**, max **24 h** | — | R |
| live-doc attribute coalescing (`artifact` sync, default lane) | **1.5 s**; ≤ **60** journaled writes/min per element | only the latest value kept | R |
| Hot reload after publish | a few seconds (held hidden, then revealed) | — | O |
| First load to interactive | ~0.5 s warm (bootstrap 156 → frame 337 ms) | — | O |
| Deferred comment/translate modules | ~6–7 s after load | — | O |
| Telemetry flush | ~6 s after load | — | O |
| Docs MCP calls | no numeric timeout exposed; "outcome unknown" plus a suggested retry delay | — | D |
| Frame credential lifetime (`__frame_cred.exp`) | ~**1 h** after load | shell refreshes (inferred) | O |
| room presence re-assertion | ~1.3/s while present (51 requests in ~40 s) | — | O |
| Live channel keepalive (`ping`/`pong`) | ~**30 s** client ping; ~65 ms round trip | — | O |
| Live channel auth token (sync token) | **900 s** (exp − iat) | reconnect with a fresh token (inferred) | O |
| Live channel suspension when hidden | socket closed after 5 min hidden; new socket + `join` on return | `ctrl:invalidate` replayed on join | O |
| Publish → viewer swap | push ~instant; new bootstrap ~0.1 s after push; swap done ~1 s | — | O |
| Comment-mode geometry stream (`__fc_rects`) | every ~**500 ms** while on | — | O |
| Send to Claude → agent auto-reply posted | ~**5 s** observed | — | O |
| Anonymous viewer `claude.use()` → `null` | ~0.2 s (explicit, not the 10 s fallback) | — | O |
| Agent watch reconnect | automatic; no interval exposed | — | T |

## 2. Size limits

| What | Limit | Src |
|---|---|---|
| Rendered page (incl. `data:` URIs) | **16 MB** | T |
| Text supporting file / binary file | 16 MB / **15 MB** | T |
| Files per publish / bytes per publish | **255** / **64 MB** | T |
| Files per version / bytes per version | **511** / **256 MB** | T |
| `preflight.js` | ≤ **8 KiB**, ES module, default export is a function | T |
| Title scan window | first **8 KB** of the page | T |
| Description / label / icon word | 1000 / 60 / 40 chars | T |
| `read` `paths` per call | 256 | T |
| Asset upload (agent) per call | ≤ **25** files (text types alone) | T |
| Asset copy from another artifact | ≤ **10** ids per call | T |
| `files` copies from other artifacts | ≤ **4** source versions per publish | T |
| Asset size (runtime) | 20 MiB; CSS/JS 16 MiB; SVG 2 MiB (sanitized); min 1 B | R |
| Asset store per artifact | **5000 files / 1 GiB** (`max_files`/`max_bytes`) | O |
| db document | ≤ **256 KiB** serialized, ≤ **32** levels deep | R |
| db documents per artifact | **25 000** | O, R |
| db bytes per artifact | **100 000 000** (`maxBytes`) | O |
| db path | segments ≤ 200 B, path ≤ 1000 B, ≤ 16 segments; agent collection paths 1–15 odd segments | R, T |
| db active subscriptions per view | **64** | R |
| db agent `batch` | 1–50 writes, ≤ **1 MiB**, each doc once | T |
| db agent `query` | `limit` 1–1000 (default 100); ≤ 10 `where` clauses | T |
| db `str_replace` old/new | ≤ 262 144 chars | T |
| `profiles` ids per call | 1–64 | T |
| Comment text (platform store) | ≤ **4 KiB** UTF-8, plain | R, T |
| Comment label / detail stored | 128 B / 512 B (input ≤ 1024 UTF-16 units) | R |
| Custom anchor name | ≤ 128 B | R |
| `threads()` list to page | ≤ 256 | R |
| `onSendToClaude` reply line | ≤ 500 B | R |
| Docs threads per doc / comments per thread / body | 1000 / 100 / 4096 B | D |
| Docs export inline | ≤ **11 534 336 B** (11 MiB) | D |
| Docs widget code | 256 KiB per inline source; ≤ 8 blob refs per widget; 1 MiB code | D |
| room emit payload / merged presence | 4 KiB / 4 KiB | R |
| room peers complete up to / named rooms per page | ~256 / 16 | R |
| sample input | ≤ **256 KiB** UTF-8 | R |
| sample images | >20 MB, >10 000 px side or >64 MP rejected; downsized to ~1.2 MP | R |
| sample tool description / schema / result | 1 KB / 4 KB (not enforced) / 32 KB | R |
| mcp input | ≤ 1 MiB (file args excluded); file arg ≤ 16 MiB | R |
| mcp watches per view | 64 | R |
| files read length | ≤ 25 MiB; list ≤ 500 per page; download ≤ 512 MiB (~210 MB Android) | R |
| downloads filename | ≤ 240 B stored; > 512 chars input → `bad_request`; export answer ≤ 16 MiB; Android ≤ 200 MiB | R |
| live-doc budgets | ≤ 524 288 text chars; ≤ 131 072 nodes+attrs+runs; ≤ 8 MiB rendered; ≤ 4 MiB cumulative removed; ≤ 65 536 child placements per parent; ≤ 16 384 chars per set-text | R |
| Agent watches per session | **10** | O |
| People on a share list | `peopleMax` **200** | O |

## 3. Rate limits (only the existence is known; values are unpublished)

`rate_limited` exists for: publish, `openComposer`, comment writes, assets, db calls, `sample` (a couple concurrent per viewer, a few queued, then refused), `files`, and permission re-asks. mcp reserves it but doesn't return it today. A clone should pick explicit token-bucket values per (viewer, artifact, capability).

## 4. Caching

| Resource | Policy | Src |
|---|---|---|
| `/_f/<ver>/*` (page + files) | `private, max-age=31536000, immutable, no-transform`; content ETag | O |
| `/_warmup`, 404s | `no-store` | O |
| Shell API | `cf-cache-status: DYNAMIC` | O |
| mcp / sample results | per viewer + artifact (+ browser for sample); cleared on sign-out | R |
