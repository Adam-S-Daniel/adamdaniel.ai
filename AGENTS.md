<!-- BEGIN MANAGED SECTION — DO NOT EDIT ABOVE "## Repo-specific additions" -->
<!-- Source: _agent-guidance -->
<!-- Sections: none -->

# AGENTS.md

> **Managed by [`_agent-guidance`].**
> Edit only below the `## Repo-specific additions` header.
> Everything above it will be overwritten on the next sync.

This block is deliberately short. It carries the things that are **specific to
this account and learned the hard way** — incidents, fleet policy, machine
layout. It does not restate general engineering practice, and it does not
describe anything you can learn by reading the repo. Depth lives in each repo's
`docs/` and in the skills registry; follow the pointers when the work touches
that area.

## Working in these repos

- Fix what was asked. No speculative features, premature abstractions, or
  unused helpers.
- Prefer editing an existing file over creating a new one.
- Every public interface change updates the corresponding tests.
- Run the existing test suite before calling a task complete, and say plainly
  what you ran. New behaviour gets a test; a bug fix gets a regression test.
- Tests must be deterministic — no sleeps, no network, no reliance on
  wall-clock time.

## Finding your unknowns

Output quality on a non-trivial task is bounded by how well the ambiguities got
resolved — and most of them surface *during* implementation, not before it. So
treat unknown-hunting as part of the work, not a phase that ends at the plan:

- Before building: name what you don't know. Prefer a reference in **code** — an
  existing implementation to mirror, a failing test, a rubric, an HTML mockup —
  over a prose description of the same thing.
- While building: keep a running note of decisions that departed from the plan
  and edge cases you hit. Surface them; don't silently absorb them.
- After building: be able to explain what changed and why it is correct.

The full workflow (blind-spot pass, self-interview, implementation notes,
post-hoc explainer) is the **`finding-unknowns`** skill in the registry. Reach
for it on unfamiliar code, a new domain, or anything with subjective acceptance
criteria.

## Workstation layout

Repo locations are host-specific — match the convention of the machine you're on
(on Windows, check `$env:COMPUTERNAME`).

- **`ZENDA`** (Windows): local clones live under `D:\repos\<github-owner-or-org>\<repo>`
  (for example `D:\repos\adam-s-daniel\wsl-automation`). Clone new repos there, and
  assume existing repos live there rather than under the user profile
  (`C:\Users\<user>\...`).

## Security

Standard practice applies without being restated here. These are the ones with
teeth in this account:

- Validate anything that crosses a trust boundary — user input, API responses,
  file contents.
- Never build SQL, shell commands, or HTML by string-concatenating untrusted
  data. Use parameterized queries, shell arrays, and context-aware escaping.
- Never commit secrets, credentials, or `.env` files.
- Never disable TLS verification, authentication, or CSRF protection.

## Data exposure in CI and public repos

Treat CI run logs, job summaries, artifacts, workflow run pages, and git history
as **public** on a public repo. (Real incident: a workflow printed the owner's
email addresses and their correspondents' into a public Actions log.)

- **Never print personal or sensitive data to a log** — no emails, contacts,
  names, IDs, mailbox sizes/counts, tokens, or anything "useful to an attacker or
  scammer." Deliver sensitive results out-of-band (e.g. email the account itself,
  write to a private store) and log only a non-identifying status line.
- **Don't interpolate `${{ inputs.* }}` / `${{ github.event.* }}` into a `run:`
  block** — the rendered command is echoed to the log. Read inputs from
  `$GITHUB_EVENT_PATH` inside the script and `::add-mask::` sensitive values
  before use. `::add-mask::` only scrubs the log *stream*, not other surfaces.
- **Put sensitive config in secrets, not plaintext inputs or `vars`.** Only
  secret *values* are masked in logs.
- **Sanitize error output** — never dump an API/HTTP response body on failure (it
  can quote personal data); reduce it to a status code + machine error type, and
  keep the data-bearing serialization/call inside the try/catch.
- **Least privilege:** set `permissions:` to the minimum (usually
  `contents: read`) and require approval for outside-collaborator fork PRs.
- **Test fixtures use reserved `example.com` / `example.net` domains only** —
  never a real address; fixtures get committed and logged.

### git history & metadata
- **Sanitize before the first commit.** Fixing the current file does not remove
  data from history. If sensitive data was committed, rewrite history to drop the
  commits, delete every ref that points at them (branches, tags, **PRs**), and
  force-push. GitHub garbage-collects unreachable objects on its own schedule
  (days to weeks) — until then they remain reachable *by SHA* — and you can ask
  GitHub Support to expedite for a public repo. (This is the deliberate exception
  to "don't force-push"; it is a security remediation.)
- **Commit with the GitHub `…@users.noreply.github.com` identity** on public
  repos so a real email is not baked into commit author/committer metadata.

## Automation vs branch protection

Fleet repos enforce PR-only default branches via ruleset, managed as code in
`repo-settings` (see its ADR 0001). Design automation accordingly:

- Never design a bot that pushes to a protected default branch ad hoc — the
  push is rejected (GH013), even from the repo's own workflows.
- Generated data (badges, run summaries, reports, dashboards) belongs on a
  dedicated unprotected results branch (e.g. skills-evals' `eval-results`);
  consumers read from that branch and treat its content as untrusted.
- The rare bot that genuinely must write to a default branch needs a ruleset
  bypass actor declared in repo-settings' `fleet.yml` — never a hand-granted
  UI bypass (the drift report flags those). The AGENTS.md sync App is the
  standing example.
- PR + auto-merge is not a sanctioned bot-write path for fleet repos; the
  cms-platform-managed repos (outside the fleet ruleset) use it by their own
  design.

## Dependency updates

Dependabot runs with a **minimum package age** (`cooldown`) so an unattended
merge still gets a cooling-off period: `default-days: 7`, `semver-major-days: 30`.
Two things about that setting are easy to get wrong:

- It applies to **version** updates only. A security advisory bypasses cooldown
  entirely and opens immediately — the wait never delays a vulnerability fix.
- An unset `cooldown` is **not** "no wait": GitHub applies an implicit 3-day
  minimum age to version updates. Writing 7 is a raise from 3, not from zero.

`semver-minor-days` / `semver-patch-days` are deliberately left undefined —
they fall back to `default-days`, and spelling them out only invites drift.
Pinning and bumping third-party action SHAs is the `pin-actions-to-sha` skill.

## Subagent delegation (model routing)

- Don't write code in the main loop: run the implementation in a subagent on an
  appropriately lower-power model (e.g. the Agent tool's `model` override in
  Claude Code; skip if the harness has no subagent support).
- Route by mechanicalness: smallest model (haiku-class) for exactly-specified
  edits — pin bumps, renames, config/doc tweaks; mid-tier (sonnet-class) for
  normal implementation from a clear spec. Escalate rather than ship a wrong
  diff when the task is genuinely subtle (cross-repo invariants, race
  conditions).
- The main loop keeps root-cause investigation, architectural decisions,
  writing the spec, and review of the subagent's diff before commit.
- Delegated work is done when a **verifier exits 0**, not when the report reads
  as finished. Name the exact command in the spec and require its exit code
  back. A subagent that cannot run it reports BLOCKED; a count that disagrees
  with the spec's stated expectation is a stop-and-report condition, never a
  rounding difference.
- Don't assume the subagent sees this file: general-purpose and custom
  subagents receive the full memory hierarchy (imports included), but
  Explore/Plan-type agents and SDK harnesses with `settingSources: []` skip
  repo guidance entirely. Restate load-bearing constraints (style, test
  command, invariants) in the delegation prompt, and don't hand
  guidance-sensitive work to agents that won't see it.

## Skills ecosystem

- The canonical skills registry is `github.com/Adam-S-Daniel/agentskills`,
  organized as three bundle plugins — `adam` (general-purpose, cloud-safe;
  default-on), `adam-local` (machine-bound), and `fastmail` — each holding
  `skills/<skill>/` directories.
- In Claude Code with the marketplace installed, invoke a skill as
  `/adam:<skill>` (e.g. `/adam:pin-actions-to-sha`).
- Local machines get the marketplace plus per-agent symlinks via that repo's
  `setup.sh`.
- Cloud/ephemeral sessions still get **no** plugins from repo-declared
  settings — that Claude Code limitation (agentskills' `docs/decisions/0001`)
  is unchanged. What changed is that it now has a fix: a repo carrying its own
  `skills.lock` plus the `skills-bootstrap` SessionStart hook installs the
  bundles that lock names directly into those sessions, verified against a
  pinned commit and per-skill digests. Such a session opens with a `skills:`
  verdict naming what loaded, or why nothing did — read it instead of guessing.
- **That adoption is opt-in and per-repo; most repos have not adopted.**
  Delivery is allowlisted in `_agent-guidance`'s `repos.yml` *and* requires the
  repo to have committed a `skills.lock` of its own first — the fleet sync
  never writes one, because the lock is each repo's own declaration of which
  bundles it installs (some federate several registries). So in an unfamiliar
  repo, look for `skills.lock` rather than assuming either way. Bundles cost
  always-on context in every session that carries them, which is why this is a
  deliberate per-repo decision and not a fleet default.
- New reusable skills graduate **into** the registry (sensitive ones into
  `agentskills-private`) rather than living on in a consumer repo. A long skill
  splits across files rather than growing into one wall of text.

## Git practices

- Write concise commit messages that explain *why*, not just *what*.
- One logical change per commit.
- Do not amend published commits or force-push shared branches.

<!-- END MANAGED SECTION -->
## Repo-specific additions

# adamdaniel.ai — Project Guide

Personal website and blog for Adam Daniel (Freelance AI Engineer). Jekyll static site with Decap CMS, AWS OAuth proxy, and PR preview environments.

## Scope & Boundaries

- **Stay within the requested scope.** Only act on the explicitly requested scope (e.g. user-level vs repo-level placement). When in doubt about scope, confirm before proceeding.

## Test-Driven Design

- **Red-green TDD.** Write a failing test first, then make it pass, then refactor. Always follow this cycle.
- **Never bypass the UI in a UI test.** If a spec exists to validate that an editor's click does what we expect — driving Decap admin, the deploy-status pill, the publish-via-auto-merge shim from the editor's POV — the test MUST go through the actual UI. Calling the underlying API programmatically (e.g. `page.evaluate(fetch(...))` against the GitHub API, hitting the shim's `__callMerge` directly, peeking at workflow runs / PR state instead of waiting for the user-visible signal) defeats the test's purpose and lets a broken UI silently regress. If the UI is broken, the test surfacing that breakage IS the point — fix the UI, don't paper over it. The publish-via-auto-merge-browser.spec.js route-mocked unit test exists for the shim's internal contract; the real-network specs (`cms-publish-loop*`, `cms-delete-published`) cover the Decap-UI-driven chain end-to-end and must keep doing so.
- **No back doors in the spec body — with an explicit harness-hygiene carve-out for setup/cleanup.** "Never bypass the UI" governs the *behaviour under test*: the spec's own forward (and, where applicable, backward) leg MUST drive the real Decap UI through Save → Status:Ready / `cms/ready` → auto-merge → deploy, never a programmatic API substitute. **Setup and post-test cleanup, however, MAY use the GitHub API for fixture LIFECYCLE** — reading a fixture's state from `main`, seeding/removing a fixture through a labelled fixture PR (`cms-fixture-pr.js`'s `seedFixtureViaPr`/`removeFixtureViaPr`), or an existence-only delete in `afterAll`. That is *harness hygiene* (resetting/reaping test state between runs), not the behaviour the spec validates, so it does not "skip the chain the test exists to validate" — the chain is still exercised by the spec body's UI-driven legs. The important invariant is that the **primary** leg stays UI-driven; only the safety-net is API. Per #1771 step 4 the prod-loop `afterAll` is now an existence-only **delete** (remove the uniquely-named ephemeral post if it is still on `main`) rather than a content-restore — there is no shared baseline to restore, so there is nothing for an API write to corrupt. (Where a spec *also* drives a backward leg through the UI — e.g. the toggle-only `cms-unpublish-republish` specs — that is still good practice for the extra coverage; it is no longer a hard requirement of this rule.) The route-mocked `publish-via-auto-merge-browser.spec.js` is still allowed to use the shim's programmatic `__callMerge` because that spec's entire reason for existing is the shim's internal contract, not the editor's experience.

## Architecture

```text
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

**`admin/` is GEM-DELIVERED (do not re-vendor the machinery).** As of cms-platform v0.1.4 the Decap admin UI + its `config*.base.yml` templates ship inside the `cms-platform-theme` gem (pinned in `Gemfile` / `platform.lock`); the gem's Decap render hook copies that machinery into `_site/admin/` and renders `_site/admin/config.yml` at build time. This repo therefore tracks **only the site-owned seam TEMPLATE** `admin/collections.site.yml.example` — a contributor copies it to `admin/collections.site.yml` (untracked, not gitignored — the real seam file is local-only / never committed) to supply the per-site collection list the render hook splices into the platform's base collections; the `admin/*.js` / `admin/*.base.yml` / `admin/index*.html` machinery is **no longer vendored here** (the full e2e harness moved to the platform too — `e2e/` is no longer tracked in this repo). To change the admin UI, edit it in **cms-platform** and ship a release; the sync path is a gem bump (`Gemfile` tag + `platform.lock`) landed by **`platform-bump.yml`** — Dependabot's `bundler` ecosystem `ignore`s this gem (cms-platform#242). Do NOT copy admin machinery back into this repo — a re-vendored copy would shadow the gem and silently drift. Anything below that references in-repo `admin/config*.yml` or `e2e/cms-*.spec.js` describes the platform-owned source of truth, not files you edit here.

## Deeper references

Progressive-disclosure docs — read the relevant one before working in that area; this file stays a map, not the territory.

- [`docs/WORKFLOWS.md`](docs/WORKFLOWS.md) — read when adding/changing a GitHub Actions workflow, debugging a required-status-check, or touching the failure-comment / recursion-gate composite actions.
- [`docs/CMS-ADMIN.md`](docs/CMS-ADMIN.md) — read when changing a Decap collection/field, the live-preview machinery, the posts-list dashboard, mobile admin CSS, or the HTML-embed widget seam.
- [`docs/CI-INVARIANTS.md`](docs/CI-INVARIANTS.md) — read before touching a prod publish loop, a deploy-wait, or any required check that asserts a `main`-state invariant.
- [`docs/TESTING.md`](docs/TESTING.md) — read when adding a test, debugging a flaky e2e run, or deciding which spec/project a new test belongs in.
- [`docs/CONTENT_GUIDE.md`](docs/CONTENT_GUIDE.md) — editor-facing walkthrough of the CMS for someone using it for the first time.
- [`docs/CONTRIBUTOR_CAPABILITIES.md`](docs/CONTRIBUTOR_CAPABILITIES.md) — maps documented contributor capabilities to the e2e spec that proves each one.
- [`docs/decisions/`](docs/decisions/) — ADRs for non-obvious, load-bearing decisions; read the README there for the format and when to add one.

## Environment / WSL

- **No `sudo` in the non-interactive shell.** Do NOT run `sudo` commands inside the non-interactive bash session — they fail because no password prompt is available. Instead, output the `sudo` commands for the user to run manually in their own terminal.

## Key commands

**Check out the platform e2e harness before running any Playwright command locally.**
`scripts/setup-test-environment.sh` does NOT check out `.cms-platform/` or the e2e
harness (verified: zero `cms-platform` matches in that script — it only installs apt
packages, Bundler/Gemfile gems, npm deps, and Playwright browser binaries). Before
`npx playwright test`, `e2e/select-specs.js`, or anything that resolves
`.cms-platform/e2e/playwright.config.js` will work, separately check out
`Adam-S-Daniel/cms-platform` at the `platform_ref` pinned in `platform.lock` into
`.cms-platform/` yourself — matching what the CI reusable workflows do.

```bash
# Local dev
jekyll serve --livereload          # http://localhost:4000
npx decap-server                   # CMS local backend (port 8081)

# AWS infrastructure
bash infrastructure/bootstrap/deploy.sh     # deploy/update bootstrap stack (consumes the PLATFORM template — see note below)
bash oauth-proxy/deploy.sh                  # deploy OAuth proxy (delegates to the platform at platform_ref; needs env vars)

# Tests
npx playwright test                               # full browser matrix (8 projects)
npx playwright test --project chromium-desktop-1080 # single project (public lane)
npx playwright test e2e/glow-banding.spec.js       # single test file
```

**Running the admin (`@admin-read` / `@admin-write`) e2e lane in a sandboxed / Claude-Code-web session.** Three gotchas bite in that order; CI hits none of them (it has the egress proxy's CA and a working Jekyll — CI installs browsers per job, not from a prebaked image, which is why the CDN allowlist below matters for CI too):

1. **Decap never mounts — only the static "PENDING" banner, no Login button.** The `/admin` shells load the Decap bundle from `https://unpkg.com/decap-cms@…`; the sandbox's egress TLS proxy presents a CA that Playwright's bundled Chromium/WebKit don't trust, so the `<script src>` dies with `net::ERR_CERT_AUTHORITY_INVALID` (`curl` works — it trusts the system CA bundle; the browser doesn't). **Fix:** run with a throwaway config that sets `use.ignoreHTTPSErrors: true` — `playwright.localcert.config.js` is **gitignored** (CI has no such proxy, and the flag doesn't change the rendered DOM / aria tree):

   ```js
   // playwright.localcert.config.js  (sandbox-only; gitignored)
   // The Playwright harness config is platform-delivered — base off the
   // copy the platform checks out under `.cms-platform/e2e/`.
   const base = require("./.cms-platform/e2e/playwright.config.js");
   module.exports = { ...base, use: { ...base.use, ignoreHTTPSErrors: true } };
   ```

   then `npx playwright test e2e/<spec> --config=playwright.localcert.config.js`.
2. **`bundle exec jekyll` → "command not found: jekyll" (rbenv shim not rehashed).** Don't fight it: build once with the full-path binary (`"$(rbenv which jekyll 2>/dev/null || echo /opt/rbenv/versions/*/bin/jekyll)" build`) and start the two servers **manually** — `npx serve _site -l 4000 --no-clipboard` + `npx decap-server`. Playwright's `webServer.reuseExistingServer` (true off-CI) then sees ports 4000/8081 already up and skips its own failing `bundle exec jekyll build` command.
3. **WebKit launch fails with missing `.so`s** (`libflite…`, `libwebpdemux…`). Once: `npx playwright install-deps webkit` (needs apt/root).

## GitHub Actions secrets

| Secret | Source | Used by |
| --- | --- | --- |
| `AWS_ROLE_ARN` | bootstrap stack output | deploy-production.yml, deploy-preview.yml |
| `PRODUCTION_CLOUDFRONT_ID` | bootstrap stack output | deploy-production.yml |
| `PREVIEW_CLOUDFRONT_ID` | bootstrap stack output | deploy-preview.yml |
| `CMS_E2E_PAT` | fine-grained PAT, host repo only | `e2e/cms-publish-loop*.spec.js`, `e2e/cms-delete-published.spec.js`, `e2e/cms-delete-published-preview.spec.js` (drive the full Decap → cms PR → auto-merge → deploy → public-URL loop). Token permissions: `Contents: r/w`, `Pull requests: r/w`, `Actions: r`, `Metadata: r`. `Actions: r` is needed by the test helpers that poll workflow run state while waiting for auto-merge + deploy-production to finish; no dispatch is needed (the earlier shim → `delete-via-pr.yml` recovery path was removed once we confirmed Decap's delete UI uses the git data API directly, not `DELETE /contents`). |

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

**Bootstrap template is PLATFORM-OWNED (do not re-vendor it).** This repo no longer
ships its own `infrastructure/bootstrap/template.yaml`; the CloudFormation template is
the single source of truth in **cms-platform** (`infrastructure/bootstrap/template.yaml`,
parameterized by `ResourcePrefix` / `ProductionDomainName` / bucket names / `GitHubRepo`).
`infrastructure/bootstrap/deploy.sh` is a thin wrapper that reads `platform_repo` +
`platform_ref` from `platform.lock`, checks the platform out at that ref into `.cms-platform/`
(the same gitignored dot-dir the reusable-workflow callers use — see `deploy-preview.yml`),
exports adamdaniel.ai's site params (`APEX_DOMAIN=adamdaniel.ai`, etc., which derive
`RESOURCE_PREFIX=adamdaniel-ai`, the three bucket names, `STACK_NAME=adamdaniel-ai-bootstrap`,
`PREVIEW_DOMAIN=*.adamdaniel.ai`), and delegates to `.cms-platform/infrastructure/bootstrap/deploy.sh`
(which deploys the platform template with `CAPABILITY_NAMED_IAM`). **The wrapper exports
`CREATE_APEX_DNS_RECORDS=true`** — adamdaniel.ai is LIVE at its apex and the
apex/www A-records are STACK-MANAGED, but the platform template gates them on
`CreateApexDnsRecords` (default `false`, safe for fresh sites). Without that
export a redeploy would DELETE the live apex DNS (site offline) — a
reviewer-caught regression in the template-removal PR (#1922). Do NOT drop it. A bootstrap-infra fix
(e.g. CloudFront `ErrorCachingMinTTL=0`) is now made **once in cms-platform** and flows here on the
next `platform_ref` bump — never apply it locally. This mirrors jodidaniel.com, which has no local
bootstrap template either. (`infrastructure/rum/` is **not** affected — its template is not an exact
vendored copy of the platform's and is out of scope.)

## Content model

Posts, Tags, Projects, Tools, Pages, and the `_e2e/` canary system collection are all Decap folder collections with their own field sets and gotchas (the `test_fixture` flag, the posts-list summary date-format contract, the Tools section's static-asset + iframe embed pattern, vendored-tool sync). → read `docs/CMS-ADMIN.md` before adding a field, changing a collection, or touching the Tools section; see also the **embeddable-tool-pages** skill for adding a new tool.

## Live preview

The `/preview/` WYSIWYG surface, the posts-list dashboard (live-url banner, published/draft links), mobile-responsive admin CSS, and the HTML-embed widget seam are all interlinked, script-load-order-sensitive admin machinery with locked invariants (e.g. the `live-url-derive.js` → `live-url-banner.js` → `native-preview-href.js` → `posts-list-enhance.js` load order). → read `docs/CMS-ADMIN.md` before touching any admin-loaded script or the preview layout; see also the **browser-testing** and **admin-config-render** skills.

## Analytics

Real-user monitoring is via Amazon CloudWatch RUM, deployed as a sibling CloudFormation stack `adamdaniel-ai-rum` (see `infrastructure/rum/`). The Jekyll snippet in `_includes/analytics/cloudwatch-rum.html` is a no-op unless **both** `JEKYLL_ENV=production` AND `site.analytics.cloudwatch_rum.app_monitor_id` are set, so local `jekyll serve` and PR previews stay silent. Identity-pool / app-monitor IDs are non-sensitive (visible in the rendered page source) so they live in `_config.yml`, not GitHub secrets. End-to-end test: `e2e/analytics-cloudwatch-rum.test.js`. Full deploy + tuning notes: [`ANALYTICS_SETUP.md`](ANALYTICS_SETUP.md).

## Code quality

Every language in the repo has a best-in-class linter + static-analyzer + style tool, configured to pass at a strong-but-pragmatic strength. The heavyweight lint toolchain is **platform-internal** — there is no consumer lint CI here. The checks run locally on demand (`npm run lint`, or each tool directly) and as a staged-file pre-commit guard (`scripts/lint-staged.sh`), the consumer's only lint backstop.

**Line width — 100 columns, house-wide.** The formatters that reflow code all target 100: Prettier (`printWidth: 100`, on top of the otherwise-standard config), Ruff (`line-length = 100`), and RuboCop (`Layout/LineLength: Max: 100`). `.editorconfig` carries `max_line_length = 100` as the editor hint. The 80-column default wrapped Playwright method chains onto 3-4 lines each and inflated the JS line count far past what the dedup pass removed; 100 keeps statements on one line without sprawling. **Markdown and YAML opt out** (`max_line_length = off`; yamllint `line-length: disable`; markdownlint `MD013: false`) — prose, long URLs/tables, and workflow `${{ }}` expressions / SHA-pin comments run longer by nature, and rewrapping them is pure churn. CSS has no line-length rule. When adding a new code language, set its formatter's width to 100 too.

**Local — pre-commit hook.** `scripts/lint-staged.sh` (wired into `.githooks/pre-commit` and `.gitconfig-fragment`) lints only the **staged** files of each language, and **skips any linter whose tool is absent**. This hook is the consumer's only lint backstop — the heavyweight toolchain is platform-internal, so a contributor without the full toolchain is never blocked. Bypass one commit with `SKIP_LINT_STAGED=1`. `npm run lint` / `npm run format` cover the npm-based tools.

**Parse structured formats with a real parser — never hand-roll.** Anything that reads a workflow, an `action.yml`, or the Decap/Jekyll config YAML goes through a real parser (the [`yaml`](https://www.npmjs.com/package/yaml) library in JS, `YAML.safe_load_file(..., aliases: true)` in Ruby), never a regex or line-scanner. GitHub enabled YAML anchors in workflows on 2025-09-18, so a line-based scanner now silently mis-reads aliased values. Kept inline rather than deferred to a skill because it governs any script written here, not just the lint toolchain.

Per-language linter tables and the deliberate rule relaxations describe the platform-internal toolchain, most of which has no local target left in this thin consumer — no `e2e/`, `admin/*.css`, `assets/css/`, `*.py`, `*.rb`, `pyproject.toml`, or `tests/` exist here today. Full detail lives in the **code-quality** skill.

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
issue #3104 it mirrored 15 of them byte-for-byte under `.claude/skills/`, kept
in step by a weekly `skills-sync` rsync and a `platform-drift-guard` byte
check. Both are gone: cms-platform v0.1.83 deleted the transport, and its
`skills/` is now published as the federated **`cms-platform` bundle** in the
`agentskills` marketplace. (The gem is NOT the skills channel — it ships the
`/admin` machinery. The two are unrelated deliveries.)

Skills reach an **ephemeral** session (cloud, CI runner, container) through the
`skills-bootstrap` SessionStart hook in `.claude/hooks/`, copied verbatim from
`agentskills` and wired in `.claude/settings.json`. It installs from the
committed **`skills.lock`**, which pins two registries at immutable commits
with a per-skill sha256: `Adam-S-Daniel/agentskills` for the `adam` bundle and
`Adam-S-Daniel/cms-platform` for the `cms-platform` bundle — 23 skills, all
verified before they land in `~/.claude/skills`. On a durable machine the hook
is a deliberate no-op; the marketplace plugin install is authoritative there.

Two things to know when touching this:

- **`skills.lock` pins commits, not branches, so it does not self-update.** A
  skill added or changed upstream reaches no session here until the lock is
  regenerated against the published commit — with `agentskills`'
  `scripts/generate_skills_lock.py` (`--check-current` reports the gap).
  Bumping `platform_ref` does NOT move it; the two pins are independent.
- **That hook’s SessionStart entry carries `timeout: 90`, not the `30` its
  sibling uses.** The hook’s own budget for fetching all sources is 60s, so a
  30s harness timeout would kill it mid-fetch and lose the fail-soft verdict it
  exists to print. JSON has no comments, hence the note here.

**Where the "see also the **X** skill" pointers in this file resolve.** They
still resolve — a skill being delivered rather than vendored does not move it —
but nothing in the repo shows you *which* bundle any given one comes from, so:
the CMS/site-machinery skills (`browser-testing`, `admin-config-render`,
`ci-watcher-loops`, `cms-stuck-pr-triage`, `editorial-label-audit`,
`post-failure-comment`, `platform-release-and-bump`, `code-quality`,
`preview-environments`, `aws-bootstrap`, `cms-platform-secrets`,
`github-actions-sha-pinning`, `sveltia-cms-playwright-demo`, `test-canary`)
are the `cms-platform` bundle; the general-purpose ones (`pin-actions-to-sha`,
`finding-unknowns`, `writing-adrs`, `skills-doctor`, …) are `adam`. The one
that MOVED is **`workflow-path-audit`**, cited under "Workflow path-filtering
rule" and in `docs/WORKFLOWS.md`: v0.1.83 dropped it from cms-platform and it
now ships in `adam`. Same skill, same name, different bundle — which matters
only if you go looking for its source.

The secrets-scan + lint-staged pre-commit guards that used to ride the old
skills `bootstrap.sh` arrive via the platform’s `dev-hooks-sync.yml` (see
`docs/WORKFLOWS.md`, "`secrets-scan.yml`") — unaffected by any of this.

The one **site-owned** skill is `.claude/skills/embeddable-tool-pages/`
(how to add a `/tools/` page or embed a tool in a post — see
`docs/CMS-ADMIN.md`, "Tools section"). It lives in Claude Code’s native
project-skill location, and is site content rather than platform machinery, so
no registry ships it and nothing syncs it. Neither bundle uses that basename,
so the hook’s collision guard never has to arbitrate over it.
