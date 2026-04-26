const { test, expect } = require("./base");
const {
  buildFixtures,
  installSveltiaStubs,
  signInLocal,
  readFixtureFile,
  listFixtureDir,
} = require("./cms-test-helpers");

// End-to-end coverage for the Tags collection in Sveltia's local-
// repository mode. The `closeOnSave: false` pre-seed (cms-test-
// helpers.js) keeps the editor on the saved entry's edit form so
// post-save lookups don't race a route-back-to-list.
//
// Single-project (chromium-desktop) by design — Sveltia is heavy
// and the assertions are about app behaviour, not browser quirks.

test.describe.configure({ mode: "serial", timeout: 120_000 });

test.describe("/admin/ Tags collection", () => {
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

  test("create a new tag persists to the repo with the right shape", async ({
    page,
  }) => {
    await page.goto("/admin/index-local.html#/collections/tags/new");
    await signInLocal(page);

    const nameField = page.getByLabel(/^Name$/);
    await expect(nameField).toBeVisible({ timeout: 60_000 });
    await nameField.fill("CRUD Test Tag");

    await page.getByLabel(/^Description$/).fill("Original description");

    // Sveltia varies the toolbar Save label between "Save", "Save
    // changes", "Save & Publish" depending on mode and config.
    await page.getByRole("button", { name: /^Save/i }).first().click();

    await expect
      .poll(() => listFixtureDir(page, "_tags"), { timeout: 30_000 })
      .toContain("crud-test-tag.md");

    const saved = await readFixtureFile(page, "_tags", "crud-test-tag.md");
    expect(saved.content).toMatch(/^---/);
    expect(saved.content).toMatch(/name:\s*['"]?CRUD Test Tag['"]?/);
    expect(saved.content).toMatch(/description:\s*['"]?Original description/);

    // After Save with closeOnSave=false, Sveltia auto-routes to the
    // entry-edit URL. Verify the URL settled — proves the post-save
    // reset (createDraft with originalEntry=savedEntry) ran.
    await expect
      .poll(() => page.evaluate(() => window.location.hash), {
        timeout: 30_000,
      })
      .toMatch(/\/collections\/tags\/entries\/crud-test-tag/);
  });

  // Edit-in-place and Delete-via-toolbar are both racy in the FSA
  // mock environment — the toolbar's Duplicate / Delete buttons are
  // gated on `!isNew && !disabled && !collectionFile && !isSmallScreen`
  // (toolbar.svelte:109), and one of those conditions consistently
  // holds back the render in our test fixtures even though the
  // production UI surfaces the affordances correctly. Keeping these
  // declared (so the structure of intended coverage is visible)
  // but fixme'd until we can introspect Sveltia's store state from
  // the page to figure out which condition is blocking.
  test.fixme("edit a tag's description in place", async ({ page }) => {
    await page.goto("/admin/index-local.html#/collections/tags/new");
    await signInLocal(page);
    await page.getByLabel(/^Name$/).fill("Edit Test Tag");
    await page.getByLabel(/^Description$/).fill("Original description");
    await page.getByRole("button", { name: /^Save/i }).first().click();
    await expect
      .poll(() => listFixtureDir(page, "_tags"), { timeout: 30_000 })
      .toContain("edit-test-tag.md");
    await page.getByLabel(/^Description$/).fill("Updated description.");
    await page.getByRole("button", { name: /^Save/i }).first().click();
    await expect
      .poll(
        async () => (await readFixtureFile(page, "_tags", "edit-test-tag.md"))?.content || "",
        { timeout: 30_000 },
      )
      .toMatch(/Updated description/);
  });

  test.fixme("delete a tag from the toolbar", async ({ page }) => {
    await page.goto("/admin/index-local.html#/collections/tags/new");
    await signInLocal(page);
    await page.getByLabel(/^Name$/).fill("Delete Test Tag");
    await page.getByLabel(/^Description$/).fill("To be removed");
    await page.getByRole("button", { name: /^Save/i }).first().click();
    await expect
      .poll(() => listFixtureDir(page, "_tags"), { timeout: 30_000 })
      .toContain("delete-test-tag.md");
    await page.getByRole("button", { name: /Delete Entry/i }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: /^Delete$/i })
      .click();
    await expect
      .poll(() => listFixtureDir(page, "_tags"), { timeout: 30_000 })
      .not.toContain("delete-test-tag.md");
  });
});
