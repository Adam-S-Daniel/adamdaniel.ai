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
| `e2e/cms-test-helpers.js` | Writable FileSystemDirectoryHandle mock + Sveltia stubs (`buildFixtures`, `installSveltiaStubs`, `signInLocal`, `readFixtureFile`, `listFixtureDir`). Shared across all CMS-driving specs. |
| `e2e/select-specs.js` | Diff-aware spec selector — maps changed files to relevant specs so a content-only PR doesn't pay for the full e2e matrix |
| `.github/workflows/e2e-tests.yml` | CI — installs chromium + firefox + webkit, runs the selector on PRs, full matrix on push to main |

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

Some tests don't apply to all projects. Read the project config via `testInfo`:

```js
test("my test", async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.use.forcedColors === "active",
    "Gradient rendering differs in forced-colors mode",
  );
  // ...
});
```

Don't use `matchMedia()` for this — it's unreliable under Playwright's media emulation. A viewer-side check can return `false` on a project configured with `forcedColors: "active"`, and the test will run (and flake) where it should have skipped.

For heavy specs that only need single-project coverage (e.g. loading the real CMS), skip by project name:

```js
test.skip(
  testInfo.project.name !== "chromium-desktop",
  "Heavy setup — one project is enough",
);
```

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

## Non-browser specs that still live in e2e/

Some specs run under Playwright's runner purely for its discovery + parallelism, not because they need a browser:

| Spec | What it exercises |
|---|---|
| `e2e/preview-config-patch.spec.js` | `scripts/patch-preview-config.sh` — copies `admin/config.yml` into a temp dir, runs the script, asserts the patched output |
| `e2e/cloudfront-preview-router.spec.js` | Extracts the inline CloudFront Function from `infrastructure/bootstrap/template.yaml`, evals it in Node, asserts the host → S3-prefix routing table |

They ignore the `page` fixture and don't need Jekyll to be running — treat them as unit tests that happen to share the test harness.

## Driving Sveltia CMS in an e2e spec

`e2e/cms-test-helpers.js` is the shared foundation. It builds an in-memory tree from `_posts/` + `_tags/` + `_projects/` + `pages/` + `assets/` and installs a `FileSystemDirectoryHandle` mock that Sveltia's local backend talks to as if it were a real picked directory. Used by:

- `e2e/admin-cms.spec.js` — verifies the "View on Live Site" template engine for existing posts
- `e2e/cms-posts-crud.spec.js` — create + featured-image upload + edit + delete
- `e2e/cms-tags-crud.spec.js` — create + edit + delete
- `e2e/cms-projects-crud.spec.js` — create + multi-image gallery + edit + delete
- `e2e/cms-pages-crud.spec.js` — create + edit + delete (Pages is a folder collection now)

The mock is **writable**: `createWritable()` collects chunks and atomically replaces the node's content on close, so saves and deletes flow back into the fixture tree where the test can read them out via `readFixtureFile(page, ...segments)` and `listFixtureDir(page, ...segments)`. No DOM scraping required.

Other browser-level stubs:

- `window.showDirectoryPicker` returns the root mock handle.
- `IDBObjectStore.prototype.put` swallows `DataCloneError` (the mock has function properties and isn't structured-cloneable; Sveltia caches the picked handle in IndexedDB on sign-in).
- `window.open` is captured so the "View on Live Site" button records its URL instead of opening a popup.

Restricted to `chromium-desktop` because Sveltia is heavy to boot — the spec asserts app behaviour, not browser quirks.

### Sveltia config gotcha

Folder collections need **explicit** `create: true` AND `delete: true` in `admin/config*.yml`. Sveltia's `contents-page.svelte` gates the toolbar on `_type === 'entry'`, and the toolbar create/delete buttons only render when both flags are set. Implicit Decap defaults are not safe to rely on. `files:` collections never expose create/delete in Sveltia regardless of flags — convert to `folder:` if editors need to add or remove entries. `cms-config.spec.js` locks this in structurally.

## Diff-aware spec selection

The full matrix is 8 projects × ~25 specs. A content-only edit shouldn't pay for the cross-browser admin-CMS specs, the preview-bridge specs, or the CloudFront router specs — those tests can't possibly be affected. `e2e/select-specs.js` reads the PR's `git diff --name-only origin/main...HEAD` and returns one of three scopes:

- **`all`** — fanout file changed (`_layouts/`, `_includes/`, `_config.yml`, `assets/css/`, `_plugins/`, `package*.json`, `Gemfile*`, `e2e/base.js`, `e2e/cms-test-helpers.js`, `playwright*.config.js`). Run the full matrix.
- **`subset`** — match each changed file against `SPEC_RULES` and run only the resulting list, plus the always-run baseline.
- **`skip`** — only docs (`README.md`, `AGENTS.md`, `docs/`, `.agents/skills/`) changed. Run the baseline only as a smoke check.

Always-run baseline (cheap, no browser): `compute-visual-diffs.test.js`, `cms-config.spec.js`, `visual-change-guard.spec.js`, plus the spec's own changed file.

Push to main bypasses the selector and runs the full matrix, since "the diff" for a merge commit covers everything anyway.

`e2e/select-specs.test.js` covers each rule.

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
