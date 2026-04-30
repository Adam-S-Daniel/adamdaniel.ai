const { defineConfig } = require("@playwright/test");

const DESKTOP = { width: 1920, height: 1080 };
const LAPTOP = { width: 1366, height: 768 };
const TABLET = { width: 768, height: 1024 };
const MOBILE = { width: 375, height: 667 };

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
  webServer: [
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
  ],
  use: {
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
