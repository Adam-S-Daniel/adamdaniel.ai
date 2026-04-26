const { test, expect } = require("./base");
const {
  buildFixtures,
  installSveltiaStubs,
  signInLocal,
  readFixtureFile,
  listFixtureDir,
} = require("./cms-test-helpers");

// End-to-end CRUD for the Tags collection, exercised through Sveltia's
// real admin UI against the in-memory repo fixture. The point is to
// catch regressions in the editor experience that an editor without
// GitHub CLI access would hit — including Save / Delete flows that
// only run on a write-capable backend.
//
// Single-project (chromium-desktop) by design: the Sveltia bundle is
// heavy to load and the assertions are about app behaviour, not
// browser quirks. The visual matrix is covered elsewhere.

test.describe.configure({ mode: "serial", timeout: 120_000 });

test.describe("/admin/ Tags collection: create / edit / delete", () => {
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

  test("create a new tag, edit its description, then delete it", async ({
    page,
  }) => {
    // ── Create ─────────────────────────────────────────────────────
    await page.goto("/admin/index-local.html#/collections/tags/new");
    await signInLocal(page);

    // Title field for tags is "Name". Wait for the form to be ready by
    // looking for the field's label.
    const nameField = page.getByLabel(/^Name$/);
    await expect(nameField).toBeVisible({ timeout: 60_000 });
    await nameField.fill("CRUD Test Tag");

    const descField = page.getByLabel(/^Description$/);
    await descField.fill("Original description");

    // Sveltia's toolbar button accessible name is "Save".
    await page.getByRole("button", { name: /^Save$/ }).click();

    // After save, the new tag should appear in the fixture tree as
    // _tags/<slug>.md. Slug template in config is {{slug}} which
    // Sveltia derives from the identifier_field (`name`).
    await expect
      .poll(() => listFixtureDir(page, "_tags"), { timeout: 30_000 })
      .toContain("crud-test-tag.md");

    let saved = await readFixtureFile(page, "_tags", "crud-test-tag.md");
    expect(saved.content).toMatch(/^---/);
    expect(saved.content).toMatch(/name:\s*['"]?CRUD Test Tag['"]?/);
    expect(saved.content).toMatch(/description:\s*['"]?Original description/);

    // ── Edit ───────────────────────────────────────────────────────
    await page.goto(
      "/admin/index-local.html#/collections/tags/entries/crud-test-tag",
    );
    const descFieldEdit = page.getByLabel(/^Description$/);
    await expect(descFieldEdit).toBeVisible({ timeout: 30_000 });
    await descFieldEdit.fill("Updated description with more detail.");
    await page.getByRole("button", { name: /^Save$/ }).click();

    await expect
      .poll(
        async () => {
          const f = await readFixtureFile(page, "_tags", "crud-test-tag.md");
          return f?.content || "";
        },
        { timeout: 30_000 },
      )
      .toMatch(/Updated description with more detail/);

    saved = await readFixtureFile(page, "_tags", "crud-test-tag.md");
    expect(saved.content).not.toMatch(/Original description/);

    // ── Delete ─────────────────────────────────────────────────────
    // Sveltia's delete affordance lives behind a "More actions" /
    // overflow menu on the entry toolbar. Try the explicit Delete
    // button first; fall back to opening the overflow.
    const deleteBtn = page.getByRole("button", { name: /^Delete$/ });
    if (await deleteBtn.isVisible().catch(() => false)) {
      await deleteBtn.click();
    } else {
      await page
        .getByRole("button", { name: /More actions|Show more/ })
        .click();
      await page.getByRole("menuitem", { name: /Delete/ }).click();
    }
    // Confirmation dialog: a button labelled "Delete" inside a dialog.
    await page
      .getByRole("dialog")
      .getByRole("button", { name: /^Delete$/ })
      .click();

    await expect
      .poll(() => listFixtureDir(page, "_tags"), { timeout: 30_000 })
      .not.toContain("crud-test-tag.md");
  });
});
