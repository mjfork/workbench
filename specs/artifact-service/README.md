# Artifact Service — Clean-Room Specification

A behavioral and interface specification of claude.ai's Artifact service, written so an in-house, self-hosted equivalent can be built **without reference to its source code**.

Compiled 2026-10-13. Runtime contract version **0.2.76**.

## Provenance and clean-room rules

- **Sources used**: externally visible behavior only.
  1. The agent tool contracts (`Artifact`, `ArtifactComments`, `ArtifactData`) and the Docs MCP server's tools and guides, as exposed to a Claude Code session.
  2. The public type definitions the platform serves for the page runtime.
  3. HTTP behavior, headers and CSP, observed by a probe page running inside a private artifact (01).
  4. Network and postMessage traffic observed in our own logged-in browser session.
- **Not used**: no minified bundles were read for logic, nothing was decompiled, and no source was copied. The spec is restated in our own words. Identifiers, error codes, header values and numeric limits are reproduced because they *are* the interface.
- **No credentials** were captured or stored. Tokens, user ids and org ids are redacted.
- Marked **(inferred)** where a behavior was deduced rather than seen.

## Sections

| File | Contents |
|---|---|
| [01-hosting-and-sandbox.md](01-hosting-and-sandbox.md) | Two-origin architecture, load sequence, bootstrap payload, served paths, skeleton, runtime injection, navigation-vs-fetch split, iframe sandbox, full CSP, headers, storage, shell⇄frame message markers, backend calls, hot reload |
| [02-runtime-api.md](02-runtime-api.md) | `window.claude.use()` and every capability: artifact/self, assets, comments, db, downloads, files, mcp, permissions, room, sample, user; declarations, access levels, error codes, DOM conventions |
| [03-publishing-control-plane.md](03-publishing-control-plane.md) | Agent tool contract (publish/read/list/delete/open/pin/quickstart), publish pipeline, concurrency rules, asset store, Artifact Types, authoring rules and how each is enforced, sharing, live watches |
| [04-docs-mcp-server.md](04-docs-mcp-server.md) | Docs MCP server: 8 tools, object model, block markup, editing ops, revisions and hashes, comments (utterances), widgets, uploads, export, refusal codes |
| [05-comments.md](05-comments.md) | Comments end to end: data model, DOM/custom/doc anchoring, Send to Claude activation, interception, routing to agent sessions, agent replies |
| [06-limits-and-timeouts.md](06-limits-and-timeouts.md) | Every timeout, size limit, quota and cache policy in one table |
| [07-build-blueprint.md](07-build-blueprint.md) | Suggested architecture, schema, flows, security checklist, build order, conformance tests |

## Open questions answered by 01 (for readers of 02 §8)

- **Origin scheme**: a subdomain per artifact, `<uuid>.frame.claudeusercontent.com`. The sandbox and `allow` attributes and the exact CSP are in 01 §5.
- **Asset quota**: 5000 files and 1 GiB per artifact. **db quota**: 25 000 documents and 100 MB per artifact (01 §6.3).
- **Consent persistence**: server-side per viewer and artifact, with `decisionSeq` and `revoked` (01 §3).
- **Live sync**: a WebSocket from the shell to `wss://claude.ai/api/frame/sync`, authenticated with a short-lived token passed as a subprotocol. It closes after 5 minutes hidden (`syncIdleHiddenMs`) and rejoins on return (01 §7.1).
- **Comment wire format**: anchors, the HTTP calls, and how Send to Claude reaches an agent are documented (05 §4).
- **Public links**: anonymous viewers get every capability as `null` (01 §9).

## Still unknown (not observable without deeper probing)

- The full `__frame_cap` method list. The envelope itself is now known (01 §6.2a).
- The live channel's db, room and comment frames. Its URL, subprotocol auth, join, roster, version-push and keepalive frames are known (01 §7.1).
- How `/_t` refreshes its credential (the credential lives about 1 h).
- Shell → frame messages during comment mode. The frame → shell half and all HTTP calls are known (05 §4).
- The anonymous viewer's raw bootstrap response. Its effect (every capability `null`) is known (01 §9).
- Concrete rate-limit values.
- What `preflight.js` receives.
- Version retention.
