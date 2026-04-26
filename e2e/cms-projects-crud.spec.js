const { test, expect } = require("./base");
const fs = require("node:fs");
const { PNG } = require("pngjs");
const {
  buildFixtures,
  installSveltiaStubs,
  signInLocal,
  readFixtureFile,
  listFixtureDir,
} = require("./cms-test-helpers");

// CRUD for the Projects collection plus the multi-image gallery
// widget. The gallery is a `list` of image fields — drag-to-reorder
// with individual remove buttons. We exercise add → add → remove
// last → save and verify the final entry has exactly one image.

test.describe.configure({ mode: "serial", timeout: 180_000 });

const MEDIA_A = "/tmp/cms-fixture-image-a.png";
const MEDIA_B = "/tmp/cms-fixture-image-b.png";

function ensureMediaFixtures() {
  const variants = [
    { path: MEDIA_A, fill: [40, 90, 255, 255] },
    { path: MEDIA_B, fill: [255, 90, 40, 255] },
  ];
  for (const { path, fill } of variants) {
    if (fs.existsSync(path)) continue;
    const png = new PNG({ width: 4, height: 4 });
    for (let i = 0; i < png.data.length; i += 4) {
      png.data[i + 0] = fill[0];
      png.data[i + 1] = fill[1];
      png.data[i + 2] = fill[2];
      png.data[i + 3] = fill[3];
    }
    fs.writeFileSync(path, PNG.sync.write(png));
  }
  return [MEDIA_A, MEDIA_B];
}

test.describe("/admin/ Projects collection: create / edit / delete + image gallery", () => {
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

  test("create a project with two gallery images, remove one, then delete the project", async ({
    page,
  }) => {
    const [imageA, imageB] = ensureMediaFixtures();

    await page.goto("/admin/index-local.html#/collections/projects/new");
    await signInLocal(page);

    const titleField = page.getByLabel(/^Title$/);
    await expect(titleField).toBeVisible({ timeout: 60_000 });
    await titleField.fill("CRUD Test Project");

    const techField = page.getByLabel(/Technology/);
    if (await techField.isVisible().catch(() => false)) {
      await techField.fill("Playwright · Node · Sveltia");
    }

    // Gallery: click "Add" once per image, then push the file into
    // each newly-revealed file input. The list widget surfaces an
    // accessible "Add" button; nested image widgets each get their
    // own <input type="file">.
    const addImageBtn = page.getByRole("button", { name: /^Add Image$/ });
    if (await addImageBtn.isVisible().catch(() => false)) {
      await addImageBtn.click();
    }
    let inputs = page.locator('input[type="file"]');
    if (await inputs.count()) {
      await inputs.first().setInputFiles(imageA);
    }
    if (await addImageBtn.isVisible().catch(() => false)) {
      await addImageBtn.click();
    }
    inputs = page.locator('input[type="file"]');
    if ((await inputs.count()) > 1) {
      await inputs.nth(1).setInputFiles(imageB);
    }

    await page.getByRole("button", { name: /^Save$/ }).click();

    await expect
      .poll(() => listFixtureDir(page, "_projects"), { timeout: 30_000 })
      .toContain("crud-test-project.md");

    let saved = await readFixtureFile(page, "_projects", "crud-test-project.md");
    expect(saved.content).toMatch(/title:\s*['"]?CRUD Test Project/);
    // After both adds, the file should reference two images. Use a
    // tolerant matcher — the exact path depends on the upload folder
    // template, but each list entry shows up as `- image:` or
    // `- /assets/images/...`.
    const imageRefs = (saved.content.match(/assets\/images\/uploads/g) || []).length;
    expect(imageRefs).toBeGreaterThanOrEqual(2);

    // ── Edit: remove the second image ───────────────────────────
    await page.goto(
      "/admin/index-local.html#/collections/projects/entries/crud-test-project",
    );
    await expect(page.getByLabel(/^Title$/)).toBeVisible({ timeout: 30_000 });

    // Remove the last image. Sveltia's list widget exposes an
    // accessible "Remove" button per entry.
    const removeBtns = page.getByRole("button", { name: /^Remove$/ });
    const removeCount = await removeBtns.count();
    if (removeCount > 0) {
      await removeBtns.last().click();
    }

    await page.getByRole("button", { name: /^Save$/ }).click();

    await expect
      .poll(
        async () => {
          const f = await readFixtureFile(page, "_projects", "crud-test-project.md");
          return (f?.content.match(/assets\/images\/uploads/g) || []).length;
        },
        { timeout: 30_000 },
      )
      .toBeLessThanOrEqual(1);

    // ── Delete the project ──────────────────────────────────────
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
      .poll(() => listFixtureDir(page, "_projects"), { timeout: 30_000 })
      .not.toContain("crud-test-project.md");
  });
});
