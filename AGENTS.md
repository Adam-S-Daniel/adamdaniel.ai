<!-- BEGIN MANAGED SECTION — DO NOT EDIT ABOVE "## Repo-specific additions" -->
<!-- Source: _agent-guidance -->
<!-- Sections: none -->
<!-- Mode: stub -->

# AGENTS.md

> **Managed by [`_agent-guidance`].**
> Edit only below the `## Repo-specific additions` header.
> Everything above it will be overwritten on the next sync.

## Fleet guidance is delivered once per session — not by this file

The account's full guidance — incidents, fleet policy, machine layout, the
traps that cost real outages — is installed into **user memory**
(`~/.claude/CLAUDE.md`) by the `fleet-memory` SessionStart hook, so it is
loaded **once per session** no matter how many repos are attached. It used to
be inlined here in every repo, which meant a session with 19 repos open
carried 19 identical copies: 332.3k tokens of a 1M window, measured
2026-08-29.

**Check the session-start verdict before you rely on it.** The hook prints one
line:

- `fleet-guidance: installed (v<id>, <n> bytes)` or `fleet-guidance: current` —
  the full guidance is in context. Use it.
- `fleet-guidance: DEGRADED — <reason>` — it is **not** in context. You have
  only what is below. Read `agents-md/base.md` in the `_agent-guidance`
  checkout (or on GitHub) before non-trivial work, and say in your reply that
  you were running degraded.
- `fleet-guidance: skipped (FLEET_GUIDANCE_SKIP set)` — also not in context,
  but by the machine owner's deliberate choice, not a fault. User memory is
  GLOBAL on a durable machine, so the guidance would otherwise load in every
  unrelated project on that box; `FLEET_GUIDANCE_SKIP` opts out and removes any
  block an earlier session installed. Read `agents-md/base.md` the same way you
  would when degraded — just don't report it as a problem or try to "fix" it.

No verdict at all means the hook never ran — treat that as DEGRADED.

## Codex reads the same block, from `~/.codex/AGENTS.md`

The hook writes the same block to `~/.codex/AGENTS.md` whenever `~/.codex`
exists — Codex's global **user** instructions, outside its 32 KiB
`project_doc_max_bytes` project-doc budget. Register it once per machine with
`scripts/register-codex-hook.sh` from an `_agent-guidance` checkout, then
trust it in `/hooks`. `codex debug prompt-input` shows exactly what a session
loaded; no `fleet-guidance:` line there means DEGRADED.

For Codex Cloud, use **Manual** environment setup with persistent
`CODEX_HOME=/opt/codex`. Preserve the repository's dependency setup and run
`bash .claude/hooks/fleet-memory.sh --codex-cloud` in both setup and
maintenance; reset the cache for the first verification. Fresh setup and
cached maintenance were verified in the `_agent-guidance` environment. See
[`docs/codex-cloud.md`](https://github.com/Adam-S-Daniel/_agent-guidance/blob/main/docs/codex-cloud.md).
If the Cloud shell has no `codex debug prompt-input`, the saved task response's
raw initial instruction envelope is the echo-free proof of model-visible
delivery.

## The floor: rules that hold even when the guidance did not load

These are the ones with teeth. They are restated here, deliberately, because a
session that lost the guidance must not also lose these.

- **Branch protection is real.** Fleet repos are PR-only on their default
  branch; a direct push is rejected (GH013), even from the repo's own
  workflows. Never design a bot that pushes to a protected default branch.
- **Every `uses:` is pinned to a full 40-character commit SHA, with no
  trailing version comment.** The one carve-out is a ref into this account's
  own `cms-platform`, which stays on its release tag.
- **Never commit secrets or `.env` files, and never print personal data to a
  CI log** — logs, artifacts and git history on a public repo are public.
- **A successful `git push` does not mean your commit exists.** A refused
  pre-commit hook still lets the push report success. Verify with
  `git merge-base --is-ancestor <sha> origin/<branch>` — it is the only check
  that names both the commit and the ref.
- **"The watch finished" is not "CI passed."** Read the parsed conclusions;
  never infer pass/fail from a watch command's exit code.
- **A GitHub 404 means "not authorized", not "not there."** Never report a
  repo, PR or branch as gone on a 404 alone.
- **The fleet spans TWO owners** — `Adam-S-Daniel` and `jodidaniel`. A query
  scoped to one returns a plausible, complete-shaped, wrong answer.
- **Anything you name gets its link** — what you hand over, what you are
  waiting on, and what you cite as already done.
- **Merge with a merge commit** (`gh pr merge --merge`); do not amend
  published commits or force-push shared branches.
- **Keep this file under 32 KiB.** Codex truncates project instructions at
  that byte silently; the sync warns and the drift report flags
  `codex-truncated`.

<!-- END MANAGED SECTION -->
## Repo-specific additions

# adamdaniel.ai — Project Guide

Personal website and blog for Adam Daniel (Freelance AI Engineer). Jekyll static site with Decap CMS, AWS OAuth proxy, and PR preview environments.

## Scope & Boundaries

- **Stay within the requested scope.** Only act on the explicitly requested scope (e.g. user-level vs repo-level placement). When in doubt about scope, confirm before proceeding.

## Test-Driven Design

- **Red-green TDD.** Write a failing test first, then make it pass, then refactor. Always follow this cycle.
- **Never bypass the UI in a UI test.** A spec that exists to validate what an editor's click does — Decap admin, the deploy-status pill, the publish-via-auto-merge shim from the editor's POV — MUST go through the real UI; calling the underlying API instead (`page.evaluate(fetch(...))` against the GitHub API, the shim's `__callMerge`, peeking at workflow runs / PR state rather than waiting for the user-visible signal) defeats the test's purpose and lets a broken UI silently regress. The real-network specs (`cms-publish-loop*`, `cms-delete-published`) cover the Decap-UI-driven chain end-to-end and must keep doing so; route-mocked `publish-via-auto-merge-browser.spec.js` is the one carve-out, because the shim's internal contract is its whole reason for existing.
- **No back doors in the spec body — setup/cleanup MAY use the GitHub API for fixture LIFECYCLE.** The spec's own forward (and, where applicable, backward) leg must drive the real Decap chain — Save → Status:Ready / `cms/ready` → auto-merge → deploy — but seeding or reaping a fixture (`cms-fixture-pr.js`'s `seedFixtureViaPr` / `removeFixtureViaPr`, and the existence-only `afterAll` delete that #1771 step 4 put in place of a content-restore) is harness hygiene, not the behaviour under test. → read `docs/TESTING.md` § "Test-Driven Design and the UI-test boundary" before adding an API call to a spec.

## Architecture

```text
Production:   adamdaniel.ai                     → CloudFront → S3
Preview:      preview-pr${N}.adamdaniel.ai      → CloudFront → S3 (/pr-${N}/)
CMS:          adamdaniel.ai/admin/              → Decap CMS → GitHub OAuth → Lambda
```

Each PR gets its own subdomain under `*.adamdaniel.ai`; a single preview
CloudFront distribution serves the whole preview bucket, and a pair of
CloudFront Functions maps `Host: preview-pr${N}...` to the S3 key prefix
`/pr-${N}/` and back, so preview and prod share one root-relative URL structure
(no `/pr-N/` in any visible URL). → `docs/WORKFLOWS.md` § "Preview host-to-prefix
mapping".

**`admin/` is GEM-DELIVERED (do not re-vendor the machinery).** Since cms-platform v0.1.4 the Decap admin UI and its `config*.base.yml` templates ship inside the `cms-platform-theme` gem (pinned in `Gemfile` / `platform.lock`), whose render hook copies them into `_site/admin/` at build time; this repo tracks only the site-owned seam TEMPLATE `admin/collections.site.yml.example`, and the e2e harness moved to the platform too (`e2e/` is no longer tracked here). Change the admin UI in **cms-platform** and ship a release — the sync path is a gem bump landed by **`platform-bump.yml`**. A re-vendored copy would shadow the gem and silently drift; anything below that references in-repo `admin/config*.yml` or `e2e/cms-*.spec.js` describes the platform-owned source of truth, not files you edit here. → read `docs/CMS-ADMIN.md` § "`admin/` is gem-delivered" first.

## Deeper references

Progressive-disclosure docs — read the relevant one before working in that area; this file stays a map, not the territory.

- [`docs/WORKFLOWS.md`](docs/WORKFLOWS.md) — read when adding/changing a GitHub Actions workflow, debugging a required-status-check, or touching the failure-comment / recursion-gate composite actions.
- [`docs/CMS-ADMIN.md`](docs/CMS-ADMIN.md) — read when changing a Decap collection/field, the live-preview machinery, the posts-list dashboard, mobile admin CSS, or the HTML-embed widget seam.
- [`docs/CI-INVARIANTS.md`](docs/CI-INVARIANTS.md) — read before touching a prod publish loop, a deploy-wait, or any required check that asserts a `main`-state invariant.
- [`docs/TESTING.md`](docs/TESTING.md) — read when adding a test, debugging a flaky e2e run, or deciding which spec/project a new test belongs in.
- [`docs/CONTENT_GUIDE.md`](docs/CONTENT_GUIDE.md) — editor-facing walkthrough of the CMS for someone using it for the first time.
- [`docs/CONTRIBUTOR_CAPABILITIES.md`](docs/CONTRIBUTOR_CAPABILITIES.md) — maps documented contributor capabilities to the e2e spec that proves each one.
- [`docs/SKILLS.md`](docs/SKILLS.md) — read when adding a "see also the **X** skill" pointer, regenerating `skills.lock`, or working out which bundle a skill ships in.
- [`docs/decisions/`](docs/decisions/) — ADRs for non-obvious, load-bearing decisions; read the README there for the format and when to add one.

## Environment / WSL

- **No `sudo` in the non-interactive shell.** Do NOT run `sudo` commands inside the non-interactive bash session — they fail because no password prompt is available. Instead, output the `sudo` commands for the user to run manually in their own terminal.

## Key commands

**Check out the platform e2e harness before running any Playwright command
locally.** This repo vendors no Node toolchain — the root `package.json` was
removed on 2026-09-14 (see "Code quality"). The harness, and the `decap-server` /
`serve` / `@playwright/test` it needs, live in cms-platform: check
`Adam-S-Daniel/cms-platform` out at `platform.lock`'s `platform_ref` into
`.cms-platform/` (as the CI reusables do), `npm ci` in `.cms-platform/e2e`, and
run Playwright FROM there with `SITE_ROOT` pointing at this repo.
`scripts/setup-test-environment.sh` does not do that checkout — it installs apt
packages and the Gemfile gems, plus the harness install + browser download once
`.cms-platform/` exists.

```bash
# Local dev
jekyll serve --livereload          # http://localhost:4000
npx --yes decap-server             # CMS local backend (port 8081) — no root manifest, npx fetches it
                                   # (.cms-platform/e2e/node_modules/.bin/decap-server once the harness is installed)

# AWS infrastructure
bash infrastructure/bootstrap/deploy.sh     # deploy/update bootstrap stack (consumes the PLATFORM template — see note below)
bash oauth-proxy/deploy.sh                  # deploy OAuth proxy (delegates to the platform at platform_ref; needs env vars)

# Tests — from the platform harness checkout, against this site
export SITE_ROOT="$(git rev-parse --show-toplevel)"
cd .cms-platform/e2e
npx playwright test                               # full browser matrix (8 projects)
npx playwright test --project chromium-desktop-1080 # single project (public lane)
npx playwright test glow-banding.spec.js           # single test file
```

**The admin (`@admin-read` / `@admin-write`) lane needs three workarounds in a
sandboxed / Claude-Code-web session**, none of which CI hits: an untrusted egress
CA that stops the Decap bundle loading (a throwaway `ignoreHTTPSErrors` config in
`.cms-platform/e2e`), an unrehashed rbenv `jekyll` shim (build with the full-path
binary, start `serve` + `decap-server` by hand), and WebKit's missing `.so`s
(`npx playwright install-deps webkit`). → `docs/TESTING.md` § "Sandboxed-shell
gotchas for the admin e2e lane" for the exact commands.

## GitHub Actions secrets

| Secret | Source | Used by |
| --- | --- | --- |
| `AWS_ROLE_ARN` | bootstrap stack output | deploy-production.yml, deploy-preview.yml |
| `PRODUCTION_CLOUDFRONT_ID` | bootstrap stack output | deploy-production.yml |
| `PREVIEW_CLOUDFRONT_ID` | bootstrap stack output | deploy-preview.yml |
| `CMS_E2E_PAT` | fine-grained PAT, host repo only | the real-network CMS loop specs (`e2e/cms-publish-loop*.spec.js`, `e2e/cms-delete-published.spec.js`, `e2e/cms-delete-published-preview.spec.js`), which drive the full Decap → cms PR → auto-merge → deploy → public-URL loop. Token permissions and why each one is needed: `docs/WORKFLOWS.md` § "`CMS_E2E_PAT` — scope and why" |
| `MASTODON_ACCESS_TOKEN` | hachyderm.io → Preferences → Development → New application, scope `write:statuses` only | `cross-post.yml`'s `post-mastodon` step. Optional: unset prints a `::warning::` and skips the Mastodon leg (exit 0) rather than failing the run |

## AWS resources (us-east-1)

| Resource | Name / ID |
| --- | --- |
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

**Bootstrap template is PLATFORM-OWNED (do not re-vendor it).** The
CloudFormation template is the single source of truth in **cms-platform**;
`infrastructure/bootstrap/deploy.sh` here is a thin wrapper that reads
`platform_repo` + `platform_ref` from `platform.lock`, checks the platform out
into `.cms-platform/`, exports this site's params and delegates. **The wrapper
exports `CREATE_APEX_DNS_RECORDS=true`** — adamdaniel.ai's apex/www A-records are
STACK-MANAGED but the platform template gates them on `CreateApexDnsRecords`
(default `false`), so without that export a redeploy would DELETE the live apex
DNS and take the site offline; a reviewer caught it in the template-removal PR
(#1922). Do NOT drop it. A bootstrap-infra fix is made **once in cms-platform**
and flows here on the next `platform_ref` bump — never apply it locally. → read
`docs/WORKFLOWS.md` § "Bootstrap infrastructure is platform-owned".

## Content model

Posts, Tags, Projects, Tools, Pages, and the `_e2e/` canary system collection are all Decap folder collections with their own field sets and gotchas (the `test_fixture` flag, the posts-list summary date-format contract, the Tools section's static-asset + iframe embed pattern, vendored-tool sync). → read `docs/CMS-ADMIN.md` before adding a field, changing a collection, or touching the Tools section; see also the **embeddable-tool-pages** skill for adding a new tool.

## Live preview

The `/preview/` WYSIWYG surface, the posts-list dashboard (live-url banner, published/draft links), mobile-responsive admin CSS, and the HTML-embed widget seam are all interlinked, script-load-order-sensitive admin machinery with locked invariants (e.g. the `live-url-derive.js` → `live-url-banner.js` → `native-preview-href.js` → `posts-list-enhance.js` load order). → read `docs/CMS-ADMIN.md` before touching any admin-loaded script or the preview layout; see also the **browser-testing** and **admin-config-render** skills.

## Analytics

Real-user monitoring is via Amazon CloudWatch RUM, deployed as a sibling CloudFormation stack `adamdaniel-ai-rum` (see `infrastructure/rum/`). The Jekyll snippet in `_includes/analytics/cloudwatch-rum.html` is a no-op unless **both** `JEKYLL_ENV=production` AND `site.analytics.cloudwatch_rum.app_monitor_id` are set, so local `jekyll serve` and PR previews stay silent. Identity-pool / app-monitor IDs are non-sensitive (visible in the rendered page source) so they live in `_config.yml`, not GitHub secrets. End-to-end test: `e2e/analytics-cloudwatch-rum.test.js`. Full deploy + tuning notes: [`ANALYTICS_SETUP.md`](ANALYTICS_SETUP.md).

## Code quality

**There is no lint toolchain in this repo, by decision (2026-09-14).** The root `package.json` (eslint, prettier, stylelint, markdownlint-cli2, and a second `@playwright/test` beside the harness's), its lockfile and the matching configs were removed: every reusable's `npm ci` runs in the platform's `.cms-platform/e2e` against *its* lockfile, so nothing in CI ever installed the root one — its Dependabot security jobs could not resolve (the last, `smol-toml` pinned by `markdownlint-cli2`, is run 34793815589) and root `npx playwright` resolved a different `@playwright/test` than the harness config it was handed. Don't re-add one; the platform's **code-quality** skill is the reference if a lint is ever wanted here again.

**Line width — 100 columns, house-wide.** The formatters that reflow code are all platform-side now — Prettier (`printWidth: 100`), Ruff (`line-length = 100`), RuboCop (`Layout/LineLength: Max: 100`) — and `.editorconfig` here carries `max_line_length = 100` as the editor hint. **Markdown and YAML opt out** (prose, long URLs/tables and workflow `${{ }}` expressions run longer by nature). When adding a new code language, set its formatter's width to 100 too.

**Local — pre-commit hook.** `scripts/lint-staged.sh` (platform-delivered by `dev-hooks-sync.yml`, wired into `.githooks/pre-commit` and `.gitconfig-fragment`) lints only the **staged** files of each language and **skips any linter whose tool is absent** — with no root `node_modules` that is every npm-based one here, so the hook is effectively inert on this repo and never blocks a commit. Bypass one commit with `SKIP_LINT_STAGED=1`.

**Parse structured formats with a real parser — never hand-roll.** Anything that reads a workflow, an `action.yml`, or the Decap/Jekyll config YAML goes through a real parser (the [`yaml`](https://www.npmjs.com/package/yaml) library in JS, `YAML.safe_load_file(..., aliases: true)` in Ruby), never a regex or line-scanner. GitHub enabled YAML anchors in workflows on 2025-09-18, so a line-based scanner now silently mis-reads aliased values. Kept inline rather than deferred to a skill because it governs any script written here, not just the lint toolchain.

→ read `docs/TESTING.md` § "Code quality: lint toolchain, line width, pre-commit hook" for the full rationale behind the first three.

## Workflow path-filtering rule

Every workflow that triggers on `pull_request` or `push` must filter on its salient paths, or use the always-run + early-skip pattern if it's a required check — get this wrong and you either burn runner minutes on no-ops or create a missing-check trap that blocks every merge. → read `docs/WORKFLOWS.md` before adding a workflow trigger or changing a `paths:`/`paths-ignore:` list; see also the **workflow-path-audit** skill.

## CI / GitHub Actions

- **Validate workflow / composite-action YAML before committing.** Quote `description` and other string values that contain special characters, and parse the file with the [`yaml`](https://www.npmjs.com/package/yaml) library or `yamllint` before committing — never eyeball it. (Complements the parser rule under Code quality, which governs how tests/scripts *read* these files at runtime.)

## Workflows

Every workflow's trigger, jobs, required-secrets, and the full `main` branch-protection required-status-check topology — deploy-production/preview, the CMS editorial workflow (and the persistent "adding labels" dialog it can trigger), visual-regression, the real-network publish-loop family, sweep-stale-cms-prs, auto-resolve-newline-conflict, dependabot-auto-merge, e2e-tests, secrets-scan, plus branch hygiene and how to read a PR diff after a squash-merge. → read `docs/WORKFLOWS.md` before adding a workflow, changing branch protection, or triaging a stuck/failing CI run; see also the **cms-stuck-pr-triage**, **editorial-label-audit**, **post-failure-comment**, and **platform-release-and-bump** skills.

## E2E testing

The 10-project browser/viewport matrix (public-page lane + admin lane), tag-based project routing (`@admin-write`/`@admin-read`), the custom `e2e/base.js` fixture, and CI harness mechanics (sandboxed-shell gotchas, the Playwright browser-download CDN allowlist, per-project worker counts). → read `docs/TESTING.md` before writing a new e2e test or debugging a matrix/tag-routing failure; see also the **browser-testing** skill.

## Failure-comment composite action

Every Playwright-running workflow forwards its captured log to a shared, gitleaks-scrubbing composite action that posts (and resolves) a marker-tagged PR comment, so CI failures are triage-able without an authenticated `gh` CLI. → read `docs/WORKFLOWS.md` before adding a new Playwright-running workflow or a new failure-comment marker; see also the **post-failure-comment** skill.

## Recursion gate composite action

The three real-prod loop workflows can re-trigger themselves (their own canary-merge push matches their own `paths:` filter); a shared `recursion-gate` composite decides per-event whether the heavy loop job actually runs, replacing a commit-message-prefix guard that was structurally unreliable. → read `docs/WORKFLOWS.md` before touching loop trigger logic or adding a new self-triggering workflow; see also the **ci-watcher-loops** skill.

## Loop-aware required checks and byte-preserving harness baselines

When a real-prod loop spec mutates a persistent fixture in place, a required check and a harness `afterAll` safety net both need to agree on the fixture's canonical state — get the loop-aware exemption or the byte-preserving derivation wrong and you either deadlock the loop or silently corrupt `main`. → read `docs/CI-INVARIANTS.md` before changing a required check that asserts a `main`-state invariant or a harness baseline-restore safety net.

## CI-flakiness invariants (#1723) — read before touching the prod loops / deploy waits

Six root-caused, lint-locked flakiness classes from the 2026-05 CI audit — future-dated fixture builds, test-fixture leakage into public listings/crawls, the queue-aware deploy-lane wait, and more — each with a standing "do NOT undo this" guard. → read `docs/CI-INVARIANTS.md` before touching a prod loop, a deploy wait, or a public-content crawl exclusion; see also the **ci-watcher-loops** skill.

## Preview environment flow

1. PR opened → Jekyll builds at root (no baseurl) → sync to `s3://adamdaniel-ai-previews/pr-{N}/`
2. CloudFront cache invalidated at `/pr-{N}/*` (what the viewer-request Function rewrites requests to)
3. Bot posts `https://preview-pr{N}.adamdaniel.ai/` as PR comment
4. PR closed → S3 files deleted, CloudFront invalidated, existing comment updated to "cleaned up"

## Skills

**This consumer vendors no platform skills — do NOT re-vendor them.** Until
issue #3104 it mirrored 15 of them byte-for-byte under `.claude/skills/`;
cms-platform v0.1.83 deleted that transport and now publishes its `skills/` as
the federated **`cms-platform` bundle** in the `agentskills` marketplace. (The
gem is NOT the skills channel — it ships the `/admin` machinery.) Ephemeral
sessions get skills from the committed **`skills.lock`** via the
`skills-bootstrap` SessionStart hook in `.claude/hooks/` — two registries pinned
at immutable commits with a per-skill sha256, 23 skills; on a durable machine the
hook is a deliberate no-op.

- **`skills.lock` pins commits, not branches, so it does not self-update.**
  Regenerate it with `agentskills`' `scripts/generate_skills_lock.py`
  (`--check-current` reports the gap). Bumping `platform_ref` does NOT move it.
- **That hook's SessionStart entry carries `timeout: 90`, not the `30` its
  sibling uses** — its own fetch budget is 60s, so a 30s harness timeout would
  kill it mid-fetch. JSON has no comments, hence the note here.
- **The one site-owned skill is `.claude/skills/embeddable-tool-pages/`** (adding
  a `/tools/` page — see `docs/CMS-ADMIN.md`, "Tools section"). Nothing syncs it.

→ read `docs/SKILLS.md` before adding a skill pointer or regenerating the lock;
it maps every "see also the **X** skill" pointer here to the bundle that ships it
(including `workflow-path-audit`, which moved to `adam`).

## A green `e2e / e2e` is not proof the real e2e lane ran

- **On a mixed PR — one touching both a code path and an ignored path — treat a
  green `e2e / e2e` as unverified until you have watched the real run finish.**
  Two workflows emit that context: the heavy `e2e-tests.yml` and the
  instant-green `e2e-stub.yml`, whose positive `paths:` byte-mirrors the real
  caller's `paths-ignore:`, so a mixed PR fires **both**. Branch protection keys
  on the context NAME, not on which workflow produced it — PR #1711 (merged
  2026-05-26 20:52, older multi-context topology) merged on stub greens while the
  real e2e was still running and went red three minutes later. Not re-reproduced
  under today's single-context topology; no fix has shipped either.
- **So: when a mixed PR merges, watch the real run to completion**
  (`gh run watch <run-id>`) and fix forward on `main` if it goes red — don't walk
  away on the merge notification. → `docs/CI-INVARIANTS.md` § "A green
  `e2e / e2e` is not proof the real e2e lane ran".
