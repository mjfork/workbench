const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { main } = require("../scripts/forge.cjs");

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "forge-"));
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));
const file = (name, text) => { const p = path.join(TMP, name); fs.writeFileSync(p, text); return p; };

// ---------- harness: drive main() with injected transports ----------

// state.git: { remote, branch, posters, calls }
function makeIo({ remote, env = {}, gh, ado, posters = null, branch = "feature/x" }) {
  const rec = { exec: [], fetch: [], out: "", err: "" };
  const io = {
    env: { ...env },
    cwd: "/work",
    readFile: (p) => fs.readFileSync(p, "utf8"),
    out: (s) => { rec.out += s; },
    err: (s) => { rec.err += s; },
    exec(cmd, args, opts = {}) {
      rec.exec.push({ cmd, args, cwd: opts.cwd });
      const ok = (stdout = "") => ({ status: 0, stdout, stderr: "" });
      const bad = (stderr = "fail") => ({ status: 1, stdout: "", stderr });
      if (cmd === "git") {
        if (args[0] === "remote") return remote == null ? bad("no origin") : ok(remote + "\n");
        if (args[0] === "branch") return ok(branch + "\n");
        if (args[0] === "show") {
          const m = /^(?:origin\/)?(.+):\.vet\/posters$/.exec(args[1]);
          if (m && posters != null) {
            rec.postersRef = args[1];
            return ok(posters);
          }
          return bad("missing");
        }
        return ok();
      }
      if (cmd === "cmd.exe" || cmd === "az") {
        rec.tokenCalls = (rec.tokenCalls || 0) + 1;
        rec.azInvocation = { cmd, args };
        return ok("az-token\n");
      }
      if (cmd === "gh") return gh ? gh(args, rec, ok, bad) : bad("no gh fake");
      return bad("unexpected " + cmd);
    },
    async fetch(url, init = {}) {
      rec.fetch.push({ url, method: init.method || "GET", headers: init.headers || {}, body: init.body });
      const r = await ado(url, init, rec);
      return { status: r.status ?? 200, text: async () => (typeof r.body === "string" ? r.body : JSON.stringify(r.body ?? {})) };
    },
  };
  return { io, rec };
}

async function run(opts, ...argv) {
  const { io, rec } = makeIo(opts);
  const code = await main(argv, io);
  return { code, rec, json: () => JSON.parse(rec.out) };
}

// ---------- fake GitHub (gh) ----------

const GH_PR = {
  number: 12, url: "https://github.com/o/r/pull/12", title: "T", body: "B", headRefOid: "abc123",
  headRefName: "feature/x", baseRefName: "main", author: { login: "alice" }, state: "OPEN", isDraft: false,
  closingIssuesReferences: [{ number: 7, url: "https://github.com/o/r/issues/7" }],
  commits: [{ oid: "c1", messageHeadline: "first" }],
  reviews: [{ author: { login: "bob" }, state: "APPROVED" }],
  comments: [
    { id: "N1", url: "https://github.com/o/r/pull/12#c1", author: { login: "alice" }, authorAssociation: "OWNER", body: "hi", createdAt: "2026-01-01T00:00:00Z", includesCreatedEdit: false, isMinimized: false },
    { id: "N2", url: "https://github.com/o/r/pull/12#c2", author: { login: "mallory" }, authorAssociation: "NONE", body: "x", createdAt: "2026-01-02T00:00:00Z", includesCreatedEdit: true, isMinimized: true },
    { id: "N3", url: "https://github.com/o/r/pull/12#c3", author: { login: "carol" }, authorAssociation: "COLLABORATOR", body: "y", createdAt: "2026-01-03T00:00:00Z", includesCreatedEdit: false, isMinimized: false },
  ],
};

function ghFake() {
  return (args, rec, ok, bad) => {
    const a = args.join(" ");
    rec.gh = rec.gh || [];
    rec.gh.push(args);
    if (args[0] === "pr" && args[1] === "view") return ok(JSON.stringify(GH_PR));
    if (args[0] === "pr" && args[1] === "comment") return ok("\nhttps://github.com/o/r/pull/12#issuecomment-1\n\n");
    if (args[0] === "issue" && args[1] === "view") return ok(JSON.stringify({ number: 7, title: "Bug", body: "desc", url: "https://github.com/o/r/issues/7" }));
    if (args[0] === "issue" && args[1] === "create") return ok("Creating issue...\n\nhttps://github.com/o/r/issues/9\n\n");
    if (args[0] === "api" && args[1] === "user") return ok("alice\n");
    if (/^(label create|pr edit|pr checkout|api graphql|api repos)/.test(a)) return ok("");
    return bad("unhandled gh " + a);
  };
}

// ---------- fake Azure DevOps (REST) ----------

const ORG = "https://dev.azure.com/acme";
function adoFake(over = {}) {
  const state = {
    pr: {
      pullRequestId: 12, title: "T", description: "B", sourceRefName: "refs/heads/feature/x", targetRefName: "refs/heads/main",
      status: "active", isDraft: false, createdBy: { uniqueName: "alice@acme.com" },
      lastMergeSourceCommit: { commitId: "abc123" },
      repository: { name: "repo", project: { name: "Proj One" } },
      reviewers: [
        { uniqueName: "bob@acme.com", vote: 10 }, { uniqueName: "dan@acme.com", vote: -10 },
        { uniqueName: "eve@acme.com", vote: 0 }, { uniqueName: "fay@acme.com", vote: 5 }, { uniqueName: "gus@acme.com", vote: -5 },
        { uniqueName: "hal@acme.com", vote: 3 },
      ],
      ...(over.pr || {}),
    },
    threads: over.threads || [
      { id: 3, status: "active", comments: [{ id: 1, commentType: "text", content: "late", author: { uniqueName: "alice@acme.com" }, publishedDate: "2026-01-03T00:00:00Z", lastContentUpdatedDate: "2026-01-03T00:00:00Z" }] },
      { id: 1, status: "active", comments: [{ id: 1, commentType: "system", content: "joined", author: { uniqueName: "x" }, publishedDate: "2026-01-01T00:00:00Z", lastContentUpdatedDate: "2026-01-01T00:00:00Z" }] },
      { id: 2, status: "closed", comments: [
        { id: 1, commentType: "text", content: "early", author: { uniqueName: "mallory@evil.com" }, publishedDate: "2026-01-02T00:00:00Z", lastContentUpdatedDate: "2026-01-02T00:00:01Z" },
        { id: 2, commentType: "text", content: "gone", isDeleted: true, author: { uniqueName: "alice@acme.com" }, publishedDate: "2026-01-02T01:00:00Z", lastContentUpdatedDate: "2026-01-02T01:00:00Z" },
        { id: 3, commentType: "text", content: "edited", author: { uniqueName: "alice@acme.com" }, publishedDate: "2026-01-02T02:00:00Z", lastContentUpdatedDate: "2026-01-02T02:00:03Z" },
      ] },
    ],
    workitems: over.workitems || [{ id: "55", url: "x" }],
    list: over.list || [],
  };
  const handler = async (url, init, rec) => {
    const method = init.method || "GET";
    const u = new URL(url);
    const p = decodeURIComponent(u.pathname);
    rec.auth = (init.headers || {}).Authorization;
    if (p === "/acme/_apis/connectionData") return { body: { authenticatedUser: { providerDisplayName: "Alice", properties: { Account: { $value: "alice@acme.com" } } } } };
    if (p === "/acme/_apis/git/pullrequests/12") return { body: state.pr };
    if (p === "/acme/Proj One/_apis/git/repositories/repo/pullrequests" && method === "GET") {
      rec.listQuery = u.search;
      return { body: { value: state.list } };
    }
    const base = "/acme/Proj One/_apis/git/repositories/repo/pullRequests/12";
    if (p === base + "/threads" && method === "GET") return { body: { value: state.threads } };
    if (p === base + "/threads" && method === "POST") return { body: { id: 99, comments: [{ id: 1 }] } };
    if (/\/threads\/\d+$/.test(p) && method === "PATCH") return { body: {} };
    if (p === base + "/commits") return { body: { value: [{ commitId: "c1", comment: "first" }] } };
    if (p === base + "/workitems") return { body: { value: state.workitems } };
    if (p === base + "/labels" && method === "POST") return { body: { name: "x" } };
    if (p === base + "/statuses" && method === "POST") return { body: {} };
    if (p === "/acme/Proj One/_apis/git/repositories/repo/pullRequests/12" && method === "PATCH") return { body: {} };
    if (p === "/acme/_apis/wit/workitems/55") return { body: { id: 55, fields: { "System.Title": "Story", "System.Description": "<p>d</p>", "Microsoft.VSTS.Common.AcceptanceCriteria": "<p>ac</p>" } } };
    if (/\/_apis\/wit\/workitems\/\$/.test(p) && method === "POST") return { body: { id: 77 } };
    return { status: 404, body: "nope " + method + " " + p };
  };
  handler.state = state;
  return handler;
}

const ADO_REMOTE = "https://acme@dev.azure.com/acme/Proj%20One/_git/repo";
const gh = (extra = {}) => ({ remote: "git@github.com:o/r.git", gh: ghFake(), ...extra });
const az = (extra = {}) => ({ remote: ADO_REMOTE, ado: adoFake(extra.fake), env: { VET_ADO_TOKEN: "tok" }, ...extra });
const HOSTS = { github: gh, azure: az };

// ============ Host selection ============

const SHAPES = [
  ["https://dev.azure.com/acme/Proj/_git/repo", "acme", "Proj", "repo"],
  ["https://user@dev.azure.com/acme/Proj/_git/repo", "acme", "Proj", "repo"],
  ["https://acme.visualstudio.com/Proj/_git/repo", "acme", "Proj", "repo"],
  ["https://acme.visualstudio.com/DefaultCollection/Proj/_git/repo", "acme", "Proj", "repo"],
  ["git@ssh.dev.azure.com:v3/acme/Proj/repo", "acme", "Proj", "repo"],
  ["acme@vs-ssh.visualstudio.com:v3/acme/Proj/repo", "acme", "Proj", "repo"],
  ["https://dev.azure.com/acme/My%20Proj/_git/my%20repo", "acme", "My Proj", "my repo"],
  ["git@ssh.dev.azure.com:v3/acme/My%20Proj/my%20repo", "acme", "My Proj", "my repo"],
];
for (const [remote, org, project, repo] of SHAPES) {
  test(`detect: ${remote}`, async () => {
    const r = await run({ remote }, "detect");
    assert.strictEqual(r.code, 0);
    assert.deepStrictEqual(r.json(), { host: "azure", org, project, repo });
  });
}
for (const remote of ["https://github.com/o/r.git", "git@github.com:o/r.git", "ssh://git@github.com/o/r"]) {
  test(`detect github: ${remote}`, async () => {
    const r = await run({ remote }, "detect");
    assert.strictEqual(r.json().host, "github");
  });
}
test("env override forces the host", async () => {
  const r = await run({ remote: "https://git.example.com/o/r", env: { VET_FORGE: "github" } }, "detect");
  assert.strictEqual(r.json().host, "github");
  const a = await run({ remote: "https://github.com/o/r", env: { VET_FORGE: "azure", VET_ADO_ORG: "acme" } }, "detect");
  assert.strictEqual(a.json().host, "azure");
  assert.strictEqual(a.json().org, "acme");
});
test("an ADO org can come from the environment when the remote does not say", async () => {
  const r = await run({ remote: "https://git.example.com/o/r", env: { VET_FORGE: "azure", VET_ADO_ORG: "acme", VET_ADO_PROJECT: "P" } }, "detect");
  assert.strictEqual(r.json().org, "acme");
  assert.strictEqual(r.json().project, "P");
});
test("unrecognised remote is an error naming the override", async () => {
  const r = await run({ remote: "https://git.example.com/o/r" }, "detect");
  assert.notStrictEqual(r.code, 0);
  assert.match(r.rec.err, /VET_FORGE/);
});

for (const [name, mk] of Object.entries(HOSTS)) {
  for (const ref of ["12", "#12", name === "github" ? "https://github.com/o/r/pull/12" : "https://dev.azure.com/acme/Proj%20One/_git/repo/pullrequest/12"]) {
    test(`${name}: PR named as ${ref}`, async () => {
      const r = await run(mk(), "pr-view", ref);
      assert.strictEqual(r.code, 0, r.rec.err);
      assert.strictEqual(r.json().number, 12);
    });
  }
  test(`${name}: bad PR reference is a clear error`, async () => {
    const r = await run(mk(), "pr-view", "banana");
    assert.notStrictEqual(r.code, 0);
    assert.match(r.rec.err, /pull request/i);
  });
}

// ============ pr-view ============

const FIELDS = ["number", "url", "title", "body", "headRefOid", "headRefName", "baseRefName", "author", "state", "isDraft", "closingIssues", "commits", "reviews", "comments"];
for (const [name, mk] of Object.entries(HOSTS)) {
  test(`${name}: pr-view prints the normalized object`, async () => {
    const r = await run(mk(), "pr-view", "12");
    const j = r.json();
    for (const f of FIELDS) assert.ok(f in j, `${name} missing ${f}`);
    assert.strictEqual(j.title, "T");
    assert.strictEqual(j.body, "B");
    assert.strictEqual(j.headRefOid, "abc123");
    assert.strictEqual(j.headRefName, "feature/x");
    assert.strictEqual(j.baseRefName, "main");
    assert.strictEqual(j.state, "OPEN");
    assert.strictEqual(j.isDraft, false);
    assert.strictEqual(j.closingIssues.length, 1);
    assert.strictEqual(j.commits[0].oid, "c1");
    assert.ok(j.reviews.length >= 1);
    for (const c of j.comments) for (const f of ["id", "url", "author", "body", "createdAt", "edited", "isMinimized", "trusted"]) assert.ok(f in c, `comment missing ${f}`);
  });
}

test("azure: state maps active/abandoned/completed", async () => {
  for (const [s, want] of [["active", "OPEN"], ["abandoned", "CLOSED"], ["completed", "MERGED"]]) {
    const r = await run(az({ fake: { pr: { status: s } } }), "pr-view", "12");
    assert.strictEqual(r.json().state, want);
  }
});
test("azure: author and url", async () => {
  const j = (await run(az(), "pr-view", "12")).json();
  assert.strictEqual(j.author.login, "alice@acme.com");
  assert.strictEqual(j.url, "https://dev.azure.com/acme/Proj%20One/_git/repo/pullrequest/12");
});
test("azure: comments skip system threads and deleted comments, sort by time, flag edited and minimized", async () => {
  const j = (await run(az(), "pr-view", "12")).json();
  assert.deepStrictEqual(j.comments.map((c) => c.body), ["early", "edited", "late"]);
  const [early, edited, late] = j.comments;
  assert.strictEqual(early.edited, false, "1s later is not an edit");
  assert.strictEqual(edited.edited, true, "3s later is an edit");
  assert.strictEqual(late.edited, false);
  assert.strictEqual(early.isMinimized, true);
  assert.strictEqual(late.isMinimized, false);
  assert.match(early.url, /discussionId=2/);
});
test("azure: minimized for closed, fixed, wontFix and byDesign threads", async () => {
  for (const status of ["closed", "fixed", "wontFix", "byDesign", "active", "pending"]) {
    const threads = [{ id: 1, status, comments: [{ id: 1, commentType: "text", content: "c", author: { uniqueName: "a" }, publishedDate: "2026-01-01T00:00:00Z", lastContentUpdatedDate: "2026-01-01T00:00:00Z" }] }];
    const j = (await run(az({ fake: { threads } }), "pr-view", "12")).json();
    assert.strictEqual(j.comments[0].isMinimized, !["active", "pending"].includes(status), status);
  }
});
test("azure: reviews come from votes; 0 and in-between votes are skipped", async () => {
  const j = (await run(az(), "pr-view", "12")).json();
  assert.deepStrictEqual(j.reviews.map((r) => [r.author.login, r.state]), [
    ["bob@acme.com", "APPROVED"], ["dan@acme.com", "CHANGES_REQUESTED"], ["fay@acme.com", "APPROVED"], ["gus@acme.com", "CHANGES_REQUESTED"],
  ]);
});
test("azure: closing issues are the linked work items", async () => {
  const j = (await run(az(), "pr-view", "12")).json();
  assert.strictEqual(j.closingIssues[0].number, 55);
});
test("azure: no PR given uses the active PR for the current branch", async () => {
  const r = await run(az({ fake: { list: [{ pullRequestId: 12 }] } }), "pr-view");
  assert.strictEqual(r.code, 0, r.rec.err);
  assert.strictEqual(r.json().number, 12);
  assert.match(decodeURIComponent(r.rec.listQuery), /sourceRefName=refs\/heads\/feature\/x/);
  assert.match(r.rec.listQuery, /status=active/);
});
test("azure: no PR given and none found is a clear error", async () => {
  const r = await run(az({ fake: { list: [] } }), "pr-view");
  assert.notStrictEqual(r.code, 0);
  assert.match(r.rec.err, /no active pull request/i);
});
test("github: no PR given lets gh use the current branch", async () => {
  const r = await run(gh(), "pr-view");
  assert.strictEqual(r.code, 0);
  assert.deepStrictEqual(r.rec.gh[0].slice(0, 2), ["pr", "view"]);
  assert.ok(!r.rec.gh[0].includes("12"));
});

// ============ Trust ============

test("github trust without posters: OWNER, MEMBER, COLLABORATOR", async () => {
  const j = (await run(gh(), "pr-view", "12")).json();
  assert.deepStrictEqual(j.comments.map((c) => c.trusted), [true, false, true]);
});
test("azure trust without posters: the signed-in user", async () => {
  const j = (await run(az(), "pr-view", "12")).json();
  const by = Object.fromEntries(j.comments.map((c) => [c.body, c.trusted]));
  assert.deepStrictEqual(by, { early: false, edited: true, late: true });
});
for (const [name, mk] of Object.entries(HOSTS)) {
  test(`${name}: a posters file on the base branch overrides, and is read from the base`, async () => {
    const posters = name === "github" ? "# ci\nMallory\n" : "# ci\nMALLORY@evil.com\n";
    const r = await run(mk({ posters }), "pr-view", "12");
    const j = r.json();
    assert.deepStrictEqual(j.comments.filter((c) => c.trusted).map((c) => c.author.login), [name === "github" ? "mallory" : "mallory@evil.com"]);
    assert.match(r.rec.postersRef, /main:\.vet\/posters$/);
  });
}

// ============ Write ============

test("github pr-comment posts the file and prints the URL from the last non-blank line", async () => {
  const body = "<!-- vet-map -->\nhello\n";
  const r = await run(gh(), "pr-comment", "12", file("c.md", body));
  assert.strictEqual(r.rec.out.trim(), "https://github.com/o/r/pull/12#issuecomment-1");
  const call = r.rec.gh.find((a) => a[1] === "comment");
  assert.ok(call.includes("--body-file"));
});
test("azure pr-comment posts a thread with the text and prints the discussion link", async () => {
  const body = "<!-- vet-map -->\nhello\n";
  const r = await run(az(), "pr-comment", "12", file("c.md", body));
  const post = r.rec.fetch.find((f) => f.method === "POST" && /threads?/.test(f.url));
  assert.strictEqual(JSON.parse(post.body).comments[0].content, body);
  assert.strictEqual(r.rec.out.trim(), "https://dev.azure.com/acme/Proj%20One/_git/repo/pullrequest/12?discussionId=99");
});
test("github pr-minimize uses minimizeComment OUTDATED", async () => {
  const r = await run(gh(), "pr-minimize", "12", "N1");
  const call = r.rec.gh.find((a) => a[1] === "graphql");
  const text = call.join(" ");
  assert.match(text, /minimizeComment/);
  assert.match(text, /OUTDATED/);
  assert.match(text, /id=N1/);
});
test("azure pr-minimize closes the thread", async () => {
  const r = await run(az(), "pr-minimize", "12", "2");
  const patch = r.rec.fetch.find((f) => f.method === "PATCH");
  assert.match(patch.url, /threads\/2/);
  assert.strictEqual(JSON.parse(patch.body).status, "closed");
});
test("github pr-label creates then applies", async () => {
  const r = await run(gh(), "pr-label", "12", "needs-human-review");
  const joined = r.rec.gh.map((a) => a.join(" "));
  assert.ok(joined.some((s) => /^label create needs-human-review/.test(s)));
  assert.ok(joined.some((s) => /^pr edit 12 .*--add-label needs-human-review/.test(s)));
});
test("azure pr-label posts the label", async () => {
  const r = await run(az(), "pr-label", "12", "needs-human-review");
  const post = r.rec.fetch.find((f) => /labels?/.test(f.url));
  assert.strictEqual(JSON.parse(post.body).name, "needs-human-review");
});
test("azure pr-status maps states, cuts description to 140, carries the target URL", async () => {
  for (const [s, want] of [["success", "succeeded"], ["failure", "failed"], ["pending", "pending"]]) {
    const r = await run(az(), "pr-status", "12", s, "--description", "d".repeat(300), "--target-url", "https://x/y");
    const post = JSON.parse(r.rec.fetch.find((f) => /statuses?/.test(f.url)).body);
    assert.strictEqual(post.state, want);
    assert.strictEqual(post.description.length, 140);
    assert.strictEqual(post.targetUrl, "https://x/y");
    assert.deepStrictEqual(post.context, { name: "vet-verify", genre: "vet" });
  }
});
test("github pr-status posts a commit status on the head", async () => {
  const r = await run(gh(), "pr-status", "12", "failure", "--description", "d".repeat(300), "--target-url", "https://x/y");
  const call = r.rec.gh.find((a) => a[0] === "api" && /statuses\/abc123/.test(a.join(" ")));
  const text = call.join(" ");
  assert.match(text, /state=failure/);
  assert.match(text, /context=vet-verify/);
  assert.match(text, /target_url=https:\/\/x\/y/);
  assert.ok(call.includes("description=" + "d".repeat(140)));
});
for (const [name, mk] of Object.entries(HOSTS)) {
  test(`${name}: pr-status rejects any other state`, async () => {
    const r = await run(mk(), "pr-status", "12", "bogus");
    assert.notStrictEqual(r.code, 0);
    assert.match(r.rec.err, /success.*failure.*pending/);
  });
}
test("github pr-edit-body replaces the description", async () => {
  const r = await run(gh(), "pr-edit-body", "12", file("b.md", "new"));
  assert.ok(r.rec.gh.some((a) => a[0] === "pr" && a[1] === "edit" && a.includes("--body-file")));
});
test("azure pr-edit-body replaces the description; over 4000 is refused with the limit", async () => {
  const r = await run(az(), "pr-edit-body", "12", file("b2.md", "new"));
  const patch = r.rec.fetch.find((f) => f.method === "PATCH");
  assert.strictEqual(JSON.parse(patch.body).description, "new");
  const big = await run(az(), "pr-edit-body", "12", file("b3.md", "x".repeat(4001)));
  assert.notStrictEqual(big.code, 0);
  assert.match(big.rec.err, /4,?000/);
  assert.ok(!big.rec.fetch.some((f) => f.method === "PATCH"));
  const edge = await run(az(), "pr-edit-body", "12", file("b4.md", "x".repeat(4000)));
  assert.strictEqual(edge.code, 0);
});
test("github pr-checkout names the local branch", async () => {
  const r = await run(gh(), "pr-checkout", "12", "wip");
  assert.deepStrictEqual(r.rec.gh.find((a) => a[1] === "checkout"), ["pr", "checkout", "12", "--branch", "wip"]);
});
test("azure pr-checkout fetches the source branch then checks out a named branch", async () => {
  const r = await run(az(), "pr-checkout", "12", "wip");
  const git = r.rec.exec.filter((e) => e.cmd === "git").map((e) => e.args.join(" "));
  const fetchIdx = git.findIndex((s) => /^fetch origin .*feature\/x/.test(s));
  const coIdx = git.findIndex((s) => /^checkout .*wip/.test(s));
  assert.ok(fetchIdx >= 0 && coIdx > fetchIdx, git.join("\n"));
});
test("github issue-view and issue-create", async () => {
  const v = await run(gh(), "issue-view", "7");
  assert.deepStrictEqual(Object.keys(v.json()).sort(), ["body", "number", "title", "url"]);
  const c = await run(gh(), "issue-create", "--title", "T", "--body-file", file("i.md", "b"));
  assert.strictEqual(c.rec.out.trim(), "https://github.com/o/r/issues/9");
});
test("azure issue-view joins description and acceptance criteria", async () => {
  const j = (await run(az(), "issue-view", "55")).json();
  assert.strictEqual(j.number, 55);
  assert.strictEqual(j.title, "Story");
  assert.match(j.body, /d[\s\S]*ac/);
  assert.match(j.url, /_workitems\/edit\/55$/);
});
test("azure issue-create makes a work item of the configured type", async () => {
  const dflt = await run(az(), "issue-create", "--title", "T", "--body-file", file("i2.md", "b"));
  assert.match(dflt.rec.fetch.find((f) => f.method === "POST").url, /workitems\/\$Task/);
  assert.strictEqual(dflt.rec.out.trim(), "https://dev.azure.com/acme/Proj%20One/_workitems/edit/77");
  const bug = await run(az(), "issue-create", "--title", "T", "--body-file", file("i3.md", "b"), "--type", "Bug");
  const post = bug.rec.fetch.find((f) => f.method === "POST");
  assert.match(post.url, /workitems\/\$Bug/);
  assert.match(post.headers["Content-Type"], /json-patch/);
});

// ============ Plumbing ============

test("azure auth: Bearer from VET_ADO_TOKEN, no az call", async () => {
  const r = await run(az(), "pr-view", "12");
  assert.strictEqual(r.rec.auth, "Bearer tok");
  assert.strictEqual(r.rec.tokenCalls, undefined);
});
test("azure auth: one token request per process, cached", async () => {
  const r = await run(az({ env: {} }), "pr-view", "12");
  assert.strictEqual(r.rec.tokenCalls, 1);
  assert.strictEqual(r.rec.auth, "Bearer az-token");
});
test("on Windows az runs through cmd.exe /c with fixed arguments", async () => {
  const r = await run(az({ env: { OS: "Windows_NT" } }), "pr-view", "12");
  assert.strictEqual(r.rec.azInvocation.cmd, "cmd.exe");
  assert.deepStrictEqual(r.rec.azInvocation.args.slice(0, 3), ["/c", "az", "account"]);
  assert.ok(r.rec.azInvocation.args.includes("499b84ac-1321-427f-aa17-267ca6975798"));
});
test("off Windows az runs directly", async () => {
  const r = await run(az({ env: {} }), "pr-view", "12");
  assert.strictEqual(r.rec.azInvocation.cmd, "az");
});
test("-C changes the working directory for every command", async () => {
  const r = await run(gh(), "-C", "/elsewhere", "pr-view", "12");
  assert.ok(r.rec.exec.length > 0);
  assert.ok(r.rec.exec.every((e) => e.cwd === path.resolve("/work", "/elsewhere")), JSON.stringify(r.rec.exec.map((e) => e.cwd)));
});
test("whoami prints the signed-in login on both hosts", async () => {
  assert.strictEqual((await run(gh(), "whoami")).rec.out.trim(), "alice");
  assert.strictEqual((await run(az(), "whoami")).rec.out.trim(), "alice@acme.com");
});
test("unknown command prints usage and exits non-zero", async () => {
  const r = await run(gh(), "frobnicate");
  assert.notStrictEqual(r.code, 0);
  assert.match(r.rec.err, /usage/i);
  const none = await run(gh());
  assert.notStrictEqual(none.code, 0);
});
test("a failing transport surfaces as a non-zero exit with the reason", async () => {
  const r = await run(az({ fake: {} }), "pr-view", "404");
  assert.notStrictEqual(r.code, 0);
  assert.match(r.rec.err, /404/);
});
test("a flag without a value is a usage error", async () => {
  const r = await run(gh(), "pr-status", "12", "failure", "--description");
  assert.strictEqual(r.code, 2);
  assert.match(r.rec.err, /needs a value/);
});
test("a mirror path containing github.com is not GitHub", async () => {
  const r = await run({ remote: "https://git.corp.com/mirrors/github.com/o/r" }, "detect");
  assert.notStrictEqual(r.code, 0);
});
