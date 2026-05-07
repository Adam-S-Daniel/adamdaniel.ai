// @lane: real — exercises the real Decap → GitHub → Actions publish loop end to end
// @select-skip-when-head-ref-prefix: cms/
//
// On `cms/*` PRs (Decap-opened editorial PRs) this spec self-skips at
// runtime — RUN_HOST_REPO_PUBLISH_LOOP is unset on the standard PR
// matrix — so selecting + bringing it up just to no-op is pure waste.
// The dedicated cms-publish-loop-host workflow runs it nightly.

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
 *   0. (Setup) If the canary baseline isn't already on main from the
 *      previous cleanup, open a `cms/e2e-fixture/seed-…` PR that
 *      writes it back, label it `cms/ready`, and wait for auto-merge.
 *      Direct Contents-API writes to main are blocked by the branch
 *      ruleset (`pull_request` rule), so even setup has to flow
 *      through the same auto-merge path the test exercises.
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
 *  11. (Cleanup) Open a second `cms/e2e-fixture/cleanup-…` PR that
 *      resets the canary baseline. Same auto-merge path as step 0;
 *      we await the merge so the next run starts clean.
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
const { CANARIES, findCanary, makeMarker, REPO_ROOT } = require("./canary-content");
const {
  fetchPublicUrl,
  gh,
  waitForAutoMergeEnabled,
  waitForCmsPullRequest,
  waitForMerge,
  waitForWorkflowRun,
} = require("./github-actions-poll");
const { seedFixtureViaPr, closeStaleDecapPrOnBranch } = require("./cms-fixture-pr");

const CANARY = findCanary("post");
const PROD_HOST = "https://adamdaniel.ai";
const PROD_ADMIN = `${PROD_HOST}/admin/`;
const PUBLIC_URL = `${PROD_HOST}${CANARY.publicPath}`;

// E3 — `PROD_CANARY=1` gates a read-only daily canary probe (see
// `.github/workflows/canary-prod.yml`). When the env var is set, the
// mutating publish-loop test self-skips and a sibling read-only test
// runs against the public canary URLs only — no Decap login, no PR open,
// no label flip, no merge. The hard guard below makes that contract
// machine-checked: any code path that tries to mutate state (write to
// the Contents API, drive admin actions) calls assertNotProdCanary()
// and throws immediately if the gate has been breached.
const PROD_CANARY = process.env.PROD_CANARY === "1";

function assertNotProdCanary(action) {
  if (PROD_CANARY) {
    throw new Error(
      `PROD_CANARY=1 is read-only — refusing to ${action}. ` +
        `Daily canary probes must NEVER mutate prod state. If you reached ` +
        `this branch, the spec's read-only gate has been bypassed.`,
    );
  }
}

// The full pipeline runs three labelled-PR auto-merge cycles end to
// end:
//   1. Optional setup PR (only when the previous run's cleanup didn't
//      land — usually a no-op).
//   2. The Decap-driven cms/<col>/<slug> PR (the real subject of the
//      test).
//   3. The cleanup PR that resets the canary baseline.
// Each PR waits on the full required-check suite (validate-content +
// e2e shards + finalize) plus deploy-production on main. Worst-case
// runtime per cycle is ~10 min when runners are warm; allow ~20 min
// total so a stuck pipeline fails fast rather than holding a runner
// for a full hour. Retries are explicitly disabled for the same
// reason: the publish-loop is a real-state mutation and a retry just
// re-runs the same broken chain after wasting another 20 min — the
// failure mode is almost never transient.
const TEST_TIMEOUT_MS = 35 * 60 * 1000;

test.describe.configure({
  mode: "serial",
  timeout: TEST_TIMEOUT_MS,
  retries: 0,
});

/** Read the current main-branch SHA + content of the canary file. */
async function fetchCanaryFromMain() {
  return gh(`/repos/${HOST_REPO}/contents/${CANARY.path}?ref=main`);
}

/**
 * Compose a canary file body from the current front matter + a new
 * body string. The front matter is preserved verbatim (it carries the
 * canary_id, layout, permalink, etc. that the spec asserts against);
 * only the body below the second `---` is replaced.
 */
async function composeCanaryFile(bodyText) {
  const current = await fetchCanaryFromMain();
  const decoded = Buffer.from(current.content, "base64").toString("utf8");
  const fmEnd = decoded.indexOf("\n---\n", 4);
  if (fmEnd < 0) throw new Error("Canary file is missing closing front-matter delimiter.");
  const frontMatter = decoded.slice(0, fmEnd + 5);
  return `${frontMatter}\n${bodyText}\n`;
}

/**
 * Write a body to the canary file via a labelled PR that auto-merges.
 *
 * Direct writes to main are blocked by the `pull_request` rule on the
 * main-branch ruleset (.github/rulesets/main.json); the API returns
 * 409 "Repository rule violations found". `seedFixtureViaPr` opens a
 * `cms/e2e-fixture/seed-<slug>-<runId>` PR with the `cms/ready` label,
 * which engages cms-editorial-workflow.yml's `auto-merge-when-ready`
 * job — same path prod content edits use — then blocks until the PR
 * merges. Returns the merged-PR descriptor.
 */
async function writeCanaryViaPr({ runId, bodyText, message, prTitle, prBody }) {
  assertNotProdCanary("write to the canary file via a labelled PR");
  const newFile = await composeCanaryFile(bodyText);
  return seedFixtureViaPr({
    slug: CANARY.slug,
    runId,
    filePath: CANARY.path,
    bodyText: newFile,
    message,
    prTitle,
    prBody,
  });
}

test("CMS publish loop — host repo, target main", async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium-desktop",
    "Publish-loop is real-network and real-GitHub — runs once on chromium-desktop only.",
  );
  test.skip(
    PROD_CANARY,
    "PROD_CANARY=1 — daily canary probe runs the read-only @canary-readonly test instead.",
  );
  test.skip(
    !getPat(),
    "CMS_E2E_PAT not set — host-repo publish-loop disabled. (Forks and Dependabot are expected to land here.)",
  );
  // Opt-in marker mirroring RUN_PROD_MUTATE_PLAYGROUND. Without it, the
  // spec also runs inside e2e-tests.yml shard 1 on regular PRs — and
  // the cms/ PR it opens against main triggers another e2e-tests run
  // (whose shard 1 picks this same spec back up), force-pushing
  // concurrent commits to cms/<col>/<slug> and cancelling each other's
  // validate-content + auto-merge-when-ready labeled events. Until a
  // dedicated workflow opts in (mirroring cms-publish-loop-prod.yml),
  // self-skip on PRs and rely on the cms-publish-loop-prod-mutate
  // playground + read-only @canary-readonly probe for coverage.
  test.skip(
    process.env.RUN_HOST_REPO_PUBLISH_LOOP !== "1",
    "RUN_HOST_REPO_PUBLISH_LOOP not set — host-repo publish-loop spec is opt-in (avoids cms/* PR self-recursion in PR-time CI).",
  );

  const runId = Date.now();
  const marker = makeMarker(CANARY.id, runId);
  const baselineBody = CANARY.baseline;

  // ── 0a. Close any stale Decap editorial-workflow PR on the
  // canary's fixed branch ────────────────────────────────────────
  // Decap reuses cms/<col>/<slug> per entry, so a prior run that
  // crashed at any stage past Save can leave a PR with a non-Draft
  // editorial-workflow label (decap-cms/pending_publish,
  // decap-cms/pending_review, decap-cms/ready). On the next run the
  // Save pushes onto the same branch — the labels persist — Decap's
  // toolbar shows "Status: Ready" instead of "Status: Draft" — the
  // step-6 button-wait below times out at 20 min. Pre-emptively
  // closing any open PR for this entry's branch resets to a clean
  // slate; Decap will open a fresh decap-cms/draft PR on the next
  // Save below.
  await test.step("Close any stale Decap editorial-workflow PR on the canary branch", async () => {
    await closeStaleDecapPrOnBranch({
      branch: `cms/${CANARY.cmsCollection}/${CANARY.slug}`,
    });
  });

  // ── 0. Reset canary to baseline before the run ──────────────────
  // The previous run may have crashed mid-flow; force a clean start.
  // The reset goes through a `cms/ready`-labelled PR + auto-merge
  // because the main-branch ruleset blocks direct Contents-API writes.
  await test.step("Reset canary to baseline via labelled PR (auto-merge)", async () => {
    const current = await fetchCanaryFromMain();
    const currentBody = Buffer.from(current.content, "base64").toString("utf8");
    if (!currentBody.includes(baselineBody)) {
      await writeCanaryViaPr({
        runId: `setup-${runId}`,
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
    // Go straight to the entry by slug instead of clicking the first
    // /Canary/i link in the collection list — the e2e collection has
    // page/post/project canaries and the sidebar's display order
    // can't be relied on to land on the configured one (CANARY.id).
    await page.goto(
      `${PROD_ADMIN}#/collections/${CANARY.cmsCollection}/entries/${CANARY.slug}`,
      { waitUntil: "domcontentloaded" },
    );
    await expect(page.getByRole("textbox", { name: /^Title$/i })).toBeVisible({ timeout: 30_000 });
  });

  // ── 3. Edit body and save as draft ──────────────────────────────
  await test.step("Insert run marker into body and Save", async () => {
    // The body is a markdown widget. Append the marker; Decap's editor accepts
    // plain text typing in either rich-text or raw modes. The pinned Decap
    // version no longer exposes "Body" as the textbox's accessible name —
    // mirror cms-publish-flow.spec.js and grab the last contenteditable
    // textbox on the page (the live preview iframe is not a textbox).
    const body = page.locator('[role="textbox"][contenteditable="true"]').last();
    await body.click();
    await body.press("End");
    await body.pressSequentially(`\n\n${marker}\n`);

    // Save (writes the draft entry to a new cms/<...> branch + opens a PR).
    await page.getByRole("button", { name: /^Save$/i }).click();
    // In editorial_workflow mode (prod admin), Save stays disabled
    // after the save completes — the toolbar swaps to "Status: Draft"
    // + a separate "Publish" button. Wait for the "Changes saved"
    // status text instead of the (incorrect) toBeEnabled signal.
    await expect(page.getByText(/Changes saved/i).first()).toBeVisible({ timeout: 60_000 });
  });

  // ── 4. Find the cms/... PR Decap opened ──────────────────────────
  let pr;
  await test.step("Wait for Decap to open the cms/... PR", async () => {
    pr = await waitForCmsPullRequest({
      base: "main",
      filePath: CANARY.path,
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

  // ── 6. Drive Status: Ready via the UI dropdown ──────────────────
  // Editorial workflow: click the "Status: Draft" button, pick
  // "Ready" from the menu. Decap applies the `decap-cms/ready` label,
  // which cms-editorial-workflow.yml's auto-merge-when-ready job
  // accepts as a synonym for cms/ready and uses to enable auto-merge.
  // This replaces an earlier `addLabel({ label: "cms/ready" })` API
  // shortcut — the shortcut never exercised the dropdown handler that
  // a real operator triggers, which is exactly the surface area the
  // shim has to interoperate with.
  await test.step("Set Status: Ready via UI dropdown", async () => {
    await page.getByRole("button", { name: /^Status:\s*Draft$/i }).click();
    await page.getByRole("menuitem", { name: /^Ready$/i }).click();
    // The toolbar reflects the new status — the button text flips.
    await expect(
      page.getByRole("button", { name: /^Status:\s*Ready$/i }),
    ).toBeVisible({ timeout: 30_000 });
  });

  await test.step("Wait for auto-merge to be enabled", async () => {
    await waitForAutoMergeEnabled({ prNumber: pr.number });
  });

  // ── 6b. Drive Publish → Publish Now via the UI ──────────────────
  // Three valid outcomes after the click, ANY of which means the
  // chain is healthy:
  //
  //   (a) Shim toast appears — ruleset returned 422 on the direct
  //       merge call, the shim caught it, added cms/ready (idempotent
  //       — already there), and surfaced its own toast explaining
  //       auto-merge will land the PR. This was the only valid path
  //       BEFORE auto-merge-when-ready started firing on
  //       decap-cms/pending_publish (PR #227); now it's a fallback
  //       for PRs whose checks finished AFTER the click but BEFORE
  //       the in-flight merge call's 422 response was received.
  //
  //   (b) Decap shows its own "successfully published" notification —
  //       the merge call succeeded synchronously (200 + merged:true).
  //       Happens when checks were already done by click time and the
  //       ruleset gate let the merge through.
  //
  //   (c) The PR is already merged (or actively auto-merging) by the
  //       time the click fires. With auto-merge-when-ready enabling
  //       auto-merge at Status:Ready (PR #227), the PR can transition
  //       merged → "merged" before the spec's click reaches the API.
  //       Decap's response then is "PR already merged" with no
  //       distinguishing UI text — neither the shim toast nor
  //       "successfully published" appears within 30 sec.
  //
  // The original spec only raced (a) and (b). After PR #245 made
  // auto-merge actually deploy, (c) became the dominant path —
  // dropping us into a 30-sec timeout even though the chain was
  // succeeding under the spec. Add (c) as an API-side check.
  await test.step("Click Publish → Publish Now via UI", async () => {
    await page.getByRole("button", { name: /^Publish$/i }).click();
    await page
      .getByRole("menuitem", { name: /publish now/i })
      .first()
      .click();

    // Race (a) shim toast, (b) Decap success notification,
    // (c) the PR's auto-merge / merged state via the API. (c) polls
    // every 3 sec for ~30 sec so it can win against (a)/(b)'s
    // own 30-sec deadlines when neither UI signal appears.
    await Promise.race([
      page
        .locator("[data-publish-via-auto-merge-toast]")
        .first()
        .waitFor({ timeout: 30_000 }),
      page
        .getByText(/successfully published|published successfully/i)
        .first()
        .waitFor({ timeout: 30_000 }),
      (async () => {
        const deadline = Date.now() + 30_000;
        while (Date.now() < deadline) {
          const state = await gh(`/repos/${HOST_REPO}/pulls/${pr.number}`);
          if (state.merged === true) return;
          if (state.auto_merge && state.auto_merge.enabled_by) return;
          await new Promise((r) => setTimeout(r, 3_000));
        }
        throw new Error(
          `PR #${pr.number} neither showed publish UI nor became auto-merging within 30s.`,
        );
      })(),
    ]);
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

  // ── 8a. Verify the deploy-status pill resolved to a non-spinner state ─
  // The contract for admin/deploy-status-pill.js: while a deploy is
  // in flight, `cms-prod-status-pill` shows a spinner with text
  // "Publishing…"; after success, the pill HIDES (display: none —
  // the "deployed commit pill" already covers steady-state). Driving
  // the pill through that transition end-to-end is the only behavioral
  // check that the pill actually reflects production-deploy state.
  // The deploy-status-pill.js polls every 30s, so allow up to 90s
  // after the URL goes live for the next poll to see the success
  // status and hide the pill.
  await test.step("Deploy-status pill: in-flight spinner resolved to hidden after deploy", async () => {
    // The admin tab is still on the canary entry editor from earlier
    // steps; navigate to a fresh /admin/ to ensure the pill scripts
    // re-mount in their post-deploy state.
    await page.goto(`${PROD_ADMIN}`, { waitUntil: "domcontentloaded" });
    // Wait for the admin shell to load (Posts link is the canonical
    // signal). Pill scripts mount alongside the shell.
    await expect(page.getByRole("link", { name: /^Posts$/i })).toBeVisible({
      timeout: 60_000,
    });
    // Pill is HIDDEN on success (display:none in the IIFE's render
    // path). Wait up to 90s for the next polling tick after deploy.
    await page.waitForFunction(
      () => {
        const el = document.getElementById("cms-prod-status-pill");
        // Acceptable terminal states: pill not in DOM yet, OR pill
        // exists with display:none. (Decap re-renders the toolbar on
        // entry switches, so the pill might be in the DOM mid-poll
        // but hidden — both pass.)
        return !el || el.style.display === "none";
      },
      undefined,
      { timeout: 90_000 },
    );
  });

  // ── 9. Cleanup ──────────────────────────────────────────────────
  // Reset baseline via a labelled PR + auto-merge (direct writes to
  // main are blocked by the ruleset). We DO await the merge here:
  // leaving the canary in the marker state would break the next run's
  // baseline assertion and pollute the public URL between runs.
  await test.step("Reset canary baseline (cleanup PR)", async () => {
    await writeCanaryViaPr({
      runId: `cleanup-${runId}`,
      bodyText: `${baselineBody}\n\nThis URL exists so the automated end-to-end publish-loop tests have a stable\ntarget to assert against on both preview-pr<N>.adamdaniel.ai and\nadamdaniel.ai. The body is replaced during a test run and reset to this\nbaseline in cleanup, so the public URL always renders innocuous content\nbetween runs.\n\nIf this is the only thing you can see, no test is currently in progress.`,
      message: `test(canary): reset post baseline after publish-loop run ${runId}`,
    });
  });
});

// E3 — Daily production canary probe.
//
// Runs once a day under `.github/workflows/canary-prod.yml` against
// TARGET=prod. The full publish-loop above is the gold-standard end-to-
// end check, but it's heavyweight (~7 minutes and a real PR per run) and
// only fires when CMS-affecting paths change. The canary probe is the
// always-on smoke check: every morning, before US/EU work hours, assert
// that the three `_e2e/canary-*` URLs are still serving their baseline
// content. If any of them 404s, drifts, or stops resolving entirely,
// the workflow opens an issue tagged `production-canary`.
//
// Read-only by construction:
//   - No Decap login (no PAT, no admin navigation, no editor drive).
//   - No PR open / label flip / merge.
//   - No Contents-API write.
//   - All three URLs are fetched via `page.request.get(...)` against the
//     prod baseURL set by the TARGET=prod fixture in `e2e/base.js`.
//
// The hard guard at the top of this file (assertNotProdCanary) makes the
// read-only contract machine-checked: if a future edit accidentally
// routes through writeCanaryOnMain() while PROD_CANARY=1, the spec
// throws immediately rather than silently mutating prod.
test("@canary-readonly production canary URLs serve their baselines", async ({
  page,
}, testInfo) => {
  test.skip(
    !PROD_CANARY,
    "PROD_CANARY=1 not set — canary-readonly probe is gated to the daily workflow.",
  );
  test.skip(
    testInfo.project.name !== "chromium-desktop",
    "Canary probe runs once on chromium-desktop only — read-only HTTP fetches don't need the matrix.",
  );

  // Hard guard: never expose the test runner to a CMS_E2E_PAT in this
  // mode. The PROD_CANARY workflow does NOT set the secret, but a local
  // shell that ran the publish-loop earlier may have it exported. Strip
  // it from this process so even an accidental seedDecapAuth() call
  // would be a no-op (it self-skips when getPat() returns undefined).
  delete process.env.CMS_E2E_PAT;
  expect(getPat(), "PROD_CANARY mode must run without a PAT").toBeFalsy();

  for (const c of CANARIES) {
    await test.step(`Fetch ${c.publicPath} and assert baseline`, async () => {
      // `page.request.get(c.publicPath)` resolves against the TARGET=prod
      // baseURL fixture (e2e/base.js → https://adamdaniel.ai). No DOM
      // navigation needed — pure HTTP, fast and deterministic.
      const res = await page.request.get(c.publicPath);
      expect(
        res.status(),
        `${c.publicPath} should return 200 from prod`,
      ).toBe(200);
      const body = await res.text();
      expect(
        body,
        `${c.publicPath} should still surface its baseline ("${c.baseline}"). ` +
          `If this fails, the canary entry has drifted or the deploy pipeline ` +
          `has stalled — check deploy-production.yml on main.`,
      ).toContain(c.baseline);
    });
  }
});
