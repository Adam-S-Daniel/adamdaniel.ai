const { test, expect } = require("./base");

// Acceptance for issue #27 — make tags functional end-to-end.
//
// Backed by content fixtures in _tags/ and _posts/:
//   _tags/best-practices.md  → name "Best Practices"
//   _tags/python.md          → name "Python"
//   _tags/rag.md             → name "RAG"
//   _tags/langchain.md       → name "LangChain"
//   posts have tags: ["AI Engineering", "RAG", "Python"], ["Best Practices"], etc.
//   "AI Engineering" has no _tags/ entry — exercised by the auto-page generator.

test.describe("Tags index page", () => {
  test("/tags/ exists and lists every tag from _tags/", async ({ page }) => {
    const response = await page.goto("/tags/");
    expect(response.status()).toBe(200);

    await expect(
      page.locator(".page-header h1", { hasText: /^Tags$/i }),
    ).toBeVisible();

    const list = page.locator(".tag-list");
    await expect(list).toBeVisible();

    // Every curated tag appears as a link to its archive page.
    for (const { name, slug } of [
      { name: "Best Practices", slug: "best-practices" },
      { name: "Python", slug: "python" },
      { name: "RAG", slug: "rag" },
      { name: "LangChain", slug: "langchain" },
    ]) {
      const link = list.locator(`a[href$="/tags/${slug}/"]`);
      await expect(link).toBeVisible();
      await expect(link).toHaveText(new RegExp(name));
    }
  });

  test("/tags/ surfaces tags that posts use even without a _tags/ file", async ({
    page,
  }) => {
    await page.goto("/tags/");
    // "AI Engineering" is referenced by a post but has no _tags/ai-engineering.md
    const link = page.locator('.tag-list a[href$="/tags/ai-engineering/"]');
    await expect(link).toBeVisible();
    await expect(link).toContainText(/AI Engineering/);
  });
});

test.describe("Tag archive pages", () => {
  test("/tags/python/ lists posts tagged Python", async ({ page }) => {
    const response = await page.goto("/tags/python/");
    expect(response.status()).toBe(200);

    await expect(page.locator(".page-header h1")).toHaveText("Python");

    const tagged = page.locator(".post-list .post-title a", {
      hasText: /Suspendisse Potenti/,
    });
    await expect(tagged).toHaveCount(1);
  });

  test("/tags/best-practices/ uses the Name field for matching, not the slug", async ({
    page,
  }) => {
    await page.goto("/tags/best-practices/");
    await expect(page.locator(".page-header h1")).toHaveText("Best Practices");

    const tagged = page.locator(".post-list .post-title a");
    await expect(tagged).toHaveCount(1);
    await expect(tagged).toHaveText(/Proin Ut Ligula/);
  });

  test("/tags/ai-engineering/ resolves for a tag with no _tags/ file", async ({
    page,
  }) => {
    const response = await page.goto("/tags/ai-engineering/");
    expect(response.status()).toBe(200);
    await expect(page.locator(".page-header h1")).toHaveText("AI Engineering");
    const tagged = page.locator(".post-list .post-item");
    await expect(tagged.first()).toBeVisible();
  });
});

test.describe("Homepage tag cloud", () => {
  test("landing page shows a tag list at the bottom", async ({ page }) => {
    await page.goto("/");

    const section = page.locator(".tag-cloud-section");
    await expect(section).toBeVisible();

    // Section links to the tags index.
    await expect(section.locator('a[href$="/tags/"]')).toBeVisible();

    // Every curated tag appears as a pill in the cloud linking to its archive.
    const cloud = section.locator(".tag-cloud");
    await expect(cloud).toBeVisible();
    for (const slug of ["python", "rag", "langchain", "best-practices"]) {
      await expect(
        cloud.locator(`a[href$="/tags/${slug}/"]`),
      ).toBeVisible();
    }
  });
});
