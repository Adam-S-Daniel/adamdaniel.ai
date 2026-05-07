/*
 * DOM-level wait helpers for the deploy-status pill — the editor-
 * facing signal that "your change is being deployed" / "your change
 * is live."
 *
 * Why DOM, not GHA API: the pill is what an editor watches to know
 * "is my change live yet?" Polling the GitHub Actions API for
 * deploy-production / deploy-preview success peeks under the
 * covers; it tests whether the chain MECHANICALLY worked, not
 * whether the user-facing signal updated correctly. Use these
 * helpers in any spec that wants to assert "the change reflected on
 * the site" without trusting an API peek as ground truth.
 *
 * Pill state machine (from admin/deploy-status-pill.js#renderPill):
 *
 *   no in-flight deploy      → display: none                  (hidden)
 *   deploy in_progress       → display: ""    + spinner SVG   (visible)
 *   deploy queued / pending  → display: ""    + spinner SVG   (visible)
 *   deploy success           → display: none                  (hidden)
 *   deploy failure / error   → display: ""    + "⚠ … failed"  (visible)
 *
 * The pill polls every 30 s, so its observation lags the underlying
 * deploy by up to one tick. Timeouts here account for that.
 */

const PILL_PROD = "cms-prod-status-pill";
const PILL_PREVIEW = "cms-preview-build-pill";

/**
 * Wait for the deploy-status pill's complete spinner→settled
 * lifecycle after a deploy-triggering action.
 *
 * Phase 1: pill becomes visible in spinner state (deploy started).
 * Phase 2: pill goes hidden (deploy succeeded).
 * Throws if the pill ever flips to the failure state.
 *
 * The helper deliberately does NOT consult the GitHub API — the
 * whole point is to anchor the assertion on the DOM signal an
 * editor would watch. If the pill misses the in-progress window
 * (deploy completed inside one 30-s tick), Phase 1 times out with
 * a clear diagnostic explaining the ambiguity.
 *
 * @param {object} opts
 * @param {import('@playwright/test').Page} opts.page
 * @param {string} opts.pillId — PILL_PROD or PILL_PREVIEW
 * @param {number} [opts.spinTimeoutMs=240000] — 4 min default,
 *   covers cms-editorial-workflow + auto-merge + deploy-production
 *   (or deploy-preview) startup with margin.
 * @param {number} [opts.settleTimeoutMs=300000] — 5 min default,
 *   covers the deploy run itself plus one trailing 30-s pill-poll
 *   window for the success → hidden transition.
 */
async function waitForDeployPillSettled({
  page,
  pillId,
  spinTimeoutMs = 4 * 60 * 1000,
  settleTimeoutMs = 5 * 60 * 1000,
}) {
  // Phase 1: pill enters spinner state. The waitForFunction throws
  // (via the explicit `throw` inside it) if the pill flips to
  // failure during this window — Playwright surfaces the throw as
  // the wait's rejection, with the inner message preserved.
  await page
    .waitForFunction(
      (id) => {
        const el = document.getElementById(id);
        if (!el) return false;
        if (el.style.display === "none") return false;
        if (el.innerHTML && el.innerHTML.includes("failed")) {
          throw new Error(
            "deploy-status-pill (#" + id + ") flipped to failure — see " + el.href,
          );
        }
        return true;
      },
      pillId,
      { timeout: spinTimeoutMs },
    )
    .catch((err) => {
      // Re-raise with a clearer diagnostic so the failure mode is
      // self-explanatory in CI logs without having to chase the
      // pill's source.
      const msg = err && err.message ? err.message : String(err);
      throw new Error(
        "Timed out waiting for deploy-status-pill #" +
          pillId +
          " to enter the in-progress state within " +
          spinTimeoutMs +
          "ms. Either the action that should have triggered a deploy never " +
          "did (chain broken before deploy-production / deploy-preview " +
          "fired), OR the deploy completed inside a single 30-s pill-poll " +
          "window so the spinner state was never observed by the pill. " +
          "Original: " +
          msg,
      );
    });

  // Phase 2: pill settles to hidden. Same failure-state guard, in
  // case the deploy goes from in_progress straight to failure.
  await page.waitForFunction(
    (id) => {
      const el = document.getElementById(id);
      if (!el) return true;
      if (el.innerHTML && el.innerHTML.includes("failed")) {
        throw new Error(
          "deploy-status-pill (#" + id + ") flipped to failure during settle — see " + el.href,
        );
      }
      return el.style.display === "none";
    },
    pillId,
    { timeout: settleTimeoutMs },
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
  waitForDeployPillSettled,
  expectDeployPillHidden,
};
