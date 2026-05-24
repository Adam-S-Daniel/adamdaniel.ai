// @lane: local — drives the local test-repo /admin shell; no real GitHub
/**
 * @file e2e/cms-mobile-layout.spec.js
 *
 * Locks the responsive behaviour of admin/admin-mobile.css against
 * regression. Decap 3.12.2 is desktop-first: on an iPhone 16 (393 CSS px)
 * the shell renders ~800px wide (dead horizontal scroll), the editor is a
 * fixed side-by-side react-split-pane whose preview iframe wastes half the
 * width, the toolbar's Save/Delete controls slide off-screen, and 15px
 * inputs trigger iOS Safari's focus-zoom. admin-mobile.css overrides all
 * of that at a 768px breakpoint without forking Decap (see
 * docs/decisions/0003-extend-decap-for-mobile-instead-of-forking.md).
 *
 * The spec drives admin/index-test.html — Decap's in-browser test-repo
 * backend, so the full editor renders with no GitHub OAuth or
 * decap-server. It sets the viewport explicitly (rather than relying on
 * the project viewport) so the same assertions run on BOTH admin engines:
 * Chromium (chromium-desktop-3k, resized down) and WebKit
 * (webkit-iphone16). iOS-anything is WebKit, so the WebKit pass is the
 * load-bearing one; the Chromium pass is a cheap second engine.
 */
const path = require("node:path");
const { test, expect } = require("./base");

const IPHONE_16 = { width: 393, height: 852 };
const PROBE_IMAGE = path.join(
  __dirname,
  "..",
  "assets/images/uploads/e2e-preview-media-probe.png",
);
const DESKTOP = { width: 1400, height: 900 };

const SEED_POST_SLUG = "2026-04-25-replacement-test-post-1";
const SEED_POST_CONTENT = `---
title: Replacement test post 1
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

async function login(page) {
  await page.addInitScript(() => {
    window.repoFiles = {
      _posts: {
        "2026-04-25-replacement-test-post-1.md": {
          content: [
            "---",
            "title: Replacement test post 1",
            "slug: ''",
            "date: 2026-04-25 16:33:00 -0400",
            "excerpt: ''",
            "tags: []",
            "featured_image: ''",
            "published: true",
            "publish_date: ''",
            "reading_time: null",
            "---",
            "",
            "Wow, a post",
            "",
          ].join("\n"),
        },
      },
      _tags: {},
      _projects: {},
      pages: {},
    };
    window.repoFilesUnpublished = [];
  });

  page.on("pageerror", (err) =>
    console.log(`[pageerror] ${err.name}: ${err.message}`),
  );

  await page.goto("/admin/index-test.html");
  const loginBtn = page.getByRole("button", { name: /login/i });
  await expect(loginBtn).toBeVisible({ timeout: 60_000 });
  await loginBtn.click();
  await expect(page.getByRole("link", { name: /^posts$/i })).toBeVisible({
    timeout: 30_000,
  });
}

async function openEditor(page) {
  await page.goto(
    `/admin/index-test.html#/collections/posts/entries/${SEED_POST_SLUG}`,
  );
  await expect(page.getByLabel(/^Title$/)).toBeVisible({ timeout: 60_000 });
  // The split-pane + toolbar settle a beat after the editor mounts.
  await page.waitForTimeout(800);
}

test.describe(
  "CMS admin — mobile layout (iPhone 16)",
  // Tagged @admin-read: drives /admin/* but is read-only — runs on
  // chromium-desktop-3k + webkit-iphone16. See playwright.config.js.
  { tag: ["@admin-read"] },
  () => {
    test.describe.configure({ mode: "serial", timeout: 180_000 });

    test("entry editor fits the viewport with no dead horizontal scroll", async ({
      page,
    }) => {
      await page.setViewportSize(IPHONE_16);
      await login(page);
      await openEditor(page);

      // 1. The document must not scroll horizontally. overflow-x:hidden
      //    clamps scrollWidth, so this is a sanity floor; the element-edge
      //    checks below are what actually prove the layout reflowed.
      const widths = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(
        widths.scrollWidth,
        "Document scrolls horizontally on a phone — the shell isn't reflowing",
      ).toBeLessThanOrEqual(widths.clientWidth + 1);

      // 2. The live-preview iframe pane is dropped on mobile (the form
      //    gets the full width; /preview/ is the editor's WYSIWYG).
      const previewFrame = page.locator('[class*="PreviewPaneFrame"]');
      if (await previewFrame.count()) {
        await expect(previewFrame.first()).toBeHidden();
      }

      // 3. Every visible form field is laid out within the viewport — no
      //    field is clipped off the right edge or pushed past the left.
      const fieldOverflow = await page.evaluate(() => {
        const vw = window.innerWidth;
        const bad = [];
        for (const el of document.querySelectorAll(
          '[class*="ControlContainer"]',
        )) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 && r.height === 0) continue;
          if (r.right > vw + 1 || r.left < -1) {
            bad.push({ right: Math.round(r.right), left: Math.round(r.left) });
          }
        }
        return bad;
      });
      expect(
        fieldOverflow,
        `Form fields overflow the viewport: ${JSON.stringify(fieldOverflow)}`,
      ).toEqual([]);
    });

    test("form inputs are ≥16px so iOS Safari doesn't zoom on focus", async ({
      page,
    }) => {
      await page.setViewportSize(IPHONE_16);
      await login(page);
      await openEditor(page);

      const tooSmall = await page.evaluate(() => {
        const out = [];
        const fields = document.querySelectorAll(
          '[class*="AppMainContainer"] input:not([type=hidden]), ' +
            '[class*="AppMainContainer"] textarea, ' +
            '[class*="AppMainContainer"] [role="textbox"]',
        );
        for (const el of fields) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 && r.height === 0) continue; // not rendered
          const fs = parseFloat(getComputedStyle(el).fontSize);
          if (fs < 16) out.push({ tag: el.tagName, fontSize: fs });
        }
        return out;
      });
      expect(
        tooSmall,
        `Inputs under 16px trigger iOS focus-zoom: ${JSON.stringify(tooSmall)}`,
      ).toEqual([]);
    });

    test("Save and Delete toolbar controls are on-screen and full-label", async ({
      page,
    }) => {
      await page.setViewportSize(IPHONE_16);
      await login(page);
      await openEditor(page);

      // The Save button and the "Delete published entry" control must be
      // visible AND inside the viewport (the desktop toolbar pushed them
      // off the right edge). Their full labels prove they didn't collapse
      // to a truncated sliver ("S." / "Delete …").
      for (const name of [/^Save$/, /Delete published entry/]) {
        const btn = page.getByRole("button", { name }).first();
        await expect(btn).toBeVisible();
        const box = await btn.boundingBox();
        const vw = page.viewportSize().width;
        expect(
          box.x + box.width,
          `Toolbar control ${name} is clipped off the right edge`,
        ).toBeLessThanOrEqual(vw + 1);
        expect(box.x, `Toolbar control ${name} is off the left edge`).toBeGreaterThanOrEqual(-1);
      }
    });

    test("desktop layout is untouched — the preview pane still renders wide", async ({
      page,
    }) => {
      // Guard against the breakpoint creeping up and stealing the
      // side-by-side preview from desktop editors.
      await page.setViewportSize(DESKTOP);
      await login(page);
      await openEditor(page);

      const previewFrame = page.locator('[class*="PreviewPaneFrame"]').first();
      await expect(previewFrame).toBeVisible();
      const box = await previewFrame.boundingBox();
      expect(
        box.width,
        "Desktop preview pane collapsed — the mobile breakpoint is too wide",
      ).toBeGreaterThan(200);
    });

    test("media-library modal fits the viewport and its action buttons stay on-screen", async ({
      page,
    }) => {
      await page.setViewportSize(IPHONE_16);
      await login(page);

      // Open the global media library from the top-nav "Media" button.
      await page.getByRole("button", { name: "Media", exact: true }).first().click();
      const libraryTop = page.locator('[class*="LibraryTop"]').first();
      await expect(libraryTop).toBeVisible({ timeout: 30_000 });

      // Upload + select an asset so the selection-dependent controls
      // (Copy Path / Download / Delete) render — those are the ones the
      // desktop layout ran off the right edge.
      await page.locator('input[type="file"]').first().setInputFiles(PROBE_IMAGE);
      const card = page.locator('[class*="CardGridContainer"] button, [class*="CardGridContainer"] img').first();
      await expect(card).toBeVisible({ timeout: 30_000 });
      await card.click().catch(() => {});
      await page.waitForTimeout(500);

      // No control inside the modal may extend past either edge of the
      // viewport — every button/label and the search input must be
      // reachable, and the modal card itself must fit.
      const overflow = await page.evaluate(() => {
        const vw = window.innerWidth;
        const bad = [];
        const sel =
          '[class*="StyledModal"], [class*="LibraryTop"] button, ' +
          '[class*="LibraryTop"] label, [class*="LibraryTop"] a, ' +
          '[class*="SearchInput"], [class*="CardGridContainer"]';
        for (const el of document.querySelectorAll(sel)) {
          const cls0 = (typeof el.className === "string" ? el.className : (el.className.baseVal || "")) || "";
          // The close "X" is a corner affordance that deliberately
          // straddles the modal edge (upstream Decap design, reachable);
          // not an overflow bug.
          if (/CloseButton/.test(cls0)) continue;
          const r = el.getBoundingClientRect();
          if (r.width === 0 && r.height === 0) continue;
          if (r.right > vw + 1 || r.left < -1) {
            const cls = (typeof el.className === "string" ? el.className : (el.className.baseVal || "")) || "";
            bad.push({
              cls: String(cls).replace(/css-\w+-/g, "").slice(0, 30),
              txt: (el.textContent || "").trim().slice(0, 16),
              left: Math.round(r.left),
              right: Math.round(r.right),
            });
          }
        }
        return { vw, bad };
      });
      expect(
        overflow.bad,
        `Media-library controls overflow the ${overflow.vw}px viewport: ${JSON.stringify(overflow.bad)}`,
      ).toEqual([]);
    });
  },
);
