// @lane: real — drives the real Decap CMS Posts collection on prod
// @select-skip-when-head-ref-prefix: cms/
//
// Self-skips when CMS_E2E_PAT or RUN_HOST_REPO_PUBLISH_LOOP is unset, so
// the spec only fires from the dedicated cms-publish-loop-host workflow.
//
// On `cms/*` PRs (Decap-opened editorial PRs) this spec self-skips at
// runtime — RUN_HOST_REPO_PUBLISH_LOOP is unset on the standard PR
// matrix.
//
// allowed: literal slug used for known fixture
// (`/blog/e2e-unpublish-canary/` is the rendered URL of the dedicated
// fixture `_posts/2099-01-02-e2e-unpublish-canary.md`; this spec
// references it deliberately as the test target. File-scope pragma
// per `e2e/blog-slug-literal-lint.test.js`.)

/*
 * UI test for Decap CMS's "unpublish" + "re-publish" flow on a real
 * `_posts/` entry. This is DISTINCT from delete: unpublishing keeps
 * the file in the repo (frontmatter `published: true` flipped to
 * `false`) and removes the public URL; re-publishing flips the flag
 * back and the URL serves again. Delete removes the file entirely.
 *
 * Why a dedicated spec rather than extending cms-publish-loop-prod-
 * mutate.spec.js: prod-mutate's purpose is "edit body + flip
 * published flag" (the mutation playground). This spec's purpose is
 * the toggle-only flow — no body edit, no marker insertion. A
 * regression in either flow should fail one spec without obscuring
 * the other.
 *
 * Fixture: `_posts/2099-01-02-e2e-unpublish-canary.md` is shipped
 * with `published: false` so the URL is hidden in the steady state.
 * The spec:
 *   1. Drives Decap UI to open the entry, asserts the Published
 *      toggle reads the baseline state (off).
 *   2. Asserts /blog/e2e-unpublish-canary/ 4xxs (URL hidden).
 *   3. Drives Decap UI: toggle Published → ON, Save → Status:Ready
 *      → Publish Now. Waits for the URL to flip to 200 (deploy
 *      reflected). This is the "re-publish" leg.
 *   4. Drives Decap UI: toggle Published → OFF, Save → Status:Ready
 *      → Publish Now. Waits for the URL to flip back to 4xx. This
 *      is the "unpublish" leg.
 *
 * The order intentionally is publish-first-then-unpublish (rather
 * than unpublish-first-then-republish): the baseline is OFF, so we
 * have to flip ON to assert the publish path renders, then flip OFF
 * to assert the unpublish path hides. End state matches baseline,
 * so subsequent runs start clean.
 *
 * No back doors per AGENTS.md: every state change is a Decap UI
 * click; every wait is the URL-driven helper from deploy-pill.js.
 */
const path = require("node:path");
const fs = require("node:fs");
const { test, expect } = require("./base");
const { seedDecapAuth, getPat, HOST_REPO } = require("./decap-pat");
const { fetchPublicUrl, gh } = require("./github-actions-poll");
const { waitForChangeReflected, PILL_PROD } = require("./deploy-pill");

const PROD_HOST = "https://adamdaniel.ai";
const PROD_ADMIN = `${PROD_HOST}/admin/`;
const FIXTURE_PATH = "_posts/2099-01-02-e2e-unpublish-canary.md";
const FIXTURE_TITLE = "E2E Unpublish Canary";
const FIXTURE_SLUG = "e2e-unpublish-canary";
const PUBLIC_URL = `${PROD_HOST}/blog/${FIXTURE_SLUG}/`;
const PROD_CANARY = process.env.PROD_CANARY === "1";

function toContentBase64(text) {
  return Buffer.from(text, "utf8").toString("base64");
}

async function fetchFixtureFromMain() {
  return gh(`/repos/${HOST_REPO}/contents/${FIXTURE_PATH}?ref=main`);
}

// Read the front matter `published` value from a file's text. Matches
// `published: true` or `published: false` on its own line. Returns null
// if the key is missing entirely (Jekyll treats it as published, but
// for this spec the fixture always carries an explicit value).
function readPublishedFlag(text) {
  const m = text.match(/^published:\s*(true|false)\s*$/m);
  return m ? m[1] === "true" : null;
}

// Used by the afterAll harness to restore baseline (`published: false`)
// when the UI cleanup leg failed and left the fixture mutated on main.
// Direct PUT /contents on main is allowed by the ruleset for files
// outside the publish-flow guard; the helper mirrors prod-mutate's
// writeFixtureOnMain.
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

// Two full publish chains run serially:
//   - chain 1: publish (URL 4xx → 200)
//   - chain 2: unpublish (URL 200 → 4xx)
// Each is roughly the same shape as cms-publish-loop's mutation
// (validate-content + auto-merge + deploy-production). With each
// URL-wait capped at 15 min (matching the prod-mutate spec's
// budget after commit 880a34d) plus admin login + UI clicks +
// cleanup, ~40 min total covers worst-case runner contention.
// Retries disabled — real-state mutation.
const TEST_TIMEOUT_MS = 40 * 60 * 1000;

test.describe.configure({
  mode: "serial",
  timeout: TEST_TIMEOUT_MS,
  retries: 0,
});

async function urlServesPost(page) {
  const res = await page.request.get(PUBLIC_URL, { failOnStatusCode: false });
  return res.status() === 200;
}

async function url404s(page) {
  const res = await page.request.get(PUBLIC_URL, { failOnStatusCode: false });
  const s = res.status();
  return s >= 400 && s < 500;
}

test(
  "CMS unpublish + re-publish — flip published flag toggles URL visibility",
  { tag: ["@admin-write"] },
  async ({
  page,
}, testInfo) => {
  test.skip(!getPat(), "CMS_E2E_PAT not set — host-repo unpublish spec disabled.");
  test.skip(
    process.env.RUN_HOST_REPO_PUBLISH_LOOP !== "1",
    "RUN_HOST_REPO_PUBLISH_LOOP not set — opt-in via the cms-publish-loop-host workflow.",
  );

  // Persistent dialog handler — Decap uses native window.confirm()
  // for the publish-now confirmation in some flows; without this
  // listener Playwright auto-dismisses the dialog and Decap reads
  // it as "user cancelled," silently aborting the chain. See
  // AGENTS.md "Test-Driven Design" section.
  page.on("dialog", (d) => d.accept());

  // ── 0. Confirm baseline before driving admin ────────────────────
  // Read the source fixture from main and verify it asserts
  // `published: false` — this is the baseline the spec restores in
  // cleanup, and a spec body that started against a different
  // baseline would corrupt the next run. UI-driven assertion below
  // confirms the editor agrees.
  await test.step("Confirm fixture file's baseline is published: false on main", async () => {
    const text = fs.readFileSync(
      path.join(__dirname, "..", FIXTURE_PATH),
      "utf8",
    );
    if (!/^published:\s*false\s*$/m.test(text)) {
      throw new Error(
        `${FIXTURE_PATH} on main is not at baseline (published: false). Reset before running this spec.`,
      );
    }
  });

  await test.step("Confirm public URL 4xxs before driving admin", async () => {
    const ok404 = await url404s(page);
    expect(ok404, `${PUBLIC_URL} should 4xx at baseline`).toBe(true);
  });

  // ── 1. Open admin, navigate to the unpublish-canary entry ──────
  await seedDecapAuth(page);
  await test.step("Load production admin", async () => {
    await page.goto(PROD_ADMIN, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("link", { name: /^Posts$/i })).toBeVisible({
      timeout: 60_000,
    });
  });

  await test.step("Navigate to the unpublish-canary post entry", async () => {
    // Direct URL nav is deterministic and bypasses any
    // collection-list ordering quirks.
    //
    // Decap's hash-route entry mount is occasionally slow on cold
    // CDN cache (especially right after a deploy-production), and
    // the failure mode is a stuck Title field. Two-attempt retry:
    // navigate → wait up to 60s for Title → on timeout, reload
    // (forcing a fresh asset fetch) and try once more. 60s per
    // leg, so worst-case ~120s before this step fails.
    const titleLocator = page.getByRole("textbox", { name: /^Title$/i });
    const targetUrl = `${PROD_ADMIN}#/collections/posts/entries/2099-01-02-${FIXTURE_SLUG}`;
    let lastErr;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        if (attempt === 1) {
          await page.goto(targetUrl, { waitUntil: "domcontentloaded" });
        } else {
          console.warn(
            `[unpublish-republish] Title field didn't appear within 60s on attempt 1; reloading and retrying`,
          );
          await page.reload({ waitUntil: "domcontentloaded" });
        }
        await expect(titleLocator).toBeVisible({ timeout: 60_000 });
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
      }
    }
    if (lastErr) throw lastErr;
  });

  await test.step("Verify the editor reads Published toggle as OFF (baseline)", async () => {
    // Decap renders the boolean Published widget as `role="switch"`
    // (not `checkbox`); state is exposed via `aria-checked`. PR #407's
    // first run failed here on `getByRole("checkbox")` — same lesson
    // prod-mutate already learned, see its toggle step.
    const toggle = page.getByRole("switch", { name: /^Published$/i }).first();
    await expect(toggle, "Published toggle should be visible").toBeVisible({
      timeout: 30_000,
    });
    await expect(
      toggle,
      "Published toggle should reflect baseline (aria-checked=false)",
    ).toHaveAttribute("aria-checked", "false", { timeout: 5_000 });
  });

  // ── 2. Re-publish leg: toggle ON, Save, drive workflow → URL 200 ──
  await test.step("Toggle Published → ON via UI", async () => {
    const toggle = page.getByRole("switch", { name: /^Published$/i }).first();
    // Belt-and-suspenders: only click if it's not already on (e.g. an
    // earlier abort left it ON), so we don't toggle the wrong direction.
    const ariaChecked = await toggle.getAttribute("aria-checked");
    if (ariaChecked !== "true") await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "true", { timeout: 5_000 });
  });

  await test.step("Save → Status:Ready → Publish Now (re-publish)", async () => {
    await page.getByRole("button", { name: /^Save$/i }).click();
    await expect(page.getByText(/Changes saved/i).first()).toBeVisible({
      timeout: 60_000,
    });
    await page.getByRole("button", { name: /^Status:\s*Draft$/i }).click();
    await page.getByRole("menuitem", { name: /^Ready$/i }).click();
    await expect(
      page.getByRole("button", { name: /^Status:\s*Ready$/i }),
    ).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: /^Publish$/i }).click();
    await page
      .getByRole("menuitem", { name: /publish now/i })
      .first()
      .click();
  });

  await test.step("Wait for /blog/e2e-unpublish-canary/ to serve (URL 200)", async () => {
    await waitForChangeReflected({
      page,
      pillId: PILL_PROD,
      urlCheck: async () => urlServesPost(page),
      urlTimeoutMs: 15 * 60 * 1000,
    });
  });

  // ── 3. Unpublish leg: toggle OFF, Save, drive workflow → URL 404 ──
  await test.step("Toggle Published → OFF via UI", async () => {
    const toggle = page.getByRole("switch", { name: /^Published$/i }).first();
    const ariaChecked = await toggle.getAttribute("aria-checked");
    if (ariaChecked !== "false") await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "false", { timeout: 5_000 });
  });

  await test.step("Save → Status:Ready → Publish Now (unpublish)", async () => {
    await page.getByRole("button", { name: /^Save$/i }).click();
    await expect(page.getByText(/Changes saved/i).first()).toBeVisible({
      timeout: 60_000,
    });
    await page.getByRole("button", { name: /^Status:\s*Draft$/i }).click();
    await page.getByRole("menuitem", { name: /^Ready$/i }).click();
    await expect(
      page.getByRole("button", { name: /^Status:\s*Ready$/i }),
    ).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: /^Publish$/i }).click();
    await page
      .getByRole("menuitem", { name: /publish now/i })
      .first()
      .click();
  });

  await test.step("Wait for /blog/e2e-unpublish-canary/ to 4xx (URL hidden)", async () => {
    await waitForChangeReflected({
      page,
      pillId: PILL_PROD,
      urlCheck: async () => url404s(page),
      urlTimeoutMs: 15 * 60 * 1000,
    });
  });
});

// Safety-net harness: the spec body's last leg flips Published OFF and
// waits for the URL to 404, so a passing run already lands at baseline.
// This hook only acts when the UI cleanup didn't complete (test failed
// somewhere between the publish and unpublish legs, leaving the fixture
// at `published: true` on main). Reading the file once and short-
// circuiting on the clean case keeps the hook silent in the happy path.
test.afterAll(async () => {
  if (PROD_CANARY) return; // daily canary probe doesn't mutate
  if (!getPat()) return; // PAT-less runs can't write anyway
  // Mirror the test-body skip: this hook recovers from a failed
  // mid-mutation in THIS run. Outside the host-loop workflow the
  // body never runs, so there's nothing to clean up — and reading +
  // writing the canary from e.g. e2e-real while host-loop is
  // mid-flight on a parallel run races the Contents API SHA and
  // returns 409. Only cleanup in the same context that owns the
  // mutation.
  if (process.env.RUN_HOST_REPO_PUBLISH_LOOP !== "1") return;
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
  if (!stillPublished) {
    console.log(
      "[cleanup-harness] unpublish-canary at baseline (published: false); UI cleanup succeeded — no safety net needed",
    );
    return;
  }
  console.warn(
    "[cleanup-harness] unpublish-canary on main is still published: true after the UI cleanup; restoring baseline via Contents API",
  );
  // Rebuild the fixture body at baseline. Mirrors the file shipped at
  // `_posts/2099-01-02-e2e-unpublish-canary.md` — keep these in sync if
  // the fixture's frontmatter changes.
  const baselineFileText = [
    "---",
    `title: "${FIXTURE_TITLE}"`,
    `slug: ${FIXTURE_SLUG}`,
    "date: 2099-01-02 00:00:00 +0000",
    'excerpt: "Fixture used by the cms-unpublish-republish spec. Never serves at a public URL until a test flips published: true; resets back to false in cleanup."',
    "tags: []",
    "featured_image: ''",
    "published: false",
    "publish_date: ''",
    "sitemap: false",
    "robots: noindex,nofollow",
    "---",
    "",
    "This post is the fixture for `e2e/cms-unpublish-republish.spec.js`.",
    "The spec toggles `published` on/off via the Decap UI and asserts",
    "the public URL goes 200 → 404 → 200 in sync.",
    "",
    "Baseline state is `published: false` so the post is never on the",
    "public site between test runs. The spec restores this state in",
    "cleanup. If you see the post at /blog/e2e-unpublish-canary/ when",
    "no test is running, the cleanup leg failed — flip",
    "`published: false` and merge the next test won't touch this file",
    "until the next dispatch.",
    "",
  ].join("\n");
  await writeFixtureOnMain({
    fileText: baselineFileText,
    message: "test(unpublish): harness safety-net reset to published: false (UI cleanup left mutation)",
  });
});
