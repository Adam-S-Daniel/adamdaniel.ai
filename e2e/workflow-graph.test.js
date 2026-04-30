/*
 * Regression tests for the cms-editorial-workflow job graph.
 *
 * Catches the parallel-execution bug where `auto-merge-when-ready` ran
 * alongside `validate-content` instead of after it — a malformed front
 * matter could enable auto-merge before the content-validation job had
 * a chance to fail. (Audit finding #13.)
 */
const { test, expect } = require("./base");
const { readWorkflow, jobBlock } = require("./workflow-yaml-utils");

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
