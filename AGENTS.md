<!-- BEGIN MANAGED SECTION — DO NOT EDIT ABOVE "## Repo-specific additions" -->
<!-- Source: _agent-guidance -->
<!-- Sections: none -->

# AGENTS.md

> **Managed by [`_agent-guidance`].**
> Edit only below the `## Repo-specific additions` header.
> Everything above it will be overwritten on the next sync.

## General guidelines

- Read existing code before modifying it. Understand the patterns already in use.
- Keep changes minimal and focused — fix what was asked, nothing more.
- Do not add speculative features, premature abstractions, or unused helpers.
- Prefer editing existing files over creating new ones.
- Never commit secrets, credentials, or .env files.

## Code quality

- Follow the idioms and style already established in this repo.
- Write code that is clear enough to not need comments; add comments only when intent is non-obvious.
- Avoid introducing new dependencies unless strictly necessary.
- Every public interface change should include corresponding test updates.

## Security

- Validate all external input (user input, API responses, file contents).
- Never construct SQL, shell commands, or HTML by string concatenation with untrusted data.
- Use parameterized queries, shell arrays, and context-aware escaping respectively.
- Do not disable TLS verification, authentication, or CSRF protection.

## Testing

- Run the existing test suite before considering a task complete.
- New behavior requires new tests; bug fixes require regression tests.
- Tests should be deterministic — no sleeping, no network calls, no reliance on wall-clock time.

## Subagent delegation (model routing)

- Don't write code in the main loop: run the implementation in a subagent on an
  appropriately lower-power model (e.g. the Agent tool's `model` override in
  Claude Code; skip if the harness has no subagent support).
- Route by mechanicalness: smallest model (haiku-class) for exactly-specified
  edits — pin bumps, renames, config/doc tweaks; mid-tier (sonnet-class) for
  normal implementation from a clear spec.
- The main loop keeps root-cause investigation, architectural decisions,
  writing the spec, and review of the subagent's diff before commit.
- Escalate the model rather than ship a wrong diff when the task is genuinely
  subtle (cross-repo invariants, race conditions).
- Give the subagent a precise spec — files, exact changes, house style, the
  test command to run. Subagent output is gated by the same test/CI proof as
  any other change.

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

**`admin/` is GEM-DELIVERED (do not re-vendor the machinery).** As of cms-platform v0.1.4 the Decap admin UI + its `config*.base.yml` templates ship inside the `cms-platform-theme` gem (pinned in `Gemfile` / `platform.lock`); the gem's Decap render hook copies that machinery into `_site/admin/` and renders `_site/admin/config.yml` at build time. This repo therefore tracks **only the site-owned seam TEMPLATE** `admin/collections.site.yml.example` — a contributor copies it to `admin/collections.site.yml` (untracked, not gitignored — the real seam file is local-only / never committed) to supply the per-site collection list the render hook splices into the platform's base collections; the `admin/*.js` / `admin/*.base.yml` / `admin/index*.html` machinery is **no longer vendored here** (the full e2e harness moved to the platform too — `e2e/` is no longer tracked in this repo). To change the admin UI, edit it in **cms-platform** and ship a release; the sync path is a gem bump (`Gemfile` tag + `platform.lock`, via Dependabot). Do NOT copy admin machinery back into this repo — a re-vendored copy would shadow the gem and silently drift. Anything below that references in-repo `admin/config*.yml` or `e2e/cms-*.spec.js` describes the platform-owned source of truth, not files you edit here.

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

**Running the admin (`@admin-read` / `@admin-write`) e2e lane in a sandboxed / Claude-Code-web session.** Three gotchas bite in that order; CI hits none of them (it has the egress proxy's CA, prebaked browsers, and a working Jekyll):

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

| Collection | Folder | Type | Key fields |
| --- | --- | --- | --- |
| Posts | `_posts/` | folder | title, date, tags, excerpt, featured_image, published, publish_date, test_fixture (hidden) |
| Tags | `_tags/` | folder | name, description. The `_tags/` directory currently exists but is empty (only `.gitkeep` — no curated tag files checked in today); the Decap collection is still configured. |
| Projects | `_projects/` | folder | title, technology, url_link, featured, images (gallery). The `_projects/` directory currently does not exist on disk at all in this repo checkout; the Decap collection still defines `_projects/` as a folder collection, so creating an entry (or the directory) works — only the on-disk directory is currently absent. |
| Tools | `_tools/` | folder | title, slug, description, featured, embed_src, source_url, body — self-contained interactive tools shown at `/tools/` and `/tools/<slug>/`. Site-owned collection (declared in `_config.yml` + `admin/collections.site.yml`, not the platform base). See **Tools section** below. |
| Pages | `pages/` | folder | title, body, permalink, published (was `files:` until PR #33) |
| E2E Canaries | `_e2e/` | folder | system collection used by `e2e/cms-publish-loop*.spec.js` and `e2e/cms-delete-published.spec.js`; URLs at `/e2e/canary-{post,page,project}/`. Excluded from feeds, sitemap, and listings; rendered with `noindex,nofollow`. The publish-loop tests drive admin actions against these stable, unadvertised entries and assert the result on the public site. Between runs the body is reset to a baseline so the URLs always show innocuous content. `create: true, delete: true`: both flags exist so the UI-driven delete spec can drive the full CRUD lifecycle without back doors — `create: true` lets the test seed its throw-away `canary-delete-<runId>.md` fixture via the editor's "+ New E2E Canary" button instead of `seedFixtureViaPr`; `delete: true` is what makes the "Delete published entry" menuitem render. The `[E2E TEST FIXTURES — DO NOT EDIT]` collection label is the convention-only guardrail against accidental editor-driven mutation. |

Every folder collection in `admin/config*.yml` ships with **explicit** `create: true` AND `delete: true`. Decap defaults both to true, but spelling them out keeps editor capabilities visible in the YAML and survives any future major-version default change. The `cms-config.spec.js` invariants enforce this for posts/tags/projects/pages. **Caveat for tests that drive UI delete:** Decap respects `delete: false` and renders the status menu without a delete option — a UI-driven delete spec on a `delete: false` collection cannot work (run #25491225206 hit exactly this on the e2e collection: 30 s click timeout because the "Delete published entry" menuitem never rendered). If you add a UI-delete spec to any collection, audit that collection's `delete:` flag.

The earlier Sveltia CMS bundle silently ignored `publish_mode: editorial_workflow` (the upstream feature is unimplemented as of 0.158), so every Save tried to commit straight to `main` and got rejected by GitHub's branch ruleset with "Repository rule violations found / Changes must be made through a pull request." Switching back to Decap fixed both Save and Delete because Decap implements the editorial workflow: each Save lands on a `cms/...` branch and opens a PR. See PR history for the swap commit.

`reading_time` is computed at build time (word count ÷ 200 + 1) — there is no editor-facing field.

**Automated-test fixtures (`test_fixture`).** The posts collection carries a hidden `test_fixture` boolean (`widget: hidden`, `default: false`) in all three `admin/config*.yml`. The E2E canary `_posts` set `test_fixture: true`; real posts never do. As of #1771 step 4 the only *persistent* such `_posts` fixture is the toggle-only `*-e2e-unpublish-canary.md`; the prod-mutate + media loops now create **ephemeral** per-run posts (`2099-12-31-e2e-prod-mutate-<runId>.md` / `2099-12-31-e2e-media-roundtrip-<runId>.md`) deleted within the run. **Caveat (#1771 follow-up):** the ephemeral posts' canonical `composePost` text *does* set `test_fixture: true` (`e2e/prod-mutate-fixture.js`, locked by `prod-mutate-fixture.test.js`), but that text is only the afterAll fallback — the PRIMARY create leg is genuinely UI-driven, and Decap writes only the posts-collection fields. Since `test_fixture` is a hidden `default: false` widget the editor can't toggle (and the collection has no `sitemap`/`robots` field at all), the post that actually lands on `main` from the "+ New Post" UI carries `test_fixture: false` and no `sitemap`/`robots` keys (verified against the real `Create Post` commits). So consumers that must recognise these UI-created canaries — the Posts-list hide, and the public-content `@parity` crawl exclusion — key on the **structural `e2e-` slug signature** (`/^\d{4}-\d{2}-\d{2}-e2e-/i` in `admin/posts-list-enhance.js`; `e2e/public-content.js`'s `isTestFixturePost`), not solely on the flag. The flag still drives the `Automated tests` `view_filters` entry (Decap "Filter by") for the committed fixtures. Decap 3.12.2 has no declarative default-on/off for `view_filters`, so `admin/posts-list-enhance.js` hides fixture rows from the Posts list **by default** (issue #1042: "default to not checked, pre-existing options checked") and exposes a "Show automated-test posts" toggle. The hide is **non-destructive** — fixture `<li>`s are reordered to the end of the list, not removed — so specs that click `a[href*="…/entries/"]`.first() (`cms-smoke`, `manual-walkthrough-contributor`) still land on a visible real post. Specs that drive a canary navigate to it **by direct URL** (`#/collections/posts/entries/<fileSlug>`), the deterministic pattern `cms-unpublish-republish.spec.js` already documents; `cms-publish-loop-prod-mutate{,-preview}` and `cms-media-roundtrip` were migrated off the list-click for this reason. The field is permissive to `validate-content` (it only greps `^title:`/`^date:`) and inert to Jekyll.

**Posts-list summary / "INVALID DATE".** The posts `summary:` renders the date as `{{year}}-{{month}}-{{day}}` (parsed-date tokens), **not** `{{date | date('MMM D, YYYY')}}`. Decap's `date(...)` summary filter runs bundled dayjs on the raw stored string (`YYYY-MM-DD HH:mm:ss ZZ`); that space+offset form isn't ISO-8601, so dayjs falls back to native `new Date()` — Invalid on WebKit/Safari/iOS, so every post rendered "INVALID DATE" there (issue #1042). The parsed-date tokens use the same machinery as the `slug:` template (proven cross-engine; locked by `cms-permalink-contract.spec.js`). The summary line is byte-identical across all three configs — `cms-post-list-summary.spec.js` asserts it verbatim, so any edit must update `EXPECTED_SUMMARY` there too.

### Atom feeds

Per-tag Atom feeds at `/tags/<slug>/feed.xml` are generated by the gem-delivered `tag_feeds` Jekyll plugin (from cms-platform), mirroring `jekyll-feed`'s shape so the same readers parse both. The plugin is order-independent: it collects tags directly from posts rather than reading `site.config["all_tags"]` left by `auto_tag_pages.rb`, so it works whether `auto_tag_pages` runs before or after it. The feed XML body lives in the gem-delivered `_layouts/atom_feed.xml` (cms-platform theme, not vendored in this repo). The RSS icon is rendered by `_includes/feed-link.html`, mounted on `_layouts/default.html` (site-wide feed) and `_layouts/tag.html` (per-tag feed). The site-wide feed at `/feed.xml` continues to come from `jekyll-feed`.

Editor-facing walkthrough: [`docs/CONTENT_GUIDE.md`](docs/CONTENT_GUIDE.md).

### Tools section

`/tools/` hosts small, self-contained interactive things (explorables,
calculators, diagrams). Each tool is a complete standalone HTML app served as a
**static asset** under `assets/tools/<slug>/` and shown inside the site chrome
via an `<iframe>` — so the app's own `<head>`/scripts/CDN deps never collide
with the site's CSS/JS, and it still gets a real `/tools/<slug>/` page.

Wiring (site-owned, not platform base):

- **Collection** — `_config.yml` `collections.tools` (`output: true`,
  `permalink: /tools/:slug/`) + a `defaults` entry mapping `type: tools` →
  `layout: tool`. Entries live in `_tools/<slug>.md`.
- **Layout** — `_layouts/tool.html` (local; `layout: default`). Renders the
  title/description, the embed `<iframe>` (`page.embed_src`), "Open full
  screen" + "Source" links (`page.source_url`), and the markdown body.
- **Index** — `tools/index.html` (`/tools/`), modeled on `projects/index.html`;
  `featured: true` entries sort first.
- **Nav** — `_includes/header.html` is a **local override** of the gem header
  (Jekyll prefers site `_includes`/`_layouts` over the theme gem's) that adds
  the Tools link. Re-sync it with the gem header on a platform bump.
- **CMS** — `admin/collections.site.yml` adds the **Tools** collection to Decap;
  the gem's `decap_config_hook.rb` splices it into the generated
  `admin/config.yml` at the `# __SITE_COLLECTIONS__` marker at `post_write`.

To add a tool: drop the app at `assets/tools/<slug>/index.html` (verbatim, no
front matter → copied through) and add `_tools/<slug>.md` with `embed_src:
/assets/tools/<slug>/`. The index, nav, and CMS pick it up from the collection.
Embed the same asset in a post via the *Embedding HTML / Widgets* seam below.
First tool: `claude-memory-map` (vendored from
`github.com/Adam-S-Daniel/claude-memory-map`). Full guide: the
**embeddable-tool-pages** skill.

**Vendored-tool sync + previews (claude-memory-map).** The vendored copy at
`assets/tools/claude-memory-map/index.html` is **automation-managed — don't
hand-edit it here**; change the source repo instead. The source repo pushes to
this one (this repo carries no sync machinery; its normal PR pipeline does the
rest):

- **Sync:** a merge to the source repo's `main` force-pushes branch
  `tool-sync/claude-memory-map` (new copy + provenance in
  `_data/tool_sources/claude-memory-map.yml`) and opens/reuses a PR with
  **auto-merge** enabled — it lands when the required checks pass, then
  deploy-production takes it live. Provenance records the exact source commit;
  the workflow reads it back for compare links.
- **Preview:** each source-repo PR touching the built `index.html` mirrors to
  a **draft** PR from branch `tool-preview/claude-memory-map-pr-<n>`, so the
  standard deploy-preview publishes the changed tool at
  `preview-pr<N>.adamdaniel.ai/tools/claude-memory-map/`. **Never merge these
  drafts** — they close automatically when the source PR closes (deploy-preview
  teardown then runs as usual), and a merged source PR arrives via the
  `tool-sync` PR instead.

Both flows authenticate with the `SITE_SYNC_TOKEN` fine-grained PAT stored in
the **source** repo (Contents + Pull requests RW on this repo — a PAT so its
PRs still trigger CI here). The workflows live in the source repo
(`.github/workflows/site-{sync,preview}.yml`); its CI enforces that the
committed `index.html` equals the deterministic build output, which is what
makes "copy the committed file" ship the verified artifact. `tool-sync/*` and
`tool-preview/*` are not `cms/*` branches, so the CMS PR sweeps ignore them.

**Visual-regression gate treatment.** A `tool-sync/*` PR is expected to sail
through `approve-regression` without a human reviewer: `assets/tools/**` +
`_data/tool_sources/**` are a deliberate `NON_SALIENT_OVERRIDES` carve-out in
the platform's `e2e/visual-regression-salient.js` (cms-platform#146), so a
sync-only diff never triggers the regression build. If a tool-sync PR ever
DOES trigger a human regression-review prompt, something outside the tool's
own asset changed — investigate before approving. Full mechanics: the
"Visual-regression gotchas" subsection under the `visual-regression.yml`
workflow docs below.

## Live preview

Editors get a WYSIWYG preview of the page they're editing without publishing. The preview always renders with the real Jekyll layouts (`_layouts/post.html`, `_layouts/page.html`, `_layouts/project.html`), so styling drift is impossible by construction.

**Surfaces:**

- `preview.md` → `/preview/` — a Jekyll page that uses `_layouts/preview.html`. Accepts `?collection=posts|pages|projects` to pick the layout shell.
- The gem-delivered `_layouts/preview.html` (cms-platform theme, not vendored in this repo) — hosts the three layout variants, picks one at runtime, and listens for draft content via `window.postMessage` and a `BroadcastChannel("adamdaniel-cms-preview")`.
- `admin/preview-bridge.js` — loaded after Decap in both `admin/index.html` and `admin/index-local.html`. Registers a `postSave` event listener with Decap's public API (`CMS.registerEventListener`) and broadcasts entry data on every save.

**Flow:** editor opens `/preview/` in a second tab (or snaps it side-by-side with the admin) → edits in the CMS → hits Save → every open preview tab updates within a frame. Same-origin only: `BroadcastChannel` is origin-scoped and the `postMessage` listener rejects foreign origins.

**Markdown:** rendered client-side via [marked](https://marked.js.org/) v13. The preview layout loads marked from unpkg with a synchronous `document.write` fallback to `assets/js/marked.min.js` when the CDN is unreachable — so the markup is identical in dev and prod. Minor fidelity gap vs. kramdown (footnotes, attribute lists); acceptable for an editor preview.

**Per-keystroke updates:** the bridge uses Decap's `postSave` event, which fires on every save (including auto-saves), not on every keystroke. Decap also exposes `CMS.registerPreviewTemplate` for inline previews — we don't use it because the `/preview/` real-layout approach renders with the actual Jekyll layouts, which an inline preview can't match without duplicating the layout HTML.

### Post link + posts-list dashboard

Two admin affordances live alongside the preview, both loaded (deferred) from all three `admin/index*.html` shells in the order **`live-url-derive.js` → `live-url-banner.js` → `native-preview-href.js` → `posts-list-enhance.js`** (`live-url-derive.js` exposes `window.LiveURL.compute()` and MUST precede its consumer; this order is locked by `cms-posts-list-enhance.spec.js` and `cms-permalink-contract.spec.js`):

- **`admin/live-url-banner.js`** — the "View page on site:" banner above the entry form. A past change (#184) deleted it, leaving the editor with no link to the post; issue #1042 restored it. It renders one anchor (`data-testid="cms-live-url-banner-link"`) at the live URL `window.LiveURL.compute()` derives, or a placeholder when unpublished / no slug. **Preview-aware origin:** a post edited through Decap's editorial workflow lives on a `cms/<col>/<file-slug>` PR branch and is NOT on production until that PR merges, so linking the prod URL 404s for the whole draft lifecycle. When the open entry has an open editorial-workflow PR the banner swaps the host to that PR's preview env (`preview-pr<N>.adamdaniel.ai`), exactly the URL `posts-list-enhance.js` surfaces in the list; with no open PR it stays at the current origin. The open-PR map is read from `posts-list-enhance.js`'s shared sessionStorage cache when warm, else one `pulls?state=open` REST call (operator's Decap token, same auth as `deploy-status-pill.js`); no token / API error degrades to the current origin. `cms-live-url-banner-link` is in `native-preview-href.js`'s `EXCLUDE_IDS` so the native-anchor hide can't swallow it (the banner is in the form pane, not the toolbar, so it wouldn't match anyway — the exclusion is the original pre-#184 contract, kept defensively).
- **`admin/posts-list-enhance.js`** — turns Decap's bare Posts list into a dashboard (issue #1042). It **augments in place** — it never replaces Decap's `<a href="#/collections/posts/entries/…">` cards, so every existing e2e selector keeps resolving — adding per-row status / published-link / last-edited columns plus, per state: **"view published changes"** (the merged PR's GitHub `/files` diff — shown only when the post is actually live on `main`), **"preview draft ↗"** (the open editorial-workflow PR's `preview-pr<N>.adamdaniel.ai/blog/<slug>/` env), and **"view draft changes"** (that open PR's `/files` diff). "view published changes" renders before "preview draft" when both are present; an unpublished draft (no merged PR on `main`) shows neither published-changes nor a `published ↗` link. Remote data — last-edited **and the PR that last commit was merged in** (`history` + `associatedPullRequests` in one batched GitHub GraphQL query), the production deployment, and open editorial PRs — is fetched in **three calls total regardless of post count**, cached in sessionStorage, and refreshed both on a ↻ button and whenever the user returns to the list from an entry. Auth reuses the operator's Decap token at `localStorage["decap-cms-user"].token` (same pattern as `deploy-status-pill.js`); with no token / on any API error it degrades to the local-only columns. It also CSS-hides only the "E2E Canary" Quick-add menu item (the `_e2e` collection is `create: true` and test-locked, so it can't be dropped from config; the `#/collections/e2e/new` route is untouched and `canary-content.test.js` stays green). See the **Automated-test fixtures** note under *Content model* for the default-hide behaviour.

### Mobile / responsive admin

Decap 3.12.2 is desktop-first; `admin/admin-mobile.css` is the responsive layer that makes the admin usable on phones (**iPhone 16 — 393×852, WebKit — is the primary target**). It's a single stylesheet `<link>`ed from all three `admin/index*.html` shells (it supersedes the old inline `@media (max-width: 600px)` sidebar rule that used to be duplicated in each shell). At a **768px** breakpoint it: drops the shell's ~800px `min-width` floor; puts the absolutely-positioned, 100vh `EditorContainer` into normal flow (so the page scrolls and the toolbar clears the sticky header); collapses the side-by-side `react-split-pane` to a single column by hiding the live-preview iframe (`.Pane2` / `[class*="PreviewPaneFrame"]` — `/preview/` is already the WYSIWYG); wraps the editor toolbar so **Save / Publish / Delete** and the account avatar stay on-screen and full-label; zeroes `CollectionMain`'s desktop `padding-left: 280px` side-rail gutter so the entries list fills the width; and bumps form inputs to 16px so iOS Safari doesn't zoom on focus. iPhone landscape (852px) and desktop stay on the upstream side-by-side layout, unchanged.

Section 7 of the stylesheet also fixes the **media-library modal**: its header content (`LibraryTop` → title + `ButtonsContainer` with Copy Path / Download / Delete / Upload) had a ~500px non-wrapping min-content width that overflowed the `StyledModal` card and ran the action buttons off the right edge (unreachable on a phone). The fix widens the generic `StyledModal` card to the viewport and wraps `RowContainer` / `ButtonsContainer` so every control stays on-screen. But wrapping alone wasn't enough: `StyledModal` is a CSS **grid** (`grid-template-rows: 120px auto`) with a *fixed-height* header row, so once the buttons wrapped to a second row that row overflowed the header cell and rendered *behind* the asset grid — "Delete selected" became invisible. The fix overrides the header track to `auto` (`grid-template-rows: auto minmax(0, 1fr)`) so the header grows to its content while the body track still sizes the asset grid. **Do NOT drop the modal to `display: block`** — Decap's asset list is a react-window virtual list whose height comes from that grid body track, so block flow collapses it to 0 and the media screen shows **no images** (regressed once, now guarded). The close "X" deliberately straddles the modal corner (upstream affordance) and is excluded from the reachability checks.

**Targeting + fragility:** every selector is an attribute-substring (`[class*="…"]`, matching Emotion class *suffixes* which are stable across pinned versions even though the hashes rotate) or a `react-split-pane` structural class (`.SplitPane`/`.Pane1`/`.Pane2`/`.Resizer`). If Decap renames a component the rule no-ops and the layout falls back to upstream defaults. A few collection selectors are deliberately **two-class** (`[class*="CollectionContainer"] [class*="CardsGrid"]`) to win the specificity tie against Decap's own single-class Emotion rules — Emotion injects its `<style>` at runtime *after* the linked sheet, so an equal-specificity rule would lose on source order. `e2e/cms-mobile-layout.spec.js` (`@admin-read`, runs on `webkit-iphone16` + `chromium-desktop-3k`) locks the mobile-layout invariants: no horizontal overflow, inputs ≥16px, preview pane hidden, Save/Delete on-screen, and a desktop-layout guard so the breakpoint can't creep up and steal the side-by-side preview. The CSS is also linted by `e2e/admin-css-banned-patterns.test.js` for the iOS WebKit compositing footguns (`body::before { position: fixed }`, `@keyframes { transform: scale() }`, `backdrop-filter: blur()`). Why a CSS overlay and not a Decap fork: [ADR-0003](docs/decisions/0003-extend-decap-for-mobile-instead-of-forking.md).

**Reachability / occlusion testing (standing rule).** A passing `toBeVisible()` does NOT prove a control is usable — it can be clipped past the viewport edge or painted behind another element (both shipped as iPhone-only admin bugs: the editor toolbar, then the media-library "Delete selected" hidden behind the asset grid). Admin UI specs must assert key controls are *reachable* with **`expectReachable(page, locator, label)`** from `e2e/ui-visibility.js` (visible + within the viewport horizontally + topmost at its center via `elementFromPoint`, polled so a mid-render transient doesn't flake). These checks must run at **both** admin resolutions — `chromium-desktop-3k` and `webkit-iphone16` — so don't pin a viewport; tag `@admin-read` and let each project use its native size. `e2e/admin-no-occlusion.spec.js` is the worked example (collection list, entry editor, editorial-workflow board, media-library modal); **every new admin screen or control must add its key controls there.** When the occluder is *content* the flaky test-repo backend can't reliably stage (e.g. a populated media grid), assert the layout fact instead — header not clipped (`scrollHeight ≤ clientHeight`), controls within the header's box. The full rationale + patterns live in the **browser-testing** skill.

**Shared Decap editor interactions (standing rule, #1723).** Never hand-roll the Published toggle or the Save → Ready → Publish flow in a CMS spec — import them from **`e2e/cms-editor-ui.js`** (`setPublished` / `expectPublished` / `publishedSwitch`, `saveEntry`, `publishViaUi`). Two non-obvious facts are encoded there so they can't drift: (1) Decap's boolean Published widget is **`role="switch"` (NOT `checkbox`), state via `aria-checked`** — a copy-pasted `getByRole("checkbox", …)` in one spec's cleanup leg burned a prod-loop run (#1723) after the same lesson in PR #407; (2) `publishViaUi` is **state-robust across the two editorial-workflow shapes** — a fresh draft shows a `Status: Draft|In review` chip that must be advanced to *Ready* before Publish, but a re-edited *already-published* entry exposes `Publish ▾` directly with **no `Status: Ready` chip**, so it gates the Ready step on the chip's presence and does **not** hard-assert `Status: Ready` (that assertion timed out in the published-re-edit cleanup). `e2e/cms-editor-ui.test.js` is a pure-fs lint (local lane, sub-second) that **fails CI if any spec hand-rolls the switch/checkbox selector** outside the helper — keeping every caller single-sourced. (Decap's "Publish Now" is a *synchronous* git-data-API squash landing an `Update …` commit — see the recursion-gate note — so the cleanup leg publishes through the real editor UI, not a label back-door.)

**Decap editor ARIA contract (standing rule, #1769).** The `cms-editor-ui.test.js` lint above only reads *our* source — it catches a spec drifting away from the helper, but it's blind to **Decap drifting out from under the helper** (a version bump that re-roles or renames a control). `e2e/cms-editor-aria-contract.spec.js` (`@admin-read`, both admin resolutions) closes that gap: it pins a **committed aria snapshot** (Playwright `toMatchAriaSnapshot`, baselines in `e2e/cms-editor-aria-contract.spec.js-snapshots/`) of the two regions the helper's selectors depend on — the **Published field** (`switch "Published"`, NOT a checkbox) and the **draft-state toolbar strip** (`Save` / `Status: Draft` / `Publish` / `Delete unpublished changes`) — on the read-only canary editor (test-repo backend seeded with an unpublished workflow draft; no mutation / PAT / deploy). A Decap role/name change fails it **immediately and by name** on the cheap admin-read lane instead of latently in a scheduled prod loop. "The lint keeps callers in sync with the helper; the snapshot keeps the helper in sync with reality." Scope is deliberate: only the **draft** toolbar state is pinned (the published-with-pending-changes `Publish ▾` state is hard to stage read-only and stays covered by `publishViaUi` + the loop specs), and the Published hint is matched by role only (`- paragraph`, no text) since its wording lives in `admin/config*.yml` and is already pinned by `cms-config.spec.js`. **On an intentional Decap upgrade, regenerate the baselines with `--update-snapshots` and re-review** — that human acknowledgement that the editor's a11y contract changed is the point.

### Embedding HTML / Widgets

Authors can drop a block of raw HTML / JS / CSS into any markdown body — useful for interactive widgets, demos, or anything that doesn't fit Markdown's grammar. Markdown and HTML coexist in the same body: kramdown passes block-level HTML through verbatim, and the markdown around the embed continues to render normally.

**Toolbar (preferred).** The Decap markdown toolbar exposes an "HTML Embed" button on every body field (registered globally via `admin/editor-component-html-embed.js`, which calls `CMS.registerEditorComponent`). Clicking it opens a code field for HTML; saving stores the block on disk wrapped in sentinel comments:

```text
<!-- html-embed:start -->
<div class="post-embed">
…author HTML / JS / CSS…
</div>
<!-- html-embed:end -->
```

The sentinels let the editor round-trip the block between rich-text and raw modes without re-escaping.

**Raw-mode fallback.** Switching the body to "raw" mode and pasting the same sentinel block by hand works identically. Bare block-level HTML (no sentinels) also renders — kramdown passes it through — but only the sentinel form re-hydrates as a single editable component when you flip back to rich-text mode.

**Reusable widgets — `/assets/widgets/<name>/`.** For widgets used across multiple posts, drop shared assets into a per-widget folder under `assets/widgets/`:

- `assets/widgets/<name>/widget.css`
- `assets/widgets/<name>/widget.js`

Reference them from inside the embed:

```html
<link rel="stylesheet" href="/assets/widgets/<name>/widget.css">
<div id="<name>-root"></div>
<script src="/assets/widgets/<name>/widget.js" defer></script>
```

Files under `assets/` are copied through by Jekyll without any config change.

**Preview caveat.** `/preview/` renders the embed visually (marked.js → innerHTML), but `<script>` tags inserted via `innerHTML` do **not** execute. A banner appears at the top of the preview whenever an embed is detected. For full-fidelity testing of JS-bearing widgets, use the PR preview environment.

**Markdown inside the embed.** kramdown defaults (`parse_block_html: false`) deliberately don't parse markdown inside the wrapper `<div>`. Author the embed as pure HTML; if you need prose around the widget, place it before/after the embed block.

**Security note.** No CSP is enforced today, so inline `<script>` and `<style>` work without ceremony. If a CSP is added later, allowlist either the inline payloads (via hashes/nonces) or migrate widgets into `/assets/widgets/` and allowlist that path. The trust model is "authors are committers" — embeds land via the standard editorial-workflow PR review.

End-to-end coverage lives in `e2e/cms-html-embed.spec.js`.

## Analytics

Real-user monitoring is via Amazon CloudWatch RUM, deployed as a sibling CloudFormation stack `adamdaniel-ai-rum` (see `infrastructure/rum/`). The Jekyll snippet in `_includes/analytics/cloudwatch-rum.html` is a no-op unless **both** `JEKYLL_ENV=production` AND `site.analytics.cloudwatch_rum.app_monitor_id` are set, so local `jekyll serve` and PR previews stay silent. Identity-pool / app-monitor IDs are non-sensitive (visible in the rendered page source) so they live in `_config.yml`, not GitHub secrets. End-to-end test: `e2e/analytics-cloudwatch-rum.test.js`. Full deploy + tuning notes: [`ANALYTICS_SETUP.md`](ANALYTICS_SETUP.md).

## Code quality

Every language in the repo has a best-in-class linter + static-analyzer + style tool, configured to pass at a strong-but-pragmatic strength. The heavyweight lint toolchain is **platform-internal** — there is no consumer lint CI here. The checks run locally on demand (`npm run lint`, or each tool directly) and as a staged-file pre-commit guard (`scripts/lint-staged.sh`), the consumer's only lint backstop.

| Language | Lint / style | Security / types | Config | Command |
| --- | --- | --- | --- | --- |
| JavaScript | ESLint 10 (flat) + Prettier | `eslint-plugin-security`, `eslint-plugin-no-unsanitized` | `eslint.config.js`, `.prettierrc.json` | `eslint "e2e/**/*.js" "admin/**/*.js" "scripts/*.js" "*.config.js"` + `prettier --check` — note `e2e/**` is itself stale as a LOCAL target: `e2e/` is no longer tracked in this repo (the harness moved to cms-platform), so this command currently has nothing to lint under that glob either |
| Python | Ruff (lint + format) | Bandit, mypy | `pyproject.toml` (`[tool.ruff]`/`[tool.bandit]`/`[tool.mypy]`) | `ruff check` · `ruff format --check` · `mypy` · `bandit -r scripts tests -c pyproject.toml` — this describes the PLATFORM-internal toolchain; there is no `pyproject.toml`, no `tests/` dir, and no `.py` files anywhere in this consumer repo today (`scripts/publish_scheduled_posts.py` is not tracked here either — it runs upstream in cms-platform, invoked by the `publish-scheduled-posts.yml` reusable). Nothing local for this toolchain to lint. |
| Ruby | RuboCop (+performance) | — | `.rubocop.yml` | `rubocop` (standalone, Ruby ≥ 3.3 — see below) — mirrors the Python situation: zero `.rb` files exist in this repo (RuboCop's target Ruby surface, the Jekyll plugins/generators, is entirely gem-delivered now), so there is nothing local for it to lint either. |
| Shell | shfmt | ShellCheck | inline directives | `shellcheck $(git ls-files '*.sh') .githooks/pre-commit` · `shfmt -i 2 -ci -bn -d ...` |
| YAML / Actions | yamllint | actionlint (+shellcheck on `run:`) | — | `yamllint .github/` · `actionlint -ignore '...head_ref... is potentially untrusted'` |
| CSS | Stylelint (standard) | — | `.stylelintrc.json` | `stylelint "assets/css/*.css" "admin/*.css"` — both targets are gem-delivered now (theme CSS ships via `cms-platform-theme`); neither `assets/css/` nor any `admin/*.css` exists in this repo, so — like the Python/Ruby rows above — there is currently nothing local for Stylelint to check. |
| Markdown | markdownlint-cli2 | — | `.markdownlint.jsonc` + `.markdownlint-cli2.jsonc` | `markdownlint-cli2` |

**Line width — 100 columns, house-wide.** The formatters that reflow code all target 100: Prettier (`printWidth: 100`, on top of the otherwise-standard config), Ruff (`line-length = 100`), and RuboCop (`Layout/LineLength: Max: 100`). `.editorconfig` carries `max_line_length = 100` as the editor hint. The 80-column default wrapped Playwright method chains onto 3-4 lines each and inflated the JS line count far past what the dedup pass removed; 100 keeps statements on one line without sprawling. **Markdown and YAML opt out** (`max_line_length = off`; yamllint `line-length: disable`; markdownlint `MD013: false`) — prose, long URLs/tables, and workflow `${{ }}` expressions / SHA-pin comments run longer by nature, and rewrapping them is pure churn. CSS has no line-length rule. When adding a new code language, set its formatter's width to 100 too.

**RuboCop runs standalone, NOT via the site `Gemfile`.** RuboCop's transitive dep `parallel` resolves to a release that requires Ruby ≥ 3.3, but every Jekyll-building CI job (`validate-content`, `unit`, `generate`, `deploy-preview`, the e2e web-server) installs the site `Gemfile` via `ruby/setup-ruby` on **Ruby 3.2** — so putting RuboCop in a `Gemfile` group made `bundle install` fail on 3.2 before any step ran. The lint workflow installs it with `gem install rubocop:<v> rubocop-performance:<v>` on Ruby 3.3. Keep dev-only linters out of the runtime `Gemfile`.

**Deliberate rule relaxations** (each is documented in its config; never relax to hide a real bug):

- **ESLint** — `security/detect-object-injection` and `security/detect-non-literal-fs-filename` are off (heuristic noise in static-site build/test/admin glue with no untrusted-request surface). The remaining `detect-*-regexp` findings are **warnings**, not errors (the current hits are linear regexes over trusted/bounded input). `no-unsanitized/property` is disabled inline at 6 admin `innerHTML` sinks that already escape via `esc()` or use constant strings.
- **Python** — Ruff `select = E,W,F,I,B,UP,C4,SIM,S`; test trees ignore `S101/S603/S607/S105/S106/S107` (idiomatic `assert`, controlled-argv subprocess, fixture tokens). mypy is pragmatic (`ignore_missing_imports`). Bandit `# nosec` (with reason) on the OAuth proxy's hardcoded GitHub https URLs / fixture tokens.
- **Ruby** — `Style/Documentation` off (file headers suffice); `Lint/MissingSuper` excluded for the synthetic `Jekyll::Page` subclasses; metrics tuned for generator code.
- **YAML/Actions** — when run locally, yamllint is invoked with `line-length`/`document-start` off and `truthy: check-keys:false` (so `on:` stays unquoted), and the test-locked configs (`admin/config*.yml`, `_config.yml`, `.github/rulesets/`) are skipped. actionlint's two `head_ref … potentially untrusted` advisories on same-repo Decap PRs are suppressed via a precise `-ignore` regex (every other input is still flagged); intentional `run:`-block shellcheck findings carry inline `# shellcheck disable=` comments.
- **CSS** — Stylelint relaxes `selector-class-pattern`, `no-descending-specificity`, `selector-max-specificity` for `admin/admin-mobile.css`'s intentional two-class Emotion-tie selectors (see *Mobile / responsive admin*); that file is otherwise byte-stable.
- **Markdown** — `MD013` (line-length), `MD033` (inline HTML), `MD041`, `MD038` off for GFM docs.

**Local — pre-commit hook.** `scripts/lint-staged.sh` (wired into `.githooks/pre-commit` and `.gitconfig-fragment`) lints only the **staged** files of each language, and **skips any linter whose tool is absent**. This hook is the consumer's only lint backstop — the heavyweight toolchain is platform-internal, so a contributor without the full toolchain is never blocked. Bypass one commit with `SKIP_LINT_STAGED=1`. `npm run lint` / `npm run format` cover the npm-based tools.

**Repetition, dead code, constants.** The standardisation pass also de-duplicated within each language (e.g. e2e specs reuse `prodTarget()`/`previewTarget()` from `e2e/cms-host.js` rather than hardcoding hosts; the OAuth proxy's GitHub URLs/timeout are module constants), removed unused symbols (every linter's unused-import/var rule is on), and confirmed there are no orphan code files (all `_layouts`/`_includes` are referenced via `layout:`/`include`, all `scripts/` by a workflow or `package.json`). When adding code, prefer extending an existing shared helper/constant over copying.

**Parse structured formats with a real parser — never hand-roll.** Tests and scripts that read GitHub Actions workflows, `action.yml`, or the Decap/Jekyll config YAML go through the [`yaml`](https://www.npmjs.com/package/yaml) library (JS) or `YAML.safe_load_file(..., aliases: true)` (Ruby), never a regex/line-scanner. The shared `e2e/workflow-yaml-utils.js` helpers (`parseYaml`, `jobs`, `runScripts`, `jobSubBlock`, `allStrings`, `events`) wrap the parser for the workflow-lint suite; structural assertions read the parsed object, and shell/JS/expression checks run against parser-extracted string values rather than grepping raw file text. GitHub enabled YAML anchors in workflows on 2025-09-18, so a line-based scanner now silently mis-reads aliased values — the parser resolves them. (The two exceptions that intentionally stay text-based: `scripts/sync-action-pin-comments.sh`, a comment-*preserving* `uses:` SHA-pin rewriter a structural parser would strip, and `e2e/cms-config-preview-delta.spec.js`, which locks the line-level diff a `sed` patch script produces. `scripts/secrets-scan.sh`'s single `GITLEAKS_VERSION:` grep and the front-matter field reads in a few e2e specs also stay as targeted reads — surgical or zero anchor exposure. (`publish_scheduled_posts.py` is not a file in this repo at all anymore — it's platform-owned, invoked via the `publish-scheduled-posts.yml` reusable.))

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

This table is **Layer 1** (workflow-level firing) only. Which *specs*
actually run inside `e2e-tests.yml` (the diff-aware selector) and which
selected specs still self-skip at runtime (the heavy `@lane:real` CMS
specs) is documented in [`docs/TESTING.md` §2 "Trigger map: what runs
when"](docs/TESTING.md#2-trigger-map-what-runs-when) — including the
missing-check trap, the stub mirror, the `cms/*` head-ref directive, and
the verified footguns. Keep both in sync when you change path filters.

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
| `e2e-tests.yml` | `pull_request` targeting `main` | `paths-ignore` | `README.md`, `AGENTS.md`, `CLAUDE.md`, `docs/**`, `infrastructure/**`, `oauth-proxy/**`, `LICENSE`, `.gitignore` — the diff-aware spec selection, sharding, and per-spec rules described in `docs/TESTING.md` §2 now run INSIDE the platform's single reusable `e2e` job, not as this repo's own workflow-level filters |
| `editorial-label-audit.yml` | `schedule` (13:00 UTC daily), `workflow_dispatch` | n/a (cron-only; scans + self-heals `decap-cms/*` labels via the API) | n/a |
| `label-non-decap-prs.yml` | `pull_request` (opened, reopened), `push` (main), `workflow_dispatch` | `pull_request`: **none, intentionally** — the tag decision keys off the PR's head ref, not its diff. `push` (main): `paths` positive, the workflow file itself only | Tags any PR NOT created by Decap with `not-decap-created` |
| `parity-preview.yml` | `pull_request` targeting `main` | **none, intentionally** — required check on the always-run + early-skip pattern; the reusable's selector reports success immediately when no `@parity-preview` spec applies | n/a — runs the `@parity-preview` spec subset (sitemap, console-clean, draft-isolation, image-alt-text, admin-bundle-parity) against the PR's own `preview-pr<N>.adamdaniel.ai` surface |
| `platform-bump.yml` | `schedule` (Mondays 07:00 UTC), `workflow_dispatch` | n/a (cron-only; opens the platform version-bump PR) | n/a |
| `platform-drift-guard.yml` | `pull_request` | `paths` (positive) | `.claude/skills/**` only — `admin/` dropped from this guard's scope since cms-platform v0.1.4 (ships via the theme gem, no longer byte-guarded here) |
| `platform-pin-consistency.yml` | `pull_request` targeting `main` | **none, intentionally** — a version skew can be introduced by editing ANY pin-bearing file (every workflow `uses:@`, `Gemfile`, `Gemfile.lock`, `platform.lock`), so the gate runs on every PR as a fast pure-fs check | n/a |
| `preview-media.yml` | `pull_request` | **none, intentionally** — required check on the always-run + early-skip pattern; an early step detects media-salient changes and the job reports success immediately when none changed | `assets/images/uploads/**`, `admin/config{,-local}.yml`, `_config.yml`, `_layouts/{post,canary}.html`, `scripts/patch-preview-config.sh`, `e2e/cms-host.js`, `e2e/preview-media-resolves.spec.js`, the workflow itself (detected in-step, not via `paths:`) |
| `publish-scheduled-posts.yml` | `schedule` (14:00 UTC daily), `workflow_dispatch` | n/a (cron-only) | n/a |
| `regression-review-reaper.yml` | `pull_request` types `[synchronize, closed]` | n/a (event-driven; rejects orphaned `regression-review` pending deployments via the API) | n/a |
| `secrets-scan.yml` | `pull_request`, `push` to `main`, weekly `schedule` (Sundays 07:00 UTC), `workflow_dispatch` | **none, intentionally** — gitleaks must scan the entire diff / history regardless of file type | n/a |
| `skills-sync.yml` | `schedule` (Mondays 06:00 UTC), `workflow_dispatch` | n/a (cron-only; no-op here — no local skills mirror) | n/a |
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

## CI / GitHub Actions

- **Validate workflow / composite-action YAML before committing.** Quote `description` and other string values that contain special characters, and parse the file with the [`yaml`](https://www.npmjs.com/package/yaml) library or `yamllint` before committing — never eyeball it. (Complements the parser rule under Code quality, which governs how tests/scripts *read* these files at runtime.)

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
- **Tool-sync PRs auto-pass the gate by design.** `assets/tools/**` and `_data/tool_sources/**` are `NON_SALIENT_OVERRIDES` in the platform's `e2e/visual-regression-salient.js`: a sync-only diff never triggers the regression build — the substantive review happened in the tool's source repo (its PR + preview mirror). A mixed PR that also touches a template/layout stays salient and then also surfaces the tool page's own delta. (Pre-#146 the same PRs auto-passed *incidentally* — the build ran via the broad `_data/` salience but compared a page set that didn't include the tool.) See "Vendored-tool sync + previews" under the Tools section above.
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

A **thin caller** that delegates to the platform's reusable `auto-resolve-newline-conflict.yml` (pinned per `platform.lock` / the workflow's own `uses:@` line — the authoritative, Dependabot-bumped pin); the resolver script + its tests are **platform-delivered** (run from the platform's `.cms-platform/scripts/` copy, no longer vendored here). The behaviour below describes the platform-owned logic the caller invokes — the triggers/run-name are owned by this site-side caller file.

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
| `e2e / e2e` | `e2e-tests.yml` (or `e2e-stub.yml` on doc/infra-only PRs) → cms-platform reusable | The reusable runs the ENTIRE Playwright suite (selection, dynamic sharding, and finalize) inside one `workflow_call` job — this collapses the old per-repo `select` / `unit` / `e2e (1)` / `e2e-admin` / `finalize` contexts into the single `e2e` check. `e2e-tests.yml` carries `paths-ignore` (README/AGENTS/CLAUDE/docs/infrastructure/oauth-proxy/LICENSE/.gitignore); `e2e-stub.yml` mirrors that list byte-for-byte and emits a trivial green `e2e` job so the required context is never MISSING on a doc/infra-only PR |
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

**Pairs with:** `.github/dependabot.yml` — defines the npm / bundler / github-actions ecosystems, a 7-day `cooldown.default-days` on every non-security update, and `update-types: [minor, patch]` grouping per ecosystem so the auto-merge pipeline isn't drowning in N PRs/week. The `docker` ecosystem is registered but **fully ignored** (`ignore: dependency-name: "*"`): the only image is the CI-runner's Playwright base (`.github/ci-runner/Dockerfile`), whose tag is hard-coupled to the npm `@playwright/test` version (enforced by `e2e-tests.yml`'s "Verify Playwright image version matches lockfile" drift guard). Dependabot can't bump a docker dep and an npm dep in one PR, so a docker-only base-image bump would desync the image from `package-lock.json` and fail the e2e matrix — the base image is bumped manually alongside the npm Playwright update instead.

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
platform's reusable `e2e-tests.yml` (pinned via the `uses:@` line, in lockstep with `platform.lock`) via `workflow_call`. The reusable checks
out the harness (`e2e/`, `playwright*.config.js`) from cms-platform, builds this site
(`target: local` — a real `jekyll build` + `decap-server`), and runs the full
matrix — the diff-aware selection, dynamic sharding, `SPEC_RULES`, and finalize
roll-up described below all happen INSIDE that one reusable job, so this repo
surfaces exactly one context: `e2e / e2e`. There is no longer a separate
`select` / `unit` / sharded-`e2e` / `parity` / `finalize` set of jobs in THIS repo's
own workflow file — `parity` is also its own caller now (`parity-preview.yml`,
covered under "Required status checks" above), not a job inside `e2e-tests.yml`.

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

The subsections below (dynamic shard count, the spec-header skip directive, the
always-run baseline, and the per-test screenshot videos) describe behavior that now
runs INSIDE that single platform-delegated `e2e` job — they are platform-owned
implementation detail, kept here because they still shape what a contributor needs
to know when adding a spec, not because this repo's own workflow file implements
them directly.

**Dynamic shard count.** `e2e/select-specs.js` returns a `shard_count` field in its envelope (1, 2, 3, or 4). Small subsets — `≤2` light browser specs — collapse to a single shard; mid-sized subsets to 2; the rest fan out to 4. Sharding happens inside the reusable's single `e2e` job (the required check is `e2e / e2e`, not a per-shard context).

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

## E2E testing

Every e2e test runs across a matrix of browsers, viewports, text sizes, and color settings. The matrix is defined as Playwright projects in the platform-delivered harness config (`.cms-platform/e2e/playwright.config.js`); the e2e harness is no longer vendored in this repo.

### Browser matrix (10 projects, two lanes)

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

### Tag-based filtering

Specs that drive the admin UI are tagged via Playwright's `{ tag: [...] }` option on `test.describe(...)` or `test(...)`. The tag controls which projects the spec runs on:

| Tag | Meaning | Runs on |
| --- | --- | --- |
| `@admin-write` | Drives `/admin/*` AND mutates state (Decap Save → `cms/*` PR, decap-server FS write, etc.) | `chromium-desktop-3k` only — single browser is sufficient and writes are heavy/serial |
| `@admin-read` | Drives `/admin/*` but is read-only (DOM contract, HTTP byte parity, mocked APIs) | `chromium-desktop-3k` + `webkit-iphone16` — engine-dependent admin UI assertions need both |
| *(untagged)* | Public-page specs (`tags.spec.js`, `feeds-and-share.spec.js`, `visual-regression.spec.js`, etc.) | All 8 public-lane projects |

**Why word-bounded regexes** (`/@admin-read\b/`): Playwright's `grep` is substring-matching by default. Without the `\b`, `/@admin-read/` would match a hypothetical future tag like `@admin-readonly`, silently routing it to the wrong project. The `\b` anchors at the tag's end so `@admin-read` matches only itself.

**Tag the test.describe, not the test title.** The tag-in-title pattern (`test("foo @admin-read", ...)`) works but pollutes the test name in reports. The `{ tag: [...] }` option keeps titles clean and is the modern Playwright API.

#### iOS-anything is WebKit

iOS Chrome, iOS Firefox, iOS Edge, and iOS Safari all share the same browser engine — Apple bans third-party rendering engines on iOS. Playwright's `webkit` project covers all of them. So "iOS Chrome === iOS Safari === WebKit" — they're a single data point, not three. When triaging an iOS-only render bug, reproduce it under `webkit-tablet` (or any local WebKit) and you've covered every iOS browser.

#### `?notheme` kill-switch (admin) — HISTORICAL

The cobalt-thermal admin theme (`custom.css` + the inline `<style id="cobalt-inline-theme">`) and its `?notheme` kill-switch were retired in cms-platform PR #81 — this repo's `admin/` directory now tracks only `collections.site.yml.example`; there is no `custom.css` or `index.html` here, and the admin UI is gem-delivered. This is no longer a live, testable-today mechanism in this repo. `e2e/admin-notheme.spec.js` (also platform-owned now) asserts the theme markers are ABSENT on `/admin/`, so a future re-introduction of a theme must ship the kill-switch alongside it.

#### Sandbox allowlist (Playwright browser downloads)

Playwright fetches its browser binaries from a small set of CDNs the first time `npx playwright install` runs. Sandboxed shells (and any local environment running `npx playwright install`) need outbound network access to:

- `cdn.playwright.dev`
- `playwright.download.prss.microsoft.com`
- `playwright.azureedge.net`

If these are blocked, `npx playwright install` hangs or fails with a 403 / DNS-resolution error.

CI does NOT hit these CDNs — the e2e matrix, parity, finalize, canary-prod, and cms-publish-loop-{host,prod} jobs all run inside `mcr.microsoft.com/playwright:v<version>-noble`, which ships the browsers + apt deps prebaked. The image tag is enforced to match `package-lock.json`'s `@playwright/test` version by the `select` job's drift-guard step. The CDNs only matter for fresh local clones and the rare reusable workflow that still calls `playwright install` — this repo's `visual-regression.yml` caller is a thin `uses:` delegation with no such step itself; if it happens, it's inside the platform's reusable workflow, not this repo's caller.

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

For MULTI-job workflows (e.g. `e2e-tests.yml`'s `finalize` job posting on behalf of the upstream `e2e` matrix), `failure()` / `success()` reflect only the FINALIZE job's state, not the matrix's. Gate on `needs.<job>.result` instead:

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
| `e2e-failure-summary` | `e2e-tests.yml` → the single `e2e` job (replaces the old separate `unit-failure-summary` / `e2e-real-failure-summary` / `select-failure-summary` markers — those jobs no longer exist as separate contexts) |
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

1. **Action dependency policy.** Prefer trusted built-ins (`git`, `node`) over a bundled marketplace action when they do the job. `tj-actions/changed-files` was rejected here on supply-chain grounds (CVE-2025-30066, Mar 2025: a stolen `@tj-actions-bot` PAT retroactively repointed *every* version tag; ~9k lines of unverifiable bundled JS into a workflow that holds `CMS_E2E_PAT`). The composite is bash + `node` only, **no transitive `uses:`** — same shape as `await-prod-deploy` / `post-failure-comment`, and clean for the SHA-pin convention. If a marketplace action is genuinely warranted, it MUST be SHA-pinned with a dated version comment after the 7-day cooling-off — see the `github-actions-sha-pinning` / `pin-actions-to-sha` skills.
2. **Single source over byte-identical duplication.** When N workflows need the same logic, factor it into one composite + one data module and lint the *structural wiring*, rather than duplicating the logic into each workflow and lint-asserting byte-identical text. (The `#1101`/#1178 byte-identical `concurrency:` block — now declared on each loop's heavy job rather than the workflow — predates this and is kept as byte-identical duplication; the recursion gate is the pattern to follow for new shared logic.)

## Loop-aware required checks and byte-preserving harness baselines

When a real-prod loop spec mutates a *persistent* `_posts/` fixture in place — today only the toggle-only `cms-unpublish-republish.spec.js` against `_posts/2024-01-02-e2e-unpublish-canary.md` — two pieces of CI machinery must agree on the canonical state of that fixture: (a) a **required check** protecting `main` (asserting `published: false`), and (b) the spec's **`afterAll` safety net** that writes the baseline back if the UI cleanup leg left a mutation. If either treats the canonical state as a hard-coded literal — or fires on the loop's *own transient* publish PR with the same strictness as on a feature PR — the loop deadlocks (a) or silently corrupts `main` (b). (The prod-mutate + media loops no longer have a persistent fixture to keep in sync at all: #1771 step 4 made them ephemeral per-run posts whose resting state is absence/404 — see "CI-flakiness invariants" below — so only the surviving toggle-only spec exercises this pattern.)

**Two instances, same root pattern (3dbade7 / #1053 follow-ons):**

1. **(Required-check own-branch exemption retired by #1771 step 4; #1188, run 26114167560.)** Originally `fixture-baseline.test.js`'s `"checked-in prod-loop fixtures are at baseline"` assertion ran on the heavy prod loops' own `cms/posts/2099-01-0X-*` publish PRs, where a transient `published: true` is the in-flight state the round trip *requires* to merge+deploy. The required check failed → PR `BLOCKED` → auto-merge never fired → spec timed out at `waitForChangeReflected`. The fix was a `baselineAssertionApplies(rel, headRef)` gate in `e2e/fixture-baseline.js`, relaxed *only* on that fixture's own Decap branch. **That whole assertion (and `baselineAssertionApplies` with it) is gone now**: with the two persistent prod canaries replaced by ephemeral per-run posts there is no committed `published: false` baseline to assert on `main`, so nothing gates the prod loops' own PRs. The general lesson survives in the convention below (it still governs the toggle-only unpublish canary, whose runtime self-skip on `cms/*` head refs plays the same own-branch-relaxation role).

2. **Harness byte-preserving baseline (#1189, run 26114231574).** `cms-unpublish-republish.spec.js`'s `afterAll` hard-coded its baseline as a literal array of front-matter + body. When PR #1043 added `test_fixture: true` to the canary, that literal was never updated, so the next harness firing (5fcd9be) committed a "baseline" to `main` that **silently dropped the flag** — red-failing the required `cms-posts-list-enhance.spec.js:162` check on every subsequent PR (and that, together with the #1188 deadlock, caused the 82-minute 16:42→18:04 UTC main-merge freeze on 2026-05-19). Fix: derive the baseline from the on-disk file via `forcePublishedFalse(fs.readFileSync(...), FIXTURE_PATH)` — the shared helper in `e2e/fixture-baseline.js` (#1053 DRY'd the per-spec copies into it; the prod-mutate / media loops that used to share this pattern dropped it when #1771 step 4 made them ephemeral, so `cms-unpublish-republish.spec.js` is the lone remaining caller of this on-disk-derive path).

**The convention (apply beyond these features):**

- **Loop-aware guards.** Any required check asserting a `main`-state invariant must distinguish the loop's *own transient PR* (`cms/posts/<that-slug>`) from every other context, and relax there — mirroring the spec's existing `@select-skip-when-head-ref-prefix: cms/` + `RUN_*` runtime skip contract. Keep the weakest defensible check (file present, value parseable) on the relaxed branch so genuine corruption still fires.

- **Byte-preserving baselines.** Any safety net that writes a "baseline" back to `main` MUST derive it from the canonical source file with byte-preserving normalization (force only the dangerous field; leave every other byte alone). Hard-coded literals duplicate canonical state and silently drift; the single-source approach (same as the recursion gate above) makes added fixture fields flow through automatically.

The unifying principle: **canonical state lives in exactly one place; everything else derives** — required checks read it, harness writes go through a byte-preserving transform of it.

## CI-flakiness invariants (#1723) — read before touching the prod loops / deploy waits

The 2026-05 flakiness audit (#1723) traced the recurring CI reds to six classes. Each fix ships with a **lint-lock** that fails loud at CI time if reintroduced (the repo's standing pattern — don't sidestep them). Do NOT undo these:

- **Never future-date a `_posts/` fixture you publish to verify its URL.** Jekyll *skips* future-dated posts unless `_config.yml` sets `future: true`. The prod-mutate / media loops now create **ephemeral** future-dated posts (`_posts/2099-12-31-e2e-*-<runId>.md`, born `published: true`); `future: true` is set **deliberately** so they build at all (without it a born-published future-dated post still 404s). This was THE dominant "Cat 1" root cause — the build log said `Skipping: …-canary.md has a future date`, `/blog/<slug>/` 404'd, and the in-spec reflect-wait timed out *every* run (misread as a deploy backlog). Real scheduling is `published: false` + `publish_date` (implemented by the platform-owned `publish_scheduled_posts.py`, invoked via the `publish-scheduled-posts.yml` reusable — not a local file in this repo), NOT future-dates — so `future: true` exposes nothing else. **Lock:** `e2e/prod-mutate-fixture.test.js` → "ephemeral posts are BUILDABLE when published" (replaced the retired `fixture-baseline.test.js` PROD_FIXTURES guard, #1771 step 4).

- **`test_fixture: true` posts are excluded from the homepage + blog index** (`index.html`, `blog/index.html`) via a `where_exp: "post.test_fixture != true"` filter, so a briefly-published *committed* canary serves only at its own `/blog/<slug>/` URL (what the spec verifies), never in human-facing listings. Keep that filter on any new post listing. **Caveat (#1771 follow-up):** the *ephemeral* prod-loop posts are UI-created and land with `test_fixture: false` (the hidden widget the editor can't toggle), so this filter does NOT catch them — while one is briefly live (or orphaned on `main`) it can appear in the blog-index/homepage listing. That's a cosmetic, sub-run-duration leak, not a check-poisoner; the load-bearing protection for the *required-check* surface is the public-content **crawl** exclusion (next bullet), not this listing filter.

- **The public-content `@parity` crawls exclude E2E test-fixture canaries (#1771 Cat-2 fix — DO NOT regress).** `sitemap.spec.js`, `console-clean.spec.js`, and `image-alt-text.spec.js` enumerate `/blog/` posts and assert public-quality invariants (in the sitemap, no `console.error`, every `<img>` has alt). Those invariants are for **real public content**, not the ephemeral prod-loop canaries. The ephemeral posts are born `published: true` through the Decap UI and briefly serve mid-run; worse, a crashed run can leave an orphan on `main` whose featured image was already deleted, so `/blog/<slug>/` 404s a resource. Before this fix the crawls enumerated those URLs and red-failed — and since they run inside the **required** `e2e-admin` (`@admin-read`) and `parity` checks, a single transient orphan `BLOCKED` *every* cms PR's merge gate, **including the loop's own create PR** (verified: create PR #1808 BLOCKED on `e2e-admin`/`parity`/`finalize` failing on `/blog/e2e-media-roundtrip-…/`). The loop's create PR then never merged → the post never served → the loop's serve leg timed out → the run failed → left another orphan → repeat. This is the exact #1723 Cat-2 class (transient `main` state poisoning a shared required check), reintroduced by the ephemeral redesign. **Fix:** a single shared predicate `isTestFixturePost` in `e2e/public-content.js` (the source of truth all three crawls use) excludes any post flagged `test_fixture: true` OR `sitemap: false` OR carrying the structural `e2e-` slug signature (`/^\d{4}-\d{2}-\d{2}-e2e-/i` on the filename, `^e2e-` on the URL slug). The slug signature is the load-bearing one: the UI-created posts carry NEITHER flag (the posts collection has no `sitemap`/`robots` widget and `test_fixture` is a hidden `default: false`), but the `slug:`/`date:` the spec types are reliably present. **Lock:** `e2e/public-content.test.js` ("test_fixture posts are excluded from the public-content crawl set", incl. the UI-shaped no-flag post and a console-clean-style end-to-end enumeration). Defence-in-depth: `sweep-stale-cms-prs.yml` reaps these orphans on a dedicated 3h age-threshold (vs 6h for human-hostable tiers; 3h is deliberately above the longest run's 95-min job timeout so the sweep can't reap a post still under active test). The sweep itself runs on a single once-daily cron (`0 4 * * *`, 04:00 UTC) — there is no 3-hourly cron anywhere in this repo's workflows — so once an orphan clears the 3h age-threshold it can still wait for the next daily pass; the actual wall-clock exposure window is up to ~24h from creation to the next sweep, not the "~3-6h" this once claimed.

- **`deploy-pill.js`'s `waitForChangeReflected` gates on the user-facing URL, never the GHA API.** The queue-aware deadline extension is *injected* via `onBudgetExhausted` (`makeDeployQueueExtender` in `github-actions-poll.js`) so the helper stays DOM-pure. The extender is **activity-aware**: extend while the deploy lane is in-flight *or recently cycling*, fail fast only when genuinely quiescent (a single-instant idle probe produced false "chain never fired" verdicts between this repo's frequent deploys). Don't make `deploy-pill.js` poll the API for success, and don't revert the extender to instantaneous idle detection. **Lock:** `e2e/deploy-pill.test.js`.

- **(Retired by #1771 step 4) `fixture-baseline.test.js`'s canary `published: false` assertion was diff-aware on `pull_request`.** It enforced the baseline only for fixtures the PR's *own diff* touched (`E2E_PR_TOUCHED_PROD_FIXTURES`, emitted by the `select` job), so a prod loop's transient `published: true` on `main` couldn't red an unrelated PR (it blocked #1715). That whole machinery (`shouldEnforceBaseline` / `baselineAssertionApplies` / `parseTouchedFixtures` + the select-job output) retired with the two persistent prod canaries: the prod-mutate + media loops now create+delete **ephemeral** per-run posts (resting state = absence/404), so there is no committed canary whose transient `published: true` could bleed into a merge-ref. There is nothing left to gate, so the assertion (and its diff-awareness) is gone rather than relaxed.

- **`await-prod-deploy` step 2 defers a superseded/non-success deploy conclusion to step 3's ground-truth (descendant) check.** The `production` lane is `cancel-in-progress: false`, so a deploy queued for THIS merge can be `cancelled` while a newer sibling deploy carries the merge live (prod ends up ahead, not stale). Don't re-add a hard `exit 1` on the conclusion — "does prod serve this SHA or a newer descendant?" is the only gate, and it's strictly stronger. **Lock:** `e2e/workflow-prod-loop-serialized.test.js`.

- **The ci-runner Playwright drift guard checks the Dockerfile `ARG`** (the platform-delivered `check-playwright-image-drift.js`, run by the platform's `select` lane — no longer a consumer-vendored script) — not just workflow files (no workflow references the raw `mcr.microsoft.com/playwright` image anymore). Bumping `@playwright/test` REQUIRES bumping `.github/ci-runner/Dockerfile`'s `PLAYWRIGHT_IMAGE_TAG` to match, or the rebuilt image pairs a new client with old browsers → `Executable doesn't exist` at launch. A Playwright `globalSetup` (`e2e/install-browsers-on-miss.js`) installs missing browsers as a runtime fallback. **Lock:** `e2e/playwright-image-drift.test.js`.

- **`preview-media-resolves.spec.js` runs ONLY under `preview-media.yml`** (`RUN_PREVIEW_MEDIA_PROBE=1`, after that workflow's preview-reachability poll). Don't un-gate it — the general e2e matrix exposes `PR_NUMBER`, which previously un-skipped it there, where it probed a preview that may not exist and 404-flaked the required check.

- **`parity-preview` / `preview-media` require a live preview only for RENDER-affecting PRs.** `selectParityPreviewSpecs` fans out on `RENDER_FANOUT_PATTERNS` only (the paths that also trigger `deploy-preview`), NOT test/CI-infra fanout (`e2e-tests.yml`, `package*.json`, playwright config, `e2e/base.js`). A pure-CI/test PR produces no preview, so demanding one there is a spurious hard-fail (it required an owner override every time). **Lock:** `e2e/select-specs.test.js`.

See **ADR 0004** for the full investigation, including why the audit's original "deploy backlog" hypothesis for Cat 1 was wrong (the queue-aware wait's sharpened diagnostic is what exposed the future-date build-skip).

## Preview environment flow

1. PR opened → Jekyll builds at root (no baseurl) → sync to `s3://adamdaniel-ai-previews/pr-{N}/`
2. CloudFront cache invalidated at `/pr-{N}/*` (what the viewer-request Function rewrites requests to)
3. Bot posts `https://preview-pr{N}.adamdaniel.ai/` as PR comment
4. PR closed → S3 files deleted, CloudFront invalidated, existing comment updated to "cleaned up"

## Skills

This consumer no longer vendors a local skill mirror or agent-harness test
framework. The platform’s agent skills are delivered via the cms-platform gem
+ reusable workflows; this repo follows the clean-consumer shape (matching
`jodidaniel.com`, which carries none) and vendors none. Removed in the
#2007-P7 thin-ification; the secrets-scan + lint-staged pre-commit guards that
used to ride the skills `bootstrap.sh` now arrive via the platform’s
`dev-hooks-sync.yml` (see the Secrets-scan / pre-commit section above).

The one **site-owned** skill is `.claude/skills/embeddable-tool-pages/`
(how to add a `/tools/` page or embed a tool in a post — see the Tools
section above). It lives in Claude Code’s native project-skill location,
not the removed `.agents/` mirror, and is site content rather than
platform machinery — the platform skills-sync doesn’t manage it.
