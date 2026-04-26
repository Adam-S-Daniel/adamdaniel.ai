const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("./base");
const {
  REPO_ROOT,
  buildFixtures,
  parseFrontMatter,
  installSveltiaStubs,
  signInLocal,
} = require("./cms-test-helpers");

// Drives the real Sveltia CMS editor against the in-memory repository
// fixture from cms-test-helpers.js so we can exercise Sveltia's
// template engine — the layer the "View on Live Site" preview URL bug
// actually lives at. A pure JavaScript reproduction of the template
// logic (see e2e/cms-preview-url.spec.js) can't catch a
// Sveltia-specific quirk in how `{{fields.X}}` resolves against
// loaded entry content.

const POSTS = fs
  .readdirSync(path.join(REPO_ROOT, "_posts"))
  .filter((f) => f.endsWith(".md"))
  .map((file) => {
    const src = fs.readFileSync(path.join(REPO_ROOT, "_posts", file), "utf8");
    const fm = parseFrontMatter(src);
    return {
      file,
      entryId: file.replace(/\.md$/, ""),
      title: fm.title,
      slug: fm.slug,
    };
  })
  .filter((p) => p.slug);

/**
 * Open the admin editor for an entry and click "View on Live Site".
 * Returns the URL the button would have opened.
 */
async function captureViewOnLiveSiteURL(page, entryId, consoleLogs) {
  await page.goto(
    `/admin/index-local.html#/collections/posts/entries/${entryId}`,
  );

  await signInLocal(page);

  const viewLiveSiteBtn = page.getByRole("button", {
    name: /view on live site/i,
  });
  try {
    await expect(viewLiveSiteBtn).toBeVisible({ timeout: 60_000 });
  } catch (err) {
    console.log("=== Captured console output ===\n" + consoleLogs.join("\n"));
    throw err;
  }

  await viewLiveSiteBtn.click();

  const openedURLs = await page.evaluate(() => window.openedURLs);
  expect(openedURLs).toHaveLength(1);
  return openedURLs[0];
}

test.describe("CMS admin: View on Live Site", () => {
  test.describe.configure({ timeout: 120_000 });

  for (const { entryId, title, slug } of POSTS) {
    test(`${entryId} opens the post at /blog/${slug}/ on the CMS-configured host`, async ({
      page,
    }, testInfo) => {
      test.skip(
        testInfo.project.name !== "chromium-desktop",
        "Admin spec runs once on chromium-desktop — Sveltia is heavy to load",
      );

      const consoleLogs = [];
      page.on("console", (msg) =>
        consoleLogs.push(`[${msg.type()}] ${msg.text()}`),
      );
      page.on("pageerror", (err) =>
        consoleLogs.push(`[pageerror] ${err.name}: ${err.message}`),
      );

      await installSveltiaStubs(page, buildFixtures());

      const opened = await captureViewOnLiveSiteURL(page, entryId, consoleLogs);
      const url = new URL(opened);

      // The CMS-configured host (from admin/config-local.yml's display_url)
      // must match Jekyll's serving origin — otherwise the button navigates
      // off to a different deploy.
      expect(`${url.protocol}//${url.host}`).toBe("http://localhost:4000");

      // The CMS preview_path template must resolve to the post's actual
      // Jekyll permalink. This is the exact invariant the original bug
      // broke: Sveltia emitted /blog/<slugified-title>/ instead of
      // /blog/<fields.slug>/.
      expect(url.pathname).toBe(`/blog/${slug}/`);

      // Finally: navigating to that URL must actually load the post.
      // Catches any drift between "the CMS thinks this URL exists" and
      // "Jekyll serves it with the expected content".
      const response = await page.goto(opened);
      expect(response.status()).toBe(200);
      await expect(page.locator(".post-header h1")).toHaveText(title);
    });
  }
});
