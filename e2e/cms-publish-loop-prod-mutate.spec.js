// @lane: real — mutates a real prod _posts/ entry through Decap → GitHub
// @select-skip-when-head-ref-prefix: cms/
//
// On `cms/*` PRs (Decap-opened editorial PRs) this spec self-skips at
// runtime — CMS_E2E_PAT and PROD_PLAYGROUND_MODE aren't wired into the
// standard PR matrix — so selecting + bringing it up just to no-op is
// pure waste. The dedicated cms-publish-loop-prod workflow runs it.

/*
 * Real-browser, real-HTTP, real-GitHub end-to-end test for the full
 * Decap CMS publish loop on prod, but mutating a REAL `_posts/` entry
 * (not just the `_e2e/` canary subset). G4 from the "happy hopper"
 * plan.
 *
 * allowed: literal slug used for known fixture
 *   The fixture is _posts/2099-01-01-e2e-mutation-canary.md and its
 *   public URL `/blog/e2e-mutation-canary/` appears in step labels
 *   and assertion messages throughout this spec.
 *
 * Premise: while `prod` is a "full mutation playground" — i.e. nobody
 * is reading the site for SEO — exercising the publish loop against
 * the same paths a real contributor uses gives a stronger signal than
 * the `_e2e/` canary alone. The canary collection has its own layout
 * and is excluded from feeds/sitemap; a real `_posts/` entry goes
 * through `_layouts/post.html`, surfaces in the blog index, and
 * exercises the same code paths a content edit would hit.
 *
 * Sunset path: this spec runs only when the workflow's repo variable
 * `PROD_PLAYGROUND_MODE=true`. When prod stops being a playground,
 * flip the variable off; the workflow skips itself and the fixture
 * file stays in-tree as documentation.
 *
 * Hard guards (CRITICAL — see plan G4):
 *   1. Fixture file `_posts/2099-01-01-e2e-mutation-canary.md` MUST
 *      exist on disk at test start. Missing → `test.fixme()` with a
 *      clear "fixture missing" message.
 *   2. Front-matter `published:` MUST be `false` at test start. If
 *      it's `true`, a previous run crashed mid-flow and the URL is
 *      currently public — `test.fixme()` so a human resets it.
 *   3. The fixture date `2099-01-01` MUST still be in the future. If
 *      someone is reading this spec in 2099, fail kindly — change the
 *      filename to a later date or retire the spec.
 *
 * Flow:
 *   0. Reset fixture to baseline (`published: false`) via Contents API.
 *   1. Confirm `/blog/e2e-mutation-canary/` 404s before driving admin.
 *   2. Drive prod admin with PAT-seeded session.
 *   3. Navigate to the post entry, toggle Published → ON, Save.
 *   4. Wait for the `cms/...` PR Decap opens.
 *   5. Wait for `validate-content` to succeed.
 *   6. Add `cms/ready` label, wait for auto-merge + merge.
 *   7. Wait for `deploy-production.yml` to succeed on main.
 *   8. Fetch `/blog/e2e-mutation-canary/` — assert 200 + expected body.
 *   9. Cleanup: write `published: false` back via Contents API.
 *
 * Gating:
 *   - `CMS_E2E_PAT` must be set.
 *   - `chromium-desktop-3k` only.
 *   - Workflow gated on `vars.PROD_PLAYGROUND_MODE == 'true'` so the
 *     spec doesn't run by accident outside the scheduled cron.
 *
 * IMPORTANT: do NOT run this spec locally against prod. It mutates the
 * real production tree. The workflow runs it on a schedule.
 */
const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("./base");
const { seedDecapAuth, getPat, HOST_REPO } = require("./decap-pat");
const { closeStaleDecapPrOnBranch } = require("./cms-fixture-pr");
const {
  addLabel,
  gh,
  waitForCmsPullRequest,
  makeDeployQueueExtender,
} = require("./github-actions-poll");
const { waitForChangeReflected } = require("./deploy-pill");
const { setPublished, saveEntry, publishViaUi } = require("./cms-editor-ui");
const { prodTarget } = require("./cms-host");
const { readPublishedFlag, forcePublishedFalse, loudBail } = require("./fixture-baseline");

const REPO_ROOT = path.resolve(__dirname, "..");
const FIXTURE_PATH = "_posts/2099-01-01-e2e-mutation-canary.md";
const FIXTURE_ABS = path.join(REPO_ROOT, FIXTURE_PATH);
const FIXTURE_SLUG = "e2e-mutation-canary";
const FIXTURE_TITLE = "E2E Mutation Canary";
const FIXTURE_DATE = "2099-01-01";
const PUBLIC_PATH = `/blog/${FIXTURE_SLUG}/`;

// Fixed-prod loop, resolved through the shared cms-host resolver
// (byte-identical to the old literals) so prod/preview can't drift.
const { host: PROD_HOST, adminUrl: PROD_ADMIN, pillId: PILL_PROD } = prodTarget();
const PUBLIC_URL = `${PROD_HOST}${PUBLIC_PATH}`;
// Read-only daily probe gate — set in canary-prod.yml. The afterAll
// harness consults this so the probe never tries to write to main.
const PROD_CANARY = process.env.PROD_CANARY === "1";

// Same envelope as cms-publish-loop.spec.js — the validate-content +
// auto-merge + deploy-production + CloudFront invalidation chain caps
// out around 12-15 minutes when runners are warm. Two URL waits
// (forward + cleanup) at 15 min each + setup ≈ 40 min worst case
// budget; typical happy-path run still completes in ~10-12 min.
// Retries explicitly disabled — this test mutates real prod state;
// retries just re-run the same broken chain after another 40 min.
const TEST_TIMEOUT_MS = 40 * 60 * 1000;

test.describe.configure({
  mode: "serial",
  timeout: TEST_TIMEOUT_MS,
  retries: 0,
});

// Marker that goes into the body so the test can assert "this exact
// run produced what's at the public URL." Distinct from the `_e2e/`
// canary marker so the two specs can't accidentally read each other's
// state if their cron windows overlap.
function makeProdMarker(runId) {
  return `e2e-prod-mutate:${FIXTURE_SLUG}:${runId}`;
}

function toContentBase64(text) {
  return Buffer.from(text, "utf8").toString("base64");
}

async function fetchFixtureFromMain() {
  return gh(`/repos/${HOST_REPO}/contents/${FIXTURE_PATH}?ref=main`);
}

/**
 * Write a complete fixture body to main via the Contents API. The
 * caller passes the entire file (front matter + body) so the cleanup
 * step can force `published: false` regardless of what state the
 * editor left it in.
 *
 * Optimistic-concurrency retry: GitHub's Contents API requires the
 * caller to submit the current blob SHA; if main advances between
 * our `fetchFixtureFromMain()` and the PUT, the API rejects with
 * 409 ("is at <new> but expected <stale>"). The race window is
 * narrow but real — concurrent harness cleanups from other workers
 * and any unrelated commit landing on main can both trip it.
 *
 * Resolution: catch a 409, re-fetch the SHA, retry the PUT. Cap
 * at 4 attempts (1 initial + 3 retries) to bound runtime; in
 * practice a single retry succeeds because main is rarely advancing
 * faster than ~1 commit/sec, and our PUT is idempotent (writing
 * the same baseline content yields the same end state regardless
 * of which retry wins).
 */
async function writeFixtureOnMain({ fileText, message }) {
  const MAX_ATTEMPTS = 4;
  let lastErr;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const current = await fetchFixtureFromMain();
    try {
      return await gh(`/repos/${HOST_REPO}/contents/${FIXTURE_PATH}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          content: toContentBase64(fileText),
          sha: current.sha,
          branch: "main",
        }),
      });
    } catch (err) {
      lastErr = err;
      if (err && err.status === 409 && attempt < MAX_ATTEMPTS) {
        console.warn(
          `[writeFixtureOnMain] 409 conflict on attempt ${attempt}; re-fetching SHA and retrying (main advanced under us)`,
        );
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

// `readPublishedFlag` is shared from ./fixture-baseline (#1053 DRY'd
// the five per-spec copies into one implementation).

// Build the canonical "baseline" file text — the file with
// `published: false`, ready to be re-committed by the cleanup step.
//
// We re-read the fixture from disk so a documentation-body edit to the
// checked-in file still flows into the cleanup commit without a code
// change here — but we NEVER trust its `published:` value. The fixture
// ships `published: true` (so a human opening the file previews the
// rendered post); forcing it false here is exactly what makes the loop
// self-heal instead of being a fixed point that re-writes
// `published: true`, skips on the next run's guard, and reports green
// forever (#1053). Idempotent once the fixture is checked in false.
function buildBaselineFileText() {
  return forcePublishedFalse(fs.readFileSync(FIXTURE_ABS, "utf8"), FIXTURE_PATH);
}

// Today's date as YYYY-MM-DD in UTC. Compared lexicographically
// against the fixture's ISO date string — string comparison works as
// intended for ISO 8601 dates.
function todayUtcIso() {
  return new Date().toISOString().slice(0, 10);
}

test(
  "CMS publish loop — prod mutation playground (real _posts/ entry)",
  { tag: ["@admin-write"] },
  async ({ page }) => {
    // Only the dedicated cms-publish-loop-prod.yml workflow opts in via
    // RUN_PROD_MUTATE_PLAYGROUND=1. Without this gate the spec also
    // runs inside the e2e-tests.yml shard 1, force-pushing concurrent
    // commits to the same cms/posts/2099-… branch and cancelling each
    // other's validate-content runs. This is a legitimate "not my
    // workflow" skip — keep it a plain green test.skip, and FIRST so a
    // shard-1 PR run exits here before reaching the loud guards below.
    test.skip(
      process.env.RUN_PROD_MUTATE_PLAYGROUND !== "1",
      "RUN_PROD_MUTATE_PLAYGROUND not set — only the cms-publish-loop-prod workflow runs this spec.",
    );

    // ── Hard guards (run inside the test so failures show up in the
    // test report, not as silent worker bring-up errors) ───────────
    // Past this point the spec is SUPPOSED to run. `loudBail` makes an
    // unmet precondition a red failure on a schedule/workflow_dispatch
    // run (and a green test.fixme on local/PR runs, as before) — #1053:
    // a non-running scheduled loop must never masquerade as green.
    if (!getPat()) {
      loudBail(test, "CMS_E2E_PAT not set — prod-mutation playground cannot run.");
      return;
    }
    if (!fs.existsSync(FIXTURE_ABS)) {
      loudBail(
        test,
        `Fixture ${FIXTURE_PATH} is missing — the prod-mutation playground spec needs the file to drive a publish loop. Restore it from git history or re-add per plan G4.`,
      );
      return;
    }

    const initialFileText = fs.readFileSync(FIXTURE_ABS, "utf8");
    const initialPublished = readPublishedFlag(initialFileText);
    if (initialPublished === null) {
      loudBail(
        test,
        `Fixture ${FIXTURE_PATH} has no parseable 'published:' front-matter line — fix before retrying.`,
      );
      return;
    }
    if (initialPublished === true) {
      // The loop self-heals main (buildBaselineFileText forces
      // `published: false`), but a checked-in `published: true` is a
      // source-of-truth misconfiguration: the file would serve publicly
      // until a deploy drops it, and it is exactly the state that used
      // to skip-and-report-green for ~10 days (#1053). Fail loudly on a
      // scheduled run so a human fixes the committed fixture.
      loudBail(
        test,
        `Fixture ${FIXTURE_PATH} is checked in 'published: true'. The loop force-resets main, but the committed fixture MUST be 'published: false' (see #1053). Flip it back on main.`,
      );
      return;
    }
    if (todayUtcIso() >= FIXTURE_DATE) {
      loudBail(
        test,
        `Be kind in 2099: the date-based fixture ${FIXTURE_PATH} (${FIXTURE_DATE}) is past its expiry. Either move the date forward or retire this spec.`,
      );
      return;
    }

    const runId = Date.now();
    const marker = makeProdMarker(runId);
    const baselineFileText = buildBaselineFileText();

    // ── 0a. Close any stale Decap editorial-workflow PR on the
    // post's fixed branch ──────────────────────────────────────────
    // Decap reuses cms/posts/<slug> per entry, so a prior run that
    // crashed at any stage past Save can leave a PR with a non-Draft
    // editorial-workflow label. On the next run the Save pushes onto
    // the same branch — labels persist — Decap shows "Status: Ready"
    // instead of "Status: Draft" — the step-6 button-wait below times
    // out at 15 min. See docs/.../cms-stuck-pr-triage skill for the
    // full diagnostic. Resetting the PR here lets Decap open a fresh
    // decap-cms/draft on the next Save.
    await test.step("Close any stale Decap editorial-workflow PR on the post branch", async () => {
      // Decap's branch shape for a Posts entry is
      // `cms/posts/<file-slug>`, where <file-slug> matches the
      // YYYY-MM-DD-<slug> filename without the .md extension.
      const fileSlug = FIXTURE_PATH.replace(/^_posts\//, "").replace(/\.md$/, "");
      await closeStaleDecapPrOnBranch({ branch: `cms/posts/${fileSlug}` });
    });

    // ── 0. Reset fixture to baseline before the run ─────────────────
    // The previous run may have crashed mid-flow; force a clean start
    // with `published: false` and the canonical body. Idempotent — if
    // main is already at baseline, the API write is a no-op (Contents
    // API treats matching content as a 200 with no new commit).
    await test.step("Reset fixture to baseline (published: false) via Contents API", async () => {
      const current = await fetchFixtureFromMain();
      const remoteBody = Buffer.from(current.content, "base64").toString("utf8");
      const remotePublished = readPublishedFlag(remoteBody);
      if (remotePublished !== false || remoteBody !== baselineFileText) {
        await writeFixtureOnMain({
          fileText: baselineFileText,
          message: `test(prod-mutate): reset fixture baseline before run ${runId}`,
        });
      }
    });

    // ── 1. Confirm the URL 404s before driving admin ────────────────
    // With `published: false`, Jekyll skips the file entirely so the
    // URL returns the site's 404 page. If we observe a 200 here, the
    // baseline reset didn't take — bail out before mutating prod.
    await test.step("Confirm /blog/e2e-mutation-canary/ 404s while published: false", async () => {
      // Wait up to 6 minutes for the latest deploy to remove the page
      // (in the rare case the previous run left published: true).
      const deadline = Date.now() + 6 * 60 * 1000;
      let lastStatus = "unknown";
      while (Date.now() < deadline) {
        const res = await fetch(PUBLIC_URL, { cache: "no-store" });
        lastStatus = `${res.status}`;
        if (res.status === 404) return;
        await new Promise((r) => setTimeout(r, 8000));
      }
      throw new Error(
        `Expected ${PUBLIC_URL} to 404 before driving admin (published: false should drop the file from the build), got ${lastStatus}.`,
      );
    });

    // ── 2. Pre-seed Decap auth and load prod admin ──────────────────
    await seedDecapAuth(page);
    await test.step("Load production admin", async () => {
      await page.goto(PROD_ADMIN, { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("link", { name: /^Posts$/i })).toBeVisible({
        timeout: 60_000,
      });
    });

    // ── 3. Open the post, toggle Published, save ────────────────────
    await test.step("Navigate to the mutation canary post", async () => {
      // Direct entry URL is deterministic and bypasses collection-list
      // ordering/visibility. admin/posts-list-enhance.js hides the
      // automated-test fixtures from the Posts list by DEFAULT (#1042),
      // so the canary is intentionally not clickable from the list —
      // navigate straight to it (same pattern as the cleanup step below
      // and cms-unpublish-republish.spec.js).
      const fileSlug = FIXTURE_PATH.replace(/^_posts\//, "").replace(/\.md$/, "");
      await page.goto(`${PROD_ADMIN}#/collections/posts/entries/${fileSlug}`, {
        waitUntil: "domcontentloaded",
      });
      const titleBox = page.getByRole("textbox", { name: /^Title$/i });
      await expect(titleBox).toBeVisible({ timeout: 30_000 });
      // Confirm we deep-linked to the right canary.
      await expect(titleBox).toHaveValue(new RegExp(FIXTURE_TITLE, "i"));
    });

    await test.step("Append run marker to body", async () => {
      // The body widget is a markdown editor. Appending a run-unique
      // marker lets the assertion at the end confirm we're seeing
      // *this* run's output, not a stale cache hit from the previous.
      // The pinned Decap version no longer exposes "Body" as the
      // textbox's accessible name — mirror cms-publish-flow.spec.js
      // and grab the last contenteditable textbox on the page.
      const body = page.locator('[role="textbox"][contenteditable="true"]').last();
      await body.click();
      await body.press("End");
      await body.pressSequentially(`\n\n${marker}\n`);
    });

    await test.step("Toggle Published → ON", async () => {
      // The Published widget is a switch (role="switch"), toggled via
      // aria-checked — see e2e/cms-editor-ui.js (shared so the
      // selector can't drift, #1723).
      await setPublished(page, true, { visibleTimeout: 15_000 });
    });

    await test.step("Save (opens cms/... PR)", async () => {
      await page.getByRole("button", { name: /^Save$/i }).click();
      // In editorial_workflow mode (prod admin), Save stays disabled
      // after the save completes — the toolbar swaps to "Status: Draft"
      // + a separate "Publish" button. Wait for the "Changes saved"
      // status text instead of the (incorrect) toBeEnabled signal.
      await expect(page.getByText(/Changes saved/i).first()).toBeVisible({
        timeout: 60_000,
      });
    });

    // ── 4. Find the cms/... PR Decap opened ─────────────────────────
    let pr;
    await test.step("Wait for Decap to open the cms/... PR", async () => {
      pr = await waitForCmsPullRequest({
        base: "main",
        filePath: FIXTURE_PATH,
        canaryMarker: marker,
        timeoutMs: 5 * 60 * 1000,
      });
      expect(pr.number, "Decap PR number").toBeGreaterThan(0);
    });

    // ── 5. Apply cms/ready and wait for the deploy-status pill ──────
    // Set cms/ready directly on the cms PR. cms-editorial-workflow.yml
    // sees it, enables auto-merge once required checks pass, and the
    // PR merges into main → deploy-production fires.
    //
    // Wait for the prod deploy-status pill spinner→settled lifecycle
    // as the editor-facing ground truth that the chain landed. No
    // GitHub API peeks (waitForWorkflowRun, waitForMerge,
    // waitForAutoMergeEnabled) — the pill is the user contract; if
    // the pill misses its in-progress window or stays spinning past
    // success, that IS the regression we want to catch.
    await test.step("Label PR cms/ready", async () => {
      await addLabel({ prNumber: pr.number, label: "cms/ready" });
    });

    // ── Wait for the URL to surface the marker (and pill terminal) ──
    // STAY on the entry editor view — the pill is injected there.
    // Poll the public URL until it contains the marker; watch the pill
    // for failure transitions and assert it lands in terminal hidden
    // state. Don't gate on the pill's in_progress spinner — fast
    // deploys often pass entirely between two 30-s pill polls.
    await test.step("Wait for /blog/e2e-mutation-canary/ to surface the marker (and pill terminal-hidden)", async () => {
      await waitForChangeReflected({
        page,
        pillId: PILL_PROD,
        urlCheck: async () => {
          const res = await page.request.get(PUBLIC_URL, {
            failOnStatusCode: false,
          });
          if (res.status() !== 200) return false;
          return (await res.text()).includes(marker);
        },
        urlTimeoutMs: 15 * 60 * 1000,
        onBudgetExhausted: makeDeployQueueExtender(),
      });
    });

    // ── 9. Cleanup: flip published: false and restore baseline body ─
    // We do this via the Contents API as a single direct-to-main commit
    // rather than going through Decap a second time. Faster, deterministic,
    // and survives a Decap UI hiccup. The `cms-feature-branches` ruleset
    // allows direct pushes to main from the repo owner; the PAT belongs
    // to that account.
    // ── Cleanup via Decap UI (toggle Published OFF + restore body) ─
    // Drive Decap to undo the mutation symmetrically with the forward
    // leg. The forward leg flipped `published: true` and added a
    // marker to the body; the cleanup flips back and restores body.
    // Per AGENTS.md "no back doors in setup or cleanup either."
    await test.step("Cleanup via UI: toggle Published → OFF, restore body, Save → Publish Now", async () => {
      // We may have left the entry editor for the pill-watch step;
      // navigate back. Direct entry URL is deterministic.
      await page.goto(
        `${PROD_ADMIN}#/collections/posts/entries/${FIXTURE_PATH.replace(/^_posts\//, "").replace(/\.md$/, "")}`,
        { waitUntil: "domcontentloaded" },
      );
      await expect(page.getByRole("textbox", { name: /^Title$/i })).toBeVisible({
        timeout: 30_000,
      });

      // Toggle Published OFF via the shared switch helper (this leg had
      // drifted to getByRole("checkbox") — see e2e/cms-editor-ui.js, #1723).
      await setPublished(page, false);

      // Restore the canonical baseline body (drops this run's marker).
      // baselineFileText is the whole .md (front matter + body); slice off
      // the front matter so we paste only the body portion.
      const body = page.locator('[role="textbox"][contenteditable="true"]').last();
      await body.click();
      await page.keyboard.press("Control+A");
      await page.keyboard.press("Backspace");
      const fmEnd = baselineFileText.indexOf("\n---\n", 4);
      const baselineBodyOnly = baselineFileText.slice(fmEnd + 5).trim();
      await body.pressSequentially(baselineBodyOnly + "\n");

      // Save + publish the unpublish through Decap's editor. publishViaUi
      // is state-robust: after the forward leg published this entry, it's
      // in the "published with unpublished changes" state (a `Publish ▾`
      // control, no `Status: Draft` chip), so it publishes directly —
      // unconditionally asserting `Status: Ready` here is exactly what
      // timed out before (#1723). Fully UI-driven, symmetric with the
      // forward leg's mutation.
      await saveEntry(page);
      await publishViaUi(page);

      // Wait for the URL to 4xx (post unpublished, file restored).
      await waitForChangeReflected({
        page,
        pillId: PILL_PROD,
        urlCheck: async () => {
          const res = await page.request.get(PUBLIC_URL, {
            failOnStatusCode: false,
          });
          const s = res.status();
          return s >= 400 && s < 500;
        },
        urlTimeoutMs: 15 * 60 * 1000,
        onBudgetExhausted: makeDeployQueueExtender(),
      });
    });
  },
);

// ── Test-harness cleanup safety net ───────────────────────────────
// Mirrors cms-publish-loop.spec.js's afterAll. Reads the fixture
// from main; if it's not at baseline (`published: true` still set,
// or marker still present in body), opens the API write to restore
// it. Skips when the fixture is already at baseline.
test.afterAll(async () => {
  if (PROD_CANARY) return;
  if (!getPat()) return;
  // Mirror the test-body skip: this hook recovers from a failed
  // mid-mutation in THIS run. Outside the cms-publish-loop-prod
  // workflow the body never runs, so there's nothing to clean up
  // — and reading the canary from e.g. e2e-real while a parallel
  // prod-mutate is mid-flight races the Contents API SHA. Only
  // cleanup in the same context that owns the mutation.
  if (process.env.RUN_PROD_MUTATE_PLAYGROUND !== "1") return;
  let current;
  try {
    current = await fetchFixtureFromMain();
  } catch (e) {
    console.warn(
      `[cleanup-harness] couldn't read ${FIXTURE_PATH} from main; skipping safety net: ${e && e.message}`,
    );
    return;
  }
  const decoded = Buffer.from(current.content, "base64").toString("utf8");
  const stillPublished = readPublishedFlag(decoded) === true;
  // Match THIS spec's marker shape: makeProdMarker() emits
  // `e2e-prod-mutate:<slug>:<runId>` (slug has hyphens, runId is digits).
  // The old pattern looked for `e2e-publish-loop:` — a different spec's
  // marker — so this safety-net check was always false (it relied solely
  // on `stillPublished`). Use the real prod-mutate marker so a crashed
  // run that left ONLY a body marker (published already reset) is also
  // cleaned.
  const hasMarker = /e2e-prod-mutate:[a-z0-9-]+:\d+/.test(decoded);
  if (!stillPublished && !hasMarker) {
    console.log(
      "[cleanup-harness] prod-mutate fixture at baseline; UI cleanup succeeded — no safety net needed",
    );
    return;
  }
  console.warn(
    `[cleanup-harness] fixture on main is mutated (published=${stillPublished}, marker=${hasMarker}); restoring via Contents API`,
  );
  await writeFixtureOnMain({
    fileText: buildBaselineFileText(),
    message: `test(prod-mutate): harness safety-net reset of fixture (UI cleanup left mutation)`,
  });
});
