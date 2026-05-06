// @lane: local — pure-fs lint of workflow YAML; no browser, no network
/*
 * Regression test: no workflow may call `git log` with `${{ github.sha }}`.
 *
 * On `pull_request` events, `github.sha` is the synthesised merge
 * commit GitHub creates between the PR head and the base. Shallow
 * clones don't fetch that commit, so `git log <github.sha>` fails
 * with `bad object`. Use `HEAD` (the PR head sha is what's checked
 * out) or `${{ github.event.pull_request.head.sha }}`. (Audit
 * chat-finding #7.)
 */
const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("./base");
const { listWorkflows } = require("./workflow-yaml-utils");

for (const file of listWorkflows()) {
  test(`${path.basename(file)} :: no \`git log\` against \${{ github.sha }}`, () => {
    const offenders = fs
      .readFileSync(file, "utf8")
      .split("\n")
      .map((line, i) => ({ line, i: i + 1 }))
      // Strip yaml/shell comment lines — explainer prose may
      // legitimately mention the anti-pattern.
      .filter(({ line }) => !/^\s*#/.test(line) && /git log\b/.test(line))
      .filter(({ line }) => /\$\{\{\s*github\.sha\s*\}\}/.test(line));

    expect(
      offenders,
      `${path.basename(file)} uses \${{ github.sha }} in a git log ` +
        `invocation. On pull_request events github.sha is a synthetic ` +
        `merge commit not present in shallow clones — use HEAD or ` +
        `github.event.pull_request.head.sha instead.\n` +
        offenders.map((o) => `  line ${o.i}: ${o.line.trim()}`).join("\n"),
    ).toEqual([]);
  });
}
