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
    await page.goto("/blog/test-abc/");
    await page.addStyleTag({ content: FREEZE_ANIMATIONS });
    await page.waitForTimeout(200);
    await expect(page).toHaveScreenshot("blog-post.png");
  });
});
