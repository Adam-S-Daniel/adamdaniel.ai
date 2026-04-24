const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./e2e",
  testMatch: /regression-video\.spec\.js/,
  webServer: {
    command:
      "bundle exec jekyll build --quiet && npx serve _site -l 4000 --no-clipboard",
    port: 4000,
    reuseExistingServer: !process.env.CI,
  },
  use: {
    baseURL: "http://localhost:4000",
    viewport: { width: 1280, height: 720 },
  },
  projects: [
    {
      name: "regression-video",
      use: { browserName: "chromium" },
    },
  ],
});
