#!/usr/bin/env node
// The only place vet talks to a code host. GitHub goes through `gh`; Azure DevOps
// through its REST API with the `az login` token. Usage: forge.cjs [-C dir] <command> ...
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ADO_RESOURCE = "499b84ac-1321-427f-aa17-267ca6975798";
const ADO_DESC_LIMIT = 4000;
const API = "api-version=7.1";
const STATUS_LEN = 140;
const GH_TRUSTED = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);
const MINIMIZED = new Set(["closed", "fixed", "wontfix", "bydesign"]);

const USAGE = `usage: forge.cjs [-C dir] <command> [args]
  detect
  whoami
  pr-view [pr]
  pr-checkout <pr> [branch]
  pr-comment <pr> <file>
  pr-minimize <pr> <comment-id>
  pr-edit-body <pr> <file>
  pr-label <pr> <label>
  pr-status <pr> <success|failure|pending> [--context name] [--description text] [--target-url url]
  issue-view <issue>
  issue-create --title <t> --body-file <file> [--type <work item type>]
env: VET_FORGE=github|azure forces the host; VET_ADO_ORG / VET_ADO_PROJECT / VET_ADO_REPO supply Azure DevOps
     details the remote lacks; VET_ADO_TOKEN overrides the az token; VET_ADO_WORKITEM_TYPE (default Task).`;

class Fail extends Error {
  constructor(message, code = 1) { super(message); this.code = code; }
}

const enc = encodeURIComponent;
const dec = (s) => { try { return decodeURIComponent(s); } catch { return s; } };

// ---------- remotes and references ----------

function parseRemote(url) {
  const u = url.trim();
  if (/(^|\/\/|@)(www\.)?github\.com[:/]/i.test(u)) return { host: "github" };
  let m;
  if ((m = /^https?:\/\/(?:[^@/]+@)?dev\.azure\.com\/([^/]+)\/([^/]+)\/_git\/([^/?#]+)/i.exec(u))) return azure(m[1], m[2], m[3]);
  if ((m = /^https?:\/\/(?:[^@/]+@)?([^./@]+)\.visualstudio\.com\/(?:([^/]+)\/)?_git\/([^/?#]+)/i.exec(u))) {
    const project = !m[2] || m[2].toLowerCase() === "defaultcollection" ? m[3] : m[2];
    return azure(m[1], project, m[3]);
  }
  if ((m = /^https?:\/\/(?:[^@/]+@)?([^./@]+)\.visualstudio\.com\/DefaultCollection\/([^/]+)\/_git\/([^/?#]+)/i.exec(u))) return azure(m[1], m[2], m[3]);
  if ((m = /(?:ssh\.dev\.azure\.com|vs-ssh\.visualstudio\.com)[:/]v3\/([^/]+)\/([^/]+)\/([^/?#]+)/i.exec(u))) return azure(m[1], m[2], m[3]);
  return null;
}
function azure(org, project, repo) { return { host: "azure", org: dec(org), project: dec(project), repo: dec(repo) }; }

function parseRef(s, what = "pull request") {
  const t = String(s ?? "").trim();
  let m;
  if ((m = /^#?(\d+)$/.exec(t))) return Number(m[1]);
  if ((m = /\/(?:pull|pullrequest|issues|edit)\/(\d+)(?:[/?#]|$)/i.exec(t))) return Number(m[1]);
  throw new Fail(`not a ${what} reference: "${t}" (use a number, #number or URL)`);
}

function lastLine(text) {
  const lines = String(text).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  return lines[lines.length - 1] || "";
}

function parseArgs(args) {
  const pos = [], opt = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      const v = args[i + 1];
      if (v === undefined || v.startsWith("--")) throw new Fail(`${args[i]} needs a value`, 2);
      opt[args[i].slice(2)] = v; i++;
    }
    else pos.push(args[i]);
  }
  return { pos, opt };
}

// ---------- context ----------

function makeCtx(io, cwd) {
  const env = io.env;
  const ctx = { io, env, cwd, memo: {} };

  ctx.run = (cmd, args, opts = {}) => {
    const r = io.exec(cmd, args, { cwd, ...opts });
    if (r.status !== 0) throw new Fail(`${cmd} ${args.slice(0, 2).join(" ")} failed: ${(r.stderr || r.stdout || "").trim()}`);
    return r.stdout || "";
  };

  ctx.remember = (key, fn) => (ctx.memo[key] ??= fn());

  ctx.forge = () => ctx.remember("forge", () => {
    const override = (env.VET_FORGE || "").toLowerCase();
    if (override && !["github", "azure"].includes(override)) throw new Fail(`VET_FORGE must be github or azure, got "${override}"`);
    const r = io.exec("git", ["remote", "get-url", "origin"], { cwd });
    const parsed = r.status === 0 ? parseRemote(r.stdout) : null;
    if (override === "github") return { host: "github" };
    if (override === "azure") {
      const f = parsed && parsed.host === "azure" ? parsed : { host: "azure" };
      const out = { host: "azure", org: f.org || env.VET_ADO_ORG, project: f.project || env.VET_ADO_PROJECT, repo: f.repo || env.VET_ADO_REPO };
      if (!out.org) throw new Fail("Azure DevOps organisation unknown: set VET_ADO_ORG");
      return out;
    }
    if (!parsed) throw new Fail("cannot tell the code host from the origin remote; set VET_FORGE=github or VET_FORGE=azure");
    if (parsed.host === "azure" && !parsed.org && env.VET_ADO_ORG) parsed.org = env.VET_ADO_ORG;
    return parsed;
  });

  ctx.token = () => ctx.remember("token", () => {
    if (env.VET_ADO_TOKEN) return env.VET_ADO_TOKEN;
    const az = ["account", "get-access-token", "--resource", ADO_RESOURCE, "--query", "accessToken", "-o", "tsv"];
    const out = env.OS === "Windows_NT" ? ctx.run("cmd.exe", ["/c", "az", ...az]) : ctx.run("az", az);
    const t = out.trim();
    if (!t) throw new Fail("az returned no token; run `az login`");
    return t;
  });

  ctx.ado = async (method, url, body, contentType = "application/json") => {
    const res = await io.fetch(url, {
      method,
      headers: { Authorization: `Bearer ${ctx.token()}`, Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": contentType }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    if (res.status < 200 || res.status >= 300) throw new Fail(`Azure DevOps ${res.status} ${method} ${url}: ${text.slice(0, 300)}`);
    return text ? JSON.parse(text) : {};
  };
  ctx.orgBase = () => `https://dev.azure.com/${enc(ctx.forge().org)}`;
  return ctx;
}

// ---------- shared: trust ----------

function readPosters(ctx, base) {
  for (const ref of [`origin/${base}`, base]) {
    const r = ctx.io.exec("git", ["show", `${ref}:.vet/posters`], { cwd: ctx.cwd });
    if (r.status === 0) {
      return new Set(r.stdout.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#")).map((l) => l.toLowerCase()));
    }
  }
  return null;
}

// ---------- GitHub ----------

const gh = {
  run: (ctx, args) => ctx.run("gh", args),

  async view(ctx, pr) {
    const fields = "number,url,title,body,headRefOid,headRefName,baseRefName,author,state,isDraft,closingIssuesReferences,commits,reviews,comments";
    const out = gh.run(ctx, ["pr", "view", ...(pr ? [String(pr)] : []), "--json", fields]);
    const j = JSON.parse(out);
    const posters = readPosters(ctx, j.baseRefName);
    return {
      number: j.number, url: j.url, title: j.title, body: j.body, headRefOid: j.headRefOid, headRefName: j.headRefName,
      baseRefName: j.baseRefName, author: { login: j.author && j.author.login }, state: j.state, isDraft: !!j.isDraft,
      closingIssues: (j.closingIssuesReferences || []).map((i) => ({ number: i.number, url: i.url })),
      commits: (j.commits || []).map((c) => ({ oid: c.oid, messageHeadline: c.messageHeadline })),
      reviews: (j.reviews || []).map((r) => ({ author: { login: r.author && r.author.login }, state: r.state })),
      comments: (j.comments || []).map((c) => {
        const login = c.author && c.author.login;
        return {
          id: c.id, url: c.url, author: { login }, body: c.body, createdAt: c.createdAt, edited: !!c.includesCreatedEdit,
          isMinimized: !!c.isMinimized,
          trusted: posters ? posters.has(String(login).toLowerCase()) : GH_TRUSTED.has(c.authorAssociation),
        };
      }),
    };
  },
  whoami: (ctx) => gh.run(ctx, ["api", "user", "--jq", ".login"]).trim(),
  checkout: (ctx, pr, branch) => { gh.run(ctx, ["pr", "checkout", String(pr), ...(branch ? ["--branch", branch] : [])]); },
  comment: (ctx, pr, f) => lastLine(gh.run(ctx, ["pr", "comment", String(pr), "--body-file", f])),
  minimize: (ctx, pr, id) => {
    gh.run(ctx, ["api", "graphql", "-f", "query=mutation($id:ID!){minimizeComment(input:{subjectId:$id,classifier:OUTDATED}){minimizedComment{isMinimized}}}", "-f", `id=${id}`]);
  },
  editBody: (ctx, pr, f) => { gh.run(ctx, ["pr", "edit", String(pr), "--body-file", f]); },
  label: (ctx, pr, name) => {
    gh.run(ctx, ["label", "create", name, "--force"]);
    gh.run(ctx, ["pr", "edit", String(pr), "--add-label", name]);
  },
  status: (ctx, pr, state, { context, description, url }) => {
    const sha = JSON.parse(gh.run(ctx, ["pr", "view", String(pr), "--json", "headRefOid"])).headRefOid;
    const args = ["api", `repos/{owner}/{repo}/statuses/${sha}`, "-f", `state=${state}`, "-f", `context=${context}`, "-f", `description=${description}`];
    if (url) args.push("-f", `target_url=${url}`);
    gh.run(ctx, args);
  },
  issueView: (ctx, n) => {
    const j = JSON.parse(gh.run(ctx, ["issue", "view", String(n), "--json", "number,title,body,url"]));
    return { number: j.number, title: j.title, body: j.body, url: j.url };
  },
  issueCreate: (ctx, { title, file }) => lastLine(gh.run(ctx, ["issue", "create", "--title", title, "--body-file", file])),
};

// ---------- Azure DevOps ----------

const AZ_STATE = { active: "OPEN", abandoned: "CLOSED", completed: "MERGED" };
const AZ_STATUS = { success: "succeeded", failure: "failed", pending: "pending" };

const az = {
  async record(ctx, id) {
    return ctx.remember("pr" + id, () => ctx.ado("GET", `${ctx.orgBase()}/_apis/git/pullrequests/${id}?${API}`));
  },
  async where(ctx, id) {
    const pr = await az.record(ctx, id);
    const project = pr.repository.project.name, repo = pr.repository.name;
    const org = ctx.forge().org;
    return {
      pr, project, repo,
      api: `${ctx.orgBase()}/${enc(project)}/_apis/git/repositories/${enc(repo)}/pullRequests/${id}`,
      web: `https://dev.azure.com/${enc(org)}/${enc(project)}/_git/${enc(repo)}/pullrequest/${id}`,
      item: (n) => `https://dev.azure.com/${enc(org)}/${enc(project)}/_workitems/edit/${n}`,
    };
  },
  async currentPr(ctx) {
    const f = ctx.forge();
    if (!f.project || !f.repo) throw new Fail("cannot find the current branch's PR without the project and repo; name the PR");
    const branch = ctx.run("git", ["branch", "--show-current"]).trim();
    const q = `searchCriteria.status=active&searchCriteria.sourceRefName=${enc("refs/heads/" + branch)}&${API}`;
    const r = await ctx.ado("GET", `${ctx.orgBase()}/${enc(f.project)}/_apis/git/repositories/${enc(f.repo)}/pullrequests?${q}`);
    if (!r.value || !r.value.length) throw new Fail(`no active pull request has source branch "${branch}"; name the PR`);
    return r.value[0].pullRequestId;
  },
  async view(ctx, id) {
    const w = await az.where(ctx, id);
    const [threads, commits, items] = await Promise.all([
      ctx.ado("GET", `${w.api}/threads?${API}`),
      ctx.ado("GET", `${w.api}/commits?${API}`),
      ctx.ado("GET", `${w.api}/workitems?${API}`),
    ]);
    const base = w.pr.targetRefName.replace(/^refs\/heads\//, "");
    const posters = readPosters(ctx, base);
    let self = null;
    if (!posters) self = (await az.whoami(ctx)).toLowerCase();
    const comments = [];
    for (const t of threads.value || []) {
      const minimized = MINIMIZED.has(String(t.status || "").toLowerCase());
      for (const c of t.comments || []) {
        if (c.isDeleted || String(c.commentType).toLowerCase() === "system") continue;
        const login = c.author && c.author.uniqueName;
        const lower = String(login).toLowerCase();
        comments.push({
          id: String(t.id), url: `${w.web}?discussionId=${t.id}`, author: { login }, body: c.content, createdAt: c.publishedDate,
          edited: Date.parse(c.lastContentUpdatedDate) - Date.parse(c.publishedDate) > 2000,
          isMinimized: minimized, trusted: posters ? posters.has(lower) : lower === self,
        });
      }
    }
    comments.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
    const reviews = [];
    for (const r of w.pr.reviewers || []) {
      if (r.vote >= 5) reviews.push({ author: { login: r.uniqueName }, state: "APPROVED" });
      else if (r.vote <= -5) reviews.push({ author: { login: r.uniqueName }, state: "CHANGES_REQUESTED" });
    }
    return {
      number: w.pr.pullRequestId, url: w.web, title: w.pr.title, body: w.pr.description || "",
      headRefOid: w.pr.lastMergeSourceCommit && w.pr.lastMergeSourceCommit.commitId,
      headRefName: w.pr.sourceRefName.replace(/^refs\/heads\//, ""), baseRefName: base,
      author: { login: w.pr.createdBy && w.pr.createdBy.uniqueName }, state: AZ_STATE[w.pr.status] || String(w.pr.status).toUpperCase(),
      isDraft: !!w.pr.isDraft,
      closingIssues: (items.value || []).map((i) => ({ number: Number(i.id), url: w.item(i.id) })),
      commits: (commits.value || []).map((c) => ({ oid: c.commitId, messageHeadline: String(c.comment || "").split("\n")[0] })),
      reviews, comments,
    };
  },
  whoami: (ctx) => ctx.remember("whoami", async () => {
    const r = await ctx.ado("GET", `${ctx.orgBase()}/_apis/connectionData`);
    const u = r.authenticatedUser || {};
    return (u.properties && u.properties.Account && u.properties.Account.$value) || u.providerDisplayName || "";
  }),
  async checkout(ctx, id, branch) {
    const w = await az.where(ctx, id);
    const src = w.pr.sourceRefName.replace(/^refs\/heads\//, "");
    ctx.run("git", ["fetch", "origin", src]);
    ctx.run("git", ["checkout", "-B", branch || src, "FETCH_HEAD"]);
  },
  async comment(ctx, id, f) {
    const w = await az.where(ctx, id);
    const t = await ctx.ado("POST", `${w.api}/threads?${API}`, { comments: [{ parentCommentId: 0, content: ctx.io.readFile(f), commentType: 1 }], status: 1 });
    return `${w.web}?discussionId=${t.id}`;
  },
  async minimize(ctx, id, thread) {
    const w = await az.where(ctx, id);
    await ctx.ado("PATCH", `${w.api}/threads/${enc(String(thread).split(/[-.:]/)[0])}?${API}`, { status: "closed" });
  },
  async editBody(ctx, id, f) {
    const text = ctx.io.readFile(f);
    if (text.length > ADO_DESC_LIMIT) throw new Fail(`Azure DevOps limits a PR description to 4,000 characters; this one is ${text.length}. Shorten it.`);
    const w = await az.where(ctx, id);
    await ctx.ado("PATCH", `${w.api}?${API}`, { description: text });
  },
  async label(ctx, id, name) {
    const w = await az.where(ctx, id);
    await ctx.ado("POST", `${w.api}/labels?${API}`, { name });
  },
  async status(ctx, id, state, { context, description, url }) {
    const w = await az.where(ctx, id);
    const body = { state: AZ_STATUS[state], description, context: { name: context, genre: "vet" } };
    if (url) body.targetUrl = url;
    await ctx.ado("POST", `${w.api}/statuses?${API}`, body);
  },
  async issueView(ctx, n) {
    const r = await ctx.ado("GET", `${ctx.orgBase()}/_apis/wit/workitems/${n}?${API}`);
    const f = r.fields || {};
    const f2 = ctx.forge();
    const project = f["System.TeamProject"] || f2.project;
    return {
      number: r.id, title: f["System.Title"] || "",
      body: [f["System.Description"], f["Microsoft.VSTS.Common.AcceptanceCriteria"]].filter(Boolean).join("\n\n"),
      url: `https://dev.azure.com/${enc(f2.org)}/${enc(project)}/_workitems/edit/${r.id}`,
    };
  },
  async issueCreate(ctx, { title, file, type }) {
    const f = ctx.forge();
    if (!f.project) throw new Fail("work item project unknown: set VET_ADO_PROJECT");
    const ops = [{ op: "add", path: "/fields/System.Title", value: title }, { op: "add", path: "/fields/System.Description", value: ctx.io.readFile(file) }];
    const r = await ctx.ado("POST", `${ctx.orgBase()}/${enc(f.project)}/_apis/wit/workitems/$${enc(type)}?${API}`, ops, "application/json-patch+json");
    return `https://dev.azure.com/${enc(f.org)}/${enc(f.project)}/_workitems/edit/${r.id}`;
  },
};

// ---------- commands ----------

async function dispatch(ctx, cmd, args) {
  const { pos, opt } = parseArgs(args);
  const out = ctx.io.out;
  const forge = ctx.forge();
  const isAz = forge.host === "azure";
  const abs = (p) => path.resolve(ctx.io.cwd, p);
  const needPr = () => {
    if (pos[0] == null) throw new Fail(`${cmd} needs a pull request`);
    return parseRef(pos[0]);
  };

  switch (cmd) {
    case "detect": return out(JSON.stringify(forge) + "\n");
    case "whoami": return out((isAz ? await az.whoami(ctx) : gh.whoami(ctx)) + "\n");
    case "pr-view": {
      let n = pos[0] != null ? parseRef(pos[0]) : null;
      if (isAz && n == null) n = await az.currentPr(ctx);
      const v = isAz ? await az.view(ctx, n) : await gh.view(ctx, n);
      return out(JSON.stringify(v, null, 2) + "\n");
    }
    case "pr-checkout": {
      const n = needPr();
      return isAz ? az.checkout(ctx, n, pos[1]) : gh.checkout(ctx, n, pos[1]);
    }
    case "pr-comment": {
      const n = needPr();
      if (!pos[1]) throw new Fail("pr-comment needs a file");
      const url = isAz ? await az.comment(ctx, n, abs(pos[1])) : gh.comment(ctx, n, abs(pos[1]));
      return out(url + "\n");
    }
    case "pr-minimize": {
      const n = needPr();
      if (!pos[1]) throw new Fail("pr-minimize needs a comment id");
      return isAz ? az.minimize(ctx, n, pos[1]) : gh.minimize(ctx, n, pos[1]);
    }
    case "pr-edit-body": {
      const n = needPr();
      if (!pos[1]) throw new Fail("pr-edit-body needs a file");
      return isAz ? az.editBody(ctx, n, abs(pos[1])) : gh.editBody(ctx, n, abs(pos[1]));
    }
    case "pr-label": {
      const n = needPr();
      if (!pos[1]) throw new Fail("pr-label needs a label");
      return isAz ? az.label(ctx, n, pos[1]) : gh.label(ctx, n, pos[1]);
    }
    case "pr-status": {
      const n = needPr();
      const state = pos[1];
      if (!Object.hasOwn(AZ_STATUS, state || "")) throw new Fail(`state must be success, failure or pending, got "${state}"`);
      const o = { context: opt.context || "vet-verify", description: String(opt.description || "").slice(0, STATUS_LEN), url: opt["target-url"] };
      return isAz ? az.status(ctx, n, state, o) : gh.status(ctx, n, state, o);
    }
    case "issue-view": {
      if (pos[0] == null) throw new Fail("issue-view needs an issue");
      const n = parseRef(pos[0], "issue");
      return out(JSON.stringify(isAz ? await az.issueView(ctx, n) : gh.issueView(ctx, n), null, 2) + "\n");
    }
    case "issue-create": {
      if (!opt.title || !opt["body-file"]) throw new Fail("issue-create needs --title and --body-file");
      const o = { title: opt.title, file: abs(opt["body-file"]), type: opt.type || ctx.env.VET_ADO_WORKITEM_TYPE || "Task" };
      return out((isAz ? await az.issueCreate(ctx, o) : gh.issueCreate(ctx, o)) + "\n");
    }
    default: throw new Fail(`unknown command "${cmd}"\n${USAGE}`, 2);
  }
}

async function main(argv, io) {
  let args = [...argv];
  let cwd = io.cwd;
  try {
    if (args[0] === "-C") {
      if (!args[1]) throw new Fail("-C needs a directory", 2);
      cwd = path.resolve(cwd, args[1]);
      args = args.slice(2);
    }
    if (!args.length) throw new Fail(USAGE, 2);
    const known = ["detect", "whoami", "pr-view", "pr-checkout", "pr-comment", "pr-minimize", "pr-edit-body", "pr-label", "pr-status", "issue-view", "issue-create"];
    if (!known.includes(args[0])) throw new Fail(`unknown command "${args[0]}"\n${USAGE}`, 2);
    await dispatch(makeCtx(io, cwd), args[0], args.slice(1));
    return 0;
  } catch (e) {
    io.err(`forge: ${e.message}\n`);
    return e instanceof Fail ? e.code : 1;
  }
}

function realIo() {
  return {
    env: process.env,
    cwd: process.cwd(),
    readFile: (p) => fs.readFileSync(p, "utf8"),
    out: (s) => process.stdout.write(s),
    err: (s) => process.stderr.write(s),
    exec: (cmd, args, opts = {}) => {
      const r = spawnSync(cmd, args, { cwd: opts.cwd, encoding: "utf8", input: opts.input, maxBuffer: 64 * 1024 * 1024 });
      return { status: r.error ? 127 : r.status, stdout: r.stdout || "", stderr: r.stderr || (r.error ? r.error.message : "") };
    },
    fetch: (url, init) => fetch(url, init),
  };
}

module.exports = { main, parseRemote, parseRef };

if (require.main === module) {
  main(process.argv.slice(2), realIo()).then((code) => { process.exitCode = code; });
}
