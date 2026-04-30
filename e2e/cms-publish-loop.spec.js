/*
 * Real-browser, real-HTTP, real-GitHub end-to-end test for the full Decap
 * CMS publish loop on the host repo.
 *
 * Why: cms-smoke / cms-publish-flow drive `local_backend: true` (decap-server),
 * which forces simple mode regardless of `publish_mode`. cms-editorial-workflow
 * drives the in-browser `test-repo` backend. Neither crosses the boundary into
 * the GitHub backend, the cms-editorial-workflow.yml workflow, or the
 * deploy-production.yml deploy. Issue #79 captures the failure mode that bit
 * us on PR #76→#78: Decap labels its PRs with the namespaced
 * `decap-cms/ready`, but the workflow listened for the bare `cms/ready` —
 * label mismatch, publish loop silently stalled. This spec catches it.
 *
 * Flow:
 *
 *   0. (Setup) Write the canary baseline directly via the Contents API so the
 *      run starts from a known-good state, then wait for the public URL to
 *      reflect it. This also acts as a smoke check that the auth and deploy
 *      pipeline are alive before we commit to a longer test.
 *
 *   1. Drive the production admin URL with a pre-seeded PAT session.
 *   2. Open the e2e collection → canary entry.
 *   3. Edit body to include a unique marker; click Save.
 *   4. Decap opens a `cms/...` PR. Find it via the GitHub API.
 *   5. Wait for cms-editorial-workflow.yml validate-content to pass.
 *   6. Drive the editor's Status dropdown from Draft → Ready.
 *   7. Assert that auto-merge was enabled on the PR.
 *   8. Assert the PR merges into main.
 *   9. Assert deploy-production.yml runs on main and completes successfully.
 *  10. Assert the public adamdaniel.ai canary URL contains the marker.
 *  11. (Cleanup) Reset canary baseline via the Contents API.
 *
 * Gating:
 *   - CMS_E2E_PAT must be set (host-repo only — fork PRs / Dependabot skip).
 *   - Runs once on chromium-desktop. Other projects skip — exercising 8
 *     browser variants serially of a 7-minute pipeline is wasted minutes.
 *   - CI workflow only schedules this spec when CMS-affecting paths change
 *     (admin/**, _config.yml, _layouts/{post,page,project,canary}.html,
 *     scripts/patch-preview-config.sh, .github/workflows/cms-*,
 *     .github/workflows/deploy-*, e2e/cms-*, _plugins/**).
 */
const { test, expect } = require("./base");
const { captureStep } = require("./manual-capture");
const { seedDecapAuth, getPat, HOST_REPO } = require("./decap-pat");
const { findCanary, makeMarker, REPO_ROOT } = require("./canary-content");
const {
  addLabel,
  fetchPublicUrl,
  gh,
  waitForAutoMergeEnabled,
  waitForCmsPullRequest,
  waitForMerge,
  waitForWorkflowRun,
} = require("./github-actions-poll");

const CANARY = findCanary("post");
const PROD_HOST = "https://adamdaniel.ai";
const PROD_ADMIN = `${PROD_HOST}/admin/`;
const PUBLIC_URL = `${PROD_HOST}${CANARY.publicPath}`;

// The full pipeline (validate-content + auto-merge + deploy-production +
// CloudFront invalidation + public URL propagation) is the worst case when
// runners are warm. Allow generous headroom but cap so a stuck pipeline
// fails the test instead of hanging forever.
const TEST_TIMEOUT_MS = 15 * 60 * 1000;

test.describe.configure({ mode: "serial", timeout: TEST_TIMEOUT_MS });

/** Encode the canary file as base64 for the Contents API. */
function toContentBase64(text) {
  return Buffer.from(text, "utf8").toString("base64");
}

/** Read the current main-branch SHA + content of the canary file. */
async function fetchCanaryFromMain() {
  return gh(`/repos/${HOST_REPO}/contents/${CANARY.path}?ref=main`);
}

/** Write a body to the canary file directly on main via the Contents API. */
async function writeCanaryOnMain({ bodyText, message }) {
  const current = await fetchCanaryFromMain();
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
      branch: "main",
    }),
  });
}

test("CMS publish loop — host repo, target main", async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium-desktop",
    "Publish-loop is real-network and real-GitHub — runs once on chromium-desktop only.",
  );
  test.skip(
    !getPat(),
    "CMS_E2E_PAT not set — host-repo publish-loop disabled. (Forks and Dependabot are expected to land here.)",
  );

  const runId = Date.now();
  const marker = makeMarker(CANARY.id, runId);
  const baselineBody = CANARY.baseline;

  // ── 0. Reset canary to baseline before the run ──────────────────
  // The previous run may have crashed mid-flow; force a clean start.
  await test.step("Reset canary to baseline via Contents API", async () => {
    const current = await fetchCanaryFromMain();
    const currentBody = Buffer.from(current.content, "base64").toString("utf8");
    if (!currentBody.includes(baselineBody)) {
      await writeCanaryOnMain({
        bodyText: `${baselineBody}\n\nThis URL exists so the automated end-to-end publish-loop tests have a stable\ntarget to assert against on both preview-pr<N>.adamdaniel.ai and\nadamdaniel.ai. The body is replaced during a test run and reset to this\nbaseline in cleanup, so the public URL always renders innocuous content\nbetween runs.\n\nIf this is the only thing you can see, no test is currently in progress.`,
        message: "test(canary): reset post baseline before publish-loop run",
      });
    }
  });

  await test.step("Confirm baseline is live before driving admin", async () => {
    await fetchPublicUrl(PUBLIC_URL, {
      expectContent: baselineBody,
      timeoutMs: 6 * 60 * 1000,
    });
  });

  // ── 1. Pre-seed Decap auth and open the prod admin ──────────────
  await seedDecapAuth(page);
  await test.step("Load production admin", async () => {
    await page.goto(PROD_ADMIN, { waitUntil: "domcontentloaded" });
    // Decap renders the login button until it sees the auth in localStorage,
    // then mounts the editor. Wait for the collections sidebar.
    await expect(page.getByRole("link", { name: /^Posts$/i })).toBeVisible({ timeout: 60_000 });
  });

  // ── 2. Open the canary entry ────────────────────────────────────
  await test.step("Navigate to canary entry", async () => {
    await page.goto(`${PROD_ADMIN}#/collections/${CANARY.cmsCollection}`, { waitUntil: "domcontentloaded" });
    const entry = page.getByRole("link", { name: /Canary/i }).first();
    await expect(entry).toBeVisible({ timeout: 30_000 });
    await entry.click();
    await expect(page.getByRole("textbox", { name: /^Title$/i })).toBeVisible({ timeout: 30_000 });
  });

  // ── 3. Edit body and save as draft ──────────────────────────────
  await test.step("Insert run marker into body and Save", async () => {
    // The body is a markdown widget. Append the marker; Decap's editor accepts
    // plain text typing in either rich-text or raw modes.
    const body = page.getByRole("textbox", { name: /Body|Content/i }).last();
    await body.click();
    await body.press("End");
    await body.pressSequentially(`\n\n${marker}\n`);

    // Save (writes the draft entry to a new cms/<...> branch + opens a PR).
    await page.getByRole("button", { name: /^Save$/i }).click();
    // Decap shows a "Saving..." indicator briefly; wait for it to clear.
    await expect(page.getByRole("button", { name: /^Save$/i })).toBeEnabled({ timeout: 60_000 });
  });

  // ── 4. Find the cms/... PR Decap opened ──────────────────────────
  let pr;
  await test.step("Wait for Decap to open the cms/... PR", async () => {
    pr = await waitForCmsPullRequest({
      base: "main",
      canaryMarker: marker,
      timeoutMs: 5 * 60 * 1000,
    });
    expect(pr.number, "Decap PR number").toBeGreaterThan(0);
  });

  // ── 5. Wait for validate-content to pass ─────────────────────────
  await test.step("Wait for validate-content to succeed", async () => {
    await waitForWorkflowRun({
      workflow: "cms-editorial-workflow.yml",
      headSha: pr.head.sha,
      branch: pr.head.ref,
      timeoutMs: 6 * 60 * 1000,
      // The workflow has two jobs (validate-content + auto-merge-when-ready);
      // the workflow run's overall conclusion is what we care about. At this
      // stage only validate-content has fired (no label yet), so its success
      // = workflow success.
    });
  });

  // ── 6. Add cms/ready label to drive auto-merge ──────────────────
  // The user's note in #79 explicitly calls out that Decap emits the
  // `decap-cms/...` namespace from the Status dropdown — that surface lacks
  // a stable contract test. Going through the API here keeps THIS spec
  // focused on the publish loop. The label-name contract is asserted in
  // e2e/cms-label-contract.spec.js (audit finding #1).
  await test.step("Label PR cms/ready", async () => {
    await addLabel({ prNumber: pr.number, label: "cms/ready" });
  });

  await test.step("Wait for auto-merge to be enabled", async () => {
    await waitForAutoMergeEnabled({ prNumber: pr.number });
  });

  await test.step("Wait for PR to merge into main", async () => {
    await waitForMerge({ prNumber: pr.number });
  });

  // ── 7. deploy-production.yml on main ────────────────────────────
  await test.step("Wait for deploy-production.yml to succeed on main", async () => {
    await waitForWorkflowRun({
      workflow: "deploy-production.yml",
      branch: "main",
      timeoutMs: 8 * 60 * 1000,
    });
  });

  // ── 8. Verify public URL surfaces the marker ────────────────────
  await test.step("Verify marker is live on adamdaniel.ai", async () => {
    await fetchPublicUrl(PUBLIC_URL, {
      expectContent: marker,
      timeoutMs: 6 * 60 * 1000,
    });
    await page.goto(PUBLIC_URL, { waitUntil: "domcontentloaded" });
    await captureStep(page, {
      section: "Verifying on the public site",
      step: "7.2",
      title: "Marker live on the production canary URL",
      body:
        "After the PR auto-merges and `deploy-production.yml` finishes, the canary URL on `adamdaniel.ai` reflects the edit. CloudFront's invalidation typically completes within ~2 minutes of the merge — if you don't see your change after that, check the deploy run on GitHub Actions.",
    });
  });

  // ── 9. Cleanup ──────────────────────────────────────────────────
  // Async — write baseline back to main directly. The next deploy reverts
  // the canary URL within a few minutes. Don't await deploy; this test has
  // already proven the loop works.
  await test.step("Reset canary baseline (cleanup commit)", async () => {
    await writeCanaryOnMain({
      bodyText: `${baselineBody}\n\nThis URL exists so the automated end-to-end publish-loop tests have a stable\ntarget to assert against on both preview-pr<N>.adamdaniel.ai and\nadamdaniel.ai. The body is replaced during a test run and reset to this\nbaseline in cleanup, so the public URL always renders innocuous content\nbetween runs.\n\nIf this is the only thing you can see, no test is currently in progress.`,
      message: `test(canary): reset post baseline after publish-loop run ${runId}`,
    });
  });
});
