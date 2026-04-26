const { test, expect } = require("./base");
const {
  buildFixtures,
  installSveltiaStubs,
  signInLocal,
  readFixtureFile,
  listFixtureDir,
} = require("./cms-test-helpers");

// CRUD for the Pages collection — now a folder collection (was a
// fixed-files collection until we converted it), so editors can
// create new pages and delete old ones from the CMS UI without
// touching git.

test.describe.configure({ mode: "serial", timeout: 120_000 });

test.describe("/admin/ Pages collection: create / edit / delete", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.name !== "chromium-desktop",
      "Single project — Sveltia is heavy to load",
    );
    page.on("pageerror", (err) =>
      console.log(`[pageerror] ${err.name}: ${err.message}`),
    );
    await installSveltiaStubs(page, buildFixtures());
  });

  test("create a page persists to pages/ with the right shape", async ({
    page,
  }) => {
    await page.goto("/admin/index-local.html#/collections/pages/new");
    await signInLocal(page);

    const titleField = page.getByLabel(/^Title$/);
    await expect(titleField).toBeVisible({ timeout: 60_000 });
    await titleField.fill("CRUD Test Page");

    // Permalink defaults to "/pages/" — append a slug so it satisfies
    // the `^/.*/$` pattern. Editors do this by hand the same way.
    const permalinkField = page.getByLabel(/^Permalink$/);
    await permalinkField.fill("/pages/crud-test/");

    const rawTab = page.getByRole("tab", { name: /^Raw$/ });
    if (await rawTab.isVisible().catch(() => false)) await rawTab.click();
    const bodyArea = page
      .locator('textarea[name*="body"], textarea[aria-label*="Content"]')
      .first();
    await bodyArea.fill("# Hello\n\nFresh page body.");

    await page.getByRole("button", { name: /^Save/i }).first().click();

    // Slug derives from title via `slug: "{{slug}}"` → "crud-test-page".
    await expect
      .poll(() => listFixtureDir(page, "pages"), { timeout: 30_000 })
      .toContain("crud-test-page.md");

    const saved = await readFixtureFile(page, "pages", "crud-test-page.md");
    expect(saved.content).toMatch(/^---/);
    expect(saved.content).toMatch(/title:\s*['"]?CRUD Test Page/);
    expect(saved.content).toMatch(/permalink:\s*['"]?\/pages\/crud-test\//);
    expect(saved.content).toMatch(/Fresh page body/);

    await expect
      .poll(() => page.evaluate(() => window.location.hash), { timeout: 30_000 })
      .toMatch(/\/collections\/pages\/entries\/crud-test-page/);
  });

  test.fixme("create a new page, edit body, then delete", async ({ page }) => {
    await page.goto("/admin/index-local.html#/collections/pages/new");
    await signInLocal(page);

    const titleField = page.getByLabel(/^Title$/);
    await expect(titleField).toBeVisible({ timeout: 60_000 });
    await titleField.fill("CRUD Test Page");

    // Permalink defaults to "/pages/" — append the slug so it's a valid
    // path. Editors do this by hand the same way.
    const permalinkField = page.getByLabel(/^Permalink$/);
    await permalinkField.fill("/pages/crud-test/");

    // Body in raw mode (more reliable than the rich-text contenteditable).
    const rawTab = page.getByRole("tab", { name: /^Raw$/ });
    if (await rawTab.isVisible().catch(() => false)) await rawTab.click();
    const bodyArea = page.locator('textarea[name*="body"], textarea[aria-label*="Content"]').first();
    await bodyArea.fill("# Hello\n\nFresh page body.");

    await page.getByRole("button", { name: /^Save$/ }).click();

    await expect
      .poll(() => listFixtureDir(page, "pages"), { timeout: 30_000 })
      .toContain("crud-test.md");

    let saved = await readFixtureFile(page, "pages", "crud-test.md");
    expect(saved.content).toMatch(/title:\s*['"]?CRUD Test Page/);
    expect(saved.content).toMatch(/permalink:\s*['"]?\/pages\/crud-test\//);
    expect(saved.content).toContain("Fresh page body");

    // ── Edit ────────────────────────────────────────────────────────
    await page.goto(
      "/admin/index-local.html#/collections/pages/entries/crud-test",
    );
    const titleEdit = page.getByLabel(/^Title$/);
    await expect(titleEdit).toBeVisible({ timeout: 30_000 });
    await titleEdit.fill("CRUD Test Page (renamed)");
    await page.getByRole("button", { name: /^Save$/ }).click();

    await expect
      .poll(
        async () => {
          const f = await readFixtureFile(page, "pages", "crud-test.md");
          return f?.content || "";
        },
        { timeout: 30_000 },
      )
      .toMatch(/CRUD Test Page \(renamed\)/);

    // ── Delete ──────────────────────────────────────────────────────
    const deleteBtn = page.getByRole("button", { name: /^Delete$/ });
    if (await deleteBtn.isVisible().catch(() => false)) {
      await deleteBtn.click();
    } else {
      await page
        .getByRole("button", { name: /More actions|Show more/ })
        .click();
      await page.getByRole("menuitem", { name: /Delete/ }).click();
    }
    await page
      .getByRole("dialog")
      .getByRole("button", { name: /^Delete$/ })
      .click();

    await expect
      .poll(() => listFixtureDir(page, "pages"), { timeout: 30_000 })
      .not.toContain("crud-test.md");
  });
});
