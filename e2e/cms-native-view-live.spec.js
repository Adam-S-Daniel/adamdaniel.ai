const { test, expect } = require("./base");

// A1 runtime check — Decap's native "View Live" toolbar anchor is rewritten
// at runtime by admin/native-preview-href.js to match the URL the in-editor
// banner uses (admin/live-url-derive.js's compute()).
//
// The seed canary post at _posts/2026-04-25-replacement-test-post-1.md ships
// with `slug: ''` (empty), so:
//   - file slug (Decap's `slug:` template result) → 2026-04-25-replacement-test-post-1
//   - banner URL (live-url-derive.js compute()) → /blog/replacement-test-post-1/
//     (slugified from the title because explicit slug is empty —
//     see live-url-derive.js's `explicitSlug || slugify(fallback)` chain)
//   - Jekyll's published URL → /blog/replacement-test-post-1/
//     (`permalink: /blog/:slug/` strips the date prefix)
//
// Without the override, Decap's native toolbar would point at
// /blog/2026-04-25-replacement-test-post-1/ (the file slug). With the
// override, it tracks the banner exactly. This spec asserts the latter, then
// fetches the URL against the local Jekyll dev server and confirms HTTP 200.

const SEED_POST_SLUG = "2026-04-25-replacement-test-post-1";
const SEED_POST_TITLE = "Replacement test post 1";
// What both the banner and the override should resolve to for this entry.
// `replacement-test-post-1` is what slugify("Replacement test post 1") produces.
// allowed: literal slug used for known fixture (the seed canary post).
const EXPECTED_PATH = "/blog/replacement-test-post-1/";

const SEED_POST_CONTENT =
  `---
title: ${SEED_POST_TITLE}
slug: ''
date: 2026-04-25 16:33:00 -0400
excerpt: ''
tags: []
featured_image: ''
published: true
publish_date: ''
reading_time: null
---

Wow, a post
`;

function buildSeed() {
  return {
    repoFiles: {
      _posts: {
        "2026-04-25-replacement-test-post-1.md": {
          content: SEED_POST_CONTENT,
        },
      },
      _tags: {},
      _projects: {},
      pages: {},
    },
    repoFilesUnpublished: [],
  };
}

async function loadAdmin(page) {
  const seed = buildSeed();
  await page.addInitScript((seedJson) => {
    const s = JSON.parse(seedJson);
    window.repoFiles = s.repoFiles;
    window.repoFilesUnpublished = s.repoFilesUnpublished;
  }, JSON.stringify(seed));

  page.on("pageerror", (err) =>
    console.log(`[pageerror] ${err.name}: ${err.message}`),
  );
  page.on("console", (msg) => {
    if (msg.type() === "error") console.log(`[console.error] ${msg.text()}`);
  });

  await page.goto("/admin/index-test.html");
  const loginBtn = page.getByRole("button", { name: /login/i });
  await expect(loginBtn).toBeVisible({ timeout: 60_000 });
  await loginBtn.click();
  await expect(page.getByRole("link", { name: /^posts$/i })).toBeVisible({
    timeout: 30_000,
  });
}

test.describe("CMS native View-Live anchor — runtime href contract", () => {
  test.describe.configure({ mode: "serial", timeout: 180_000 });

  test.beforeEach(({ page }, testInfo) => {
    test.skip(
      testInfo.project.name !== "chromium-desktop",
      "Single project — Decap is heavy to load and the in-browser test-repo backend isn't meaningfully different across browsers.",
    );
  });

  test("native toolbar anchor href matches Jekyll's URL and serves HTTP 200", async ({
    page,
  }) => {
    test.fixme(
      true,
      "Decap's test-repo backend (admin/index-test.html) does not render " +
        "the native View-Live toolbar anchor — there's no real live site " +
        "to view in test-repo mode, so PreviewLink is not displayed. The " +
        "static contract that the override script IS loaded by all three " +
        "index files is locked by e2e/cms-permalink-contract.spec.js (E2). " +
        "TODO: rewrite this runtime check against admin/index-local.html " +
        "(decap-server local backend) where the PreviewLink IS rendered, " +
        "or against the production OAuth admin once a parity-target " +
        "switch lands (G3 in the plan).",
    );
    await loadAdmin(page);

    // Drive directly to the canary entry — same one cms-view-live-affordances
    // and cms-editorial-workflow specs use, so all three lock the same
    // surface against the same fixture.
    await page.goto(
      `/admin/index-test.html#/collections/posts/entries/${SEED_POST_SLUG}`,
    );
    await expect(page.getByLabel(/^Title$/)).toBeVisible({ timeout: 60_000 });

    // Wait for live-url-derive.js to expose window.LiveURL — that
    // module is the source of truth for both the toolbar override
    // (admin/native-preview-href.js) and any future consumer. Once
    // it's defined and compute() returns a URL, the override has
    // fired at least once on the form's first render.
    await page.waitForFunction(
      () => Boolean(window.LiveURL && window.LiveURL.compute && window.LiveURL.compute()),
      { timeout: 30_000 },
    );
    const computedPath = await page.evaluate(() => {
      const url = window.LiveURL.compute();
      return url ? new URL(url, location.href).pathname : null;
    });
    expect(
      computedPath,
      `window.LiveURL.compute() should resolve to ${EXPECTED_PATH} for the seed canary post`,
    ).toBe(EXPECTED_PATH);

    // ── Find the native toolbar anchor ────────────────────────────────
    // The override module rewrites every <a target="_blank"
    // rel*="noopener"> inside an `[class*="EditorToolbar"]` ancestor,
    // excluding the banner / live-preview / commit-pill IDs.
    //
    // Wait for at least one such anchor to exist AND for its href to
    // match what compute() produces — that's the contract this spec
    // locks.
    await expect
      .poll(
        async () => {
          return await page.evaluate(() => {
            const toolbars = document.querySelectorAll(
              '[class*="EditorToolbar"]',
            );
            const excluded = new Set([
              "live-preview-link",
              "cms-commit-pill",
              "cms-prod-status-pill",
              "cms-preview-build-pill",
            ]);
            const hrefs = [];
            for (const tb of toolbars) {
              const as = tb.querySelectorAll(
                'a[target="_blank"][rel*="noopener"][href]',
              );
              for (const a of as) {
                if (excluded.has(a.id)) continue;
                hrefs.push(a.getAttribute("href"));
              }
            }
            return hrefs;
          });
        },
        {
          timeout: 30_000,
          message:
            "Decap's native toolbar should render at least one View-Live-style anchor for a published post.",
        },
      )
      .toEqual(expect.arrayContaining([bannerHref]));

    // ── Fetch the URL against Jekyll and assert HTTP 200 ──────────────
    // playwright's `page.request.get` reuses the test's baseURL, so the
    // path-only fetch hits the local Jekyll dev server.
    const response = await page.request.get(EXPECTED_PATH);
    expect(
      response.status(),
      `${EXPECTED_PATH} should serve a published post (200) — if this fails ` +
        `the override pointed at a URL Jekyll doesn't render.`,
    ).toBe(200);
  });
});
