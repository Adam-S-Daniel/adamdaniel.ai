# adamdaniel.ai — Project Guide

Personal website and blog for Adam Daniel (Freelance AI Engineer). Jekyll static site with Decap CMS, AWS OAuth proxy, and PR preview environments.

## Test-Driven Design

- **Red-green TDD.** Write a failing test first, then make it pass, then refactor. Always follow this cycle.
- **Never bypass the UI in a UI test.** If a spec exists to validate that an editor's click does what we expect — driving Decap admin, the deploy-status pill, the publish-via-auto-merge shim from the editor's POV — the test MUST go through the actual UI. Calling the underlying API programmatically (e.g. `page.evaluate(fetch(...))` against the GitHub API, hitting the shim's `__callDelete` directly, peeking at workflow runs / PR state instead of waiting for the user-visible signal) defeats the test's purpose and lets a broken UI silently regress. If the UI is broken, the test surfacing that breakage IS the point — fix the UI, don't paper over it. The publish-via-auto-merge-browser.spec.js route-mocked unit test exists for the shim's internal contract; the real-network specs (`cms-publish-loop*`, `cms-delete-published`) cover the Decap-UI-driven chain end-to-end and must keep doing so.

## Architecture

```
Production:   adamdaniel.ai                     → CloudFront → S3
Preview:      preview-pr${N}.adamdaniel.ai      → CloudFront → S3 (/pr-${N}/)
CMS:          adamdaniel.ai/admin/              → Decap CMS → GitHub OAuth → Lambda
```

Each PR gets its own subdomain under `*.adamdaniel.ai`. A single
preview CloudFront distribution serves the whole preview bucket; a
viewer-request CloudFront Function maps `Host: preview-pr${N}...` to
the S3 object-key prefix `/pr-${N}/`, and a sibling viewer-response
Function strips the same prefix from `Location` headers so S3's
trailing-slash redirects (e.g. `/admin` → `/admin/`) don't leak the
internal key space. Pages on preview and prod share the same
root-relative URL structure (no `/pr-N/` in any visible URL).

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
| `CMS_E2E_PAT` | fine-grained PAT, host repo only | `e2e/cms-publish-loop*.spec.js`, `e2e/cms-delete-published.spec.js` (drive the full Decap → cms PR → auto-merge → deploy → public-URL loop, plus the shim-dispatched delete-via-pr workflow). Token permissions: `Contents: r/w`, `Pull requests: r/w`, `Actions: r/w`, `Metadata: r`. **`Actions: r/w` is required** — the shim in `admin/publish-via-auto-merge.js` calls `POST /actions/workflows/delete-via-pr.yml/dispatches` when the operator clicks "Delete published entry" and hits the 422 from the ruleset; that endpoint is gated by the Actions permission, NOT the similarly-named Workflows permission (which only controls editing workflow files). |

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

| Collection | Folder | Type | Key fields |
|---|---|---|---|
| Posts | `_posts/` | folder | title, date, tags, excerpt, featured_image, published, publish_date |
| Tags | `_tags/` | folder | name, description |
| Projects | `_projects/` | folder | title, technology, url_link, featured, images (gallery) |
| Pages | `pages/` | folder | title, body, permalink, published (was `files:` until PR #33) |
| E2E Canaries | `_e2e/` | folder | system collection used by `e2e/cms-publish-loop*.spec.js` and `e2e/cms-delete-published.spec.js`; URLs at `/e2e/canary-{post,page,project}/`. Excluded from feeds, sitemap, and listings; rendered with `noindex,nofollow`. The publish-loop tests drive admin actions against these stable, unadvertised entries and assert the result on the public site. Between runs the body is reset to a baseline so the URLs always show innocuous content. `create: false, delete: true`: tests seed throw-away `canary-delete-<runId>.md` fixtures via labelled PRs (not via the Decap UI's "Add" button), so `create: false` is fine, but `delete: true` IS REQUIRED — the delete-spec drives the Decap UI's "Delete published entry" menuitem, which Decap only renders when the collection allows deletes. The `[E2E TEST FIXTURES — DO NOT EDIT]` collection label is the convention-only guardrail against accidental editor-driven deletion. |

Every folder collection in `admin/config*.yml` ships with **explicit** `create: true` AND `delete: true`. Decap defaults both to true, but spelling them out keeps editor capabilities visible in the YAML and survives any future major-version default change. The `cms-config.spec.js` invariants enforce this for posts/tags/projects/pages. **Caveat for tests that drive UI delete:** Decap respects `delete: false` and renders the status menu without a delete option — a UI-driven delete spec on a `delete: false` collection cannot work (run #25491225206 hit exactly this on the e2e collection: 30 s click timeout because the "Delete published entry" menuitem never rendered). If you add a UI-delete spec to any collection, audit that collection's `delete:` flag.

The earlier Sveltia CMS bundle silently ignored `publish_mode: editorial_workflow` (the upstream feature is unimplemented as of 0.158), so every Save tried to commit straight to `main` and got rejected by GitHub's branch ruleset with "Repository rule violations found / Changes must be made through a pull request." Switching back to Decap fixed both Save and Delete because Decap implements the editorial workflow: each Save lands on a `cms/...` branch and opens a PR. See PR history for the swap commit.

`reading_time` is computed at build time (word count ÷ 200 + 1) — there is no editor-facing field.

### Atom feeds

Per-tag Atom feeds at `/tags/<slug>/feed.xml` are generated by `_plugins/tag_feeds.rb`, mirroring `jekyll-feed`'s shape so the same readers parse both. The plugin is order-independent: it collects tags directly from posts rather than reading `site.config["all_tags"]` left by `auto_tag_pages.rb`, so it works whether `auto_tag_pages` runs before or after it. The feed XML body lives in `_layouts/atom_feed.xml`. The RSS icon is rendered by `_includes/feed-link.html`, mounted on `_layouts/default.html` (site-wide feed) and `_layouts/tag.html` (per-tag feed). The site-wide feed at `/feed.xml` continues to come from `jekyll-feed`.

Editor-facing walkthrough: [`docs/CONTENT_GUIDE.md`](docs/CONTENT_GUIDE.md).

## Live preview

Editors get a WYSIWYG preview of the page they're editing without publishing. The preview always renders with the real Jekyll layouts (`_layouts/post.html`, `_layouts/page.html`, `_layouts/project.html`), so styling drift is impossible by construction.

**Surfaces:**

- `preview.md` → `/preview/` — a Jekyll page that uses `_layouts/preview.html`. Accepts `?collection=posts|pages|projects` to pick the layout shell.
- `_layouts/preview.html` — hosts the three layout variants, picks one at runtime, and listens for draft content via `window.postMessage` and a `BroadcastChannel("adamdaniel-cms-preview")`.
- `admin/preview-bridge.js` — loaded after Decap in both `admin/index.html` and `admin/index-local.html`. Registers a `postSave` event listener with Decap's public API (`CMS.registerEventListener`) and broadcasts entry data on every save.

**Flow:** editor opens `/preview/` in a second tab (or snaps it side-by-side with the admin) → edits in the CMS → hits Save → every open preview tab updates within a frame. Same-origin only: `BroadcastChannel` is origin-scoped and the `postMessage` listener rejects foreign origins.

**Markdown:** rendered client-side via [marked](https://marked.js.org/) v13. The preview layout loads marked from unpkg with a synchronous `document.write` fallback to `assets/js/marked.min.js` when the CDN is unreachable — so the markup is identical in dev and prod. Minor fidelity gap vs. kramdown (footnotes, attribute lists); acceptable for an editor preview.

**Per-keystroke updates:** the bridge uses Decap's `postSave` event, which fires on every save (including auto-saves), not on every keystroke. Decap also exposes `CMS.registerPreviewTemplate` for inline previews — we don't use it because the `/preview/` real-layout approach renders with the actual Jekyll layouts, which an inline preview can't match without duplicating the layout HTML.

## Analytics

Real-user monitoring is via Amazon CloudWatch RUM, deployed as a sibling CloudFormation stack `adamdaniel-ai-rum` (see `infrastructure/rum/`). The Jekyll snippet in `_includes/analytics/cloudwatch-rum.html` is a no-op unless **both** `JEKYLL_ENV=production` AND `site.analytics.cloudwatch_rum.app_monitor_id` are set, so local `jekyll serve` and PR previews stay silent. Identity-pool / app-monitor IDs are non-sensitive (visible in the rendered page source) so they live in `_config.yml`, not GitHub secrets. End-to-end test: `e2e/analytics-cloudwatch-rum.test.js`. Full deploy + tuning notes: [`ANALYTICS_SETUP.md`](ANALYTICS_SETUP.md).

## Workflow path-filtering rule

Every workflow that triggers on `pull_request` or `push` MUST filter on its salient paths — the files and directories whose changes can actually affect what the workflow does. The goal is "if nothing salient changed, the workflow either doesn't fire OR emits a green check immediately" — never burning runner minutes (or scheduler slots) on a no-op, never blocking a merge by being absent.

**Rule of thumb when editing or adding a workflow:**

1. Read what the workflow actually does — which files / directories does it consume, build, deploy, or test?
2. Update `on.<event>.paths` (positive list) or `on.<event>.paths-ignore` (negative list) to match. Negative lists are usually shorter for site-wide workflows; positive lists are usually shorter for narrow workflows. Pick whichever expresses intent more clearly.
3. When ADDING a step that touches a new part of the codebase, expand the path list. When RENAMING or MOVING files the workflow depends on, update the path list in the same commit.
4. If the workflow is the *target* of a required status check, you can't drop it via workflow-level `paths:` — the check would go missing and block the merge. Use the **always-run + early skip** pattern instead: keep the trigger broad, detect salient changes in an early step, and gate every subsequent step on that step's output. The job still runs and reports success when nothing salient changed; the check is always present.

The `cms-publish-loop-prod.yml`, `cms-publish-loop-host.yml`, `dependabot-comment-sync.yml`, `e2e-tests.yml`, `deploy-preview.yml`, `deploy-production.yml`, `regenerate-manual.yml`, `skills-mirror.yml`, and `visual-regression.yml` workflows all use workflow-level `paths`/`paths-ignore` filtering. None currently use the always-run + early-skip pattern; if a future required check needs path filtering, refactor it to that pattern in the same change.

### Salient paths per workflow

Quick reference. When you change one of the listed paths, the workflow either runs or (for required-check workflows) does its real work; when you only change paths NOT listed, the workflow is skipped or self-skips with success.

| Workflow | Trigger | Path-filtering mechanism | Salient paths |
|---|---|---|---|
| `canary-prod.yml` | `schedule`, `workflow_dispatch` | n/a (cron-only) | n/a |
| `claude.yml` | `issue_comment`, `pull_request_review_comment`, `pull_request_review`, `issues` | n/a (event-driven, gated on `@claude` mention) | n/a |
| `cms-editorial-workflow.yml` | `pull_request` | **none, intentionally** — required check on every feature-branch PR (see ruleset note); the validation is cheap (<2 min) so always-run is the right call | n/a |
| `cms-publish-loop-host.yml` | `schedule`, `pull_request`, `workflow_dispatch` | `paths` (positive, PR only) | `e2e/cms-publish-loop.spec.js`, `e2e/cms-delete-published.spec.js`, `e2e/{decap-pat,github-actions-poll,canary-content,base}.js`, `_e2e/canary-{post,page,project}.md`, `admin/**`, `playwright.config.js`, `package*.json`, `_config.yml`, `_layouts/{canary,default}.html`, the workflow itself + sibling `{cms-editorial-workflow,deploy-production,delete-via-pr}.yml`. Schedule and dispatch always fire (no path filter); job-level `if` blocks `cms/*` PRs to avoid recursion |
| `cms-publish-loop-prod.yml` | `pull_request`, `workflow_dispatch` | `paths` (positive) | `e2e/cms-publish-loop-prod-mutate.spec.js`, `e2e/{decap-pat,github-actions-poll,base}.js`, `_posts/2099-01-01-e2e-mutation-canary.md`, `admin/**`, `playwright.config.js`, `package*.json`, `_config.yml`, `_layouts/post.html`, the workflow itself. The actual mutation is gated by `vars.PROD_PLAYGROUND_MODE == 'true'` (sunset switch) |
| `dependabot-auto-merge.yml` | `pull_request` | n/a (job-level `if: github.actor == 'dependabot[bot]'` skips for everyone else) | n/a |
| `dependabot-comment-sync.yml` | `pull_request_target` (opened/synchronize/reopened) | `paths` (positive) | `.github/workflows/**`, `scripts/sync-action-pin-comments.{sh,test.sh}`. Job-level `if: github.event.pull_request.user.login == 'dependabot[bot]'` skips for everyone else |
| `deploy-preview.yml` | `pull_request` | `paths-ignore` | everything EXCEPT docs (README/AGENTS/CLAUDE/ANALYTICS_SETUP/`docs/**`/`.agents/**`), `e2e/**`, screenshots/recordings/test-results, playwright configs, `package*.json`, `_plugins_test/**`, `oauth-proxy/**`, `infrastructure/**`, `tests/**`, sibling workflows; the workflow itself and `scripts/patch-preview-config.sh` ARE salient |
| `deploy-production.yml` | `push` to `main` | `paths-ignore` | everything EXCEPT docs, `.agents/**`, `_plugins_test/**`, `oauth-proxy/**`, `infrastructure/**`, `e2e/**`, screenshots/recordings/test-results, playwright configs, `package*.json`, license/lint files, dev-only scripts, sibling workflows; the workflow itself, `Gemfile*`, and `admin/**` ARE salient |
| `e2e-tests.yml` | `pull_request` | `paths-ignore` (coarse) plus `e2e/select-specs.js` runtime cut (fine — picks which specs to run) | site source under `_layouts/`, `_includes/`, `_config.yml`, `assets/css/`, `_plugins/`, `_plugins_test/`, `package*.json`, `Gemfile*`, `e2e/base.js`, `playwright*.config.js` (fanout — run all specs); per-file matches in `SPEC_RULES` (subset); doc-only changes run a smoke baseline only |
| `publish-scheduled-posts.yml` | `schedule`, `workflow_dispatch` | n/a (cron-only) | n/a |
| `regenerate-manual.yml` | `push` to `main`, `workflow_dispatch` | `paths` (positive) | `admin/**`, `_layouts/**`, `_includes/**`, `assets/css/**`, `_config.yml`, `_e2e/**`, `e2e/manual-capture.js`, the manual-capturing specs (`cms-publish-loop*`, `cms-smoke`, `cms-publish-flow`, `cms-editorial-workflow`), `docs/manual-overrides.yml`, `scripts/build-contributor-manual.js`, the workflow itself |
| `secrets-scan.yml` | `pull_request`, `push` to `main`, weekly `schedule`, `workflow_dispatch` | **none, intentionally** — gitleaks must scan the entire diff / history regardless of file type | n/a |
| `skills-mirror.yml` | `push` and `pull_request` to `main` | `paths` (positive) | `.agents/skills/**`, `.claude/skills/**`, `scripts/{bootstrap,verify-skills-mirror,secrets-scan}.{sh,ps1}`, `tests/**`, the workflow itself, `secrets-scan.yml` |
| `visual-regression.yml` | `pull_request` | `paths` (positive) | templates / rendering / styling: `_layouts/**`, `_includes/**`, `_plugins/**`, `_data/**`, `admin/**`, `_config.yml`, `Gemfile*`, root `index.html` / `404.html` / `robots.txt` / `preview.md`, `assets/css/**`, `assets/js/**`, `assets/images/logo.svg`; pipeline tools (`e2e/{detect-changed-pages,compute-visual-diffs,generate-video,regression-video}.{js,sh,spec.js}`, `playwright.regression.config.js`, the workflow itself). **CMS-managed content is intentionally excluded** (`_posts/**`, `_tags/**`, `_projects/**`, `pages/**`, `_e2e/**`, `assets/images/uploads/**`) — content-only PRs guarantee pixel diffs, so the regression video adds runner time without signal. |

When you add a new workflow, append it to this table in the same commit.

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
2. Run `scripts/patch-preview-config.sh` on `_site_preview/admin/config.yml` to point Decap at the preview subdomain and the PR's head branch
3. AWS OIDC auth via `AWS_ROLE_ARN`
4. `aws s3 sync` → `s3://adamdaniel-ai-previews/pr-{N}/` with `no-cache` headers (S3 layout unchanged; CloudFront Function maps host → prefix)
5. CloudFront invalidation at `/pr-{N}/*` (skipped if `PREVIEW_CLOUDFRONT_ID` not set)
6. Post/update PR comment using `<!-- adamdaniel-preview-bot -->` marker to avoid duplicates

URL shown in comment:
- With `PREVIEW_CLOUDFRONT_ID`: `https://preview-pr{N}.adamdaniel.ai/`
- Without: `http://adamdaniel-ai-previews.s3-website-us-east-1.amazonaws.com/pr-{N}/` (HTTP fallback — Decap CMS won't work over this)

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

Runs **only** when `cms/ready` label is added, and **only after `validate-content` passes** (`needs: validate-content`). Enables auto-merge (squash), commit title: `publish: {PR title}`. The PR merges automatically once all required status checks pass (e2e tests + visual regression approval).

#### CMS editorial flow

```
CMS creates PR (branch: cms/draft-{timestamp})
  → validate-content runs → adds cms/draft label
  → preview deployed at preview-pr{N}.adamdaniel.ai
  → visual regression video generated → posted as PR comment
  → editor reviews preview + regression video
  → editor (or admin) changes label: cms/draft → cms/ready → auto-merge enabled
  → reviewer approves visual regression (via dashboard or GitHub Actions)
  → all checks pass → auto-merge fires → deploy-production triggers
```

---

### `visual-regression.yml`

**Trigger:** `pull_request` types `[opened, synchronize, reopened]` targeting `main`

**Secrets needed:** `AWS_ROLE_ARN`, `PREVIEW_CLOUDFRONT_ID`

Uses a separate Playwright config (`playwright.regression.config.js`) and spec (`e2e/regression-video.spec.js`) to avoid interfering with the main test suite.

**Path-filtered to template / styling / tooling changes only.** CMS-managed content paths (`_posts/**`, `_tags/**`, `_projects/**`, `pages/**`, `_e2e/**`, `assets/images/uploads/**`) are intentionally **not** in the trigger list. The editorial-workflow PR generated by every Save in the CMS touches one of those paths and nothing else; running visual regression on those PRs is pure noise (the pixel diff is the *intent* of the edit, not a regression to flag). Mixed PRs that touch both content and a template path still trigger the workflow because of the template-path match. The lint test in `e2e/visual-regression-content-skip.test.js` enforces that content paths stay excluded.

#### Job: `generate`

1. Detect changed pages via `git diff` → `e2e/detect-changed-pages.js` → `/tmp/page-changes.json` (changeset heuristic — "what *could* this diff have affected")
2. Build Jekyll site locally (`_site/`)
3. Screenshot every page on the PR (localhost) and on production (adamdaniel.ai) at 1920×1080 via Playwright
4. For new pages: production screenshot replaced with "No previous version of this page" placeholder
5. Compute the per-page pixel diff between PR and prod via `e2e/compute-visual-diffs.js` → `screenshots/regression/diffs.json` (fact — "what actually looks different"). 0.5% pixel-ratio threshold absorbs anti-aliasing noise.
6. Generate side-by-side comparison video via ffmpeg (`e2e/generate-video.sh`) at 1920×1080 / CRF 20 / 2fps. Each segment shows a prominent 80px top bar — VISUALLY DIFFERENT (red), VISUALLY IDENTICAL (green), or NEW PAGE (blue) — for *that* page, plus a smaller "X in changeset" line for the heuristic classification.
7. Upload `regression.mp4` AND `regression.json` to `s3://adamdaniel-ai-previews/pr-{N}/`. Both are CloudFront-invalidated.
8. Post/update PR comment (`<!-- adamdaniel-regression-bot -->`) with both stats:
   - **Visually different** — pages where pixels actually changed (the ones to look at)
   - **Potentially affected by changes** — pages the changeset heuristic flagged

Video URL: `https://preview-pr{N}.adamdaniel.ai/regression.mp4`
Diffs JSON URL: `https://preview-pr{N}.adamdaniel.ai/regression.json` (consumed by `/admin/reviews/` so editors see the same stats without GitHub access)

#### Job: `approve-regression`

Uses `regression-review` GitHub Environment with required reviewers (all write-access users). Blocks merge until a reviewer approves the visual regression via GitHub Actions UI or the admin review dashboard. The `Waiting` state on this job comes from `environment: regression-review` (`visual-regression.yml`) plus the required-reviewers list configured in **repo Settings → Environments → regression-review**.

**Auto-approval when no diffs:** the `generate` job exports `totals.visuallyDifferent` (different + new pages, from `diffs.json`) as the `visually-different` job output. The `approve-regression` job's `environment` expression resolves to `regression-review` only when the count is non-zero — otherwise it resolves to an empty string, which means "no environment", so the job runs immediately, reports its required status check as success, and the PR can merge without a human reviewer. The PR bot comment swaps "Review required" for "Auto-approved" in the same condition. Reviewers only get pinged when there's something to look at.

**Billing:** Time spent in the `Waiting` state does **not** count toward Actions minutes — GitHub does not allocate a runner while waiting for a deployment review. Billing only resumes when a reviewer approves and the runner picks the job back up. The job itself is a one-line `echo` so post-approval billing is rounding-error.

#### Video page ordering

1. **Changed pages** — files modified in the PR, shown first
2. **New pages** — files that don't exist on `main`, left side shows "No previous version of this page" placeholder
3. **Unchanged pages** — all other pages

#### Page detection rules (`e2e/detect-changed-pages.js`)

| Changed file pattern | Mapped URL(s) |
|---|---|
| `_posts/YYYY-MM-DD-{slug}.md` | `/blog/{slug}/` |
| `_projects/{slug}.md` | `/projects/{slug}/` |
| `_tags/{slug}.md` | `/tags/{slug}/` |
| `pages/{name}.md` | permalink from front matter |
| `index.html` | `/` |
| `blog/index.html` | `/blog/` |
| `projects/index.html` | `/projects/` |
| `_layouts/*`, `_includes/*`, `_config.yml`, `assets/css/*` | ALL pages marked changed |

---

### `cms-publish-loop` (real-network end-to-end test)

`e2e/cms-publish-loop.spec.js` and `e2e/cms-publish-loop-preview.spec.js` exercise the full Decap → GitHub Actions → AWS deploy → public URL loop on the host repo (`main` target) and on PR previews (`PR head` target). Both:

1. Reset a canary entry in `_e2e/` to its known baseline via the Contents API.
2. Drive `https://adamdaniel.ai/admin/` (or the preview admin) with a PAT-seeded Decap session.
3. Edit the canary, hit Save — Decap opens a `cms/<...>` PR.
4. Wait for `validate-content` to pass.
5. Add the `cms/ready` label.
6. Wait for `auto-merge-when-ready` to enable auto-merge, then for the PR to merge.
7. Wait for `deploy-production.yml` (or `deploy-preview.yml`) to redeploy.
8. Fetch the public canary URL and assert the new content is live.
9. Reset the canary baseline asynchronously.

**Gating:** path-based via `e2e/select-specs.js`. Triggers when something contributor-relevant changed: `admin/**`, `_layouts/{post,page,project,canary,default,preview}.html`, `_e2e/**`, `scripts/patch-preview-config.sh`, `.github/workflows/{cms,deploy}-*.yml`, `e2e/{cms,decap-pat,github-actions-poll,canary-content}.*`. Self-skips when `CMS_E2E_PAT` isn't set (so forks/Dependabot don't run it). Runs once on `chromium-desktop`.

**Branch-protection ruleset:** `cms-feature-branches` (id 15756474, see `.github/rulesets/cms-feature-branches.json`) requires `validate-content` on PRs into `cms/**`, `claude/**`, `feat/**`, `fix/**`, `chore/**`, `test/**`, `ci/**`, `docs/**`. Without this required check, GitHub's mergeable_state goes "unstable" the moment the auto-merge job's own pending state is queued — which is exactly what bit PR #78 and motivated issue #79.

**When this workflow looks "stuck":** the workflow run is rarely the bug. The publish-loop opens a `cms/<col>/<slug>` PR and waits for it to auto-merge; if a *prior* run's PR is still open with failed required checks (typically because it was opened against a base that pre-dates a recent CI fix on `main`), every subsequent run times out at ~13–40 min with `Timed out waiting for PR #N to merge`. First action: `gh pr list --state open --search "head:cms"` and audit any BLOCKED PRs — close stale ones (`gh pr close N --delete-branch`) and the next workflow run opens fresh against current `main`. Don't restart the workflow before clearing the queue. The full procedure lives in `.agents/skills/cms-stuck-pr-triage/SKILL.md`.

### `cms-publish-loop-prod.yml` (prod mutation playground)

Sibling to the `cms-publish-loop` and `cms-publish-loop-preview` specs, but operates against a real `_posts/` entry on `main` rather than the `_e2e/` canary subset. See `e2e/cms-publish-loop-prod-mutate.spec.js` and the G4 plan for fixture details.

**Trigger:** `pull_request` to `main` with workflow-level `paths:` filter, plus `workflow_dispatch`. The workflow only fires when one of the salient files actually changed; on PRs that don't touch them, it doesn't appear in the checks list at all. This is safe because `prod-mutate` is not in the branch-protection required-status-checks list (verify via `gh api repos/Adam-S-Daniel/adamdaniel.ai/rules/branches/main`). Manual `workflow_dispatch` always forces a real run regardless of paths.

**Salient paths:** the spec, the e2e helpers it imports (`decap-pat.js`, `github-actions-poll.js`, `base.js`), the fixture post `_posts/2099-01-01-e2e-mutation-canary.md`, `admin/**`, `playwright.config.js`, `package*.json`, `_config.yml`, `_layouts/post.html`, and the workflow file itself.

**Gating layers, in order:**

1. Workflow-level `paths:` filter on the `pull_request` trigger (the workflow doesn't fire at all when nothing salient changed).
2. Repo variable `PROD_PLAYGROUND_MODE` must equal `'true'` (set in repo Settings → Variables and secrets → Actions → Variables). Flipping it `false` instantly stops every PR from mutating prod with no code change. The fixture file stays in-tree as documentation.
3. Per-PR concurrency (`group: cms-publish-loop-prod-${{ pull_request.number || ref }}`) so a force-push cancels the in-flight run.

When all three pass, the spec runs against `https://adamdaniel.ai/admin/`: it resets the canary fixture to `published: false`, drives Decap to toggle Published → ON, waits for the cms/... PR Decap opens, waits for `validate-content` + auto-merge + `deploy-production.yml`, fetches `/blog/e2e-mutation-canary/`, asserts the run-unique marker is live, and resets the fixture back to `published: false`.

### Contributor Manual

`docs/CONTRIBUTOR_MANUAL.md` is **assembled by the e2e tests**. Specs call `captureStep(page, { section, step, title, body })` from `e2e/manual-capture.js` at meaningful moments. The collator at `scripts/build-contributor-manual.js` reads the `manual-capture/*.json` records and builds the manual with embedded screenshots from `docs/manual-screenshots/`.

The capture is no-op unless `MANUAL_CAPTURE=1`; normal CI runs aren't slowed down. `.github/workflows/regenerate-manual.yml` flips the env var, runs the capture-instrumented specs, rebuilds the doc, and opens an auto-PR if the diff is non-empty.

If the manual looks wrong, the test that captured the wrong step is wrong — fix the `captureStep(...)` call, push, and the next regen run propagates the fix.

### Branch hygiene before opening a PR

Before staging changes or opening a PR, verify the branch contains ONLY the commits for the current task. Run:

```bash
git log origin/main..HEAD --oneline
```

If this lists anything beyond what you intend to ship, do NOT work on this branch. Cut a clean branch off `origin/main` and redo the work there:

```bash
git checkout -b <new-branch> origin/main
```

This matters most inside reusable git worktrees (`.claude/worktrees/<name>/`), where stale commits from previous tasks accumulate. A worktree's branch may already carry an unrelated WIP commit that would otherwise contaminate a focused PR — sometimes a commit that *deletes* files the current task needs to edit. Always verify before working. The same rule applies whenever you switch tasks on a long-lived feature branch.

### Reading PR diffs

`git diff main...branch` (the **3-dot** form, "what's on `branch` since the merge-base with `main`") will keep showing already-squash-merged content as if it's still ahead. After auto-merge fires, the merge-base hasn't moved on the feature branch, so the 3-dot diff still includes every commit that was squashed into the squash-merge commit.

For a fast "what's still actually pending?" check, use the **2-dot** form:

```bash
git diff main..branch --stat   # files different between the two tips, full stop
```

The 2-dot form compares tips directly — if a change has already landed on `main` (via squash-merge or otherwise), it disappears from this output. Use it when reviewing whether a long-lived feature branch is genuinely behind the work it shipped, vs. just bookkeeping-behind because git can't see through a squash.

### Branch protection (`main`)

The `main` branch has required status checks enforced via a GitHub ruleset (id 13985217). The JSON is checked in at `.github/rulesets/main.json` for reviewability. **If you add a new CI job that must gate merges, update `.github/rulesets/main.json` and reapply.** Apply via:

```bash
gh api -X PUT repos/Adam-S-Daniel/adamdaniel.ai/rulesets/13985217 \
  --input .github/rulesets/main.json
```

Verify what's actually live with:

```bash
gh api repos/Adam-S-Daniel/adamdaniel.ai/rulesets/13985217
```

Required status checks (current):

| Check | Workflow | Notes |
|---|---|---|
| `validate-content` | `cms-editorial-workflow.yml` | Always fires (no path filter) — front-matter + Jekyll build sanity check |
| `scan` | `secrets-scan.yml` | Always fires (gitleaks must scan every PR diff) |
| `select`, `unit`, `parity`, `e2e (1)`, `finalize` | `e2e-tests.yml` | Fire on every PR EXCEPT those whose entire diff matches `paths-ignore` (docs-only). Required checks block such PRs from merging — owner can override, or expand the PR with a small non-doc change to satisfy the gate. `e2e (1)` is shard 1 of the dynamic matrix (always present per `pickShardCount()` + the workflow's `case "$shard_count"` block); `finalize` is the matrix roll-up (`if: !cancelled()`, `needs: [e2e]`, last step re-fails on any shard failure) — keeping both gives shard-name resilience plus a single roll-up signal |

`prod-mutate` (`cms-publish-loop-prod.yml`) was historically required but is not anymore — the workflow uses workflow-level `paths:` filtering, so the check only appears on salient PRs (the missing-check trap). `host-loop`, `deploy-preview`, and `approve-regression` are excluded for the same reason. Re-promoting any of them would require converting to the always-run + early-skip pattern first.

**Required status checks are the default.** Any CI job that runs on pull requests is assumed to be a required check and must be enforced via the `main` ruleset before a branch can merge. Do NOT leave checks optional unless this section documents a specific reason. When adding new workflow jobs, update `.github/rulesets/main.json` and reapply in the same commit.

**Required-check + path-filter trap:** GitHub blocks the merge when a required check is *missing* (because path filtering prevented the workflow from running) — it doesn't auto-pass missing checks. Workflows promoted to required must therefore use the always-run + early-skip pattern (see `cms-publish-loop-prod.yml`) so the named check is always present. The `e2e-tests.yml` jobs above are accepted-as-blockers on truly doc-only PRs; if that becomes painful, convert e2e-tests.yml to the always-run pattern in a follow-up.

Auto-merge is enabled in repository settings. Direct pushes to `main` are allowed for the repository owner only.

The same required-checks list governs Dependabot's unattended-merge pipeline (`dependabot-auto-merge.yml`). When a Dependabot PR enables auto-merge, GitHub holds the merge until every check above reports success — so a vulnerable browser fixture, a regressed pixel, or a broken Jekyll build all block the bump. `prod-mutate` is no longer required (workflow-level `paths:` filtering would make it miss on most Dependabot PRs), but `e2e-tests.yml`'s subset selector still picks up the publish-loop spec for Dependabot bumps that touch `package*.json` — so the matrix still surfaces Decap/Playwright incompatibilities before merge, just under the `e2e (1)` / `finalize` umbrella rather than its own dedicated check.

---

### `dependabot-auto-merge.yml`

**Trigger:** `pull_request` opened/synchronised/reopened by `dependabot[bot]`, targeting `main`.

**Secrets needed:** none (uses built-in `GITHUB_TOKEN`).

**Pairs with:** `.github/dependabot.yml` — defines the npm / bundler / github-actions ecosystems, a 7-day `cooldown.default-days` on every non-security update, and `update-types: [minor, patch]` grouping per ecosystem so the auto-merge pipeline isn't drowning in N PRs/week.

#### Job: `auto-merge`

1. Only runs when `github.actor == 'dependabot[bot]'`
2. Uses `dependabot/fetch-metadata` to pick up the update-type / dependency-name and validate the PR genuinely came from Dependabot
3. Path-allowlist gate — diff must only touch `package*.json`, `Gemfile*`, or `.github/workflows/*.{yml,yaml}`. Anything else fails the job and disables auto-merge (idempotent — `gh pr merge --disable-auto || true`). This is the "no content will be altered" guarantee: a Dependabot PR can never ship a content change unattended, even if its branch were tampered with.
4. On a clean diff: `gh pr merge --auto --squash` enables GitHub's native auto-merge. Branch protection's required-checks list (e2e + visual-regression / approve-regression) governs when the merge actually fires.

#### Cooldown semantics

- **Non-security updates** wait 7 days from the upstream release before Dependabot opens the PR. Per GitHub's spec, `cooldown` "is only available for version updates, not security updates", so the wait is automatic.
- **Security updates** bypass cooldown — Dependabot opens the PR as soon as the advisory is detected, the PR lands on the same auto-merge gate, and ships the moment the test matrix is green.

#### Visual-regression interaction

Dependency-only diffs almost never produce pixel differences against production, so `approve-regression` typically auto-passes (zero pages visually different). When a bump *does* shift rendered output (e.g. a Jekyll plugin patch), the regression video lands in `/admin/reviews/` and the merge waits for human approval — same path as any content PR.

#### SHA-pinning interaction

Dependabot's github-actions ecosystem updates the `@<sha>` ref and the version part of the trailing comment, but it does not refresh the `(YYYY-MM-DD)` release-date suffix this repo's pinning convention requires — and over a few bumps, the `vX.Y.Z` part of the comment can also drift (e.g. PR #135 had a comment of `v1.302.0 (2026-04-15)` while the SHA was already `v1.305.0`). The companion workflow `dependabot-comment-sync.yml` runs on every Dependabot PR and pushes a follow-up commit that rewrites every drifted comment to match the new SHA's actual tag and tag-commit date. The follow-up commit becomes part of the same PR's CI run, so the auto-merge gate above naturally waits on the combined head — no extra coordination needed.

#### Required repository settings

For the auto-merge gate to function, two settings need to be set in repo Settings:

- **Settings → Actions → General → Workflow permissions** — the workflow's own `permissions:` block already requests `contents: write` and `pull-requests: write`, which is honoured as long as the repo-level default isn't restricted below read.
- **Settings → General → Pull Requests → Allow auto-merge** — must be enabled. Without this, `gh pr merge --auto` returns an error.

`secrets-scan.yml`, `e2e-tests.yml`, and `visual-regression.yml` all run normally on Dependabot's PRs (they're branch-internal, not from a fork), so the required-checks list works without further configuration.

### Admin review dashboard

Located at `/admin/reviews/` (separate from Decap CMS). Linked from a floating button on the CMS page.

- Cobalt Thermal theme
- GitHub OAuth authentication (reuses existing Lambda proxy). Implements the full Decap handshake: the popup posts `"authorizing:github"`, the dashboard echoes it back at the popup's origin, the popup releases an `"authorization:github:success:<JSON>"` payload, the dashboard parses the token. Skipping the echo leaves the popup spinning on "Completing authorisation…" forever — the same shape of bug Decap itself would surface if its handshake broke.
- Lists all pending visual regression reviews
- Embedded `<video>` player for regression videos hosted at `preview-pr{N}.adamdaniel.ai/regression.mp4`
- Stat grid (Visually different / Potentially affected / New / Identical) plus the per-page list of visually-different paths, fetched from `preview-pr{N}.adamdaniel.ai/regression.json` per card. Cross-origin GET, no GitHub auth needed.
- One-click approve / request-changes with comment
- Auto-refreshes every 60 seconds

### `e2e-tests.yml`

**Trigger:** pull request targeting `main`. The PR run is required by branch protection, so the merge commit on `main` is already covered — no post-merge re-run.

**Jobs:** `unit`, `select`, `e2e` (sharded matrix), `parity`, `finalize`

1. **`unit`** — runs Jekyll plugin tests (`_plugins_test/*_test.rb`) and the pure-bash `scripts/sync-action-pin-comments.test.sh`. Ubuntu runner, no container.
2. **`select`** — checks out the diff, runs `e2e/select-specs.js --base origin/main`, and decides the scope + shard count. Also runs the **Playwright image drift guard**: every `mcr.microsoft.com/playwright:v<version>-noble` tag in `.github/workflows/*.yml` must match `package-lock.json`'s `@playwright/test` version, otherwise the build fails with a one-line `sed` fix-up command.
3. **`e2e`** — sharded Playwright matrix. Runs inside `mcr.microsoft.com/playwright:v1.59.1-noble`, so browsers + their apt deps are baked in (no `playwright install` / `install-deps` step). Installs `libyaml-0-2` + `build-essential` for Ruby `bundler-cache`, sets up Ruby 3.2 + Node 20, runs `npm ci`, then runs Playwright with `--shard=<n>/<count>`. The selector decides the scope:
   - `all` — fanout files changed (`_layouts/`, `_includes/`, `_config.yml`, `assets/css/`, `_plugins/`, `package*.json`, `Gemfile*`, `e2e/base.js`, `playwright*.config.js`). Run the full matrix.
   - `subset` — match each changed file against `SPEC_RULES` and run only the resulting list (always-run baseline included).
   - `skip` — only docs (`README.md`, `AGENTS.md`, `docs/`, `.agents/skills/`) changed. Run the always-run baseline only as a smoke check.
4. **`parity`** — `--grep @parity` subset against `TARGET=prod`, single project (`chromium-desktop`), same Playwright container. Non-blocking informational gate.
5. **`finalize`** — merges per-shard blob reports into a single HTML report, assembles the per-test screenshot videos (see below), uploads the `playwright-report`, `per-test-videos`, and per-shard log artifacts, and posts the failure-summary PR comment.

**Dynamic shard count.** `e2e/select-specs.js` returns a `shard_count` field in its envelope (1, 2, 3, or 4). Small subsets — `≤2` light browser specs — collapse to a single shard; mid-sized subsets to 2; the rest fan out to 4. The required check is `e2e (1)`, and the matrix array is built `[1..shard_count]`, so shard 1 always fires.

**Spec-header directive.** A spec can opt OUT of selection on specific branches by adding `// @select-skip-when-head-ref-prefix: cms/` (or any comma-separated prefix list) to its head. The selector reads `GITHUB_HEAD_REF` and drops matching specs from the rule-matched set — the `ALWAYS_RUN` baseline is exempt. Used to shave bring-up cost on cms-bot PRs that don't need most browser specs.

Tests run with `fullyParallel: true` — all 8 projects execute concurrently within each shard.

#### Always-run baseline

Cheap, deterministic, no browser:
- `e2e/compute-visual-diffs.test.js` — pure pngjs unit tests for the visual-diff classifier
- `e2e/cms-config.spec.js` — YAML structural invariants for the Decap config (editorial workflow on, every folder collection has explicit create + delete, all required fields present, etc.)
- `e2e/visual-change-guard.spec.js` — guards against unintended visual changes

#### Per-test screenshot videos

Every browser-based test in the suite captures one full-page screenshot per main-frame navigation while it runs. The `finalize` job assembles these per-test frame sequences into individual videos with a 96px-tall metadata banner above the screenshot, and concatenates them into a master `_combined.mp4` for the run.

**Where things live:**
- Capture fixture: `e2e/base.js` (`attachPerTestCapture`, hooks `page.on("framenavigated")`).
- Frames during a run: `test-results/per-test-frames/<safe-test-id>/{NNNN.png,meta.json}`.
- Assembly script: `e2e/generate-test-videos.js`.
- Output: `test-results/per-test-videos/<safe-test-id>.mp4`, `_combined.mp4`, `_combined.txt`.
- CI artifact: `per-test-videos` (separate from `playwright-report`; 7-day retention).

**Banner content** — three monospace lines, white on a 96px black strip ABOVE the screenshot:
1. `PR #<n> · Test <X> of <Y> · <file>::<title>` — disambiguates runs and locates this test in the combined run.
2. `Step <x> of <y>: <step name / URL fallback> · <status>` — frame-by-frame label. `x` is the 1-indexed frame within the test, `y` is the total frame count for that test. The label prefers the active `test.step()` title; for frames captured outside any `test.step()`, it falls back to the URL path of the `framenavigated` event that fired the capture. Truncated to ~110 chars to fit the banner.
3. `project: <projectName> · <YYYY-MM-DD HH:MM:SS TZ>` — the date/time is each test's own `endTime` formatted in `America/New_York` with the TZ abbreviation (`EDT` or `EST`), NOT a single run-wide stamp.

The screenshot itself is **never overlaid** — each frame is composited by ImageMagick `convert` against a fresh canvas (1920×(1080+96)) with the banner drawn into the top 96px strip; the screenshot pixels stay untouched. Per-test videos are normalised to 1920×(1080+96) so the master concat works with stream-copy (no re-encode).

**Per-frame banner**: line 2 changes per frame, so the assembly script pre-renders each frame as a banner+screenshot composite (PNG → PNG via ImageMagick) and feeds the composites to ffmpeg as an `image2` sequence. The `finalize` job apt-installs both `ffmpeg` and `imagemagick`.

**Bounds:** capped at 50 frames per test (PER_TEST_MAX_FRAMES) to defend against runaway navigation loops. Frame rate is `2/3` fps (one frame every 1.5 s) so a 30-frame test plays in 45 s.

**v1 scope:** only the test fixture's primary `page` is captured. Secondary pages opened via `browserContext.newPage()` are not instrumented. Pure-node tests (`e2e/*.test.js` files that don't request the `page` fixture) are unaffected — the capture hook never runs for them.

**Escape hatch:** set `DISABLE_PER_TEST_VIDEOS=1` to fully disable the capture. The assembly step is non-blocking; it never fails the run.

**Not a required check** — purely informational. Lives alongside the `visual-regression.yml` pipeline (which does page-by-page diffs against prod), not on top of it.

---

### `secrets-scan.yml`

**Trigger:** PRs and pushes targeting `main`, plus a Sunday 07:00 UTC `cron` for a full-history sweep, plus `workflow_dispatch`.

**Secrets needed:** none (uses built-in `GITHUB_TOKEN`; no `GITLEAKS_LICENSE` because this is a public personal-account repo — gitleaks-action is free in that case).

#### Job: `scan`

Runs [gitleaks](https://github.com/gitleaks/gitleaks) via the official `gitleaks/gitleaks-action`. PRs scan only the diff against base; pushes to `main` and the weekly cron walk full history. The diff-only path catches "leak introduced by this PR"; the weekly sweep catches anything that landed via a force-push or rebase that the diff scan missed.

The underlying gitleaks binary is pinned via `GITLEAKS_VERSION`. Bump deliberately, not on a whim.

Allowlist for known test fixtures lives in `.gitleaks.toml`. When a new test hardcodes a fake-looking token, add it there rather than disabling the workflow.

The `scripts/scrub-secrets.js` helper (used by the e2e bot to redact failure summaries before commenting on PRs) runs the same `gitleaks` binary at runtime. The CI gate and the runtime scrubber share the same default ruleset.

#### Local pre-commit guard

`scripts/secrets-scan.sh` runs `gitleaks protect --staged --redact` against the index before every commit, so a secret never reaches local history (or the reflog, which survives a force-push). It uses the same `.gitleaks.toml` as CI, and parses `GITLEAKS_VERSION` out of `secrets-scan.yml` at runtime — bumping CI's pin auto-updates the version the hook recommends, so there's a single source of truth.

The hook is registered through both supported pathways:

- **Git ≥ 2.54** — `[hook "secrets-scan"]` in `.gitconfig-fragment`, alongside `skills-mirror-check`. `git hook list pre-commit` shows both.
- **Git < 2.54** — chained inside `.githooks/pre-commit` after the skills-mirror check.

`scripts/bootstrap.sh` / `bootstrap.ps1` pick the right path based on `git --version`; nothing extra to wire up after a fresh clone.

If `gitleaks` isn't on `PATH`, the hook fails with install instructions for macOS / Linux / Windows. Bypass for emergencies via `SKIP_SECRETS_SCAN=1 git commit ...` (preferred over `--no-verify`, which also disables the skills-mirror guard). CI still scans the PR, so a bypassed commit won't merge with a real leak.

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

#### iOS-anything is WebKit

iOS Chrome, iOS Firefox, iOS Edge, and iOS Safari all share the same browser engine — Apple bans third-party rendering engines on iOS. Playwright's `webkit` project covers all of them. So "iOS Chrome === iOS Safari === WebKit" — they're a single data point, not three. When triaging an iOS-only render bug, reproduce it under `webkit-tablet` (or any local WebKit) and you've covered every iOS browser.

#### `?notheme` kill-switch (admin)

`admin/index.html` flips off the cobalt theme (the `<link rel="stylesheet" href="custom.css">` plus the inline `<style id="cobalt-inline-theme">`) when the URL contains a `notheme` query param. The script reads `URLSearchParams(location.search)` — i.e. the query string **before** the hash — so:

- `https://adamdaniel.ai/admin/?notheme` works.
- `https://adamdaniel.ai/admin/#/collections/posts?notheme` does **not** — Decap's hash-router puts that `?notheme` *inside* the hash fragment, where `location.search` can't see it.

When triaging an iOS WebKit render bug that may be theme-induced, A/B with `/admin/?notheme` first, then navigate inside.

#### Sandbox allowlist (Playwright browser downloads)

Playwright fetches its browser binaries from a small set of CDNs the first time `npx playwright install` runs. Sandboxed shells (and any local environment running `npx playwright install`) need outbound network access to:

- `cdn.playwright.dev`
- `playwright.download.prss.microsoft.com`
- `playwright.azureedge.net`

If these are blocked, `npx playwright install` hangs or fails with a 403 / DNS-resolution error.

CI does NOT hit these CDNs — the e2e matrix, parity, finalize, canary-prod, and cms-publish-loop-{host,prod} jobs all run inside `mcr.microsoft.com/playwright:v<version>-noble`, which ships the browsers + apt deps prebaked. The image tag is enforced to match `package-lock.json`'s `@playwright/test` version by the `select` job's drift-guard step. The CDNs only matter for fresh local clones and the rare workflow that still calls `playwright install` (e.g. `visual-regression.yml`, `regenerate-manual.yml`).

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

Skills live in `.agents/skills/`. Each skill is a folder with a `SKILL.md`.

`.claude/skills` is a symlink (or directory junction on Windows) to
`.agents/skills` so Claude Code discovers the same set.

### After cloning

- macOS / Linux / WSL: `bash scripts/bootstrap.sh`
- native Windows: `pwsh scripts/bootstrap.ps1`
- Claude Code on the web: nothing — `.claude/settings.json` runs the
  bootstrap automatically via the `SessionStart` hook.

Bootstrap is idempotent and exits in well under three seconds.

### Editing rule

Only edit files under `.agents/skills/`. The pre-commit hook
(`skills-mirror-check`, registered via `.gitconfig-fragment` on Git ≥ 2.54
or `.githooks/pre-commit` on older Git) and the `skills-mirror` CI workflow
both reject commits that turn `.claude/skills` into real files.

### Tests

- `pytest tests/` — offline (CI runs this on `ubuntu-latest` and
  `windows-latest`).
- `pytest tests/ -m live` (or `SKILLS_TEST_LIVE=1 pytest tests/`) — invokes
  `claude -p` against the canary skill. Requires the `claude` CLI on PATH
  and an authenticated subscription session. Run on a local
  Windows / WSL / macOS shell, or in a Claude Code on the web session
  terminal.

### Cloud session sanity check (manual)

After pushing a branch, opening a Claude Code on the web session against
this repo, and running `pytest tests/ -m live` in the session terminal,
the `claude-code` harness should report PASS.

### Current skills

- `.agents/skills/aws-bootstrap/` — bootstrap stack deployment and troubleshooting
- `.agents/skills/preview-environments/` — preview pipeline, CloudFront, S3 debugging
- `.agents/skills/browser-testing/` — e2e test matrix, fixtures, cross-browser testing
- `.agents/skills/github-actions-sha-pinning/` — workflow SHA-pinning rules + 7-day cooldown
- `.agents/skills/workflow-path-audit/` — audit `paths:` / `paths-ignore:` filters across `.github/workflows/`
- `.agents/skills/cms-stuck-pr-triage/` — diagnose "stuck" publish-loop / canary runs (`gh pr list --state open --search "head:cms"` first, blame the workflow last)
- `.agents/skills/ci-watcher-loops/` — patterns for reliable agent self-feedback when watching long-running workflows; covers the chained-capture pitfall (`RUN=$(cmd1 && cmd2)`) that silently breaks watcher loops
- `.agents/skills/sveltia-cms-playwright-demo/` — historical Sveltia/Playwright notes (Decap is current)
- `.agents/skills/test-canary/` — internal test fixture; never invoke from real work

### Adding an agent harness

Drop a new module in `tests/harnesses/` extending `AgentHarness` with
`verify_offline` and `verify_live`, then add an entry to
`tests/harness-config.yaml` with `enabled: true`. No edits to
`tests/test_skill_discovery.py` or any other runner code are required.
