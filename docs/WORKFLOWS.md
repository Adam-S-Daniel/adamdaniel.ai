# Workflows

GitHub Actions workflow reference for this repo: what each workflow does, its triggers, required-status-check topology, path-filtering rules, and the two composite actions (failure-comment reporting, recursion-gate) shared across the CMS publish loops. Read this before adding, renaming, or re-scoping any workflow, or when a required check is missing/red and you need to know what's supposed to gate what.

## Workflow path-filtering rule

Every workflow that triggers on `pull_request` or `push` MUST filter on its salient paths — the files and directories whose changes can actually affect what the workflow does. The goal is "if nothing salient changed, the workflow either doesn't fire OR emits a green check immediately" — never burning runner minutes (or scheduler slots) on a no-op, never blocking a merge by being absent.

**Rule of thumb when editing or adding a workflow:**

1. Read what the workflow actually does — which files / directories does it consume, build, deploy, or test?
2. Update `on.<event>.paths` (positive list) or `on.<event>.paths-ignore` (negative list) to match. Negative lists are usually shorter for site-wide workflows; positive lists are usually shorter for narrow workflows. Pick whichever expresses intent more clearly.
3. When ADDING a step that touches a new part of the codebase, expand the path list. When RENAMING or MOVING files the workflow depends on, update the path list in the same commit.
4. If the workflow is the *target* of a required status check, you can't drop it via workflow-level `paths:` — the check would go missing and block the merge. Use the **always-run + early skip** pattern instead: keep the trigger broad, detect salient changes in an early step, and gate every subsequent step on that step's output. The job still runs and reports success when nothing salient changed; the check is always present.

The `cms-publish-loop-prod.yml`, `cms-publish-loop-host.yml`, `dependabot-comment-sync.yml`, `e2e-tests.yml`, `deploy-preview.yml`, `deploy-production.yml`, and `visual-regression.yml` workflows all use workflow-level `paths`/`paths-ignore` filtering. `preview-media.yml` is the reference implementation of the **always-run + early-skip** pattern for a required check: it fires on every PR with no `paths:` filter, detects media-salient changes in an early step, and reports success immediately otherwise — so the `preview-media` context is always present (no stub needed; it joins the always-fire set with `validate-content`/`scan`). On a media-salient PR it hard-fails if the `preview-pr<N>` surface is unreachable within the bound — the trap-safe way to require `deploy-preview` success for those PRs without making the path-filtered `deploy-preview.yml` itself a required context (that would re-create the missing-check trap). Any future required check that would otherwise need path filtering must follow this always-run + early-skip pattern.

### Salient paths per workflow

Quick reference. When you change one of the listed paths, the workflow either runs or (for required-check workflows) does its real work; when you only change paths NOT listed, the workflow is skipped or self-skips with success.

This table is **Layer 1** (workflow-level firing) only. `e2e-tests.yml` runs
the whole suite once it fires — one CI job per Playwright project — so the
only *spec*-level question left on that lane is which heavy `@lane:real`
CMS specs self-skip at runtime. That, plus the missing-check trap, the stub
mirror, the `cms/*` head-ref directive, and the verified footguns, is in
[`docs/TESTING.md` §2 "Trigger map: what runs
when"](docs/TESTING.md#2-trigger-map-what-runs-when) — whose Layer 2
(diff-aware selection) now applies to the `parity-preview` /
`preview-media` lanes, not to `e2e-tests.yml`. Keep both in sync when you
change path filters.

| Workflow | Trigger | Path-filtering mechanism | Salient paths |
| --- | --- | --- | --- |
| `auto-resolve-newline-conflict.yml` | `workflow_run` (after `cms-editorial-workflow`), `workflow_dispatch` | n/a (event-driven, gated by script's PR allowlists) | n/a |
| `canary-prod.yml` | `schedule`, `workflow_dispatch` | n/a (cron-only, read-only prod probe) | n/a |
| `cleanup-stale-fixture-branches.yml` | `schedule`, `workflow_dispatch` | n/a (cron-only; sweeps this repo's stale fixture branches/PRs via the GitHub API, no site build) | n/a |
| `cms-automerge-nudge.yml` | `schedule` (every 5 min), `workflow_dispatch` | n/a (cron-only; re-enables auto-merge on a stuck-but-green CMS PR via the API) | n/a |
| `cms-delete-published-preview.yml` | `workflow_dispatch` | n/a (dispatch-only — needs a live preview env to target) | n/a. `inputs.pr_number` selects the preview env; the spec self-skips unless `CMS_E2E_PAT` + `PR_NUMBER` + `PR_HEAD_REF` are set. NOT a required check (heavy loops stay off the merge path) |
| `cms-editorial-workflow.yml` | `pull_request` types `[opened, synchronize, labeled]` | **none, intentionally** — required check on every PR (see ruleset note); the validation is cheap (<2 min) so always-run is the right call | n/a |
| `cms-media-roundtrip.yml` | `schedule`, `push` (main), `workflow_dispatch` | `paths` (positive, push to main) | Only the workflow's own file (`.github/workflows/cms-media-roundtrip.yml`). Prod (`cms-publish-loop-prod.yml`) owns the shared infra paths (`admin/**`, `package*.json`, `_config.yml`) on push; this loop covers them via its own 15:00 UTC cron instead, keeping the three real-prod loops' push-trigger paths disjoint (no co-arrival eviction in the shared `prod-mutating-loop` concurrency lane — see #1892 below) |
| `cms-preview-loops.yml` | `workflow_dispatch` | n/a (dispatch-only) | n/a — runs the 3 issue-#999 preview-parity specs (`cms-publish-loop-prod-mutate-preview`, `cms-unpublish-republish-preview`, `cms-tags-lifecycle-preview`) against an open PR's preview env. NOT a required check (no `pull_request` trigger → never a PR status context); the heavy preview round trips stay off the merge path. Sibling of `cms-publish-loop-preview.yml` |
| `cms-publish-loop-host.yml` | `schedule` (12:00 UTC daily), `push` (main), `workflow_dispatch` | `paths` (positive, push to main) | `cms-publish-loop-host.yml` itself plus the three `_e2e/canary-{post,page,project}.md` fixtures — narrowed to this loop's OWN canary surfaces only (#1892: it used to also list `admin/**`/`playwright.config.js`/`package*.json`/`_config.yml`, which overlapped `cms-publish-loop-prod.yml`'s push paths and caused co-arrival eviction in the shared `prod-mutating-loop` lane; the gem-delivered `_layouts/{canary,default}.html` entries were later dropped too — `_layouts/` isn't tracked in this repo, so they could never match, PR #2472). Runs post-merge; recursion gated by the shared `recursion-gate` job |
| `cms-publish-loop-preview.yml` | `workflow_dispatch` (required `pr_number` input) | n/a (dispatch-only) | n/a — preview-env sibling of `cms-publish-loop-host.yml`; drives the canary publish loop against a PR's preview surface. NOT a required check |
| `cms-publish-loop-prod.yml` | `push` (main), `workflow_dispatch` | `paths` (positive, push to main) | `cms-publish-loop-prod.yml` itself, `admin/**`, `package.json`, `package-lock.json`, `_config.yml` (the gem-delivered `playwright.config.js` / `_layouts/post.html` entries were dropped in PR #2472 — untracked here, they could never match). Runs **post-merge** (not per-PR): the spec drives a REAL prod mutation, so firing it on every concurrent PR raced the shared canary + the deploy-production queue and flaked. Gated by repo var `PROD_PLAYGROUND_MODE == 'true'` |
| `dependabot-auto-merge.yml` | `pull_request` | n/a (job-level `if: github.actor == 'dependabot[bot]'` skips for everyone else) | n/a |
| `dependabot-comment-sync.yml` | `pull_request_target` (opened/synchronize/reopened), `push` (every branch), `workflow_dispatch` | `paths` (positive) on the `pull_request_target` arm only — `.github/workflows/**`. The `push` arm has NO paths filter (fires on every push to every branch; added to suppress GitHub Actions' phantom zero-job `push` runs, see the `secrets.X in step-level if:` pitfall note) | Reusable's first step no-ops immediately for any non-Dependabot `pull_request_target`, and for any `push` (the push arm exists only to replace GHA's phantom failure row with a real ~5s success) |
| `deploy-preview.yml` | `pull_request` types `[opened, synchronize, reopened, closed]` | `paths-ignore` | everything EXCEPT `README.md`, `AGENTS.md`, `CLAUDE.md`, `docs/**`, `e2e/**`, `infrastructure/**`, `oauth-proxy/**` (7 entries) |
| `deploy-production.yml` | `push` to `main`, `workflow_dispatch` | `paths-ignore` | everything EXCEPT the same 7 as `deploy-preview.yml` PLUS `scripts/**`; `workflow_dispatch` ignores `paths-ignore` |
| `dev-hooks-sync.yml` | `schedule` (Mondays 06:00 UTC), `workflow_dispatch` | n/a (cron-only; syncs the pre-commit guard files from the platform) | n/a |
| `e2e-stub.yml` | `pull_request` | `paths` (positive) — a byte-for-byte mirror of `e2e-tests.yml`'s `paths-ignore` list | `README.md`, `AGENTS.md`, `CLAUDE.md`, `docs/**`, `infrastructure/**`, `oauth-proxy/**`, `LICENSE`, `.gitignore`. Emits a trivial green `e2e` job so the required `e2e / e2e` context is never MISSING on a doc/infra-only PR |
| `e2e-tests.yml` | `pull_request` targeting `main` | `paths-ignore` | `README.md`, `AGENTS.md`, `CLAUDE.md`, `docs/**`, `infrastructure/**`, `oauth-proxy/**`, `LICENSE`, `.gitignore`. Beyond that filter the lane runs the **WHOLE** suite, fanned out one job per Playwright project inside the platform reusable — there is no diff-aware selection and no sharding on this lane (see "No diff-aware spec SELECTION on this lane" below). The selector still governs the `parity-preview` / `preview-media` lanes |
| `editorial-label-audit.yml` | `schedule` (13:00 UTC daily), `workflow_dispatch` | n/a (cron-only; scans + self-heals `decap-cms/*` labels via the API) | n/a |
| `label-non-decap-prs.yml` | `pull_request` (opened, reopened), `push` (main), `workflow_dispatch` | `pull_request`: **none, intentionally** — the tag decision keys off the PR's head ref, not its diff. `push` (main): `paths` positive, the workflow file itself only | Tags any PR NOT created by Decap with `not-decap-created` |
| `parity-preview.yml` | `pull_request` targeting `main` | **none, intentionally** — required check on the always-run + early-skip pattern; the reusable's selector reports success immediately when no `@parity-preview` spec applies | n/a — runs the `@parity-preview` spec subset (sitemap, console-clean, draft-isolation, image-alt-text, admin-bundle-parity) against the PR's own `preview-pr<N>.adamdaniel.ai` surface |
| `platform-bump.yml` | `schedule` (Mondays 07:00 UTC), `workflow_dispatch` | n/a (cron-only; opens the platform version-bump PR) | n/a |
| `platform-pin-consistency.yml` | `pull_request` targeting `main` | **`paths-ignore`, content subtrees only** — a version skew can be introduced by editing ANY pin-bearing file, so this is an ignore-list (fail open), never a `paths:` allow-list (which would silently stop checking a future pin-bearing file type). Measured 2026-08-20 over 90 runs: ~20/day at ~47s, 81% from `cms/*` (71%) and `agents-md-sync/*` (10%) branches. **`assets/**` is deliberately NOT ignored** — the checker's sixth input is the `preview-media` sentinel `assets/images/uploads/e2e-preview-media-probe.png`, which lives inside the Decap `media_folder`, so a `cms/*` media upload CAN touch a pin-bearing path. `paths-ignore` has no negation syntax, so the list enumerates only subtrees that can hold none of the six inputs. Safe because the context it publishes — `pin-consistency / pin-consistency`, the two job ids, not the file name — is **not required** (verified live against `GET /repos/Adam-S-Daniel/adamdaniel.ai/rulesets`, ruleset `main` id 13985217); a `paths`-excluded workflow emits no check run at all, so a required context would hang forever. jodidaniel.com deliberately keeps no filter — see the comment in its own caller. | n/a |
| `preview-media.yml` | `pull_request` | **none, intentionally** — required check on the always-run + early-skip pattern; an early step detects media-salient changes and the job reports success immediately when none changed | `assets/images/uploads/**`, `admin/config{,-local}.yml`, `_config.yml`, `_layouts/{post,canary}.html`, `scripts/patch-preview-config.sh`, `e2e/cms-host.js`, `e2e/preview-media-resolves.spec.js`, the workflow itself (detected in-step, not via `paths:`) |
| `publish-scheduled-posts.yml` | `schedule` (14:00 UTC daily), `workflow_dispatch` | n/a (cron-only) | n/a |
| `regression-review-reaper.yml` | `pull_request` types `[synchronize, closed]` | n/a (event-driven; rejects orphaned `regression-review` pending deployments via the API) | n/a |
| `secrets-scan.yml` | `pull_request`, `push` to `main`, weekly `schedule` (Sundays 07:00 UTC), `workflow_dispatch` | **none, intentionally** — gitleaks must scan the entire diff / history regardless of file type | n/a |
| `sweep-stale-cms-prs.yml` | `schedule` (04:00 UTC daily), `workflow_dispatch` (`dry_run`, `threshold_hours` inputs) | n/a (cron-only; sweeps this repo's stale CMS PRs/branches/fixtures via the API) | n/a |
| `visual-regression.yml` | `pull_request` types `[opened, synchronize, reopened]` | **NO paths filter — fires on every PR.** Content-only-skip is decided INSIDE the platform's reusable workflow (`e2e/visual-regression-salient.js`), not by a caller-level `paths:` (a required-check gate can't be workflow-level path-filtered without recreating the missing-check trap) | n/a at the caller level |

When you add a new workflow, append it to this table in the same commit, and set `run-name:` per the grammar in [§ Workflow run naming](#workflow-run-naming).

### Workflow run naming

Every workflow sets `run-name:` as line 2 (immediately after `name:`) so the Actions tab shows *what triggered each run* deterministically — independent of commit-message contents. `name:` identifies the *workflow* (static); `run-name:` titles the *run* and supports expressions. Without it, GitHub auto-titles runs from the trigger (push borrows the head commit, dispatch falls back to `name:`, PR borrows the PR title), so the same file gets inconsistent titles.

**Grammar:** `<trigger> — <context>`, em-dash separated. The run-name does **not** repeat the workflow name (the UI already shows it); it leads with the trigger. Building-block fragments (inline each — anchors can't cross files):

- PR — `format('PR #{0} — {1}', github.event.pull_request.number, github.event.pull_request.title)`
- push — `format('push — {0} @{1}', github.ref_name, github.actor)`
- manual — `format('manual — @{0}', github.actor)`
- scheduled — `format('scheduled — {0}', github.event.schedule)`
- chained — `format('chained — after {0} #{1}', github.event.workflow_run.name, github.event.workflow_run.run_number)`

A multi-event workflow branches *inside* the expression (it can't use `if:`, which isn't valid at top level): `cond && 'A' || cond2 && 'B' || fallback` (`&&` binds tighter than `||`; a final `|| github.event_name` keeps the title non-empty). Use the folded `>-` scalar for readability. Trim each file to only the events it actually declares.

**Quote single-line run-names that contain `#`.** The PR fragment embeds a `#` (`PR #{0}`); on a single-line plain scalar YAML treats ` #` as an inline comment and truncates the expression (actionlint then errors "unexpected EOF while lexing string literal", and GitHub renders the title wrong). Wrap such values in double quotes — `run-name: "${{ format('PR #{0} — {1}', …) }}"`. The folded `>-` form is immune (inside a block scalar `#` is literal), so multi-event run-names need no quoting.

**Context limit:** `run-name:` may reference **only** the `github` and `inputs` contexts — `vars`/`env`/`secrets`/`steps`/`jobs`/`runner` are unavailable, and it can't read job/step outputs. Dispatch inputs declared `type: boolean` arrive as real booleans, so `inputs.dry_run && ' — dry-run' || ''` works. Echoing attacker-controllable fields (e.g. a fork PR title) is safe — run-name is display-only text, never executed or rendered as markup.

`e2e/workflow-run-name.test.js` (`@lane: local`) lint-locks this: every workflow must declare a non-empty, dynamic (`${{`) `run-name:`, and every multi-event workflow must branch on `github.event_name ==` / `github.event.action ==`. (A hypothetical pure-`workflow_call`-only workflow would never show its own run-name and could be exempted; none exist today.)

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
2. Run the platform-delivered `patch-preview-config.sh` (from the preview reusable's `.cms-platform/scripts/` copy) on `_site_preview/admin/config.yml` to point Decap at the preview subdomain and the PR's head branch
3. AWS OIDC auth via `AWS_ROLE_ARN`
4. `aws s3 sync` → `s3://adamdaniel-ai-previews/pr-{N}/` with `no-cache` headers (S3 layout unchanged; CloudFront Function maps host → prefix)
5. CloudFront invalidation at `/pr-{N}/*` (skipped if `PREVIEW_CLOUDFRONT_ID` not set)
6. Post/update PR comment using `<!-- adamdaniel-preview-bot -->` marker to avoid duplicates

URL shown in comment:

- With `PREVIEW_CLOUDFRONT_ID`: `https://preview-pr{N}.adamdaniel.ai/`
- Without: `http://adamdaniel-ai-previews.s3-website-us-east-1.amazonaws.com/pr-{N}/` (HTTP fallback — Decap CMS won't work over this)

**Two independent "preview is ready" signals, read by different consumers — keep both:**

- **GitHub Deployment** (`environment: preview-pr-<N>`, `state: success`, `environment_url`). Polled by `admin/deploy-status-pill.js` to flip its in-flight spinner, and surfaces the per-PR row in the Environments UI. NOT read by Decap's editor.
- **`deploy/preview` commit status** (`createCommitStatus` on the PR head SHA, `state: success`, `target_url` = preview root; needs `statuses: write`). THIS is what Decap CMS's editor reads: decap-cms 3.12.2's github backend implements `getDeployPreview` as `GET /repos/.../commits/<pr-head-sha>/status` and surfaces the first status whose `context` matches `backend.preview_context` (pinned to `deploy/preview` in all three `admin/config*.yml`; `patch-preview-config.sh` doesn't touch it). Without this status the editor's deploy-preview button is stuck on **"Check for Preview"** forever even though the preview is live — the GitHub Deployment is invisible to this code path (the decapcms.org "polls `/deployments?ref=`" docs describe the *Netlify* backend, not github). Decap runs the status `target_url` through its `preview_path` builder, so the editor's "View Preview" link becomes `https://preview-pr<N>.adamdaniel.ai/blog/<slug>/`. The workflow↔config contract is locked by `e2e/cms-posts-list-enhance.spec.js` (which `select-specs.js` runs on `deploy-preview.yml` changes). An existing open PR only gets the status on its next push (the step runs per preview deploy; it isn't backfilled).

#### Job: `teardown-preview` (when action == `closed`)

1. AWS OIDC auth
2. `aws s3 rm s3://adamdaniel-ai-previews/pr-{N}/ --recursive`
3. CloudFront invalidation
4. Updates the existing `<!-- adamdaniel-preview-bot -->` comment to "cleaned up" (never creates a duplicate)

---

### `cms-editorial-workflow.yml`

**Trigger:** `pull_request` types `[opened, synchronize, labeled]`. No path filter — fires on every PR (required check on every PR; see the ruleset note and the matching table entry above).

**Secrets needed:** none (uses built-in `GITHUB_TOKEN`).

#### Job: `validate-content`

Runs on every open/update/label event:

1. Validates front matter: every `_posts/*.md` must have `title:` and `date:` fields
2. Full `bundle exec jekyll build` sanity check
3. On `opened`: creates `cms/draft` (dark blue) and `cms/ready` (green) labels if they don't exist, then applies `cms/draft` to the PR

#### Job: `auto-merge-when-ready`

Runs **only** when `cms/ready` label is added, and **only after `validate-content` passes** (`needs: validate-content`). Enables auto-merge (squash), commit title: `publish: {PR title}`. The PR merges automatically once all required status checks pass (e2e tests + visual regression approval).

#### CMS editorial flow

```text
CMS creates PR (branch: cms/draft-{timestamp})
  → validate-content runs → adds cms/draft label
  → preview deployed at preview-pr{N}.adamdaniel.ai
  → visual regression video generated → posted as PR comment
  → editor reviews preview + regression video
  → editor (or admin) changes label: cms/draft → cms/ready → auto-merge enabled
  → reviewer approves visual regression (via dashboard or GitHub Actions)
  → all checks pass → auto-merge fires → deploy-production triggers
```

#### The "adding labels to N of your Editorial Workflow entries" dialog

Decap re-runs its editorial-workflow label migration on **every** `/admin` load (prod and every preview) when an open editorial PR — a `cms/*` branch — is **missing its `decap-cms/<draft|pending_review|pending_publish>` status label**. The symptom is a persistent "Decap CMS is adding labels to N of your Editorial Workflow entries" dialog that never clears: for non-Decap-created PRs the migration always no-ops (Decap's `migratePullRequest` finds no legacy `refs/meta/_decap_cms` metadata → "Skipped migrating"), so it never labels anything and re-alerts on the next load. Root cause is almost always a lingering non-Decap `cms/*` PR — historically the publish-via-auto-merge shim's delete-recovery PRs and the e2e fixture/sweep PRs, which used to carry only `cms/ready` (worst case: delete PR #2387 sat 3 days behind a flaky-red check with the dialog on every prod `/admin` load, 2026-07). Since platform v0.1.48 all four non-Decap `cms/*` PR writers label `decap-cms/pending_publish` at creation, and the daily audit (below) self-heals any straggler. **Manual fix, if it ever recurs:** `gh pr list --state open --search "head:cms"` → label the offender with the right `decap-cms/<status>` (or just dispatch the audit workflow: `gh workflow run editorial-label-audit.yml`) — or close it.

#### `editorial-label-audit.yml`

A thin daily caller (cron `0 13 * * *` + `workflow_dispatch`) that delegates to the platform's reusable `editorial-label-audit.yml`. It scans for open `cms/*` PRs missing their `decap-cms/<status>` label — the exact condition that triggers the "adding labels" dialog above — and since platform v0.1.48 **self-heals** them (reusable default `fix: true`): `decap-cms/pending_publish` when the PR carries `cms/ready`, else `decap-cms/draft`. That's why the caller grants `pull-requests: write`. A red run now means a fix didn't stick (permissions, API failure) and needs a human — not routine debris; before v0.1.48 the detect-only audit failed silently for a week while the dialog sat on prod. The platform owns the audit logic, this caller only schedules it. Keep the `uses:@` pin and `platform_ref` input in lockstep.

---

### `visual-regression.yml`

**Trigger:** `pull_request` types `[opened, synchronize, reopened]` targeting `main`

**Secrets needed:** `AWS_ROLE_ARN`, `PREVIEW_CLOUDFRONT_ID`

Uses a separate Playwright config (`playwright.regression.config.js`) and spec (`regression-video.spec.js`) — both platform-delivered via the e2e harness copied from `.cms-platform/e2e`, no longer vendored here — to avoid interfering with the main test suite.

**No caller-level `paths:` filter — fires on every PR.** The caller has no `paths:`/`paths-ignore:` at all (verified against `.github/workflows/visual-regression.yml`); content-only-skip is decided INSIDE the platform's reusable workflow, via its own salience check (`e2e/visual-regression-salient.js`), not by a workflow-level path filter. CMS-managed content paths (`_posts/**`, `_tags/**`, `_projects/**`, `pages/**`, `_e2e/**`, `assets/images/uploads/**`) are the ones the reusable's salience check treats as non-salient. The editorial-workflow PR generated by every Save in the CMS touches one of those paths and nothing else; running the heavy visual-regression build on those PRs is pure noise (the pixel diff is the *intent* of the edit, not a regression to flag). Mixed PRs that touch both content and a template path still run the heavy build because of the template-path match. The lint test in `e2e/visual-regression-content-skip.test.js` enforces that content paths stay excluded from the reusable's salience check.

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
| --- | --- |
| `_posts/YYYY-MM-DD-{slug}.md` | `/blog/{slug}/` |
| `_projects/{slug}.md` | `/projects/{slug}/` |
| `_tags/{slug}.md` | `/tags/{slug}/` |
| `pages/{name}.md` | permalink from front matter |
| `index.html` | `/` |
| `blog/index.html` | `/blog/` |
| `projects/index.html` | `/projects/` |
| `_layouts/*`, `_includes/*`, `_config.yml`, `assets/css/*` | ALL pages marked changed |

#### Visual-regression gotchas (new sections / site-owned collections)

Footguns that bit the Tools section rollout (#2280; fixed in cms-platform#146) — check these before adding any new site-owned collection or top-level route:

- **New-section pages and the gate.** The regression page universe is a scan of the built `_site/`, so new site-owned collections are covered automatically — nothing to wire — and a brand-new page is confirmed by prod answering 404/410 at capture time, scored "new", and routed through the manual `regression-review` gate. **Expect the first PR adding a new section's pages to force a one-time human regression approval — expected, not a failure.** (Until #146 the universe was a hardcoded collection list — detect ran before the build — which is how #2280's `/tools/` pages shipped without ever being screenshotted. If `platform.lock` somehow still predates that release, treat the gate as blind to new sections and review their pages on the deploy preview manually.)
- **Sub-threshold and below-the-fold changes don't move the pixel diff.** The pixel gate ignores diffs under 0.5% of the viewport — the #2280 Tools nav link measured ~0.018% per page and auto-passed. The visible-text check (same release) closes this: a whitespace-normalized text delta escalates a pixel-"identical" page to review, regardless of pixel count, and covers below-the-fold content the 1920×1080 screenshot never captures. Don't reason from pixel thresholds alone.
- **Tool-sync PRs auto-pass the gate by design — for updates to EXISTING tools only.** `assets/tools/**` and `_data/tool_sources/**` are `NON_SALIENT_OVERRIDES` in the platform's `e2e/visual-regression-salient.js`: a sync-only diff never triggers the regression build — the substantive review happened in the tool's source repo (its PR + preview mirror). The carve-out can't smuggle in a **new** tool: `_tools/` is salient, and a new tool must add its `_tools/<slug>.md` entry (a sync update never touches it), so first-time additions run the full build and hit the new-page manual gate from the first bullet. Corollary: CMS/hand edits to a `_tools/*.md` entry are salient too — its copy renders on a public page. A mixed PR that also touches a template/layout stays salient and then also surfaces the tool page's own delta. (Pre-#146 sync PRs auto-passed *incidentally* — the build ran via the broad `_data/` salience but compared a page set that didn't include the tool.) See "Vendored-tool sync + previews" under the Tools section above.
- **When adding a new top-level section:** re-check the "Salient paths per workflow" table above and the workflow-path-audit skill for any `paths`/`paths-ignore` list that needs widening, and expect the one-time manual `regression-review` approval from the first bullet.

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

**Gating:** path-based via `e2e/select-specs.js`. Triggers when something contributor-relevant changed: `admin/**`, `_layouts/{post,page,project,canary,default,preview}.html`, `_e2e/**`, `scripts/patch-preview-config.sh`, `.github/workflows/{cms,deploy}-*.yml`, `e2e/{cms,decap-pat,github-actions-poll,canary-content}.*`. Self-skips when `CMS_E2E_PAT` isn't set (so forks/Dependabot don't run it). Runs once on `chromium-desktop-3k`.

**Branch-protection ruleset:** `cms-feature-branches` (id 15756474, see `.github/rulesets/cms-feature-branches.json`) requires the context `editorial / validate-content` on PRs into `cms/**`, `claude/**`, `feat/**`, `fix/**`, `chore/**`, `test/**`, `ci/**`, `docs/**`. Without this required check, GitHub's mergeable_state goes "unstable" the moment the auto-merge job's own pending state is queued — which is exactly what bit PR #78 and motivated issue #79.

**When this workflow looks "stuck":** the workflow run is rarely the bug. The publish-loop opens a `cms/<col>/<slug>` PR and waits for it to auto-merge; if a *prior* run's PR is still open with failed required checks (typically because it was opened against a base that pre-dates a recent CI fix on `main`), every subsequent run times out at ~13–40 min with `Timed out waiting for PR #N to merge`. First action: `gh pr list --state open --search "head:cms"` and audit any BLOCKED PRs — close stale ones (`gh pr close N --delete-branch`) and the next workflow run opens fresh against current `main`. Don't restart the workflow before clearing the queue. The full procedure lives in the cms-platform `cms-stuck-pr-triage` skill.

### `cms-publish-loop-prod.yml` (prod mutation playground)

Sibling to the `cms-publish-loop` and `cms-publish-loop-preview` specs, but operates against a real `_posts/` entry on `main` rather than the `_e2e/` canary subset. Per #1771 step 4 it now CREATES + DELETES an **ephemeral born-published per-run post** (`_posts/2099-12-31-e2e-prod-mutate-<runId>.md`) rather than mutating a persistent committed fixture in place — resting state is absence/404; a killed run leaks at most one inert orphan the daily sweeper reaps. See `e2e/cms-publish-loop-prod-mutate.spec.js` + `e2e/prod-mutate-fixture.js`.

**Trigger:** `push` to `main` with workflow-level `paths:` filter, plus `workflow_dispatch`. It runs **post-merge**, not speculatively per-PR: the spec drives a REAL mutation against production, so firing it on every concurrent PR raced the shared prod canary and the `deploy-production` queue and flaked non-deterministically (PR #1067). It only fires when a push to `main` touches a salient file; otherwise it doesn't run. This is safe because `prod-mutate` is not in the branch-protection required-status-checks list (it never was a PR context after the path-filter move; verify via `gh api repos/Adam-S-Daniel/adamdaniel.ai/rules/branches/main`), so not running on PRs blocks no merge. Manual `workflow_dispatch` always forces a real run regardless of paths.

**Salient paths:** `admin/**`, `package*.json`, `_config.yml`, and the workflow file itself (the e2e spec/helpers and `playwright.config.js` / `_layouts/post.html` are platform-/gem-delivered, not tracked here — the dead path entries were dropped in PR #2472). (#1771 step 4 retired the committed `_posts/2099-01-01-e2e-mutation-canary.md` salient path — the per-run post is built in code, never committed.)

**Gating layers, in order:**

1. Workflow-level `paths:` filter on the `push` (main) trigger (the workflow doesn't fire at all when a push to `main` changes nothing salient).
2. Repo variable `PROD_PLAYGROUND_MODE` must equal `'true'` (set in repo Settings → Variables and secrets → Actions → Variables). Flipping it `false` instantly stops every run from mutating prod with no code change.
3. Per-ref concurrency (`group: cms-publish-loop-prod-${{ pull_request.number || ref }}` — the `pull_request.number` half is dead on a push trigger and resolves to `github.ref`) so a newer push to `main` cancels the in-flight run.

When all three pass, the spec runs against `https://adamdaniel.ai/admin/`: it CREATES a born-published ephemeral post via the Decap "+ New Post" UI (Title + URL Slug + Date `2099-12-31` + Body + Published ON), then publishes through the editor with **Status:Ready → Publish → "Publish now"** (the proven `cms-delete-published.spec.js` create-leg flow), labels the cms PR `cms/ready` belt-and-braces → auto-merge → `deploy-production.yml`, fetches `/blog/e2e-prod-mutate-<runId>/`, asserts the run-unique marker is live, then re-opens the entry and DELETEs the post via the Decap UI ("Delete published entry" → delete-from-main PR, merged via `cms/ready`) and asserts the URL 404s. **Publish Now is required**, not avoided: it transitions Decap's editor into the PUBLISHED state, so the delete leg surfaces "Delete published entry" (a delete-from-main PR) rather than "Delete unpublished entry" (which removes only the editorial draft branch and never 404s the live URL). The merge still lands via `auto-merge-when-ready` — Status:Ready applies `decap-cms/pending_publish` and Publish Now's synchronous merge is 422'd by branch protection, which `admin/publish-via-auto-merge.js` recovers by adding `cms/ready` (#1771 follow-up; the earlier "never Publish Now" guidance described the OLD in-place-edit cleanup-merge, a different scenario). The `afterAll` is an existence-only delete of any leftover orphan (#1771 step 4).

> **Thin callers now:** `cms-publish-loop-host.yml` and `cms-publish-loop-prod.yml` (and their preview siblings) are thin callers that delegate to the platform's reusable workflows; the e2e harness + specs described here live in **cms-platform**, not this repo (`e2e/` is no longer tracked here). The triggers, run-name, and the gating notes above are owned by these site-side caller files.

**Loop co-arrival eviction — host vs prod sharing the `prod-mutating-loop` lane (#1892).** All real-prod loops serialise through one shared `prod-mutating-loop` concurrency group on each loop's heavy job (see "Loop-aware required checks" below). That group is `cancel-in-progress: false`, which holds an **in-flight** holder but **drops a co-arriving sibling** — if two loop jobs are queued in the same instant, only one survives and the other is silently evicted (NOT queued behind it). The bug: `cms-publish-loop-host.yml` and `cms-publish-loop-prod.yml` both used to trigger on the same shared infra `paths:` (`admin/**`, `playwright.config.js`, `package*.json`, `_config.yml`), so a single push to `main` fired BOTH — they co-arrived in the shared lane and the host job evicted the prod-mutate job. **Fix:** the host caller's `push` trigger is narrowed to **its own canary surfaces only** (`cms-publish-loop-host.yml`, `_e2e/canary-*.md`; the gem-delivered `_layouts/{canary,default}.html` entries were later dropped as dead paths, PR #2472) — zero path overlap with prod. Prod owns the infra-change canary on push; host still covers those paths via its daily 12:00 UTC cron. When editing either caller's `paths:`, keep the two trigger sets disjoint or the eviction returns.

### `cms-preview-loops.yml` (preview-parity loops — issue #999)

Tracked follow-up to PR #971. Sibling of `cms-publish-loop-preview.yml`: that workflow runs the canary-page publish loop against a PR preview env; this one runs the **three remaining real-backend loops that previously had prod-only coverage** through the same per-PR preview surface, closing the parity gap from #999:

| Preview spec | Prod counterpart | Loop |
| --- | --- | --- |
| `e2e/cms-publish-loop-prod-mutate-preview.spec.js` | `cms-publish-loop-prod-mutate.spec.js` | real `_posts/` body edit + publish toggle |
| `e2e/cms-unpublish-republish-preview.spec.js` | `cms-unpublish-republish.spec.js` | `_posts/` unpublish → re-publish |
| `e2e/cms-tags-lifecycle-preview.spec.js` | `cms-tags-lifecycle.spec.js` | Tags-collection create → publish → delete |

Each resolves its host via `previewTarget()` (PR head ref → `preview-pr<N>`), drives the same Decap mutation, and routes the write through a `cms/<col>/<slug>` PR Decap opens **against the PR head branch** (preview admin's `backend.branch = <head ref>`), labelled `cms/ready` → `auto-merge-when-ready` → `deploy-preview` → preview public URL. Setup/cleanup write the fixture back to the PR head branch via the Contents API, so blast radius is zero — the head branch (and any stray canary state) dies when the parent PR merges or closes. **Nothing touches `main`**, so these specs are gated on `PR_NUMBER` + `PR_HEAD_REF` + `CMS_E2E_PAT` rather than `RUN_HOST_REPO_PUBLISH_LOOP` / `PROD_PLAYGROUND_MODE`.

**Trigger:** `workflow_dispatch` only, with a required `pr_number` input (resolves the head ref via the GitHub API, identical to `cms-publish-loop-preview.yml`). It is **deliberately NOT a required check**: no `pull_request` trigger means it is never a PR status context, so it needs no `.github/rulesets/main.json` entry and no required-check stub. The heavy round trips stay off the merge path — per PR #971 the only required preview check is the lightweight read-only `preview-media` gate. The three specs are in `select-specs.js` `SPEC_RULES` (so admin/fixture/infra changes refresh PR-time coverage of their skip path) and in the `HEAVY` set (so a match doesn't inflate the PR shard matrix for a spec that just no-ops without `PR_NUMBER`).

**Inherent non-goal (from #999):** prod specs validate the path *into `main`* (main ruleset + `auto-merge-when-ready` + `deploy-production`); these validate the path *into the PR head branch* (`backend.branch=<head ref>` + `deploy-preview`). "Parity" means *which CMS operation is validated on each deployed surface* — not an identical pipeline.

> Note: #999's proposal mentions a generalized `runCmsLoop` helper. That spine landed via PR #971's *other* follow-up (#1004 — `e2e/run-cms-loop.js` + `cms-delete-published-preview`), which is intentionally independent of #999. Consistent with #1004's own "spine is additive; load-bearing specs are NOT rewritten through it, only new specs opt in" stance, these three specs mirror `cms-publish-loop-preview.spec.js` structurally and are a candidate for an optional future refactor onto `run-cms-loop.js` with no behaviour change — not a blocker for #999.

### `cms-delete-published-preview.yml` (preview-side delete loop)

Preview sibling of `cms-delete-published.spec.js`. The prod delete spec proves "Delete published entry" lands on `main`; `e2e/cms-delete-published-preview.spec.js` proves it on a per-PR preview env (`preview-pr<N>.adamdaniel.ai/admin/`, `backend.branch = <head ref>`, governed by the `cms-feature-branches` ruleset and `deploy-preview.yml`) — closing the preview-side entry-deletion gap from #999's matrix (issue #1004).

Both legs go through the shared **`e2e/run-cms-loop.js`** spine (the extracted, closure-driven orchestration skeleton: `seedDecapAuth` → open admin/entry → `mutate` → optional Save/"Changes saved" → optional `waitForCmsPullRequest` → ready strategy `ui-publish | label | none` → `waitForChangeReflected`). The spine is **greenfield/additive** — the load-bearing prod specs (`cms-publish-loop*`, `cms-delete-published`, `cms-publish-loop-prod-mutate`, `cms-media-roundtrip`) are NOT rewritten *through this spine* and keep their own bespoke flow; only new specs opt into the spine. The spine is dep-injected so the orchestration is unit-tested by `e2e/run-cms-loop.test.js` with a fake page and no browser/network.

> **Current architecture (#1771 step 4):** `cms-publish-loop-prod-mutate.spec.js` and `cms-media-roundtrip.spec.js` *were* rewritten — but to the **ephemeral born-published per-run post** model, not onto the `run-cms-loop.js` spine. Each run CREATES a uniquely-pathed, born-`published: true` post (`_posts/2099-12-31-e2e-{prod-mutate,media-roundtrip}-<runId>.md`) via the Decap "+ New Post" UI, **publishes through the editor (Status:Ready → Publish → "Publish now")** so Decap reaches the PUBLISHED state, labels the cms PR `cms/ready` belt-and-braces → auto-merge → deploy, asserts the URL serves the run marker, then re-opens the entry and DELETEs via the Decap UI ("Delete published entry" → delete-from-main PR, merged via `cms/ready`) and asserts 404. Resting state is **absence (404)**; the `afterAll` is an existence-only **delete** of any leftover orphan, not a content-restore. **Publish Now is required, not avoided** (#1771 follow-up): without it the entry stays a NEW editorial draft and the delete leg only sees "Delete unpublished entry" — which removes the draft branch, not the file on main — so the URL never 404s (this was the iteration-1/2 failure). The merge still lands via `auto-merge-when-ready` (Status:Ready → `decap-cms/pending_publish`; Publish Now's 422 → `admin/publish-via-auto-merge.js` adds `cms/ready`), exactly like the proven `cms-delete-published.spec.js`. The earlier "never Publish Now" line referred to the OLD in-place-edit cleanup-merge scenario, which no longer applies to this ephemeral create→serve→UI-delete flow. *History:* these two used to mutate a single persistent committed fixture in place (`_posts/2099-01-01-e2e-mutation-canary.md` / `_posts/2099-01-03-e2e-media-roundtrip.md`); a transient failure on the in-place revert left a corrupt shared cell on `main` that the next run re-derived its baseline from, wedging the loop (#1771 incident run 26511130712). The earlier institutional lean "don't rewrite the load-bearing prod specs" was about the lower-blast-radius `run-cms-loop.js` spine migration — the #1771 ephemeral redesign is a *different*, deliberate rewrite that removes the corruption class by construction. The persistent re-edit signal is preserved by the `_e2e/` canary in `cms-publish-loop.spec.js` (kept; #1771 step 5).

**Trigger:** `workflow_dispatch` only, with a `pr_number` input (it needs a live preview env to target). NOT in the branch-protection required-status-checks list — the only required preview check is the lightweight `preview-media` gate (PR #971). The spec UI-seeds + UI-deletes a throw-away `_e2e/canary-delete-preview-<runId>.md` and writes ONLY to the PR head branch (Contents-API afterAll is harness hygiene), so a stale fixture has zero prod blast radius — it dies with the PR. Gated by `CMS_E2E_PAT` + `PR_NUMBER` + `PR_HEAD_REF`; self-skips otherwise.

### `sweep-stale-cms-prs.yml`

Cleans up automation-only artefacts that crashed test runs leak. Runs daily at 04:00 UTC (eight hours before the host-loop's 12:00 UTC cron) plus `workflow_dispatch` with `dry_run` and `threshold_hours` inputs.

**Three-tier sweep, all age-gated by `THRESHOLD_HOURS` (default 6h):**

| Tier | What it sweeps | Branch deleted? | Opt-out |
| --- | --- | --- | --- |
| 1 | Open PRs on `cms/e2e/*` or `cms/e2e-fixture/*` branches (no label needed — these prefixes have no human use case). | Yes (`gh pr close --delete-branch`). | `keep` label on the PR. |
| 2 | Open PRs labelled `automated-test`, regardless of branch prefix. Catches `cms/posts/*` leaks from prod-mutate runs. | No (Decap reuses `cms/<col>/<slug>` per entry; the next run's `closeStaleDecapPrOnBranch` handles the handoff). | `keep` label on the PR. |
| 3 | Branches matching the same Tier 1 prefix safelist that have NO open PR (a crashed run pushed a branch but died before opening a PR). Direct ref delete via the git refs API. | Yes (it's the whole point). | `[sweep-keep]` in the tip commit message (the PR-level `keep` label can't apply when there's no PR). |

Two further content-sweep steps (`if: !inputs.dry_run`) reap throw-away fixtures left on `main`, each by opening a `cms/e2e-fixture/sweep-…` PR labelled `cms/ready` + `automated` that auto-merges via the editorial-workflow:

- **`_e2e/canary-delete-*`** — the throw-away delete fixtures from `cms-delete-published.spec.js`.
- **Ephemeral prod-loop orphans (#1771 step 4)** — `_posts/2099-12-31-e2e-prod-mutate-<runId>.md`, `_posts/2099-12-31-e2e-media-roundtrip-<runId>.md`, and the per-run uploads `assets/images/uploads/e2e-media-roundtrip-<runId>.png`. The prod-mutate + media loops now create + delete a born-published, uniquely-pathed post per run (resting state = absence/404); a crashed run that died before its existence-only-delete `afterAll` leaks at most one inert, uniquely-named orphan of each, which this tier collects.

**Pagination convention.** `gh pr list` defaults to `--limit 30` and silently truncates above that — `--paginate` is NOT a flag for `gh pr list` (gh-api-only). Every `gh pr list` in this workflow uses `--limit 1000` for top-level listing or `--limit 1` for existence checks. `gh api` calls that return arrays use `--paginate` with `?per_page=100`. New listing calls in this or related workflows MUST follow this convention; a 31st-orphan-silently-survives bug is invisible until the orphan rate climbs and is hard to diagnose because the workflow looks like it succeeded.

### `auto-resolve-newline-conflict.yml`

A **thin caller** that delegates to the platform's reusable `auto-resolve-newline-conflict.yml` (pinned per `platform.lock` / the workflow's own `uses:@` line — the authoritative pin, owned by `platform-bump.yml`; Dependabot's github-actions ecosystem ignores it, cms-platform#244); the resolver script + its tests are **platform-delivered** (run from the platform's `.cms-platform/scripts/` copy, no longer vendored here). The behaviour below describes the platform-owned logic the caller invokes — the triggers/run-name are owned by this site-side caller file.

Belt-and-suspenders for the class of bug PR #882 represents — a Decap-opened `cms/<col>/<slug>` PR whose only diff vs main is newline-mangling (`\n` → `\n\n`, `\n\n` → `\n\n\n\n`, blank between `---` and body eaten — the Slate WYSIWYG round-trip signature). When a sibling cleanup PR has already landed the canonical baseline to main, the still-open Decap PR conflicts with main even though both canonical-collapse forms are identical. Without this resolver the PR sits in `dirty` state until a human notices.

**Triggers:**

- `workflow_run` on completion of `cms-editorial-workflow.yml`. Decap pushes a commit every time the editor saves, which fires the editorial workflow; the `workflow_run` rendezvous lets the resolver look ~10–20 s after each push, by which time `mergeable_state` has settled. (`pull_request: synchronize` doesn't surface `mergeable_state` synchronously and would fan out per-keystroke runs.)
- `workflow_dispatch` with a PR number + optional `dry_run` for on-demand resolution.

**Gates (enforced in the platform-delivered `auto-resolve-newline-conflict.js`):**

| Gate | Allows |
| --- | --- |
| PR state | `open` |
| Mergeable state | `dirty` only (skips `clean`, `unknown`, `blocked`, etc.) |
| Head ref | `cms/{e2e,e2e-fixture,posts,pages,projects,tags}/...` |
| Author | `decap-cms[bot]`, `Adam-S-Daniel` |
| Head repo | Same as base repo (no forks) |
| Idempotency | A `<!-- key:<base-sha>:<head-sha> -->` comment marker — already-resolved (base, head) pairs are skipped |
| Per-file path | Must match `PATH_ALLOWLIST`: canary fixtures, `_posts/**.md`, `pages/**.md`, `_projects/**.md`, `_tags/**.md` |
| Per-file status | Not `removed` or `added` (only `modified` files — a CMS PR adding a new file has real intent) |
| Per-file content | No markdown code fences on either side (intentional blank lines may exist) |
| Per-file equivalence | `canonical(base) === canonical(head)` where `canonical(s) = s.replace(/\n+/g, '\n')` |

**Action when ALL gates pass:** close the PR with a sticky comment listing the files inspected. Force-pushing a rebase would result in an empty-diff PR (since the canonical resolution converges to main's content for every allowlisted file), so close is simpler and lower-risk. The PR's `cms/ready` auto-merge intent doesn't matter — closing skips the merge entirely.

**Action when ANY gate fails:** post a sticky comment listing the reasons; leave the PR open for human review. The same comment marker prevents the next push from re-posting the same diagnostic.

**Why a script + workflow instead of inline shell:** the equivalence check, allowlist matching, and idempotency-comment parsing are easier to unit-test than to inline. The platform-delivered `auto-resolve-newline-conflict.test.js` (29 tests via `node --test`) covers `canonical()` on the three observed Slate transforms, all four allowlist functions, and end-to-end `run()` happy/sad paths with mocked `fetch`. New regression cases just add a test in the platform, not a workflow re-run.

**Why CMS_E2E_PAT, not GITHUB_TOKEN:** the resolver closes the PR via `PATCH /repos/<o>/<r>/pulls/<N>` with `{state: 'closed'}`. PR-state changes authored by `GITHUB_TOKEN` don't fire downstream workflows (e.g. preview-teardown); the PAT lets those fire. Same reason `cms-editorial-workflow.yml`'s `auto-merge-when-ready` job uses the PAT.

### Architecture Decision Records

Non-obvious decisions — the kind that invite "let's just change it back" without context — live as Nygard-style ADRs under [`docs/decisions/`](docs/decisions/). The README there has the format, the index, and the when-to-write-one rules. New ADRs are numbered `NNNN-kebab-title.md` starting at `0001`; the README's index gets a new row in the same commit.

If you find yourself writing a long PR description explaining *why* a one-line config change isn't crazy, that's the signal to write an ADR instead and link to it from the PR.

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
| --- | --- | --- |
| `editorial / validate-content` | `cms-editorial-workflow.yml` → cms-platform reusable | Always fires (no path filter) — front-matter + Jekyll build sanity check |
| `scan / scan` | `secrets-scan.yml` → cms-platform reusable | Always fires (gitleaks must scan every PR diff) |
| `parity / parity` | `parity-preview.yml` → cms-platform reusable | Always-run + early-skip: runs the `@parity-preview` spec subset against the PR's own `preview-pr<N>` surface, reporting success immediately when no such spec applies |
| `preview-media / preview-media` | `preview-media.yml` → cms-platform reusable | Always-run + early-skip: read-only probe that a media-salient PR's preview surface serves the expected asset; auto-passes on non-media PRs |
| `e2e / e2e` | `e2e-tests.yml` (or `e2e-stub.yml` on doc/infra-only PRs) → cms-platform reusable | The reusable fans the suite out over a `project` matrix (one job per Playwright project) behind an aggregating `e2e` gate job, so this stays the ONE required context — the per-project `e2e / project (<name>)` contexts are informational and named by no ruleset. `e2e-tests.yml` carries `paths-ignore` (README/AGENTS/CLAUDE/docs/infrastructure/oauth-proxy/LICENSE/.gitignore); `e2e-stub.yml` mirrors that list byte-for-byte and emits a trivial green `e2e` job so the required context is never MISSING on a doc/infra-only PR |
| `visual-regression / approve-regression` | `visual-regression.yml` → cms-platform reusable | No path filter (fires on every PR); the reusable's `approve-regression` gate runs `if: always()` and enters the `regression-review` environment only when visually-different pages were found, auto-passing otherwise — so it always reports a status |

`prod-mutate` (`cms-publish-loop-prod.yml`) and `host-loop` (`cms-publish-loop-host.yml`)
were historically required but are not anymore — both trigger on `push` to `main`,
not `pull_request`, so the check never appears on a PR at all (post-merge real-prod
loops; PR #1067). `deploy-preview` remains excluded for the missing-check-trap reason
(path-filtered `pull_request`, no always-run fallback). Re-promoting either would
require converting to the always-run + early-skip pattern first.

**Required status checks are the default.** Any CI job that runs on pull requests is
assumed to be a required check and must be enforced via the `main` ruleset before a
branch can merge. Do NOT leave checks optional unless this section documents a
specific reason. When adding new workflow jobs, update `.github/rulesets/main.json`
and reapply in the same commit.

**Required-check + path-filter trap:** GitHub blocks the merge when a required check
is *missing* (because path filtering prevented the workflow from running) — it
doesn't auto-pass missing checks. Workflows promoted to required therefore use
either the always-run + early-skip pattern (`parity-preview.yml`, `preview-media.yml`,
`visual-regression.yml`'s `approve-regression` gate) or a byte-mirrored stub workflow
that fires on the primary workflow's ignored paths and emits the same-named job
(`e2e-stub.yml` for `e2e-tests.yml`) — either way the named check is always present.

Auto-merge is enabled in repository settings. Direct pushes to `main` are allowed for
the repository owner only.

The same required-checks list governs Dependabot's unattended-merge pipeline
(`dependabot-auto-merge.yml`). When a Dependabot PR enables auto-merge, GitHub holds
the merge until every check above reports success — so a vulnerable browser fixture,
a regressed pixel, or a broken Jekyll build all block the bump. `prod-mutate` is no
longer required (workflow-level `paths:` filtering would make it miss on most
Dependabot PRs), but `e2e-tests.yml`'s reusable still selects the publish-loop spec
for Dependabot bumps that touch `package*.json` — so the matrix still surfaces
Decap/Playwright incompatibilities before merge, just under the single `e2e / e2e`
check rather than a dedicated one.

---

### `dependabot-auto-merge.yml`

**Trigger:** `pull_request` opened/synchronised/reopened by `dependabot[bot]`, targeting `main`.

**Secrets needed:** none (uses built-in `GITHUB_TOKEN`).

**Pairs with:** `.github/dependabot.yml` — **exactly two** ecosystems, each carrying `package-ecosystem` / `directory: "/"` / `schedule: interval: weekly`, plus one `ignore:` entry under `bundler`:

| ecosystem | what it bumps |
| --- | --- |
| `github-actions` | the `uses: Adam-S-Daniel/cms-platform/...@<tag>` pins in the workflow callers. Every `uses:` in this repo is a cms-platform reusable — zero third-party actions |
| `bundler` | the site's own gems: `jekyll`, `webrick`, `jekyll-seo-tag`, `jekyll-feed`, `jekyll-sitemap`. **NOT** `cms-platform-theme` — see the `ignore` below |

**The `bundler` ecosystem `ignore`s `cms-platform-theme` (cms-platform#242).** `platform-bump.yml` owns that gem's version and moves it atomically with `platform.lock`, the `Gemfile.lock` revision and every `uses:@<tag>` pin; Dependabot could only ever move the `Gemfile`/`Gemfile.lock` half, so its bump was either redundant or actively skewed — #3076 rebased a stale PR forward without re-resolving its target and proposed a **downgrade**, `v0.1.80 → v0.1.75`. Note the ignore is deliberately **unscoped** (no `versions`, no `update-types`): a scoped one would not have stopped that PR. It suppresses security updates for that gem too, which costs nothing — it is a first-party git-sourced gem with no advisory-database entry, and `platform-bump` adopts every release including security fixes. Two platform lints hold the invariant (`dependabot-theme-gem-ignored.test.js` here, `scaffold-seeds-dependabot-ignore.test.js` on the template).

**The `github-actions` ecosystem `ignore`s every cms-platform reference the same way (cms-platform#244)** — the `uses:@<tag>` reusable-workflow pins, not just the gem. That ecosystem treats each workflow FILE as its own dependency, so it can only ever move one caller's pin per PR; every such PR necessarily leaves the other pins behind, exactly the skew `check-platform-pin-consistency.js --require-canonical` exists to fail. jodidaniel.com#8–#22 (2026-06-03/04) produced fifteen bump PRs from a single release, two of which Dependabot itself closed as redundant once another had already landed the same ref; adamdaniel.ai#1895–#1898 produced four more with *different* from-versions per file in the same batch (`0.1.0→0.1.6` and `0.1.3→0.1.6`); adamdaniel.ai#1900 was closed outright with "A piecemeal bump to v0.1.6 would now fail the platform-pin-consistency guard." `platform-bump.yml` is now the sole writer of every platform version reference in a consumer — moving every `uses:@<tag>` pin, every `platform_ref:` input, `platform.lock`'s `platform_ref`, and the `Gemfile`/`Gemfile.lock` gem `tag:`/`revision:` in one PR is what lets `--require-canonical` pass on that PR alone. As with the gem ignore above, the scope is deliberately `Adam-S-Daniel/cms-platform/*`, not a bare `*`: the ecosystem stays wired and would pick up a genuine third-party action the moment one is added, even though today it watches nothing — every `uses:` in this repo's `.github/workflows/` is a cms-platform reusable, the same inert-by-design posture #242 left the `bundler` half in (where `jekyll`/`webrick` keep flowing). The same two lints now assert both ignores: `dependabot-theme-gem-ignored.test.js` (this repo's own file) and `scaffold-seeds-dependabot-ignore.test.js` (the template).

There is **no `cooldown`** (the string doesn't appear in the file), **no `groups:` / `update-types:`** grouping, and **no `docker` or `npm` ecosystem**. Earlier revisions of this section described all four; none of them ever existed here. Consequences worth knowing: because there is no `npm` ecosystem (despite a root `package.json` / `package-lock.json`), Dependabot never opens a `package-lock.json` bump PR on this repo; and because there is no `docker` ecosystem and no `.github/ci-runner/` directory at all, the whole CI-runner-image story that used to live in this paragraph is void here — see the CI-flakiness-invariants note on the Playwright image drift guard, which is platform-owned.

**The missing `npm` ecosystem is a DECISION, not an oversight — do not "fix" it.** Reviewed 2026-08-10 against the repaired Dependabot pipeline (which now merges bumps unattended), and the answer is no, for two independent reasons:

- **No CI job here installs the root `package.json`.** Verified: zero `npm` invocations across all of `.github/workflows/` — every reusable's `npm ci` runs in the PLATFORM's `.cms-platform/e2e` against *its* lockfile, never this repo's root one. So a bump would land through the auto-merge pipeline having been exercised by nothing, which is precisely the unverified-unattended-change posture the pipeline repair was meant to avoid. cms-platform's own npm cooldown exists for the opposite case — deps its CI genuinely executes.
- **It would actively cost prod mutations.** `package.json` and `package-lock.json` are salient paths on `cms-publish-loop-prod.yml`'s `push` trigger, so every merged npm bump would fire a real ~10-minute prod-mutating loop against the live site to validate a linter version CI never ran.

Nothing is forgone by the omission: Dependabot **security** updates are a repo-level toggle and need no `dependabot.yml` entry, so advisory coverage is independent of this file. And the deps are a local-developer toolchain by design — the heavyweight lint toolchain is platform-internal, there is no consumer lint CI (see *Code quality*), and `scripts/lint-staged.sh` skips any linter whose tool is absent. If a future change makes CI actually execute these deps, revisit — that is the fact the decision turns on.

**Cooldown is a PLATFORM-side knob, deliberately not a consumer one.** cms-platform's own ecosystems (`github-actions` + its `/e2e` npm harness) carry a graduated `cooldown: {default-days: 7, semver-major-days: 30}` (v0.1.76), mechanising its cooling-off for third-party action SHAs and harness majors; GitHub's own default minimum package age is 3 days, so those are a raise rather than a floor from zero, and cooldown applies to version updates only — a security advisory bypasses it. A consumer intentionally gets **no** cooldown, and the reason is not the one first recorded here ("it would delay release adoption"): release adoption is landed by `platform-bump.yml`, which opens the bump PR itself, so Dependabot is not on that path. The real reason is that **this repo pins zero third-party actions** — every `uses:` in `.github/workflows/` targets `Adam-S-Daniel/cms-platform/.github/workflows/*.yml` — so a `github-actions` cooldown here would have no supply-chain surface to hold. (cms-platform#244 removes even that: the `github-actions` ecosystem now carries an explicit ignore for every cms-platform reference, so there is no cms-platform Dependabot activity left for a cooldown to gate at all.)

#### Job: `auto-merge`

1. Only runs when `github.actor == 'dependabot[bot]'`
2. Uses `dependabot/fetch-metadata` to pick up the update-type / dependency-name and validate the PR genuinely came from Dependabot
3. Path-allowlist gate — diff must only touch `package*.json`, `Gemfile*`, or `.github/workflows/*.{yml,yaml}`. Anything else fails the job and disables auto-merge (idempotent — `gh pr merge --disable-auto || true`). This is the "no content will be altered" guarantee: a Dependabot PR can never ship a content change unattended, even if its branch were tampered with.
4. On a clean diff: `gh pr merge --auto --squash` enables GitHub's native auto-merge. Branch protection's required-checks list (e2e + visual-regression / approve-regression) governs when the merge actually fires.

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

- GitHub OAuth authentication (reuses existing Lambda proxy). Implements the full Decap handshake: the popup posts `"authorizing:github"`, the dashboard echoes it back at the popup's origin, the popup releases an `"authorization:github:success:<JSON>"` payload, the dashboard parses the token. Skipping the echo leaves the popup spinning on "Completing authorisation…" forever — the same shape of bug Decap itself would surface if its handshake broke.
- Lists all pending visual regression reviews
- Embedded `<video>` player for regression videos hosted at `preview-pr{N}.adamdaniel.ai/regression.mp4`
- Stat grid (Visually different / Potentially affected / New / Identical) plus the per-page list of visually-different paths, fetched from `preview-pr{N}.adamdaniel.ai/regression.json` per card. Cross-origin GET, no GitHub auth needed.
- One-click approve / request-changes with comment
- Auto-refreshes every 60 seconds

### `e2e-tests.yml`

**Trigger:** pull request targeting `main`, `paths-ignore`: `README.md`, `AGENTS.md`,
`CLAUDE.md`, `docs/**`, `infrastructure/**`, `oauth-proxy/**`, `LICENSE`,
`.gitignore`. The PR run is required by branch protection, so the merge commit on
`main` is already covered — no post-merge re-run.

**Job:** a single `e2e` job that delegates the ENTIRE Playwright suite to the
platform's reusable `e2e-tests.yml` (pinned via the `uses:@` line, in lockstep
with `platform.lock`) via `workflow_call`. The reusable checks out the harness
(`e2e/`, `playwright*.config.js`) from cms-platform, builds this site
(`target: local` — a real `jekyll build` + `decap-server`), and runs the full
matrix. There is no separate `select` / `unit` / sharded-`e2e` / `parity` /
`finalize` set of jobs in THIS repo's own workflow file — `parity` is its own
caller now (`parity-preview.yml`, covered under "Required status checks" above).

**Inside the reusable: one job per Playwright PROJECT** (cms-platform v0.1.68).
The reusable fans out a `project` matrix — 10 jobs, each on its own runner,
each running one project and installing only that project's browser engine —
behind an aggregating `e2e` gate job. So this repo still surfaces exactly one
REQUIRED context, `e2e / e2e`, plus 10 informational `e2e / project (<name>)`
contexts that no ruleset names. Nothing here needed changing for that, and the
`main` ruleset was NOT touched.

Wall clock went from ~680 s to **~200-220 s** on this repo. Every project job
runs at the SAME worker count (`150%` — 6 on a 4-vCPU runner). An earlier version
of this paragraph said the counts "differ per project on purpose" because "a
4-vCPU runner saturates at ~2 browser workers"; both halves were wrong. That
saturation was an artifact of measuring 8 projects in ONE job — with one project
per job, 6 workers beat 2 almost everywhere. `--shard` is deliberately unused (it
balances by test count, and this suite's per-test durations span 5 ms → 49 s).

The long pole is `webkit-iphone16` at ~200 s (~40 s install + ~140 s tests): that
is WebKit's own test speed, not CI shape — it spends 141 s on the same
`@admin-read` specs `chromium-desktop-3k` finishes in 104 s while ALSO running
every `@admin-write` round trip. The platform doc prices the only remaining lever
(sharding within a project) before you try it.
The measurements, the rejected alternatives, and how to re-measure live in the
platform's [`docs/E2E-PARALLELISM.md`](https://github.com/Adam-S-Daniel/cms-platform/blob/main/docs/E2E-PARALLELISM.md).
**Read that before re-tuning anything about e2e parallelism.** To dial workers
down without a platform release, pass the reusable's `workers` input from this
caller (e.g. `workers: "2"`).

**Companion:** `e2e-stub.yml` fires on the byte-mirror of this file's
`paths-ignore` list and emits a trivial green `e2e` job, so `e2e / e2e` is never a
MISSING required check on a doc/infra-only PR (see "Required-check + path-filter
trap" above).

**Inputs passed to the reusable:** `target: local`, `prod_url`, `apex`,
`browser: all` (installs every engine), `pr_number`, `prod_playground_mode` (from
this repo's `PROD_PLAYGROUND_MODE` var, gating the prod-mutate / real-loop specs),
`platform_ref` (kept in lockstep with the `uses:@` pin).

**Secrets:** `CMS_E2E_PAT` — optional; when unset, preview discovery falls back to
`GITHUB_TOKEN` and the real-lane CMS specs self-skip.

**No diff-aware spec SELECTION on this lane.** `e2e/select-specs.js` still
exists in the harness, but `e2e-tests.yml` does not use it: the e2e lane runs
the WHOLE suite on every PR and gets its speed from parallelism instead, so
there is no "did the selector miss my spec?" failure mode. The selector (and its
`SPEC_RULES` / `// @select-skip-when-head-ref-prefix:` header directive) drives
the `parity-preview` and `preview-media` lanes, which probe a deployed preview
and genuinely must no-op when a PR can't affect one.

Tests run with `fullyParallel: true`, so a project's tests spread across that
job's workers.

#### Always-run baseline

There is no per-diff spec SELECTION in the platform reusable — every project job
runs the whole suite for its own project (see "one CI job per Playwright project"
above), so "always-run" is now just the cheap, browser-free end of that suite
rather than a separate tier. Representative members:

- `e2e/compute-visual-diffs.test.js` — pure pngjs unit tests for the visual-diff classifier
- `e2e/cms-config.spec.js` — YAML structural invariants for the Decap config (editorial workflow on, every folder collection has explicit create + delete, all required fields present, etc.)
- the ~95 other pure-fs `e2e/*.test.js` lints the platform ships

(`e2e/visual-change-guard.spec.js` used to be listed here; cms-platform v0.1.34
deleted it — it only bounded the committed-PNG suite that release retired.)

#### Per-test screenshot videos — OFF in CI (local-only)

> **This pipeline does not run in CI.** The `finalize` job that assembled the
> videos was adamdaniel-only and was NOT ported to the platform reusable, so
> nothing in CI ever consumed the frames — the capture was pure cost, worst on the
> link-crawling admin specs. The platform's `e2e-tests.yml` therefore sets
> `DISABLE_PER_TEST_VIDEOS=1` (cms-platform v0.1.68). `screenshot: "on"` +
> `video: "retain-on-failure"` still produce the artifacts a red run is diagnosed
> from. Everything below describes the mechanism as it works **locally** (unset the
> env var); if you ever wire the assembly into a reusable, unset it there too.

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

The underlying gitleaks binary's version pin lives in the PLATFORM's reusable `secrets-scan.yml` workflow, not in this repo's thin `secrets-scan.yml` caller (which has no `GITLEAKS_VERSION` key at all). Bump deliberately, not on a whim — that bump happens in cms-platform.

Allowlist for known test fixtures lives in `.gitleaks.toml`. When a new test hardcodes a fake-looking token, add it there rather than disabling the workflow.

The platform-delivered post-failure-comment action's bundled `scrub-secrets.js` (used by the e2e bot to redact failure summaries before commenting on PRs) runs the same `gitleaks` binary at runtime. The CI gate and the runtime scrubber share the same default ruleset.

#### Local pre-commit guard

`scripts/secrets-scan.sh` runs `gitleaks protect --staged --redact` against the index before every commit, so a secret never reaches local history (or the reflog, which survives a force-push). It uses the same `.gitleaks.toml` as CI. Its local hook's `GITLEAKS_VERSION` parse targets THIS repo's own `secrets-scan.yml`, which is a thin caller with no pin of its own post-cutover (the pin lives in the platform's reusable workflow instead) — so the hook currently can't detect drift against the platform's actual pinned version; install whatever `gitleaks` version you have. There's no local drift check today.

The hook is registered through both supported pathways:

- **Git ≥ 2.54** — `[hook "secrets-scan"]` and `[hook "lint-staged"]` in `.gitconfig-fragment`. `git hook list pre-commit` shows both.
- **Git < 2.54** — chained inside `.githooks/pre-commit`.

`scripts/setup-hooks.sh` picks the right path based on `git --version`; it runs automatically via the `.claude/settings.json` `SessionStart` hook, so there's nothing extra to wire up after a fresh clone. These guard files (`secrets-scan.sh`, `lint-staged.sh`, `setup-hooks.sh`, `.githooks/pre-commit`, `.gitconfig-fragment`) are platform-authoritative — delivered + kept in sync by the cms-platform `dev-hooks-sync.yml` reusable.

If `gitleaks` isn't on `PATH`, the hook fails with install instructions for macOS / Linux / Windows. Bypass for emergencies via `SKIP_SECRETS_SCAN=1 git commit ...` (preferred over `--no-verify`, which also disables `lint-staged`). CI still scans the PR, so a bypassed commit won't merge with a real leak.

---

## Failure-comment composite action

The `uses: ./.github/actions/...` paths in the examples below are relative to the
PLATFORM repo's own reusable workflows — this repo has no `.github/actions/`
directory; every workflow here calls a platform reusable via
`uses: Adam-S-Daniel/cms-platform/...@vX.Y.Z`, and the platform reusable is what
invokes the composite internally.

In environments with no pre-authenticated `gh` cli, workflow logs are not directly readable (the GitHub MCP server has no `actions/runs/.../logs` tool and unauthenticated `curl` to `api.github.com/.../actions/runs/.../logs` returns 403). To make CI failures triage-able from inside a PR conversation, every Playwright-running workflow forwards its captured log to a shared composite action:

```yaml
# Caller-side gating — failure() / success() at the workflow
# level is the canonical pattern. Two call sites: one for the
# failure post, one for the green-run resolve.
- name: Post failure summary
  if: ${{ failure() && github.event_name == 'pull_request' }}
  uses: ./.github/actions/post-failure-comment
  with:
    mode: post
    log-file: /tmp/<your-log>.log
    marker: <unique-marker-slug>     # NO `<!-- -->` — the action wraps it
    title: <short label>

- name: Resolve failure summary on success
  if: ${{ success() && github.event_name == 'pull_request' }}
  uses: ./.github/actions/post-failure-comment
  with:
    mode: resolve
    marker: <unique-marker-slug>
    title: <short label>
```

The action is mode-driven and does NOT detect job state itself. Earlier versions tried `${{ job.status }}` (silently empty inside composite `with:` blocks) and `failure()` / `success()` inside the action's own step `if:` clauses (also unreliable for our composite case). v3 pushes the gate to the caller, where `failure()` / `success()` are well-tested workflow primitives.

For MULTI-job workflows — a job posting on behalf of an upstream one, e.g. an aggregating gate reporting for the matrix beneath it — `failure()` / `success()` reflect only the POSTING job's state, not the matrix's. Gate on `needs.<job>.result` instead. (This repo no longer has such a call site: `e2e-tests.yml`'s per-project matrix jobs each post their own project-scoped comment from inside the job, so plain `failure()` / `success()` is correct there. The pattern is kept because it is the right shape whenever a downstream job reports for an upstream one.)

```yaml
- if: ${{ needs.e2e.result == 'failure' && github.event_name == 'pull_request' }}
  uses: ./.github/actions/post-failure-comment
  with: { mode: post, log-file: /tmp/playwright-output.log, marker: e2e-failure-summary, title: E2E tests }

- if: ${{ needs.e2e.result == 'success' && github.event_name == 'pull_request' }}
  uses: ./.github/actions/post-failure-comment
  with: { mode: resolve, marker: e2e-failure-summary, title: E2E tests }
```

For workflows that don't fire on `pull_request` (e.g. `cms-publish-loop-preview.yml` on `workflow_dispatch`), pass `pr-number: ${{ inputs.pr_number }}` as well — the action falls back to looking up the head SHA via the API.

**The caller MUST grant `pull-requests: write` to the workflow** (or to the calling job, if you scope per-job). Without it, the embedded `actions/github-script` call 403s silently and no comment lands. A typical block:

```yaml
permissions:
  contents: read
  pull-requests: write
```

The composite action is **platform-delivered** — the callers reference the platform's copy (checked out under `.cms-platform/.github/actions/post-failure-comment/action.yml`), and the action runs its OWN bundled helper scripts via `$ACTION_PATH`, not consumer-owned `scripts/`:

1. Installs `gitleaks` to `$HOME/.local/bin` (no sudo, works in both the Playwright Docker container and on `ubuntu-latest`).
2. Runs the action's bundled `extract-playwright-failures.sh` against the captured log to pull just the numbered failure blocks; falls back to `tail -c 80000` if the extractor finds nothing.
3. Pipes the result through the action's bundled `scrub-secrets.js` (gitleaks-backed) and truncates to 60 KB to fit in a GitHub comment.
4. Posts (or updates, via marker-based dedup) a PR comment under `<!-- <marker> -->`.
5. Resolves the comment to a "passing on `<sha>`" stub on the next green run.

**Markers in use** (must be globally unique to avoid clobbering each other):

| Marker | Workflow / job |
| --- | --- |
| `e2e-failure-summary-<project>` | `e2e-tests.yml` → each per-project matrix job (e.g. `e2e-failure-summary-webkit-iphone16`). Project-scoped because matrix jobs sharing one marker would clobber each other's comment — and the marker names the project that went red |
| `parity-preview-failure-summary` | `parity-preview.yml` → `parity` |
| `preview-media-failure-summary` | `preview-media.yml` → `preview-media` |
| `host-loop-failure-summary` | `cms-publish-loop-host.yml` |
| `prod-mutate-failure-summary` | `cms-publish-loop-prod.yml` |
| `media-roundtrip-failure-summary` | `cms-media-roundtrip.yml` |
| `preview-loop-failure-summary` | `cms-publish-loop-preview.yml` |
| `preview-delete-failure-summary` | `cms-delete-published-preview.yml` |
| `preview-loops-failure-summary` | `cms-preview-loops.yml` (distinct from the singular `preview-loop-…`) |

**Gitleaks pass-through is non-optional.** Every comment that lands on a PR via this action runs through the action's bundled `scrub-secrets.js` (which shells out to `gitleaks detect`) inside the action's `Extract and scrub failure summary` step. There is no caller-side switch to disable it; if you extend the action with a new mode, keep the scrubber call on every code path that emits log content into a comment body. A leaked PAT in failure output that bypasses gitleaks would be visible to anyone with read access to the PR — treat the scrubber the same as the secrets-scan pre-commit hook.

**Security note.** The embedded `actions/github-script` calls receive their inputs as `env:` vars and read them via `process.env.X` — never inline `${{ inputs.x }}` directly into a script body. This pattern is what `actions/github-script`'s README explicitly requires, and it's a script-injection vector if you skip it. Same rule applies to any extension of the action.

The full convention (when to use, when NOT to use, common refactor pitfalls, how to test wiring) lives in the cms-platform `post-failure-comment` skill.

## Recursion gate composite action

Same caveat as above: `.github/actions/cms-recursion-gate/action.yml` is a path
inside the PLATFORM repo, not this one — this repo has no `.github/actions/`
directory, and the platform's reusable loop workflows are what invoke this
composite internally.

The three real-prod loop workflows (`cms-publish-loop-host` / `cms-publish-loop-prod` / `cms-media-roundtrip`) mutate `_e2e`/`_posts`/`_tags` canaries through Decap, which auto-merges the resulting `cms/<col>/<slug>` PR back to `main`. That push to `main` matches the workflow's own `paths:` filter, so **the loop can re-trigger itself**. A cheap `recursion-gate` job (shared composite at `.github/actions/cms-recursion-gate/action.yml`) decides per event whether the heavy loop job runs; the loop job carries `needs: recursion-gate` + `if: ${{ needs.recursion-gate.outputs.run == 'true' }}` and **no other recursion `if:`**.

**Why the old guard was wrong (run 26108485428).** The previous job-level `if:` skipped when `github.event.head_commit.message` started with `publish: `. That prefix is emitted **only** when a cms PR merges via `cms-editorial-workflow.yml`'s `enablePullRequestAutoMerge` (`commitHeadline: "publish: …"`). Decap's *synchronous* "Publish Now" squash and its git-data-API delete instead land the canary with Decap's own `Update {{collection}} "{{slug}}"` / `Delete …` template — single-parent squash, **no `publish: ` prefix** — so the guard never matched and `cms-unpublish-republish.spec.js`'s `_posts/2024-01-02-e2e-unpublish-canary.md` (`Update Post "…"`) re-fired the loop. `_e2e/canary-post.md` *does* carry `publish: ` and was caught: the guard was structurally unreliable, not merely buggy. **Never gate recursion on a commit-message prefix you don't fully control** — Decap controls this one.

**Mechanism.** On `push`: 2-dot `git diff --name-only <before> <sha>` (after a `fetch-depth: 2` checkout) → pure `shouldRunLoop(loop, changedPaths)` in `e2e/cms-recursion-churn.js`. RUN iff any changed file is **outside** the loop's self-churn set; SKIP iff every changed file is the loop feeding itself. `schedule`/`workflow_dispatch` always run. Branch-create / unreachable-before / diff-error / empty-delta all **fail OPEN** (run) — never silently skip a possibly-real machinery change. `e2e/cms-recursion-churn.js` is the single source for the per-loop self-churn globs (it reuses `canary-content.CANARIES`, so the canary list can't drift); `e2e/cms-recursion-churn.test.js` cross-checks every spec's fixture is covered and `e2e/workflow-prod-loop-serialized.test.js` locks the wiring (gate job, `fetch-depth: 2`, exact `needs:`/`if:`, no lingering retired guard). The `prod-mutating-loop` lane lives on the **heavy loop job**, not the workflow (#1178), so the gate runs *outside* the lane: its skip decision is computed immediately even while a real loop holds the lane, and a recursion-skipped loop is `if:`-skipped before it ever enters the lane (zero lane occupancy for recursion). The #1101 cross-workflow mutual-exclusion guarantee survives the move because GHA keys concurrency groups by string *across* workflows — one constant group on the three loop jobs still serialises them — and the lint now asserts that shared, byte-identical `concurrency:` block on each loop's heavy job (and its *absence* at workflow scope, so the gate can't be dragged back into the lane).

**Two conventions this codifies (apply beyond this feature):**

1. **Action dependency policy.** Prefer trusted built-ins (`git`, `node`) over a bundled marketplace action when they do the job. `tj-actions/changed-files` was rejected here on supply-chain grounds (CVE-2025-30066, Mar 2025: a stolen `@tj-actions-bot` PAT retroactively repointed *every* version tag; ~9k lines of unverifiable bundled JS into a workflow that holds `CMS_E2E_PAT`). The composite is bash + `node` only, **no transitive `uses:`** — same shape as `await-prod-deploy` / `post-failure-comment`, and clean for the SHA-pin convention. If a marketplace action is genuinely warranted, it MUST be SHA-pinned with a dated version comment after the 7-day cooling-off — the policy is AGENTS.md's "Pinning GitHub Actions" section; see also the `github-actions-sha-pinning` skill.
2. **Single source over byte-identical duplication.** When N workflows need the same logic, factor it into one composite + one data module and lint the *structural wiring*, rather than duplicating the logic into each workflow and lint-asserting byte-identical text. (The `#1101`/#1178 byte-identical `concurrency:` block — now declared on each loop's heavy job rather than the workflow — predates this and is kept as byte-identical duplication; the recursion gate is the pattern to follow for new shared logic.)
