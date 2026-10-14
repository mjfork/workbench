# 04 — Docs MCP server ("Claude Docs")

Clean-room behavioral spec of the hosted "Claude Docs" MCP connector. Sources: the server's self-description (its `guide` topics), the tool schemas it exposes, and a live probe run on 2026-10-13 against a throwaway doc (created, exercised, deleted). Everything below is restated. Identifiers, codes, field names and numeric limits are reproduced exactly because they are the interface. Personal identifiers seen in the probe are redacted as `<user-id>`, `<org-id>`, `<ws-id>` and `<account-id>`.

Notation: `PID` = doc (project) id, `FID` = tab (file) id, `NID` = node id, `C` = `{"kind":"project","id":PID}`.

---

## 1. What it is

- **A doc** is a living, multi-author document. It is a *project* holding one or more *tabs* (files). Each tab points at one content *node*, normally a `prose` rich-text tree. A tab can also hold *widget* nodes (charts and diagrams written as TSX), *enums* (dropdown option sets), *blobs* (immutable uploaded or exported files) and *utterances* (comments).
- **Every doc is bound to an Artifact.** The viewer at `https://claude.ai/code/artifact/<PID>` (or `/artifact/<PID>`) is an Artifact made from the Artifact type "Docs". The artifact supplies the URL, sharing, the asset store for uploads, and the viewer UI. The doc service owns the content. See §13.
- **Transport:** a remote MCP server attached as a claude.ai connector. The model sees it under the tool prefix `mcp__claude_ai_Claude_Docs__`. All calls run as the human user (the doc records `actor.via:"mcp"`, `channel:"external"`, `self:true`).
- **Server instructions:** the server ships MCP `instructions` text (re-readable as `guide(["topic.instructions"])`) that sets agent etiquette. Notable rules:
  - The birth call comes first and plants a skeleton of pending blocks.
  - The doc is then filled one section per call so the watching human sees progress.
  - When a comment reaches the agent, the agent answers inside the doc, not through a platform comment tool.

---

## 2. Tools (8) and their parameter schemas

All tools return JSON with a top-level `verdict` (`"allow"` | `"deny"`). A deny carries `reason`, a human `detail`, `data` (machine fields) and often `hint`. The MCP error text appends `support: req_<id>` (a request id). Most allows include a `frame` trailer: `{slug, url, artifactUrl}` for the bound artifact. Many results also append free-text "next step" coaching after the JSON. A clone may omit this, but it is part of the observed UX.

| Tool | Purpose | Parameters (all JSON) |
|---|---|---|
| `guide` | Returns help topics as text | `items: string[]`. Values are `topic.<name>` or `refusal.<code>`; several per call |
| `batch` | Creates a doc, or applies several member ops to one doc atomically | `container: {kind:"project", id?, create?}` (required), `batch: Member[]` (required, may be `[]`), `opId?: string`, `verbose?: bool` |
| `create` | Creates one object in a doc | `object: "file"\|"node"\|"utterance"\|"enum"\|"blob"` (req), `payload` (req, object\|string), `container`, `engine?`, `opId?`, `verbose?`, `artifact?: string` |
| `read` | Reads a doc, tab, node, comment, enum or blob | `ref: {object:"project"\|"file"\|"node"\|"utterance"\|"enum"\|"blob", id}` (req), `container?`, `engine?`, `payload?` |
| `update` | Edits node contents, renames, patches tabs, changes stored values | `ref` (req), `payload` (req), `container?`, `engine?`, `opId?`, `verbose?`, `answering?: string (≤64)` |
| `delete` | Deletes one object | `ref: {object:"project"\|"file"\|"node"\|"utterance", id}` (req), `container?`, `engine?`, `opId?`, `verbose?`, `payload?` |
| `query` | Lists a tab's or doc's comment history | `object: "utterance"`, `container`, `payload: {under, limit?, afterSeq?}` |
| `export` | Renders one tab and returns it inline as base64 | `container` (req), `file: FID` (req), `format: "markdown"\|"text"\|"html"\|"docx"\|"pdf"\|"notion"` (req), `maxBytes?: 1…11534336`, `paper?: "letter"\|"a4"` |

`container.version` exists in the schema; its use was not observed. Addressing rules:

- **Calls on things inside a doc** (tabs, nodes, comments, enums, blobs, batches) carry `container: C`.
- **A call whose `ref` is the doc itself** (doc read, rename, `tabs` patch, doc delete) carries no container.
- **`ref.id` for a project** accepts the bare UUID or the whole artifact URL. A `<title>-` prefix, `?query` and `#hash` are ignored. Doc ids are a UUID or a 22-character id.

`engine` values seen: `prose`, `widget`, `json` (file and enum records), `blob`, `text` (plain-text tabs). The engine can sit at the top level and/or inside `payload.engine`.

---

## 3. Object model

```
project (doc)  id: UUID
 ├─ value: {name, artifact:{slug, bound:{by:"publish"}, org, ws, creator:{account, org}},
 │          tabs:{<FID>:{name, order, subtabOf?}}, display?:{tabsLocation?:"left"}}
 ├─ file (tab)  id: 12-hex with dash "xxxxxxxx-xxxx"; engine json;
 │     value {birthName:"Doc.ldoc", content:{kind:"node", id:NID}}
 │     read view: {id, name, mime:"application/vnd.claude.page", content:{id, kind:"node", engine:"prose"}, engine:"json"}
 ├─ node  id: "xxxxxxxx-xxxx"; engine prose | widget | text
 │     parent: a file (tab). A prose node is a tab body; widget nodes are children of the tab FILE
 ├─ utterance (comment)  id: "xxxxxxxx-xxxx"; parent = node (+anchor) | utterance (reply/resolve)
 ├─ enum  id: "xxxxxxxx-xxxx"; value {name, options:[{name, order}]}
 └─ blob  id: "blob/xxxxxxxx-xxxx"; value {parent:{object:"file",id}, asset:"<32-hex asset id>"}; immutable
```

Probe facts:

- **Doc birth:** creating a doc made the project, one file (`birthName:"Doc.ldoc"`), one prose node, and set `tabs.<FID> = {name:<doc name>, order:"V"}`.
- **Tab name vs file name:** the file's own name is `birthName`, a filename with no `/`, no control characters, no leading or trailing spaces, at most 255 characters. The display name lives in `project.tabs.<FID>.name`.
- **Tab order:** `order` values are fractional-index strings compared lexicographically (`"a0"` < `"a1"` < `"b0"`). Tabs with an order come first, in ascending order. Unordered tabs follow in no defined order. `subtabOf` nests one tab under another.
- **Tab placement:** a file that has no `tabs` entry exists but does not show.
- **Tab layout:** adding a second tab automatically wrote `display.tabsLocation:"left"` and returned the note `tabs_set_left`. Deleting that key puts tabs back in a menu.
- **Minimums:** a doc keeps at least 1 tab (`last_tab`), and a tab keeps at least 1 block (`last_block`).

### 3.1 Prose block ids, revisions and hashes

- **Block and char ids** are `<session>.<clock>`, where session is an 11-character base36 string (e.g. `mcvtwzh4p9h`) and clock is an integer. One writer session mints a monotonically increasing clock. Ids are per character: blocks, text runs and chips all draw from the same clock space. Text runs carry *character* ids, and a run's id is the id of its first character.
- **Short ids in output:** printed output gives the first id in full and later ones in short form (`.26`), which means the prefix of the last full id. Short forms are **rejected** as input (`relative_id`).
- **Revisions:** `rev` is a per-node integer, +1 per write call. A read reports `rev`. A history read also reports `latest`.
- **Block hashes:** `h` is an 8-hex hash per block.
  - Text blocks hash their letters only. Chips, breaks, bold and links are not covered.
  - Lists, quotes, tables, rows and cells hash their type, attributes and direct child ids, not their text.
  - The empty-paragraph hash is `e3b0c442` (the first 8 hex of SHA-256 of the empty string). The probe's single-character cell `1` hashed to `6b86b273` and `2` to `d4735e3a`, which match the first 8 hex of SHA-256 of `"1"` and `"2"`. So `h` is most likely `sha256(plain text)[0:8]` for text blocks.

---

## 4. Doc creation (`batch` with `container.create`)

```json
batch({
  "container": {"kind":"project","create":{
     "name":"<title>",
     "artifact":"<optional: an existing blank Docs-type artifact URL to bind to>",
     "doc":{"markdown":"…<?claude block k?>…","blocks":{"k":{…chip…}}}}},
  "batch": [],
  "opId": "<optional idempotency key>"
})
```

The response shape below is from the probe, with ids redacted:

```json
{"verdict":"allow",
 "acks":[
   {"verdict":"allow","diff":[{"address":{"container":C,"ref":{"object":"file","id":FID}},"after":{"birthName":"Doc.ldoc"}}],"minted":FID},
   {"verdict":"allow","id":NID,"rev":1,"session":"<sess>","xml":"<doc>…outline…</doc>","keys":{"asof":[21],"me":[25],"s1":[71]}},
   {"verdict":"allow","diff":[… file.content → node …]},
   {"verdict":"allow","diff":[… project.after = {name, artifact:{slug,bound:{by:"publish"},org,ws,creator}, tabs:{FID:{name,order:"V"}}} …]}],
 "lids":{"f":FID,"n":NID},
 "created":{"verdict":"allow","minted":PID,"bound":true},
 "frame":{"slug":PID,"url":"https://claude.ai/code/artifact/PID","artifactUrl":"…"}}
```

- **Composite birth:** the `create.doc` shorthand makes the tab (`$lid` alias `f`), its prose body (`n`), and the link between them. The aliases `f`, `n` and `p` (the doc being born) are reserved. Reusing one gives `same_anchor`/`lid_reserved`.
- **`keys`** maps each chip key to the clock(s) it became.
- **`created.bound`:** `true` means the server minted and bound the viewer artifact. `false` means no link was minted and comes with a notice.
- **Binding to an existing artifact:** pass `create.artifact = <url>` to bind a blank Docs-type artifact. If a doc is already bound there:
  - `exists` with `minted` (plus `lids`) means the doc exists and the caller may use it.
  - A bare `exists` means someone else holds it.
- **Idempotency (verified):** resending the identical birth with the same `opId` returned the original ids with `"replayed":true` and slimmer acks. Nothing was duplicated. The same rule applies to every write that takes `opId`.
- **Extra tabs at birth:** extra tabs ride the same batch as members (see §6.1). A final member does the `tabs` patch on `{"object":"project","id":"$lid:p"}`.

---

## 5. Reading

| Call | Payload | Returns |
|---|---|---|
| `read(ref:{project,PID})` | — | `value` (name, artifact binding, tabs map), `files[]` |
| `read(ref:{file,FID}, container)` | — | `value:{content:{kind:"node",id}, birthName}` |
| `read(ref:{node,NID}, engine:"prose", container)` | `{"projection":"outline"}` | outline XML: each block with `id`, `h`, attributes. Text is truncated to about 10 characters plus `…`, and nested children fold into `<gap blocks='n'/>` |
| same | `{"kind":"view","parentId":"<block id>"}` | one block in full, with every descendant id and `h` |
| same | `{"kind":"view","sinceRev":N}` | only blocks changed since rev N. Unchanged runs show as `<gap blocks='n'/>` and deleted blocks as `<gone id=…/>` |
| same | `{"kind":"view","atRev":N}` | the doc as of rev N, plus `latest`. Note `threads_omitted`: history reads show no comment markers |
| same | `{"kind":"search","text":"…"}` | `hits:n`. Matches are wrapped in `<hit n start end>` with char-id ranges; everything else folds into gaps |
| `read(ref:{node,WID}, engine:"widget")` | — | `value:{code, pub, draft?:{code, basePub}, parent}` |
| same | `{"kind":"screenshot"}` | `value:{kind:"screenshot", png, mimeType:"image/png", width:1344, height, rendered:"pub N", renderer:<40-hex build sha>, errors[]}`. Light theme. Cannot be a batch member |
| `read(ref:{utterance,id})` | — | `value` (body, parent) plus `anchor:{kind:"chars", state:"attached", block, quote, range:[a,b]}` |
| `read(ref:{enum,id})` | — | `{name, options:[{name, order}]}` |
| `read(ref:{blob,"blob/…"})` | — | `{parent:{object:"file",id}, asset}` |

All read responses carry `complete:true|false`. Paged reads exist: comment markers repeat with `continued='true'`.

### 5.1 XML vocabulary (as printed)

Root: `<doc node rev outline? sinceRev? parent? hits?>`.

**Blocks**

| Element | Attributes |
|---|---|
| `paragraph` | `heading='1..6'` for headings |
| `list` | `kind='bullet'\|'ordered'\|'check'` |
| `listItem` | `checked` on check-list items |
| `table` › `row` › `cell` | `header='true'` on header cells |
| `codeBlock` | `language` |
| `quote` | — |
| `embed` | `ref='node/<WID>' caption` |
| `pending` | `intent` |

**Inline**

| Element | Attributes |
|---|---|
| `text` | `id` |
| `date` | `value='YYYY-MM-DD'` |
| `mention` | `user`, `name`, `self` for a person; `ref` and `label` for a tab or doc |
| `dropdown` | `enum`, `index` |
| `comment` | `id`, plus `to='claude'`, `answered`, `continued` when set. It is a point marker placed where a thread starts |
| `gap` | `blocks` or `words` or `chars` |
| `hit` | `n`, `start`, `end` |
| `gone` | `id` |

Every block carries `h`. The block where the root's `rev` was first reported also carries `rev`.

---

## 6. Writing (`update` on a prose node)

Envelope: `update(ref:{node,NID}, engine:"prose", container:C, payload:{"ops":[…], "ifRev"?:N (restore only), "answering"?}, opId?)`. Ops apply in order and the whole call is atomic: a refused op means nothing landed.

A successful ack has this shape:

```json
{"verdict":"allow","rev":2,"session":"<sess>","xml":"<doc op='0'>…what op 0 wrote…</doc>",
 "keys":{…chip keys…},
 "data":{"notices":[{"code":"pending_ended","ids":["<sess>.71"],"as":"resolved","opIndex":0}],
         "filled":[{"op":0,"ref":"file/FID","label":"Second"}]}}
```

There is one `<doc op=k>` per op. The writer's session is stable across one agent's calls (the same `session` value appeared on every ack).

### 6.1 Ops

| op | target | other fields | notes |
|---|---|---|---|
| `insert` | `{kind:"blocks",ids:[one id]}` with `side:"before"\|"after"\|"end"\|"start"`; or `{kind:"root"}` with `side:"end"` | `source:{from, as, blocks?}`, `each?:true` | `end` on a heading appends to that heading's section. `end` on a table appends a row. `each:true` puts one copy at every listed id (one column across rows, at most 4096 per call). Two inserts at the same anchor in one call are refused (`same_anchor`). A multi-id target without `each` gives `place_arity` |
| `replace` | blocks, find, chars or cell | `with:{from, as, blocks?}`, guards | a whole-block replace needs guards. Filling a pending block needs none |
| `delete` | blocks, find or chars | guards for whole blocks | a find target deletes exactly the quoted text (leading space included). An empty-content replace is refused; use delete |
| `move` | blocks | `to:{target, side}` | |
| `set` | blocks | `attrs:{kind:"bullet"\|"ordered"\|"check"}` on a list; `attrs:{checked:true}` on a listItem | keeps ids and threads |
| `format` | find or chars | `add:[{type:"bold"},…]`, `remove`… | at most 16 adds and 16 removes per op (`too_many{dim:"marks"}`) |
| `restore` | — | `rev:N`, with `payload.ifRev` = current latest | must be the only op. Rewinds the tab, and only when nothing else changed since |

**Content sources**

- `from:{kind:"inline", content:string|array}` or `from:{kind:"blob", id:"blob/…"}` (blob ≤ 1 MiB; not allowed inside a batch member).
- `as` takes one of three values:
  - `"text"` rewrites in place and keeps chips, breaks, formatting and comments.
  - `"markdown"` rebuilds blocks from the markdown and drops anything not re-spelled. Losses are reported in `dropped` notices.
  - `"blocks"` takes a JSON node tree, e.g. a table row: `{"type":"row","content":[{"type":"cell","content":[{"type":"paragraph","content":[{"type":"text","text":"…"}]}]}]}`.

**Targets**

| Kind | Shape | Notes |
|---|---|---|
| Blocks | `{kind:"blocks", ids:[…full ids]}` | |
| Find | `{kind:"find", text, nth?, parentId?, within?:<cell target>, select?:"blocks"\|"cells", allowMultiple?, pattern?, caseSensitive?}` | See matching rules below |
| Chars | `{kind:"chars", range:[startCharId, endCharId]}` | |
| Cell | `{kind:"cell", table:<table id>, row, col}` | 0-based; row 0 is the header; `-1` is the last row or column. A cell replace needs `ifRev` |

Find matching rules:

- It matches literal text as it reads, with markdown markers stripped.
- It never crosses a chip, a line break or a block boundary.
- It is case-folded by default.
- Curly quotes and dashes do not match their ASCII cousins.
- `allowMultiple` covers at most 512 matches.

**Guards (optimistic concurrency)**

- A whole-block `replace`/`delete` needs, beside `"op"`, both `ifHash` (that block's latest `h`) and `ifRev` (the rev of the read that showed it). Alternatively it takes `force:true`.
- Several ids, or a cell by position, take `ifRev` alone.
- With no guard the call is refused `bad_request{problem:"missing_guard"}`.
- Not guarded: find and chars targets (unless `select` widens them to blocks or cells), inserts, and fills of pending blocks.
- On a guard failure the refusal returns the block as it stands now, with fresh `h` and `rev`.
- An ack's `rev` can stand in for a read's only for a block that ack created or replaced whole.

**Other per-op flags:** `allowDetach:true` (§8.4), `force:true`.

**Limits**

| What | Limit | Refusal |
|---|---|---|
| Ops per update | 64 | `too_many` |
| Members per batch | 64 | `too_many` |
| Inline content per call (summed across ops) | 32 KiB | `row_too_large`, `use:"blob"` |
| One source | 1 MiB | `dim:"source"` |
| Block or leaf edits one update resolves to | 20000 | `dim:"members"` |
| Text blocks one chars range may cross | 512 | `dim:"leaves"` |

### 6.2 Batch members

Each member has the shape `{verb:"create"|"update"|"delete"|"read", object|ref, engine?, payload, $lid?}`.

- `$lid` declares an alias, cited as `"$lid:<alias>"` in ids, refs and chip refs, *within that batch only*.
- `query` and `access` cannot be members (`batch-shape` / `must_stand_alone`).
- `opId` belongs at the batch root.
- The batch is atomic; the law is checked against its end state. For example, deleting the only tab and adding a new one in the same batch passes.
- The probe ran a 7-member batch: enum create, file create, prose node create with a dropdown chip, file→node link update, project `tabs` patch (`order` + `subtabOf`), widget create, and a prose insert carrying an embed chip plus a tab-mention chip. The result:
  - `lids:{f2,n2,s,w}`.
  - Each widget ack carried a `report`.
  - The mention chip was auto-labelled, reported as `data.filled[{ref:"file/FID", label}]`.

### 6.3 Project / file / enum updates (json engine)

- **Whole value:** `payload:{kind:"value", value:{…}}`.
- **Patch:** `payload:{kind:"patch", patch:[{op:"set"|"delete", path:[…], value?}]}`, e.g. `["tabs",FID,"order"]` or `["display","tabsLocation"]`. A bare `value` without `kind` is refused `shape`.
- **Text-engine tabs:**
  - Create with `{engine:"text", birthName, content:{kind:"text", text}}`.
  - Update with `{engine:"text", base:"<12-hex textHash>", splices:[{at, del, ins}]}`. A stale base is refused `text-stale`.

---

## 7. Markup grammar for content

- **Markdown** (GFM): `#`..`######` headings, paragraphs, `-`/`*` bullets, `1.` ordered lists (sub-points indented 4 spaces), `- [ ]`/`- [x]` tasks, pipe tables, `[text](url)` links, `**bold**`, fenced code blocks with a language, `![alt](blob/<id>)` images.
- **Special fences:**
  - ` ```latex ` holds bare TeX shown as a display formula.
  - ` ```csv ` shows as a read-only grid over editable text.
  - ` ```markdown ` shows rendered markdown as an exhibit.
  - ` ```mermaid ` blocks may exist and are edited in place.
- **In-doc anchor links:** `[x](#<heading block id>)`. A heading born in the same write can be linked by its GFM slug.
- **Chip tokens:** `<?claude block KEY?>`. It is an XML processing-instruction token that stands alone or sits inline. KEY maps to an entry in the `blocks` map, which sits **beside** `from`, never inside it (inside it is refused `bad_request`). A map is never empty. One key per chip; the same token may repeat to repeat the chip.

**Chip / block types** (the `blocks` map entries)

| `type` | Fields | Renders as |
|---|---|---|
| `date` | `value:"YYYY-MM-DD"` | date chip (actionable date) |
| `mention` | `user:"me"` or `user:"<user-id>"` (an id read from an existing mention) | person chip. The server resolves `name` and `self` |
| `mention` | `ref:"file/<FID>"` or `ref:"project/<PID>"` (exactly one segment pair) | link chip to a tab or another doc. Label auto-filled |
| `dropdown` | `enum:"<enum id or $lid:x>"`, `index?:n` | dropdown cell value drawn from an enum. A missing `index` means unpicked |
| `embed` | `ref:"node/<WID>"`, `caption` | a widget (chart or diagram), alone on its line |
| `pending` | `intent:"<what will go here>"` | placeholder block, shown to readers as planned work. Replaced by a fill (no guard needed). Fill notice: `pending_ended` |
| `paragraph` | — | one empty paragraph (used to clear a tab: `<?claude block empty?>`) |

**Doc conventions the server enforces or coaches (not hard rules):**

- The byline under the title is `date · mention(me)`.
- Statuses go in enum dropdown columns.
- The first sentence of the doc and of each section carries the point.

---

## 8. Comments ("utterances")

### 8.1 Creating a thread (anchored)

```json
create({object:"utterance", container:C, payload:{value:{
  body:"…≤4096 UTF-8 bytes…",
  parent:{object:"node", id:NID, anchor:{kind:"find", text:"3–6 words as in the doc", nth?, parentId?}}}}})
```

The ack shows the find anchor resolved to a **char range**:

```json
{"verdict":"allow","minted":"<uid>",
 "diff":[{"address":{…,"ref":{"object":"utterance","id":"<uid>"}},
          "after":{"body":"…","parent":{"object":"node","id":NID,"anchor":{"kind":"chars","range":["<sess>.31","<sess>.45"]}}}}],
 "anchor":{"quote":"quick brown fox","block":"<sess>.26"}}
```

- **Anchors** are char-id ranges, or table cells. Anchoring a whole block (`{kind:"blocks"}`) is refused `bad_request{problem:"anchor_kind"}`.
- **Placement:** the thread marker appears in the prose XML as `<comment id=…/>`, a point placed just before the anchored characters. The probe's text run was split at that point.
- **Survival:** because the anchor is a range of char ids, it survives edits elsewhere in the block. It becomes `detached` only when all of its anchored characters are removed (§8.4).
- **Anchor states** in a read: `attached`. `detached` is implied by the docs.

Widget anchors: comments can also target parts of a widget.

- Typed labels carry `data-claude-text-id`.
- Named groups carry `data-claude-anchor`.
- Data marks carry `datum(row, col)` provenance stamps.

The viewer's element path for such a comment looks like `f-<tab id>#<body id>/<block>…;thread=<root id>`.

### 8.2 Replies and resolve

- **Reply:** `parent:{object:"utterance", id:<thread root id>}` with no anchor. Replies always point at the root, not at another reply.
- **Resolve:** `create utterance` with `value:{kind:"resolve", parent:{object:"utterance", id:<root>}}`. It is a row in the thread log.
  - The probe was allowed to resolve a thread that the acting user had written.
  - Per the guide, an agent's resolve of a thread *another person* wrote in is refused (`utterance-author`). The rule is authorship-based; the acting principal resolving their own thread is allowed.
- **Reopen:** a person can reopen a thread from the UI.
- **Delete:** `delete(ref:{utterance,id}, container)` succeeded on a reply. Deleting a thread frees a place against the cap. Resolving does not.
- **Edit:** comment edits exist ("edit" is named in the body-limit rule). The edit verb shape was not observed; it is presumably `update` on the utterance.

### 8.3 Listing (`query`)

```json
query({object:"utterance", container:C, payload:{under:{object:"node"|"file"|"utterance", id}, limit?, afterSeq?}})
→ {"verdict":"allow","rows":[
   {"seq":11,"at":"2026-10-13T21:23:49.948Z","verb":"create","id":"<uid>",
    "actor":{"principal":"<user-id>","channel":"external","via":"mcp","self":true,"name":"<display name>"},
    "payload":{"value":{"body":"…","parent":{"id":NID,"anchor":{"kind":"chars","range":[…]},"object":"node"}}}},
   {"seq":12,…reply…}, {"seq":14,…"payload":{"value":{"kind":"resolve","parent":{…}}}}]}
```

- **`seq`** is a doc-wide monotonic event sequence, shared with other doc events: the probe's seq jumped 12→14. `afterSeq` returns only newer rows; the probe confirmed it.
- **`under`** scope:
  - a body node gives that tab's threads;
  - a file gives the tab's threads;
  - an utterance gives one thread.
- **Actor fields:**
  - `principal` is an opaque `u_` id plus 22 characters, stable per owner scope.
  - `name` is a user-chosen display name. It is not identity.
  - `guest:true` or `via:"frame_outside"` marks someone from outside the owner's org.
  - `self:true` marks the person the agent acts for.
- **Claude-directed fields:** `to:["claude"]` (born addressed to Claude) and `answered:true|false`.
- **Deletions:** deleted comments disappear from the list. To notice deletions, list again.

### 8.4 Comment-protecting edit law

- **`anchors_affected`:** an edit that would remove *all* anchored characters of an open thread is refused, with `data.utterances:[{id}]` and `opIndex`. The probe confirmed it by deleting the commented paragraph.
- **Overriding with `allowDetach:true`** (beside `"op"`): the thread stays open but detached, and the ack lists it in notices. The flag works only when:
  - the requesting person asked for the removal; and
  - for the thread being answered: the person sent it to Claude and is the only participant.
  - Otherwise, a refusal carrying `data.asking`.
- **`answering`:** an `update`'s `answering:"<root id>"` (or `payload.answering` inside a batch member) links the edit to the comment it fulfils.

### 8.5 "Send to Claude" flow

- **Trigger:** a writer replies with "Send to Claude", or @mentions Claude in a thread.
- **Activation:** this flags the thread `to:"claude"`, and the agent session receives a turn headed `[Artifact comment sent to Claude]` with `Artifact:` and `Element path: …;thread=<root id>`.
- **Expected response:** the agent edits (with `answering`), then replies in that thread with a doc `create utterance`.
- **Two comment systems:** the platform's generic artifact comment relay is resolved immediately and is not shown on docs. Doc comments live in the doc service, while other artifacts use the platform comment store (see the comments spec). Tool results on doc threads append a reminder not to use `ArtifactComments.reply`.
- **Answered flag:** `answered='true'` on a thread means another session already replied.

### 8.6 Limits

| What | Limit | Refusal |
|---|---|---|
| Threads per doc (resolved ones count) | 1000 | `too_many{dim:"threads"}` |
| Comments per thread, root included | 100 | `too_many{dim:"replies"}` |
| Body | 4096 UTF-8 bytes | `row_too_large{dim:"body", unit:"bytes"}` |

Display notes from the guide: a comment card fits about 40 characters per line, folds behind "Show more" after about 15 lines, and hides older replies behind "Show N replies".

---

## 9. Widgets (charts and diagrams)

- **Creating:** `create node` with `engine:"widget"`, `payload:{parent:{object:"file", id:FID}, code:"<TSX module>"}`. The parent is the **tab file**, not the body node (otherwise `bad_request{problem:"parent"}`). A widget shows only where an `embed` chip points at it.
- **Module contract:** `export default () => <svg viewBox='0 0 760 H' role='img' aria-label='…'>…</svg>;`, or a block body. Charts use `<claude.Visualize data-claude-component='<slug>' sources={{name:{kind:'data', data:[…]} | {kind:'ref', ref:'blob/<id>', adapter:{kind:'csv', hasHeader, columns:[{type:{kind:'literal', type:'string'|'number'|'bool'|'date'}, name?}]}}}}>{({name, datum}) => <svg/>}</claude.Visualize>`.
- **Lexical environment:** React, the `claude` bridge, and design-system components `Button`, `Tooltip`, `Menu`, `Popover`, `Dialog`, `Combobox` and `useToast` (listed in the ack's `report.manifest.cds`).
- **Validator rules**, observed by name in diagnostics:

| Rule | What it blocks |
|---|---|
| `no-imports` | ES imports ("React plus the lexical claude bridge are the whole world") |
| `eval-family` | `window`, `top`, `parent` and `self` as identifiers, even as locals; computed indexing `a[i]` (use `.at(i)`) |
| `provenance` | `<style>`, `<use>`, `<foreignObject>`; rendering values whose origin the validator cannot trace; `<title>` outside svg |
| `text-id` / `text-literal` | text ids must be literal and on literal text. Computed text uses `datum` instead |
| `segment-literal` | a non-literal `data-claude-anchor` |
| `unknown-component` | a component declared inside a function |
| `visualize-children` / `children-sources` | a `Visualize` without exactly one sync function child that destructures its sources |
| `visualize-no-datum-path` | hint only: no datum stamps |
| `provenance-r17` | design-system props must be literals |
| `widget-invalid` | publish gate |

- **Size limits:** ≤ 2000 rows and 256 KiB per inline source; ≤ 8 blob refs per widget; 1 MiB of code; no `fetch`.
- **Lifecycle** (versions are `pub` integers):

| Payload | Effect |
|---|---|
| `{kind:"draft", basePub, code}` | validates and publishes in one call, giving `outcome:"published"` and `report.status:"live"`. With errors it gives `outcome:"staged-with-errors"`: diagnostics, `note:"no manifest"`, and the published version unchanged |
| `{kind:"draft-edit", edits:[{quote:{exact, prefix?, suffix?}, replacement}]}` | up to 64 edits, all-or-nothing. Gives `report.status:"staged"` only. Fails with `quote-not-found` or `quote-ambiguous` |
| `{kind:"publish"}` | publishes the staged draft (gate: `widget-invalid`) |
| `{kind:"text", id:<text-id>, value}` | edits one typed label. **Publishes immediately** and bumps `pub` (probe: pub 1→2) |
| `{kind:"definition", path, value, basePub, component?}` | edits a definition chart (legacy declarative grammar). Refused `definition-stale` |
| `{kind:"spec-patch", patches:[{path:"definition.…"\|"sources.<name>", op:"set"\|"remove", value}]}` | 1–32 patches, no basePub. Fails with `patch-path` |

- **Concurrency:** a stale `basePub` is refused `widget-draft-stale` ("the draft names publish generation 1, but the block is at 3").
- **Ack `report`:** `{status:"live"|"staged"|"staged-with-errors", dataChecked, renderChecked?, diagnostics:[{class:"invalid-tsx"|"hint", rule, line, col, message, snippetChars}], manifest:{deps:{libs, sources, embeds}, cds:[…], charts:[]}}`, plus a top-level `verdict` and `outcome`.
- **Render checks:** the publish render check reports `report.render.errors`, e.g. `text_overlap` with "+N more".
- **Screenshot:** a server-side headless renderer at 1344 px wide (the probe's 760-unit viewBox rendered 1344×400 at pub 3). When there is no renderer: `unavailable{why:"render", problem:"dark"}`.
- **Theme tokens** (CSS variables; no literal colours advised):
  - text: `--cds-text-primary`, `--cds-text-secondary`
  - chart: `--cds-chart-{muted, grid, axis, reference, reference-tint}`, `--cds-chart-categorical-1…8`, `--cds-chart-status-{good, warning, serious, critical}`
- **Doc column:** 672 px wide on a laptop, so a 760-unit drawing scales to 0.88.
- **Legacy definition-chart grammar** (closed schema). Top-level kinds are `chart`, `stat` and `table`; for `chart`:
  - `axes` x of type time, band, linear or log, with `period`; y with min, max, free and side;
  - `marks` bar, line, area, point or tile;
  - splits `group`, `stack`, `hatch` and `dash`;
  - `annotations` rule and span;
  - `Format` number (d3-format spec) or time (strftime);
  - `Tone` cutoffs;
  - small multiples via `columns` and `wrap`.
  It refuses by name about 25 retired keys (`encoding`, `scales`, `color`, …). Over 5,000 rows must be aggregated.

---

## 10. Uploads and blobs

1. Upload bytes to the **doc's artifact asset store** with the Artifact tool. Its `upload_asset`-equivalent is a publish with `asset:true`, which returns a 32-hex `opaque_id`. Bytes never travel through the docs tools.
2. Record the upload with `create(object:"blob", engine:"blob", container:C, payload:{asset:"<opaque_id>", origin?:{call:{connector, tool, args}, display:{"<arg path>":"sql"|"code"|"json"|"text"|"datetime"}}})`. This returns `{id:"blob/<id>"}`. Any doc viewer can read `origin`, so never put secrets in it.
3. Use the blob from:
   - images in markdown: `![alt](blob/<id>)`;
   - widget sources: `{kind:'ref', ref:'blob/<id>'}`;
   - content imports: `from:{kind:"blob", id}`.

- **Immutability:** a blob is immutable. New data means a new upload, a new blob, and a widget update.
- **Errors:** a blob from another doc, or an upload not made to this doc's artifact, gives `not_minted` / "no blob with that id".
- **Export-to-blob** (probe): `create blob` with `payload:{from:{object:"file", id:FID}, format:"markdown"}` returned:

```json
{"verdict":"allow","id":"blob/94ba8130-f462","rev":4,"replayed":false,
 "data":{"asset":"<32-hex>","sha256":"<64-hex>","bytes":280,"mime":"text/markdown",
         "name":"zz clean-room probe.md","renderer":"md-v1","notes":[…same as export…]}}
```

The rendered file is stored in the artifact's assets and recorded as a blob of that tab.

---

## 11. Export

`export(container, file:FID, format, maxBytes?, paper?)` returns:

```json
{"verdict":"allow","rev":4,"data":{"name":"<doc name>.md","mime":"text/markdown","format":"markdown",
 "renderer":"md-v1","bytes":280,"bytes_b64":"…",
 "notes":[{"code":"kept_as_text","what":"date chip","construct":"date","count":1},
          {"code":"kept_as_text","what":"mention chip","construct":"mention","count":1},
          {"code":"kept_as_text","what":"ref chip","construct":"ref","count":1},
          {"code":"dropped","what":"embedded content (replaced by a text placeholder)","construct":"widget","count":1}]}}
```

Probe facts about the markdown export:

- **Chip rendering:** a date chip became `Oct 13, 2026`, a person mention became `@<name>`, and a tab mention became its label.
- **Widgets:** an embedded widget became the placeholder `&#91;embedded content: <caption>\]`.
- **Tasks:** stayed `- [ ]`.
- **Scope:** one tab per export.
- **Size limit:** `maxBytes` caps the inline result, up to an 11534336-byte maximum (11 MiB). A PDF with `maxBytes:100` was refused `doc_too_large{unit:"bytes", max:100, got:47553, was:"doc_ceiling"}` with the hint to export into a blob instead.
- **Formats:** pdf, docx, html, text, markdown and notion (Notion-flavoured markdown).
- **PDF paper size:** `paper` is `letter` or `a4`.

The UI equivalent is the doc name menu → Export: Word, PDF, Markdown, Google Docs copy, or Notion copy. It exports the open tab only and may be missing for view-only users.

---

## 12. Sharing and access

- **No docs tool shares a doc or lists access.** Sharing happens in the artifact's Share sheet in the claude.ai UI:
  - The author, Owner or Editor adds org members as view, comment or edit.
  - Outside guests and public links are offered where the plan allows.
- **Absence equals denial:** a doc that does not exist or is not shared reads `access` (`access_denied`), with an explicit hint that "absence and no-permission answer the same word".
- **Doc delete:** the owner can `delete(ref:{project,PID})`. Verified: afterwards, reading the id gives `unknown_id{why:"not_minted"}`.
- **Artifact shell:** whether the bound artifact shell in the gallery is also removed was not verified (see open questions).
- **No search:** there is no listing of docs by name. Discovery goes through the Artifact list (a doc is an artifact).
- **Projects and history:** docs cannot be placed in Projects. Version history is in the doc name menu; history is also reachable via `atRev` reads.

---

## 13. Relationship to Artifacts and the viewer

- **Typed artifact:** the "Docs" Artifact type (a type_url on the account's type list) is the shared viewer. A doc artifact is a typed artifact whose content lives in the doc service and is written through this connector, not as published files.
- **Binding:** `project.value.artifact = {slug:PID, bound:{by:"publish"}, org, ws, creator:{account, org}}`. The artifact slug equals the doc id. The binding records the org, workspace and creator.
- **Opening:** after birth the agent is expected to call the Artifact tool's `open` action on `frame.url`. Docs tools open nothing on the user's screen.
- **Live editing:** the viewer is a live collaborative editor. People type, tick boxes, pick dropdowns, edit widget label text in place, and comment. Agent writes "render live into the open doc".
- **Session ids:** human editors appear as other `session` prefixes in ids.
- **Load protection:** large-doc opens are rate-limited per account (`unavailable{why:"account_budget"}`, see `refusal.rate-limit`).
- **Hosting:** docs are served by per-doc "owning pods". Writes can be forwarded between pods (`forward-timeout`, `hop-timeout`, `hop-expired`). This implies a single-writer-per-doc actor model with request forwarding.

---

## 14. Refusals (codes, data and recovery)

Every refusal is atomic: nothing landed.

| reason / code | Trigger | Key `data` | Recovery |
|---|---|---|---|
| `access` | doc not visible or nonexistent | `hint` | ask the owner to share; check the id |
| `unknown_id` (`not_minted`, `no_such_session`) | an id this doc never minted | `ids`, `why`, `kind` | copy ids from acks or reads |
| `guard_mismatch` (sub-cases `swapped_target`, `table_moved`) | the block changed since the guarded read | `block`, `rev`, `h`, `blocks[{id,rev}]`, `xml` (current block), `opIndex`; for tables `rows`, `cols`, `columns`, `cells` | redo from the xml; never force over it |
| `find_none` | no match / nth past the end | `count`, `text`, `at`, `parentId`, `nth`, `cellText` | requote as the text currently reads |
| `char_gone` | char range deleted | — | use find |
| `block_gone` | block retired (by you or a person) | `op:"remove"`, `by` | do not re-create a block a person removed |
| `bad_request` | malformed request | `problem` ∈ required, unknown_key, type, enum, pattern, range, conflicts, empty, duplicate, relative_id, future_rev, wrong_object, unresolved_lid, unsupported, missing_guard, anchor_kind, parent, model_balance (`balance`: unclosed_begin, unmatched_end, duplicate_id, zero_span, point_not_comment), …; plus `at`, `issues[{path, why, expected}]`, `expected`, `was` (intent_shape, bad_op, same_anchor, lid_reserved) | fix and resend everything |
| `missing_guard` | an unguarded whole-block replace/delete | `op`, `opIndex` | add `ifHash` + `ifRev`, or `force` |
| `anchors_affected` | the edit would orphan a thread | `utterances`, `opIndex`, `asking?` | narrow the edit, or use `allowDetach` |
| `last_tab` | deleting the only tab | `member` | rewrite the contents instead |
| `last_block` (`shape_mismatch{need:"last_block"}`) | emptying a tab | — | replace with an empty paragraph |
| `same_anchor` / `lid_reserved` / duplicate `$lid` | duplicate declarations | — | merge or rename |
| `place_arity` (`bad_at`) | a multi-id insert place, or a chip ref with more than one segment pair | — | name one block, or use `each` |
| `cell_none` (`bad_at{kind:"cell"}`) | position off the table | `seat` (row, col, span, table), `rows`, `cols`, `header`, `columns` | re-aim |
| `too_many` | a count cap | `dim`, `got`, `limit` | split |
| `row_too_large` (`request_too_large`) | a size cap | `got`, `max`, `dim`, `use:"blob"`, `unit` | split, or go through a blob |
| `doc_too_large` (`doc_ceiling`) | export over `maxBytes` | `unit`, `max`, `got`, `format` | export to a blob |
| `parent` (`bad_parent`) | the parent is not live in this doc | `root` | use the right parent kind |
| `batch-shape` (`must_stand_alone`) | query/access as a member; a member opId | — | call standalone |
| `shape` | wrong payload cell for verb × engine | — | see §6.3 |
| `exists` | doc already bound to that artifact | `minted?`, `lids?` | use the existing doc |
| `text-stale` | text-engine splice base out of date | — | recompute |
| `widget-invalid` (`widget_compile_error`) | publish gate | diagnostic, `render` | fix, then send a draft |
| `widget-draft-stale` / `definition-stale` | stale `basePub` | — | re-read the pub |
| `quote-not-found` / `quote-ambiguous` | draft-edit quote | — | requote |
| `patch-path` | spec-patch on a single row | — | send the whole source |
| `utterance-author` | resolving a thread another person wrote in | — | leave it open |
| `unavailable` | backend road down | `why` ∈ render, artifact_road, blob_road, room, engine, scan_pending, busy, db_timeout, db_unavailable, account_budget; `retryAfterMs`; `outcome:"unknown"` with `was` ∈ forward-timeout, hop-timeout, hop-expired (+`committed:false`) | retry once after `retryAfterMs` with the **same opId**; `replayed:true` means it had already landed |
| `rate-limit` | per-minute budgets (screenshots, large-doc opens) | — | back off |

**Notices** come on successful writes, in `data.notices[]` with `op`/`opIndex`:

| Notice | Meaning |
|---|---|
| `pending_ended` (`as:"resolved"`) | a pending block was filled |
| `dropped {id}` / `dropped {container, unset:[…]}` | a chip, break, image or formatting was lost |
| `dropped_with` | a block retired along with what it held |
| `dropped {what}` | content that could not be imported |
| `edited_since` | someone else edited inside a re-created block |
| detached threads | reported after an `allowDetach` edit |

**Notes** (`notes[]`): `tabs_set_left`, `threads_omitted`, `kept_as_text`, `dropped`.

**Timeouts and retry:** writes forwarded to a doc's owning pod can time out. The result is then an `unknown` outcome. The caller retries the identical body with the identical `opId`; the server dedupes and answers `replayed:true` if the first attempt landed. Without an `opId`, the caller must read before resending. Transient `why` values come with a `retryAfterMs` hint. No numeric timeout values were observed.

---

## 15. Concurrency model (summary for implementers)

1. **CRDT-style identity:** every character and block carries a globally unique `<session>.<clock>` id. Ids are never reused, so edits address stable ids rather than offsets.
2. **Two guard tiers:**
   - a block content hash (`h`, which sees letters only);
   - a node revision (`rev`, which sees everything, including formatting, chips and moves).
   Whole-block overwrites must present both; text-level edits are self-guarding through find/chars.
3. **Atomic multi-op calls:** within a node update and within a batch, either all ops apply or none do.
4. **Idempotency:** `opId` on writes; replays return the original ack plus `replayed:true`.
5. **History:** every rev is readable (`atRev`); `restore` rewinds a tab when nothing changed since.
6. **Incremental sync:** `sinceRev` reads for prose, `afterSeq` for the comment and event log.
7. **Widgets:** a separate versioning track (`pub`) with draft and published states and a validator plus render gate.

---

## Open questions / not observable

- **Wire transport:** the HTTP endpoint, auth scheme (OAuth via claude.ai connector), MCP protocol version and session handling are invisible from the tool layer.
- **Hash algorithm:** `h` for single characters matched SHA-256[0:8] of the text. Multi-run and structural hashes were not verified.
- **Per-character id cost:** whether every character consumes a clock tick is inferred from id gaps (e.g. `.27`→`.31` across "The "), not confirmed.
- **Comment edit and reopen:** the exact shape of a comment edit (`update` on an utterance?) and of a reopen was not exercised.
- **Real-time channel:** how the viewer gets live updates (websocket / "room") is not visible here. `unavailable{why:"room"}` hints at a room service per doc.
- **Doc delete and the artifact:** whether deleting the doc removes, or leaves blank, the bound Artifact in the gallery. The probe's artifact URL (probe doc URL redacted) may persist as an empty shell.
- **Timeout values:** numeric timeouts and `retryAfterMs` ranges; rate-limit budgets (per-minute screenshot and large-doc-open counts).
- **`container.version`:** semantics of the parameter in the schema.
- **`read` as a batch member:** the verb list includes `read`, but no batch read was observed.
- **`notion` export:** its exact dialect.
- **Guest permissions:** how guest and public-link permissions map onto docs operations (view/comment/edit roles enforced server-side).
- **Display name and principal:** whether the display name in `query` rows is resolved per viewer or stored, and how stable `principal` is across orgs (documented as stable only within one owner's artifacts).
- **`answering`:** server-side effects beyond the comment law, e.g. whether it marks the thread `answered`.
