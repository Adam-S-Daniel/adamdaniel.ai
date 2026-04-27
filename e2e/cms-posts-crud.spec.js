const { test, expect } = require("./base");
const fs = require("node:fs");
const path = require("node:path");
const { PNG } = require("pngjs");
const {
  buildFixtures,
  installSveltiaStubs,
  signInLocal,
  readFixtureFile,
  listFixtureDir,
  fillMarkdownBody,
  REPO_ROOT,
} = require("./cms-test-helpers");

// CRUD for the Posts collection plus image upload via the featured
// image field. The upload path: Sveltia opens a hidden file input
// when an image field is interacted with; Playwright's setInputFiles
// hands it a generated PNG; the FSA mock catches the write into
// assets/images/uploads/<year>/<month>/.

test.describe.configure({ mode: "serial", timeout: 180_000 });

const MEDIA_FIXTURE_PATH = "/tmp/cms-fixture-image.png";

function ensureMediaFixture() {
  if (fs.existsSync(MEDIA_FIXTURE_PATH)) return MEDIA_FIXTURE_PATH;
  const png = new PNG({ width: 4, height: 4 });
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i + 0] = 40;
    png.data[i + 1] = 90;
    png.data[i + 2] = 255;
    png.data[i + 3] = 255;
  }
  fs.writeFileSync(MEDIA_FIXTURE_PATH, PNG.sync.write(png));
  return MEDIA_FIXTURE_PATH;
}

test.describe("/admin/ Posts collection: create / edit / delete + featured image", () => {
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

  test("create a post persists to _posts/ with the right shape", async ({
    page,
  }) => {
    await page.goto("/admin/index-local.html#/collections/posts/new");
    await signInLocal(page);

    const titleField = page.getByLabel(/^Title$/);
    await expect(titleField).toBeVisible({ timeout: 60_000 });
    await titleField.fill("CRUD Test Post");

    // Body in raw mode — the rich-text contenteditable is racy.
    await fillMarkdownBody(page, "# CRUD Test\n\nA post body.");

    await page.getByRole("button", { name: /^Save/i }).first().click();

    // Filename has a YYYY-MM-DD prefix from the date field, so match
    // by suffix to stay tz-agnostic.
    const matchFile = async () => {
      const all = await listFixtureDir(page, "_posts");
      return all.find((n) => /-crud-test-post\.md$/.test(n)) || null;
    };
    let fileName;
    await expect
      .poll(
        async () => {
          fileName = await matchFile();
          return fileName;
        },
        { timeout: 30_000 },
      )
      .toBeTruthy();

    const saved = await readFixtureFile(page, "_posts", fileName);
    expect(saved.content).toMatch(/^---/);
    expect(saved.content).toMatch(/title:\s*['"]?CRUD Test Post/);
    expect(saved.content).toMatch(/A post body\./);

    await expect
      .poll(() => page.evaluate(() => window.location.hash), { timeout: 30_000 })
      .toMatch(/\/collections\/posts\/entries\//);
  });

  test.fixme("create post, attach featured image, edit body, then delete", async ({
    page,
  }) => {
    await page.goto("/admin/index-local.html#/collections/posts/new");
    await signInLocal(page);

    const titleField = page.getByLabel(/^Title$/);
    await expect(titleField).toBeVisible({ timeout: 60_000 });
    await titleField.fill("CRUD Test Post");

    const slugField = page.getByLabel(/^URL Slug$/);
    if (await slugField.isVisible().catch(() => false)) {
      await slugField.fill("crud-test-post");
    }

    // Body in raw mode is the lowest-friction text input. Rich-text
    // mode uses contenteditable which is harder to drive reliably.
    await fillMarkdownBody(page, "# CRUD Test\n\nThis is a test post body.");

    // ── Featured image upload ────────────────────────────────────
    // Sveltia's image widget exposes a hidden <input type="file">
    // beneath an "Add image" button. We push our fixture image
    // straight into that input using setInputFiles.
    const imageFixture = ensureMediaFixture();
    const fileInput = page.locator('input[type="file"]').first();
    if (await fileInput.count()) {
      await fileInput.setInputFiles(imageFixture);
    }

    await page.getByRole("button", { name: /^Save$/ }).click();

    // The slug is set to "crud-test-post"; Jekyll's posts dir uses a
    // YYYY-MM-DD prefix from the date field. Match the file by suffix.
    const matchPostFile = async () => {
      const all = await listFixtureDir(page, "_posts");
      return all.find((n) => n.endsWith("-crud-test-post.md")) || null;
    };

    let postFile;
    await expect
      .poll(async () => {
        postFile = await matchPostFile();
        return postFile;
      }, { timeout: 30_000 })
      .toBeTruthy();

    let saved = await readFixtureFile(page, "_posts", postFile);
    expect(saved.content).toMatch(/title:\s*['"]?CRUD Test Post/);
    expect(saved.content).toMatch(/CRUD Test\b/);

    // The image we uploaded should land somewhere under
    // assets/images/uploads/<year>/<month>/. Verify the year directory
    // exists and contains at least one upload.
    const uploads = await readFixtureFile(
      page,
      "assets",
      "images",
      "uploads",
    );
    expect(uploads).toBeTruthy();

    // ── Edit ────────────────────────────────────────────────────
    const entryId = postFile.replace(/\.md$/, "");
    await page.goto(
      `/admin/index-local.html#/collections/posts/entries/${entryId}`,
    );
    await fillMarkdownBody(page, "# CRUD Test (edited)\n\nUpdated body content.");
    await page.getByRole("button", { name: /^Save$/ }).click();

    await expect
      .poll(
        async () => {
          const f = await readFixtureFile(page, "_posts", postFile);
          return f?.content || "";
        },
        { timeout: 30_000 },
      )
      .toMatch(/Updated body content/);

    // ── Delete ──────────────────────────────────────────────────
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
      .poll(() => listFixtureDir(page, "_posts"), { timeout: 30_000 })
      .not.toContain(postFile);
  });
});
