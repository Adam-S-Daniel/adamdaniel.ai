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

  // Baselines for firefox-desktop and webkit-tablet need to be generated
  // from a host with those browsers available — the dev sandbox these
  // were authored in only has chromium. Skip until a maintainer runs
  // `--update-snapshots` on a fully-equipped runner.
  const NEW_TAG_BASELINE_PROJECTS = (testInfo) =>
    !["firefox-desktop", "webkit-tablet"].includes(testInfo.project.name);

  test("tags index", async ({ page }, testInfo) => {
    test.skip(
      !NEW_TAG_BASELINE_PROJECTS(testInfo),
      "missing baseline for this project (regenerate via --update-snapshots)",
    );
    await page.goto("/tags/");
    await page.addStyleTag({ content: FREEZE_ANIMATIONS });
    await page.waitForTimeout(200);
    await expect(page).toHaveScreenshot("tags-index.png");
  });

  test("tag archive", async ({ page }, testInfo) => {
    test.skip(
      !NEW_TAG_BASELINE_PROJECTS(testInfo),
      "missing baseline for this project (regenerate via --update-snapshots)",
    );
    await page.goto("/tags/python/");
    await page.addStyleTag({ content: FREEZE_ANIMATIONS });
    await page.waitForTimeout(200);
    await expect(page).toHaveScreenshot("tag-archive.png");
  });
});
