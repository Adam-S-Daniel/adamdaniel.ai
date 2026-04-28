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

    // ── Save (writes the file via decap-server's local_fs proxy in
    // simple mode — local_backend can't run editorial_workflow). ──────
    //
    // Decap's primary action button changes label between simple and
    // editorial-workflow modes ("Publish" vs "Save"). Use Ctrl+S, which
    // Decap binds in both modes via its keyboard shortcut hook (the
    // PRESERVE editor in `decap-cms-editor-component-...`).
    await page.keyboard.press("Control+s");

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
});
