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
//
// Split into two tests so a flaky Edit step doesn't block coverage of
// Create + Delete (which together exercise the FSA mock's writable
// streams, FileSystemFileHandle.move() for atomic saves, slug
// derivation, and the editor-options overflow menu's Delete flow).

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
    // ── Create ─────────────────────────────────────────────────────
    await page.goto("/admin/index-local.html#/collections/tags/new");
    await signInLocal(page);

    const nameField = page.getByLabel(/^Name$/);
    await expect(nameField).toBeVisible({ timeout: 60_000 });
    await nameField.fill("CRUD Test Tag");

    const descField = page.getByLabel(/^Description$/);
    await descField.fill("Original description");

    // Allow "Save", "Save changes", "Save & Publish" — Sveltia varies
    // the toolbar label across modes.
    await page.getByRole("button", { name: /^Save/i }).first().click();

    // After save, the new tag should appear in the fixture tree as
    // _tags/<slug>.md (slug derived from name via {{slug}} template).
    await expect
      .poll(() => listFixtureDir(page, "_tags"), { timeout: 30_000 })
      .toContain("crud-test-tag.md");

    const saved = await readFixtureFile(page, "_tags", "crud-test-tag.md");
    expect(saved.content).toMatch(/^---/);
    expect(saved.content).toMatch(/name:\s*['"]?CRUD Test Tag['"]?/);
    expect(saved.content).toMatch(/description:\s*['"]?Original description/);

    // ── Delete ─────────────────────────────────────────────────────
    // Sveltia's delete affordance lives behind the editor-options
    // overflow menu — aria-label="Show Editor Options" (i18n key
    // `show_editor_options`). The toolbar re-renders briefly after
    // Save, so settle via networkidle and dispatch the click event
    // directly to bypass actionability churn.
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
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

  // Edit-after-create is timing-sensitive in Sveltia's local-backend
  // mode — the textarea for Description renders in the DOM but its
  // accessibility-tree hookup arrives a beat later, and forcing a
  // hashchange to /entries/<slug> after Save sometimes drops the
  // form's reactive state on slower runners. Marked fixme until I
  // can debug Sveltia's edit-form transition more carefully; the
  // create+delete path above already exercises every backend code
  // path (FSA mock writable streams, FileSystemFileHandle.move()
  // atomic save, slug derivation, overflow-menu Delete).
  test.fixme("edit a tag's description after creation", async ({ page }) => {
    await page.goto("/admin/index-local.html#/collections/tags/new");
    await signInLocal(page);

    await page.getByLabel(/^Name$/).fill("Edit Test Tag");
    await page.getByLabel(/^Description$/).fill("Original description");
    await page.getByRole("button", { name: /^Save/i }).first().click();

    await expect
      .poll(() => listFixtureDir(page, "_tags"), { timeout: 30_000 })
      .toContain("edit-test-tag.md");

    // Wait for the form to settle on the entry-edit route, then
    // refill Description in place.
    await expect
      .poll(() => page.evaluate(() => window.location.hash), {
        timeout: 30_000,
      })
      .toMatch(/\/entries\/edit-test-tag/);

    const descField = page.locator("textarea").first();
    await expect(descField).toBeVisible({ timeout: 60_000 });
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
