# CMS admin: content model & live preview

Reference for the Decap CMS content model (collections, fields, the automated-test-fixture convention) and the live-preview machinery (the `/preview/` page, the admin dashboard affordances, mobile responsiveness, and the HTML-embed widget seam). Read this when adding/changing a collection field, touching anything under the (gem-delivered) `admin/` UI behavior, or debugging why a preview/post link/mobile layout doesn't work as expected.

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

**Vendored-tool sync + previews.** This is the general contract for ANY tool
repo that vendors onto `/tools/` (today's only instance: `claude-memory-map`).
A synced tool's copy at `assets/tools/<slug>/index.html` is
**automation-managed — don't hand-edit it here**; change the source repo
instead. The source repo pushes to this one (this repo carries no sync
machinery; its normal PR pipeline does the rest):

- **Sync:** a merge to the source repo's `main` force-pushes branch
  `tool-sync/<slug>` (new copy + provenance in
  `_data/tool_sources/<slug>.yml`) and opens/reuses a PR with
  **auto-merge** enabled — it lands when the required checks pass, then
  deploy-production takes it live. Provenance records the exact source commit;
  the workflow reads it back for compare links.
- **Preview:** each source-repo PR touching the built tool mirrors to
  a **draft** PR from branch `tool-preview/<slug>-pr-<n>`, so the
  standard deploy-preview publishes the changed tool at
  `preview-pr<N>.adamdaniel.ai/tools/<slug>/`. **Never merge these
  drafts** — they close automatically when the source PR closes (deploy-preview
  teardown then runs as usual), and a merged source PR arrives via the
  `tool-sync` PR instead.

Both flows authenticate with the `SITE_SYNC_TOKEN` fine-grained PAT stored in
each **source** repo (Contents + Pull requests RW on this repo — a PAT so its
PRs still trigger CI here; one shared token can serve every tool repo since
the grant is entirely site-side). The workflows live in the source repo
(`.github/workflows/site-{sync,preview}.yml` — claude-memory-map's are the
reference implementation to copy for a new tool); source-repo CI must enforce
that the committed artifact equals its deterministic build output, which is
what makes "copy the committed file" ship the verified artifact. `tool-sync/*`
and `tool-preview/*` are not `cms/*` branches, so the CMS PR sweeps ignore
them.

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
