// @lane: local — pure-fs invariants on the #1042 admin posts changes; no browser
const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("./base");

// Locks the issue #1042 ("Improve admin UI related to posts") wiring so a
// future edit can't silently regress it:
//
//   1. The "View page on site:" banner (admin/live-url-banner.js) — a
//      past change (#184) deleted it, leaving the editor with NO link to
//      the post. It's restored and must load from all three index shells
//      in derive → banner → override order, and be excluded from the
//      native-anchor hide so native-preview-href.js can't swallow it.
//   2. admin/posts-list-enhance.js — the custom Posts-list dashboard.
//      Must load from all three shells, AUGMENT (never replace) Decap's
//      `a[href*="#/collections/posts/entries/"]` cards so every existing
//      e2e selector keeps resolving, hide fixtures NON-destructively
//      (reorder-to-end, not removeChild) so `.first()`-click specs still
//      land on a visible real post, and CSS-hide only the E2E Quick-add
//      item.
//   3. The posts `summary:` no longer uses the dayjs `date(...)` filter
//      that rendered "INVALID DATE" on WebKit; the `Automated tests`
//      view_filter + hidden `test_fixture` field exist in all three
//      configs; the canary _posts carry `test_fixture: true` and the
//      real post does not.
//
// Pure-fs + deterministic on purpose (mirrors cms-config.spec.js): the
// runtime behaviour is exercised by the existing cms-smoke /
// manual-walkthrough specs, which still click a list card with this
// script active.

const REPO_ROOT = path.join(__dirname, "..");
const ADMIN = path.join(REPO_ROOT, "admin");
const INDEX_FILES = ["index.html", "index-local.html", "index-test.html"].map(
  (f) => path.join(ADMIN, f),
);
const CONFIGS = ["config.yml", "config-local.yml", "config-test.yml"].map((f) =>
  path.join(ADMIN, f),
);

const read = (p) => fs.readFileSync(p, "utf8");
const scriptIdx = (html, file) => {
  const re = new RegExp(
    `<script[^>]+src=["']${file.replace(/[.]/g, "\\.")}["'][^>]*>`,
  );
  const m = re.exec(html);
  return m ? m.index : -1;
};

test.describe("Issue #1042 — admin posts UI", () => {
  test.describe.configure({ mode: "serial" });

  // ── 1. Live-URL banner restored + correctly ordered ──────────────
  test("admin/live-url-banner.js exists and renders the testable anchor", () => {
    const p = path.join(ADMIN, "live-url-banner.js");
    expect(fs.existsSync(p), "admin/live-url-banner.js must exist (it was deleted in #184; #1042 restores it)").toBe(true);
    const src = read(p);
    expect(/\(\s*function\s*\(\s*\)\s*\{[\s\S]+\}\s*\)\s*\(\s*\)\s*;?/.test(src), "must be a self-contained IIFE").toBe(true);
    expect(src).toContain('id="cms-live-url-banner-link"');
    expect(src).toContain('data-testid="cms-live-url-banner-link"');
    // It must consume the single source of truth, not re-derive URLs.
    expect(src).toMatch(/window\.LiveURL/);
  });

  for (const idx of INDEX_FILES) {
    const rel = path.relative(REPO_ROOT, idx);
    test(`${rel}: loads derive → banner → override → posts-list-enhance`, () => {
      const html = read(idx);
      const derive = scriptIdx(html, "live-url-derive.js");
      const banner = scriptIdx(html, "live-url-banner.js");
      const override = scriptIdx(html, "native-preview-href.js");
      const enhance = scriptIdx(html, "posts-list-enhance.js");
      expect(derive, `${rel} must load live-url-derive.js`).toBeGreaterThan(-1);
      expect(banner, `${rel} must load live-url-banner.js (restored #1042)`).toBeGreaterThan(-1);
      expect(override, `${rel} must load native-preview-href.js`).toBeGreaterThan(-1);
      expect(enhance, `${rel} must load posts-list-enhance.js (#1042)`).toBeGreaterThan(-1);
      // derive defines window.LiveURL; the banner consumes it on first
      // render — derive MUST precede the banner, banner MUST precede the
      // native override (the historical, now-locked, load order).
      expect(derive < banner, `${rel}: live-url-derive.js must load before live-url-banner.js`).toBe(true);
      expect(banner < override, `${rel}: live-url-banner.js must load before native-preview-href.js`).toBe(true);
    });
  }

  test("native-preview-href.js excludes the restored banner anchor", () => {
    const src = read(path.join(ADMIN, "native-preview-href.js"));
    // Without this, the toolbar-anchor hide could swallow the banner
    // link (it's the same target=_blank rel=noopener shape).
    expect(src).toContain('"cms-live-url-banner-link"');
  });

  // ── 2. posts-list-enhance.js contract ────────────────────────────
  test("posts-list-enhance.js augments in place and hides fixtures non-destructively", () => {
    const src = read(path.join(ADMIN, "posts-list-enhance.js"));
    expect(/\(\s*function\s*\(\s*\)\s*\{[\s\S]+\}\s*\)\s*\(\s*\)\s*;?/.test(src), "must be a self-contained IIFE").toBe(true);
    expect(src).toMatch(/__postsListEnhanceInstalled/);
    // AUGMENT, not replace: it must select Decap's entry anchors (so
    // every existing `a[href*="…/entries/"]` spec selector still works)
    // and must NOT remove cards from the DOM.
    expect(src).toContain('a[href*="#/collections/posts/entries/"]');
    expect(src, "must not removeChild/remove() entry cards — Decap re-mount fight + breaks .first()-click specs").not.toMatch(
      /\.(removeChild|remove)\(/,
    );
    // Non-destructive default-hide = reorder fixtures to the end.
    expect(src).toMatch(/data-cms-ple-fixture/);
    expect(src).toMatch(/appendChild/);
    // Reuses the established Decap operator-token pattern, no new auth.
    expect(src).toContain('localStorage.getItem("decap-cms-user")');
    // Quick-add hide is text-scoped to the e2e collection only.
    expect(src).toContain("E2E Canary");
    expect(src).toMatch(/E2E TEST FIXTURES/);
    // Manual refresh affordance (issue #1042 ask).
    expect(src).toMatch(/cms-ple-refresh/);
  });

  test("fixture detection matches the canary slugs, not the real post", () => {
    // Lock the intended classification independent of the source: dated
    // e2e canary slugs are fixtures; a normal post is not.
    const FIXTURE_SLUG_RE = /^\d{4}-\d{2}-\d{2}-e2e-/i;
    for (const slug of [
      "2024-01-02-e2e-unpublish-canary",
      "2099-01-01-e2e-mutation-canary",
      "2099-01-03-e2e-media-roundtrip",
    ]) {
      expect(FIXTURE_SLUG_RE.test(slug), `${slug} must be detected as a fixture`).toBe(true);
    }
    expect(
      FIXTURE_SLUG_RE.test("2026-05-12-introducing-gha-bench"),
      "a real post must NOT be detected as a fixture",
    ).toBe(false);
    // The regex above must match the one shipped in the script.
    const src = read(path.join(ADMIN, "posts-list-enhance.js"));
    expect(src).toContain("/^\\d{4}-\\d{2}-\\d{2}-e2e-/i");
  });

  // ── 3. Config + canary invariants ────────────────────────────────
  for (const cfg of CONFIGS) {
    const rel = path.relative(REPO_ROOT, cfg);
    test(`${rel}: INVALID-DATE fix + Automated tests filter + test_fixture field`, () => {
      const yml = read(cfg);
      // The dayjs `date(...)` summary filter is the INVALID DATE bug.
      expect(yml, `${rel} must not reintroduce the date(...) summary filter`).not.toMatch(
        /summary:.*date\(/,
      );
      expect(yml).toMatch(/summary:\s*"\{\{title\}\} \(\{\{year\}\}-\{\{month\}\}-\{\{day\}\}\)/);
      // `Automated tests` view_filter keyed off test_fixture.
      expect(yml).toMatch(/-\s*label:\s*Automated tests/);
      expect(yml).toMatch(/field:\s*test_fixture/);
      // Hidden, non-editor-facing marker field.
      expect(yml).toMatch(/-\s*name:\s*test_fixture[\s\S]*?widget:\s*hidden/);
    });
  }

  test("canary _posts carry test_fixture: true; the real post does not", () => {
    const postsDir = path.join(REPO_ROOT, "_posts");
    for (const f of [
      "2024-01-02-e2e-unpublish-canary.md",
      "2099-01-01-e2e-mutation-canary.md",
      "2099-01-03-e2e-media-roundtrip.md",
    ]) {
      const fm = read(path.join(postsDir, f));
      expect(fm, `${f} must be flagged test_fixture: true so the Automated tests filter and the list default-hide catch it`).toMatch(
        /^test_fixture:\s*true\s*$/m,
      );
    }
    // Spot-check a real post is not falsely flagged (guards a future
    // copy-paste of the canary frontmatter into a real post).
    const real = path.join(
      postsDir,
      "2026-05-12-agents-authoring-github-actions-choosing-a-model-and-language.md",
    );
    if (fs.existsSync(real)) {
      expect(read(real)).not.toMatch(/^test_fixture:\s*true\s*$/m);
    }
  });
});
