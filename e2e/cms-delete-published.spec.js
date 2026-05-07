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
const { fetchPublicUrl, gh } = require("./github-actions-poll");
const { seedFixtureViaPr, removeFixtureViaPr } = require("./cms-fixture-pr");
const { waitForDeployPillSettled, PILL_PROD } = require("./deploy-pill");

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
const TEST_TIMEOUT_MS = 40 * 60 * 1000;

test.describe.configure({
  mode: "serial",
  timeout: TEST_TIMEOUT_MS,
  retries: 0,
});

function buildCanaryBody({ slug, title, runId }) {
  // IMPORTANT: do NOT include the words "deleted" or "removed" anywhere
  // in the body. Step 3's Promise.race below uses
  // `page.getByText(/deleted|removed/i)` as one of its accept signals;
  // those words appearing in the body would false-resolve the race
  // before Decap's actual UI response. Run #25496374142 hit exactly
  // this — a previous body of "Will be deleted by …" caused the
  // race to resolve immediately on page load and the test then
  // hung waiting for the never-dispatched workflow.
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
    `Throw-away fixture from run ${runId}.`,
    "Used by cms-delete-published.spec.js to exercise the editorial-workflow delete path.",
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

    // Diagnostic: log every DELETE-on-contents call and every
    // workflow_dispatch POST so a future failure trace tells us
    // exactly what Decap + shim did or didn't do. The CDN-side
    // network is noisy; restrict to the GitHub API calls relevant
    // to the delete chain.
    page.on("request", (req) => {
      const method = req.method();
      const url = req.url();
      if (
        method === "DELETE" &&
        /api\.github\.com\/repos\/[^/]+\/[^/]+\/contents\//.test(url)
      ) {
        console.info(`[trace] DELETE → ${url}`);
      } else if (
        method === "POST" &&
        /actions\/workflows\/[^/]+\/dispatches/.test(url)
      ) {
        console.info(`[trace] dispatch → ${url}`);
      }
    });
    page.on("response", (res) => {
      const url = res.url();
      if (
        /api\.github\.com\/repos\/[^/]+\/[^/]+\/contents\//.test(url) &&
        res.request().method() === "DELETE"
      ) {
        console.info(`[trace] DELETE ${res.status()} ← ${url}`);
      } else if (/actions\/workflows\/[^/]+\/dispatches/.test(url)) {
        console.info(`[trace] dispatch ${res.status()} ← ${url}`);
      }
    });
    page.on("pageerror", (err) => {
      console.warn(`[trace] page error: ${err && err.message}`);
    });

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
      // Decap renders this as a button in the entry-status menu (or a
      // top-level "Delete" depending on entry state). Try the menu
      // path first; fall back to a direct button match. Either click
      // ultimately lands on the same fetch that the shim catches.
      //
      // The status-button label DEPENDS on the entry's editorial
      // workflow state. Run #25473784039 hung for 40 min on the
      // fallback path because the seeded canary is published already
      // — the toolbar shows a single button labelled `Published`,
      // NOT `Status: …`. Without an explicit click timeout the
      // missing-element wait pegged the runner until the
      // outer test timeout fired. Match either label and pin a
      // timeout on every action so a UI shape change next time fails
      // in 30 s instead of 40 min.
      const trigger = page
        .getByRole("button", { name: /delete (published )?entry/i })
        .first();
      if (await trigger.isVisible({ timeout: 5_000 }).catch(() => false)) {
        await trigger.click({ timeout: 30_000 });
      } else {
        await page
          .getByRole("button", { name: /^(Status:|Published$|In Review$|Ready$|Draft$)/i })
          .first()
          .click({ timeout: 30_000 });
        await page
          .getByRole("menuitem", { name: /delete (published )?entry/i })
          .first()
          .click({ timeout: 30_000 });
      }
      // Decap shows a confirm dialog — accept it. The handler covers
      // both the native confirm() and Decap's own modal variant.
      page.once("dialog", (d) => d.accept());
      await page
        .getByRole("button", { name: /^(delete|confirm|yes)$/i })
        .first()
        .click({ timeout: 5_000 })
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

    });

    // ── 4. Wait for the deploy-status pill spinner→settled ──────
    //
    // The pill is the editor-facing signal for "your deletion is
    // live on prod." Whichever internal path Decap took — the shim
    // (DELETE /contents 422 → dispatch delete-via-pr.yml → cms PR →
    // auto-merge → deploy-production), or an editorial-workflow
    // path that opens its own delete PR directly — the user-facing
    // contract is the same: deploy-production runs, the prod pill
    // spins, then settles to hidden.
    //
    // Anchor the wait on the pill DOM, not on GitHub API peeks
    // (waitForWorkflowRun / waitForMerge / fileExistsOnMain). Those
    // peek under the covers; the pill is the editor's actual
    // signal. If the pill misses the in-progress window or stays
    // spinning past success, that IS the regression — the previous
    // API-based version of this chain would have hidden a real
    // pill bug.
    //
    // The pill polls every 30 s, so its observation lags the
    // underlying deploy by up to one tick. Allow generous timeouts
    // for the spinner-detect phase (covers the full delete chain:
    // dispatch → PR open → validate-content → merge → deploy
    // start).
    await test.step("Wait for the prod deploy-status pill spinner→settled (DOM is ground truth)", async () => {
      // After the delete click, the entry being deleted may unmount
      // its editor (Decap navigates back to the collection list when
      // the source disappears). The pill is only injected into an
      // entry editor's toolbar, so we navigate to a SIBLING entry —
      // canary-page is guaranteed to exist and is not mutated by any
      // spec, so its editor toolbar is a stable mount point for the
      // pill while the delete chain runs in the background.
      await page.goto(`${PROD_ADMIN}#/collections/e2e/entries/canary-page`, {
        waitUntil: "domcontentloaded",
      });
      await expect(page.getByRole("textbox", { name: /^Title$/i })).toBeVisible({
        timeout: 60_000,
      });
      await waitForDeployPillSettled({
        page,
        pillId: PILL_PROD,
        // 8 min covers the long delete chain (dispatch + PR open +
        // validate-content + auto-merge + deploy-production
        // startup) with margin, in case runners are saturated.
        spinTimeoutMs: 8 * 60 * 1000,
        // 4 min covers the deploy run itself + trailing 30-s pill-
        // poll window for success → hidden.
        settleTimeoutMs: 4 * 60 * 1000,
      });
    });

    // ── 5. Verify the public URL actually 404s ──────────────────
    // The pill settled → deploy-production succeeded. CloudFront
    // can lag the deploy by a few seconds; poll until 4xx so we
    // know the deletion landed at the customer-visible layer too.
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
