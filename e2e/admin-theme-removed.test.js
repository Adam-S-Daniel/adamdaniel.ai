const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("./base");

/*
 * admin-theme-removed.test.js — pure-node invariants on admin/index.html
 *
 * The repo currently *retains* the cobalt theme intentionally. The audit
 * finding that suggested ripping it was based on an iOS-WebKit render bug
 * that has since been narrowed: the static page background + design tokens
 * stay; only the ambient-glow pseudo-element + toolbar `backdrop-filter`
 * were removed (see `admin/index.html` and `admin/custom.css` comments).
 *
 * Because the theme is retained, this spec locks in the OPPOSITE invariant
 * — the kill-switch must keep working — so we don't silently re-introduce
 * the broken pattern (theme present, kill-switch gone) on a future refactor.
 *
 * If the theme is later genuinely removed, flip these assertions —
 * but until then, this is the regression guard.
 *
 * No browser, no jekyll — Playwright launches the file because it matches
 * testDir, but every assertion is plain `fs.readFileSync` + regex.
 */

const REPO_ROOT = path.resolve(__dirname, "..");
const ADMIN_INDEX = path.join(REPO_ROOT, "admin", "index.html");
const ADMIN_CSS = path.join(REPO_ROOT, "admin", "custom.css");

// Filesystem-only assertions — fast and project-agnostic. Mirrors
// e2e/compute-visual-diffs.test.js's pattern: Playwright launches the
// file once per project, but the work is plain Node, so the per-project
// runs are essentially free and the per-test skip noise isn't worth it.
test.describe("admin theme + ?notheme kill-switch invariants", () => {
  test("admin/custom.css exists (theme intentionally retained)", () => {
    expect(
      fs.existsSync(ADMIN_CSS),
      `${ADMIN_CSS} is missing — if the theme was genuinely removed, ` +
        "flip the assertions in this spec to lock in removal instead.",
    ).toBe(true);
  });

  test("admin/index.html links custom.css with id='cobalt-theme'", () => {
    const html = fs.readFileSync(ADMIN_INDEX, "utf8");
    // The id is what the ?notheme inline script targets to disable the
    // stylesheet — losing it silently breaks the kill-switch.
    expect(html).toMatch(
      /<link\s+rel="stylesheet"\s+href="custom\.css"\s+id="cobalt-theme">/,
    );
  });

  test("admin/index.html top-of-file comment documents ?notheme", () => {
    const html = fs.readFileSync(ADMIN_INDEX, "utf8");
    // First HTML comment in the file (the theme-context comment immediately
    // above the <link>). The comment must mention `?notheme` so a future
    // editor reading top-down sees the kill-switch is intentional.
    const firstComment = html.match(/<!--([\s\S]*?)-->/);
    expect(firstComment, "Expected a leading HTML comment in admin/index.html")
      .not.toBeNull();
    expect(firstComment[1]).toMatch(/\?notheme/);
  });

  test("admin/index.html ?notheme reads URLSearchParams from location.search", () => {
    const html = fs.readFileSync(ADMIN_INDEX, "utf8");
    // Decap uses hash routing, so reading from `location.hash` would
    // silently break `/admin/?notheme`. See AGENTS.md > "?notheme kill-switch".
    expect(html).toMatch(
      /new\s+URLSearchParams\s*\(\s*location\.search\s*\)\s*\.has\s*\(\s*['"]notheme['"]\s*\)/,
    );
  });

  test("admin/custom.css ControlHint colour override survives", () => {
    // Decap's default ControlHint (`rgb(93,98,111)`) is unreadable on the
    // cobalt-themed widget wrappers. The custom.css override is a
    // load-bearing accessibility fix; this guards against silent removal.
    const css = fs.readFileSync(ADMIN_CSS, "utf8");
    expect(css).toMatch(
      /\[class\*="ControlHint"\]\s*\{[\s\S]*?color:\s*#[0-9a-fA-F]{3,6}/,
    );
  });
});
