// @lane: real — uploads a real image + mutates a real prod _posts/ entry through Decap → GitHub
// @select-skip-when-head-ref-prefix: cms/
//
// On `cms/*` PRs (Decap-opened editorial PRs) this spec self-skips at
// runtime — CMS_E2E_PAT and the RUN_* gate aren't wired into the
// standard PR matrix — so selecting it just to no-op is pure waste.
// The dedicated cms-media-roundtrip.yml workflow runs it.

/*
 * Real-browser, real-HTTP, real-GitHub, real-production-deploy
 * end-to-end test for the FULL media lifecycle, driven entirely
 * through the Decap UI with NO backdoors and NO assumptions:
 *
 *   1. Upload a unique image via the Media UI (the Featured Image
 *      widget's media library — the same picker the standalone Media
 *      page uses) and attach it to a real `_posts/` entry.
 *   2. Publish through the editorial workflow (Save → Status: Ready),
 *      let auto-merge + deploy-production run.
 *   3. Assert the post page on https://adamdaniel.ai renders the
 *      image AND that the image URL itself fetches 200 with real
 *      bytes. (This is the exact bug the flat-media-folder change
 *      fixes: a post referencing an image URL that 404s.)
 *   4. Remove the image from the post, unpublish, publish again; wait
 *      for the post to stop serving.
 *   5. Delete the uploaded asset via the standalone Media UI.
 *   6. Assert the image's live URL 404s.
 *
 * Why this exists on top of the local upload specs: the local specs
 * (cms-image-upload / cms-featured-image-lifecycle / cms-inline-image
 * / cms-project-gallery) prove the flat media_folder resolves on a
 * local Jekyll build. This spec proves it on the REAL production site
 * through the REAL GitHub backend and the REAL deploy pipeline,
 * including the standalone Media library's delete path — none of
 * which a local-backend spec can exercise. The user asked
 * specifically for this: "no assuming something you see in GitHub is
 * reflected in the live app."
 *
 * No backdoors: every product step the user enumerated (upload, add
 * to post, publish, remove, delete) goes through the real Decap UI.
 * The Contents-API baseline reset + the afterAll safety net are
 * test-harness HYGIENE (resetting fixture state between runs), not
 * the behaviour under test — mirrors the established pattern in
 * cms-publish-loop-prod-mutate.spec.js, which AGENTS.md blesses.
 *
 * Hard guards (mirrors prod-mutate):
 *   1. Fixture file MUST exist on disk at test start.
 *   2. Front-matter `published:` MUST be `false` at start. `true`
 *      means a previous run crashed mid-flow → test.fixme().
 *   3. The fixture date 2099-01-03 MUST still be in the future.
 *
 * Gating:
 *   - `CMS_E2E_PAT` must be set.
 *   - `RUN_PROD_MUTATE_PLAYGROUND=1` (same gate as the prod-mutate
 *     spec) so it only runs in cms-media-roundtrip.yml and never
 *     inside the per-PR e2e matrix or recursively on its own cms/* PR.
 *   - chromium-desktop-3k only.
 *
 * IMPORTANT: do NOT run this spec locally against prod. It mutates
 * the real production tree (a _posts/ entry + an upload). The
 * workflow runs it on a schedule.
 */
const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("./base");
const { seedDecapAuth, getPat, HOST_REPO } = require("./decap-pat");
const { closeStaleDecapPrOnBranch } = require("./cms-fixture-pr");
const {
  addLabel,
  gh,
  waitForCmsPullRequest,
} = require("./github-actions-poll");
const { waitForChangeReflected } = require("./deploy-pill");
const { resolveCmsTarget } = require("./cms-host");
const {
  readPublishedFlag,
  forcePublishedFalse,
  loudBail,
} = require("./fixture-baseline");

const REPO_ROOT = path.resolve(__dirname, "..");
const FIXTURE_PATH = "_posts/2099-01-03-e2e-media-roundtrip.md";
const FIXTURE_ABS = path.join(REPO_ROOT, FIXTURE_PATH);
const FIXTURE_SLUG = "e2e-media-roundtrip";
const FIXTURE_TITLE = "E2E Media Roundtrip";
const FIXTURE_DATE = "2099-01-03";
// Decap's `slug:` template is "{{year}}-{{month}}-{{day}}-{{slug}}",
// so the on-disk file slug (and the entry deeplink segment) is this.
const FILE_SLUG = "2099-01-03-e2e-media-roundtrip";
const DECAP_BRANCH = `cms/posts/${FILE_SLUG}`;
const PUBLIC_PATH = `/blog/${FIXTURE_SLUG}/`;

// Parameterized target: CMS_TARGET=preview (+ PR_NUMBER) drives the
// PR's preview-pr<N> surface; anything else keeps the prod default, so
// the existing prod workflow is behaviour-preserving with no new env.
// The local names stay PROD_* to keep this large spec's body and diff
// minimal — the *value* is whatever resolveCmsTarget() picks (prod or
// preview), which is the point of the parameterization.
const {
  host: PROD_HOST,
  adminUrl: PROD_ADMIN,
  pillId: PILL_PROD,
} = resolveCmsTarget();
const PUBLIC_URL = `${PROD_HOST}${PUBLIC_PATH}`;

// Source bytes for the upload. We re-upload these under a per-run
// unique filename so the 404-after-delete assertion is unambiguous
// and concurrent/looping runs can't collide on the same asset.
const SOURCE_FIXTURE_PNG = path.join(__dirname, "fixtures", "tiny-pixel.png");
const UPLOADS_DIR = "assets/images/uploads";

// Read-only daily probe gate (set in canary-prod.yml). The afterAll
// safety net consults this so the probe never tries to write to main.
const PROD_CANARY = process.env.PROD_CANARY === "1";

// validate-content + auto-merge + deploy-production + CloudFront
// invalidation caps ~12-15 min when runners are warm. This spec has
// THREE deploy waits (attach → live, remove → 404 post, delete →
// 404 image) at 15 min each + setup ≈ 55 min worst case; typical
// happy path completes in ~25-30 min. Retries disabled — this
// mutates real prod; a retry just re-runs the same broken chain.
const TEST_TIMEOUT_MS = 55 * 60 * 1000;

test.describe.configure({
  mode: "serial",
  timeout: TEST_TIMEOUT_MS,
  retries: 0,
});

function toContentBase64(text) {
  return Buffer.from(text, "utf8").toString("base64");
}

async function fetchFixtureFromMain() {
  return gh(`/repos/${HOST_REPO}/contents/${FIXTURE_PATH}?ref=main`);
}

/**
 * Write the whole fixture file to main via the Contents API, with the
 * same optimistic-concurrency retry as cms-publish-loop-prod-mutate:
 * GitHub rejects a stale blob SHA with 409 if main advanced under us.
 * The owner PAT (CMS_E2E_PAT) is allowed to push to main directly by
 * the cms-feature-branches ruleset; this is harness hygiene, not the
 * behaviour under test.
 */
async function writeFixtureOnMain({ fileText, message }) {
  const MAX_ATTEMPTS = 4;
  let lastErr;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const current = await fetchFixtureFromMain();
    try {
      return await gh(`/repos/${HOST_REPO}/contents/${FIXTURE_PATH}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          content: toContentBase64(fileText),
          sha: current.sha,
          branch: "main",
        }),
      });
    } catch (err) {
      lastErr = err;
      if (err && err.status === 409 && attempt < MAX_ATTEMPTS) {
        console.warn(
          `[writeFixtureOnMain] 409 on attempt ${attempt}; re-fetching SHA and retrying`,
        );
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

// Best-effort: delete a media file from main via the Contents API.
// Only used by the afterAll safety net to remove a per-run upload the
// UI delete leg didn't manage to remove. Never part of the behaviour
// under test (step 13 deletes via the Media UI).
async function deleteFileFromMainIfPresent(filePath, message) {
  let current;
  try {
    current = await gh(
      `/repos/${HOST_REPO}/contents/${encodeURI(filePath)}?ref=main`,
    );
  } catch (e) {
    if (e && e.status === 404) return false; // already gone — good
    throw e;
  }
  await gh(`/repos/${HOST_REPO}/contents/${encodeURI(filePath)}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, sha: current.sha, branch: "main" }),
  });
  return true;
}

// `readPublishedFlag` is shared from ./fixture-baseline (#1053 DRY'd
// the five per-spec copies into one implementation).

// The trimmed, unquoted `featured_image:` value, or "" if the line is
// absent / empty. Baseline is the empty string.
function readFeaturedImage(text) {
  const m = text.match(/^featured_image:\s*(.*)$/m);
  if (!m) return "";
  return m[1].trim().replace(/^['"]|['"]$/g, "");
}

// The canonical baseline file text. Read from disk so a doc-body edit
// to the committed fixture flows into the cleanup commit without a
// code change here — but NEVER trust its `published:` value. The
// committed file ships `published: false` + `featured_image: ""`;
// forcing `published: false` here is what makes the loop self-heal
// instead of re-writing `published: true` and skipping into a green
// check forever (#1053). Idempotent once the fixture is checked in
// false.
function buildBaselineFileText() {
  return forcePublishedFalse(
    fs.readFileSync(FIXTURE_ABS, "utf8"),
    FIXTURE_PATH,
  );
}

function todayUtcIso() {
  return new Date().toISOString().slice(0, 10);
}

function isBaseline(text) {
  return (
    readPublishedFlag(text) === false &&
    readFeaturedImage(text) === "" &&
    !/e2e-media-roundtrip-\d+\.png/.test(text)
  );
}

test(
  "CMS media round trip — upload via Media UI → live on adamdaniel.ai → delete via Media UI → 404",
  { tag: ["@admin-write"] },
  async ({ page }) => {
    // Reuse the prod-mutate gate so this spec only runs in its
    // dedicated workflow and self-skips inside the per-PR e2e matrix
    // and on its own cms/* PR (recursion guard). Legitimate "not my
    // workflow" green skip — keep it plain and FIRST so a shard-1 PR
    // run exits here before reaching the loud guards below.
    test.skip(
      process.env.RUN_PROD_MUTATE_PLAYGROUND !== "1",
      "RUN_PROD_MUTATE_PLAYGROUND not set — only cms-media-roundtrip.yml runs this spec.",
    );

    // Decap delete (and some confirm) flows use native window.confirm.
    // Register the handler BEFORE any interaction so it's never too
    // late (page.once after the click auto-dismisses).
    page.on("dialog", (d) => d.accept());

    // ── Hard guards ───────────────────────────────────────────────
    // Past the gate above the spec is SUPPOSED to run. `loudBail`
    // makes an unmet precondition a red failure on a schedule/
    // workflow_dispatch run (green test.fixme on local/PR, as before)
    // — #1053: a non-running scheduled loop must never report green.
    if (!getPat()) {
      loudBail(test, "CMS_E2E_PAT not set — media round-trip cannot run.");
      return;
    }
    if (!fs.existsSync(FIXTURE_ABS)) {
      loudBail(
        test,
        `Fixture ${FIXTURE_PATH} is missing — restore it from git history.`,
      );
      return;
    }
    const initialText = fs.readFileSync(FIXTURE_ABS, "utf8");
    const initialPublished = readPublishedFlag(initialText);
    if (initialPublished === null) {
      loudBail(
        test,
        `Fixture ${FIXTURE_PATH} has no parseable 'published:' line — fix before retrying.`,
      );
      return;
    }
    if (initialPublished === true) {
      // Loop self-heals main (buildBaselineFileText forces
      // `published: false`), but a checked-in `published: true` is a
      // source-of-truth misconfiguration and the exact #1053 stuck
      // state. Fail loudly on a scheduled run so a human fixes it.
      loudBail(
        test,
        `Fixture ${FIXTURE_PATH} is checked in 'published: true'. The loop force-resets main, but the committed fixture MUST be 'published: false' (see #1053). Flip it back on main.`,
      );
      return;
    }
    if (todayUtcIso() >= FIXTURE_DATE) {
      loudBail(
        test,
        `Be kind in 2099: ${FIXTURE_PATH} (${FIXTURE_DATE}) is past its expiry. Move the date forward or retire this spec.`,
      );
      return;
    }

    // The whole round trip reads and writes the fixture's state on
    // `main`. On the PR that INTRODUCES this fixture it isn't on main
    // yet (chicken-and-egg) and fetchFixtureFromMain() 404s. That's
    // expected, not a failure: skip cleanly here. Once this PR merges,
    // the scheduled / workflow_dispatch cms-media-roundtrip run
    // exercises the real round trip. Same philosophy as the
    // disk/`published:`/date hard guards above.
    let fixtureOnMain = true;
    try {
      await fetchFixtureFromMain();
    } catch (e) {
      if (e && e.status === 404) fixtureOnMain = false;
      else throw e;
    }
    if (!fixtureOnMain) {
      test.fixme(
        true,
        `${FIXTURE_PATH} is not on main yet — this is the PR that introduces it. ` +
          `Merge to main; the scheduled / workflow_dispatch cms-media-roundtrip ` +
          `run then exercises the real upload → publish → delete round trip.`,
      );
      return;
    }

    const runId = Date.now();
    const imageName = `e2e-media-roundtrip-${runId}.png`;
    const imagePath = `${UPLOADS_DIR}/${imageName}`;
    const imagePublicUrl = `/${imagePath}`;
    const imageUrlAbs = `${PROD_HOST}${imagePublicUrl}`;
    const imageBuffer = fs.readFileSync(SOURCE_FIXTURE_PNG);
    const baselineFileText = buildBaselineFileText();

    // ── 0a. Reset any stale Decap PR on the post's fixed branch ──
    await test.step("Close any stale Decap PR on the post branch", async () => {
      await closeStaleDecapPrOnBranch({ branch: DECAP_BRANCH });
    });

    // ── 0b. Reset fixture to baseline ─────────────────────────────
    await test.step("Reset fixture to baseline (published:false, no featured_image) via Contents API", async () => {
      const current = await fetchFixtureFromMain();
      const remote = Buffer.from(current.content, "base64").toString("utf8");
      if (!isBaseline(remote) || remote !== baselineFileText) {
        await writeFixtureOnMain({
          fileText: baselineFileText,
          message: `test(media-roundtrip): reset fixture baseline before run ${runId}`,
        });
      }
    });

    // ── 1. Confirm clean pre-state on the live site ───────────────
    await test.step("Confirm post 404s and image URL 404s before driving admin", async () => {
      const deadline = Date.now() + 6 * 60 * 1000;
      let postStatus = "unknown";
      while (Date.now() < deadline) {
        const res = await fetch(PUBLIC_URL, { cache: "no-store" });
        postStatus = `${res.status}`;
        if (res.status === 404) break;
        await new Promise((r) => setTimeout(r, 8000));
      }
      expect(
        postStatus,
        `${PUBLIC_URL} must 404 before the run (published:false should drop it)`,
      ).toBe("404");
      const imgRes = await fetch(imageUrlAbs, { cache: "no-store" });
      expect(
        imgRes.status,
        `${imageUrlAbs} must not exist yet (unique per-run name)`,
      ).toBe(404);
    });

    // ── 2. Load prod admin (PAT-seeded session, no OAuth popup) ───
    await seedDecapAuth(page);
    await test.step("Load production admin", async () => {
      await page.goto(PROD_ADMIN, { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("link", { name: /^Posts$/i })).toBeVisible({
        timeout: 60_000,
      });
    });

    // ── 3. Open the post entry ────────────────────────────────────
    await test.step("Open the media round-trip post", async () => {
      // Direct entry URL is deterministic. admin/posts-list-enhance.js
      // hides automated-test fixtures from the Posts list by DEFAULT
      // (#1042), so navigate to the canary directly (same pattern as
      // the steps below and cms-unpublish-republish.spec.js).
      await page.goto(`${PROD_ADMIN}#/collections/posts/entries/${FILE_SLUG}`, {
        waitUntil: "domcontentloaded",
      });
      const titleBox = page.getByRole("textbox", { name: /^Title$/i });
      await expect(titleBox).toBeVisible({ timeout: 30_000 });
      // Confirm we deep-linked to the right canary.
      await expect(titleBox).toHaveValue(new RegExp(FIXTURE_TITLE, "i"));
    });

    // ── 4. Upload via the Media UI + attach to the post ───────────
    // Click the Featured Image widget's "Choose Image" → Decap opens
    // the SAME MediaLibrary modal the standalone Media page uses →
    // drive its hidden <input type=file> with a per-run-unique
    // filename → confirm the selection back into the field. This is
    // exactly "upload a small image using the media UI, then add the
    // image to a post" with no shortcut.
    await test.step("Upload a unique image via the Media UI and attach it", async () => {
      await page
        .getByRole("button", { name: /choose (an |different )?image/i })
        .first()
        .click();
      const fileInput = page
        .locator('input[type="file"][accept*="image"]')
        .first();
      await fileInput.waitFor({ state: "attached", timeout: 30_000 });
      await fileInput.setInputFiles({
        name: imageName,
        mimeType: "image/png",
        buffer: imageBuffer,
      });
      const insertBtn = page
        .getByRole("button", { name: /^(choose selected|insert)$/i })
        .first();
      await expect(insertBtn).toBeVisible({ timeout: 30_000 });
      await insertBtn.click();
      // The widget must now reflect the upload. Decap renders the
      // chosen path; assert it surfaces the unique filename so we
      // know the attach actually took before we Save.
      await expect
        .poll(
          async () =>
            (await page.locator("body").innerText()).includes(imageName),
          { timeout: 30_000 },
        )
        .toBe(true);
    });

    // ── 5. Publish (toggle on, Save, Status → Ready) ──────────────
    await test.step("Toggle Published → ON", async () => {
      const toggle = page.getByRole("switch", { name: /^Published$/i }).first();
      await expect(toggle).toBeVisible({ timeout: 15_000 });
      if ((await toggle.getAttribute("aria-checked")) !== "true") {
        await toggle.click();
      }
      await expect(toggle).toHaveAttribute("aria-checked", "true", {
        timeout: 5_000,
      });
    });

    await test.step("Save → Status: Ready (engages auto-merge)", async () => {
      await page.getByRole("button", { name: /^Save$/i }).click();
      await expect(page.getByText(/Changes saved/i).first()).toBeVisible({
        timeout: 60_000,
      });
      await page.getByRole("button", { name: /^Status:\s*Draft$/i }).click();
      await page.getByRole("menuitem", { name: /^Ready$/i }).click();
      await expect(
        page.getByRole("button", { name: /^Status:\s*Ready$/i }),
      ).toBeVisible({ timeout: 30_000 });
    });

    // ── 6. Find the cms/... PR Decap opened ───────────────────────
    await test.step("Wait for Decap to open the cms/... PR (attach)", async () => {
      // The .md diff now contains `featured_image:
      // /assets/images/uploads/<imageName>` — match on that.
      const pr = await waitForCmsPullRequest({
        base: "main",
        filePath: FIXTURE_PATH,
        canaryMarker: imageName,
        timeoutMs: 5 * 60 * 1000,
      });
      expect(pr.number, "Decap attach PR number").toBeGreaterThan(0);
    });

    // ── 7. Wait until the image is LIVE on adamdaniel.ai ──────────
    // STAY on the entry editor (the deploy-status pill mounts there).
    await test.step("Wait for the post to render the image on adamdaniel.ai", async () => {
      await waitForChangeReflected({
        page,
        pillId: PILL_PROD,
        urlCheck: async () => {
          const res = await page.request.get(PUBLIC_URL, {
            failOnStatusCode: false,
          });
          if (res.status() !== 200) return false;
          return (await res.text()).includes(imagePublicUrl);
        },
        urlTimeoutMs: 15 * 60 * 1000,
      });
    });

    // ── 8. The image URL itself must resolve 200 with real bytes ──
    // This is THE assertion the whole flat-media-folder fix exists
    // for: the URL the post references must actually serve the image,
    // not 404.
    await test.step("Fetch the image URL on the live site — must be 200 with bytes", async () => {
      const res = await page.request.get(imageUrlAbs, {
        failOnStatusCode: false,
      });
      expect(
        res.status(),
        `${imageUrlAbs} must resolve 200 on the live site (broken-image regression guard)`,
      ).toBe(200);
      const ct = (res.headers()["content-type"] || "").toLowerCase();
      expect(ct, `unexpected content-type for ${imageUrlAbs}`).toContain(
        "image",
      );
      expect(
        (await res.body()).length,
        "live image response must have non-empty bytes",
      ).toBeGreaterThan(0);
    });

    // ── 9. Remove the image from the post + unpublish, publish ────
    await test.step("Remove the image from the post, unpublish, Save → Ready", async () => {
      await page.goto(`${PROD_ADMIN}#/collections/posts/entries/${FILE_SLUG}`, {
        waitUntil: "domcontentloaded",
      });
      await expect(page.getByRole("textbox", { name: /^Title$/i })).toBeVisible(
        { timeout: 30_000 },
      );

      // Clear the Featured Image widget. Decap renders a remove/clear
      // control next to the chosen-image preview. We click it, then
      // VERIFY the field actually cleared (poll the rendered field
      // for the absence of the filename) — no silent pass.
      const removeBtn = page
        .getByRole("button", {
          name: /^(remove|clear|remove image|delete)$/i,
        })
        .first();
      await expect(
        removeBtn,
        "Featured Image widget must expose a remove/clear control",
      ).toBeVisible({ timeout: 30_000 });
      await removeBtn.click();
      await expect
        .poll(
          async () =>
            (await page.locator("body").innerText()).includes(imageName),
          { timeout: 20_000 },
        )
        .toBe(false);

      const toggle = page.getByRole("switch", { name: /^Published$/i }).first();
      await expect(toggle).toBeVisible({ timeout: 15_000 });
      if ((await toggle.getAttribute("aria-checked")) === "true") {
        await toggle.click();
      }
      await expect(toggle).toHaveAttribute("aria-checked", "false", {
        timeout: 5_000,
      });

      await page.getByRole("button", { name: /^Save$/i }).click();
      await expect(page.getByText(/Changes saved/i).first()).toBeVisible({
        timeout: 60_000,
      });
      await page.getByRole("button", { name: /^Status:\s*Draft$/i }).click();
      await page.getByRole("menuitem", { name: /^Ready$/i }).click();
      await expect(
        page.getByRole("button", { name: /^Status:\s*Ready$/i }),
      ).toBeVisible({ timeout: 30_000 });
    });

    await test.step("Wait for Decap to open the cms/... PR (remove)", async () => {
      // The removal patch DELETES the `featured_image:
      // /assets/images/uploads/<imageName>` line — the patch text
      // still contains imageName (on the `-` line), so the same
      // marker disambiguates this run's PR.
      const pr = await waitForCmsPullRequest({
        base: "main",
        filePath: FIXTURE_PATH,
        canaryMarker: imageName,
        timeoutMs: 5 * 60 * 1000,
      });
      expect(pr.number, "Decap remove PR number").toBeGreaterThan(0);
    });

    await test.step("Wait for the post to stop serving (4xx)", async () => {
      await waitForChangeReflected({
        page,
        pillId: PILL_PROD,
        urlCheck: async () => {
          const res = await page.request.get(PUBLIC_URL, {
            failOnStatusCode: false,
          });
          const s = res.status();
          return s >= 400 && s < 500;
        },
        urlTimeoutMs: 15 * 60 * 1000,
      });
    });

    // ── 10. Delete the uploaded asset via the standalone Media UI ─
    await test.step("Delete the image via the standalone Media library UI", async () => {
      await page.goto(`${PROD_ADMIN}#/media`, {
        waitUntil: "domcontentloaded",
      });
      // The asset card carries the filename. Find it, select it, and
      // delete via the library's Delete control. We don't assume the
      // exact card markup — locate by the filename text, click it to
      // select, then click the Delete button the library shows for a
      // selected asset. The dialog handler registered up top accepts
      // the native confirm.
      const card = page.getByText(imageName, { exact: false }).first();
      await expect(
        card,
        `uploaded asset ${imageName} must be visible in the Media library`,
      ).toBeVisible({ timeout: 30_000 });
      await card.click();
      const deleteBtn = page
        .getByRole("button", { name: /^delete( selected)?$/i })
        .first();
      await expect(
        deleteBtn,
        "Media library must expose a Delete control for the selected asset",
      ).toBeVisible({ timeout: 30_000 });
      await deleteBtn.click();
      // The card must disappear from the library — proves the delete
      // was accepted client-side before we wait on the live URL.
      await expect
        .poll(
          async () =>
            (await page.locator("body").innerText()).includes(imageName),
          { timeout: 30_000 },
        )
        .toBe(false);
    });

    // ── 11. Drive the delete through to the live site ─────────────
    // Decap's GitHub backend may commit the media delete directly to
    // main OR open a cms/* PR (version-dependent). Don't assume —
    // handle both: if a cms/* PR appears whose diff removes the
    // image file, label it cms/ready so auto-merge fires; otherwise
    // the direct commit already triggered deploy-production. Either
    // way, the ground truth is the live URL going 404.
    await test.step("Label the media-delete PR cms/ready if Decap opened one", async () => {
      const deadline = Date.now() + 90_000;
      while (Date.now() < deadline) {
        let prs = [];
        try {
          prs = await gh(
            `/repos/${HOST_REPO}/pulls?state=open&base=main&per_page=50`,
          );
        } catch (_) {
          /* transient — retry */
        }
        const cmsPrs = (prs || []).filter(
          (pr) =>
            pr.head &&
            typeof pr.head.ref === "string" &&
            pr.head.ref.startsWith("cms/"),
        );
        let labelled = false;
        for (const pr of cmsPrs) {
          let files;
          try {
            files = await gh(
              `/repos/${HOST_REPO}/pulls/${pr.number}/files?per_page=100`,
            );
          } catch (_) {
            continue;
          }
          const removesImage = files.some(
            (f) => f.filename === imagePath && f.status === "removed",
          );
          if (removesImage) {
            try {
              await addLabel({ prNumber: pr.number, label: "cms/ready" });
            } catch (e) {
              console.warn(
                `[media-delete] could not label PR #${pr.number}: ${e && e.message}`,
              );
            }
            labelled = true;
            break;
          }
        }
        if (labelled) break;
        await new Promise((r) => setTimeout(r, 6000));
      }
      // Not finding a PR is fine — Decap committed straight to main.
    });

    await test.step("Wait for the image URL to 404 on adamdaniel.ai", async () => {
      // Back to the entry editor so the deploy-status pill is mounted
      // (the /media route has no toolbar/pill).
      await page.goto(`${PROD_ADMIN}#/collections/posts/entries/${FILE_SLUG}`, {
        waitUntil: "domcontentloaded",
      });
      await expect(page.getByRole("textbox", { name: /^Title$/i })).toBeVisible(
        { timeout: 30_000 },
      );
      await waitForChangeReflected({
        page,
        pillId: PILL_PROD,
        urlCheck: async () => {
          const res = await page.request.get(imageUrlAbs, {
            failOnStatusCode: false,
          });
          return res.status() === 404;
        },
        urlTimeoutMs: 15 * 60 * 1000,
      });
    });

    // ── 12. Final ground-truth assertions ─────────────────────────
    await test.step("Assert image URL 404s and post 4xx (final)", async () => {
      const imgRes = await fetch(imageUrlAbs, { cache: "no-store" });
      expect(
        imgRes.status,
        `${imageUrlAbs} must 404 after the Media-UI delete`,
      ).toBe(404);
      const postRes = await fetch(PUBLIC_URL, { cache: "no-store" });
      expect(
        postRes.status >= 400 && postRes.status < 500,
        `${PUBLIC_URL} must 4xx after unpublish`,
      ).toBe(true);
    });
  },
);

// ── Test-harness cleanup safety net ───────────────────────────────
// Mirrors cms-publish-loop-prod-mutate.spec.js. Reads the fixture
// from main; if it isn't at baseline (still published, still has a
// featured_image, or carries a run image reference) restore it. Also
// removes a leftover per-run upload if the Media-UI delete leg didn't
// land. Skips entirely when not in this spec's owning workflow.
test.afterAll(async () => {
  if (PROD_CANARY) return;
  if (!getPat()) return;
  if (process.env.RUN_PROD_MUTATE_PLAYGROUND !== "1") return;

  let current;
  try {
    current = await fetchFixtureFromMain();
  } catch (e) {
    console.warn(
      `[cleanup-harness] couldn't read ${FIXTURE_PATH} from main; skipping: ${e && e.message}`,
    );
    return;
  }
  const decoded = Buffer.from(current.content, "base64").toString("utf8");
  if (!isBaseline(decoded)) {
    console.warn(
      "[cleanup-harness] fixture on main not at baseline; restoring via Contents API",
    );
    try {
      await writeFixtureOnMain({
        fileText: buildBaselineFileText(),
        message:
          "test(media-roundtrip): harness safety-net reset of fixture (UI cleanup left mutation)",
      });
    } catch (e) {
      console.warn(
        `[cleanup-harness] fixture restore failed: ${e && e.message}`,
      );
    }
  } else {
    console.log(
      "[cleanup-harness] media-roundtrip fixture at baseline — UI cleanup succeeded",
    );
  }

  // Sweep any leftover per-run uploads (UI delete leg didn't land, or
  // the test crashed before it). The name pattern is unique to this
  // spec so this can't touch real media.
  try {
    const dir = await gh(
      `/repos/${HOST_REPO}/contents/${UPLOADS_DIR}?ref=main`,
    );
    const leftovers = (Array.isArray(dir) ? dir : []).filter(
      (f) => f.type === "file" && /^e2e-media-roundtrip-\d+\.png$/.test(f.name),
    );
    for (const f of leftovers) {
      try {
        await deleteFileFromMainIfPresent(
          `${UPLOADS_DIR}/${f.name}`,
          `test(media-roundtrip): harness safety-net delete of leftover upload ${f.name}`,
        );
        console.warn(`[cleanup-harness] removed leftover upload ${f.name}`);
      } catch (e) {
        console.warn(
          `[cleanup-harness] couldn't remove ${f.name}: ${e && e.message}`,
        );
      }
    }
  } catch (e) {
    console.warn(
      `[cleanup-harness] couldn't list ${UPLOADS_DIR}: ${e && e.message}`,
    );
  }
});
