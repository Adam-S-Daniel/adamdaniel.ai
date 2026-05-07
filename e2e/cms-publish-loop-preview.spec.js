// @lane: real — drives the real Decap CMS in a PR preview env against real GitHub
// @select-skip-when-head-ref-prefix: cms/
//
// On `cms/*` PRs (Decap-opened editorial PRs) this spec self-skips at
// runtime — PR_NUMBER / PR_HEAD_REF / CMS_E2E_PAT aren't wired into the
// standard PR matrix — so selecting + bringing it up just to no-op is
// pure waste. The dedicated preview workflow exercises this path.

/*
 * Real-browser end-to-end test for the CMS publish loop driven through a
 * PR-preview environment (preview-pr<N>.adamdaniel.ai/admin/), targeting
 * the PR's head branch.
 *
 * Why a preview-env variant: the host-repo spec (cms-publish-loop.spec.js)
 * tests the loop into `main`, but every other contributor flow happens on
 * a feature branch's preview. The preview admin's `admin/config.yml` is
 * patched at deploy time to use `backend.branch = <head ref>`, so saves
 * open `cms/...` PRs against the feature branch — a different code path
 * (and a different branch-protection regime) from the main flow. This
 * spec validates that loop end-to-end on a real subdomain.
 *
 * Gating:
 *   - PR_NUMBER must be set (the workflow exposes it from
 *     `github.event.pull_request.number`).
 *   - PR_HEAD_REF must be set (the workflow exposes it from
 *     `github.event.pull_request.head.ref`).
 *   - CMS_E2E_PAT must be set.
 *   - Runs once on chromium-desktop only.
 *
 * Cleanup: writes the canary baseline back to the PR head branch via the
 * Contents API. Because the head branch belongs to a feature PR, a stale
 * canary state has zero blast radius — when the parent PR merges (or
 * closes), the branch is deleted and the canary edit dies with it.
 */
const { test, expect } = require("./base");
const { seedDecapAuth, getPat, HOST_REPO } = require("./decap-pat");
const { findCanary, makeMarker } = require("./canary-content");
const {
  addLabel,
  fetchPublicUrl,
  gh,
  waitForAutoMergeEnabled,
  waitForCmsPullRequest,
  waitForMerge,
  waitForWorkflowRun,
} = require("./github-actions-poll");

const CANARY = findCanary("page");
const PR_NUMBER = process.env.PR_NUMBER || process.env.GITHUB_PR_NUMBER || "";
const PR_HEAD_REF = process.env.PR_HEAD_REF || process.env.GITHUB_HEAD_REF || "";

const PREVIEW_HOST = PR_NUMBER ? `https://preview-pr${PR_NUMBER}.adamdaniel.ai` : "";
const PREVIEW_ADMIN = `${PREVIEW_HOST}/admin/`;
const PREVIEW_PUBLIC_URL = `${PREVIEW_HOST}${CANARY.publicPath}`;

const TEST_TIMEOUT_MS = 12 * 60 * 1000;

test.describe.configure({
  mode: "serial",
  timeout: TEST_TIMEOUT_MS,
  // Real-state mutation; a Playwright retry just re-walks the same
  // broken chain after wasting another 12 min — and on the
  // cms-publish-loop-preview workflow with timeout-minutes: 20,
  // a retry consistently runs out of GHA budget and gets cancelled
  // mid-attempt (run #25468569663 hit exactly this on 2026-05-07).
  retries: 0,
});

function toContentBase64(text) {
  return Buffer.from(text, "utf8").toString("base64");
}

async function fetchCanaryFromBranch(branch) {
  return gh(`/repos/${HOST_REPO}/contents/${CANARY.path}?ref=${encodeURIComponent(branch)}`);
}

async function writeCanaryOnBranch({ branch, bodyText, message }) {
  const current = await fetchCanaryFromBranch(branch);
  const decoded = Buffer.from(current.content, "base64").toString("utf8");
  const fmEnd = decoded.indexOf("\n---\n", 4);
  if (fmEnd < 0) throw new Error("Canary file is missing closing front-matter delimiter.");
  const frontMatter = decoded.slice(0, fmEnd + 5);
  const newFile = `${frontMatter}\n${bodyText}\n`;
  return gh(`/repos/${HOST_REPO}/contents/${CANARY.path}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      content: toContentBase64(newFile),
      sha: current.sha,
      branch,
    }),
  });
}

test("CMS publish loop — preview env, target PR head branch", async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium-desktop",
    "Preview publish-loop is real-network — runs once on chromium-desktop only.",
  );
  test.skip(!getPat(), "CMS_E2E_PAT not set — preview publish-loop disabled.");
  test.skip(
    !PR_NUMBER || !PR_HEAD_REF,
    "PR_NUMBER / PR_HEAD_REF not set — this spec only runs in PR CI.",
  );

  const runId = Date.now();
  const marker = makeMarker(`preview-${CANARY.id}`, runId);
  const baselineBody = CANARY.baseline;

  // ── 0. Reset canary on the PR head branch ───────────────────────
  await test.step("Reset canary baseline on PR head branch via Contents API", async () => {
    await writeCanaryOnBranch({
      branch: PR_HEAD_REF,
      bodyText: `${baselineBody}\n\nThis URL exists so the automated end-to-end publish-loop tests have a stable\ntarget to assert against on both preview-pr<N>.adamdaniel.ai and\nadamdaniel.ai. The body is replaced during a test run and reset to this\nbaseline in cleanup, so the public URL always renders innocuous content\nbetween runs.\n\nIf this is the only thing you can see, no test is currently in progress.`,
      message: `test(canary): reset page baseline before preview publish-loop run ${runId}`,
    });
  });

  await test.step("Confirm baseline is live on preview before driving admin", async () => {
    await fetchPublicUrl(PREVIEW_PUBLIC_URL, {
      expectContent: baselineBody,
      timeoutMs: 8 * 60 * 1000,
    });
  });

  await seedDecapAuth(page);
  await test.step("Load preview admin", async () => {
    await page.goto(PREVIEW_ADMIN, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("link", { name: /^Posts$/i })).toBeVisible({ timeout: 60_000 });
  });

  await test.step("Navigate to canary entry", async () => {
    // Mirror the host-loop spec's navigate-by-slug pattern: go
    // straight to the entry instead of clicking the first /Canary/i
    // link in the collection list. The e2e collection has multiple
    // canaries (page/post/project) plus any leftover throw-away
    // `canary-delete-<runId>` fixtures from failed delete-spec runs,
    // and the sidebar's display order can't be relied on to land on
    // the configured one (CANARY.id). Run #25470995760 hit exactly
    // this — `.getByRole("link", { name: /Canary/i }).first()`
    // landed on a stale `canary-delete-1778008012598` entry, the
    // marker insert went into the wrong file, and Decap opened a
    // cms PR for a `_e2e/canary-delete-*` change that
    // `waitForCmsPullRequest({ filePath: "_e2e/canary-page.md" })`
    // never matched.
    await page.goto(
      `${PREVIEW_ADMIN}#/collections/${CANARY.cmsCollection}/entries/${CANARY.slug}`,
      { waitUntil: "domcontentloaded" },
    );
    await expect(page.getByRole("textbox", { name: /^Title$/i })).toBeVisible({ timeout: 30_000 });
  });

  await test.step("Insert run marker into body and Save", async () => {
    // Mirror cms-publish-loop.spec.js's working selector: the pinned
    // Decap version no longer exposes "Body" / "Content" as the
    // textbox's accessible name (run #25470209346 hit a 720s timeout
    // on `getByRole("textbox", { name: /Body|Content/i })`). Grab the
    // last contenteditable textbox on the page; the live preview
    // iframe is not a textbox, so .last() lands on the editor body.
    const body = page.locator('[role="textbox"][contenteditable="true"]').last();
    await body.click();
    await body.press("End");
    await body.pressSequentially(`\n\n${marker}\n`);
    await page.getByRole("button", { name: /^Save$/i }).click();
    // In editorial_workflow mode (preview admin), Save stays
    // disabled after the save completes — the toolbar swaps in
    // status pills + a "Publish" button. Wait for the "Changes
    // saved" status text instead of the (incorrect) toBeEnabled
    // signal that the host-loop spec also walked away from.
    await expect(page.getByText(/Changes saved/i).first()).toBeVisible({ timeout: 60_000 });
  });

  let pr;
  await test.step("Wait for Decap to open the cms/... PR against the PR head", async () => {
    pr = await waitForCmsPullRequest({
      base: PR_HEAD_REF,
      filePath: CANARY.path,
      canaryMarker: marker,
      timeoutMs: 5 * 60 * 1000,
    });
  });

  await test.step("Wait for validate-content to succeed", async () => {
    await waitForWorkflowRun({
      workflow: "cms-editorial-workflow.yml",
      headSha: pr.head.sha,
      branch: pr.head.ref,
      timeoutMs: 6 * 60 * 1000,
    });
  });

  await test.step("Label PR cms/ready", async () => {
    await addLabel({ prNumber: pr.number, label: "cms/ready" });
  });

  // The PR #78 chicken-and-egg issue (auto-merge "unstable" rollup on
  // feature-branch PRs with no required checks) is now mitigated by the
  // ruleset added under .github/rulesets/cms-feature-branches.json. If
  // the ruleset is missing or the required check name drifts, this step
  // fails and surfaces the regression.
  await test.step("Wait for auto-merge to be enabled on PR head", async () => {
    await waitForAutoMergeEnabled({ prNumber: pr.number });
  });

  await test.step("Wait for PR to merge into PR head branch", async () => {
    await waitForMerge({ prNumber: pr.number });
  });

  await test.step("Wait for deploy-preview.yml to redeploy", async () => {
    // The merge into the PR head branch should retrigger deploy-preview's
    // synchronize event on the parent PR. The latest run on the parent PR
    // is what we want.
    await waitForWorkflowRun({
      workflow: "deploy-preview.yml",
      branch: PR_HEAD_REF,
      timeoutMs: 8 * 60 * 1000,
    });
  });

  await test.step("Verify marker is live on the preview subdomain", async () => {
    await fetchPublicUrl(PREVIEW_PUBLIC_URL, {
      expectContent: marker,
      timeoutMs: 6 * 60 * 1000,
    });
  });

  // ── Verify the preview-build pill resolved to a non-spinner state ──
  // Mirror of the prod publish-loop's pill assertion (cms-publish-loop
  // .spec.js step 8a) — same contract, different pill ID. While
  // deploy-preview is in flight, `cms-preview-build-pill` shows a
  // spinner with text "Preview build…"; after success it HIDES (and
  // Decap's built-in deploy-preview-links feature surfaces a
  // clickable Preview link in the toolbar). The deploy-status-pill
  // polls every 30s, so allow up to 90s after the merge for the
  // pill to reach its terminal hidden state.
  await test.step("Preview-build pill: in-flight spinner resolved to hidden after deploy", async () => {
    await page.goto(PREVIEW_ADMIN, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("link", { name: /^Posts$/i })).toBeVisible({
      timeout: 60_000,
    });
    await page.waitForFunction(
      () => {
        const el = document.getElementById("cms-preview-build-pill");
        return !el || el.style.display === "none";
      },
      undefined,
      { timeout: 90_000 },
    );
  });

  await test.step("Reset canary baseline on PR head branch (cleanup)", async () => {
    await writeCanaryOnBranch({
      branch: PR_HEAD_REF,
      bodyText: `${baselineBody}\n\nThis URL exists so the automated end-to-end publish-loop tests have a stable\ntarget to assert against on both preview-pr<N>.adamdaniel.ai and\nadamdaniel.ai. The body is replaced during a test run and reset to this\nbaseline in cleanup, so the public URL always renders innocuous content\nbetween runs.\n\nIf this is the only thing you can see, no test is currently in progress.`,
      message: `test(canary): reset page baseline after preview publish-loop run ${runId}`,
    });
  });
});
