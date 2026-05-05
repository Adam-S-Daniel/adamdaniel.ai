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
 * away `_e2e/canary-delete-<runId>.md` file via the Contents API
 * (so a crash mid-flow leaves a recognisable, dated stub rather
 * than damaging a checked-in fixture). The file is committed
 * directly to main via the API at the start; the delete itself
 * goes through Decap's UI to exercise the shim. Cleanup attempts to
 * remove the file again on failure so subsequent runs aren't blocked.
 */
const path = require("node:path");
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

const PROD_HOST = "https://adamdaniel.ai";
const PROD_ADMIN = `${PROD_HOST}/admin/`;

// 15 minutes — same envelope as the publish-loop. Delete needs to:
// (1) wait for the workflow_dispatch run to finish (~1m),
// (2) wait for the cms/delete/<slug> PR to pick up validate-content
//     + auto-merge (~6m),
// (3) wait for deploy-production on main (~3m).
const TEST_TIMEOUT_MS = 15 * 60 * 1000;

test.describe.configure({ mode: "serial", timeout: TEST_TIMEOUT_MS });

function toContentBase64(text) {
  return Buffer.from(text, "utf8").toString("base64");
}

async function createTempCanary({ filePath, slug, title, runId }) {
  const body = [
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

  return gh(`/repos/${HOST_REPO}/contents/${filePath}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: `test(canary): seed throw-away delete fixture run ${runId}`,
      content: toContentBase64(body),
      branch: "main",
    }),
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

async function tryHardDelete(filePath, message) {
  // Best-effort cleanup: pull the latest sha + DELETE via the Contents API.
  // Used only on test failure when the shim/workflow path didn't get the
  // file removed. Skipped silently if the ruleset blocks the direct
  // delete (which is the steady state — that's the whole reason this
  // spec exists).
  try {
    const cur = await gh(`/repos/${HOST_REPO}/contents/${filePath}?ref=main`);
    await gh(`/repos/${HOST_REPO}/contents/${filePath}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, sha: cur.sha, branch: "main" }),
    });
    // eslint-disable-next-line no-console
    console.warn(`[cleanup] hard-deleted ${filePath} via Contents API`);
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
  } finally {
    // Best-effort cleanup. If the shim/workflow path didn't actually
    // remove the file (test failed before the merge), drop it via the
    // Contents API directly so subsequent runs start clean.
    if (await fileExistsOnMain(filePath).catch(() => false)) {
      await tryHardDelete(
        filePath,
        `test(canary): cleanup throw-away delete fixture run ${runId}`,
      );
    }
  }
});
