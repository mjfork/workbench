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

// `git diff -z --numstat`: "add\tdel\tpath\0" per file, paths raw (no quoting).
function assess(numstat, globs) {
  const files = numstat.split("\0").filter(Boolean).map((l) => {
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
  return execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 64 << 20 }).replace(/\n$/, "");
}

function defaultBase(cwd) {
  try { return git(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], cwd); } catch { return "main"; }
}

// Files changed since `since`, less those a base merge brought in: untouched by
// the PR at the reply and identical to base now. A PR file reverted to base
// after the reply still counts.
function sinceReply(changed, sameAsBase, touchedAtReply, globs) {
  const own = changed.filter((f) => touchedAtReply(f) || !sameAsBase(f));
  return { changed: own, code: own.filter((f) => !isDocs(f, globs)), red: own.filter((f) => isRed(f, globs)) };
}

function blob(cwd, ref, file) {
  try {
    return execFileSync("git", ["rev-parse", `${ref}:${file}`], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;   // absent on that ref
  }
}

function main(argv) {
  const opt = {};
  for (let i = 0; i < argv.length; i += 2) opt[argv[i].replace(/^--/, "")] = argv[i + 1];
  const cwd = process.cwd();
  const base = opt.base ?? defaultBase(cwd);
  const head = opt.head ?? "HEAD";
  const globs = readRedGlobs(cwd, base);
  if (opt.since) {
    const names = (args) => git(["diff", "-z", "--name-only", "--no-renames", ...args], cwd).split("\0").filter(Boolean);
    const atReply = new Set(names([`${base}...${opt.since}`]));
    const r = sinceReply(names([opt.since, head]), (f) => blob(cwd, head, f) === blob(cwd, base, f), (f) => atReply.has(f), globs);
    console.log(JSON.stringify({ base, since: opt.since, head, ...r }, null, 2));
    return 0;
  }
  const r = assess(git(["diff", "-z", "--numstat", "--no-renames", `${base}...${head}`], cwd), globs);
  console.log(JSON.stringify({ base, head, ...r }, null, 2));
  return 0;
}

module.exports = { assess, sinceReply, DEEP_LINES };
if (require.main === module) process.exitCode = main(process.argv.slice(2));
