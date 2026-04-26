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
    // Allow "Save", "Save changes", "Save & Publish", etc. — Sveltia
    // varies the toolbar label between create and edit modes.
    await page.getByRole("button", { name: /^Save/i }).first().click();

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
    // Sveltia auto-navigates after Save and may already be at the
    // edit route, in which case page.goto(samehash) is a no-op and
    // the form doesn't repaint. Force a hashchange via direct hash
    // assignment + manual event dispatch, then wait for the Name
    // sentinel to be populated with the saved value before asserting
    // anything else.
    await page.evaluate(() => {
      window.location.hash = "#/collections/tags/entries/crud-test-tag";
      window.dispatchEvent(new HashChangeEvent("hashchange", {
        oldURL: window.location.href,
        newURL: window.location.href,
      }));
    });

    const nameSentinel = page.getByRole("textbox", { name: /^Name/i });
    await expect(nameSentinel).toBeVisible({ timeout: 60_000 });
    await expect(nameSentinel).toHaveValue("CRUD Test Tag", { timeout: 30_000 });

    // Description is widget:text → <textarea>. getByLabel sometimes
    // misses Sveltia's textareas because the <label> isn't always
    // hooked up via `for=` to the textarea — the accessible name
    // comes from a wrapping element instead. getByRole('textbox')
    // queries the accessibility tree, which catches both inputs and
    // textareas reliably.
    const descFieldEdit = page.getByRole("textbox", { name: /Description/i });
    await expect(descFieldEdit).toBeVisible({ timeout: 30_000 });
    await descFieldEdit.fill("Updated description with more detail.");
    // Allow "Save", "Save changes", "Save & Publish", etc. — Sveltia
    // varies the toolbar label between create and edit modes.
    await page.getByRole("button", { name: /^Save/i }).first().click();

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
    // Sveltia's delete affordance lives behind the editor-options
    // overflow menu — its trigger has aria-label="Show Editor Options"
    // (i18n key `show_editor_options` in src/lib/locales/en.yaml).
    //
    // Sveltia re-renders the toolbar briefly after Save (saved-toast
    // animation, dirty-state recompute), and the resolved button can
    // detach from the DOM mid-click. Settle first via networkidle,
    // then dispatch the click event directly — bypasses the
    // actionability/stability churn that plain .click() retries
    // through.
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
    const menuTrigger = page.getByRole("button", { name: /Show Editor Options/i });
    await expect(menuTrigger).toBeVisible({ timeout: 30_000 });
    await menuTrigger.dispatchEvent("click");
    await page
      .getByRole("menuitem", { name: /^Delete/i })
      .click();
    // Confirmation dialog: a button labelled "Delete" inside a dialog.
    await page
      .getByRole("dialog")
      .getByRole("button", { name: /^Delete/i })
      .click();

    await expect
      .poll(() => listFixtureDir(page, "_tags"), { timeout: 30_000 })
      .not.toContain("crud-test-tag.md");
  });
});
