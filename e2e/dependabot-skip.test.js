/*
 * Regression test: every job that references an AWS/PREVIEW/PRODUCTION
 * secret must skip when the actor is dependabot[bot] — Dependabot PRs
 * can't access OIDC role secrets, and a job that runs anyway would go
 * red on every Dependabot bump. (Audit findings #9 / #25.)
 *
 * Workflows triggered only by `push` to main (which Dependabot can't do
 * directly) are exempt — the on-trigger itself prevents the actor from
 * ever being dependabot[bot]. Such jobs may carry an above-job comment
 * `# allowed for dependabot: <reason>` to be explicit.
 */
const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("./base");
const { jobBlocks, listWorkflows, topBlock } = require("./workflow-yaml-utils");

const SECRET_RE = /secrets\.(AWS_|PRODUCTION_|PREVIEW_)/;
const DEPENDABOT_GUARD =
  /github\.actor\s*!=\s*'dependabot\[bot\]'/;

function isPullRequestTriggered(yaml) {
  return /^\s*pull_request:/m.test(topBlock(yaml, "on"));
}

function jobSkipsDependabot(job) {
  return DEPENDABOT_GUARD.test(job.body);
}

function hasAllowComment(job) {
  return job.leadingComments.some((l) => /allowed for dependabot:/i.test(l));
}

for (const file of listWorkflows()) {
  const yaml = fs.readFileSync(file, "utf8");
  if (!isPullRequestTriggered(yaml)) continue;
  for (const job of jobBlocks(yaml)) {
    if (!SECRET_RE.test(job.body)) continue;
    test(`${path.basename(file)} :: ${job.name} skips dependabot[bot]`, () => {
      expect(
        jobSkipsDependabot(job) || hasAllowComment(job),
        `Job '${job.name}' in ${path.basename(file)} references ` +
          `AWS_*/PRODUCTION_*/PREVIEW_* secrets but doesn't gate on ` +
          `github.actor != 'dependabot[bot]'. Either add the gate or ` +
          `place a '# allowed for dependabot: <reason>' comment above ` +
          `the job.`,
      ).toBe(true);
    });
  }
}
