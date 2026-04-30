/*
 * Regression test: the `commit.json` step in deploy-{preview,production}
 * must read the timestamp from `git log` against HEAD (or a derived
 * refstring), not from `${{ github.sha }}`.
 *
 * On `pull_request` events, `github.sha` is a synthetic merge commit
 * created by GitHub — it isn't fetched into shallow clones, so
 * `git log -1 --format=%cI ${{ github.sha }}` fails with `bad object`.
 * (Audit chat-finding #7.)
 */
const { test, expect } = require("./base");
const { readWorkflow } = require("./workflow-yaml-utils");

// Pull every step block (split on `- name:`) whose body mentions
// commit.json — that's the deployed-build pill writer.
function commitJsonStepBlocks(yaml) {
  const stepRe = /-\s+name:[^\n]*\n([\s\S]*?)(?=^\s*-\s+name:|^\s{2}\S|\Z)/gm;
  const blocks = [];
  let m;
  while ((m = stepRe.exec(yaml)) !== null) {
    if (m[0].includes("commit.json")) blocks.push(m[0]);
  }
  return blocks;
}

function stripComments(yaml) {
  return yaml
    .split("\n")
    .filter((l) => !/^\s*#/.test(l))
    .join("\n");
}

for (const wf of ["deploy-preview.yml", "deploy-production.yml"]) {
  const steps = commitJsonStepBlocks(readWorkflow(wf));

  test(`${wf} writes commit.json`, () => {
    expect(
      steps.length,
      `Expected a commit.json step in ${wf} — the deployed-build pill ` +
        `in admin/index.html depends on it.`,
    ).toBeGreaterThan(0);
  });

  steps.forEach((step, i) => {
    test(`${wf} commit.json step #${i + 1} uses HEAD, not github.sha`, () => {
      const code = stripComments(step);
      expect(code).toMatch(/git log\b/);
      const offenders = code
        .split("\n")
        .filter(
          (l) => /git log\b/.test(l) && /\$\{\{\s*github\.sha\s*\}\}/.test(l),
        );
      expect(
        offenders,
        `git log in ${wf} must use HEAD or github.event.pull_request.head.sha, ` +
          `not \${{ github.sha }} (synthetic merge commit, not in shallow ` +
          `clones).`,
      ).toEqual([]);
    });
  });
}
