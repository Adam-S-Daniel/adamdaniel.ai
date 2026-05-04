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
 *   - `chromium-desktop` only.
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
const {
  addLabel,
  fetchPublicUrl,
  gh,
  waitForAutoMergeEnabled,
  waitForCmsPullRequest,
  waitForMerge,
  waitForWorkflowRun,
} = require("./github-actions-poll");

const REPO_ROOT = path.resolve(__dirname, "..");
const FIXTURE_PATH = "_posts/2099-01-01-e2e-mutation-canary.md";
const FIXTURE_ABS = path.join(REPO_ROOT, FIXTURE_PATH);
const FIXTURE_SLUG = "e2e-mutation-canary";
const FIXTURE_TITLE = "E2E Mutation Canary";
const FIXTURE_DATE = "2099-01-01";
const PUBLIC_PATH = `/blog/${FIXTURE_SLUG}/`;

const PROD_HOST = "https://adamdaniel.ai";
const PROD_ADMIN = `${PROD_HOST}/admin/`;
const PUBLIC_URL = `${PROD_HOST}${PUBLIC_PATH}`;

// Same envelope as cms-publish-loop.spec.js — the validate-content +
// auto-merge + deploy-production + CloudFront invalidation chain caps
// out around 12-15 minutes when runners are warm.
const TEST_TIMEOUT_MS = 15 * 60 * 1000;

test.describe.configure({ mode: "serial", timeout: TEST_TIMEOUT_MS });

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
 */
async function writeFixtureOnMain({ fileText, message }) {
  const current = await fetchFixtureFromMain();
  return gh(`/repos/${HOST_REPO}/contents/${FIXTURE_PATH}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      content: toContentBase64(fileText),
      sha: current.sha,
      branch: "main",
    }),
  });
}

// Read the front matter `published` value from a file's text. Matches
// `published: true` or `published: false` on its own line. Tolerates
// surrounding whitespace and quoting.
function readPublishedFlag(text) {
  const m = text.match(/^published:\s*(true|false|"true"|"false"|'true'|'false')\s*$/m);
  if (!m) return null;
  return m[1].replace(/['"]/g, "") === "true";
}

// Build the canonical "baseline" file text — the file with
// `published: false`, ready to be re-committed by the cleanup step.
// This stays in lockstep with the checked-in fixture so the next run
// finds a clean state.
function buildBaselineFileText() {
  // We re-read the fixture from disk on each call so changes to the
  // checked-in file (e.g. someone updates the documentation body)
  // automatically flow into the cleanup commit without needing a code
  // change here.
  return fs.readFileSync(FIXTURE_ABS, "utf8");
}

// Today's date as YYYY-MM-DD in UTC. Compared lexicographically
// against the fixture's ISO date string — string comparison works as
// intended for ISO 8601 dates.
function todayUtcIso() {
  return new Date().toISOString().slice(0, 10);
}

test("CMS publish loop — prod mutation playground (real _posts/ entry)", async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium-desktop",
    "Prod-mutation playground is real-network — runs once on chromium-desktop only.",
  );
  test.skip(
    !getPat(),
    "CMS_E2E_PAT not set — prod-mutation playground disabled.",
  );
  // Only the dedicated cms-publish-loop-prod.yml workflow opts in via
  // RUN_PROD_MUTATE_PLAYGROUND=1. Without this gate the spec also
  // runs inside the e2e-tests.yml shard 1, force-pushing concurrent
  // commits to the same cms/posts/2099-… branch and cancelling each
  // other's validate-content runs.
  test.skip(
    process.env.RUN_PROD_MUTATE_PLAYGROUND !== "1",
    "RUN_PROD_MUTATE_PLAYGROUND not set — only the cms-publish-loop-prod workflow runs this spec.",
  );

  // ── Hard guards (run inside the test so failures show up in the
  // test report, not as silent worker bring-up errors) ───────────
  if (!fs.existsSync(FIXTURE_ABS)) {
    test.fixme(
      true,
      `Fixture ${FIXTURE_PATH} is missing — the prod-mutation playground spec needs the file to drive a publish loop. Restore it from git history or re-add per plan G4.`,
    );
    return;
  }

  const initialFileText = fs.readFileSync(FIXTURE_ABS, "utf8");
  const initialPublished = readPublishedFlag(initialFileText);
  if (initialPublished === null) {
    test.fixme(
      true,
      `Fixture ${FIXTURE_PATH} has no parseable 'published:' front-matter line — fix before retrying.`,
    );
    return;
  }
  if (initialPublished === true) {
    test.fixme(
      true,
      `Fixture ${FIXTURE_PATH} is in an UNSAFE state: 'published: true' on disk. A previous run probably crashed mid-flow. Manually flip it back to 'published: false' on main, then re-run the workflow.`,
    );
    return;
  }
  if (todayUtcIso() >= FIXTURE_DATE) {
    test.fixme(
      true,
      `Be kind in 2099: the date-based fixture ${FIXTURE_PATH} (${FIXTURE_DATE}) is past its expiry. Either move the date forward or retire this spec.`,
    );
    return;
  }

  const runId = Date.now();
  const marker = makeProdMarker(runId);
  const baselineFileText = buildBaselineFileText();

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
    await expect(page.getByRole("link", { name: /^Posts$/i })).toBeVisible({ timeout: 60_000 });
  });

  // ── 3. Open the post, toggle Published, save ────────────────────
  await test.step("Navigate to the mutation canary post", async () => {
    await page.goto(`${PROD_ADMIN}#/collections/posts`, { waitUntil: "domcontentloaded" });
    // The post listing renders one entry per post. Decap's summary
    // template shows `{{title}} (Date) — DRAFT` while published is
    // false, so matching by the title finds it regardless.
    const entry = page.getByRole("link", { name: new RegExp(FIXTURE_TITLE, "i") }).first();
    await expect(entry).toBeVisible({ timeout: 30_000 });
    await entry.click();
    await expect(page.getByRole("textbox", { name: /^Title$/i })).toBeVisible({ timeout: 30_000 });
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
    // The published widget is a boolean rendered as a switch. Decap's
    // accessible name is the field label "Published". Click toggles
    // it. We assert the expected state by reading aria-checked.
    const toggle = page.getByRole("switch", { name: /^Published$/i }).first();
    await expect(toggle).toBeVisible({ timeout: 15_000 });
    // Belt-and-suspenders: if for any reason it's already checked
    // (e.g. an earlier abort), don't toggle it back off.
    const ariaChecked = await toggle.getAttribute("aria-checked");
    if (ariaChecked !== "true") {
      await toggle.click();
    }
    await expect(toggle).toHaveAttribute("aria-checked", "true", { timeout: 5_000 });
  });

  await test.step("Save (opens cms/... PR)", async () => {
    await page.getByRole("button", { name: /^Save$/i }).click();
    // In editorial_workflow mode (prod admin), Save stays disabled
    // after the save completes — the toolbar swaps to "Status: Draft"
    // + a separate "Publish" button. Wait for the "Changes saved"
    // status text instead of the (incorrect) toBeEnabled signal.
    await expect(page.getByText(/Changes saved/i).first()).toBeVisible({ timeout: 60_000 });
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

  // ── 5. validate-content must pass ───────────────────────────────
  await test.step("Wait for validate-content to succeed", async () => {
    await waitForWorkflowRun({
      workflow: "cms-editorial-workflow.yml",
      headSha: pr.head.sha,
      branch: pr.head.ref,
      timeoutMs: 6 * 60 * 1000,
    });
  });

  // ── 6. Add cms/ready, wait for auto-merge + merge ───────────────
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

  // ── 8. Public URL goes live with the marker ─────────────────────
  await test.step("Verify /blog/e2e-mutation-canary/ surfaces the marker", async () => {
    await fetchPublicUrl(PUBLIC_URL, {
      expectContent: marker,
      timeoutMs: 6 * 60 * 1000,
    });
  });

  // ── 9. Cleanup: flip published: false and restore baseline body ─
  // We do this via the Contents API as a single direct-to-main commit
  // rather than going through Decap a second time. Faster, deterministic,
  // and survives a Decap UI hiccup. The `cms-feature-branches` ruleset
  // allows direct pushes to main from the repo owner; the PAT belongs
  // to that account.
  await test.step("Reset fixture to baseline (cleanup commit)", async () => {
    await writeFixtureOnMain({
      fileText: baselineFileText,
      message: `test(prod-mutate): reset fixture after run ${runId}`,
    });
  });

  // ── 10. Confirm the URL 404s again after cleanup ────────────────
  // The cleanup commit retriggers deploy-production.yml. We don't
  // block on it — the next nightly run handles any propagation lag —
  // but a quick check that the cleanup commit *was* applied to main
  // catches "the API write 404'd silently" failure modes.
  await test.step("Verify cleanup landed on main (published: false on main)", async () => {
    const after = await fetchFixtureFromMain();
    const afterBody = Buffer.from(after.content, "base64").toString("utf8");
    const afterPublished = readPublishedFlag(afterBody);
    expect(afterPublished, "main should be published: false after cleanup").toBe(false);
  });
});
