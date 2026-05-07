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
  waitForCmsPullRequest,
} = require("./github-actions-poll");
const { waitForChangeReflected, PILL_PREVIEW } = require("./deploy-pill");

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

  // Apply cms/ready directly (mirrors the prod spec's "Set Status:
  // Ready" UI click — Decap has the same dropdown in preview-mode
  // admin, but we'd need a separate UI exercise to validate it
  // there, and the editorial-workflow chain is identical from this
  // label onward). Once cms/ready lands,
  // cms-editorial-workflow.yml's auto-merge-when-ready job
  // enables auto-merge; validate-content + the PR's required
  // checks then land the PR into PR_HEAD_REF and trigger
  // deploy-preview.
  await test.step("Label PR cms/ready", async () => {
    await addLabel({ prNumber: pr.number, label: "cms/ready" });
  });

  // ── Wait for the preview deploy-status pill spinner→settled ──
  //
  // The pill is the editor-facing signal for "your change is live
  // on the PR's preview environment." Anchoring the wait on the
  // pill DOM (instead of polling the GitHub API for PR-merge state
  // and deploy-preview-run state) is the contract this test
  // asserts. If the pill misses the in-progress window, stays
  // spinning past success, or flips to failure, that IS the
  // regression — the previous API-based version of these steps
  // would have hidden a real pill bug.
  //
  // Navigate to /admin/ on the PR's preview subdomain so the pill
  // scripts have a stable shell while the auto-merge → deploy
  // chain runs in the background.
  // STAY on the entry editor view (the canary-page entry) — that's
  // where deploy-status-pill.js injects the pill. Poll the preview
  // URL until it serves the marker; along the way watch the pill
  // for failure (fast-fail) and assert it lands in the terminal
  // hidden state. We don't gate on the pill's in_progress spinner —
  // deploy-preview can complete in 15–30 s, less than the pill's
  // 30-s polling interval, so the spinner state can pass entirely
  // between two polls without rendering.
  await test.step("Wait for the marker to be live on the preview subdomain (and pill terminal-hidden)", async () => {
    await waitForChangeReflected({
      page,
      pillId: PILL_PREVIEW,
      urlCheck: async () => {
        const res = await page.request.get(PREVIEW_PUBLIC_URL, { failOnStatusCode: false });
        if (res.status() !== 200) return false;
        return (await res.text()).includes(marker);
      },
      urlTimeoutMs: 10 * 60 * 1000,
    });
  });

  // ── Cleanup via Decap UI (the user-facing path) ────────────────
  // Drive Decap to remove the marker, restoring the canary body to
  // baseline. Symmetrical with the forward leg — Save → cms PR
  // (against PR_HEAD_REF) → cms/ready → auto-merge → deploy-preview
  // re-renders → URL serves baseline. Per AGENTS.md "no back doors
  // in setup or cleanup either".
  await test.step("Cleanup via UI: replace body with baseline, Save, label cms/ready", async () => {
    await page.goto(
      `${PREVIEW_ADMIN}#/collections/${CANARY.cmsCollection}/entries/${CANARY.slug}`,
      { waitUntil: "domcontentloaded" },
    );
    await expect(page.getByRole("textbox", { name: /^Title$/i })).toBeVisible({
      timeout: 30_000,
    });

    const body = page.locator('[role="textbox"][contenteditable="true"]').last();
    await body.click();
    await page.keyboard.press("Control+A");
    await page.keyboard.press("Backspace");
    await body.pressSequentially(
      `${baselineBody}\n\n` +
        "This URL exists so the automated end-to-end publish-loop tests have a stable\n" +
        "target to assert against on both preview-pr<N>.adamdaniel.ai and\n" +
        "adamdaniel.ai. The body is replaced during a test run and reset to this\n" +
        "baseline in cleanup, so the public URL always renders innocuous content\n" +
        "between runs.\n\n" +
        "If this is the only thing you can see, no test is currently in progress.\n",
    );

    await page.getByRole("button", { name: /^Save$/i }).click();
    await expect(page.getByText(/Changes saved/i).first()).toBeVisible({
      timeout: 60_000,
    });

    // Find the cms PR Decap just opened for this Save and label it
    // cms/ready so editorial-workflow auto-merges it. (Mirrors the
    // forward leg's labelling step.)
    const cleanupPr = await waitForCmsPullRequest({
      base: PR_HEAD_REF,
      filePath: CANARY.path,
      canaryMarker: baselineBody,
      timeoutMs: 5 * 60 * 1000,
    });
    await addLabel({ prNumber: cleanupPr.number, label: "cms/ready" });

    // Wait for the URL to revert to baseline (no marker).
    await waitForChangeReflected({
      page,
      pillId: PILL_PREVIEW,
      urlCheck: async () => {
        const res = await page.request.get(PREVIEW_PUBLIC_URL, { failOnStatusCode: false });
        if (res.status() !== 200) return false;
        const text = await res.text();
        return !text.includes(marker) && text.includes(baselineBody);
      },
      urlTimeoutMs: 10 * 60 * 1000,
    });
  });
});

// ── Test-harness cleanup safety net ───────────────────────────────
//
// Mirrors cms-publish-loop.spec.js's afterAll harness. If the
// in-spec UI cleanup left the canary mutated on the PR head branch
// (test aborted, Decap regression mid-cleanup, etc.), this hook
// reads canary-page.md from PR_HEAD_REF and writes baseline back
// via the Contents API. SKIPS when the file is already at baseline.
test.afterAll(async () => {
  if (!getPat()) return;
  if (!PR_HEAD_REF) return;
  let current;
  try {
    current = await fetchCanaryFromBranch(PR_HEAD_REF);
  } catch (e) {
    console.warn(
      `[cleanup-harness] couldn't read ${CANARY.path} from ${PR_HEAD_REF}; skipping safety net: ${e && e.message}`,
    );
    return;
  }
  const decoded = Buffer.from(current.content, "base64").toString("utf8");
  const hasMarker = /e2e-publish-loop:[a-z]+:\d+/.test(decoded);
  if (!hasMarker) {
    console.log(
      "[cleanup-harness] preview canary at baseline; UI-driven cleanup succeeded — no safety net needed",
    );
    return;
  }
  console.warn(
    `[cleanup-harness] canary on ${PR_HEAD_REF} still contains a marker after the UI cleanup; restoring via Contents API`,
  );
  await writeCanaryOnBranch({
    branch: PR_HEAD_REF,
    bodyText: `${CANARY.baseline}\n\nThis URL exists so the automated end-to-end publish-loop tests have a stable\ntarget to assert against on both preview-pr<N>.adamdaniel.ai and\nadamdaniel.ai. The body is replaced during a test run and reset to this\nbaseline in cleanup, so the public URL always renders innocuous content\nbetween runs.\n\nIf this is the only thing you can see, no test is currently in progress.`,
    message: `test(canary): harness safety-net reset of page baseline (UI cleanup left a marker)`,
  });
});
