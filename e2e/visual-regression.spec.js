const { test, expect } = require("./base");

// Freeze all CSS animations for deterministic screenshots.
const FREEZE_ANIMATIONS = `
  *, *::before, *::after {
    animation-play-state: paused !important;
    animation-delay: -4s !important;
    transition-duration: 0s !important;
  }
`;

test.describe("Visual regression", () => {
  test.beforeEach(async ({ page }) => {
    await page.addStyleTag({ content: FREEZE_ANIMATIONS });
  });

  test("homepage", async ({ page }) => {
    await page.goto("/");
    await page.addStyleTag({ content: FREEZE_ANIMATIONS });
    await page.waitForTimeout(200);
    await expect(page).toHaveScreenshot("homepage.png");
  });

  test("blog post", async ({ page }) => {
    await page.goto("/blog/replacement-test-post-1/");
    await page.addStyleTag({ content: FREEZE_ANIMATIONS });
    await page.waitForTimeout(200);
    await expect(page).toHaveScreenshot("blog-post.png");
  });

  test("tags index", async ({ page }) => {
    await page.goto("/tags/");
    await page.addStyleTag({ content: FREEZE_ANIMATIONS });
    await page.waitForTimeout(200);
    await expect(page).toHaveScreenshot("tags-index.png");
  });

  test("tag archive", async ({ page }) => {
    await page.goto("/tags/python/");
    await page.addStyleTag({ content: FREEZE_ANIMATIONS });
    await page.waitForTimeout(200);
    await expect(page).toHaveScreenshot("tag-archive.png");
  });
});

// ── Admin (Decap CMS) screens ──────────────────────────────────────────────
//
// These are gated to chromium-desktop. Decap's editor DOM is the same across
// viewports — what we're guarding against is the cobalt-thermal theme
// drifting when Decap CMS bumps a major version and rewires its className
// scheme (the "fields are styled invisible" failure mode that almost slipped
// through review). One reference screenshot per surface is enough; the cost
// of running across 8 projects per surface is not justified by the coverage
// it'd add.
//
// Boots through admin/index-local.html so decap-server (already started by
// playwright.config.js's webServer array) handles the local backend without
// needing GitHub OAuth. The smoke spec covers the data plane (save / delete
// round-trips through to disk); these tests cover the visual plane.
test.describe("Visual regression — admin", () => {
  // Admin baselines run on chromium-desktop AND webkit-tablet. WebKit is
  // the closest analogue Playwright provides to iOS Safari, where users
  // have reported the Decap edit form rendering blank below the toolbar.
  // Chromium-desktop is the editor's canonical desktop view. The other 6
  // projects in the matrix (laptop / mobile / forced-colors / firefox)
  // would just burn cycles on baselines that say the same thing as
  // chromium-desktop.
  const ADMIN_VR_PROJECTS = new Set(["chromium-desktop", "webkit-tablet"]);

  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(
      !ADMIN_VR_PROJECTS.has(testInfo.project.name),
      "Admin visual baselines run on chromium-desktop and webkit-tablet only.",
    );
    await page.addStyleTag({ content: FREEZE_ANIMATIONS });
  });

  // The admin pages overlay a #cms-loading splash that fades out via a
  // MutationObserver once Decap mounts. Wait for that overlay to detach
  // before any screenshot — otherwise the splash bleeds into the baseline.
  async function waitForAdminBoot(page) {
    await page.locator("#cms-loading").waitFor({
      state: "detached",
      timeout: 60_000,
    });
  }

  // Wait for Decap to be fully booted on the collections page. Polls for
  // the collection sidebar links rather than a fixed sleep so the snapshot
  // is taken at a stable moment.
  async function loginAndWaitForCollections(page) {
    await page.goto("/admin/index-local.html");
    await waitForAdminBoot(page);
    await page.getByRole("button", { name: /login/i }).click({ timeout: 60_000 });
    await page.getByRole("link", { name: /^posts$/i }).waitFor({ timeout: 60_000 });
    // Belt-and-braces: let the cobalt-thermal radial-glow keyframe settle.
    await page.addStyleTag({ content: FREEZE_ANIMATIONS });
    await page.waitForTimeout(500);
  }

  test("admin login screen", async ({ page }) => {
    await page.goto("/admin/index-local.html");
    await waitForAdminBoot(page);
    // Wait for the Login button to render — that's the cue Decap has
    // booted and the cobalt theme is fully painted.
    await page.getByRole("button", { name: /login/i }).waitFor({ timeout: 60_000 });
    await page.addStyleTag({ content: FREEZE_ANIMATIONS });
    await page.waitForTimeout(500);
    await expect(page).toHaveScreenshot("admin-login.png");
  });

  test("admin posts collection list", async ({ page }) => {
    await loginAndWaitForCollections(page);
    await page.getByRole("link", { name: /^posts$/i }).click();
    // Wait for at least one entry row to be present.
    await page
      .locator('a[href*="#/collections/posts/entries/"]')
      .first()
      .waitFor({ timeout: 30_000 });
    await page.addStyleTag({ content: FREEZE_ANIMATIONS });
    await page.waitForTimeout(500);
    await expect(page).toHaveScreenshot("admin-posts-list.png");
  });

  test("admin new post editor", async ({ page }) => {
    await loginAndWaitForCollections(page);
    await page.goto("/admin/index-local.html#/collections/posts/new");
    // Title field is the canary — once it's visible the form is rendered.
    await page.getByLabel(/^Title$/).waitFor({ timeout: 60_000 });
    await page.addStyleTag({ content: FREEZE_ANIMATIONS });
    await page.waitForTimeout(500);
    await expect(page).toHaveScreenshot("admin-new-post.png");
  });

  test("admin reviews dashboard (unauthenticated)", async ({ page }) => {
    // /admin/reviews/ is the visual-regression review dashboard. We
    // capture it in its logged-out state — that's the surface most
    // editors see day-to-day before they click Sign in with GitHub,
    // and it doesn't require the OAuth proxy to be reachable from CI.
    // Stub localStorage to force the unauthenticated branch even if a
    // dev's browser persisted a token from a prior session.
    await page.addInitScript(() => {
      try {
        localStorage.removeItem("gh_reviews_token");
      } catch (_) {}
    });
    await page.goto("/admin/reviews/");
    await page
      .getByRole("button", { name: /sign in with github/i })
      .waitFor({ timeout: 30_000 });
    await page.addStyleTag({ content: FREEZE_ANIMATIONS });
    await page.waitForTimeout(500);
    await expect(page).toHaveScreenshot("admin-reviews-dashboard.png");
  });
});
