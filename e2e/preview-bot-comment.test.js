// @lane: local — pure-fs lint of the deploy-preview workflow YAML
/*
 * Regression test for the deploy-preview bot's sticky comment.
 *
 * Both the deploy and teardown paths must reuse the same
 * `<!-- adamdaniel-preview-bot -->` marker so the PR ends up with one
 * comment that flips between "deployed" and "cleaned up", not a stack
 * of stale comments. (Audit finding #14.)
 */
const { test, expect } = require("./base");
const { readWorkflow, jobBlock } = require("./workflow-yaml-utils");

const MARKER = "<!-- adamdaniel-preview-bot -->";

for (const job of ["deploy-preview", "teardown-preview"]) {
  test(`${job} job references the sticky-comment marker`, () => {
    const block = jobBlock(readWorkflow("deploy-preview.yml"), job);
    expect(block, `${job} job not found`).not.toBeNull();
    expect(
      block.includes(MARKER),
      `${job} must reuse ${MARKER} so the same comment updates rather than spamming`,
    ).toBe(true);
  });
}
