const { defineConfig } = require("@playwright/test");

const DESKTOP = { width: 1920, height: 1080 };
const LAPTOP = { width: 1366, height: 768 };
const TABLET = { width: 768, height: 1024 };
const MOBILE = { width: 375, height: 667 };

// G3 — `TARGET=` env switch. Local is the default for every dev run and
// the existing CI matrix; preview/prod skip the local Jekyll + decap-server
// bring-up because they hit deployed surfaces directly via the `baseURL`
// fixture override in `e2e/base.js`.
const TARGET = (process.env.TARGET || "local").toLowerCase();
const IS_LOCAL = TARGET === "local";

module.exports = defineConfig({
  testDir: "./e2e",
  testIgnore: /regression-video\.spec\.js/,
  fullyParallel: true,
  // Single auto-retry on CI for the decap-server file-write race (and any
  // similar transient flake). Local runs stay at 0 so a regression caught
  // while iterating fails loudly the first time. A test that fails once
  // and then passes lands in Playwright's report as "flaky" — visible,
  // but doesn't block the merge gate.
  retries: process.env.CI ? 1 : 0,
  // Only spin up the local Jekyll build + decap-server when targeting
  // `local`. Preview/prod runs hit deployed surfaces and don't need
  // either process — running them would be ~30s of wasted bring-up plus
  // a hard fail when bundler/jekyll aren't installed in the remote-only
  // job's container.
  webServer: IS_LOCAL
    ? [
        {
          command:
            "bundle exec jekyll build --quiet && npx serve _site -l 4000 --no-clipboard",
          port: 4000,
          reuseExistingServer: !process.env.CI,
        },
        {
          // Decap CMS local-backend proxy: handles file IO for `local_backend: true`
          // in admin/config-local.yml. Without it, the smoke spec's Login →
          // Save / Delete cycle has nowhere to write to.
          command: "npx decap-server",
          port: 8081,
          reuseExistingServer: !process.env.CI,
        },
      ]
    : undefined,
  use: {
    // Default baseURL — picked up by `page.goto("/foo")` and
    // `page.request.get("/foo")` calls in every spec. The `TARGET=` env
    // switch (G3) overrides this fixture at module-init time via
    // `e2e/base.js`: when TARGET=preview or TARGET=prod, the custom
    // `test` extends `baseURL` to resolve at fixture creation
    // (https://preview-pr<latest>.adamdaniel.ai or https://adamdaniel.ai),
    // so every path-relative request routes there instead. The CI matrix
    // drives `TARGET=prod` against the `@parity` subset on every PR; see
    // `.github/workflows/e2e-tests.yml` and the
    // `e2e/parity-tag-lint.test.js` read-only guard.
    baseURL: "http://localhost:4000",
    screenshot: "on",
    video: "retain-on-failure",
  },
  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.01,
    },
  },
  reporter: process.env.CI
    ? [["html", { open: "never" }], ["list"]]
    : [["list"]],
  projects: [
    // Browsers × viewports
    {
      name: "chromium-desktop",
      use: { browserName: "chromium", viewport: DESKTOP },
    },
    {
      name: "chromium-laptop",
      use: { browserName: "chromium", viewport: LAPTOP },
    },
    {
      name: "chromium-mobile",
      use: { browserName: "chromium", viewport: MOBILE },
    },
    {
      name: "firefox-desktop",
      use: { browserName: "firefox", viewport: DESKTOP },
    },
    {
      name: "webkit-tablet",
      use: { browserName: "webkit", viewport: TABLET },
    },

    // Text size
    {
      name: "chromium-large-text",
      use: { browserName: "chromium", viewport: DESKTOP, rootFontSize: "20px" },
    },

    // Color settings
    {
      name: "chromium-light",
      use: { browserName: "chromium", viewport: DESKTOP, colorScheme: "light" },
    },
    {
      name: "chromium-forced-colors",
      use: {
        browserName: "chromium",
        viewport: DESKTOP,
        forcedColors: "active",
      },
    },
  ],
});
