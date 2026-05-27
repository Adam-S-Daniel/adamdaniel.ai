// @lane: local — pure-fs invariants on _e2e canary collection wiring
// + the prod `_posts/` canary body byte-lock (#1771 step 3).
const { test, expect } = require("./base");
const fs = require("node:fs");
const path = require("node:path");
const { CANARIES, readCanarySource } = require("./canary-content");
const { PROD_FIXTURES, reconstructBaseline, readPublishedFlag } = require("./fixture-baseline");
const { PROD_FIXTURES_CANON } = require("./prod-fixture-canon");

const REPO_ROOT = path.resolve(__dirname, "..");

test.describe("Canary content invariants", () => {
  test.describe.configure({ mode: "serial" });

  test("every canary descriptor matches a checked-in source file", () => {
    for (const c of CANARIES) {
      const src = readCanarySource(c);
      // The baseline text MUST appear verbatim in the source body. The
      // cleanup step writes it back after each test run, so a drift
      // here means the canary doesn't reset to the same content the
      // descriptor claims.
      expect(src, `${c.path} body must contain the baseline string`).toContain(c.baseline);
      // The FULL canonical body (title sentence + explanatory paragraphs
      // + footer) must also match the checked-in file byte-for-byte.
      // Without this assertion the canary file could drift gradually —
      // e.g., a Decap WYSIWYG round-trip doubles newlines (PR #882) —
      // and the publish-loop spec's UI cleanup would silently produce a
      // mangled cms/e2e/* PR that disagrees with the API-path setup
      // reset, leaving conflicting PRs in their wake.
      const fmEnd = src.indexOf("\n---\n", 4);
      expect(fmEnd, `${c.path} must have a closing front-matter delimiter`).toBeGreaterThan(0);
      const fileBody = src
        .slice(fmEnd + 5)
        .replace(/^\n+/, "")
        .replace(/\n+$/, "");
      expect(
        fileBody,
        `${c.path} body must match the canonical buildBaselineBody() output verbatim — newline drift (often from a Decap markdown-widget round-trip) breaks the publish-loop cleanup contract`,
      ).toBe(c.baselineBody);
      expect(src).toContain(`canary_id: ${c.id}`);
      expect(src).toContain(`permalink: ${c.publicPath}`);
      expect(src).toMatch(/^layout: canary$/m);
      expect(src).toMatch(/^robots: noindex,nofollow$/m);
      expect(src).toMatch(/^sitemap: false$/m);
    }
  });

  test("admin/config.yml exposes the e2e canary collection", () => {
    const cfg = fs.readFileSync(path.join(__dirname, "..", "admin", "config.yml"), "utf8");
    // The publish-loop test drives admin actions on this collection.
    // If it disappears, the test goes silently green (no PR opened ≠
    // success) — fail loudly here.
    expect(cfg).toMatch(/^\s{2}- name: e2e\s*$/m);
    // Both `create: true` and `delete: true` are required:
    //   - `delete: true` lets `cms-delete-published.spec.js` click
    //     the Decap UI's "Delete published entry" menuitem (Decap
    //     renders that menuitem only when the collection allows
    //     deletes).
    //   - `create: true` lets the same spec drive the editor's
    //     "+ New E2E Canary" form to seed its throw-away fixture
    //     via UI instead of the `seedFixtureViaPr` API back door
    //     (per AGENTS.md "no back doors in setup or cleanup").
    // The "[E2E TEST FIXTURES — DO NOT EDIT]" collection label is
    // the convention-only guardrail against accidental editor-driven
    // mutation.
    expect(cfg).toMatch(/^\s{4}folder: _e2e\s*$/m);
    expect(cfg).toMatch(/^\s{4}create: true\s*$/m);
    expect(cfg).toMatch(/^\s{4}delete: true\s*$/m);

    // The body field MUST be `widget: text` (plain HTML textarea), not
    // `widget: markdown` (Slate WYSIWYG). With `widget: markdown`,
    // saving via the editor round-trips through Slate and every soft
    // line wrap inside a paragraph comes back doubled as a paragraph
    // break (PR #882: `\n` → `\n\n`, `\n\n` → `\n\n\n\n`, plus the
    // blank line between frontmatter `---` and the first paragraph
    // gets eaten). The publish-loop spec's UI cleanup then produces a
    // file that disagrees with the canonical baseline; the cms/e2e/*
    // PR Decap opens conflicts with main as soon as the next run's
    // safety-net pushes a clean baseline.
    const e2eStart = cfg.search(/^\s{2}- name: e2e\s*$/m);
    expect(e2eStart, "e2e collection must be present").toBeGreaterThan(-1);
    // Slice from the e2e collection start to the next top-level
    // collection (or EOF) so the body-field regex can't match a body
    // field from a different collection (posts/projects/pages).
    const nextCollection = cfg.slice(e2eStart + 1).search(/^\s{2}- name: \w/m);
    const e2eBlock =
      nextCollection < 0 ? cfg.slice(e2eStart) : cfg.slice(e2eStart, e2eStart + 1 + nextCollection);
    expect(e2eBlock).toMatch(/^\s{6}- name: body\s*$/m);
    expect(
      e2eBlock,
      "e2e body field MUST be widget: text — widget: markdown breaks the publish-loop cleanup contract (see PR #882)",
    ).toMatch(/^\s{6}- name: body\s*\n(?:\s{6,}.+\n)*?\s{8}widget: text\s*$/m);
    // Negative assertion: explicitly forbid the dangerous widget on the
    // e2e body. (The positive assertion above would catch a missing
    // `widget: text`, but a misindented `widget: markdown` could
    // theoretically slip through; this makes the intent loud.)
    const e2eBody = e2eBlock.match(
      // eslint-disable-next-line no-useless-escape -- `\Z` is a literal end-of-input fallback in the lookahead alternation; kept verbatim to preserve the existing match behavior of this YAML-structure scan.
      /^\s{6}- name: body\s*\n(?:\s{6,}.+\n)+?(?=\s{0,6}-|\s{0,4}- name|\Z)/m,
    );
    if (e2eBody) {
      expect(e2eBody[0]).not.toMatch(/^\s{8}widget: markdown\s*$/m);
    }
  });

  test("_config.yml registers the e2e collection with the right permalink", () => {
    const cfg = fs.readFileSync(path.join(__dirname, "..", "_config.yml"), "utf8");
    // Without `output: true` Jekyll won't render an HTML file; the
    // publish-loop's "assert it shows up at the public URL" step would
    // never satisfy.
    expect(cfg).toMatch(/^\s{2}e2e:/m);
    expect(cfg).toMatch(/output:\s*true/);
    expect(cfg).toMatch(/permalink:\s*\/e2e\/:slug\//);
    // Defaults must propagate the noindex + sitemap-exclude so an editor
    // who clones a canary doesn't accidentally publish it to search.
    expect(cfg).toMatch(/sitemap:\s*false/);
    expect(cfg).toMatch(/robots:\s*"noindex,nofollow"/);
  });
});

// ── Prod `_posts/` canary body byte-lock (#1771 step 3) ─────────────
// The proven `canary-content.js ⇄ canary-content.test.js` contract, now
// applied to the two prod-loop `_posts/` fixtures: the canonical content
// is a frozen code constant (PROD_FIXTURES_CANON) and `reconstructBaseline`
// returns it. THIS test is the lock that forces the committed file to
// equal that constant byte-for-byte — so a Slate-mangled green run (which
// double-spaces lines and backtick-escapes code spans through Decap's
// `widget: markdown` editor) can never silently become the new baseline.
//
// This is the structural answer to the #1771 "Confirmed since filing"
// criterion: "`published:false` + 404 is NOT sufficient proof of a clean
// run — body integrity must be asserted." A green run's safety-net now
// writes `reconstructBaseline(path)` (canonical bytes), and this lint
// fails CI if the committed bytes ever drift from canonical.
test.describe("Prod `_posts/` canary body byte-lock (#1771 step 3)", () => {
  test("every PROD_FIXTURES entry has a code-pinned canonical (no self-read fallback)", () => {
    // The baseline source MUST be a code constant for every prod fixture;
    // a missing entry would force reconstructBaseline to throw at runtime,
    // but catch it HERE at lint time so a newly-added PROD_FIXTURES path
    // can't ship without its frozen canonical.
    for (const rel of PROD_FIXTURES) {
      expect(
        Object.prototype.hasOwnProperty.call(PROD_FIXTURES_CANON, rel),
        `${rel} is in PROD_FIXTURES but has no PROD_FIXTURES_CANON entry — add its ` +
          `frozen canonical to e2e/prod-fixture-canon.js (the baseline MUST NOT fall ` +
          `back to reading the on-disk body, #1771 step 3)`,
      ).toBe(true);
    }
  });

  test("committed fixture bytes EQUAL reconstructBaseline(path) — body integrity lock", () => {
    for (const rel of PROD_FIXTURES) {
      const abs = path.join(REPO_ROOT, rel);
      const committed = fs.readFileSync(abs, "utf8");
      const canonical = reconstructBaseline(rel);

      // The canonical must itself be a clean baseline: `published: false`
      // (the #1053 unstick state) — guards against a typo in the frozen
      // constant.
      expect(
        readPublishedFlag(canonical),
        `${rel} canonical MUST be 'published: false' (the #1053 unstick baseline)`,
      ).toBe(false);

      // THE drift lock: committed bytes === code-pinned canonical bytes.
      // A failure here means a green run (or a hand edit) left the body
      // drifted from canonical — typically a Decap `widget: markdown`
      // Slate round-trip that double-spaced lines / backtick-escaped code
      // spans. Reset the file to `reconstructBaseline(path)`.
      expect(
        committed,
        `${rel} committed body has drifted from its code-pinned canonical ` +
          `(PROD_FIXTURES_CANON). A green prod-loop run must leave the body ` +
          `byte-identical to canonical (#1771): a Slate \`widget: markdown\` ` +
          `round-trip double-spaces lines and backtick-escapes code spans. ` +
          `Fix: overwrite the file with reconstructBaseline("${rel}").`,
      ).toBe(canonical);
    }
  });
});
