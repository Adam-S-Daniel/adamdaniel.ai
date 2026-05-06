// @lane: local — cross-checks Decap config + Jekyll permalink output via local fs
const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("./base");

// E2 — Permalink contract cross-check.
//
// Decap CMS's "View on Live Site" toolbar substitutes `{{slug}}` into the
// collection's `preview_path` and opens the result. Jekyll renders each entry
// at its `permalink:` template (`_config.yml`).
//
// The subtle thing: for collections that ship a `slug:` template (Posts use
// `"{{year}}-{{month}}-{{day}}-{{slug}}"` so Jekyll's `_posts/` folder
// receives the date-prefixed filename it requires), Decap runs a TWO-PASS
// expansion. First the `slug:` template fills in `{{slug}}` from the entry's
// fields → produces the file slug, e.g. `2026-01-15-foo`. Then `preview_path`
// fills in its own `{{slug}}` from THAT result, NOT from the field slug. So
// `preview_path: "/blog/{{slug}}/"` becomes `/blog/2026-01-15-foo/` — but
// Jekyll's `permalink: /blog/:slug/` strips the date prefix and renders at
// `/blog/foo/`. The toolbar 404s.
//
// The earlier round-trip block at e2e/cms-config.spec.js:280-304 substituted
// the same fixture string into BOTH templates and asserted equality, which
// passed tautologically. This spec models the actual two-pass expansion
// Decap performs and asserts the contract that EITHER:
//
//   (a) the templates round-trip — Decap's preview URL equals Jekyll's URL
//       for the same field slug;
//   (b) an authoritative JS override exists at admin/native-preview-href.js
//       AND is loaded by all three index files (admin/index.html,
//       admin/index-local.html, admin/index-test.html). When the JS runs in
//       the browser, it rewrites the toolbar anchor's href via a
//       MutationObserver, so the static template divergence is fixed at
//       runtime.
//
// In current state: posts diverge AND override script exists → posts pass via
// the override fallback. Tags / projects / pages / e2e templates round-trip
// → pass directly.
//
// Pure-Node spec — no browser, no servers, just file I/O and string parse.

const REPO_ROOT = path.join(__dirname, "..");
const ADMIN_CONFIG = path.join(REPO_ROOT, "admin/config.yml");
const JEKYLL_CONFIG = path.join(REPO_ROOT, "_config.yml");
const NATIVE_PREVIEW_OVERRIDE = path.join(
  REPO_ROOT,
  "admin/native-preview-href.js",
);
const INDEX_FILES = [
  path.join(REPO_ROOT, "admin/index.html"),
  path.join(REPO_ROOT, "admin/index-local.html"),
  path.join(REPO_ROOT, "admin/index-test.html"),
];

// Synthetic entry — kept simple so the substitution math is obvious. The
// date must have two-digit month/day so the date_format pads correctly.
const SYNTHETIC = { slug: "foo", date: "2026-01-15" };

function readText(file) {
  return fs.readFileSync(file, "utf8");
}

// Find a top-level collection chunk in admin/config.yml. The chunk runs from
// `  - name: <coll>` to the next collection start (or EOF).
function findCollection(yml, name) {
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

// Pull a single top-level key (e.g. `slug:` / `preview_path:`) out of a
// collection chunk. Strips quoting if present.
function readKey(chunk, key) {
  const re = new RegExp(`^\\s{4}${key}:\\s*['"]?([^'"\\n]+?)['"]?\\s*$`, "m");
  const m = chunk.match(re);
  return m ? m[1] : null;
}

// Pull the per-collection permalink from _config.yml. Top-level posts live at
// the document root; collection-typed entries live under
// `collections.<name>.permalink`.
function jekyllPermalinkFor(jekyllYml, collection) {
  if (collection === "posts") {
    const m = jekyllYml.match(/^permalink:\s*(\S+)\s*$/m);
    return m ? m[1] : null;
  }
  // Match `<name>:` block at indent 2 inside `collections:` and pull the
  // `permalink:` line within it.
  const re = new RegExp(
    `^\\s{2}${collection}:\\s*$([\\s\\S]*?)(?=^\\S|^\\s{2}\\S)`,
    "m",
  );
  const block = jekyllYml.match(re);
  if (!block) return null;
  const m = block[1].match(/^\s+permalink:\s*(\S+)\s*$/m);
  return m ? m[1] : null;
}

// Substitute `{{year}}`, `{{month}}`, `{{day}}`, `{{slug}}` from the synthetic
// entry. Mirrors what Decap does when expanding the `slug:` template. The
// values are zero-padded to match Decap's `date_format: YYYY-MM-DD`.
function expandSlugTemplate(template, entry) {
  const [year, month, day] = entry.date.split("-");
  return template
    .replace(/\{\{year\}\}/g, year)
    .replace(/\{\{month\}\}/g, month)
    .replace(/\{\{day\}\}/g, day)
    .replace(/\{\{slug\}\}/g, entry.slug);
}

// Substitute `{{slug}}` in a preview_path with the value Decap actually
// passes — the FILE SLUG produced by `expandSlugTemplate` above. The `{{slug}}`
// in `preview_path` is NOT the field slug.
function expandPreviewPath(previewPath, fileSlug) {
  return previewPath.replace(/\{\{slug\}\}/g, fileSlug);
}

// Substitute `:slug` in a Jekyll permalink with the FIELD slug (Jekyll's
// `:slug` strips the `_posts/` date prefix automatically).
function expandJekyllPermalink(permalink, fieldSlug) {
  return permalink.replace(/:slug/g, fieldSlug);
}

function overrideScriptIsLoaded() {
  // The override file must exist on disk AND be referenced from every index
  // file. Either condition failing means the runtime fix isn't actually
  // wired up, so we can't fall back to it.
  if (!fs.existsSync(NATIVE_PREVIEW_OVERRIDE)) return false;
  const NEEDLE = /<script\s[^>]*src=["']native-preview-href\.js["']/;
  for (const file of INDEX_FILES) {
    if (!fs.existsSync(file)) return false;
    if (!NEEDLE.test(readText(file))) return false;
  }
  return true;
}

// Collections we model. Each entry says which Jekyll permalink to look up
// (`null` = pages, which are governed per-entry by their own front-matter
// `permalink:` rather than a Jekyll-level template).
const COLLECTIONS = [
  { name: "posts", jekyllKey: "posts" },
  { name: "tags", jekyllKey: "tags" },
  { name: "projects", jekyllKey: "projects" },
  { name: "pages", jekyllKey: null },
  { name: "e2e", jekyllKey: "e2e" },
];

test.describe("CMS permalink contract — Decap two-pass vs Jekyll", () => {
  for (const { name, jekyllKey } of COLLECTIONS) {
    test(`${name} — Decap preview URL matches Jekyll URL (or override is loaded)`, () => {
      const adminYml = readText(ADMIN_CONFIG);
      const jekyllYml = readText(JEKYLL_CONFIG);
      const chunk = findCollection(adminYml, name);
      expect(chunk, `admin/config.yml must define collection "${name}"`).not.toBeNull();

      const slugTemplate = readKey(chunk, "slug") || "{{slug}}";
      const previewPath = readKey(chunk, "preview_path");

      // Tags collection ships without a preview_path — there's no "View
      // Live" button to break, so the contract has nothing to assert. The
      // tag archive page itself is generated separately by the
      // auto_tag_pages plugin from string tags on posts.
      if (previewPath == null) {
        expect(
          name,
          `Only the tags collection is allowed to ship without a preview_path. ` +
            `If "${name}" should surface a "View Live" button, add preview_path.`,
        ).toBe("tags");
        return;
      }

      // Pages have a `preview_path` (for the toolbar) but no Jekyll-level
      // permalink template — each page sets its own front-matter
      // `permalink:`. So the toolbar's `/pages/{{slug}}/` substitution is
      // just a hint; the actual rendered URL is whatever the editor typed.
      // We still want to lock that the override's runtime computation
      // (which reads the permalink field directly) is what governs the
      // toolbar — the override fallback is the relevant safety net here
      // too. Skip the static URL comparison; assert the override is
      // present.
      if (name === "pages") {
        expect(
          overrideScriptIsLoaded(),
          `pages.preview_path uses {{slug}} but pages permalinks are per-entry. ` +
            `The runtime override at admin/native-preview-href.js must be loaded ` +
            `from all three index files so the toolbar reflects the entry's actual ` +
            `permalink field.`,
        ).toBe(true);
        return;
      }

      const permalink = jekyllPermalinkFor(jekyllYml, jekyllKey);
      expect(
        permalink,
        `_config.yml must define a permalink for collection "${jekyllKey}"`,
      ).not.toBeNull();

      // Two-pass Decap expansion: first `slug:` produces the file slug, then
      // `preview_path`'s `{{slug}}` is replaced by THAT file slug.
      const fileSlug = expandSlugTemplate(slugTemplate, SYNTHETIC);
      const decapURL = expandPreviewPath(previewPath, fileSlug);
      // Jekyll's `:slug` is the field slug — the `_posts/` date prefix is
      // stripped automatically.
      const jekyllURL = expandJekyllPermalink(permalink, SYNTHETIC.slug);

      const roundTrips = decapURL === jekyllURL;
      const overrideLoaded = overrideScriptIsLoaded();

      // Assertion: pass if EITHER the templates round-trip OR the override
      // script is wired up. The fail message names the divergence and
      // points at the override path so the next contributor knows where to
      // look.
      expect(
        roundTrips || overrideLoaded,
        `Permalink contract broken for "${name}":\n` +
          `  slug template:  ${slugTemplate}\n` +
          `  preview_path:   ${previewPath}\n` +
          `  permalink:      ${permalink}\n` +
          `  Decap URL:      ${decapURL}\n` +
          `  Jekyll URL:     ${jekyllURL}\n` +
          `Either fix the templates so they round-trip, or load the JS override at\n` +
          `  admin/native-preview-href.js\n` +
          `from all three of admin/index.html, admin/index-local.html, admin/index-test.html.`,
      ).toBe(true);
    });
  }
});
