const { test, expect } = require("./base");
const {
  buildFixtures,
  installSveltiaStubs,
  signInLocal,
  readFixtureFile,
  listFixtureDir,
} = require("./cms-test-helpers");

// End-to-end CRUD for the Tags collection, exercised through Sveltia's
// real admin UI against the in-memory repo fixture. Single-project
// (chromium-desktop) by design — Sveltia is heavy to load and the
// assertions are about app behaviour, not browser quirks.
//
// The helper pre-seeds `closeOnSave: false` in Sveltia's prefs, so
// Save stays on the entry-edit form (matching production behaviour
// for our editors). That means after the first Save the toolbar's
// Show Editor Options menu is reachable without re-routing.

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

  test("create a new tag, then delete it", async ({ page }) => {
    await page.goto("/admin/index-local.html#/collections/tags/new");
    await signInLocal(page);

    const nameField = page.getByLabel(/^Name$/);
    await expect(nameField).toBeVisible({ timeout: 60_000 });
    await nameField.fill("CRUD Test Tag");

    await page.getByLabel(/^Description$/).fill("Original description");

    // Allow "Save", "Save changes", "Save & Publish" — Sveltia varies
    // the toolbar label across modes.
    await page.getByRole("button", { name: /^Save/i }).first().click();

    // After Save, file appears in fixture under _tags/<slug>.md.
    await expect
      .poll(() => listFixtureDir(page, "_tags"), { timeout: 30_000 })
      .toContain("crud-test-tag.md");

    const saved = await readFixtureFile(page, "_tags", "crud-test-tag.md");
    expect(saved.content).toMatch(/^---/);
    expect(saved.content).toMatch(/name:\s*['"]?CRUD Test Tag['"]?/);
    expect(saved.content).toMatch(/description:\s*['"]?Original description/);

    // With closeOnSave=false, Sveltia stays on the entry-edit form
    // and the Show Editor Options overflow is right there.
    const menuTrigger = page.getByRole("button", { name: /Show Editor Options/i });
    await expect(menuTrigger).toBeVisible({ timeout: 30_000 });
    await menuTrigger.dispatchEvent("click");

    await page.getByRole("menuitem", { name: /^Delete/i }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: /^Delete/i })
      .click();

    await expect
      .poll(() => listFixtureDir(page, "_tags"), { timeout: 30_000 })
      .not.toContain("crud-test-tag.md");
  });

  test("edit a tag's description in place", async ({ page }) => {
    await page.goto("/admin/index-local.html#/collections/tags/new");
    await signInLocal(page);

    await page.getByLabel(/^Name$/).fill("Edit Test Tag");
    await page.getByLabel(/^Description$/).fill("Original description");
    await page.getByRole("button", { name: /^Save/i }).first().click();

    await expect
      .poll(() => listFixtureDir(page, "_tags"), { timeout: 30_000 })
      .toContain("edit-test-tag.md");

    // closeOnSave=false keeps us on the entry-edit form. The
    // Description textarea is the same node we just filled — refill
    // and Save again.
    const descField = page.getByLabel(/^Description$/);
    await expect(descField).toBeVisible({ timeout: 30_000 });
    await descField.fill("Updated description with more detail.");
    await page.getByRole("button", { name: /^Save/i }).first().click();

    await expect
      .poll(
        async () => {
          const f = await readFixtureFile(page, "_tags", "edit-test-tag.md");
          return f?.content || "";
        },
        { timeout: 30_000 },
      )
      .toMatch(/Updated description with more detail/);
  });
});
