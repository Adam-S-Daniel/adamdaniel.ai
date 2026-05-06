// @lane: local — pure-fs lint of cms-editorial-workflow YAML; no browser, no network
/*
 * Regression tests for the cms-editorial-workflow job graph.
 *
 * Catches the parallel-execution bug where `auto-merge-when-ready` ran
 * alongside `validate-content` instead of after it — a malformed front
 * matter could enable auto-merge before the content-validation job had
 * a chance to fail. (Audit finding #13.)
 */
const { test, expect } = require("./base");
const { readWorkflow, jobBlock, topBlock } = require("./workflow-yaml-utils");

test("auto-merge-when-ready needs validate-content", () => {
  const block = jobBlock(
    readWorkflow("cms-editorial-workflow.yml"),
    "auto-merge-when-ready",
  );
  expect(block, "auto-merge-when-ready job not found").not.toBeNull();
  expect(block).toMatch(/needs:\s*validate-content/);
});

test("auto-merge-when-ready fires only on labeled cms/ready", () => {
  const block = jobBlock(
    readWorkflow("cms-editorial-workflow.yml"),
    "auto-merge-when-ready",
  );
  expect(block).not.toBeNull();
  expect(block).toMatch(/github\.event\.action\s*==\s*'labeled'/);
  expect(block).toMatch(/github\.event\.label\.name\s*==\s*'cms\/ready'/);
});

test("validate-content has no pull_request paths filter (required check must always report)", () => {
  // The `cms-feature-branches` ruleset makes validate-content a required
  // check on PRs into every feature-branch pattern. If we gate this
  // workflow by `paths:`, a feature-branch PR that doesn't touch CMS
  // content never produces the check, the merge stays BLOCKED forever,
  // and the auto-merge regression issue #79 was meant to fix returns.
  const yaml = readWorkflow("cms-editorial-workflow.yml");
  const onBlock = topBlock(yaml, "on");
  expect(onBlock, "on: block not found").not.toBeNull();
  // Match `paths:` only at the indent level of the pull_request event
  // (4 spaces) — ignores `paths:` inside `paths-ignore:` or unrelated
  // nested keys.
  const offendingLine = onBlock
    .split(/\r?\n/)
    .find((l) => /^\s{4}paths:\s*$/.test(l));
  expect(
    offendingLine,
    "cms-editorial-workflow.yml must NOT gate `validate-content` by paths — see comment block in the workflow.",
  ).toBeUndefined();
});
