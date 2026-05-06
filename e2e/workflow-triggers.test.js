// @lane: local — pure-fs lint of workflow YAML; no browser, no network
/*
 * Regression test: e2e-tests.yml must NOT carry a push-to-main trigger.
 * Branch protection's required-check on the PR run already covers main,
 * so a redundant push trigger doubles matrix-runner billing for zero
 * extra signal. (Audit finding #20.)
 */
const { test, expect } = require("./base");
const { readWorkflow, topBlock } = require("./workflow-yaml-utils");

test("e2e-tests.yml does not trigger on push", () => {
  const code = topBlock(readWorkflow("e2e-tests.yml"), "on")
    .split("\n")
    .filter((l) => !/^\s*#/.test(l)) // comments may legitimately mention "push"
    .join("\n");
  expect(
    code,
    "e2e-tests.yml must not declare a `push:` trigger — the PR run is " +
      "already a required check on main, so push runs are redundant " +
      "double-billing.",
  ).not.toMatch(/^\s*push:/m);
});
