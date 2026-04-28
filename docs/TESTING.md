# Testing strategy

Walkthrough of every test in this repo: what each catches, when it runs, and
how the layers compose. Read this if you're adding a feature, debugging a
flaky run, or deciding whether a new test belongs in an existing spec or a
new one.

```
        ┌─ pure structural ─────────┐
        │  YAML, regex, AST checks  │ ALWAYS RUN  (no browser, no Jekyll)
        ├──────────────────────────┤
 commit │                            │
   ↓    ├─ unit (Ruby / Python) ────┤ FANOUT or path-matched
        │  plugins / OAuth proxy     │
        ├──────────────────────────┤
        ├─ DOM specs (browser) ─────┤ path-matched
        │  blog, tags, preview…      │
        ├──────────────────────────┤
        ├─ admin specs (Decap CMS) ─┤ path-matched
        │  smoke, publish-flow,      │ chromium-desktop only
        │  reviews dashboard         │
        ├──────────────────────────┤
        └─ visual regression ───────┘ pixel baselines, 8 viewports for
                                      public, chromium-desktop for admin
```

## 1. Strategy in one paragraph

The site is a Jekyll static build of a content tree (`_posts/`, `_tags/`,
`_projects/`, `pages/`) edited through a Decap CMS admin shell at
`/admin/`, deployed to S3 + CloudFront with PR-scoped previews. The test
strategy mirrors that pipeline. Each surface — front-matter shape, plugin
output, page rendering, CMS data plane, full publish loop, visual
fidelity, OAuth handshake, CDN routing — has at least one test pinned to
the lowest layer that can catch a regression in that surface, plus a
fast-running structural baseline that runs on every commit so a broken
config never reaches the slower browser specs. We deliberately overlap
DOM-level specs with pixel-level visual regression: DOM specs catch
"the markup is wrong"; pixel specs catch "the markup is right but the
theme broke."

## 2. Trigger map: what runs when

The selector lives in [`e2e/select-specs.js`](../e2e/select-specs.js) and
is unit-tested by `select-specs.test.js`. On every PR it runs against
`git diff origin/main...HEAD` and returns one of three scopes:

| Trigger | What runs |
|---|---|
| **Push to `main`** | Selector bypassed — full Playwright matrix (8 projects × every spec) |
| Fanout file changes (any of `_layouts/`, `_includes/`, `_config.yml`, `assets/css/`, `_plugins/`, `package*.json`, `Gemfile*`, `e2e/base.js`, `playwright*.config.js`, `.github/workflows/e2e-tests.yml`) | Full matrix (anything visual could have shifted) |
| Spec file's own change | That spec runs |
| Path-matched (e.g. `_posts/<file>.md`) | Specs whose `SPEC_RULES` rule matches |
| Docs-only (`README.md`, `AGENTS.md`, `docs/`, `.agents/skills/`) | Always-run baseline only — `cms-config.spec.js`, `compute-visual-diffs.test.js`, `visual-change-guard.spec.js` |

The always-run baseline is cheap (no browser, runs in seconds) and
effectively works as a smoke-check that the YAML hasn't been corrupted
and that snapshot/diff infrastructure still builds.

## 3. Categories and which workflow runs them

| Workflow | Triggers | Specs |
|---|---|---|
| `e2e-tests.yml` | PR, push to main | All `e2e/*.spec.js` and `e2e/*.test.js` (subset gated by selector on PRs) |
| `visual-regression.yml` | PR | Uses its own `playwright.regression.config.js` and `e2e/regression-video.spec.js` only |
| `cms-editorial-workflow.yml` | PR with content-folder changes | Front-matter validation in-line (no specs invoked) |
| `publish-scheduled-posts.yml` | Hourly cron | Runs `scripts/publish_scheduled_posts.py`; no specs |

Plugin and OAuth-proxy unit tests are run inside `e2e-tests.yml` as
non-Playwright steps before the browser matrix.

## 4. Test categories

### A. Always-run structural (zero browser, milliseconds)

These guard the YAML / template / JSON contracts that everything
downstream depends on. Listed in `select-specs.js`'s `ALWAYS_RUN`.

| Spec | Tests | Catches |
|---|---|---|
| [`e2e/cms-config.spec.js`](../e2e/cms-config.spec.js) | 11 | Posts collection has expected fields, every folder collection has explicit `create: true` + `delete: true`, editorial workflow is on, `media_folder` buckets by year/month, hint text mentions `/preview/?collection=posts`, projects has multi-image gallery, tags has name+description, pages has permalink+published. |
| [`e2e/compute-visual-diffs.test.js`](../e2e/compute-visual-diffs.test.js) | 7 | Pixel-diff math (`pixelDiffRatio`, `classifyDiff`) for the visual-regression dashboard — pure pngjs, deterministic. |
| [`e2e/visual-change-guard.spec.js`](../e2e/visual-change-guard.spec.js) | 1 | Visual regression snapshot updates are within bounds (no monster diffs slipped in unreviewed). |
| [`e2e/select-specs.test.js`](../e2e/select-specs.test.js) | 14 | The selector itself — empty changeset → skip, fanout → all, docs → baseline, etc. |
| [`e2e/visual-regression-skip-review.test.js`](../e2e/visual-regression-skip-review.test.js) | 5 | The auto-approve-when-no-diffs path in `visual-regression.yml` (workflow-level YAML invariants). |

### B. Plugin and proxy unit tests (Ruby / Python, no browser)

| File | Tests | Catches |
|---|---|---|
| [`_plugins_test/auto_tag_pages_test.rb`](../_plugins_test/auto_tag_pages_test.rb) | 8 | `summarise()` correctly partitions curated vs in-line tags, sorts/dedups, normalises slugs, handles edge cases (nil tags, non-Latin names). The Jekyll-integration path is not exercised; that's covered by `cms-publish-flow.spec.js`. |
| [`_plugins_test/normalize_empty_slug_test.rb`](../_plugins_test/normalize_empty_slug_test.rb) | 9 | `normalize_empty_slug.rb` doesn't strip a real slug, does fall through to a date-derived slug when blank, etc. |
| [`oauth-proxy/test_lambda.py`](../oauth-proxy/test_lambda.py) | 13 | OAuth proxy Lambda: `/health`, `/auth` redirects to GitHub with the right scope, `/callback` returns the `authorization:github:success:<JSON>` postMessage HTML, OPTIONS preflight CORS, GitHub-token-error handling. |

### C. Public-site DOM specs (browser, all 8 projects)

These hit Jekyll-rendered pages and assert the structural contract that
external consumers (RSS, search, screen readers, the visual-regression
showcase) depend on.

| Spec | Tests | Catches |
|---|---|---|
| [`e2e/blog-post.spec.js`](../e2e/blog-post.spec.js) | 3 | `/blog/<slug>/` renders post title exactly once, no spurious featured image when front matter is empty, single `<title>` in head. |
| [`e2e/tags.spec.js`](../e2e/tags.spec.js) | 7 | `/tags/` lists curated tags, every curated tag has its archive page, an archive without matching posts shows the empty-state placeholder, the homepage tag cloud renders. |
| [`e2e/not-found.spec.js`](../e2e/not-found.spec.js) | 2 | Missing URL returns HTTP 404 with the proper `404.html` chrome. |
| [`e2e/glow-banding.spec.js`](../e2e/glow-banding.spec.js) | 1 | The radial-gradient background renders without visible color banding (samples raw pixels). |
| [`e2e/cms-preview-url.spec.js`](../e2e/cms-preview-url.spec.js) | N+1 | The Posts `preview_path` template in admin/config.yml stays in sync with Jekyll's `permalink: /blog/:slug/` — every published post is reachable at the URL the CMS would generate for its "View on Live Site" button. |

### D. Live-preview surface specs (browser)

The `/preview/` page is rendered by the real Jekyll layouts and consumed
by `admin/preview-bridge.js`. Two angles cover its contract.

| Spec | Tests | Catches |
|---|---|---|
| [`e2e/preview-shell.spec.js`](../e2e/preview-shell.spec.js) | 13 | `/preview/` serves 200 with site chrome, switches layouts via `?collection=`, applies postMessage / BroadcastChannel updates, refuses cross-origin messages, renders markdown widgets (images, lists, code), is `noindex`. Chromium-desktop only — DOM contract, not visual. |
| [`e2e/preview-bridge.spec.js`](../e2e/preview-bridge.spec.js) | 3 | The bridge registers a `postSave` listener with `window.CMS`, broadcasts entry data via BroadcastChannel, exposes the preview-URL helper. Stubbed `window.CMS` — no Decap boot. |
| [`e2e/preview-config-patch.spec.js`](../e2e/preview-config-patch.spec.js) | 4 | `scripts/patch-preview-config.sh` rewrites `site_url`, `display_url`, `backend.branch` correctly and leaves `preview_path` alone. |

### E. CMS admin specs (browser, chromium-desktop only)

Decap's editor DOM is identical across viewports — running these on the
8-project matrix would burn cycles for no extra coverage. Each spec is
gated to `chromium-desktop` in its `beforeEach`.

| Spec | Tests | Catches |
|---|---|---|
| [`e2e/cms-smoke.spec.js`](../e2e/cms-smoke.spec.js) | 2 | (1) Decap admin loads → login → create a Tag → file lands at `_tags/<slug>.md` with expected front matter → delete via editor → file removed. (2) Open an existing Posts entry; every label declared in the schema appears in the rendered form (Title, URL Slug, Date, Excerpt, Tags, Featured Image, Published, Publish Date, Body), at least 4 visible inputs/textareas, Title input's `color` differs from its `background-color` (theme contrast). |
| [`e2e/cms-publish-flow.spec.js`](../e2e/cms-publish-flow.spec.js) | 1 | True end-to-end: Decap admin → create a new post (Title, slug, body, inline tag, Published toggle) → click Publish now → file appears in `_posts/` → run `bundle exec jekyll build` → GET `/blog/<slug>/` → `.post-header h1` and `.post-content` match what was typed → GET `/tags/<inline-tag>/` → auto-generated archive lists the new post. Cleans up `_posts/` and `_site/` artifacts in `afterAll`. **This is the only test that proves the full create-and-publish loop works.** |
| [`e2e/admin-reviews-auth.spec.js`](../e2e/admin-reviews-auth.spec.js) | 1 | `/admin/reviews/` completes the Decap-style OAuth handshake (popup posts `authorizing:github`, dashboard echoes back, popup releases `authorization:github:success:<JSON>`, dashboard parses the token). Skipping any step leaves the popup spinning. |
| [`e2e/admin-reviews-stats.spec.js`](../e2e/admin-reviews-stats.spec.js) | 2 | Reviews dashboard renders the stat grid (visually different / potentially affected / new / identical) plus the per-page list from a mocked `regression.json`; falls back gracefully when the JSON is unreachable. |

### F. Visual regression (pixel baselines)

`e2e/visual-regression.spec.js` keeps pinned PNGs under
`e2e/visual-regression.spec.js-snapshots/`. Public pages run on all 8
projects (cross-browser × cross-viewport sanity); admin screens are
gated to chromium-desktop.

| Snapshot | Catches |
|---|---|
| `homepage` | Landing-page chrome, glow gradient, tag cloud |
| `blog-post` | Post layout — header, body, footer, prose typography |
| `tags-index` | `/tags/` curation list |
| `tag-archive` | `/tags/<slug>/` archive layout |
| `admin-login` | Decap login screen with the cobalt-thermal background. Catches a Decap major-version DOM rewrite that breaks the splash-fadeout. |
| `admin-posts-list` | Decap collection list — sidebar, header, sort/filter chrome. |
| `admin-new-post` | The big one — every form field rendering at the right place. The screen this whole subsystem almost shipped broken. |
| `admin-reviews-dashboard` | Unauthenticated state of `/admin/reviews/` — title, "Sign in with GitHub" button, cobalt glow. |

`scripts/generate-showcase.js` produces a side-by-side video of every
snapshot when the `*-snapshots-before/` directory exists, used for PR
review.

### G. CDN routing (no browser, just function exec)

`infrastructure/bootstrap/template.yaml` defines two CloudFront Functions
inline. The specs pull the function source out of the YAML and run it in
Node, so the template stays the single source of truth.

| Spec | Tests | Catches |
|---|---|---|
| [`e2e/cloudfront-preview-router.spec.js`](../e2e/cloudfront-preview-router.spec.js) | 7 | Viewer-request function maps `Host: preview-pr<N>.adamdaniel.ai` to S3 key prefix `/pr-<N>/`; leaves apex and unrelated subdomains alone; handles multi-digit PR numbers; no-host edge case. |
| [`e2e/cloudfront-preview-location-fixer.spec.js`](../e2e/cloudfront-preview-location-fixer.spec.js) | 9 | Viewer-response function strips the `/pr-<N>/` prefix from `Location` headers (so S3's trailing-slash redirects don't leak the internal key space); leaves cross-origin redirects, non-redirects, and apex hosts untouched. |

### H. Visual-regression workflow (separate config)

`e2e/regression-video.spec.js` is invoked only by
`.github/workflows/visual-regression.yml` via
`playwright.regression.config.js`. Not part of the main matrix —
listed under `testIgnore` in `playwright.config.js`. It captures
per-page screenshots of the PR build vs production for the
side-by-side review video.

## 5. Where the gaps are

What this suite does *not* yet cover:

- **Editorial workflow PR creation.** The local backend forces simple mode, so we can't drive the full `cms/<branch>` → PR → preview path from a spec. Covered structurally by `cms-config.spec.js` (asserting the flag is on) and operationally only by humans testing on `preview-pr<N>` deployments.
- **Media uploads (Featured Image widget).** No spec drives the Decap image picker, uploads a file, and verifies it lands in `assets/images/uploads/<year>/<month>/`. The widget renders (visual regression catches that), but the upload code path is untested.
- **Production OAuth handshake against the real Lambda.** `admin-reviews-auth.spec.js` simulates the popup messages directly; the real popup → Lambda → GitHub round-trip isn't reachable from a hermetic test. Covered by the unit tests in `oauth-proxy/test_lambda.py` and operationally by users.
- **Accessibility.** No axe / WCAG asserts. Add if the site grows beyond a personal portfolio.
- **Pages collection's public route.** The Pages collection is enabled in the CMS but the public site routing for `pages/<slug>` is currently disabled/hidden. When that route ships, follow the **FUTURE CONTENT TYPES** pattern documented at the top of `cms-publish-flow.spec.js`: drive Decap → create entry → assert file lands → rebuild → GET the public URL → assert layout-expected DOM → cleanup. Apply the same recipe for any *new* collection added to `admin/config*.yml`.

## 6. Per-spec quick reference

```
ALWAYS-RUN (no browser):
  cms-config.spec.js              YAML invariants                   11 tests
  compute-visual-diffs.test.js    pngjs pixel math                   7 tests
  visual-change-guard.spec.js     snapshot updates bounded           1 test
  select-specs.test.js            selector logic                    14 tests
  visual-regression-skip-review   workflow YAML                      5 tests

UNIT (Ruby / Python):
  _plugins_test/auto_tag_pages_test.rb        plugin shaping          8 cases
  _plugins_test/normalize_empty_slug_test.rb  slug fallback           9 cases
  oauth-proxy/test_lambda.py                  Lambda handler         13 cases

PUBLIC SITE (browser, 8 projects):
  blog-post.spec.js               post layout DOM                    3 tests
  tags.spec.js                    tag system structure               7 tests
  not-found.spec.js               404 page + status                  2 tests
  glow-banding.spec.js            gradient pixel sanity              1 test
  cms-preview-url.spec.js         preview_path round-trip            N+1 tests

PREVIEW SURFACE (browser, mostly chromium-desktop):
  preview-shell.spec.js           /preview/ shell contract          13 tests
  preview-bridge.spec.js          bridge unit (stubbed CMS)          3 tests
  preview-config-patch.spec.js    sed script unit                    4 tests

CMS ADMIN (browser, chromium-desktop):
  cms-smoke.spec.js               admin save/delete + form render    2 tests
  cms-publish-flow.spec.js        create→build→browse + auto-tag     1 test
  admin-reviews-auth.spec.js      OAuth handshake                    1 test
  admin-reviews-stats.spec.js     stats grid + fallback              2 tests

VISUAL REGRESSION (pixel baselines):
  visual-regression.spec.js       4 public + 4 admin                 8 tests

CDN:
  cloudfront-preview-router       host → prefix mapping              7 tests
  cloudfront-preview-location-fixer  prefix strip on redirect        9 tests

REGRESSION-VIDEO (separate config, visual-regression.yml only):
  regression-video.spec.js        PR-vs-prod screenshot grid     dynamic
```

## 7. Adding a new test — decision tree

```
Is the thing you're testing a YAML / JSON / template invariant?
  → cms-config.spec.js (or a new always-run structural spec)

Is it a pure function in Ruby / Python?
  → _plugins_test/*.rb or oauth-proxy/test_lambda.py

Does it render to a public-site URL?
  → blog-post.spec.js / tags.spec.js / a new <feature>.spec.js
  AND if it could shift visually:
  → add a new test in visual-regression.spec.js with a baseline PNG

Does it involve the Decap admin UI specifically?
  → cms-smoke.spec.js (data plane / form contract)
  → cms-publish-flow.spec.js (full create-and-browse loop)
  → admin-reviews-*.spec.js (reviews dashboard)
  Gate to chromium-desktop. Decap DOM is the same across viewports.

Is it a CloudFront Function or other piece of inline-in-template code?
  → cloudfront-*.spec.js (pull source from template, exec in Node)

Is it a one-off shell script or build-time task?
  → preview-config-patch.spec.js for the sed-style pattern
```

If you're adding a new content collection, follow the
**FUTURE CONTENT TYPES** recipe at the top of
`e2e/cms-publish-flow.spec.js` — that's the canonical pattern for
"create entry via CMS → rebuild → assert public URL renders."
