const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("./base");

// Locks in the editor-experience invariants of the Decap CMS configs.
// These properties together close the gaps documented in the content-workflow
// review: drafts go through PRs (not straight to main), the auto-overwritten
// reading_time field doesn't waste editor time, the precedence between
// `published` and `publish_date` is explicit, the real-layout preview URL is
// discoverable from the editor, tags can be created inline, and uploaded
// images are bucketed by date so the media library stays browsable.

const REPO_ROOT = path.join(__dirname, "..");
const CONFIGS = [
  path.join(REPO_ROOT, "admin/config.yml"),
  path.join(REPO_ROOT, "admin/config-local.yml"),
  // config-test.yml is the editorial-workflow + test-repo backend
  // entrypoint that cms-editorial-workflow.spec.js drives. Its
  // collection schema must mirror production so the spec catches
  // real production-shape regressions.
  path.join(REPO_ROOT, "admin/config-test.yml"),
];

function readConfig(file) {
  return fs.readFileSync(file, "utf8");
}

function findCollection(yml, name) {
  // Crude but sufficient: split on collection separators (`  - name:` lines
  // at indent 2) and pick the chunk whose first key matches `name`.
  const lines = yml.split(/\r?\n/);
  const starts = [];
  lines.forEach((line, idx) => {
    if (/^\s{2}-\s+name:\s*\S+/.test(line)) starts.push(idx);
  });
  starts.push(lines.length);
  for (let i = 0; i < starts.length - 1; i++) {
    const chunk = lines.slice(starts[i], starts[i + 1]).join("\n");
    const m = chunk.match(/^\s{2}-\s+name:\s*(\S+)/);
    if (m && m[1] === name) return chunk;
  }
  return null;
}

function findField(collectionChunk, fieldName) {
  // Field rows look like `      - name: foo` at indent 6.
  const lines = collectionChunk.split(/\r?\n/);
  const starts = [];
  lines.forEach((line, idx) => {
    if (/^\s{6}-\s+name:\s*\S+/.test(line)) starts.push(idx);
  });
  starts.push(lines.length);
  for (let i = 0; i < starts.length - 1; i++) {
    const chunk = lines.slice(starts[i], starts[i + 1]).join("\n");
    const m = chunk.match(/^\s{6}-\s+name:\s*(\S+)/);
    if (m && m[1] === fieldName) return chunk;
  }
  return null;
}

test.describe("Decap CMS config invariants", () => {
  test.describe.configure({ mode: "serial" });

  for (const configPath of CONFIGS) {
    const label = path.relative(REPO_ROOT, configPath);

    test(`${label}: media_folder is bucketed by year/month`, () => {
      const yml = readConfig(configPath);
      const m = yml.match(/^media_folder:\s*(.+)$/m);
      expect(m, "media_folder must be set").not.toBeNull();
      expect(m[1]).toContain("{{year}}");
      expect(m[1]).toContain("{{month}}");
    });

    test(`${label}: posts collection has no editor-facing reading_time field`, () => {
      const yml = readConfig(configPath);
      const posts = findCollection(yml, "posts");
      expect(posts, "posts collection must exist").not.toBeNull();
      // reading_time is auto-calculated at build time; surfacing it in the
      // editor is misleading because any value is overwritten on deploy.
      expect(findField(posts, "reading_time")).toBeNull();
    });

    test(`${label}: posts.tags widget allows inline creation`, () => {
      const yml = readConfig(configPath);
      const posts = findCollection(yml, "posts");
      const tags = findField(posts, "tags");
      expect(tags, "posts.tags field must exist").not.toBeNull();
      // Decap's relation widget only picks from existing entries —
      // inline creation requires the list-of-strings widget. The
      // auto_tag_pages plugin generates archive pages for any string
      // tag, so we don't need a curated `_tags/` entry up front.
      expect(tags).toMatch(/widget:\s*list/);
      expect(tags).not.toMatch(/widget:\s*relation/);
    });

    test(`${label}: posts.published hint clarifies precedence over publish_date`, () => {
      const yml = readConfig(configPath);
      const posts = findCollection(yml, "posts");
      const published = findField(posts, "published");
      expect(published, "posts.published field must exist").not.toBeNull();
      // Editors must be able to predict which field wins — the hint should
      // call out that `published: true` publishes immediately and that the
      // scheduled date only fires when this toggle is left off.
      expect(published.toLowerCase()).toMatch(/leave.*off|off.*to schedule/);
    });

    test(`${label}: posts.body hint surfaces the real-layout /preview/ URL`, () => {
      const yml = readConfig(configPath);
      const posts = findCollection(yml, "posts");
      const body = findField(posts, "body");
      expect(body, "posts.body field must exist").not.toBeNull();
      // The /preview/ route renders draft content using the real Jekyll
      // layouts — strictly better than the in-editor markdown preview, but
      // there's no in-CMS UI for it, so it has to live in the hint text.
      expect(body).toContain("/preview/?collection=posts");
    });
  }

  test("admin/config.yml enables the editorial workflow", () => {
    const yml = readConfig(path.join(REPO_ROOT, "admin/config.yml"));
    // Without this, every Save commits straight to main and bypasses the
    // PR-based draft → preview → visual-regression-approval pipeline that
    // the rest of the system (cms-editorial-workflow.yml, the cms/draft
    // and cms/ready labels, /admin/reviews/) is built around.
    expect(yml).toMatch(/^publish_mode:\s*editorial_workflow\b/m);
  });

  test("admin/config-test.yml uses test-repo backend with editorial workflow", () => {
    const yml = readConfig(path.join(REPO_ROOT, "admin/config-test.yml"));
    // The whole point of this config is to exercise the editorial
    // workflow + GitHub-style backend code path that local_backend
    // forces off. If either of these regresses, cms-editorial-workflow.spec.js
    // reverts to testing nothing meaningfully different from cms-smoke.
    expect(yml).toMatch(/^\s+name:\s*test-repo\b/m);
    expect(yml).toMatch(/^publish_mode:\s*editorial_workflow\b/m);
  });

  // ── Editor capability invariants ─────────────────────────────────────
  //
  // These lock in *what an editor can do* per collection — create new
  // entries, delete existing ones, attach images, etc. If a future
  // config edit removes a capability by accident, these tests fail fast.

  for (const configPath of CONFIGS) {
    const label = path.relative(REPO_ROOT, configPath);

    test(`${label}: each content collection allows create + delete`, () => {
      const yml = readConfig(configPath);
      // Tags / Posts / Projects / Pages must all be folder collections
      // with create + delete explicitly true so editors get the full
      // CRUD affordances in the Decap UI. Spelling them out keeps the
      // intent visible in the YAML — defaults can shift between major
      // versions.
      for (const name of ["posts", "tags", "projects", "pages"]) {
        const chunk = findCollection(yml, name);
        expect(chunk, `${name} collection must exist`).not.toBeNull();
        expect(chunk).toMatch(/^\s{4}folder:\s*\S+/m);
        expect(chunk).toMatch(/^\s{4}create:\s*true/m);
        expect(chunk).toMatch(/^\s{4}delete:\s*true/m);
      }
    });

    test(`${label}: posts collection exposes title, date, body, tags, featured_image`, () => {
      const yml = readConfig(configPath);
      const posts = findCollection(yml, "posts");
      for (const f of ["title", "date", "body", "tags", "featured_image", "published"]) {
        expect(findField(posts, f), `posts.${f} field must exist`).not.toBeNull();
      }
      const featured = findField(posts, "featured_image");
      expect(featured).toMatch(/widget:\s*image/);
    });

    test(`${label}: projects collection exposes a multi-image gallery`, () => {
      const yml = readConfig(configPath);
      const projects = findCollection(yml, "projects");
      const images = findField(projects, "images");
      expect(images, "projects.images field must exist").not.toBeNull();
      // List widget with a nested image field — the standard Decap
      // recipe for "an ordered, repeatable image gallery" (drag-to-
      // reorder, individual remove).
      expect(images).toMatch(/widget:\s*list/);
      expect(images).toMatch(/widget:\s*image/);
    });

    test(`${label}: tags collection exposes name + description`, () => {
      const yml = readConfig(configPath);
      const tags = findCollection(yml, "tags");
      expect(findField(tags, "name"), "tags.name must exist").not.toBeNull();
      expect(findField(tags, "description"), "tags.description must exist").not.toBeNull();
    });

    test(`${label}: pages collection exposes title, body, permalink, published`, () => {
      const yml = readConfig(configPath);
      const pages = findCollection(yml, "pages");
      for (const f of ["title", "body", "permalink", "published"]) {
        expect(findField(pages, f), `pages.${f} must exist`).not.toBeNull();
      }
      // Permalink is now a string (editor-visible) rather than hidden,
      // since editors creating new pages need to set it.
      const permalink = findField(pages, "permalink");
      expect(permalink).toMatch(/widget:\s*string/);
    });
  }
});
