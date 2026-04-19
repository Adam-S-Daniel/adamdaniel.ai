# adamdaniel.ai — Project Guide

Personal website and blog for Adam Daniel (Freelance AI Engineer). Jekyll static site with Sveltia CMS, AWS OAuth proxy, and PR preview environments.

## Architecture

```
Production:   adamdaniel.ai                     → CloudFront → S3
Preview:      preview-pr${N}.adamdaniel.ai      → CloudFront → S3 (/pr-${N}/)
CMS:          adamdaniel.ai/admin/              → Sveltia CMS → GitHub OAuth → Lambda
```

Each PR gets its own subdomain under `*.adamdaniel.ai`. A single
preview CloudFront distribution serves the whole preview bucket; a
viewer-request CloudFront Function maps `Host: preview-pr${N}...` to
the S3 object-key prefix `/pr-${N}/`. Pages on preview and prod share
the same root-relative URL structure (no `/pr-N/` in any visible URL).

## Key commands

```bash
# Local dev
jekyll serve --livereload          # http://localhost:4000
npx decap-server                   # CMS local backend (port 8081)

# AWS infrastructure
bash infrastructure/bootstrap/deploy.sh     # deploy/update bootstrap stack
bash oauth-proxy/deploy.sh                  # deploy OAuth proxy (needs env vars)

# Tests
cd oauth-proxy && python -m pytest test_lambda.py -v
npx playwright test                               # full browser matrix (8 projects)
npx playwright test --project chromium-desktop     # single project
npx playwright test e2e/glow-banding.spec.js       # single test file
```

## GitHub Actions secrets

| Secret | Source | Used by |
|---|---|---|
| `AWS_ROLE_ARN` | bootstrap stack output | deploy-production.yml, deploy-preview.yml |
| `PRODUCTION_CLOUDFRONT_ID` | bootstrap stack output | deploy-production.yml |
| `PREVIEW_CLOUDFRONT_ID` | bootstrap stack output | deploy-preview.yml |

## AWS resources (us-east-1)

| Resource | Name / ID |
|---|---|
| CloudFormation stack | `adamdaniel-ai-bootstrap` |
| S3 artifacts bucket | `adamdaniel-ai-cfn-artifacts` |
| S3 production bucket | `adamdaniel-ai-production` (external, not CFN-managed) |
| S3 preview bucket | `adamdaniel-ai-previews` (external, not CFN-managed) |
| CloudFront (production) | see bootstrap stack output `ProductionDistributionId` |
| CloudFront (preview) | see bootstrap stack output `PreviewDistributionId` |
| Production URL | `https://adamdaniel.ai` |
| Preview URL | `https://preview-pr${N}.adamdaniel.ai` |
| IAM role | `adamdaniel-ai-github-actions` |
| OAuth proxy stack | `adamdaniel-ai-oauth-proxy` |

## Content model

| Collection | Folder | Key fields |
|---|---|---|
| Posts | `_posts/` | title, date, tags, excerpt, featured_image, published, reading_time |
| Tags | `_tags/` | name, description |
| Projects | `_projects/` | title, technology, url_link, featured, images |
| Pages | `pages/` | about.md, contact.md |

`reading_time` is auto-calculated at build time (word count ÷ 200 + 1).

## Live preview

Editors get a WYSIWYG preview of the page they're editing without publishing. The preview always renders with the real Jekyll layouts (`_layouts/post.html`, `_layouts/page.html`, `_layouts/project.html`), so styling drift is impossible by construction.

**Surfaces:**

- `preview.md` → `/preview/` — a Jekyll page that uses `_layouts/preview.html`. Accepts `?collection=posts|pages|projects` to pick the layout shell.
- `_layouts/preview.html` — hosts the three layout variants, picks one at runtime, and listens for draft content via `window.postMessage` and a `BroadcastChannel("adamdaniel-cms-preview")`.
- `admin/preview-bridge.js` — loaded after Sveltia in both `admin/index.html` and `admin/index-local.html`. Registers a `postSave` event listener with Sveltia's public API (`CMS.registerEventListener`) and broadcasts entry data on every save.

**Flow:** editor opens `/preview/` in a second tab (or snaps it side-by-side with the admin) → edits in the CMS → hits Save → every open preview tab updates within a frame. Same-origin only: `BroadcastChannel` is origin-scoped and the `postMessage` listener rejects foreign origins.

**Markdown:** rendered client-side via [marked](https://marked.js.org/) v13. The preview layout loads marked from unpkg with a synchronous `document.write` fallback to `assets/js/marked.min.js` when the CDN is unreachable — so the markup is identical in dev and prod. Minor fidelity gap vs. kramdown (footnotes, attribute lists); acceptable for an editor preview.

**Not supported upstream yet:** Sveltia CMS ≤ 0.x doesn't expose `registerPreviewTemplate` (planned for 1.0). Until then we don't get per-keystroke live; the bridge uses `postSave` which fires on every save — including auto-saves — so the preview still feels live.

## Workflows

### `deploy-production.yml`

**Trigger:** push to `main`, or manual `workflow_dispatch`

**Jobs:** `deploy`

1. Checkout full git history (needed for Jekyll last-modified dates)
2. Calculate `reading_time` for every post (word count ÷ 200 + 1) → `_data/reading_times.yml`
3. `bundle exec jekyll build` with `JEKYLL_ENV=production`
4. AWS OIDC auth via `AWS_ROLE_ARN`
5. `aws s3 sync` → `s3://adamdaniel-ai-production/` with `--delete` and `Cache-Control: public, max-age=86400`
6. CloudFront cache invalidation at `/*`

**Concurrency:** `group: production`, `cancel-in-progress: false` — queued deploys wait, never interrupt a live deploy.

**Secrets needed:** `AWS_ROLE_ARN`, `PRODUCTION_CLOUDFRONT_ID`

---

### `deploy-preview.yml`

**Trigger:** `pull_request` types `[opened, synchronize, reopened, closed]` targeting `main`

**Secrets needed:** `AWS_ROLE_ARN`, `PREVIEW_CLOUDFRONT_ID`

#### Job: `deploy-preview` (when action ≠ `closed`)

1. Build Jekyll with no `--baseurl` → `./_site_preview/` (URLs are root-relative; the subdomain already isolates each PR)
2. Run `scripts/patch-preview-config.sh` on `_site_preview/admin/config.yml` to point Sveltia at the preview subdomain and the PR's head branch
3. AWS OIDC auth via `AWS_ROLE_ARN`
4. `aws s3 sync` → `s3://adamdaniel-ai-previews/pr-{N}/` with `no-cache` headers (S3 layout unchanged; CloudFront Function maps host → prefix)
5. CloudFront invalidation at `/pr-{N}/*` (skipped if `PREVIEW_CLOUDFRONT_ID` not set)
6. Post/update PR comment using `<!-- adamdaniel-preview-bot -->` marker to avoid duplicates

URL shown in comment:
- With `PREVIEW_CLOUDFRONT_ID`: `https://preview-pr{N}.adamdaniel.ai/`
- Without: `http://adamdaniel-ai-previews.s3-website-us-east-1.amazonaws.com/pr-{N}/` (HTTP fallback — Sveltia CMS won't work over this)

#### Job: `teardown-preview` (when action == `closed`)

1. AWS OIDC auth
2. `aws s3 rm s3://adamdaniel-ai-previews/pr-{N}/ --recursive`
3. CloudFront invalidation
4. Updates the existing `<!-- adamdaniel-preview-bot -->` comment to "cleaned up" (never creates a duplicate)

---

### `cms-editorial-workflow.yml`

**Trigger:** `pull_request` types `[opened, synchronize, labeled]` targeting `main`, only when files in `_posts/`, `_projects/`, `_tags/`, or `pages/` change.

**Secrets needed:** none (uses built-in `GITHUB_TOKEN`).

#### Job: `validate-content`

Runs on every open/update/label event:

1. Validates front matter: every `_posts/*.md` must have `title:` and `date:` fields
2. Full `bundle exec jekyll build` sanity check
3. On `opened`: creates `cms/draft` (dark blue) and `cms/ready` (green) labels if they don't exist, then applies `cms/draft` to the PR

#### Job: `auto-merge-when-ready`

Runs **only** when `cms/ready` label is added, and **only after `validate-content` passes** (`needs: validate-content`). Merges with squash, commit title: `publish: {PR title}`.

This ordering ensures broken content cannot merge to production even if `cms/ready` is applied.

#### CMS editorial flow

```
CMS creates PR (branch: cms/draft-{timestamp})
  → validate-content runs → adds cms/draft label
  → preview deployed at preview-pr{N}.adamdaniel.ai
  → editor reviews preview
  → editor (or admin) changes label: cms/draft → cms/ready
  → validate-content re-runs → if passes → auto-merge → deploy-production triggers
```

### `e2e-tests.yml`

**Trigger:** push to `main`, or pull request targeting `main`

**Jobs:** `e2e`

1. Checkout, setup Ruby 3.2 + Node 20
2. `npm ci` → install test dependencies
3. `npx playwright install chromium firefox webkit --with-deps`
4. `npx playwright test` — runs all tests across the full browser matrix
5. Upload `test-results/` artifact (7-day retention)

Tests run with `fullyParallel: true` — all 8 projects execute concurrently.

---

## E2E testing

Every e2e test runs across a matrix of browsers, viewports, text sizes, and color settings. The matrix is defined in `playwright.config.js` as Playwright projects.

### Browser matrix (8 projects)

| Project | Browser | Viewport | Special |
|---|---|---|---|
| `chromium-desktop` | Chromium | 1920×1080 | — |
| `chromium-laptop` | Chromium | 1366×768 | — |
| `chromium-mobile` | Chromium | 375×667 | — |
| `firefox-desktop` | Firefox | 1920×1080 | — |
| `webkit-tablet` | WebKit | 768×1024 | — |
| `chromium-large-text` | Chromium | 1920×1080 | Root font 20px |
| `chromium-light` | Chromium | 1920×1080 | `colorScheme: light` |
| `chromium-forced-colors` | Chromium | 1920×1080 | `forcedColors: active` |

### Custom fixture (`e2e/base.js`)

Tests import `{ test, expect }` from `./base` instead of `@playwright/test`. The fixture adds:

- **`rootFontSize`** option — when set (e.g. `"20px"`), injects an init script that sets `document.documentElement.style.fontSize` before page load, simulating users with a larger browser default font.

### Writing tests

1. Import from `./base`: `const { test, expect } = require("./base");`
2. Tests automatically run across all 8 projects — no per-test matrix setup needed.
3. To skip a test for specific projects, read the project config via `testInfo`:
   ```js
   test("my test", async ({ page }, testInfo) => {
     test.skip(
       testInfo.project.use.forcedColors === "active",
       "Gradient rendering differs in forced-colors mode",
     );
     // ...
   });
   ```
   Don't use `matchMedia()` for this — it's unreliable under Playwright's media emulation.

### Parallelism

`fullyParallel: true` in the config means all tests across all projects run concurrently up to the worker count. Playwright auto-detects available CPU cores. The `webServer` builds Jekyll once and is shared across all workers.

### Screenshots and video

Every test run captures screenshots (`screenshot: "on"`) and retains video on failure (`video: "retain-on-failure"`). These are stored in `test-results/` and uploaded as CI artifacts for post-run review.

### Visual regression

`e2e/visual-regression.spec.js` uses `toHaveScreenshot()` to compare golden-image baselines committed in `e2e/visual-regression.spec.js-snapshots/`. This runs across all matrix projects and catches unintended visual changes asynchronously in CI — no pre-commit hook needed.

- **Threshold:** 1% pixel diff allowed (`maxDiffPixelRatio: 0.01`)
- **CI reporter:** HTML report with visual diffs uploaded as artifact
- **Update baselines:** `npx playwright test e2e/visual-regression.spec.js --update-snapshots`
- **First run for new projects:** missing baselines cause failure; generate with `--update-snapshots`

### Visual showcase

After any change that could affect visual output, regenerate the showcase video and commit it alongside the change:

```bash
cp -r e2e/visual-regression.spec.js-snapshots{,-before}   # save old baselines
npx playwright test e2e/visual-regression.spec.js --update-snapshots
node scripts/generate-showcase.js                           # produces before/after video
```

`scripts/generate-showcase.js` displays each snapshot as a before/after side-by-side pair (3.5s per slide) and records the session as `recordings/visual-regression-showcase.webm`. If no `-before` directory exists (first run), it shows current baselines only. The `-before` directory is auto-cleaned after the video is written.

## Preview environment flow

1. PR opened → Jekyll builds at root (no baseurl) → sync to `s3://adamdaniel-ai-previews/pr-{N}/`
2. CloudFront cache invalidated at `/pr-{N}/*` (what the viewer-request Function rewrites requests to)
3. Bot posts `https://preview-pr{N}.adamdaniel.ai/` as PR comment
4. PR closed → S3 files deleted, CloudFront invalidated, existing comment updated to "cleaned up"

## Skills

- `.agents/skills/aws-bootstrap/` — bootstrap stack deployment and troubleshooting
- `.agents/skills/preview-environments/` — preview pipeline, CloudFront, S3 debugging
- `.agents/skills/browser-testing/` — e2e test matrix, fixtures, cross-browser testing
