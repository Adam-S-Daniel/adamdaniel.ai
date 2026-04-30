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
    // allowed: literal slug used for known fixture (_posts/2026-04-25-replacement-test-post-1.md)
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

// Admin (Decap CMS) visual baselines were retired together with the
// cobalt-thermal theme — there is no theme to drift now, and the
// editor's WYSIWYG surface is /preview/?collection=<n> rather than
// the form itself. The data plane is still covered:
//
//   - cms-smoke.spec.js exercises load / save / delete round-trips
//     through decap-server and asserts every Posts field renders
//     with content + non-zero box + foreground/background contrast.
//   - cms-editorial-workflow.spec.js drives the editor against the
//     test-repo backend with editorial workflow on, asserts no
//     widget renders read-only, and round-trips edit → save into a
//     workflow draft.
//
// If the admin needs custom styling again in the future, restore an
// equivalent describe block here AND commit fresh baselines in
// e2e/visual-regression.spec.js-snapshots/.
