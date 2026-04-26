const { test, expect } = require("./base");
const {
  buildFixtures,
  installSveltiaStubs,
  signInLocal,
  readFixtureFile,
  listFixtureDir,
  getCmsState,
  waitForToolbarButton,
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

  // Edit and Delete navigate **directly** to an existing entry's
  // edit URL rather than going through Create → Save first. The
  // toolbar's Duplicate / Delete buttons are gated on
  // `!isNew && !disabled && !collectionFile && !isSmallScreen`
  // (toolbar.svelte:109). Loading a pre-seeded entry guarantees
  // `isNew=false` from the first render — no race against
  // Sveltia's post-save createDraft swap. The repo ships with
  // `_tags/best-practices.md` etc., so we can use those.

  test("edit an existing tag's description in place", async ({ page }) => {
    await page.goto(
      "/admin/index-local.html#/collections/tags/entries/best-practices",
    );
    await signInLocal(page);

    const description = page.getByLabel(/^Description$/);
    await expect(description).toBeVisible({ timeout: 60_000 });
    await description.fill("Edited via CRUD spec.");

    await page.getByRole("button", { name: /^Save/i }).first().click();

    await expect
      .poll(
        async () =>
          (await readFixtureFile(page, "_tags", "best-practices.md"))
            ?.content || "",
        { timeout: 30_000 },
      )
      .toMatch(/Edited via CRUD spec\./);
  });

  test("delete an existing tag from the toolbar", async ({ page }) => {
    await page.goto(
      "/admin/index-local.html#/collections/tags/entries/best-practices",
    );
    await signInLocal(page);

    // Wait for the editor form to render — proves the entry loaded.
    await expect(page.getByLabel(/^Name$/)).toBeVisible({ timeout: 60_000 });

    // The Delete affordance ships under different labels depending
    // on Sveltia's i18n bundle (`Delete entry` vs `Delete`). Poll
    // the toolbar until *some* delete-ish button is visible — and
    // capture the full inspector state if it never shows up so the
    // test report explains which gating condition is sticking.
    let deleteBtn;
    try {
      deleteBtn = await waitForToolbarButton(page, /^delete/i, {
        timeout: 30_000,
      });
    } catch (err) {
      // Fall back to the "More actions" overflow menu if the
      // top-level button never rendered.
      const moreBtn = page.getByRole("button", {
        name: /More actions|Show Editor Options|Show more/i,
      });
      if (await moreBtn.isVisible().catch(() => false)) {
        await moreBtn.click();
        const item = page.getByRole("menuitem", { name: /^Delete/i });
        await item.click();
      } else {
        throw err;
      }
    }

    if (deleteBtn) {
      const re = new RegExp(deleteBtn.ariaLabel || deleteBtn.name, "i");
      await page
        .getByRole("button", { name: re })
        .first()
        .click();
    }

    // Confirm dialog.
    await page
      .getByRole("dialog")
      .getByRole("button", { name: /^Delete$/i })
      .click();

    await expect
      .poll(() => listFixtureDir(page, "_tags"), { timeout: 30_000 })
      .not.toContain("best-practices.md");
  });

  test("__cmsInspect probe reports viewport, matchMedia, and toolbar buttons", async ({
    page,
  }) => {
    await page.goto(
      "/admin/index-local.html#/collections/tags/entries/best-practices",
    );
    await signInLocal(page);
    await expect(page.getByLabel(/^Name$/)).toBeVisible({ timeout: 60_000 });

    const state = await getCmsState(page);
    expect(state.viewport.width).toBeGreaterThan(0);
    expect(typeof state.matchMedia.smallScreen).toBe("boolean");
    expect(state.url).toMatch(/best-practices/);
    expect(Array.isArray(state.toolbarButtons)).toBe(true);
  });
});
