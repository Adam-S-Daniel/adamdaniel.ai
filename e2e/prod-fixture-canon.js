/*
 * Code-pinned CANONICAL content for the two prod-loop `_posts/` fixtures
 * (issue #1771 step 3).
 *
 * Why this module exists
 * ----------------------
 * The prod-mutate / media-roundtrip loops used to derive their baseline
 * from the on-disk fixture body
 *
 *     forcePublishedFalse(fs.readFileSync(FIXTURE_ABS, "utf8"))
 *
 * which copies whatever body is committed VERBATIM. But a green run
 * re-types that body back through Decap's `widget: markdown` Slate
 * editor, whose WYSIWYG round-trip rewrites it on Save — double-spacing
 * every line and backtick-escaping code spans (`` \` ``). Because the
 * NEXT run then re-derives its "baseline" from that same mangled
 * on-disk body, the corruption is self-perpetuating: a green run leaves
 * the committed canary body drifting further from canonical every time
 * (#1771, "Confirmed since filing"). The `_posts/` body can't use
 * `widget: text` like the `_e2e/` canary (it lives in the `posts`
 * collection, which needs `widget: markdown`, and Decap widgets are
 * per-collection not per-entry), so body integrity is delivered here
 * instead: the baseline / safety-net source becomes a frozen CODE
 * CONSTANT, never a read of the path the loop also writes.
 *
 * This mirrors the proven `canary-content.js ⇄ canary-content.test.js`
 * contract for the `_e2e/` canaries: a code constant is the source of
 * truth, and a byte-for-byte lint forces the checked-in file to equal
 * it. See `reconstructBaseline()` in `./fixture-baseline` (the consumer)
 * and the drift-lint in `./canary-content.test.js`.
 *
 * Pure Node — no `require("./base")` — so it stays a plain, unit-
 * testable library (same discipline as `./fixture-baseline`).
 *
 * INVARIANT: every constant here ships `published: false` in its front
 * matter (the #1053 unstick baseline). The full canonical file text is
 * `${frontMatter}\n---\n${body}` — frontMatter is the opening `---`
 * block (up to, NOT including, the closing delimiter); body is
 * everything after the closing `\n---\n`. This matches the slicing in
 * `splitFrontMatter` so a round-trip through that helper is a no-op.
 */

// ── Mutation-canary (cms-publish-loop-prod-mutate.spec.js) ──────────
// Canonical body is PR #1770's hand-reset (commit 65a76dc): single-
// spaced, proper backticks. Frozen here so a Slate round-trip can never
// become the next run's baseline.
const MUTATE_FRONT_MATTER = `---
reading_time: null
excerpt: "Fixture used by the nightly prod-mutation playground spec. Never
  serves at a public URL until a test flips published: true, then resets it."
robots: noindex,nofollow
title: E2E Mutation Canary
slug: e2e-mutation-canary
date: 2099-01-01 00:00:00 +0000
tags: []
featured_image: ""
published: false
sitemap: false
publish_date: ""
test_fixture: true`;

const MUTATE_BODY = `Adam Daniel — E2E mutation canary post (do not edit by hand).

This file is the target of the nightly prod-mutation playground spec
(\`e2e/cms-publish-loop-prod-mutate.spec.js\`, scheduled by
\`.github/workflows/cms-publish-loop-prod.yml\`). While \`prod\` is a
"full mutation playground" — i.e. nobody is reading the site for SEO —
the spec exercises the **entire** Decap → cms PR → auto-merge →
deploy-production loop against a real \`_posts/\` entry rather than the
\`_e2e/\` canary subset.

The spec keeps \`published: false\` between runs, so this file does NOT
serve at any public URL until the spec flips it to \`true\`. After the
URL goes live and the spec asserts the deploy succeeded, a cleanup
commit flips it back to \`false\` and the URL 404s again. \`sitemap: false\`
and \`robots: noindex,nofollow\` are belt-and-suspenders so a stuck
"published: true" state never leaks into search.

Sunset path: when \`prod\` stops being a playground (real readers, real
SEO concerns), set the repo variable \`PROD_PLAYGROUND_MODE=false\` (or
unset it) and the workflow skips itself. This file stays as
documentation of the previous playground regime — it remains harmless
because \`published: false\` keeps it out of the build.

If this is the only thing you can see at \`/blog/e2e-mutation-canary/\`,
the spec ran but the cleanup step hasn't fired yet. The next nightly
run resets it; if the URL is still live tomorrow, check the latest
\`cms-publish-loop-prod.yml\` run.
`;

// ── Media round-trip (cms-media-roundtrip.spec.js) ──────────────────
// Already byte-clean on main (no Slate drift observed), but pinned here
// so the same byte-lock and canonical-restore protect it too.
const MEDIA_FRONT_MATTER = `---
reading_time: null
excerpt: "Fixture for the media round-trip spec. Never serves at a public URL
  until a test flips published: true, then resets it."
robots: noindex,nofollow
title: E2E Media Roundtrip
slug: e2e-media-roundtrip
date: 2099-01-03 00:00:00 +0000
tags: []
featured_image: ""
published: false
test_fixture: true
sitemap: false
publish_date: ""`;

const MEDIA_BODY = `Adam Daniel — E2E media round-trip fixture (do not edit by hand).

This file is the target of \`e2e/cms-media-roundtrip.spec.js\`, scheduled
by \`.github/workflows/cms-media-roundtrip.yml\`. The spec drives the real
Decap admin against the real GitHub backend to:

1. upload a unique image via the Media UI and attach it to this post,
2. publish, and assert the image loads on adamdaniel.ai,
3. remove the image from the post and publish,
4. delete the image via the Media UI,
5. assert the image's live URL 404s.

The baseline keeps \`published: false\` and \`featured_image: ""\`, so this
file does NOT serve at any public URL between runs. \`sitemap: false\` and
\`robots: noindex,nofollow\` are belt-and-suspenders so a stuck
\`published: true\` state never leaks into search.

If this is the only thing you can see at \`/blog/e2e-media-roundtrip/\`,
the spec ran but cleanup hasn't fired yet. Check the latest
\`cms-media-roundtrip.yml\` run.
`;

// Compose the full canonical file text the same way `splitFrontMatter`
// re-joins it: `<frontMatter>\n---\n<body>`. The result is the exact
// bytes the committed fixture must equal (enforced by the drift-lint).
function composeCanonical(frontMatter, body) {
  return `${frontMatter}\n---\n${body}`;
}

// Map every PROD_FIXTURES path → its full canonical file text (front
// matter forced `published: false` + canonical body), built ENTIRELY
// from the frozen constants above. The body is NEVER read from the
// on-disk fixture. Keys MUST stay in sync with PROD_FIXTURES in
// ./fixture-baseline (the drift-lint iterates PROD_FIXTURES and asserts
// each has an entry here).
const PROD_FIXTURES_CANON = Object.freeze({
  "_posts/2099-01-01-e2e-mutation-canary.md": composeCanonical(MUTATE_FRONT_MATTER, MUTATE_BODY),
  "_posts/2099-01-03-e2e-media-roundtrip.md": composeCanonical(MEDIA_FRONT_MATTER, MEDIA_BODY),
});

module.exports = {
  PROD_FIXTURES_CANON,
};
