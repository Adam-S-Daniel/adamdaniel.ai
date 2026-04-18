const { test, expect } = require("./base");

// Loads the actual Sveltia CMS in the browser against the local decap-server
// backend, opens an existing post, and asserts that the "View on Live Site"
// menu item resolves the post's real Jekyll permalink — not a slugified title.
//
// This is the layer the slug → URL bug actually lives at: a JavaScript
// reproduction of the preview_path template (see e2e/cms-preview-url.spec.js)
// would not catch a Sveltia template-engine quirk like the `{{fields.slug}}`
// shadowing collision that motivated _plugins/permalink_slug.rb.

test.describe("CMS admin: View on Live Site", () => {
  test("link uses the post's permalink, not the slugified title", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "chromium-desktop",
      "Admin spec runs once on chromium-desktop — Sveltia is heavy to load",
    );

    // The menu item calls window.open() instead of using a real <a href>, so
    // we capture the URL by stubbing window.open before the page loads.
    await page.addInitScript(() => {
      window.openedURLs = [];
      window.open = (url) => {
        window.openedURLs.push(String(url));
        return null;
      };
    });

    // index-local.html points Sveltia at admin/config-local.yml, which has
    // local_backend: true → talks to decap-server (started by playwright.config.js).
    await page.goto(
      "/admin/index-local.html#/collections/posts/entries/2025-03-01-structured-outputs-are-a-superpower",
    );

    // Local backend may surface a "Work with Local Repository" / "Login" gate
    // before opening the editor. Click it if present.
    const loginButton = page.getByRole("button", {
      name: /work with local repository|login|sign in/i,
    });
    if (
      await loginButton
        .first()
        .isVisible({ timeout: 5_000 })
        .catch(() => false)
    ) {
      await loginButton.first().click();
    }

    // Sveltia is an async SPA — wait for the renamed slug field to appear as
    // a signal that the entry editor has fully hydrated.
    await expect(page.getByLabel(/url slug/i)).toBeVisible({ timeout: 60_000 });

    // The View on Live Site item lives under the per-locale content-options
    // menu. Open it, then click the item.
    await page
      .getByRole("button", { name: /content options/i })
      .first()
      .click();
    await page
      .getByRole("menuitem", { name: /view on live site/i })
      .click();

    const openedURLs = await page.evaluate(() => window.openedURLs);
    expect(openedURLs).toHaveLength(1);

    const opened = openedURLs[0];
    expect(opened).toContain("/blog/structured-outputs-are-a-superpower/");
    // Guard against the original bug: the slugified title leaking through.
    expect(opened).not.toContain("pellentesque-habitant-morbi-tristique");
  });
});
