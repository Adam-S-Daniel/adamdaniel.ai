# Testing strategy

Walkthrough of every test in this repo: what each catches, when it runs, and
how the layers compose. Read this if you're adding a feature, debugging a
flaky run, or deciding whether a new test belongs in an existing spec or a
new one.

```text
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
        │  smoke, publish-flow,      │ chromium-desktop-3k only
        │  reviews dashboard         │
        ├──────────────────────────┤
        └─ visual regression ───────┘ pixel baselines, 8 viewports for
                                      public, chromium-desktop-3k for admin
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

Three independent layers decide what actually executes on a commit/PR. A
spec can be *selected* by the diff yet still no-op at runtime — keep the
layers distinct when reasoning about coverage. (The per-workflow path
lists live in AGENTS.md "Salient paths per workflow"; this section is the
spec/selector/runtime view.)

**Layer 1 — workflow-level path filters.** Each `.github/workflows/*.yml`
gates itself with `paths:`/`paths-ignore:`. The merge-gating required
checks today are `editorial / validate-content` (`cms-editorial-workflow.yml`
— fires on *every* PR, no path filter), `scan / scan` (`secrets-scan.yml` —
every PR), `parity / parity` (`parity-preview.yml` — its own caller now, not
a job inside `e2e-tests.yml`; always-run + early-skip, reporting success
immediately when no `@parity-preview` spec applies), `preview-media /
preview-media` (`preview-media.yml` — always-run + early-skip: fires on
every PR with no path filter, runs a read-only probe that a committed
`assets/images/uploads/` image resolves on the PR's `preview-pr<N>` surface
only when media-salient paths changed; on a media-salient PR it HARD-FAILS
if the preview env is absent — the trap-safe way to require `deploy-preview`
success without making the path-filtered `deploy-preview.yml` itself a
required context), and `e2e / e2e` (`e2e-tests.yml`'s single reusable-owned
job — or `e2e-stub.yml`'s same-named job on doc/infra-only PRs — which
carries a `paths-ignore:` list — so on a docs/tooling-only PR the primary
caller doesn't fire at all → see "missing-check trap"). The old separate
`select` / `unit` / `e2e (1)` / `e2e-admin` / `finalize` contexts no longer
exist as distinct required checks; they collapsed into the single `e2e / e2e`
context when the reusable took over the whole Playwright suite in one
`workflow_call` job.

**Layer 2 — the diff-aware selector** (`e2e/select-specs.js`, unit-tested
by `select-specs.test.js`).

> **This layer no longer applies to `e2e-tests.yml`.** That lane runs the
> **whole** suite once its `paths-ignore` lets it fire, fanned out one CI job
> per Playwright project inside the platform reusable — it gets its speed from
> parallelism rather than from running less, so there is no "did the selector
> miss my spec?" failure mode and no `select` job. Adding a spec needs no
> `SPEC_RULES` entry for this lane.
>
> The selector is still live, and still governs the lanes that probe a
> *deployed* surface and must genuinely no-op when a PR can't affect one:
> **`parity-preview`** and **`preview-media`**. The table below describes its
> scope logic, which remains accurate for those two lanes; the shard column is
> historical (`--shard` is deliberately unused — see the platform's
> `docs/E2E-PARALLELISM.md`).

It diffs `origin/main...HEAD` and returns `scope` = `all` | `subset` | `skip`:

| Change | Local scope | Result |
| --- | --- | --- |
| Push to `main` | — | selector bypassed; full matrix |
| Fanout file (`_layouts/`, `_includes/`, `_config.yml`, `assets/css/`, `_plugins/`, `Gemfile*`, `package*.json`, `e2e/base.js`, `playwright*.config.js`, `.github/workflows/e2e-tests.yml`) | `all` | full 8-project matrix; on the **real** lane this is *not* `all` but a subset of every `@lane:real` spec |
| A changed `e2e/*.spec.js`/`*.test.js` | `subset` | that spec adds itself (then lane-filtered) |
| Path matches a `SPEC_RULES` entry (e.g. `_posts/**` → `cms-smoke`, `blog-post`, …) | `subset` | the matched specs |
| Docs-only (`README.md`, `AGENTS.md`, `docs/`) | `skip` | baseline only |
| No rule matched / only baseline survivors | `skip` | 1-shard baseline |

The `scope=skip` baseline run executes only `compute-visual-diffs.test.js`,
`cms-config.spec.js`, `visual-change-guard.spec.js` — **fewer** than
`ALWAYS_RUN`: `canary-content.test.js` / `select-specs.test.js` run only
when their own paths change, not on a skip.

**Layer 3 — runtime self-skip.** The heavy `@lane: real` specs are
selected by `admin/**`, their fixtures, or fanout, but then `test.skip()`
at runtime unless their env opt-in is set — so they execute end-to-end
only in their dedicated workflow:

| Spec(s) | Env gate | Set by |
| --- | --- | --- |
| `cms-publish-loop`, `cms-delete-published`, `cms-unpublish-republish`, `cms-tags-lifecycle` | `RUN_HOST_REPO_PUBLISH_LOOP=1` + `CMS_E2E_PAT` | `cms-publish-loop-host.yml` (nightly/dispatch) |
| `cms-publish-loop-preview`, `cms-delete-published-preview` | `PR_NUMBER` + `PR_HEAD_REF` + `CMS_E2E_PAT` | `cms-publish-loop-preview.yml` / `cms-delete-published-preview.yml` (dispatch) |
| `cms-publish-loop-prod-mutate-preview`, `cms-unpublish-republish-preview`, `cms-tags-lifecycle-preview` (issue #999 preview-parity) | `PR_NUMBER` + `PR_HEAD_REF` + `CMS_E2E_PAT` | `cms-preview-loops.yml` (dispatch) |
| `cms-publish-loop-prod-mutate`, `cms-media-roundtrip` | `RUN_PROD_MUTATE_PLAYGROUND=1` + `CMS_E2E_PAT` + repo var `PROD_PLAYGROUND_MODE=true` | `cms-publish-loop-prod.yml` / `cms-media-roundtrip.yml` |
| `cms-publish-loop` `@canary-readonly` | `PROD_CANARY=1`, no PAT | `canary-prod.yml` (nightly) |

`admin-bundle-parity` is the only `@lane:real` spec with **no** env gate —
it actually runs in `e2e-real` on any `admin/**` change. `e2e`/`e2e-admin`
*do* export `CMS_E2E_PAT` (read-side fixture fetches) but never the
`RUN_*` opt-ins, so "selected by `admin/**`" ≠ "executed".

### The cms/* head-ref directive

Specs whose header carries `@select-skip-when-head-ref-prefix: cms/`
(every heavy CMS spec except `admin-bundle-parity`) are dropped from
selection when the PR head ref starts with `cms/` (Decap-opened editorial
PRs). Empty on cron/dispatch/push, so scheduled runs keep full coverage;
a `cms/*` canary-only changeset collapses to `scope:skip`.

### The missing-check trap and the stub mirror

`e2e-tests.yml`'s `paths-ignore:` means a docs/tooling-only PR never
fires the required `e2e / e2e` check — yet branch protection *requires*
it, so the PR would block forever. `e2e-stub.yml` fires on the byte-mirror
of that `paths-ignore:` list and emits a trivial green job named `e2e`, so
the identical `e2e / e2e` context still reports on doc/infra-only PRs
(`required-check-stubs.yml`, which used to stub several separate contexts,
no longer exists — this repo's topology now has a single `e2e` context to
stub). Upstream, cms-platform's `e2e/required-check-stub-paths.test.js`
covers this byte-mirror invariant so the two lists can't drift unnoticed.

### Footguns (verified)

- **`e2e-admin` stub gap — HISTORICAL, no longer applicable.** Under the
  OLD multi-context topology, `main.json` required a separate `e2e-admin`
  context and `required-check-stubs.yml` historically only stubbed
  `select/unit/parity/e2e (1)/finalize`, so a docs/tooling-only PR could sit
  blocked on `e2e-admin` ("Expected — waiting") until an `e2e-admin` stub job
  was added. The topology has since collapsed every e2e-family context into
  a single `e2e / e2e` check, satisfied on doc/infra-only PRs by `e2e-stub.yml`
  — there is no `e2e-admin` context left to have a stub gap in. The general
  lesson (a path-filtered required check needs a byte-mirrored stub, enforced
  upstream by cms-platform's `e2e/required-check-stub-paths.test.js`) still
  applies to whatever required contexts exist today.
- **`_sass/**` has no PR coverage** — not a fanout pattern, no
  `SPEC_RULES` match, absent from `visual-regression.yml`'s `paths:`. A
  Sass-only PR runs the baseline only, no visual signal.
- **Large tooling PRs** (`.githooks/**`, `scripts/**`) fire e2e-tests
  for real but collapse to a 1-shard baseline — green gate, near-zero
  behavioural coverage.
- **`parity` is required but has no `needs:`** and runs against the PR's
  OWN `preview-pr<N>.adamdaniel.ai` surface (`parity-preview.yml`'s
  reusable, per AGENTS.md's description of that caller), not live prod;
  if that PR's preview build is degraded, its own `parity` check fails
  independent of the diff — production health is not what's being probed.

## 3. Categories and which workflow runs them

| Workflow | Triggers | Specs |
| --- | --- | --- |
| `e2e-tests.yml` | PR only (no `push` trigger) | All `e2e/*.spec.js` and `e2e/*.test.js` (subset gated by selector on PRs) |
| `visual-regression.yml` | PR | Uses its own `playwright.regression.config.js` and `regression-video.spec.js` only (both platform-delivered via the `.cms-platform/e2e` harness, not vendored here) |
| `cms-editorial-workflow.yml` | Every PR (no path/branch filter — `validate-content` must always report for the ruleset) | Front-matter validation in-line (no specs invoked) |
| `publish-scheduled-posts.yml` | Daily cron (14:00 UTC) | Runs the platform-owned `publish_scheduled_posts.py` (invoked via the `publish-scheduled-posts.yml` reusable — not a local file in this repo); no specs |

Jekyll plugin and OAuth-proxy unit tests are now owned upstream by
cms-platform (gem `theme/spec/` + the platform `oauth-proxy/`) and run in the
platform's own CI, not on this consumer.

## 4. Test categories

### A. Always-run structural (zero browser, milliseconds)

These guard the YAML / template / JSON contracts that everything
downstream depends on. Listed in `select-specs.js`'s `ALWAYS_RUN`.

| Spec | Tests | Catches |
| --- | --- | --- |
| [`e2e/cms-config.spec.js`](../e2e/cms-config.spec.js) | 11 | Posts collection has expected fields, every folder collection has explicit `create: true` + `delete: true`, editorial workflow is on, `media_folder`/`public_folder` are flat + template-free + consistent (`public_folder == "/" + media_folder`), hint text mentions `/preview/?collection=posts`, projects has multi-image gallery, tags has name+description, pages has permalink+published. |
| [`e2e/compute-visual-diffs.test.js`](../e2e/compute-visual-diffs.test.js) | 7 | Pixel-diff math (`pixelDiffRatio`, `classifyDiff`) for the visual-regression dashboard — pure pngjs, deterministic. |
| [`e2e/visual-change-guard.spec.js`](../e2e/visual-change-guard.spec.js) | 1 | Visual regression snapshot updates are within bounds (no monster diffs slipped in unreviewed). |
| [`e2e/select-specs.test.js`](../e2e/select-specs.test.js) | 14 | The selector itself — empty changeset → skip, fanout → all, docs → baseline, etc. |
| [`e2e/visual-regression-skip-review.test.js`](../e2e/visual-regression-skip-review.test.js) | 5 | The auto-approve-when-no-diffs path in `visual-regression.yml` (workflow-level YAML invariants). |

### B. Workflow-shape lints (Ruby, no browser)

The plain-Ruby workflow-shape lints that used to live in `_plugins_test/`
have been retired — nothing in this thin-caller consumer ran them. Their
invariants are now owned upstream by **cms-platform**: the required-check-stub
path mirror is covered by `e2e/required-check-stub-paths.test.js`, and the
`finalize`-gate shape is asserted by the platform's own e2e-tests workflow
suite. The Jekyll plugin unit tests (slug normalisation, etc.) and the
OAuth-proxy Lambda tests are likewise owned upstream (gem theme/spec + the
platform `oauth-proxy/`), not vendored or run here.

### C. Public-site DOM specs (browser, all 8 projects)

These hit Jekyll-rendered pages and assert the structural contract that
external consumers (RSS, search, screen readers, the visual-regression
showcase) depend on.

| Spec | Tests | Catches |
| --- | --- | --- |
| [`e2e/blog-post.spec.js`](../e2e/blog-post.spec.js) | 3 | `/blog/<slug>/` renders post title exactly once, no spurious featured image when front matter is empty, single `<title>` in head. |
| [`e2e/tags.spec.js`](../e2e/tags.spec.js) | 7 | `/tags/` lists curated tags, every curated tag has its archive page, an archive without matching posts shows the empty-state placeholder, the homepage tag cloud renders. |
| [`e2e/not-found.spec.js`](../e2e/not-found.spec.js) | 2 | Missing URL returns HTTP 404 with the proper `404.html` chrome. |
| [`e2e/glow-banding.spec.js`](../e2e/glow-banding.spec.js) | 1 | The radial-gradient background renders without visible color banding (samples raw pixels). |
| [`e2e/cms-preview-url.spec.js`](../e2e/cms-preview-url.spec.js) | N+1 | The Posts `preview_path` template in admin/config.yml stays in sync with Jekyll's `permalink: /blog/:slug/` — every published post is reachable at the URL the CMS would generate for its "View on Live Site" button. |

### D. Live-preview surface specs (browser)

The `/preview/` page is rendered by the real Jekyll layouts and consumed
by `admin/preview-bridge.js`. Two angles cover its contract.

| Spec | Tests | Catches |
| --- | --- | --- |
| [`e2e/preview-shell.spec.js`](../e2e/preview-shell.spec.js) | 13 | `/preview/` serves 200 with site chrome, switches layouts via `?collection=`, applies postMessage / BroadcastChannel updates, refuses cross-origin messages, renders markdown widgets (images, lists, code), is `noindex`. Chromium-desktop only — DOM contract, not visual. |
| [`e2e/preview-bridge.spec.js`](../e2e/preview-bridge.spec.js) | 3 | The bridge registers a `postSave` listener with `window.CMS`, broadcasts entry data via BroadcastChannel, exposes the preview-URL helper. Stubbed `window.CMS` — no Decap boot. |
| [`e2e/preview-config-patch.spec.js`](../e2e/preview-config-patch.spec.js) | 4 | The platform-delivered `patch-preview-config.sh` (run by the preview reusable from `.cms-platform/scripts/`, not vendored here) rewrites `site_url`, `display_url`, `backend.branch` correctly and leaves `preview_path` alone. |

### E. CMS admin specs (browser, chromium-desktop-3k only)

Decap's editor DOM is identical across viewports — running these on the
8-project matrix would burn cycles for no extra coverage. Each spec is
gated to `chromium-desktop-3k` in its `beforeEach`.

| Spec | Tests | Catches |
| --- | --- | --- |
| [`e2e/cms-smoke.spec.js`](../e2e/cms-smoke.spec.js) | 2 | (1) Decap admin loads → login → create a Tag → file lands at `_tags/<slug>.md` with expected front matter → delete via editor → file removed. (2) Open an existing Posts entry; every label declared in the schema appears in the rendered form (Title, URL Slug, Date, Excerpt, Tags, Featured Image, Published, Publish Date, Body), at least 4 visible inputs/textareas, Title input's `color` differs from its `background-color` (theme contrast). |
| [`e2e/cms-publish-flow.spec.js`](../e2e/cms-publish-flow.spec.js) | 1 | True end-to-end: Decap admin → create a new post (Title, slug, body, inline tag, Published toggle) → click Publish now → file appears in `_posts/` → run `bundle exec jekyll build` → GET `/blog/<slug>/` → `.post-header h1` and `.post-content` match what was typed → GET `/tags/<inline-tag>/` → auto-generated archive lists the new post. Cleans up `_posts/` and `_site/` artifacts in `afterAll`. **This is the only test that proves the full create-and-publish loop works.** |
| [`e2e/admin-reviews-auth.spec.js`](../e2e/admin-reviews-auth.spec.js) | 1 | `/admin/reviews/` completes the Decap-style OAuth handshake (popup posts `authorizing:github`, dashboard echoes back, popup releases `authorization:github:success:<JSON>`, dashboard parses the token). Skipping any step leaves the popup spinning. |
| [`e2e/admin-reviews-stats.spec.js`](../e2e/admin-reviews-stats.spec.js) | 2 | Reviews dashboard renders the stat grid (visually different / potentially affected / new / identical) plus the per-page list from a mocked `regression.json`; falls back gracefully when the JSON is unreachable. |

### F. Visual regression (pixel baselines)

`e2e/visual-regression.spec.js` keeps pinned PNGs under
`e2e/visual-regression.spec.js-snapshots/`. Public pages run on all 8
projects (cross-browser × cross-viewport sanity); admin screens are
gated to chromium-desktop-3k.

| Snapshot | Catches |
| --- | --- |
| `homepage` | Landing-page chrome, glow gradient, tag cloud |
| `blog-post` | Post layout — header, body, footer, prose typography |
| `tags-index` | `/tags/` curation list |
| `tag-archive` | `/tags/<slug>/` archive layout |

Admin (Decap CMS) baselines were retired together with the cobalt-thermal
theme. There is no theme to drift, and the editor's WYSIWYG surface is
`/preview/?collection=<n>` rather than the form itself. The data plane
is still covered by `cms-smoke.spec.js` and `cms-editorial-workflow.spec.js`
(field render + load / save / delete round-trips).

`scripts/generate-showcase.js` produces a side-by-side video of every
snapshot when the `*-snapshots-before/` directory exists, used for PR
review.

### G. CDN routing (no browser, just function exec)

The bootstrap template (now platform-owned, in **cms-platform** at
`infrastructure/bootstrap/template.yaml`) defines two CloudFront Functions
inline. The specs (which live in the platform alongside the template) pull the
function source out of the YAML and run it in Node, so the template stays the
single source of truth.

| Spec | Tests | Catches |
| --- | --- | --- |
| [`e2e/cloudfront-preview-router.spec.js`](../e2e/cloudfront-preview-router.spec.js) | 7 | Viewer-request function maps `Host: preview-pr<N>.adamdaniel.ai` to S3 key prefix `/pr-<N>/`; leaves apex and unrelated subdomains alone; handles multi-digit PR numbers; no-host edge case. |
| [`e2e/cloudfront-preview-location-fixer.spec.js`](../e2e/cloudfront-preview-location-fixer.spec.js) | 9 | Viewer-response function strips the `/pr-<N>/` prefix from `Location` headers (so S3's trailing-slash redirects don't leak the internal key space); leaves cross-origin redirects, non-redirects, and apex hosts untouched. |

### H. Visual-regression workflow (separate config)

`e2e/regression-video.spec.js` is invoked only by
`.github/workflows/visual-regression.yml` via
`playwright.regression.config.js`. Not part of the main matrix —
listed under `testIgnore` in `playwright.config.js`. (Both configs
are platform-delivered with the `.cms-platform/e2e` harness, no
longer vendored in this repo.) It captures
per-page screenshots of the PR build vs production for the
side-by-side review video.

## 5. Where the gaps are

What this suite does *not* yet cover:

- **Editorial workflow PR creation — narrower than it used to be.** The local backend forces simple mode, so a spec can't drive the full `cms/<branch>` → PR → preview path from a hermetic local-backend test. This is NOT the same as "entirely untested", though: the preview-side round trip through a real editorial-workflow PR IS covered operationally by the `cms-preview-loops.yml` / `cms-publish-loop-preview.yml` / `cms-delete-published-preview.yml` family (real-backend, `workflow_dispatch`-gated against an open PR's preview env, not run automatically on every PR — see AGENTS.md). What remains genuinely uncovered is a hermetic/local-backend test of PR creation itself, which the local-backend-forces-simple-mode constraint above rules out. Covered structurally by `cms-config.spec.js` (asserting the flag is on) and operationally by the preview-loop family plus humans testing on `preview-pr<N>` deployments.
- **Media uploads — now covered.** `e2e/cms-image-upload.spec.js`,
  `e2e/cms-featured-image-lifecycle.spec.js`,
  `e2e/cms-inline-image.spec.js`, and `e2e/cms-project-gallery.spec.js`
  drive the Decap picker, upload a file, assert it lands directly in
  `assets/images/uploads/`, and fetch the rendered image URL for a
  real **200**. The full real-backend round trip (upload via Media UI
  → publish → image live on adamdaniel.ai → remove → delete via Media
  UI → live 404) is `e2e/cms-media-roundtrip.spec.js`, gated to
  `cms-publish-loop-prod.yml`.
- **Production OAuth handshake against the real Lambda.** `admin-reviews-auth.spec.js` simulates the popup messages directly; the real popup → Lambda → GitHub round-trip isn't reachable from a hermetic test. Covered by the OAuth-proxy unit tests upstream in cms-platform and operationally by users.
- **Accessibility.** No axe / WCAG asserts. Add if the site grows beyond a personal portfolio.
- **Pages collection's public route.** The Pages collection is enabled in the CMS but the public site routing for `pages/<slug>` is currently disabled/hidden. When that route ships, follow the **FUTURE CONTENT TYPES** pattern documented at the top of `cms-publish-flow.spec.js`: drive Decap → create entry → assert file lands → rebuild → GET the public URL → assert layout-expected DOM → cleanup. Apply the same recipe for any *new* collection added to `admin/config*.yml`.

## 6. Per-spec quick reference

```text
ALWAYS-RUN (no browser):
  cms-config.spec.js              YAML invariants                   11 tests
  compute-visual-diffs.test.js    pngjs pixel math                   7 tests
  visual-change-guard.spec.js     snapshot updates bounded           1 test
  select-specs.test.js            selector logic                    14 tests
  visual-regression-skip-review   workflow YAML                      5 tests

PUBLIC SITE (browser, 8 projects):
  blog-post.spec.js               post layout DOM                    3 tests
  tags.spec.js                    tag system structure               7 tests
  not-found.spec.js               404 page + status                  2 tests
  glow-banding.spec.js            gradient pixel sanity              1 test
  cms-preview-url.spec.js         preview_path round-trip            N+1 tests

PREVIEW SURFACE (browser, mostly chromium-desktop-3k):
  preview-shell.spec.js           /preview/ shell contract          13 tests
  preview-bridge.spec.js          bridge unit (stubbed CMS)          3 tests
  preview-config-patch.spec.js    sed script unit                    4 tests

CMS ADMIN (browser, chromium-desktop-3k):
  cms-smoke.spec.js               admin save/delete + form render    2 tests
  cms-publish-flow.spec.js        create→build→browse + auto-tag     1 test
  admin-reviews-auth.spec.js      OAuth handshake                    1 test
  admin-reviews-stats.spec.js     stats grid + fallback              2 tests

VISUAL REGRESSION (pixel baselines):
  visual-regression.spec.js       4 public (admin baselines retired)   4 tests

CDN:
  cloudfront-preview-router       host → prefix mapping              7 tests
  cloudfront-preview-location-fixer  prefix strip on redirect        9 tests

REGRESSION-VIDEO (separate config, visual-regression.yml only):
  regression-video.spec.js        PR-vs-prod screenshot grid     dynamic
```

## 7. Adding a new test — decision tree

```text
Is the thing you're testing a YAML / JSON / template invariant?
  → cms-config.spec.js (or a new always-run structural spec)

Is it a pure function in Ruby / Python?
  → upstream in cms-platform (its `theme/spec/` for gem-owned Jekyll plugins, or its own test suite) — this consumer vendors no local unit-test suite.

Does it render to a public-site URL?
  → blog-post.spec.js / tags.spec.js / a new <feature>.spec.js
  AND if it could shift visually:
  → add a new test in visual-regression.spec.js with a baseline PNG

Does it involve the Decap admin UI specifically?
  → cms-smoke.spec.js (data plane / form contract)
  → cms-publish-flow.spec.js (full create-and-browse loop)
  → admin-reviews-*.spec.js (reviews dashboard)
  Gate to chromium-desktop-3k. Decap DOM is the same across viewports.

Is it a CloudFront Function or other piece of inline-in-template code?
  → cloudfront-*.spec.js (pull source from template, exec in Node)

Is it a one-off shell script or build-time task?
  → preview-config-patch.spec.js for the sed-style pattern
```

If you're adding a new content collection, follow the
**FUTURE CONTENT TYPES** recipe at the top of
`e2e/cms-publish-flow.spec.js` — that's the canonical pattern for
"create entry via CMS → rebuild → assert public URL renders."

## Browser matrix and harness (moved from AGENTS.md)

Detail moved here from AGENTS.md's `## E2E testing` section: the full 10-project browser/viewport matrix, tag-based project routing, the custom test fixture, and CI-specific harness mechanics (sandbox CDN allowlist, per-project worker counts, apt/download bounding). One paragraph of that original section — the opening description of `e2e/visual-regression.spec.js`'s snapshot mechanism — was skipped as a duplicate of section 4.F above ("Visual regression", which already documents the same file, the same snapshot path, and the same per-project run scope); everything else was moved verbatim. The `?notheme` kill-switch HISTORICAL subsection (a retired admin theme that no longer exists in this repo) was deleted rather than moved.

### E2E testing

Every e2e test runs across a matrix of browsers, viewports, text sizes, and color settings. The matrix is defined as Playwright projects in the platform-delivered harness config (`.cms-platform/e2e/playwright.config.js`); the e2e harness is no longer vendored in this repo.

#### Browser matrix (10 projects, two lanes)

The matrix is split into a **public-page lane** (8 projects, full browser × viewport diversity for the rendered site) and an **admin lane** (2 projects, the only two browsers admin UI is exercised on). Project routing is tag-based — see "Tag-based filtering" below.

**Public-page lane** — runs every spec that does NOT carry an `@admin-*` tag. Each project's `grepInvert: /@admin-write\b|@admin-read\b/` excludes admin specs.

| Project | Browser | Viewport | Special |
| --- | --- | --- | --- |
| `chromium-desktop-1080` | Chromium | 1920×1080 | — |
| `chromium-laptop` | Chromium | 1366×768 | — |
| `chromium-mobile` | Chromium | 375×667 | — |
| `firefox-desktop` | Firefox | 1920×1080 | — |
| `webkit-tablet` | WebKit | 768×1024 | — |
| `chromium-large-text` | Chromium | 1920×1080 | Root font 20px |
| `chromium-light` | Chromium | 1920×1080 | `colorScheme: light` |
| `chromium-forced-colors` | Chromium | 1920×1080 | `forcedColors: active` |

**Admin lane** — runs only specs tagged `@admin-write` or `@admin-read`. Public-page specs do NOT run on these projects.

| Project | Browser | Viewport | Tags accepted |
| --- | --- | --- | --- |
| `chromium-desktop-3k` | Chromium | 3000×1500 | `@admin-write` + `@admin-read` |
| `webkit-iphone16` | WebKit | 393×852 (deviceScaleFactor 3, isMobile, hasTouch) | `@admin-read` only |

The two admin projects intentionally cover the two browsers a real contributor uses: Chrome on a high-DPI desktop and Safari on iPhone 16. No Windows project — see "Tag-based filtering" for the rationale.

#### Tag-based filtering

Specs that drive the admin UI are tagged via Playwright's `{ tag: [...] }` option on `test.describe(...)` or `test(...)`. The tag controls which projects the spec runs on:

| Tag | Meaning | Runs on |
| --- | --- | --- |
| `@admin-write` | Drives `/admin/*` AND mutates state (Decap Save → `cms/*` PR, decap-server FS write, etc.) | `chromium-desktop-3k` only — single browser is sufficient and writes are heavy/serial |
| `@admin-read` | Drives `/admin/*` but is read-only (DOM contract, HTTP byte parity, mocked APIs) | `chromium-desktop-3k` + `webkit-iphone16` — engine-dependent admin UI assertions need both |
| *(untagged)* | Public-page specs (`tags.spec.js`, `feeds-and-share.spec.js`, `visual-regression.spec.js`, etc.) | All 8 public-lane projects |

**Why word-bounded regexes** (`/@admin-read\b/`): Playwright's `grep` is substring-matching by default. Without the `\b`, `/@admin-read/` would match a hypothetical future tag like `@admin-readonly`, silently routing it to the wrong project. The `\b` anchors at the tag's end so `@admin-read` matches only itself.

**Tag the test.describe, not the test title.** The tag-in-title pattern (`test("foo @admin-read", ...)`) works but pollutes the test name in reports. The `{ tag: [...] }` option keeps titles clean and is the modern Playwright API.

##### iOS-anything is WebKit

iOS Chrome, iOS Firefox, iOS Edge, and iOS Safari all share the same browser engine — Apple bans third-party rendering engines on iOS. Playwright's `webkit` project covers all of them. So "iOS Chrome === iOS Safari === WebKit" — they're a single data point, not three. When triaging an iOS-only render bug, reproduce it under `webkit-tablet` (or any local WebKit) and you've covered every iOS browser.

##### Sandbox allowlist (Playwright browser downloads)

Playwright fetches its browser binaries from a small set of CDNs the first time `npx playwright install` runs. Sandboxed shells (and any local environment running `npx playwright install`) need outbound network access to:

- `cdn.playwright.dev`
- `playwright.download.prss.microsoft.com`
- `playwright.azureedge.net`

If these are blocked, `npx playwright install` hangs or fails with a 403 / DNS-resolution error.

**CI hits these CDNs — and apt — on EVERY job.** This section used to say the opposite ("CI does NOT hit these CDNs … all run inside `mcr.microsoft.com/playwright:v<version>-noble`, which ships the browsers + apt deps prebaked"), and that has been false since the platform port: the GHCR prebaked runner image, the `container:` blocks, and the `select`/`finalize` jobs it referenced were all deliberately NOT ported (cms-platform's "Deliberately NOT ported" notes). Every platform-delivered harness lane installs its browser inline instead — `npx playwright install --with-deps <engine>` — so both the CDN download and an `apt-get install` of ~90 system packages are on every job's critical path.

That is not academic: on 2026-08-07 the Ubuntu mirror served one `webkit-tablet` job at ~35 KB/s and its install took **39 minutes** (its tests took 41.6 s), which held a delete-recovery PR open for 40 minutes and failed a `cms-media-roundtrip` run — and a second lane did the same 67 minutes later. Since cms-platform v0.1.70 the install goes through the platform's `install-playwright-browsers` composite, which splits into two phases: the browser download is bounded (`timeout 420`, escalating to 1200s on the last of 3 attempts) and retried, while the apt half (`install-deps`) is retried but never bounded — bounding it once orphaned a root-owned `apt-get` that starved every retry on the dpkg lock (job 92989057569), so an unprivileged `timeout` can't safely kill it. A slow mirror now costs minutes on the download side and, on the apt side, is caught only by the job's own `timeout-minutes`. Details + measurements: cms-platform's `docs/E2E-PARALLELISM.md`.

The CDN allowlist above therefore matters for CI as well as for a fresh local clone.

#### Custom fixture (`e2e/base.js`)

Tests import `{ test, expect }` from `./base` instead of `@playwright/test`. The fixture adds:

- **`rootFontSize`** option — when set (e.g. `"20px"`), injects an init script that sets `document.documentElement.style.fontSize` before page load, simulating users with a larger browser default font.

#### Writing tests

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

#### Parallelism

`fullyParallel: true` in the config means all tests across all projects run concurrently up to the worker count. Playwright auto-detects available CPU cores. The `webServer` builds Jekyll once and is shared across all workers.

#### Screenshots and video

Every test run captures screenshots (`screenshot: "on"`) and retains video on failure (`video: "retain-on-failure"`). These are stored in `test-results/` and uploaded as CI artifacts for post-run review.

#### Visual regression

- **Threshold:** 1% pixel diff allowed (`maxDiffPixelRatio: 0.01`)
- **CI reporter:** HTML report with visual diffs uploaded as artifact
- **Update baselines:** `npx playwright test e2e/visual-regression.spec.js --update-snapshots`
- **First run for new projects:** missing baselines cause failure; generate with `--update-snapshots`

#### Visual showcase

After any change that could affect visual output, regenerate the showcase video and commit it alongside the change:

```bash
cp -r e2e/visual-regression.spec.js-snapshots{,-before}   # save old baselines
npx playwright test e2e/visual-regression.spec.js --update-snapshots
node scripts/generate-showcase.js                           # produces before/after video
```

`scripts/generate-showcase.js` displays each snapshot as a before/after side-by-side pair (3.5s per slide) and records the session as `recordings/visual-regression-showcase.webm`. If no `-before` directory exists (first run), it shows current baselines only. The `-before` directory is auto-cleaned after the video is written.
