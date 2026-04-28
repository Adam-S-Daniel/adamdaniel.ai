const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { test, expect } = require("./base");

// True end-to-end content loop: drive the live Decap admin to create a new
// post, rebuild the site, then GET /blog/<slug>/ and assert the post is
// actually published. cms-smoke.spec.js covers the CMS → disk half; this
// one closes the loop disk → Jekyll → CloudFront-shaped URL → rendered HTML.
//
// What this catches that the other specs don't:
//   - YAML front-matter format drift (Decap writes a shape Jekyll can't parse)
//   - Permalink template drift (file lands at the wrong URL)
//   - Layout breakage that only manifests with Decap-shaped front matter
//   - The publish_mode / local_backend interaction making Save look like
//     it worked but never producing a deployable file
//
// Implementation notes:
//   - Local backend forces simple mode regardless of `publish_mode:
//     editorial_workflow`, so Save → file lands directly in _posts/ with
//     no PR. That's exactly what we need for a synchronous test.
//   - We rebuild Jekyll in-process after save. The playwright.config.js
//     webServer pre-builds once at startup; without an explicit rebuild
//     here the new file isn't on disk in `_site/`.
//   - The serve package re-stats files per request, so a post-startup
//     rebuild is picked up without restarting the webServer.
//   - The post is cleaned up in afterAll regardless of pass/fail —
//     leaving cruft in `_posts/` would pollute the live site.

const REPO_ROOT = path.join(__dirname, "..");
const POSTS_DIR = path.join(REPO_ROOT, "_posts");

const SMOKE_TITLE = "E2E Publish Flow Smoke";
const SMOKE_SLUG = "e2e-publish-flow-smoke";
const SMOKE_BODY = "This post was created by the cms-publish-flow e2e spec. Safe to delete.";

function findSmokePostFile() {
  if (!fs.existsSync(POSTS_DIR)) return null;
  const match = fs
    .readdirSync(POSTS_DIR)
    .find((f) => f.endsWith(`-${SMOKE_SLUG}.md`));
  return match ? path.join(POSTS_DIR, match) : null;
}

function removeSmokePost() {
  const f = findSmokePostFile();
  if (f) fs.unlinkSync(f);
  // Also clear the rendered output from `_site/`. The webServer serves
  // `_site/` directly, so leaving an orphan here would make the smoke
  // post reachable at /blog/<slug>/ after the test ran. The next jekyll
  // build would normally wipe it, but the playwright webServer only
  // builds once at startup.
  const renderedDir = path.join(REPO_ROOT, "_site", "blog", SMOKE_SLUG);
  if (fs.existsSync(renderedDir)) fs.rmSync(renderedDir, { recursive: true, force: true });
}

function jekyllBuild() {
  // Quiet build into the same `_site/` the playwright webServer is
  // serving from, so the new post becomes reachable at /blog/<slug>/
  // without needing to restart `npx serve`.
  execFileSync("bundle", ["exec", "jekyll", "build", "--quiet"], {
    cwd: REPO_ROOT,
    stdio: "inherit",
  });
}

test.describe("CMS publish flow: create → build → browse to live URL", () => {
  test.describe.configure({ mode: "serial", timeout: 240_000 });

  test.beforeAll(() => {
    removeSmokePost();
  });
  test.afterAll(() => {
    removeSmokePost();
  });

  test.beforeEach(({ page }, testInfo) => {
    test.skip(
      testInfo.project.name !== "chromium-desktop",
      "Single project — Jekyll rebuild is too expensive for the full matrix.",
    );
    page.on("pageerror", (err) =>
      console.log(`[pageerror] ${err.name}: ${err.message}`),
    );
  });

  test("create a post in Decap, rebuild, and assert /blog/<slug>/ renders it", async ({
    page,
  }) => {
    // ── Drive the admin: open New Post, fill Title + Body, publish ────
    await page.goto("/admin/index-local.html");
    await page.getByRole("button", { name: /login/i }).click();
    await page.getByRole("link", { name: /^posts$/i }).waitFor({ timeout: 30_000 });
    await page.goto("/admin/index-local.html#/collections/posts/new");

    const titleField = page.getByLabel(/^Title$/);
    await expect(titleField).toBeVisible({ timeout: 60_000 });
    await titleField.fill(SMOKE_TITLE);

    // The slug field auto-derives from title; explicitly set it so the
    // post lands at a predictable URL even if the slugify algorithm
    // changes between Decap versions.
    const slugField = page.getByLabel(/^URL Slug/);
    await slugField.fill(SMOKE_SLUG);

    // Decap's markdown widget defaults to rich-text mode. The
    // contentEditable surface accepts plain typed text, which is good
    // enough for asserting the post renders end-to-end.
    const bodyEditor = page
      .locator('[role="textbox"][contenteditable="true"]')
      .last();
    await bodyEditor.waitFor({ timeout: 30_000 });
    await bodyEditor.click();
    await bodyEditor.fill(SMOKE_BODY);

    // Flip Published on so this post is part of `site.posts` immediately.
    // (Default in the schema is OFF, which would route the post into the
    // scheduled-publish bucket and skip Jekyll's _posts/ rendering for the
    // immediate build.)
    const publishedToggle = page.getByLabel(/^Published$/).first();
    await publishedToggle.click();

    // Decap's split publish button: open menu, pick "Publish now".
    await page.getByRole("button", { name: /^publish$/i }).first().click();
    await page
      .getByRole("menuitem", { name: /publish now/i })
      .first()
      .click();

    // ── Wait for the file to land in _posts/ ──────────────────────────
    await expect
      .poll(() => findSmokePostFile() !== null, { timeout: 60_000 })
      .toBe(true);
    const postPath = findSmokePostFile();
    const written = fs.readFileSync(postPath, "utf8");
    expect(written).toMatch(/^---/);
    expect(written).toContain(`title: ${SMOKE_TITLE}`);
    expect(written).toContain(`slug: ${SMOKE_SLUG}`);
    expect(written).toContain("published: true");

    // ── Rebuild Jekyll so /blog/<slug>/ is in `_site/` ────────────────
    jekyllBuild();

    // ── Browse to the live URL, assert the post renders ──────────────
    const liveURL = `/blog/${SMOKE_SLUG}/`;
    const response = await page.goto(liveURL);
    expect(response.status(), `${liveURL} should be 200`).toBe(200);

    await expect(page.locator(".post-header h1")).toHaveText(SMOKE_TITLE);
    await expect(page.locator(".post-content")).toContainText(SMOKE_BODY);
  });
});
