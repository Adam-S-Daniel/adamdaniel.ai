const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("./base");

// End-to-end smoke test for the Decap CMS bundle wired up against a
// real `local_backend: true` (decap-server proxy on port 8081, started
// by playwright.config.js's webServer). Drives the admin UI through
// the load → login → create → save → delete cycle on the simplest
// collection (Tags) and verifies each step against the on-disk repo.
//
// Why Tags: no date prefix on the slug, two-field schema (name +
// description), no image widgets — so the spec stays focused on the
// CMS plumbing rather than widget details. Posts / Projects / Pages
// share the same Decap save / delete code path; if Tags works, they
// work.

const REPO_ROOT = path.join(__dirname, "..");
const TAGS_DIR = path.join(REPO_ROOT, "_tags");
const SMOKE_TAG_NAME = "Decap Smoke Test";
const SMOKE_TAG_SLUG = "decap-smoke-test";
const SMOKE_TAG_FILE = path.join(TAGS_DIR, `${SMOKE_TAG_SLUG}.md`);

function removeSmokeTagFile() {
  if (fs.existsSync(SMOKE_TAG_FILE)) fs.unlinkSync(SMOKE_TAG_FILE);
}

test.describe("/admin/ Decap CMS smoke test", () => {
  // The local backend mutates the working tree. Run on a single project
  // and serially to avoid two browsers racing to write/delete the same
  // file at the same time.
  test.describe.configure({ mode: "serial", timeout: 180_000 });

  test.beforeAll(() => {
    removeSmokeTagFile();
  });
  test.afterAll(() => {
    removeSmokeTagFile();
  });

  test.beforeEach(({ page }, testInfo) => {
    test.skip(
      testInfo.project.name !== "chromium-desktop",
      "Single project — Decap is heavy to load and the local backend isn't safe to drive in parallel.",
    );
    page.on("pageerror", (err) =>
      console.log(`[pageerror] ${err.name}: ${err.message}`),
    );
    page.on("console", (msg) => {
      if (msg.type() === "error") console.log(`[console.error] ${msg.text()}`);
    });
  });

  test("admin loads, logs in, creates a tag, saves it, deletes it", async ({
    page,
  }) => {
    // ── Load the admin shell ──────────────────────────────────────────
    await page.goto("/admin/index-local.html");

    // Decap renders a "Login" button when local_backend is enabled.
    // The button text in 3.x is "Login" (no provider name, since
    // local_backend bypasses OAuth).
    const loginBtn = page.getByRole("button", { name: /login/i });
    await expect(loginBtn).toBeVisible({ timeout: 60_000 });
    await loginBtn.click();

    // ── Land on the collections page ──────────────────────────────────
    await expect(page.getByRole("link", { name: /^posts$/i })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByRole("link", { name: /^tags$/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /^projects$/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /^pages$/i })).toBeVisible();

    // ── Open the Tags collection and start a new entry ───────────────
    await page.getByRole("link", { name: /^tags$/i }).click();
    await page
      .getByRole("link", { name: /new tag|new entry/i })
      .first()
      .click();

    // Decap renders fields with their `label` as the accessible name.
    // We only fill the Name field — Description is `required: false` and
    // its label-to-textarea wiring varies enough across Decap versions to
    // be a flake source. Verifying that Name persists is enough to prove
    // the save / delete code path works.
    const nameField = page.getByLabel(/^Name$/);
    await expect(nameField).toBeVisible({ timeout: 30_000 });
    await nameField.fill(SMOKE_TAG_NAME);

    // ── Save (writes the file via decap-server's local_fs proxy;
    // local_backend forces simple mode regardless of publish_mode). ───
    //
    // Decap's primary action in simple mode is a split button:
    //   [ Publish ▼ ]
    // where the dropdown holds "Publish now" / "Publish and create new".
    // Clicking the main Publish trigger opens the menu, then we pick
    // Publish now to actually commit the entry.
    await page.getByRole("button", { name: /^publish$/i }).first().click();
    await page
      .getByRole("menuitem", { name: /publish now/i })
      .first()
      .click();

    // The file should land in _tags/<slug>.md within a few seconds.
    await expect
      .poll(() => fs.existsSync(SMOKE_TAG_FILE), { timeout: 60_000 })
      .toBe(true);

    const saved = fs.readFileSync(SMOKE_TAG_FILE, "utf8");
    expect(saved).toContain(`name: ${SMOKE_TAG_NAME}`);

    // ── Delete the entry through the editor ──────────────────────────
    // After Save, Decap routes from `#/collections/tags/new` to
    // `#/collections/tags/entries/<slug>` and reveals the Delete button
    // in the toolbar.
    const deleteBtn = page
      .getByRole("button", { name: /^delete (entry|published entry)$/i })
      .first();
    await expect(deleteBtn).toBeVisible({ timeout: 30_000 });

    // Auto-accept any browser-level confirm() Decap pops before deletion.
    page.on("dialog", (d) => d.accept());
    await deleteBtn.click();

    // Some Decap versions render an in-DOM confirm rather than a
    // browser dialog — handle that path too.
    const inDomConfirm = page.getByRole("button", {
      name: /^(confirm|delete|yes)$/i,
    });
    if (await inDomConfirm.isVisible({ timeout: 1000 }).catch(() => false)) {
      await inDomConfirm.click();
    }

    await expect
      .poll(() => fs.existsSync(SMOKE_TAG_FILE), { timeout: 30_000 })
      .toBe(false);
  });

  // Defence-in-depth against the failure mode that almost slipped through:
  // Decap renders the toolbar but the form body is empty / styled to zero
  // visibility. The Tags spec above only fills one field on the simplest
  // collection — it can't catch a Posts schema regression. Open a Posts
  // entry and assert every declared field's input is actually rendered with
  // a non-zero box AND a measurable contrast against its background.
  test("Posts edit form: every declared field renders with visible content", async ({
    page,
  }) => {
    await page.goto("/admin/index-local.html");
    await page.getByRole("button", { name: /login/i }).click();
    await page.getByRole("link", { name: /^posts$/i }).waitFor({ timeout: 30_000 });
    await page.getByRole("link", { name: /^posts$/i }).click();

    const firstEntry = page.locator('a[href*="#/collections/posts/entries/"]').first();
    await firstEntry.waitFor({ timeout: 30_000 });
    await firstEntry.click();

    // Wait for the canary field. If Decap fails to mount the form
    // (e.g. the theme makes everything invisible, or className-based
    // selectors break after a major-version bump), Title doesn't render
    // and the test fails loudly.
    const titleField = page.getByLabel(/^Title$/);
    await expect(titleField).toBeVisible({ timeout: 60_000 });

    // Every declared label from the Posts schema in admin/config.yml
    // should appear in the rendered form. Decap doesn't always wire
    // <label for> to inputs (image widget, list widget, markdown editor
    // are unlabelled inputs with a sibling heading), so we check for the
    // label *text* rather than label-input association — same coverage
    // for the "form is empty" failure mode without false negatives on
    // widgets that don't expose accessible names.
    for (const labelText of [
      "Title",
      "URL Slug",
      "Date",
      "Excerpt",
      "Tags",
      "Featured Image",
      "Published",
      "Publish Date",
      "Body",
    ]) {
      const labelLocator = page
        .locator("label, h3, h4, legend")
        .filter({ hasText: new RegExp(`^\\s*${labelText}(\\s|\\(|$)`, "i") })
        .first();
      await expect(
        labelLocator,
        `Label for "${labelText}" should be visible in the editor`,
      ).toBeVisible({ timeout: 5_000 });
    }

    // Form has more than just the Title input — guards against the
    // "Title rendered but everything else missing" failure mode. The
    // Posts schema declares title, slug, date, excerpt, tags, published,
    // publish_date as input/textarea-flavoured fields — at least 4 of
    // these should be on the page even after Decap's hidden-checkbox
    // and shadow-tree quirks.
    const inputCount = await page.locator("input:visible, textarea:visible").count();
    expect(
      inputCount,
      "Posts edit form should have several input/textarea fields",
    ).toBeGreaterThanOrEqual(4);

    // Contrast check: Title input must have a different `color` than its
    // `background-color`. Catches the "fields rendered but text colour
    // matches background" theme regression — fast and language-agnostic.
    const colors = await titleField.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { color: cs.color, bg: cs.backgroundColor };
    });
    expect(colors.color, "Title input color must differ from background").not.toBe(
      colors.bg,
    );

    // ── Read-only / disabled regression guard ─────────────────────────
    // Decap renders a per-field disabled state by inlining
    // `pointer-events: none; opacity: 0.5` on every widget wrapper
    // (see decap-cms-core's EditorControl.js styleStrings.disabled).
    // If the form looks fine but every field opens read-only — the
    // exact mode of the admin/#/collections/posts/entries/<slug> bug
    // — the existing label / contrast checks above would still pass.
    // This explicitly fails the test in that scenario.
    await expect(titleField).toBeEnabled();
    const widgetReport = await page.evaluate(() => {
      const wrappers = Array.from(
        document.querySelectorAll('[class*="ControlContainer"]'),
      );
      return wrappers.map((el) => {
        const cs = getComputedStyle(el);
        const labelEl = el.querySelector("label, h3, h4, legend");
        return {
          label: labelEl ? labelEl.textContent.trim() : "(unknown)",
          pointerEvents: cs.pointerEvents,
          opacity: parseFloat(cs.opacity),
        };
      });
    });
    for (const w of widgetReport) {
      expect(
        w.pointerEvents,
        `Widget "${w.label}" must accept pointer events (got ${w.pointerEvents}); Decap's per-field disabled style is the only thing that injects pointer-events: none.`,
      ).not.toBe("none");
      expect(
        w.opacity,
        `Widget "${w.label}" must render opaque (got ${w.opacity}); Decap's disabled style halves opacity.`,
      ).toBeGreaterThan(0.6);
    }
  });
});
