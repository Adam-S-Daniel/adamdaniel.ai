// @lane: local — pure-fs anti-drift lint for cms-automerge-nudge.yml (#1815)
//
// The nudge workflow only acts on a PR when EVERY required-status-check
// has latest=SUCCESS / NEUTRAL / SKIPPED. That list is hard-coded in
// the workflow's inline github-script (we cannot easily fetch the
// ruleset at runtime — the GITHUB_TOKEN doesn't have repo-admin scope
// and the PAT shouldn't either). This lint locks the workflow's
// REQUIRED set to .github/rulesets/main.json's required_status_checks
// array — if the ruleset adds or removes a context, this test fails
// LOUD on every PR until the workflow is updated.

const { test, expect } = require("./base");
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "..");
const RULESET_PATH = path.join(REPO_ROOT, ".github/rulesets/main.json");
const NUDGE_WORKFLOW_PATH = path.join(REPO_ROOT, ".github/workflows/cms-automerge-nudge.yml");

function rulesetRequiredContexts() {
  const json = JSON.parse(fs.readFileSync(RULESET_PATH, "utf8"));
  const rule = json.rules.find((r) => r.type === "required_status_checks");
  expect(rule, "main.json must declare required_status_checks").toBeTruthy();
  return rule.parameters.required_status_checks.map((c) => c.context).sort();
}

function nudgeRequiredContexts() {
  const yaml = fs.readFileSync(NUDGE_WORKFLOW_PATH, "utf8");
  // Match the `new Set([ ... ]);` block declaring REQUIRED.
  const m = yaml.match(/const REQUIRED = new Set\(\[\s*([\s\S]*?)\s*\]\);/);
  expect(
    m,
    "cms-automerge-nudge.yml must declare `const REQUIRED = new Set([ ... ]);`",
  ).toBeTruthy();
  // Extract each quoted string from the array body.
  const items = [...m[1].matchAll(/['"]([^'"]+)['"]/g)].map((mm) => mm[1]);
  return items.slice().sort();
}

test.describe("cms-automerge-nudge — required-context lint (#1815)", () => {
  test("nudge REQUIRED set matches .github/rulesets/main.json required_status_checks", () => {
    const ruleset = rulesetRequiredContexts();
    const nudge = nudgeRequiredContexts();
    expect(nudge, "nudge REQUIRED must match the live ruleset; update both together").toEqual(
      ruleset,
    );
  });

  test("nudge workflow exists and is schedule-driven (no pull_request / push triggers — by design)", () => {
    const yaml = fs.readFileSync(NUDGE_WORKFLOW_PATH, "utf8");
    expect(yaml).toMatch(/^\s*schedule:/m);
    // The nudge MUST NOT fire on pull_request or push — those triggers
    // would (a) make it pointless (it can't help a PR's own checks) and
    // (b) trip the workflow-path-audit skill's filter requirement.
    expect(yaml).not.toMatch(/^\s*pull_request:/m);
    expect(yaml).not.toMatch(/^\s*push:/m);
  });

  test("nudge filters to PRs carrying the `automated-test` label", () => {
    const yaml = fs.readFileSync(NUDGE_WORKFLOW_PATH, "utf8");
    // Gate is in the GraphQL query (`labels:["automated-test"]`) — if
    // that's removed, the nudge could touch arbitrary PRs. Lock it.
    expect(yaml).toMatch(/labels:\s*\[\s*["']automated-test["']\s*\]/);
  });

  test("nudge only re-enables on PRs that already have auto-merge enabled (never enables from scratch)", () => {
    const yaml = fs.readFileSync(NUDGE_WORKFLOW_PATH, "utf8");
    // Guard: `if (!pr.autoMergeRequest) continue;`. If a future refactor
    // drops this guard, the nudge could enable auto-merge on a PR a
    // human explicitly disabled.
    expect(yaml).toMatch(/if\s*\(\s*!\s*pr\.autoMergeRequest\s*\)\s*continue\s*;/);
  });
});
