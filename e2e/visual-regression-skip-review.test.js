const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("./base");

// Locks in the "skip manual review when no visual regressions" behavior of
// .github/workflows/visual-regression.yml. The signal is the
// `totals.visuallyDifferent` count produced by compute-visual-diffs.js
// (different + new pages). When that count is zero, the approve-regression
// job must NOT enter the `regression-review` environment that requires a
// human reviewer — it should auto-pass the required status check.
//
// Pure text-grep against the YAML, same approach as cms-config.spec.js:
// avoids pulling in a YAML parser and lets us assert specific token shapes
// (the conditional expression is what GitHub Actions actually evaluates).

const WORKFLOW = path.join(
  __dirname,
  "..",
  ".github",
  "workflows",
  "visual-regression.yml",
);

function readWorkflow() {
  return fs.readFileSync(WORKFLOW, "utf8");
}

test.describe("visual-regression workflow: auto-approve when no diffs", () => {
  test("generate job exposes visually-different as a job output", () => {
    const yml = readWorkflow();
    // Job-level outputs block on the `generate` job, sourcing from a step.
    expect(yml).toMatch(
      /generate:\s*[\s\S]*?outputs:\s*[\s\S]*?visually-different:\s*\$\{\{\s*steps\.[a-zA-Z0-9_-]+\.outputs\.visually-different\s*\}\}/,
    );
  });

  test("compute-visual-diffs step writes visually-different to GITHUB_OUTPUT", () => {
    const yml = readWorkflow();
    // The step that runs compute-visual-diffs.js must also publish the
    // visuallyDifferent count to $GITHUB_OUTPUT. Check the literal echo
    // shape so a refactor that drops it fails loudly.
    expect(yml).toMatch(/visually-different=.*>>\s*"?\$GITHUB_OUTPUT"?/);
  });

  test("approve-regression environment is conditional on visually-different", () => {
    const yml = readWorkflow();
    // Conditional environment: only enter `regression-review` when the
    // count is non-zero. Empty string means "no environment" — the job
    // still runs and reports its required status check.
    expect(yml).toMatch(
      /approve-regression:[\s\S]*?environment:\s*\$\{\{[^}]*needs\.generate\.outputs\.visually-different[^}]*'regression-review'[^}]*\}\}/,
    );
  });

  test("approve-regression no longer hard-codes the regression-review environment", () => {
    const yml = readWorkflow();
    // Guard against regressing to `environment: regression-review` (the
    // unconditional gate). The literal line, with no `${{` expression,
    // would re-introduce the always-manual review.
    expect(yml).not.toMatch(/^\s+environment:\s+regression-review\s*$/m);
  });

  test("PR comment varies by visuallyDifferent count", () => {
    const yml = readWorkflow();
    // The bot comment script branches on `t.visuallyDifferent === 0` so
    // editors see "Auto-approved" instead of "Review required" when no
    // regressions are detected. Pure-text check on the script body.
    expect(yml).toMatch(/t\.visuallyDifferent\s*===\s*0/);
    expect(yml).toMatch(/Auto-approved/i);
  });
});
