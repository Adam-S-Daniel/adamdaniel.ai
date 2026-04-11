const { test, expect } = require("./base");

test.describe("Blog post page", () => {
  test("displays the post title exactly once", async ({ page }) => {
    await page.goto("/blog/test-abc/");

    // The title should appear once in an h1
    const titleElements = page.locator("h1", { hasText: "Test abc" });
    await expect(titleElements).toHaveCount(1);

    // No other visible element should duplicate the title text
    // (e.g. a broken <img> showing alt text "Test abc")
    const visibleTitles = page.locator(
      ':visible:text-is("Test abc"):not(title):not(meta)'
    );
    await expect(visibleTitles).toHaveCount(1);
  });

  test("does not render a featured image when featured_image is empty", async ({
    page,
  }) => {
    await page.goto("/blog/test-abc/");

    const featuredImage = page.locator("img.featured-image");
    await expect(featuredImage).toHaveCount(0);
  });

  test("has exactly one title element in the head", async ({ page }) => {
    await page.goto("/blog/test-abc/");

    const titleCount = await page.locator("head > title").count();
    expect(titleCount).toBe(1);
  });
});
