// @lane: local — drives the local Decap admin shell; no real GitHub
const { test, expect } = require("./base");

// A1 runtime check — Decap's native "View Live" toolbar anchor is REMOVED
// at runtime by admin/native-preview-href.js.
//
// Why removed (not rewritten): the native anchor is redundant with the
// floating eye-icon "Live Preview" button (#live-preview-link in
// admin/index.html) and the deploy-status / commit pills. On narrow
// viewports the toolbar overflows and the redundant anchor pushes the
// publish-status pill off-screen. See admin/native-preview-href.js's
// header comment for the full rationale.
//
// This spec asserts that, after Decap mounts the editor toolbar, NO
// `target="_blank" rel*="noopener"` anchor (other than the
// site-rendered exclusions) remains inside the toolbar.

const SEED_POST_SLUG = "2026-04-25-replacement-test-post-1";
const SEED_POST_TITLE = "Replacement test post 1";

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

test.describe("CMS native View-Live anchor — runtime removal contract", () => {
  test.describe.configure({ mode: "serial", timeout: 180_000 });

  test.beforeEach(({ page }, testInfo) => {
    test.skip(
      testInfo.project.name !== "chromium-desktop",
      "Single project — Decap is heavy to load and the in-browser test-repo backend isn't meaningfully different across browsers.",
    );
  });

  test("native toolbar View-Live anchor is removed from the DOM", async ({
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

    // Drive directly to the canary entry — same one cms-banner-clickable
    // and cms-editorial-workflow specs use, so all three lock the same
    // surface against the same fixture.
    await page.goto(
      `/admin/index-test.html#/collections/posts/entries/${SEED_POST_SLUG}`,
    );
    await expect(page.getByLabel(/^Title$/)).toBeVisible({ timeout: 60_000 });

    // Wait for the editor toolbar to render — its presence proves
    // Decap mounted the entry editor. Once the toolbar is visible
    // the override has had a chance to run (it observes mutations
    // and fires on every toolbar render).
    const toolbar = page.locator('[class*="EditorToolbar"]').first();
    await expect(toolbar).toBeVisible({ timeout: 30_000 });

    // ── Assert NO native View Live anchor remains ─────────────────────
    // The override script removes every `<a target="_blank"
    // rel*="noopener">` inside an `[class*="oolbar"]` ancestor that
    // isn't one of this site's own surfaces (live-preview-link,
    // cms-commit-pill, cms-prod-status-pill, cms-preview-build-pill).
    //
    // We poll because Decap may re-mount the toolbar a few times
    // during initial render; the override fires on mutation, so the
    // anchor is removed shortly after each mount.
    await expect
      .poll(
        async () => {
          return await page.evaluate(() => {
            const toolbars = document.querySelectorAll(
              '[class*="oolbar"]',
            );
            const excluded = new Set([
              "cms-live-url-banner-link",
              "live-preview-link",
              "cms-commit-pill",
              "cms-prod-status-pill",
              "cms-preview-build-pill",
            ]);
            const remaining = [];
            for (const tb of toolbars) {
              const as = tb.querySelectorAll(
                'a[target="_blank"][rel*="noopener"][href]',
              );
              for (const a of as) {
                if (excluded.has(a.id)) continue;
                remaining.push(a.getAttribute("href") || "(no-href)");
              }
            }
            return remaining;
          });
        },
        {
          timeout: 30_000,
          message:
            "Native Decap View-Live anchor should be removed from the toolbar — " +
            "it's redundant with the floating Live Preview button and the " +
            "deploy-status / commit pills, and clips the publish pill off-screen " +
            "on narrow viewports.",
        },
      )
      .toEqual([]);
  });
});
