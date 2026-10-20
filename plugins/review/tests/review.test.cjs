const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { check } = require("../scripts/check-reply.cjs");
const { parseMap, isRed, isDocs, DEFAULT_RED } = require("../scripts/lib.cjs");
const { assess, sinceReply } = require("../scripts/risk.cjs");

const COMMITS = ["93e9048a1b2c3d4e5f60718293a4b5c6d7e8f901", "f38528b0c1d2e3f405162738495a6b7c8d9e0f12"];
const HEAD = "f38528b";

const MAP = `<!-- review-map -->
## Review map · #12 · 2026-10-19

**Head:** 93e9048
**Blast radius:** high (auth) · **Door:** one-way (migration) · **Depth:** deep

## 1. Decisions to check

| # | Decision | Guessed | Why | Verdict | Resolution |
|---|---|---|---|---|---|
| L1 | Retry the token refresh 3 times | 1 or 5 | matches the client | WRONG: retries a revoked token | MUST-FIX |
| L2 | Cache sessions per tenant | global cache | isolation | RISKY: no eviction under load | open |
| L3 | Keep the old column | drop it | Risky to drop before rollback is tested | SOUND | - |

## 3. Resolve before merge

### G1 · Threshold test only checks a far miss
**Finding:** The threshold test only checks a far miss, so the 69/70/71 boundary is untested.

### C1 · Proxy half of the ticket
**Finding:** The ticket asks for proxy settings on aggregated portfolios; the diff only handles tax lots.

## 4. Independent review

### R1 · Null tenant returns every row
**Failure scenario:** A request with a null tenant id at query.ts:88 returns rows for every client.

### S1 · Unused import in adapter.ts
**Finding:** adapter.ts still imports lodash.

### P1 · Off-by-one in pager
**Finding:** The pager skips the last row; predates this PR.

## 5. Escalations

### E1 · Ship behind a flag or not
**Call:** The reviewer and auditor disagree on whether this needs a flag. YOUR CALL.

<details><summary>Seat reports</summary>

\`\`\`\`text
### G9 · a heading inside a seat report
\`\`\`
nested fence
\`\`\`
\`\`\`\`

</details>
`;

const GOOD = {
  L1: "changed in 93e9048",
  L2: "kept: sessions are capped at 500 per tenant by the gateway, so the cache cannot grow unbounded",
  G1: "fixed in 93e9048",
  C1: 'ticket now says: "Proxy settings on aggregated portfolios move to SE-2210"',
  R1: "fixed in f38528b",
  S1: "won't fix: lodash is tree-shaken by the bundler and removing it touches six other modules",
  P1: "filed as #31",
  E1: "decided: ship behind the beta flag until the March load test passes",
};

const { items } = parseMap(MAP);

function reply(over = {}, { marker = true, head = HEAD, drop = [], extra = "" } = {}) {
  const d = { ...GOOD, ...over };
  return (marker ? "<!-- review-address -->\n" : "") + "Response.\n" + (head ? `**Head:** ${head}\n` : "") + "\n" +
    items.filter((i) => !drop.includes(i.id))
      .map((i) => `### ${i.id} · ${i.title}\n**Disposition:** ${d[i.id]}\n**Detail:** see commit.\n`).join("\n") + extra;
}

const run = (text, closed = false) => check({ items, reply: text, commits: COMMITS, closed });

function fails(text, re, closed = false) {
  const r = run(text, closed);
  assert.strictEqual(r.ok, false, "expected a failure");
  assert.ok(r.errors.some((e) => re.test(e.message)), `no error matched ${re}:\n${r.errors.map((e) => e.message).join("\n")}`);
}

// --- parseMap ---

test("the map yields RISKY/WRONG rows and ### items, not SOUND rows or fenced headings", () => {
  assert.deepStrictEqual(items.map((i) => `${i.id}:${i.kind}`),
    ["L1:row", "L2:row", "G1:gaming", "C1:contradiction", "R1:red", "S1:other", "P1:preexisting", "E1:escalation"]);
});
test("the map header yields head, door and depth", () => {
  const m = parseMap(MAP);
  assert.deepStrictEqual([m.head, m.door, m.depth], ["93e9048", "one-way", "deep"]);
});

// --- check-reply ---

test("a reply closing every item passes", () => assert.deepStrictEqual(run(reply()).errors, []));
test("missing marker fails", () => fails(reply({}, { marker: false }), /marker/));
test("missing Head fails", () => fails(reply({}, { head: null }), /Head/));
test("Head not on the PR fails", () => fails(reply({}, { head: "abcdef1" }), /Head abcdef1/));
test("an item with no block fails", () => fails(reply({}, { drop: ["R1"] }), /R1.*no response/));
test("an item answered twice fails", () =>
  fails(reply({}, { extra: "\n### G1 · again\n**Disposition:** fixed in f38528b\n" }), /G1.*more than once/));
test("an unknown item fails", () =>
  fails(reply({}, { extra: "\n### G9 · made up\n**Disposition:** fixed in 93e9048\n" }), /G9.*not an item/));
test("a heading with no id fails", () =>
  fails(reply({}, { extra: "\n### Notes\n**Disposition:** fixed in 93e9048\n" }), /no item id/));
test("two dispositions fail", () =>
  fails(reply().replace("**Disposition:** fixed in f38528b\n", "**Disposition:** fixed in f38528b\n**Disposition:** fixed in 93e9048\n"), /more than one/));
test("a sha not on the PR fails", () => fails(reply({ G1: "fixed in deadbee" }), /deadbee.*not a commit/));
test("a placeholder fails", () => fails(reply({ R1: "dismissed: parked for the author to decide later on" }), /placeholder/));
test("a disposition the kind doesn't allow fails", () => fails(reply({ L2: "fixed in 93e9048" }), /not an allowed disposition for a row/));
test("a short reason fails", () => fails(reply({ L2: "kept: fine" }), /too short/));
test("a reason restating the finding fails", () =>
  fails(reply({ S1: "won't fix: adapter.ts still imports lodash, unused import" }), /restates/));
test("a short ticket quote fails", () => fails(reply({ C1: 'ticket now says: "ok"' }), /quote is too short/));
test("deferral needs a ticket and a reason", () => {
  assert.ok(run(reply({ S1: "deferred to #44: needs the bundler upgrade that lands next sprint first" })).ok);
  fails(reply({ S1: "deferred to later: needs the bundler upgrade first" }), /not an allowed/);
});
test("an escalation must be a question", () => {
  assert.ok(run(reply({ C1: "escalated: should proxy settings on aggregates ship in this PR or SE-2210?" })).ok);
  fails(reply({ C1: "escalated: owner to look at it" }), /not an allowed/);
});
test("--closed rejects an open escalation", () =>
  fails(reply({ C1: "escalated: should proxy settings on aggregates ship in this PR or SE-2210?" }), /not yet decided/, true));
test("pre-existing items can't be dismissed", () =>
  fails(reply({ P1: "dismissed: the pager is going away next quarter anyway" }), /not an allowed/));

test("a WRONG row can't be kept", () =>
  fails(reply({ L1: "kept: the client library already retries revoked tokens safely upstream" }), /WRONG row/));
test("a RISKY row or S item can be dismissed after a concession", () =>
  assert.ok(run(reply({ L2: "dismissed: re-checker conceded the gateway caps sessions at 500 per tenant",
    S1: "dismissed: re-checker conceded lodash is used by the debounce helper two lines below" })).ok));
test("an escalation item closes only with the human's call", () =>
  fails(reply({ E1: "fixed in 93e9048" }), /not an allowed disposition for a escalation/));

// --- RED paths and docs ---

test("RED defaults catch agent instructions, migrations and workflows", () => {
  for (const f of ["AGENTS.md", "plugins/x/skills/y/SKILL.md", "db/migrations/001.sql", ".github/workflows/ci.yml", "src/auth/login.ts"])
    assert.ok(isRed(f, DEFAULT_RED), f);
  assert.ok(!isRed("src/format.ts", DEFAULT_RED));
});
test("docs exclude RED markdown", () => {
  assert.ok(isDocs("docs/guide.md", DEFAULT_RED));
  assert.ok(isDocs("README", DEFAULT_RED));
  assert.ok(!isDocs("skills/x/SKILL.md", DEFAULT_RED));
  assert.ok(!isDocs("src/a.ts", DEFAULT_RED));
});
test("depth is deep on any RED file or over 1,000 lines", () => {
  assert.strictEqual(assess("10\t2\tsrc/a.ts\0", DEFAULT_RED).depth, "light");
  assert.strictEqual(assess("1\t0\tdb/migrations/1.sql\0", DEFAULT_RED).depth, "deep");
  assert.strictEqual(assess("900\t101\tsrc/a.ts\0-\t-\timg.png\0", DEFAULT_RED).depth, "deep");
  assert.strictEqual(assess("900\t100\tsrc/a.ts\0", DEFAULT_RED).changedLines, 1000);
  assert.strictEqual(assess("900\t100\tsrc/a.ts\0", DEFAULT_RED).depth, "light");
});

test("--since ignores base's files and docs, keeps the PR's code", () => {
  const sameAsBase = (f) => f === "db/migrations/1.sql";       // came in with Update branch
  const r = sinceReply(["db/migrations/1.sql", "docs/a.md", "src/a.ts", "skills/x/SKILL.md"], sameAsBase, () => false, DEFAULT_RED);
  assert.deepStrictEqual(r.changed, ["docs/a.md", "src/a.ts", "skills/x/SKILL.md"]);
  assert.deepStrictEqual(r.code, ["src/a.ts", "skills/x/SKILL.md"]);
  assert.deepStrictEqual(r.red, ["skills/x/SKILL.md"]);
});
test("--since counts a PR file reverted to base after the reply", () => {
  const r = sinceReply(["src/fix.ts"], () => true, (f) => f === "src/fix.ts", DEFAULT_RED);
  assert.deepStrictEqual(r.code, ["src/fix.ts"]);
});
test("prompt-bearing markdown is RED, not docs", () => {
  for (const f of ["plugins/x/skills/y/references/notes.md", "plugins/x/commands/go.md", ".claude/agents/a.md", "docs/review-brief.md"])
    assert.ok(!isDocs(f, DEFAULT_RED), f);
});
test("numstat is read NUL-separated, so odd names aren't misparsed", () => {
  const r = assess('1\t0\tdb/migrations/"q\tx".sql\0' + "2\t0\tsrc/a b.ts\0", DEFAULT_RED);
  assert.deepStrictEqual(r.files.map((f) => f.file), ['db/migrations/"q\tx".sql', "src/a b.ts"]);
  assert.deepStrictEqual(r.red, ['db/migrations/"q\tx".sql']);
});
test(".review/red-paths is itself RED", () => assert.ok(isRed(".review/red-paths", DEFAULT_RED)));

// --- the documented format and the scripts agree ---

test("map-format.md's skeletons parse and check", () => {
  const doc = fs.readFileSync(path.join(__dirname, "../references/map-format.md"), "utf8");
  const blocks = [...doc.matchAll(/^````markdown\n([\s\S]*?)^````$/gm)].map((m) => m[1]);
  assert.strictEqual(blocks.length, 2, "map and reply skeletons");
  const map = parseMap(blocks[0]);
  assert.deepStrictEqual(map.items.map((i) => i.id), ["L3", "L1", "G1", "C1", "R1", "S1", "P1", "E1"]);
  const ok = { L3: "changed in 93e9048", L1: "changed in 93e9048", G1: "fixed in 93e9048", C1: "changed in 93e9048",
    R1: "fixed in 93e9048", S1: "fixed in 93e9048", P1: "filed as #7", E1: "decided: merge it behind the flag" };
  const text = "<!-- review-address -->\n**Head:** 93e9048\n\n" +
    map.items.map((i) => `### ${i.id} · x\n**Disposition:** ${ok[i.id]}\n`).join("\n");
  assert.deepStrictEqual(check({ items: map.items, reply: text, commits: COMMITS, closed: true }).errors, []);
  assert.match(blocks[1], /<!-- review-address -->/);
  assert.match(blocks[1], /\*\*Head:\*\*/);
});
