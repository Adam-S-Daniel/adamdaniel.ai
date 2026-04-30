const { test: base, expect } = require("@playwright/test");
const { execFileSync } = require("node:child_process");

// Custom fixture that adds a rootFontSize option.
// Projects can set rootFontSize (e.g. "20px") to simulate users who configure
// a larger default font in their browser — the root <html> element's font-size
// is applied via an init script before any navigation.
//
// G3 — `TARGET=` env switch.
//
// Specs tagged `@parity` (and any other read-only spec) need to be runnable
// against:
//   - `local`   — http://localhost:4000 (default; matches playwright.config.js)
//   - `preview` — https://preview-pr<N>.adamdaniel.ai for the latest open PR
//   - `prod`    — https://adamdaniel.ai
//
// We override Playwright's built-in `baseURL` test option so every
// `page.goto(path)` AND `page.request.get(path)` call routes against the
// resolved target. Existing specs that call `page.goto("/")` or
// `page.goto("/admin/index-local.html")` become parity-aware without any
// spec-level changes — though specs that hit local-only paths
// (e.g. `index-local.html` or `localhost`-bound endpoints) will surface
// remote 404s on TARGET=prod, which is the point.
//
// The static lint at `e2e/parity-tag-lint.test.js` enforces that any spec
// tagged `@parity` is read-only (no fs writes / shell execs / decap-server
// usage), so a `TARGET=prod` run cannot mutate prod.

const TARGET = (process.env.TARGET || "local").toLowerCase();
const PROD_URL = "https://adamdaniel.ai";
const LOCAL_URL = "http://localhost:4000";

function resolveTargetBaseURL() {
  if (TARGET === "local") return LOCAL_URL;
  if (TARGET === "prod") return PROD_URL;
  if (TARGET === "preview") return resolvePreviewBaseURL();
  throw new Error(
    `Unknown TARGET="${process.env.TARGET}". Use local | preview | prod.`,
  );
}

function resolvePreviewBaseURL() {
  // Discover the latest open PR via the GitHub API and construct its preview
  // subdomain. Throws with a clear message if no open PR exists.
  let raw;
  try {
    raw = execFileSync(
      "gh",
      [
        "api",
        "repos/Adam-S-Daniel/adamdaniel.ai/pulls?state=open&sort=created&direction=desc&per_page=1",
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
  } catch (err) {
    throw new Error(
      `TARGET=preview: failed to query GitHub for the latest open PR (${err.message}). ` +
        `Ensure 'gh' is on PATH and authenticated, or run with TARGET=local.`,
    );
  }
  let pulls;
  try {
    pulls = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `TARGET=preview: GitHub API returned non-JSON: ${raw.slice(0, 200)}`,
    );
  }
  if (!Array.isArray(pulls) || pulls.length === 0) {
    throw new Error(
      "TARGET=preview: no open PR exists — preview targets cannot be resolved. " +
        "Open a PR or run with TARGET=local|prod.",
    );
  }
  const number = pulls[0].number;
  return `https://preview-pr${number}.adamdaniel.ai`;
}

exports.test = base.extend({
  rootFontSize: [null, { option: true }],

  // Override the built-in `baseURL` test option. `undefined` falls
  // through to playwright.config.js's default (localhost:4000) for the
  // local case; preview/prod resolve at fixture-init time.
  baseURL: TARGET === "local" ? undefined : resolveTargetBaseURL(),

  page: async ({ page, rootFontSize }, use) => {
    if (rootFontSize) {
      await page.addInitScript((size) => {
        document.documentElement.style.fontSize = size;
      }, rootFontSize);
    }
    await use(page);
  },
});

exports.expect = expect;
exports.TARGET = TARGET;
exports.resolveTargetBaseURL = resolveTargetBaseURL;
