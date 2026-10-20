// Shared by risk.cjs and check-reply.cjs: RED paths, docs-only files, and
// the review map's items. Pure functions; no I/O but readRedGlobs.

const { execFileSync } = require("node:child_process");
const path = require("node:path");

const MAP_MARKER = /<!--\s*review-map\s*-->/i;
const REPLY_MARKER = /<!--\s*review-address\s*-->/i;
const VERDICT_MARKER = /<!--\s*review-verify:\s*(pass|fail)\s*-->/i;

// Path-identifiable RED zones. A repo replaces them with .review/red-paths.
const DEFAULT_RED = [
  "**/migrations/**", "**/*.sql",
  "**/auth/**", "**/*auth*.*", "**/*session*.*", "**/*permission*.*",
  "**/*secret*", "**/.env*", "**/*.pem", "**/*.key",
  "**/*payment*", "**/*billing*", "**/*invoice*",
  ".github/workflows/**", "**/Dockerfile", "**/docker-compose*", "**/deploy/**", "**/*.tf", "**/k8s/**",
  "**/openapi*.*", "**/*.proto", "**/design-system/**", "**/tokens/**",
  "**/AGENTS.md", "**/CLAUDE.md", "**/SKILL.md", "**/.claude/**", "**/.claude-plugin/**",
  ".review/**",
];

// Read from the base ref, never the PR's tree, so a PR can't shrink its own RED list.
function readRedGlobs(cwd, ref) {
  let text;
  try {
    text = execFileSync("git", ["show", `${ref}:.review/red-paths`], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return DEFAULT_RED;
  }
  return text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
}

function isRed(file, globs) {
  return globs.some((g) => path.matchesGlob(file, g));
}

// Docs do not void a reply. A RED file never counts as docs: SKILL.md is code.
function isDocs(file, globs) {
  const base = path.basename(file);
  return (/\.(md|markdown|rst|adoc)$/i.test(base) || /^(README|CHANGELOG|LICENSE)/i.test(base)) && !isRed(file, globs);
}

const KIND = { L: "row", G: "gaming", C: "contradiction", R: "red", S: "other", P: "preexisting", E: "escalation" };
const ID = /^([A-Z]+)(\d+)([A-Za-z0-9]*)$/;

function kindOf(id) {
  const m = id.match(ID);
  return m ? KIND[m[1]] : undefined;
}

// Lines outside fenced blocks, so a quoted seat report can't add items.
function unfenced(md) {
  const out = [];
  let fence = null;
  md.split(/\r?\n/).forEach((text, i) => {
    const f = text.match(/^\s*(`{3,}|~{3,})/);
    if (fence) {
      if (f && f[1][0] === fence[0] && f[1].length >= fence.length && !text.trim().slice(f[1].length)) fence = null;
      return;
    }
    if (f) { fence = f[1]; return; }
    out.push({ text, line: i + 1 });
  });
  return out;
}

// Every finding that needs an answer: each `### <ID> · title` block, and each
// ledger row whose Verdict column starts RISKY or WRONG.
function parseMap(md) {
  const lines = unfenced(md);
  const items = [];
  let cur = null;
  let verdictCol = -1;
  const head = md.match(/^\*\*Head:\*\*\s*`?([0-9a-f]{7,40})/im)?.[1] ?? md.match(/\bHead:\s*`?([0-9a-f]{7,40})/i)?.[1];
  const door = md.match(/\bDoor:\*{0,2}\s*(one-way|two-way)/i)?.[1]?.toLowerCase();
  const depth = md.match(/\bDepth:\*{0,2}\s*(light|deep)/i)?.[1]?.toLowerCase();
  for (const { text } of lines) {
    const h = text.match(/^###\s+([A-Z]+\d+[A-Za-z0-9]*)\b\s*[·:-]?\s*(.*)$/);
    if (h && kindOf(h[1])) {
      cur = { id: h[1], kind: kindOf(h[1]), title: h[2].trim(), text: "" };
      items.push(cur);
      continue;
    }
    if (/^#{1,3}\s/.test(text)) { cur = null; continue; }
    const cells = /^\|.*\|\s*$/.test(text) ? text.trim().slice(1, -1).split("|").map((c) => c.trim()) : null;
    if (cells && cells[0] === "#") { verdictCol = cells.findIndex((c) => /^verdict$/i.test(c)); continue; }
    const verdict = cells && /^L\d+[A-Za-z0-9]*$/.test(cells[0]) && verdictCol > 0
      ? cells[verdictCol]?.match(/^\**(RISKY|WRONG)\b/)?.[1] : undefined;
    if (verdict) {
      items.push({ id: cells[0], kind: "row", verdict, title: cells[1] ?? "", text: cells.slice(1).join(" ") });
      cur = null;
      continue;
    }
    if (cur) cur.text += text + "\n";
  }
  return { head, door, depth, items };
}

module.exports = { MAP_MARKER, REPLY_MARKER, VERDICT_MARKER, DEFAULT_RED, readRedGlobs, isRed, isDocs, kindOf, unfenced, parseMap };
