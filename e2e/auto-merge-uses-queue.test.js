// @lane: local — pure-fs lint of the cms-editorial-workflow workflow YAML
/*
 * Regression test: cms-editorial-workflow must enable GitHub's
 * native auto-merge (queue-based, respects required checks) — never
 * an unconditional `gh pr merge --merge` / `--squash` that would
 * bypass the required-checks list. (Audit finding #26.)
 */
const { test, expect } = require("./base");
const { readWorkflow } = require("./workflow-yaml-utils");

function stripComments(yaml) {
  return yaml
    .split("\n")
    .filter((l) => !/^\s*#/.test(l))
    .join("\n");
}

test("no unconditional `gh pr merge --merge|--squash` (without --auto)", () => {
  const code = stripComments(readWorkflow("cms-editorial-workflow.yml"));
  // Each `gh pr merge ...` call ends at the next newline / pipe / &&.
  const re = /gh\s+pr\s+merge\b([^\n;|&]*)/g;
  let m;
  while ((m = re.exec(code)) !== null) {
    const flags = m[1];
    if (/--disable-auto/.test(flags)) continue; // disable-auto is fine
    expect(flags, `Found: 'gh pr merge${flags}'`).toMatch(/--auto\b/);
  }
});

test("enablePullRequestAutoMerge GraphQL mutation IS used", () => {
  expect(readWorkflow("cms-editorial-workflow.yml")).toMatch(
    /enablePullRequestAutoMerge\b/,
  );
});
