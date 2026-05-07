// @lane: real — drives the real Decap CMS Posts collection on prod
// @select-skip-when-head-ref-prefix: cms/
//
// Self-skips when CMS_E2E_PAT or RUN_HOST_REPO_PUBLISH_LOOP is unset, so
// the spec only fires from the dedicated cms-publish-loop-host workflow.
//
// On `cms/*` PRs (Decap-opened editorial PRs) this spec self-skips at
// runtime — RUN_HOST_REPO_PUBLISH_LOOP is unset on the standard PR
// matrix.

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
const { fetchPublicUrl } = require("./github-actions-poll");
const { waitForChangeReflected, PILL_PROD } = require("./deploy-pill");

const PROD_HOST = "https://adamdaniel.ai";
const PROD_ADMIN = `${PROD_HOST}/admin/`;
const FIXTURE_PATH = "_posts/2099-01-02-e2e-unpublish-canary.md";
const FIXTURE_TITLE = "E2E Unpublish Canary";
const FIXTURE_SLUG = "e2e-unpublish-canary";
const PUBLIC_URL = `${PROD_HOST}/blog/${FIXTURE_SLUG}/`;

// Two full publish chains run serially:
//   - chain 1: publish (URL 4xx → 200)
//   - chain 2: unpublish (URL 200 → 4xx)
// Each is roughly the same shape as cms-publish-loop's mutation
// (validate-content + auto-merge + deploy-production). Allow ~30 min
// total with margin so a stuck pipeline fails the spec rather than
// pegging the runner. Retries disabled — real-state mutation.
const TEST_TIMEOUT_MS = 30 * 60 * 1000;

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

test("CMS unpublish + re-publish — flip published flag toggles URL visibility", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium-desktop",
    "Real-network test — runs once on chromium-desktop only.",
  );
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
    await page.goto(
      `${PROD_ADMIN}#/collections/posts/entries/2099-01-02-${FIXTURE_SLUG}`,
      { waitUntil: "domcontentloaded" },
    );
    await expect(page.getByRole("textbox", { name: /^Title$/i })).toBeVisible({
      timeout: 30_000,
    });
  });

  await test.step("Verify the editor reads Published toggle as OFF (baseline)", async () => {
    // The Published toggle is a checkbox/switch in the entry form;
    // its accessible name in Decap 3.x is "Published". When the
    // entry's frontmatter says `published: false`, the toggle is
    // unchecked.
    const toggle = page.getByRole("checkbox", { name: /^Published$/i });
    await expect(toggle, "Published toggle should be visible").toBeVisible({
      timeout: 30_000,
    });
    await expect(
      toggle,
      "Published toggle should reflect baseline (unchecked)",
    ).not.toBeChecked();
  });

  // ── 2. Re-publish leg: toggle ON, Save, drive workflow → URL 200 ──
  await test.step("Toggle Published → ON via UI", async () => {
    const toggle = page.getByRole("checkbox", { name: /^Published$/i });
    await toggle.check();
    await expect(toggle).toBeChecked();
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
      urlTimeoutMs: 12 * 60 * 1000,
    });
  });

  // ── 3. Unpublish leg: toggle OFF, Save, drive workflow → URL 404 ──
  await test.step("Toggle Published → OFF via UI", async () => {
    const toggle = page.getByRole("checkbox", { name: /^Published$/i });
    await toggle.uncheck();
    await expect(toggle).not.toBeChecked();
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
      urlTimeoutMs: 12 * 60 * 1000,
    });
  });
});
