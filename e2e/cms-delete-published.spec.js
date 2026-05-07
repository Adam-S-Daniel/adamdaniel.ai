// @lane: real — drives Decap delete UI through the real GitHub delete-via-PR shim
// @select-skip-when-head-ref-prefix: cms/
//
// On `cms/*` PRs (Decap-opened editorial PRs) this spec self-skips at
// runtime — RUN_HOST_REPO_PUBLISH_LOOP is unset on the standard PR
// matrix — so selecting + bringing it up just to no-op is pure waste.
// The dedicated cms-publish-loop-host workflow runs it nightly.

/*
 * UI-driven coverage for the "Delete published entry" path. Decap's
 * delete button calls DELETE /repos/.../contents/{path} synchronously,
 * which the main-branch ruleset rejects with 422. The shim
 * (admin/publish-via-auto-merge.js) catches the 422 and dispatches
 * `.github/workflows/delete-via-pr.yml`, which opens a labelled PR;
 * cms-editorial-workflow.yml's auto-merge-when-ready job takes it
 * from there.
 *
 * Without this spec we have no end-to-end signal that the chain
 * actually closes. Unit (e2e/publish-via-auto-merge.test.js) and the
 * route-mocked browser test
 * (e2e/publish-via-auto-merge-browser.spec.js) cover the shim itself;
 * this one verifies the workflow + the labelled PR + the auto-merge
 * happen for real on the host repo.
 *
 * Gating: identical to cms-publish-loop.spec.js's host loop —
 * RUN_HOST_REPO_PUBLISH_LOOP=1 plus a CMS_E2E_PAT must be set.
 * Runs against the same prod admin (https://adamdaniel.ai/admin/) so
 * a single dedicated workflow can drive both this and the publish
 * loop nightly.
 *
 * Fixture model: this spec creates and then deletes its own throw-
 * away `_e2e/canary-delete-<runId>.md` file. A crash mid-flow leaves
 * a recognisable, dated stub on main rather than damaging a checked-
 * in fixture. The seed itself can't go directly to main — the
 * `pull_request` rule on `.github/rulesets/main.json` rejects every
 * direct write — so we route it through a `cms/e2e-fixture/seed-…`
 * PR labelled `cms/ready` and let cms-editorial-workflow.yml's
 * auto-merge-when-ready land it. Once on main and deployed, the
 * delete itself goes through Decap's UI to exercise the shim
 * (admin/publish-via-auto-merge.js → delete-via-pr.yml). On test
 * failure, the cleanup helper opens a parallel
 * `cms/e2e-fixture/remove-…` PR so the next run starts clean.
 */
const { test, expect } = require("./base");
const { seedDecapAuth, getPat, HOST_REPO } = require("./decap-pat");
const {
  fetchPublicUrl,
  gh,
  waitForAutoMergeEnabled,
  waitForCmsPullRequest,
  waitForMerge,
  waitForWorkflowRun,
} = require("./github-actions-poll");
const { seedFixtureViaPr, removeFixtureViaPr } = require("./cms-fixture-pr");

const PROD_HOST = "https://adamdaniel.ai";
const PROD_ADMIN = `${PROD_HOST}/admin/`;

// The delete spec runs two labelled-PR auto-merge cycles end to end:
//   1. The setup PR that seeds `_e2e/canary-delete-<runId>.md` on main
//      (necessary because direct Contents-API writes to main are
//      blocked by the ruleset).
//   2. The cms/delete/<slug> PR opened by delete-via-pr.yml after the
//      shim catches the 422 — this is the real subject of the test.
// Two seedFixtureViaPr / removeFixtureViaPr cycles in this spec at
// 18 min each (post-2026-05-07 bump in cms-fixture-pr.js) — accommodates
// concurrent CI on busy days where the required-check matrix queues
// up. Plus the in-browser delete drive + delete-via-pr workflow
// dispatch + delete PR's full check matrix. 30 min envelope.
//
// Retries stay disabled — this test mutates real state, so a retry
// just re-runs the same broken chain (e.g. shim → workflow_dispatch
// → delete-via-pr) after wasting another 30 min. Failures here are
// almost never transient.
const TEST_TIMEOUT_MS = 30 * 60 * 1000;

test.describe.configure({
  mode: "serial",
  timeout: TEST_TIMEOUT_MS,
  retries: 0,
});

function buildCanaryBody({ slug, title, runId }) {
  return [
    "---",
    "layout: canary",
    `title: "${title}"`,
    `slug: ${slug}`,
    `canary_id: delete-${runId}`,
    "permalink: /e2e/" + slug + "/",
    "sitemap: false",
    "robots: noindex,nofollow",
    "published: true",
    "---",
    `Throw-away delete-test fixture from run ${runId}.`,
    "Will be deleted by cms-delete-published.spec.js.",
    "",
  ].join("\n");
}

/**
 * Seed the throw-away canary file on main via a labelled PR.
 *
 * Direct PUT /contents/{path} on main is blocked by the `pull_request`
 * rule on .github/rulesets/main.json (returns 409 "Repository rule
 * violations found"). We open a `cms/e2e-fixture/seed-<slug>-<runId>`
 * PR, label it `cms/ready` to engage cms-editorial-workflow.yml's
 * auto-merge-when-ready job, and block until the merge lands. Once on
 * main, deploy-production.yml publishes the canary URL.
 */
async function createTempCanary({ filePath, slug, title, runId }) {
  return seedFixtureViaPr({
    slug,
    runId,
    filePath,
    bodyText: buildCanaryBody({ slug, title, runId }),
    message: `test(canary): seed throw-away delete fixture run ${runId}`,
    prTitle: `test(canary): seed throw-away delete fixture run ${runId}`,
    prBody:
      `Throw-away fixture for the delete-published e2e spec (run \`${runId}\`).\n\n` +
      `Auto-merges via the \`cms/ready\` label. The fixture is deleted by ` +
      `the spec itself in a later step, then \`deploy-production.yml\` removes ` +
      `the public URL.`,
  });
}

async function fileExistsOnMain(filePath) {
  try {
    await gh(`/repos/${HOST_REPO}/contents/${filePath}?ref=main`);
    return true;
  } catch (e) {
    if (/\b404\b/.test(String(e.message))) return false;
    throw e;
  }
}

async function tryHardDelete(filePath, slug, runId, message) {
  // Best-effort cleanup. The shim / delete-via-pr workflow normally
  // removes the fixture as part of the test flow; this fallback runs
  // only on test failure when the file is still on main. Direct
  // DELETE /contents/{path} on main is blocked by the ruleset, so we
  // open a labelled fixture-removal PR and let auto-merge land it
  // (same path the success case uses, just initiated from cleanup).
  try {
    await removeFixtureViaPr({
      slug,
      runId,
      filePath,
      message,
      prTitle: message,
      prBody:
        `Cleanup PR opened by \`cms-delete-published.spec.js\` after a test ` +
        `failure left the throw-away fixture on main. Auto-merges via ` +
        `\`cms/ready\`.`,
    });
    // eslint-disable-next-line no-console
    console.warn(`[cleanup] removed ${filePath} via fixture-cleanup PR`);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn(`[cleanup] could not remove ${filePath}: ${e.message}`);
  }
}

test("Delete published entry — UI click → shim → delete-via-pr workflow → merged", async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium-desktop",
    "Delete-published flow is real-network — runs once on chromium-desktop only.",
  );
  test.skip(
    !getPat(),
    "CMS_E2E_PAT not set — host-repo delete-published spec disabled.",
  );
  // Same opt-in as cms-publish-loop.spec.js so this also only fires
  // inside the dedicated cms-publish-loop-host workflow.
  test.skip(
    process.env.RUN_HOST_REPO_PUBLISH_LOOP !== "1",
    "RUN_HOST_REPO_PUBLISH_LOOP not set — delete-published spec is opt-in.",
  );

  const runId = Date.now();
  const slug = `canary-delete-${runId}`;
  const filePath = `_e2e/${slug}.md`;
  const title = `Delete-test canary (${runId})`;
  let pr;

  test.info().annotations.push({
    type: "fixture-path",
    description: filePath,
  });

  // ── 0. Seed the throw-away fixture on main ─────────────────────
  await test.step("Create throw-away canary on main via Contents API", async () => {
    await createTempCanary({ filePath, slug, title, runId });
  });

  try {
    // ── 1. Wait for the canary to land on the public site ────────
    await test.step("Wait for the canary URL to publish", async () => {
      await fetchPublicUrl(`${PROD_HOST}/e2e/${slug}/`, {
        // The fixture's `title:` ends up in the page; that's enough to
        // confirm the deploy actually landed before we drive admin.
        expectContent: title,
        timeoutMs: 6 * 60 * 1000,
      });
    });

    // ── 2. Open admin, navigate to the canary entry ──────────────
    await seedDecapAuth(page);
    await test.step("Load production admin", async () => {
      await page.goto(PROD_ADMIN, { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("link", { name: /^Posts$/i })).toBeVisible({
        timeout: 60_000,
      });
    });

    await test.step("Navigate to the throw-away canary entry", async () => {
      await page.goto(`${PROD_ADMIN}#/collections/e2e/entries/${slug}`, {
        waitUntil: "domcontentloaded",
      });
      // The Title input is the cheapest "editor mounted" sentinel.
      await expect(page.getByRole("textbox", { name: /^Title$/i })).toBeVisible({
        timeout: 30_000,
      });
    });

    // ── 3. Click "Delete published entry" (hits the shim) ────────
    await test.step("Click Delete published entry → shim dispatches workflow", async () => {
      // Decap renders this as a button in the Status menu (or a
      // top-level "Delete" depending on entry status). Try the menu
      // path first; fall back to a direct button match. Either click
      // ultimately lands on the same fetch that the shim catches.
      const trigger = page
        .getByRole("button", { name: /delete (published )?entry/i })
        .first();
      if (await trigger.isVisible({ timeout: 5_000 }).catch(() => false)) {
        await trigger.click();
      } else {
        // Status menu form: Delete unpublished changes / Delete published.
        await page.getByRole("button", { name: /^Status:/i }).click();
        await page
          .getByRole("menuitem", { name: /delete (published )?entry/i })
          .first()
          .click();
      }
      // Decap shows a confirm dialog — accept it. The handler covers
      // both the native confirm() and Decap's own modal variant.
      page.once("dialog", (d) => d.accept());
      await page
        .getByRole("button", { name: /^(delete|confirm|yes)$/i })
        .first()
        .click()
        .catch((err) => {
          // Decap may use a native confirm() instead of an in-page
          // button — the dialog handler above accepts it and the
          // button query then has nothing to click. The click
          // rejecting is the success signal here. Log at debug level
          // so silent-catch-lint stays happy and grep finds this
          // branch if behaviour changes.
          console.debug(
            "[cms-delete-published] confirm-button click rejected (likely native dialog already handled):",
            err && err.message,
          );
        });

      // Shim's synthetic 200 → Decap reports success. The shim toast
      // should appear, but if Decap's "deleted" notification beats it
      // we accept either as proof the click resolved.
      await Promise.race([
        page
          .locator("[data-publish-via-auto-merge-toast]")
          .first()
          .waitFor({ timeout: 30_000 }),
        page
          .getByText(/deleted|removed/i)
          .first()
          .waitFor({ timeout: 30_000 }),
      ]);
    });

    // ── 4. The shim dispatched delete-via-pr.yml — wait for it ──
    await test.step("Wait for delete-via-pr.yml workflow_dispatch run to succeed", async () => {
      await waitForWorkflowRun({
        workflow: "delete-via-pr.yml",
        // No headSha to pin against — workflow_dispatch runs aren't
        // tied to a commit. Filter on branch=main + recency inside
        // waitForWorkflowRun so we pick up THIS run, not a stale one.
        branch: "main",
        timeoutMs: 5 * 60 * 1000,
      });
    });

    // ── 5. Find the cms/delete/<slug> PR the workflow opened ────
    await test.step("Find the cms/delete/... PR opened by the workflow", async () => {
      pr = await waitForCmsPullRequest({
        base: "main",
        headBranchPrefix: `cms/delete/${slug}`,
        // The PR's diff IS the deletion — file path appears in the
        // patch's `--- a/<filePath>` line and the patch body. Match by
        // file path (the diff matcher's normal mode handles deletions).
        filePath,
        // For a delete PR there's no positive marker in the file body
        // — the patch is purely red. Match on the file path alone by
        // setting canaryMarker to something that's certain to appear:
        // the path itself shows up in the patch header.
        canaryMarker: filePath,
        timeoutMs: 5 * 60 * 1000,
      });
      expect(pr.number, "delete-via-pr PR number").toBeGreaterThan(0);
    });

    // ── 6. validate-content on the cms/delete/<slug> PR ─────────
    await test.step("Wait for validate-content to succeed on the delete PR", async () => {
      await waitForWorkflowRun({
        workflow: "cms-editorial-workflow.yml",
        headSha: pr.head.sha,
        branch: pr.head.ref,
        timeoutMs: 6 * 60 * 1000,
      });
    });

    await test.step("Wait for auto-merge to be enabled on the delete PR", async () => {
      await waitForAutoMergeEnabled({ prNumber: pr.number });
    });

    await test.step("Wait for delete PR to merge into main", async () => {
      await waitForMerge({ prNumber: pr.number });
    });

    // ── 7. deploy-production lands the deletion ─────────────────
    await test.step("Wait for deploy-production.yml on main", async () => {
      await waitForWorkflowRun({
        workflow: "deploy-production.yml",
        branch: "main",
        timeoutMs: 8 * 60 * 1000,
      });
    });

    // ── 8. Verify the file is gone from main ────────────────────
    await test.step("Verify the throw-away canary is gone from main", async () => {
      const stillThere = await fileExistsOnMain(filePath);
      expect(stillThere, `${filePath} should be gone from main after merge`).toBe(false);
    });

    // ── 9. Verify the public URL actually 404s ──────────────────
    // The file being absent from main isn't sufficient — the
    // user-visible contract is that the URL stops serving content.
    // CDN cache, deploy-production rsync semantics, or a stale
    // Jekyll _site/ could all leave the page reachable. Poll until
    // the URL returns 4xx so we KNOW the deletion landed at the
    // customer-visible layer too.
    const publicUrl = `${PROD_HOST}/e2e/${slug}/`;
    await test.step("Verify the canary's public URL 404s after delete + deploy", async () => {
      const deadline = Date.now() + 6 * 60 * 1000;
      let lastStatus = null;
      while (Date.now() < deadline) {
        const res = await page.request.get(publicUrl, {
          maxRedirects: 0,
          failOnStatusCode: false,
        });
        lastStatus = res.status();
        if (lastStatus >= 400 && lastStatus < 500) return;
        await page.waitForTimeout(8_000);
      }
      throw new Error(
        `${publicUrl} did not return 4xx within 6 min after delete + deploy; last status=${lastStatus}.`,
      );
    });
  } finally {
    // Best-effort cleanup. If the shim/workflow path didn't actually
    // remove the file (test failed before the merge), open a
    // fixture-cleanup PR + auto-merge to drop it. Direct deletes to
    // main are blocked by the ruleset; the cleanup mirrors the success
    // path so subsequent runs start clean.
    if (await fileExistsOnMain(filePath).catch(() => false)) {
      await tryHardDelete(
        filePath,
        slug,
        runId,
        `test(canary): cleanup throw-away delete fixture run ${runId}`,
      );
    }
  }
});
