#!/usr/bin/env node
// Blast radius and depth by script, never by a model: which changed files are
// RED (.review/red-paths on the base ref, else the defaults in lib.cjs) and
// whether the run is deep (any RED file, or more than 1,000 changed lines).
//
//   node risk.cjs --base <ref> [--head <ref>]                 prints JSON
//   node risk.cjs --base <ref> --since <reply head> [--head]  code pushed since a reply
//
// --since ignores files the PR doesn't touch (an "Update branch" merge brings
// base's files along); `code` lists the rest that aren't docs. Any is a void.

const { execFileSync } = require("node:child_process");
const { readRedGlobs, isRed, isDocs } = require("./lib.cjs");

const DEEP_LINES = 1000;

function assess(numstat, globs) {
  const files = numstat.split("\n").filter(Boolean).map((l) => {
    const [add, del, ...rest] = l.split("\t");
    const file = rest.join("\t");
    const lines = (add === "-" ? 0 : +add) + (del === "-" ? 0 : +del);
    return { file, lines, red: isRed(file, globs) };
  });
  const changedLines = files.reduce((n, f) => n + f.lines, 0);
  const red = files.filter((f) => f.red).map((f) => f.file);
  return { changedLines, files, red, depth: red.length || changedLines > DEEP_LINES ? "deep" : "light" };
}

function git(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 64 << 20 }).trim();
}

function defaultBase(cwd) {
  try { return git(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], cwd); } catch { return "main"; }
}

// Files changed since `since` that the PR itself touches: same content as base
// means the change came in with a base merge.
function sinceReply(changed, sameAsBase, globs) {
  const own = changed.filter((f) => !sameAsBase(f));
  return { changed: own, code: own.filter((f) => !isDocs(f, globs)), red: own.filter((f) => isRed(f, globs)) };
}

function blob(cwd, ref, file) {
  try { return git(["rev-parse", `${ref}:${file}`], cwd); } catch { return null; }
}

function main(argv) {
  const opt = {};
  for (let i = 0; i < argv.length; i += 2) opt[argv[i].replace(/^--/, "")] = argv[i + 1];
  const cwd = process.cwd();
  const base = opt.base ?? defaultBase(cwd);
  const head = opt.head ?? "HEAD";
  const globs = readRedGlobs(cwd, base);
  if (opt.since) {
    const changed = git(["diff", "--name-only", "--no-renames", opt.since, head], cwd).split("\n").filter(Boolean);
    const r = sinceReply(changed, (f) => blob(cwd, head, f) === blob(cwd, base, f), globs);
    console.log(JSON.stringify({ base, since: opt.since, head, ...r }, null, 2));
    return 0;
  }
  const r = assess(git(["diff", "--numstat", "--no-renames", `${base}...${head}`], cwd), globs);
  console.log(JSON.stringify({ base, head, ...r }, null, 2));
  return 0;
}

module.exports = { assess, sinceReply, DEEP_LINES };
if (require.main === module) process.exitCode = main(process.argv.slice(2));
