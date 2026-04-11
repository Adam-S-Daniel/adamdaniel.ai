---
name: browser-testing
description: Write, run, and maintain Playwright e2e tests across the browser/viewport/accessibility matrix. Use when adding new e2e tests, updating the test matrix, debugging cross-browser failures, or understanding how the browser testing infrastructure works.
compatibility: Requires Node.js 20+, Ruby 3.2+ with Jekyll, Playwright browsers installed.
---

# Browser Testing Matrix

All e2e tests run across 8 Playwright projects covering browsers, viewports, text sizes, and color settings. Tests run fully parallel.

## Key files

| File | Purpose |
|---|---|
| `playwright.config.js` | Matrix definition, webServer config, parallelism |
| `e2e/base.js` | Custom fixture — extends `test` with `rootFontSize` option |
| `e2e/*.spec.js` | Test files — import `{ test, expect }` from `./base` |
| `.github/workflows/e2e-tests.yml` | CI — installs chromium + firefox + webkit |

## Matrix projects

| Project | Browser | Viewport | Special |
|---|---|---|---|
| `chromium-desktop` | Chromium | 1920×1080 | Baseline |
| `chromium-laptop` | Chromium | 1366×768 | Most common laptop |
| `chromium-mobile` | Chromium | 375×667 | Mobile form factor |
| `firefox-desktop` | Firefox | 1920×1080 | Gecko engine |
| `webkit-tablet` | WebKit | 768×1024 | Safari engine, tablet |
| `chromium-large-text` | Chromium | 1920×1080 | `rootFontSize: "20px"` |
| `chromium-light` | Chromium | 1920×1080 | `colorScheme: "light"` |
| `chromium-forced-colors` | Chromium | 1920×1080 | `forcedColors: "active"` |

## Writing a new test

1. Create `e2e/my-feature.spec.js`
2. Import from the custom fixture, not from `@playwright/test`:
   ```js
   const { test, expect } = require("./base");
   ```
3. The test automatically runs across all 8 projects.

## Skipping tests for specific conditions

Some tests don't apply to all projects. Use runtime detection:

```js
// Forced-colors strips decorative backgrounds
const isForcedColors = await page.evaluate(() =>
  window.matchMedia("(forced-colors: active)").matches,
);
test.skip(isForcedColors, "Gradient not rendered in forced-colors mode");
```

Prefer media-query detection over checking `testInfo.project.name` — it's more robust.

## Custom fixture: rootFontSize

The `e2e/base.js` fixture adds a `rootFontSize` option that injects `document.documentElement.style.fontSize` before navigation. Projects set this in `playwright.config.js`:

```js
{ name: "chromium-large-text", use: { rootFontSize: "20px" } }
```

Tests don't need to handle this — it happens automatically via the fixture.

## Adding a new matrix dimension

1. Add a new project in `playwright.config.js` → `projects[]`
2. If the dimension needs custom setup (like `rootFontSize`), add it to `e2e/base.js` as a new option
3. Update the CI workflow if a new browser is needed
4. Update `AGENTS.md` E2E testing table

## Running tests

```bash
# Full matrix (all 8 projects, parallel)
npx playwright test

# Single project
npx playwright test --project chromium-desktop

# Single file, single project
npx playwright test e2e/glow-banding.spec.js --project chromium-mobile

# With visible browser
npx playwright test --headed --project chromium-desktop

# Debug mode
npx playwright test --debug --project chromium-desktop
```

## Parallelism

- `fullyParallel: true` — tests across all projects and within files run concurrently
- Playwright auto-detects worker count from CPU cores
- The `webServer` builds Jekyll once; all workers share port 4000
- CI installs all 3 browser engines in one step for maximum parallelism

## Screenshots and video

Every test captures a screenshot (`screenshot: "on"`) and video is retained on failure (`video: "retain-on-failure"`). Artifacts are in `test-results/` and uploaded as CI artifacts.

## Visual regression

`e2e/visual-regression.spec.js` captures golden-image baselines for key pages (homepage, blog post) using `toHaveScreenshot()`. Baselines are stored per-project in `e2e/visual-regression.spec.js-snapshots/` and committed to the repo.

**How it works:**
1. Animations are frozen for deterministic screenshots
2. `toHaveScreenshot("name.png")` compares against the committed baseline
3. If the diff exceeds 1% pixel ratio, the test fails
4. CI uploads an HTML report with visual diffs as an artifact

**Update baselines after intentional changes:**
```bash
# Regenerate all baselines
npx playwright test e2e/visual-regression.spec.js --update-snapshots

# Single project
npx playwright test e2e/visual-regression.spec.js --update-snapshots --project chromium-desktop
```

**First run for a new browser project:** baselines don't exist yet and the test fails. Run `--update-snapshots` to generate them, then commit.

**Pixel-level analysis:** `glow-banding.spec.js` uses a different approach — direct pixel sampling with `pngjs` for quantitative gradient smoothness checks, independent of golden images.

## Visual showcase

**Standing rule:** after any change that could affect visual output (CSS, layouts, templates, images), regenerate the showcase before committing.

`scripts/generate-showcase.js` reads all snapshot PNGs, displays each in a labeled Playwright browser page for 3 seconds, and records the session as `recordings/visual-regression-showcase.webm`.

```bash
# Full workflow: save before, update baselines, generate before/after showcase
cp -r e2e/visual-regression.spec.js-snapshots{,-before}
npx playwright test e2e/visual-regression.spec.js --update-snapshots
node scripts/generate-showcase.js
# Commit updated snapshots + recordings/visual-regression-showcase.webm
```

If no `-before` directory exists (first run, no prior baselines), the showcase shows current snapshots only. The `-before` directory is auto-cleaned after the video is written.
