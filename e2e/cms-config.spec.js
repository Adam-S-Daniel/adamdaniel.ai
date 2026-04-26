const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("./base");

// Locks in the editor-experience invariants of the Sveltia CMS configs.
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

test.describe("Sveltia CMS config invariants", () => {
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
      // The relation widget (Decap/Sveltia) only picks from existing entries
      // — inline creation requires switching to a list-of-strings widget.
      // The auto_tag_pages plugin generates archive pages for any string tag,
      // so we don't need a curated `_tags/` entry up front.
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
});
