const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const PLUGINS = path.join(__dirname, "..", "..");
const read = (p) => fs.readFileSync(path.join(PLUGINS, p), "utf8").replace(/\r\n/g, "\n");

const ADAPTER_USERS = [
  "vet/skills/map/SKILL.md",
  "vet/skills/address/SKILL.md",
  "vet/skills/verify/SKILL.md",
  "vet/skills/verify/references/verifier-brief.md",
  "cockpit/skills/vet-with-herdr/SKILL.md",
];

// A host CLI "named as something to run": `gh pr ...`, `az repos ...`, "gh and git read commands".
const HOST_CLI = /\b(?:gh|az)\s+(?:pr|issue|api|label|repo|repos|account|boards|devops)\b|\b(?:gh|az)\s+and\s+git\b/;

test("no vet skill, verifier brief or cockpit vet skill names gh or az as something to run", () => {
  for (const f of ADAPTER_USERS) {
    read(f).split("\n").forEach((line, i) => {
      assert.ok(!HOST_CLI.test(line), `${f}:${i + 1} names a host CLI to run: ${line.trim()}`);
    });
  }
});

test("each of them calls the forge adapter", () => {
  for (const f of ADAPTER_USERS) assert.match(read(f), /forge\.cjs/, `${f} does not call forge.cjs`);
});

test("verifier brief allows only git reads, pr-view, issue-view and the two analysis scripts", () => {
  const b = read("vet/skills/verify/references/verifier-brief.md");
  assert.match(b, /pr-view/);
  assert.match(b, /issue-view/);
  assert.match(b, /edited/);
  assert.match(b, /two\s+analysis scripts/);
  for (const w of ["pr-comment", "pr-minimize", "pr-edit-body", "pr-label", "pr-status", "pr-checkout", "issue-create"]) {
    assert.ok(!b.includes(w), `verifier brief must not allow ${w}`);
  }
});

test("map-format states the trust rule per host and the Azure DevOps comment limit", () => {
  const m = read("vet/references/map-format.md");
  assert.match(m, /Azure DevOps/);
  assert.match(m, /trusted/);
  assert.match(m, /150,000/);
  assert.match(m, /65,536/);
});

test("verify documents the required check for both hosts", () => {
  const v = read("vet/skills/verify/SKILL.md");
  assert.match(v, /branch protection/i);
  assert.match(v, /branch policy/i);
  assert.match(v, /genre.{0,10}vet/i);
});

test("README states the vet requirements for both hosts", () => {
  const r = fs.readFileSync(path.join(PLUGINS, "..", "README.md"), "utf8");
  const line = r.split(/\r?\n/).find((l) => l.startsWith("- `vet`:"));
  assert.ok(line, "no vet requirement line");
  assert.match(line, /Node 22/);
  assert.match(line, /`gh`/);
  assert.match(line, /`az`/);
  assert.match(line, /azure-devops/);
});

test("memory guard in the three cockpit skills has macOS, Windows and Linux forms", () => {
  for (const f of ["orchestrate", "implement-with-herdr", "vet-with-herdr"]) {
    const s = read(`cockpit/skills/${f}/SKILL.md`);
    assert.match(s, /memory_pressure/, `${f}: macOS form`);
    assert.match(s, /powershell/i, `${f}: Windows form`);
    assert.match(s, /FreePhysicalMemory/, `${f}: Windows form measures free memory`);
    assert.match(s, /\bfree\b.*MemAvailable|free -m|`free\b/, `${f}: Linux form`);
  }
});
