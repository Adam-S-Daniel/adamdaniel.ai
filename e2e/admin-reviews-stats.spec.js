const { test, expect } = require("./base");

// Verifies that the /admin/reviews/ dashboard renders the visual-diff
// stats (visuallyDifferent vs potentiallyAffected, plus the per-page
// list) once a card is on screen. Mocks the GitHub API and the
// regression.json fetch so the test runs hermetically with no auth.

const FAKE_TOKEN = "ghp_fake_token_for_test";
const PR_NUMBER = 123;
const REGRESSION_JSON = {
  totals: {
    identical: 7,
    different: 2,
    new: 1,
    visuallyDifferent: 3,
    potentiallyAffected: 10,
  },
  pages: [
    { path: "/", status: "identical", diffRatio: 0 },
    { path: "/blog/", status: "identical", diffRatio: 0 },
    // allowed: literal slug used for known fixture (synthetic regression-stats payload)
    { path: "/blog/test-post/", status: "different", diffRatio: 0.123 },
    { path: "/projects/foo/", status: "different", diffRatio: 0.05 },
    // allowed: literal slug used for known fixture (synthetic regression-stats payload)
    { path: "/blog/brand-new/", status: "new", diffRatio: null },
  ],
};

test.describe("/admin/reviews/ visual-diff stats", () => {
  test("renders stat grid and per-page list from regression.json", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "chromium-desktop",
      "Single project — the stats logic is browser-agnostic and the spec is heavy",
    );

    // Pre-seed the auth token so the dashboard skips the sign-in screen.
    await page.addInitScript((token) => {
      localStorage.setItem("gh_reviews_token", token);
    }, FAKE_TOKEN);

    // Mock GitHub API responses the dashboard issues during init().
    await page.route("https://api.github.com/**", async (route) => {
      const url = route.request().url();
      const path = new URL(url).pathname;

      if (path === "/user") {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ login: "stat-spec-user" }),
        });
      }

      if (path.endsWith("/actions/runs")) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            workflow_runs: [
              {
                id: 9999,
                name: "Visual Regression",
                head_sha: "abcdef1234567890",
                pull_requests: [{ number: PR_NUMBER }],
              },
            ],
          }),
        });
      }

      if (path.endsWith("/pending_deployments")) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([
            { environment: { id: 7 } },
          ]),
        });
      }

      if (path.endsWith(`/pulls/${PR_NUMBER}`)) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            title: "Test PR title",
            head: { ref: "cms/draft-test" },
          }),
        });
      }

      return route.fulfill({ status: 404, body: "{}" });
    });

    // Mock the regression.json fetch the dashboard makes per card.
    await page.route(
      `https://preview-pr${PR_NUMBER}.adamdaniel.ai/regression.json`,
      async (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(REGRESSION_JSON),
        }),
    );

    await page.goto("/admin/reviews/");
    await expect(page.locator("#dashboard")).toBeVisible();

    // The stat-grid must render the four headline stats.
    const grid = page.locator(".review-card .stat-grid");
    await expect(grid).toBeVisible();

    // Visually different — 3
    await expect(
      grid.locator(".stat-card.stat-different .stat-value"),
    ).toHaveText("3");

    // Potentially affected — 10
    await expect(
      grid.locator(".stat-card.stat-affected .stat-value"),
    ).toHaveText("10");

    // Identical — 7
    await expect(
      grid.locator(".stat-card.stat-identical .stat-value"),
    ).toHaveText("7");

    // The per-page list of visually-different paths must include each
    // different + new entry. We don't assert order — the implementation
    // is free to reorder.
    const pagesLine = page.locator(".review-card .stat-pages");
    // allowed: literal slug used for known fixture (matches the synthetic payload above)
    await expect(pagesLine).toContainText("/blog/test-post/");
    await expect(pagesLine).toContainText("/projects/foo/");
    // allowed: literal slug used for known fixture (matches the synthetic payload above)
    await expect(pagesLine).toContainText("/blog/brand-new/");
    // Identical pages must NOT appear in the per-page list. Match on
    // the exact path (terminated by space-dot-space delimiter or end)
    // so `/blog/` doesn't false-match the `/blog/test-post/` prefix.
    const pagesText = await pagesLine.textContent();
    expect(pagesText.split(/\s·\s/)).not.toContain("/blog/");
    expect(pagesText.split(/\s·\s/)).not.toContain("/");
  });

  test("falls back gracefully when regression.json is unavailable", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "chromium-desktop",
      "Single project — the fallback path is browser-agnostic",
    );

    await page.addInitScript((token) => {
      localStorage.setItem("gh_reviews_token", token);
    }, FAKE_TOKEN);

    await page.route("https://api.github.com/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/user") {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ login: "fallback-spec-user" }),
        });
      }
      if (path.endsWith("/actions/runs")) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            workflow_runs: [
              {
                id: 8888,
                name: "Visual Regression",
                head_sha: "0123456789abcdef",
                pull_requests: [{ number: PR_NUMBER }],
              },
            ],
          }),
        });
      }
      if (path.endsWith("/pending_deployments")) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([{ environment: { id: 1 } }]),
        });
      }
      if (path.endsWith(`/pulls/${PR_NUMBER}`)) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            title: "Older PR",
            head: { ref: "cms/draft-older" },
          }),
        });
      }
      return route.fulfill({ status: 404, body: "{}" });
    });

    await page.route(
      `https://preview-pr${PR_NUMBER}.adamdaniel.ai/regression.json`,
      async (route) => route.fulfill({ status: 404, body: "" }),
    );

    await page.goto("/admin/reviews/");
    await expect(page.locator("#dashboard")).toBeVisible();

    // Card still renders, video still plays — only the stats area
    // shows a polite placeholder.
    await expect(page.locator(".review-card")).toBeVisible();
    await expect(
      page.locator(".review-card .stat-pages-loading"),
    ).toContainText(/not available/i);
  });
});
