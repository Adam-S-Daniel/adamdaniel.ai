/*
 * DOM-level wait helpers for the deploy-status pill — the editor-
 * facing signal that "your change is being deployed" / "your change
 * is live."
 *
 * Why DOM, not GHA API: the pill is what an editor watches to know
 * "is my change live yet?" Polling the GitHub Actions API for
 * deploy-production / deploy-preview success peeks under the
 * covers; it tests whether the chain MECHANICALLY worked, not
 * whether the user-facing signal updated correctly.
 *
 * Pill state machine (from admin/deploy-status-pill.js#renderPill):
 *
 *   no in-flight deploy      → display: none                  (hidden)
 *   deploy in_progress       → display: ""    + spinner SVG   (visible)
 *   deploy queued / pending  → display: ""    + spinner SVG   (visible)
 *   deploy success           → display: none                  (hidden)
 *   deploy failure / error   → display: ""    + "⚠ … failed"  (visible)
 *
 * Why we don't gate on observing the spinner state itself: the pill
 * polls every 30 s, and the deploy-production / deploy-preview
 * runs typically have an in_progress phase of just 15–30 s before
 * the GitHub Deployment status flips to success. If the pill's
 * 30-s tick lands outside that narrow window, the editor (and the
 * test) sees `display: none` → `display: none` with no spinner ever
 * rendering. That's not a bug — that's just a fast deploy.
 *
 * What we DO gate on:
 *   1. The URL on the live site has the expected content (or has
 *      404'd, for the delete case). This is the actual user-facing
 *      surface; if it reflects the change, the chain landed.
 *   2. The pill is in its terminal hidden / non-failure state.
 *      Catches the regression where the deploy succeeded but the
 *      editor's signal got stuck spinning, or flipped to failure
 *      mid-flight.
 *   3. The pill never went to the failure state during the wait.
 */

const { augmentTimeoutError } = require("./with-stuck-pr-diagnostic");

const PILL_PROD = "cms-prod-status-pill";
const PILL_PREVIEW = "cms-preview-build-pill";

/**
 * Wait for a deploy-triggering action to be reflected on the live
 * site, with the deploy-status pill as a parallel observation.
 *
 * Polls the URL until `urlCheck` returns true, then asserts the pill
 * is in its terminal hidden state (allowing 90 s for one trailing
 * pill poll). Throws immediately if the pill flips to failure at
 * any point during the wait.
 *
 * @param {object} opts
 * @param {import('@playwright/test').Page} opts.page — must be on
 *   an entry editor URL where deploy-status-pill.js has injected
 *   the pill into the toolbar. Collection-list pages don't have
 *   the toolbar, so the pill never mounts there.
 * @param {string} opts.pillId — PILL_PROD or PILL_PREVIEW.
 * @param {() => Promise<boolean>} opts.urlCheck — async function
 *   the helper polls; returns true once the URL reflects the
 *   change. For publish flows: fetch URL, check it 200s with the
 *   expected marker. For delete flows: fetch URL, check 4xx.
 * @param {number} [opts.urlTimeoutMs=10*60*1000] — total budget for
 *   the URL to reflect the change. Covers cms-editorial-workflow +
 *   auto-merge + deploy-production/deploy-preview + CDN.
 * @param {number} [opts.urlPollMs=8000] — interval between URL polls.
 * @param {number} [opts.pillTerminalTimeoutMs=120_000] — once the
 *   URL reflects the change, allow this long for the pill's last
 *   poll to land it in the terminal hidden state.
 */
async function waitForChangeReflected({
  page,
  pillId,
  urlCheck,
  urlTimeoutMs = 10 * 60 * 1000,
  urlPollMs = 8000,
  pillTerminalTimeoutMs = 120_000,
}) {
  if (typeof urlCheck !== "function") {
    throw new Error("waitForChangeReflected requires an async urlCheck() function.");
  }

  const deadline = Date.now() + urlTimeoutMs;
  let urlReflected = false;
  while (Date.now() < deadline) {
    // Fast-fail if the pill ever flips to the failure state. We
    // check this BEFORE the URL probe so a pre-existing failure
    // doesn't get masked by a stale URL response.
    const pillFailed = await page.evaluate((id) => {
      const el = document.getElementById(id);
      return Boolean(el && el.innerHTML && el.innerHTML.includes("failed"));
    }, pillId);
    if (pillFailed) {
      const href = await page.evaluate((id) => {
        const el = document.getElementById(id);
        return el && el.href ? el.href : "";
      }, pillId);
      throw new Error(
        `deploy-status-pill (#${pillId}) flipped to failure during wait — see ${href}`,
      );
    }

    if (await urlCheck()) {
      urlReflected = true;
      break;
    }

    await page.waitForTimeout(urlPollMs);
  }

  if (!urlReflected) {
    throw await augmentTimeoutError(
      new Error(
        `Timed out waiting for the URL to reflect the change within ${urlTimeoutMs}ms. ` +
          `The deploy-triggering action may not have fired the chain, or the chain may ` +
          `still be running past this budget. Check the pill state for in-flight clues.`,
      ),
      { waitingFor: "URL to reflect change (deploy chain)", kind: "url" },
    );
  }

  // URL is reflecting the change. Wait for the pill to settle into
  // its terminal hidden / non-failure state. The pill polls every
  // 30 s, so allow up to two ticks for it to catch up after the
  // deploy's final status event.
  await page.waitForFunction(
    (id) => {
      const el = document.getElementById(id);
      if (!el) return true;
      if (el.innerHTML && el.innerHTML.includes("failed")) {
        throw new Error(
          "deploy-status-pill (#" + id + ") flipped to failure after URL change — see " + el.href,
        );
      }
      return el.style.display === "none";
    },
    pillId,
    { timeout: pillTerminalTimeoutMs },
  );
}

/**
 * Verify the pill is currently in its terminal hidden state. Use as
 * a precondition before driving an action — if the pill is still
 * spinning from a prior run, the test's lifecycle observation will
 * be confounded.
 */
async function expectDeployPillHidden({ page, pillId, timeoutMs = 90_000 }) {
  await page.waitForFunction(
    (id) => {
      const el = document.getElementById(id);
      if (!el) return true;
      if (el.innerHTML && el.innerHTML.includes("failed")) {
        throw new Error(
          "deploy-status-pill (#" + id + ") is in failure state — clear it before driving the next action",
        );
      }
      return el.style.display === "none";
    },
    pillId,
    { timeout: timeoutMs },
  );
}

module.exports = {
  PILL_PROD,
  PILL_PREVIEW,
  waitForChangeReflected,
  expectDeployPillHidden,
};
