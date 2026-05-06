// @lane: local — exercises the locally-rendered tag pages; @parity-eligible via TARGET=
const { test, expect } = require("./base");

// Acceptance for issue #27 — make tags functional end-to-end.
//
// Tests are deliberately content-agnostic: they verify the *structure*
// of the tag system (index, archive pages, homepage cloud, empty-state
// placeholder) without depending on which posts or in-post tags exist
// at the time the suite runs. The auto-generator's data-shaping is
// covered exhaustively by Ruby unit tests in
// `_plugins_test/auto_tag_pages_test.rb`.
//
// Anchored to the curated entries in `_tags/`:
//   _tags/best-practices.md, _tags/python.md, _tags/rag.md, _tags/langchain.md
// Each must show on `/tags/` and resolve to a working `/tags/<slug>/` archive.

const CURATED_TAGS = [
  { name: "Best Practices", slug: "best-practices" },
  { name: "Python", slug: "python" },
  { name: "RAG", slug: "rag" },
  { name: "LangChain", slug: "langchain" },
];

test.describe("Tags index page", () => {
  test("/tags/ exists and lists every curated tag", async ({ page }) => {
    const response = await page.goto("/tags/");
    expect(response.status()).toBe(200);

    await expect(
      page.locator(".page-header h1", { hasText: /^Tags$/i }),
    ).toBeVisible();

    const list = page.locator(".tag-list");
    await expect(list).toBeVisible();

    for (const { name, slug } of CURATED_TAGS) {
      const link = list.locator(`a[href$="/tags/${slug}/"]`);
      await expect(link).toBeVisible();
      await expect(link).toHaveText(new RegExp(name));
    }
  });
});

test.describe("Tag archive pages", () => {
  for (const { name, slug } of CURATED_TAGS) {
    test(`/tags/${slug}/ resolves and renders the right header`, async ({
      page,
    }) => {
      const response = await page.goto(`/tags/${slug}/`);
      expect(response.status()).toBe(200);
      await expect(page.locator(".page-header h1")).toHaveText(name);
    });
  }

  test("a tag with no matching posts shows the empty-state placeholder", async ({
    page,
  }) => {
    // Find a curated tag that no current post references — its archive
    // page should render the "No posts yet with this tag" message rather
    // than a broken empty list. Pick whichever curated tag scores zero so
    // the test stays valid as content evolves.
    let zeroCountSlug = null;
    await page.goto("/tags/");
    for (const { slug } of CURATED_TAGS) {
      const card = page.locator(
        `.tag-list-item:has(a[href$="/tags/${slug}/"])`,
      );
      const countText = (
        await card.locator(".tag-list-count").innerText()
      ).trim();
      if (countText === "0") {
        zeroCountSlug = slug;
        break;
      }
    }
    test.skip(
      zeroCountSlug === null,
      "every curated tag is referenced by at least one post",
    );

    await page.goto(`/tags/${zeroCountSlug}/`);
    await expect(page.locator("text=/no posts yet/i")).toBeVisible();
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
    for (const { slug } of CURATED_TAGS) {
      await expect(cloud.locator(`a[href$="/tags/${slug}/"]`)).toBeVisible();
    }
  });
});
