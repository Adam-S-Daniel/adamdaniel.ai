/*
 * Shared "force the fixture to a known baseline" helpers for the CMS
 * publish-loop / mutation specs.
 *
 * Why this module exists (issue #1053)
 * ------------------------------------
 * The prod-mutation and media-roundtrip specs used to derive their
 * cleanup/baseline text via
 *
 *     function buildBaselineFileText() {
 *       return fs.readFileSync(FIXTURE_ABS, "utf8");
 *     }
 *
 * i.e. they TRUSTED whatever `published:` value was checked in. The
 * canary fixtures are checked in `published: true`, so every cleanup
 * re-wrote `published: true`, the next run's guard saw `published:
 * true`, `test.fixme()`'d into a GREEN (skipped) job, and the loop
 * never ran — for ~10 days with zero signal. It was a fixed point,
 * not self-healing.
 *
 * The fix is to NEVER trust the on-disk `published:` value: always
 * force it to `false` when constructing the baseline. Several specs
 * had each grown their own copy of this logic (`sanitizeToBaseline`,
 * `forcePublishedFalse`, `readPublishedFlag`); this module is the one
 * shared implementation so a future spec can't reintroduce the
 * trust-the-file bug by copy-paste drift.
 *
 * Pure Node — deliberately NO `require("./base")`. `loudBail` takes
 * the caller's Playwright `test` object as an argument so this module
 * stays a plain, unit-testable library (see fixture-baseline.test.js).
 */

// Code-pinned canonical content for the prod fixtures (#1771 step 3).
// `reconstructBaseline` reads the baseline from THIS map, never from the
// on-disk body the loop also writes. Pure-Node sibling — no Playwright.
const { PROD_FIXTURES_CANON } = require("./prod-fixture-canon");

// The real `_posts/` fixtures the prod loops mutate. These MUST be
// checked in `published: false` (the #1053 unstick invariant); the
// assertion in fixture-baseline.test.js is the regression guard that
// keeps them that way. Canonical here (not in the test) so the e2e
// workflow's `select` job can read the same list when computing which
// of them a PR's diff touches (#1723 Cat 2). Keep in sync with the
// SPEC_FIXTURES map in cms-recursion-churn.test.js.
const PROD_FIXTURES = [
  "_posts/2099-01-01-e2e-mutation-canary.md",
  "_posts/2099-01-03-e2e-media-roundtrip.md",
];

// Parse the front-matter `published:` flag from a file's text. Matches
// `published: true|false` on its own line, tolerating surrounding
// whitespace and single/double quoting. Returns true | false, or null
// when there is no parseable line.
function readPublishedFlag(text) {
  const m = text.match(/^published:\s*(true|false|"true"|"false"|'true'|'false')\s*$/m);
  if (!m) return null;
  return m[1].replace(/['"]/g, "") === "true";
}

// Split "<frontMatter>\n---\n<body>" at the closing `---` delimiter.
// `frontMatter` excludes the delimiter; `body` includes the leading
// "\n---\n" (byte-identical to the slicing the per-spec copies did).
// Throws a descriptive, fixture-named error if the closing delimiter
// is missing, so a malformed fixture fails loudly instead of silently
// producing junk baseline text.
function splitFrontMatter(fileText, fixturePath) {
  const fmEnd = fileText.indexOf("\n---\n", 4);
  if (fmEnd < 0) {
    throw new Error(`Fixture ${fixturePath} is missing its closing front-matter delimiter.`);
  }
  return {
    frontMatter: fileText.slice(0, fmEnd), // up to (not incl) "\n---\n"
    body: fileText.slice(fmEnd), // includes leading "\n---\n"
  };
}

// Internal: return the front matter with `published:` forced to
// `false` (replacing an existing line, or appending one if absent).
function frontMatterPublishedFalse(frontMatter) {
  return /^published:\s*.*$/m.test(frontMatter)
    ? frontMatter.replace(/^published:\s*.*$/m, "published: false")
    : `${frontMatter}\npublished: false`;
}

// Force `published: false` in the front matter, leaving the body and
// the rest of the front matter byte-for-byte untouched. Use this when
// the body IS meaningful and should flow through from the checked-in
// fixture (prod-mutate / media-roundtrip / the toggle-only specs): a
// documentation-body edit to the committed fixture still reaches the
// cleanup commit automatically, but the dangerous `published:` value
// can never be trusted from disk again.
function forcePublishedFalse(fileText, fixturePath) {
  const { frontMatter, body } = splitFrontMatter(fileText, fixturePath);
  return `${frontMatterPublishedFalse(frontMatter)}${body}`;
}

// Return the ENTIRE canonical file text (front matter forced
// `published: false` + canonical body) for a prod fixture, from the
// code-pinned PROD_FIXTURES_CANON map (#1771 step 3, Plan A "Lever 2").
//
// This is the keystone fix for the self-perpetuating body corruption:
// the prod loops used to derive their baseline via
// `forcePublishedFalse(readFileSync(FIXTURE_ABS))`, copying the on-disk
// body verbatim — but a green run re-types that body through Decap's
// `widget: markdown` Slate editor, whose WYSIWYG round-trip double-
// spaces lines and backtick-escapes code spans on Save. The next run
// then re-derived its "baseline" from that mangled body, so the
// committed canary drifted further from canonical every green run
// (#1771). `reconstructBaseline` breaks that loop: the baseline (and
// the afterAll safety-net content) is now a FROZEN CODE CONSTANT, so
// even when the UI cleanup mangles the body, the committed fixture is
// restored to canonical bytes — satisfying the acceptance criterion
// "a green run MUST leave the canary body byte-identical to canonical."
//
// The body is NEVER `readFileSync`'d from the path the loop also writes
// (the whole point — see the drift-lint in canary-content.test.js). A
// missing entry throws loudly so a new PROD_FIXTURES path can't
// silently fall back to a self-read.
function reconstructBaseline(fixtureRelPath) {
  const canonical = PROD_FIXTURES_CANON[fixtureRelPath];
  if (canonical == null) {
    throw new Error(
      `reconstructBaseline: no code-pinned canonical for ${fixtureRelPath} ` +
        `(add it to PROD_FIXTURES_CANON in e2e/prod-fixture-canon.js). The ` +
        `baseline MUST NOT fall back to reading the on-disk body — that is ` +
        `the self-perpetuating corruption #1771 step 3 removes.`,
    );
  }
  return canonical;
}

// Force `published: false` AND replace the body with a canonical,
// marker-free baseline. Use this when the body itself is churned by
// the spec and a prior crashed run may have left a run-marker in it
// (the preview prod-mutate parity spec). `baselineBody` is everything
// that should follow the closing front-matter `---`.
function sanitizeToBaseline(fileText, fixturePath, baselineBody) {
  const { frontMatter } = splitFrontMatter(fileText, fixturePath);
  return `${frontMatterPublishedFalse(frontMatter)}\n---\n${baselineBody}`;
}

// The Decap editorial-workflow branch for a `_posts/<slug>.md`
// fixture. Decap opens exactly ONE PR per entry on this fixed branch;
// the prod-mutate / media-roundtrip specs build their `DECAP_BRANCH`
// constant the same way (`cms/posts/${FILE_SLUG}`).
function ownDecapBranchFor(fixtureRelPath) {
  const slug = fixtureRelPath.replace(/^_posts\//, "").replace(/\.md$/, "");
  return `cms/posts/${slug}`;
}

// Whether the strict `published: false` baseline assertion applies to
// `fixtureRelPath` given a PR head branch `headRef`
// (process.env.GITHUB_HEAD_REF; "" on push/main and local dev).
//
// FALSE *only* on that fixture's own Decap branch: there the loop's
// own publish PR legitimately carries a transient `published: true`
// and the round-trip spec REQUIRES that PR to merge+deploy before it
// reverts (spec step 9 + afterAll + step-0b force baseline). The
// #1053 force-baseline change (3dbade7) regressed exactly this — it
// red-failed that PR's required e2e check, deadlocking the round trip
// (scheduled media run 26114167560). TRUE on push/main and on every
// OTHER branch, so #1053's real hazard — `published: true` PERSISTING
// on main, or a stray flip on a feature branch — is still guarded
// unchanged. Per-fixture precise: fixture A's branch does NOT relax
// the assertion for fixture B.
function baselineAssertionApplies(fixtureRelPath, headRef) {
  return (headRef || "") !== ownDecapBranchFor(fixtureRelPath);
}

// Whether the strict `published: false` baseline assertion should BLOCK
// for `fixtureRelPath` in the current CI context. Composes the
// own-branch relaxation above with a second, #1723-Cat-2 relaxation:
//
//   On a `pull_request`, the e2e suite runs against the PR's MERGE ref
//   (PR + base), so it inherits whatever transient state a prod loop
//   has left on `main` — including the ~10-15 min window where a
//   canary fixture is legitimately `published: true` mid-publish (the
//   prod-mutate / media-roundtrip "playground" round trip). A PR that
//   does NOT itself touch that fixture is in NO way responsible for
//   main's transient canary state, yet the merge-ref bleed red-failed
//   the required `e2e (1)` check on unrelated PRs anyway — it blocked
//   #1715 (a prod-loop had left `_posts/2099-01-01-...` published:true
//   on main at the moment the PR's merge-ref was computed). A PR is
//   only responsible for the fixtures it actually changes, so on a
//   pull_request we enforce the canary baseline ONLY for fixtures the
//   PR's own diff touches (`prTouchesFixture`).
//
// #1053's real hazard — `published: true` PERSISTING on main, or a PR
// that itself commits a canary at `published: true` — is still caught:
//   - A PR that DOES edit the canary keeps `prTouchesFixture === true`
//     → strict assertion applies → the PR can't introduce a stuck-true.
//   - On push/schedule/workflow_dispatch and on local dev (eventName
//     not "pull_request"), the assertion always applies, unchanged.
//   - A persistent main-side stuck-true is bounded by the loop's own
//     step-0 reset + afterAll safety net and surfaced by the
//     non-required canary-baseline-watchdog (#1723 Cat 2).
//
// Defaults are the SAFE direction: unknown event or unknown touch-set
// ⇒ enforce. `prTouchesFixture` defaults true so a caller that can't
// compute the PR's touched set never silently relaxes.
function shouldEnforceBaseline(
  fixtureRelPath,
  { headRef = "", eventName = "", prTouchesFixture = true } = {},
) {
  // (a) The fixture's own Decap branch: transient publish:true expected.
  if (!baselineAssertionApplies(fixtureRelPath, headRef)) return false;
  // (b) Unrelated pull_request (diff doesn't touch this fixture): main's
  //     transient canary state is not this PR's concern (#1723 Cat 2).
  if (eventName === "pull_request" && !prTouchesFixture) return false;
  return true;
}

// Parse the space/newline-separated env list the e2e `select` job emits
// (`E2E_PR_TOUCHED_PROD_FIXTURES`) into a Set of fixture paths the PR's
// own diff touched. Empty/undefined ⇒ empty set (no fixtures touched).
function parseTouchedFixtures(envValue) {
  return new Set(
    String(envValue || "")
      .split(/\s+/)
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

// True when this process is a scheduled / manually-dispatched CI run
// that is SUPPOSED to execute the loop for real. In that context a
// precondition bail must be a LOUD red failure, never a green
// `test.fixme`/`skip` (#1053 acceptance criterion: "a skipped/
// precondition-unmet scheduled run is a failed (visible) check, never
// a green no-op"). `pull_request` runs and local dev are intentionally
// NOT must-run: a PR author shouldn't be blocked by a fixture a prior
// run left dirty, and local dev legitimately skips these prod loops.
function isScheduledMustRun() {
  const ev = process.env.GITHUB_EVENT_NAME || "";
  return ev === "schedule" || ev === "workflow_dispatch";
}

// Bail on an unmet precondition. In a must-run scheduled/dispatch CI
// context this THROWS (the job goes red — visible). Everywhere else
// it `test.fixme()`s (green skip — local dev / PR iteration), exactly
// as the per-spec guards did before. Callers keep their trailing
// `return;` so the non-throw path still exits the test body.
function loudBail(test, message) {
  if (isScheduledMustRun()) {
    throw new Error(
      `[#1053 loud-skip guard] precondition unmet on a scheduled/` +
        `workflow_dispatch run — failing the job instead of silently ` +
        `skipping into a green check: ${message}`,
    );
  }
  test.fixme(true, message);
}

module.exports = {
  PROD_FIXTURES,
  readPublishedFlag,
  splitFrontMatter,
  forcePublishedFalse,
  reconstructBaseline,
  sanitizeToBaseline,
  ownDecapBranchFor,
  baselineAssertionApplies,
  shouldEnforceBaseline,
  parseTouchedFixtures,
  isScheduledMustRun,
  loudBail,
};
