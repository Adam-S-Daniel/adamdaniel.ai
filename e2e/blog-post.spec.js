const { test, expect } = require("./base");

const POST_URL = "/blog/test-cms-workflow/";
const POST_TITLE = "Proin Ut Ligula Vel Nunc";

test.describe("Blog post page", () => {
  test("displays the post title exactly once", async ({ page }) => {
    await page.goto(POST_URL);

    const titleElements = page.locator("h1", { hasText: POST_TITLE });
    await expect(titleElements).toHaveCount(1);

    // No other visible element should duplicate the title text
    // (e.g. a broken <img> showing alt text).
    const visibleTitles = page.locator(
      `:visible:text-is("${POST_TITLE}"):not(title):not(meta)`,
    );
    await expect(visibleTitles).toHaveCount(1);
  });

  test("does not render a featured image when featured_image is empty", async ({
    page,
  }) => {
    await page.goto(POST_URL);

    const featuredImage = page.locator("img.featured-image");
    await expect(featuredImage).toHaveCount(0);
  });

  test("has exactly one title element in the head", async ({ page }) => {
    await page.goto(POST_URL);

    const titleCount = await page.locator("head > title").count();
    expect(titleCount).toBe(1);
  });
});
