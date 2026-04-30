const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("./base");
const { captureStep } = require("./manual-capture");

// Verifies that the entire "View page on site:" banner row in the Decap
// admin is clickable — not just the URL inside it.
//
// Bug A in the Theme A bug-fix plan: `live-url-banner.js` rendered a
// label `<span>` and an inner anchor side-by-side, so clicking the label
// region was a silent no-op. Fix: wrap the whole row in a single
// `<a id="cms-live-url-banner-link" data-testid="...">`. The placeholder
// states (no slug / unpublished) stay as plain spans because there's no
// destination to open.
//
// This spec drives admin/index-local.html against a known canary post,
// finds the banner anchor, and clicks three positions across it: the
// label region (left), the URL region (right), and the anchor's center.
// Each click is expected to open a popup at the same href that's on the
// anchor's `href` attribute.

const REPO_ROOT = path.join(__dirname, "..");
const POSTS_DIR = path.join(REPO_ROOT, "_posts");

// Find the canary post the plan asks us to drive — `replacement-test-post-1`
// dated 2026-04-25. If multiple match (renames, copies), pick the first.
function findCanaryPost() {
  if (!fs.existsSync(POSTS_DIR)) return null;
  const matches = fs
    .readdirSync(POSTS_DIR)
    .filter((f) => /^2026-04-25-replacement-test-post-1\.md$/.test(f))
    .sort();
  return matches[0] || null;
}

// Decap's editor URL for a post is the file's basename minus the `.md`.
function postSlugFromFile(file) {
  return file.replace(/\.md$/, "");
}

test.describe("CMS live-URL banner is fully clickable", () => {
  test.describe.configure({ mode: "serial", timeout: 180_000 });

  test.beforeEach(({ page }, testInfo) => {
    test.skip(
      testInfo.project.name !== "chromium-desktop",
      "Single project — Decap is heavy to load, one project covers the click contract.",
    );
    page.on("pageerror", (err) =>
      console.log(`[pageerror] ${err.name}: ${err.message}`),
    );
    page.on("console", (msg) => {
      if (msg.type() === "error") console.log(`[console.error] ${msg.text()}`);
    });
  });

  test("clicking label / URL / center of the banner all open the live URL", async ({
    page,
    context,
  }) => {
    const canaryFile = findCanaryPost();
    expect(
      canaryFile,
      "Canary post _posts/2026-04-25-replacement-test-post-1.md must exist for this spec to drive a populated banner.",
    ).not.toBeNull();
    const slug = postSlugFromFile(canaryFile);

    // ── Log in to the local admin ────────────────────────────────────
    await page.goto("/admin/index-local.html");
    await page.getByRole("button", { name: /login/i }).click();
    await page
      .getByRole("link", { name: /^posts$/i })
      .waitFor({ timeout: 30_000 });

    // ── Open the canary post in the editor ───────────────────────────
    await page.goto(
      `/admin/index-local.html#/collections/posts/entries/${slug}`,
    );
    // The Title field renders only after Decap mounts the form.
    await expect(page.getByLabel(/^Title$/)).toBeVisible({ timeout: 60_000 });

    // ── Wait for the banner anchor; grab its expected href ───────────
    const banner = page.locator('[data-testid="cms-live-url-banner-link"]');
    await expect(banner).toBeVisible({ timeout: 30_000 });
    const expected = await banner.getAttribute("href");
    expect(
      expected,
      "Banner anchor must have an href so clicks have somewhere to land.",
    ).toBeTruthy();
    const expectedURL = new URL(expected);
    const expectedPath = expectedURL.pathname;

    await captureStep(page, {
      section: "Editing a post",
      step: "3.2",
      title: "View page on site banner",
      body:
        "The `View page on site:` banner sits at the top of every entry's edit form and links straight to the post's public URL. The whole row is clickable — clicking the **label** or the **URL** both open the live page in a new tab. If the post is unpublished or hasn't picked up a title/slug yet, the banner shows a placeholder instead of a link.",
    });

    // Helper: click the banner at a specific position, wait for the popup
    // (Decap's anchor uses `target="_blank"`), and assert the popup landed
    // at the same path as the banner's `href`.
    async function clickAndAssertPopup(positionLabel, options) {
      const [popup] = await Promise.all([
        context.waitForEvent("page"),
        banner.click(options),
      ]);
      await popup.waitForLoadState("domcontentloaded");
      const popupURL = new URL(popup.url());
      expect(
        popupURL.pathname,
        `Popup from ${positionLabel} click should land on ${expectedPath}`,
      ).toBe(expectedPath);
      await popup.close();
    }

    // The banner's bounding box gives us the geometry we need to click
    // the left (label) and right (URL) regions confidently. Decap may
    // still be settling layout right after the form mounts, so retry
    // briefly until the box is measurable.
    let box = null;
    await expect
      .poll(
        async () => {
          box = await banner.boundingBox();
          return box && box.width > 0 && box.height > 0 ? "ok" : "pending";
        },
        { timeout: 15_000, message: "Banner should have a measurable bounding box" },
      )
      .toBe("ok");

    await test.step("Click the label region (left edge of the banner)", async () => {
      await clickAndAssertPopup("label region", {
        position: { x: 5, y: Math.max(2, Math.floor(box.height / 2)) },
      });
      await captureStep(page, {
        section: "Editing a post",
        step: "3.3",
        title: "Label region opens the live URL",
        body:
          "Clicking anywhere on the `VIEW PAGE ON SITE:` label opens the post's live URL in a new tab. Before this fix, only the underlined URL itself was clickable — clicking the label was a silent no-op.",
      });
    });

    await test.step("Click the URL region (right edge of the banner)", async () => {
      await clickAndAssertPopup("URL region", {
        position: {
          x: Math.max(5, Math.floor(box.width) - 20),
          y: Math.max(2, Math.floor(box.height / 2)),
        },
      });
      await captureStep(page, {
        section: "Editing a post",
        step: "3.4",
        title: "URL region opens the live URL",
        body:
          "Clicking the underlined URL also opens the post in a new tab — the same destination as clicking the label. Both halves of the row are now part of the same anchor.",
      });
    });

    await test.step("Click the anchor's center", async () => {
      await clickAndAssertPopup("center");
      await captureStep(page, {
        section: "Editing a post",
        step: "3.5",
        title: "Center of banner opens the live URL",
        body:
          "Clicking anywhere in the middle of the banner row opens the live URL in a new tab. The whole row is one anchor — there is no dead zone between the label and the URL.",
      });
    });
  });
});
