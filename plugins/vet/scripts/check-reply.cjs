#!/usr/bin/env node
// Checks a /vet:address reply against its review map before it is posted,
// and again in /vet:verify. Every map item gets exactly one block, each
// block one disposition its kind allows. Prints failures with line numbers;
// exits 1 on any.
//
//   node check-reply.cjs --map map.md --reply reply.md --commits commits.txt [--closed]
//
// --closed also rejects `escalated:`: an open escalation is not a pass.

const fs = require("node:fs");
const { parseMap, REPLY_MARKER } = require("./lib.cjs");

const SHA = "([0-9a-f]{7,40})";
const TICKET = "(#\\d+|[A-Z][A-Z0-9]+-\\d+|https?://\\S+)";

// Each disposition: a pattern, and which capture group is a sha, a reason,
// a ticket, a question or a quote.
const D = {
  fixed: { re: new RegExp(`^fixed in ${SHA}$`, "i"), sha: 1 },
  changed: { re: new RegExp(`^changed in ${SHA}$`, "i"), sha: 1 },
  recordUpdated: { re: new RegExp(`^record updated in ${SHA}$`, "i"), sha: 1 },
  ticket: { re: /^ticket now says: "(.*\S.*)"$/i, quote: 1 },
  dismissed: { re: /^dismissed: (.+)$/i, reason: 1 },
  kept: { re: /^kept: (.+)$/i, reason: 1 },
  wontFix: { re: /^won't fix: (.+)$/i, reason: 1 },
  deferred: { re: new RegExp(`^deferred to ${TICKET}: (.+)$`), reason: 2 },
  filed: { re: new RegExp(`^filed as ${TICKET}$`) },
  escalated: { re: /^escalated: (.+\?)$/i, question: 1 },
  decided: { re: /^decided: (.+)$/i, reason: 1 },
};

const ALLOWED = {
  gaming: ["fixed", "dismissed", "escalated"],
  red: ["fixed", "dismissed", "escalated"],
  contradiction: ["changed", "recordUpdated", "ticket", "dismissed", "escalated"],
  row: ["kept", "changed", "dismissed", "escalated"],
  other: ["fixed", "deferred", "wontFix", "dismissed", "escalated"],
  preexisting: ["filed", "fixed"],
  escalation: ["decided", "escalated"],
};

const SHOWN = {
  fixed: "fixed in <sha>", changed: "changed in <sha>", recordUpdated: "record updated in <sha>",
  ticket: 'ticket now says: "<quote>"', dismissed: "dismissed: <reason>", kept: "kept: <reason>",
  wontFix: "won't fix: <reason>", deferred: "deferred to <#123 | ABC-123>: <reason>",
  filed: "filed as <#123 | ABC-123>", escalated: "escalated: <the question for the human>?",
  decided: "decided: <the human's call>",
};

const PLACEHOLDER = /\b(parked|tbd|todo|to be decided|tbc|revisit|for the author|authors? (to )?decides?|still open|not addressed)\b/i;

const STOP = new Set(("the a an and or but of to in on for with is are was were be been this that these those " +
  "it its as at by from so not no only does do did has have had than then there their they which who " +
  "what when where while will would can could should may might also just still").split(" "));

function words(s) {
  return s.toLowerCase().match(/[a-z0-9_.']+/g)?.map((w) => w.replace(/[.']+$/, "")).filter(Boolean) ?? [];
}
function content(s) {
  return words(s).filter((w) => w.length > 2 && !STOP.has(w));
}

// A reason restates the finding when it adds almost nothing the finding didn't say.
function restates(reason, findingText) {
  const said = new Set(content(findingText));
  const own = content(reason);
  if (own.length === 0) return true;
  const fresh = own.filter((w) => !said.has(w));
  return fresh.length < 3 && fresh.length / own.length < 0.3;
}

function parseBlocks(lines, err) {
  const blocks = [];
  let cur = null;
  lines.forEach((text, i) => {
    if (/^###\s/.test(text)) {
      const h = text.match(/^###\s+([A-Z]+\d+[A-Za-z0-9]*)\b/);
      if (!h) {
        // Never fold an unreadable block into the one above it.
        err(i + 1, `### heading has no item id ("${text.trim()}")`);
        cur = null;
        return;
      }
      cur = { id: h[1], line: i + 1, dispositions: [] };
      blocks.push(cur);
      return;
    }
    const d = text.match(/^\*\*Disposition:\*\*\s*(.*?)\s*$/);
    if (d && cur) cur.dispositions.push({ value: d[1], line: i + 1 });
  });
  return blocks;
}

function check({ items, reply, commits, closed = false }) {
  const errors = [];
  const err = (line, message) => errors.push({ line, message });
  const lines = reply.split(/\r?\n/);
  const onPr = (sha) => commits.some((c) => c.toLowerCase().startsWith(sha.toLowerCase()));

  if (!lines.some((l) => REPLY_MARKER.test(l.trim()))) err(1, "the reply has no <!-- vet-address --> marker line");
  const headLine = lines.findIndex((l) => /^\*\*Head:\*\*/.test(l));
  const head = headLine < 0 ? null : lines[headLine].match(/^\*\*Head:\*\*\s*`?([0-9a-f]{7,40})`?\s*$/i)?.[1];
  if (!head) err(headLine + 1 || 1, "the reply needs a **Head:** <sha> line naming the pushed head it answers for");
  else if (!onPr(head)) err(headLine + 1, `Head ${head} is not a commit on the PR; push first`);

  const byId = new Map(items.map((i) => [i.id, i]));
  const blocks = parseBlocks(lines, err);
  const seen = new Map();

  for (const b of blocks) {
    if (!byId.has(b.id)) { err(b.line, `${b.id} is not an item on the map`); continue; }
    if (seen.has(b.id)) { err(b.line, `${b.id} is answered more than once (first at line ${seen.get(b.id)})`); continue; }
    seen.set(b.id, b.line);
    const item = byId.get(b.id);

    if (b.dispositions.length === 0) { err(b.line, `${b.id} has no Disposition line`); continue; }
    if (b.dispositions.length > 1) { err(b.dispositions[1].line, `${b.id} has more than one Disposition line`); continue; }
    const { value, line } = b.dispositions[0];

    if (PLACEHOLDER.test(value)) {
      err(line, `${b.id} disposition is a placeholder ("${value}"); decide it or escalate it`);
      continue;
    }

    const allowed = ALLOWED[item.kind];
    if (!allowed) { err(line, `${b.id} has unknown kind "${item.kind}"`); continue; }
    const hit = allowed.map((k) => [k, value.match(D[k].re)]).find(([, m]) => m);
    if (!hit) {
      err(line, `${b.id} "${value}" is not an allowed disposition for a ${item.kind} item; use one of: ` +
        allowed.map((k) => SHOWN[k]).join(" | "));
      continue;
    }
    const [kind, m] = hit;
    const spec = D[kind];
    if (kind === "kept" && item.verdict === "WRONG") {
      err(line, `${b.id} is a WRONG row (MUST-FIX): change it, or dispute it until the re-checker concedes`);
      continue;
    }

    if (spec.sha && !onPr(m[spec.sha])) err(line, `${b.id} cites ${m[spec.sha]}, which is not a commit on the PR; push the fix first`);
    if (spec.reason) {
      const reason = m[spec.reason].trim();
      if (words(reason).length < 3) err(line, `${b.id} reason is too short to say why`);
      else if (restates(reason, `${item.title} ${item.text}`)) err(line, `${b.id} reason restates the finding; say what the finding didn't`);
    }
    if (spec.quote && words(m[spec.quote]).length < 3) err(line, `${b.id} ticket quote is too short; quote what the ticket now says`);
    if (spec.question) {
      if (words(m[spec.question]).length < 4) err(line, `${b.id} escalation must ask the human a specific question`);
      if (closed) err(line, `${b.id} is escalated and not yet decided; a human answers it, then /vet:address runs again`);
    }
  }

  for (const i of items) {
    if (!seen.has(i.id) && !blocks.some((b) => b.id === i.id)) err(1, `${i.id} (${i.title}) has no response`);
  }
  errors.sort((a, b) => a.line - b.line);
  return { ok: errors.length === 0, errors, head };
}

function main(argv) {
  const opt = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i].replace(/^--/, "");
    if (k === "closed") opt.closed = true;
    else opt[k] = argv[++i];
  }
  if (!opt.map || !opt.reply || !opt.commits) {
    console.error("usage: check-reply.cjs --map map.md --reply reply.md --commits commits.txt [--closed]");
    return 2;
  }
  const { items } = parseMap(fs.readFileSync(opt.map, "utf8"));
  const r = check({
    items,
    reply: fs.readFileSync(opt.reply, "utf8"),
    commits: fs.readFileSync(opt.commits, "utf8").split(/\s+/).filter(Boolean),
    closed: opt.closed,
  });
  if (r.ok) { console.log(`OK: all ${items.length} items have exactly one allowed disposition`); return 0; }
  for (const e of r.errors) console.log(`line ${e.line}: ${e.message}`);
  return 1;
}

module.exports = { check, ALLOWED };
if (require.main === module) process.exitCode = main(process.argv.slice(2));
