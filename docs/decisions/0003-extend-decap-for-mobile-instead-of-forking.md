# 0003. Extend Decap CMS with a CSS overlay for mobile instead of forking it

**Status:** Accepted
**Date:** 2026-05-23
**Tags:** admin, decap, mobile, css

## Context

The task was to make the `/admin/` interface (Decap CMS) work well on mobile,
with iPhone 16 (393×852 CSS px, WebKit) as the primary use case. Decap is the
only meaningful upstream UI dependency in this repo, so the first question was
explicit: **do we fork Decap to fix mobile, or extend it from the outside?**

What we observed driving Decap 3.12.2 at 393px (WebKit), captured via the
`webkit-iphone16` Playwright project:

- The whole app renders ~800px wide → ~407px of dead horizontal scroll. The
  shell carries a desktop `min-width`, and the entry editor is a fixed
  side-by-side `react-split-pane` (form pane + live-preview iframe).
- `EditorContainer` is `position: absolute; height: 100vh` with its panes
  scrolling internally — the form is trapped in a 393px box and the toolbar's
  top half hides behind the sticky app header.
- The editor toolbar's **Save / Publish / Delete** controls overflow off the
  right edge and are unreachable; the account avatar and "+ New" likewise.
- `CollectionMain` keeps its desktop `padding-left: 280px` (the side-rail
  gutter), crushing the entries list into a 77px sliver on the right.
- Form inputs are 15px, so iOS Safari zooms the page on every field focus.

Crucially, **none of these are logic bugs** — they are all layout/sizing
decisions that CSS can override. The repo's entire admin architecture is
already "thin layers over a pinned CDN bundle": `admin/index*.html` loads
`decap-cms@3.12.2` from unpkg and a handful of small JS shims
(`live-url-banner.js`, `posts-list-enhance.js`, …) plus inline CSS layer
behaviour on top. An inline `@media (max-width: 600px)` sidebar rule already
existed — proof the overlay approach works for mobile.

## Decision

**Do not fork Decap.** Add a single responsive stylesheet,
`admin/admin-mobile.css`, linked from all three admin shells, that overrides
Decap's layout at a 768px breakpoint: drop the shell `min-width`, put the
editor into normal document flow, collapse the split-pane to a single column
(hiding the redundant preview iframe — `/preview/` is already the editor's
WYSIWYG), wrap the toolbar so every control is reachable, zero the desktop
sidebar gutter, and bump inputs to 16px. Lock the behaviour with
`e2e/cms-mobile-layout.spec.js` on the `webkit-iphone16` + `chromium-desktop-3k`
admin lane.

## Consequences

- **Stays on the upstream release train.** Decap version bumps remain a
  one-line change in `admin/index*.html` (guarded by `cms-bundle-version` /
  `admin-pin-invariant`); no fork to rebase, no bundle to build or vendor, no
  security-patch backlog to own.
- **No new build step.** The admin stays a set of static files + a CDN script;
  `admin-mobile.css` is just another file Jekyll copies and the
  `admin-bundle-parity` probe checks.
- **Degrades safe.** Every selector is an attribute-substring
  (`[class*="…"]`) or a react-split-pane structural class. If Decap renames a
  component, the rule matches nothing and the layout falls back to upstream
  defaults — never worse than today.
- **Fragility is bounded and tested.** The overlay leans on Emotion class-name
  *suffixes* (hashes rotate, suffixes are stable across the versions we pin)
  and on CSS specificity quirks (Emotion injects its `<style>` at runtime,
  *after* our linked sheet, so equal-specificity rules lose the tie — several
  selectors are deliberately two-class to win it). `cms-mobile-layout.spec.js`
  fails loudly if a Decap upgrade breaks any of this, pointing the next
  maintainer at exactly what regressed.
- **The inline live preview is hidden on phones.** Acceptable — `/preview/`
  (opened in a second tab) is the real-layout WYSIWYG and the desktop pane is
  unchanged (guarded by the spec's desktop-layout test).

## Alternatives considered

- **Fork Decap CMS.** Rejected. Decap is a large React + Emotion + Redux
  monorepo; forking means standing up its build, vendoring a multi-MB bundle,
  re-applying patches on every upstream release, and owning the transitive
  security surface — all to fix problems that are purely CSS. It would also
  invalidate the repo's byte-parity and version-pin invariants and the dozens
  of e2e selectors that assert against upstream DOM. The maintenance cost is
  wildly disproportionate to a responsive-layout change.
- **`CMS.registerPreviewTemplate` / custom React components.** Decap's
  extension API can replace widgets and the preview, but not restructure the
  shell/editor chrome (toolbar, split-pane, headers) that causes the overflow.
  It wouldn't reach the actual problems.
- **Keep expanding inline `<style>` in each `index*.html`.** Rejected for a
  stylesheet this size: triplicating ~120 lines across three shells invites
  drift. A single linked file is the same pattern the admin already uses for
  its JS shims, and the banned-pattern lint + parity probe already cover
  `admin/*.css`.

## References

- `admin/admin-mobile.css`, `admin/index.html`, `admin/index-local.html`,
  `admin/index-test.html`
- `e2e/cms-mobile-layout.spec.js` (behaviour lock, `webkit-iphone16` lane)
- `e2e/admin-css-banned-patterns.test.js` (iOS WebKit compositing footguns)
- ADR-0001 (Decap Slate round-trip quirks), PR #81 (cobalt theme removal —
  established "/preview/ is the WYSIWYG, the admin shell stays minimal")
