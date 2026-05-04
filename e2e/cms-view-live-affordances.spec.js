const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("./base");

// A3 — lock the dual "View Live" affordance contract.
//
// Two surfaces in the Decap admin point at a published entry's live URL:
//
//   1. The in-editor banner — `[data-testid="cms-live-url-banner-link"]`,
//      rendered by admin/live-url-banner.js above the form. Wraps the whole
//      "VIEW PAGE ON SITE: <url>" row in a single anchor (A2).
//   2. Decap's native PreviewLink toolbar anchor — Decap renders this from
//      the collection's `preview_path` template, but for Posts the two-pass
//      `slug:` → `preview_path` substitution diverges from Jekyll's
//      `permalink: /blog/:slug/`. admin/native-preview-href.js (A1) installs
//      a MutationObserver that rewrites the anchor's href on every form
//      mutation so it tracks `window.LiveURL.compute()` — the same source
//      the banner uses.
//
// Both surfaces must be wired up consistently: same href, same `target`,
// same `rel`. If either drops out — e.g. the override script is removed
// from one of the three index files, or live-url-derive.js stops exporting
// `window.LiveURL` — clicking the toolbar anchor 404s on the canary post
// and the regression escapes to prod. This spec locks the static contract
// that BOTH override and banner are wired up correctly.
//
// Static checks (pure-Node, no browser):
//   1. All three admin/index*.html files load live-url-derive.js,
//      live-url-banner.js, AND native-preview-href.js — in that order, so
//      the derive module exposes `window.LiveURL` before either consumer
//      tries to call `compute()`.
//   2. admin/native-preview-href.js wraps its MutationObserver in the
//      `(function () { … })()` IIFE pattern and references
//      `window.LiveURL.compute`.
//   3. admin/live-url-derive.js exposes `window.LiveURL`.
//
// Runtime check (chromium-desktop only):
//   4. Open admin/index-test.html on the seeded canary post, wait for the
//      banner anchor to render, and assert: non-empty href, `target="_blank"`,
//      `rel*="noopener"`. Locks the banner half of the dual surface against
//      live-url-derive.js's compute().
//
// A sibling spec at e2e/cms-native-view-live.spec.js (added in A1) is
// `test.fixme()`'d because the Decap test-repo backend doesn't render the
// native PreviewLink anchor (no real live site to view in test-repo mode).
// This spec deliberately does NOT duplicate that runtime assertion — the
// static contract that the override script IS loaded by all three index
// files is enough to lock the parallel-surface invariant. Once a parity
// switch lands (G3 in the plan) and the runtime check can drive the OAuth
// admin against a real backend, that other spec activates.
//
// Tag `@parity` (G3 not shipped yet — but the static checks are already
// read-only and would pass identically against any TARGET).

const REPO_ROOT = path.join(__dirname, "..");
const ADMIN_DIR = path.join(REPO_ROOT, "admin");
const INDEX_FILES = [
  path.join(ADMIN_DIR, "index.html"),
  path.join(ADMIN_DIR, "index-local.html"),
  path.join(ADMIN_DIR, "index-test.html"),
];
const DERIVE_FILE = path.join(ADMIN_DIR, "live-url-derive.js");
const BANNER_FILE = path.join(ADMIN_DIR, "live-url-banner.js");
const OVERRIDE_FILE = path.join(ADMIN_DIR, "native-preview-href.js");

// Find the position of a `<script src="…">` tag for a given filename inside
// an index.html body. Returns -1 if absent. Matches both single and double
// quotes, and tolerates extra attributes (e.g. `defer`).
function scriptTagIndex(html, filename) {
  // Escape the filename's `.` so it doesn't match other characters.
  const safe = filename.replace(/[.]/g, "\\.");
  const re = new RegExp(`<script[^>]+src=["']${safe}["'][^>]*>`);
  const m = re.exec(html);
  return m ? m.index : -1;
}

test.describe("CMS dual View-Live affordances @parity", () => {
  // ── Static check 1: script tag order in all three index files ──────
  for (const indexFile of INDEX_FILES) {
    const rel = path.relative(REPO_ROOT, indexFile);
    test(`${rel} loads derive → banner → override in that order`, () => {
      expect(
        fs.existsSync(indexFile),
        `${rel} must exist for the dual-affordance contract to apply.`,
      ).toBe(true);
      const html = fs.readFileSync(indexFile, "utf8");

      const deriveIdx = scriptTagIndex(html, "live-url-derive.js");
      const bannerIdx = scriptTagIndex(html, "live-url-banner.js");
      const overrideIdx = scriptTagIndex(html, "native-preview-href.js");

      expect(
        deriveIdx,
        `${rel} must load admin/live-url-derive.js (the source of ` +
          `window.LiveURL.compute) — both the banner and the native preview ` +
          `override depend on it.`,
      ).toBeGreaterThan(-1);
      expect(
        bannerIdx,
        `${rel} must load admin/live-url-banner.js so the in-editor ` +
          `"VIEW PAGE ON SITE:" banner renders.`,
      ).toBeGreaterThan(-1);
      expect(
        overrideIdx,
        `${rel} must load admin/native-preview-href.js so Decap's native ` +
          `"View Live" toolbar anchor href tracks the banner's URL.`,
      ).toBeGreaterThan(-1);

      // Order matters: derive defines `window.LiveURL`, both consumers read
      // it. If derive loads after either consumer, `compute()` is undefined
      // on the consumer's first run → silent dead-link.
      expect(
        deriveIdx < bannerIdx,
        `${rel}: live-url-derive.js must load BEFORE live-url-banner.js — ` +
          `the banner reads window.LiveURL.compute on initial render.`,
      ).toBe(true);
      expect(
        bannerIdx < overrideIdx,
        `${rel}: live-url-banner.js must load BEFORE native-preview-href.js — ` +
          `the override is the second consumer of window.LiveURL and lives ` +
          `last in the script chain. (Order locked so any future contributor ` +
          `adding a fourth consumer slots in cleanly.)`,
      ).toBe(true);
    });
  }

  // ── Static check 2: native-preview-href.js is structurally correct ─
  test("admin/native-preview-href.js wires its MutationObserver via the IIFE pattern", () => {
    expect(
      fs.existsSync(OVERRIDE_FILE),
      "admin/native-preview-href.js must exist — the toolbar override is " +
        "what makes Decap's native View-Live anchor track the banner.",
    ).toBe(true);
    const src = fs.readFileSync(OVERRIDE_FILE, "utf8");

    // Self-contained IIFE — same shape as admin/live-url-banner.js and
    // admin/live-url-derive.js. Tolerates whitespace + the `"use strict"`
    // directive but anchors on `(function () {` … `})();`.
    expect(
      /\(\s*function\s*\(\s*\)\s*\{[\s\S]+\}\s*\)\s*\(\s*\)\s*;?/.test(src),
      "admin/native-preview-href.js must wrap its body in a " +
        "`(function () { … })()` IIFE — same pattern as live-url-banner.js " +
        "and live-url-derive.js. Without the IIFE, helper names leak into " +
        "the global scope and Decap's bundle (which also defines `compute`, " +
        "etc.) clobbers them.",
    ).toBe(true);

    // The override is the second consumer of window.LiveURL. If this
    // reference vanishes, the override silently does nothing on every form
    // mutation.
    expect(
      /window\.LiveURL\.compute/.test(src),
      "admin/native-preview-href.js must call window.LiveURL.compute — " +
        "that's the contract that ties the toolbar override to the same URL " +
        "the banner displays. If this assertion fails, the override has " +
        "drifted away from the single source of truth.",
    ).toBe(true);
  });

  // ── Static check 3: live-url-derive.js exposes window.LiveURL ──────
  test("admin/live-url-derive.js exposes window.LiveURL", () => {
    expect(
      fs.existsSync(DERIVE_FILE),
      "admin/live-url-derive.js must exist — it's the single source of " +
        "truth for what URL the currently-edited entry resolves to.",
    ).toBe(true);
    const src = fs.readFileSync(DERIVE_FILE, "utf8");

    // Tolerates whitespace around `=` and either `window.LiveURL = { … }`
    // or `window.LiveURL = X;` style. The derive module currently uses the
    // object-literal form — see admin/live-url-derive.js's `window.LiveURL`
    // assignment.
    expect(
      /window\.LiveURL\s*=/.test(src),
      "admin/live-url-derive.js must assign to window.LiveURL — the global " +
        "is what both consumers (live-url-banner.js, native-preview-href.js) " +
        "read. If this assertion fails, both consumers degrade silently and " +
        "the dual affordance disappears.",
    ).toBe(true);

    // The shape both consumers depend on. If `compute` is renamed without
    // updating the consumers, the silent failure mode is "everything looks
    // OK but the toolbar anchor never gets rewritten."
    expect(
      /compute\s*:\s*compute/.test(src),
      "admin/live-url-derive.js must export a `compute` member on " +
        "window.LiveURL — both consumers call window.LiveURL.compute().",
    ).toBe(true);
  });

  // ── Runtime check: banner anchor is wired correctly ────────────────
  // Drives admin/index-test.html (the in-browser test-repo backend) against
  // the page's pre-seeded canary post and asserts the banner anchor is
  // present with target="_blank" + rel*="noopener" + a non-empty href. The
  // override anchor isn't asserted at runtime here — see the comment on
  // e2e/cms-native-view-live.spec.js for why the test-repo backend doesn't
  // render Decap's native PreviewLink. The static checks above lock that
  // the override IS loaded; the runtime check below locks that the banner
  // half of the parallel surface is actually rendering.
  test("banner anchor renders with target=_blank, rel*=noopener, and a non-empty href", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "chromium-desktop",
      "Single project — Decap is heavy to load, and the in-browser " +
        "test-repo backend isn't meaningfully different across browsers.",
    );

    page.on("pageerror", (err) =>
      console.log(`[pageerror] ${err.name}: ${err.message}`),
    );
    page.on("console", (msg) => {
      if (msg.type() === "error") console.log(`[console.error] ${msg.text()}`);
    });

    // index-test.html pre-seeds window.repoFiles with the canary post
    // (slug: '', title: "Replacement test post 1") before Decap mounts.
    // The diagnostic page links straight to that entry — login + click +
    // the banner shows up.
    await page.goto("/admin/index-test.html");
    const loginBtn = page.getByRole("button", { name: /login/i });
    await expect(loginBtn).toBeVisible({ timeout: 60_000 });
    await loginBtn.click();
    await expect(page.getByRole("link", { name: /^posts$/i })).toBeVisible({
      timeout: 30_000,
    });

    // Drive directly to the seeded canary entry. Same fixture
    // cms-banner-clickable + cms-native-view-live use, so all three lock
    // the same surface against the same post.
    await page.goto(
      "/admin/index-test.html#/collections/posts/entries/2026-04-25-replacement-test-post-1",
    );
    await expect(page.getByLabel(/^Title$/)).toBeVisible({ timeout: 60_000 });

    const banner = page.locator('[data-testid="cms-live-url-banner-link"]');
    await expect(banner).toBeVisible({ timeout: 30_000 });

    const href = await banner.getAttribute("href");
    expect(
      href,
      "Banner anchor must have a non-empty href — that's the destination " +
        "any click on the row opens. An empty href means live-url-derive.js's " +
        "compute() returned a null URL, which for the canary post means the " +
        "title-slugify fallback regressed.",
    ).toBeTruthy();

    const target = await banner.getAttribute("target");
    expect(
      target,
      'Banner anchor must have target="_blank" so clicks open in a new tab ' +
        "— same convention Decap's native PreviewLink uses, and what the " +
        "override script rewrites the toolbar anchor to.",
    ).toBe("_blank");

    const rel = await banner.getAttribute("rel");
    expect(
      rel,
      "Banner anchor must declare a rel attribute (target=_blank without " +
        "rel=noopener leaks window.opener to the live-site tab).",
    ).toBeTruthy();
    expect(
      rel.includes("noopener"),
      `Banner anchor's rel must include "noopener" — got "${rel}". The ` +
        "override script also enforces this for the toolbar anchor; both " +
        "halves of the dual affordance must hold the same rel contract.",
    ).toBe(true);
  });
});
