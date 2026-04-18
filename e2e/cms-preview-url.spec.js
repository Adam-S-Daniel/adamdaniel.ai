const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("./base");

const REPO_ROOT = path.join(__dirname, "..");
const POSTS_DIR = path.join(REPO_ROOT, "_posts");

// The CMS computes the "View on Live Site" URL from this template. Both admin
// configs must keep it in sync with Jekyll's `permalink: /blog/:slug/` — if it
// drifts (e.g. includes the date prefix), the button 404s. The field is named
// `permalink_slug` (not `slug`) to dodge a Sveltia/Decap collision where a
// field literally named `slug` is shadowed by the built-in `{{slug}}` tag.
//
// Note on coverage: this spec verifies the URL the *template would produce*
// is actually reachable in Jekyll, but it reproduces the slugify logic in
// JavaScript rather than executing Sveltia's template engine. So template-
// engine quirks (e.g. the `{{fields.slug}}` shadowing collision that
// motivated `_plugins/permalink_slug.rb`) won't show up here. Sveltia is a
// browser-only SPA that uses the File System Access API for its local
// backend (showDirectoryPicker requires a user gesture and isn't currently
// automatable from Playwright — see microsoft/playwright#18267), so live
// admin coverage stays a manual smoke test against `preview.adamdaniel.ai`.
const POSTS_PREVIEW_PATH =
  `preview_path: "/blog/{{fields.slug | default('{{fields.title}}') | slugify}}/"`;

function slugify(s) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function parseFrontMatter(filepath) {
  const src = fs.readFileSync(filepath, "utf8");
  const match = src.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;
  const fm = {};
  for (const line of match[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/);
    if (!kv) continue;
    let value = kv[2].trim();
    value = value.replace(/^["'](.*)["']$/, "$1");
    fm[kv[1]] = value;
  }
  return fm;
}

const publishedPosts = fs
  .readdirSync(POSTS_DIR)
  .filter((f) => f.endsWith(".md"))
  .map((file) => ({ file, fm: parseFrontMatter(path.join(POSTS_DIR, file)) }))
  .filter(({ fm }) => fm && fm.published === "true");

test.describe("CMS preview URL round-trip", () => {
  test("admin/config.yml and admin/config-local.yml share the Posts preview_path", () => {
    const remote = fs.readFileSync(
      path.join(REPO_ROOT, "admin/config.yml"),
      "utf8",
    );
    const local = fs.readFileSync(
      path.join(REPO_ROOT, "admin/config-local.yml"),
      "utf8",
    );
    expect(remote).toContain(POSTS_PREVIEW_PATH);
    expect(local).toContain(POSTS_PREVIEW_PATH);
  });

  for (const { file, fm } of publishedPosts) {
    const previewSlug = slugify(fm.slug || fm.title);
    test(`${file} is served at the preview URL /blog/${previewSlug}/`, async ({
      page,
    }) => {
      const response = await page.goto(`/blog/${previewSlug}/`);
      expect(response.status()).toBe(200);
      await expect(page.locator(".post-header h1")).toHaveText(fm.title);
    });
  }
});
