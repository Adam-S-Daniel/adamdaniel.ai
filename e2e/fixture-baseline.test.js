// @lane: local — pure-fs/logic invariants for the shared fixture-baseline helpers (#1053)
const { test, expect } = require("./base");
const fs = require("node:fs");
const path = require("node:path");
const {
  PROD_FIXTURES,
  readPublishedFlag,
  forcePublishedFalse,
  sanitizeToBaseline,
  ownDecapBranchFor,
  baselineAssertionApplies,
  shouldEnforceBaseline,
  parseTouchedFixtures,
  isScheduledMustRun,
  loudBail,
} = require("./fixture-baseline");

const REPO_ROOT = path.resolve(__dirname, "..");

// `PROD_FIXTURES` (the real `_posts/` fixtures the prod loops mutate,
// which MUST be checked in `published: false` after #1053's unstick) is
// now canonical in ./fixture-baseline so the e2e `select` job can read
// the same list (#1723 Cat 2). The assertion below is the regression
// guard that keeps them at baseline (a future commit that flips one to
// `published: true` re-creates the stuck fixed point this exists to
// kill).

// Byte-identical reference implementations — exactly the per-spec
// copies that existed before this module. The DRY refactor must not
// change a single output byte; these lock that down.
function legacyForcePublishedFalse(fileText, FIXTURE_PATH) {
  const fmEnd = fileText.indexOf("\n---\n", 4);
  if (fmEnd < 0) {
    throw new Error(`Fixture ${FIXTURE_PATH} is missing its closing front-matter delimiter.`);
  }
  const frontMatter = fileText.slice(0, fmEnd);
  const body = fileText.slice(fmEnd);
  const fixedFm = /^published:\s*.*$/m.test(frontMatter)
    ? frontMatter.replace(/^published:\s*.*$/m, "published: false")
    : `${frontMatter}\npublished: false`;
  return `${fixedFm}${body}`;
}
function legacySanitizeToBaseline(fileText, FIXTURE_PATH, BASELINE_BODY) {
  const fmEnd = fileText.indexOf("\n---\n", 4);
  if (fmEnd < 0) {
    throw new Error(`Fixture ${FIXTURE_PATH} is missing its closing front-matter delimiter.`);
  }
  let frontMatter = fileText.slice(0, fmEnd);
  if (/^published:\s*.*$/m.test(frontMatter)) {
    frontMatter = frontMatter.replace(/^published:\s*.*$/m, "published: false");
  } else {
    frontMatter += "\npublished: false";
  }
  return `${frontMatter}\n---\n${BASELINE_BODY}`;
}

test.describe("fixture-baseline shared helpers (#1053)", () => {
  test("readPublishedFlag parses true/false/quoted, null when absent", () => {
    expect(readPublishedFlag("a\npublished: true\nb")).toBe(true);
    expect(readPublishedFlag("a\npublished: false\nb")).toBe(false);
    expect(readPublishedFlag('published: "true"')).toBe(true);
    expect(readPublishedFlag("published: 'false'")).toBe(false);
    expect(readPublishedFlag("published:    true   ")).toBe(true);
    expect(readPublishedFlag("title: x\nslug: y")).toBe(null);
    expect(readPublishedFlag("published: maybe")).toBe(null);
  });

  test("forcePublishedFalse forces false, preserves body, is idempotent", () => {
    const src = "---\ntitle: T\npublished: true\ntags: []\n---\nBODY line 1\nBODY 2\n";
    const out = forcePublishedFalse(src, "x.md");
    expect(readPublishedFlag(out)).toBe(false);
    // Body byte-for-byte intact.
    expect(out.endsWith("\n---\nBODY line 1\nBODY 2\n")).toBe(true);
    // Idempotent: running it again changes nothing.
    expect(forcePublishedFalse(out, "x.md")).toBe(out);
    // Already-false input is unchanged.
    const falseSrc = src.replace("published: true", "published: false");
    expect(forcePublishedFalse(falseSrc, "x.md")).toBe(falseSrc);
  });

  test("forcePublishedFalse appends a published line when absent", () => {
    const src = "---\ntitle: T\ntags: []\n---\nBODY\n";
    const out = forcePublishedFalse(src, "x.md");
    expect(readPublishedFlag(out)).toBe(false);
    expect(out).toContain("\npublished: false\n---\nBODY\n");
  });

  test("missing closing front-matter delimiter throws (loud, not junk)", () => {
    expect(() => forcePublishedFalse("---\nno close\n", "bad.md")).toThrow(
      /bad\.md is missing its closing front-matter delimiter/,
    );
    expect(() => sanitizeToBaseline("---\nno close\n", "bad.md", "b")).toThrow(
      /bad\.md is missing its closing front-matter delimiter/,
    );
  });

  test("sanitizeToBaseline forces false AND swaps body for baseline", () => {
    const src = "---\ntitle: T\npublished: true\n---\nstale marker e2e:run:123\n";
    const out = sanitizeToBaseline(src, "x.md", "CLEAN BASELINE BODY");
    expect(readPublishedFlag(out)).toBe(false);
    expect(out).toBe("---\ntitle: T\npublished: false\n---\nCLEAN BASELINE BODY");
    expect(out).not.toContain("stale marker");
  });

  test("DRY refactor is byte-identical to the old per-spec copies", () => {
    const samples = [
      "---\ntitle: T\npublished: true\ntags: []\n---\nbody\n",
      "---\ntitle: T\npublished: false\n---\nbody\n",
      "---\ntitle: T\n---\nno published line\n",
      '---\ntitle: T\npublished: "true"\n---\nquoted\n',
    ];
    for (const s of samples) {
      expect(forcePublishedFalse(s, "f.md")).toBe(legacyForcePublishedFalse(s, "f.md"));
      expect(sanitizeToBaseline(s, "f.md", "BASE")).toBe(
        legacySanitizeToBaseline(s, "f.md", "BASE"),
      );
    }
  });

  test("checked-in prod-loop fixtures are at baseline (published: false)", () => {
    const headRef = process.env.GITHUB_HEAD_REF || "";
    const eventName = process.env.GITHUB_EVENT_NAME || "";
    // The e2e `select` job (full history) emits the subset of
    // PROD_FIXTURES this PR's own diff touched; on push/schedule/local
    // it's empty and `eventName` isn't "pull_request", so the touch-set
    // is ignored and the assertion applies unconditionally (#1723 Cat 2).
    const touched = parseTouchedFixtures(process.env.E2E_PR_TOUCHED_PROD_FIXTURES);
    for (const rel of PROD_FIXTURES) {
      const abs = path.join(REPO_ROOT, rel);
      const text = fs.readFileSync(abs, "utf8");
      const flag = readPublishedFlag(text);

      // ALWAYS enforced, every branch/event: `published:` must parse as
      // a boolean. `null` is genuine front-matter corruption — a real
      // defect wherever it occurs (it is NOT the transient publish:true
      // a loop leaves, which still parses), so this guard is exempt from
      // the Cat-2 relaxation below.
      expect(
        flag,
        `${rel} 'published:' must be a parseable boolean (got null) — ` +
          `fix the fixture's front matter`,
      ).not.toBeNull();

      // Two relaxations of the strict baseline (see shouldEnforceBaseline):
      //  (a) the fixture's OWN Decap branch — a transient `published:
      //      true` is the expected in-flight state there: the prod-mutate
      //      / media-roundtrip round trip publishes on this branch and
      //      REQUIRES its PR to merge+deploy before it reverts (#1053
      //      deadlock fix 3dbade7 regressed exactly this; media run
      //      26114167560).
      //  (b) an UNRELATED pull_request (diff doesn't touch THIS fixture)
      //      — the merge-ref inherits main's transient canary state,
      //      which is not the PR's concern; enforcing here red-failed
      //      the required `e2e (1)` on innocent PRs and blocked #1715
      //      (#1723 Cat 2). A PR editing the canary keeps it in `touched`
      //      → still strictly checked.
      // #1053's real hazard (a persistent stuck-true on main, or a PR
      // that itself commits publish:true) stays guarded — see the
      // shouldEnforceBaseline doc-comment.
      if (
        !shouldEnforceBaseline(rel, {
          headRef,
          eventName,
          prTouchesFixture: touched.has(rel),
        })
      ) {
        continue;
      }

      expect(
        flag,
        `${rel} MUST be checked in 'published: false' — a 'published: true' here ` +
          `recreates the #1053 stuck fixed point (loop skips into a green check forever)`,
      ).toBe(false);
      // forcePublishedFalse on the real file must be a no-op (proves
      // the on-disk baseline already agrees with what the loop writes).
      expect(forcePublishedFalse(text, rel)).toBe(text);
    }
  });

  test("baseline assertion relaxes ONLY on a fixture's own Decap branch (#1053 deadlock fix)", () => {
    const MEDIA = "_posts/2099-01-03-e2e-media-roundtrip.md";
    const MUTATE = "_posts/2099-01-01-e2e-mutation-canary.md";

    // Branch construction matches the specs' DECAP_BRANCH constant.
    expect(ownDecapBranchFor(MEDIA)).toBe("cms/posts/2099-01-03-e2e-media-roundtrip");
    expect(ownDecapBranchFor(MUTATE)).toBe("cms/posts/2099-01-01-e2e-mutation-canary");

    // push / main / local dev (no PR head ref): strict assertion
    // APPLIES — this IS the #1053 main-protection, unchanged.
    for (const ref of ["", undefined]) {
      expect(baselineAssertionApplies(MEDIA, ref)).toBe(true);
      expect(baselineAssertionApplies(MUTATE, ref)).toBe(true);
    }

    // An unrelated feature / agent branch carrying published:true on a
    // prod fixture is STILL a defect — assertion APPLIES.
    for (const ref of ["claude/some-feature", "fix/whatever", "main"]) {
      expect(baselineAssertionApplies(MEDIA, ref)).toBe(true);
      expect(baselineAssertionApplies(MUTATE, ref)).toBe(true);
    }

    // The fixture's OWN Decap branch: assertion RELAXED so the loop's
    // transient publish PR can merge (the deadlock this fix removes).
    expect(baselineAssertionApplies(MEDIA, "cms/posts/2099-01-03-e2e-media-roundtrip")).toBe(false);
    expect(baselineAssertionApplies(MUTATE, "cms/posts/2099-01-01-e2e-mutation-canary")).toBe(
      false,
    );

    // Per-fixture PRECISION: one fixture's branch must NOT relax the
    // other fixture's assertion — a cross-fixture published:true is
    // still caught (a media-branch PR can't sneak the mutation canary
    // to published:true, and vice-versa).
    expect(baselineAssertionApplies(MUTATE, "cms/posts/2099-01-03-e2e-media-roundtrip")).toBe(true);
    expect(baselineAssertionApplies(MEDIA, "cms/posts/2099-01-01-e2e-mutation-canary")).toBe(true);
  });

  test("PROD_FIXTURES is the canonical shared list (matches the on-disk canaries)", () => {
    // Moving the list into ./fixture-baseline (so the select job can
    // read it) must not drop or rename a fixture — every entry must
    // exist on disk and parse a `published:` flag.
    expect(PROD_FIXTURES).toEqual([
      "_posts/2099-01-01-e2e-mutation-canary.md",
      "_posts/2099-01-03-e2e-media-roundtrip.md",
    ]);
    for (const rel of PROD_FIXTURES) {
      const text = fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");
      expect(
        readPublishedFlag(text),
        `${rel} must exist with a parseable published flag`,
      ).not.toBeNull();
    }
  });

  test("parseTouchedFixtures splits the select-job env list into a Set", () => {
    expect(parseTouchedFixtures(undefined)).toEqual(new Set());
    expect(parseTouchedFixtures("")).toEqual(new Set());
    expect(parseTouchedFixtures("   ")).toEqual(new Set());
    expect(parseTouchedFixtures("_posts/a.md")).toEqual(new Set(["_posts/a.md"]));
    // Space- and newline-separated, with stray whitespace, de-duped by Set.
    expect(parseTouchedFixtures("_posts/a.md   _posts/b.md\n_posts/a.md")).toEqual(
      new Set(["_posts/a.md", "_posts/b.md"]),
    );
  });

  test("shouldEnforceBaseline: #1723 Cat-2 relaxes only on an UNRELATED pull_request", () => {
    const MUTATE = "_posts/2099-01-01-e2e-mutation-canary.md";
    const MEDIA = "_posts/2099-01-03-e2e-media-roundtrip.md";

    // push / schedule / workflow_dispatch / local dev (event not
    // "pull_request"): ALWAYS enforce regardless of touch-set — this is
    // the #1053 main-protection, unchanged by Cat 2.
    for (const eventName of ["push", "schedule", "workflow_dispatch", ""]) {
      expect(shouldEnforceBaseline(MUTATE, { eventName, prTouchesFixture: false })).toBe(true);
      expect(shouldEnforceBaseline(MUTATE, { eventName, prTouchesFixture: true })).toBe(true);
    }

    // pull_request that DOES touch the fixture: still strictly enforced
    // (a PR can't introduce a stuck published:true on a canary).
    expect(
      shouldEnforceBaseline(MUTATE, { eventName: "pull_request", prTouchesFixture: true }),
    ).toBe(true);

    // pull_request that does NOT touch the fixture: RELAXED — main's
    // transient canary state is not this PR's concern (#1723 Cat 2,
    // which had blocked #1715). This is the whole fix.
    expect(
      shouldEnforceBaseline(MUTATE, { eventName: "pull_request", prTouchesFixture: false }),
    ).toBe(false);
    expect(
      shouldEnforceBaseline(MEDIA, { eventName: "pull_request", prTouchesFixture: false }),
    ).toBe(false);

    // Per-fixture precision: an UNRELATED-PR relaxation for MEDIA must
    // not relax MUTATE and vice-versa (the touch-set is per fixture).
    expect(
      shouldEnforceBaseline(MUTATE, { eventName: "pull_request", prTouchesFixture: true }),
    ).toBe(true);
    expect(
      shouldEnforceBaseline(MEDIA, { eventName: "pull_request", prTouchesFixture: false }),
    ).toBe(false);

    // The own-Decap-branch relaxation still composes: on the fixture's
    // own branch it's relaxed even if the touch-set says otherwise.
    expect(
      shouldEnforceBaseline(MUTATE, {
        headRef: "cms/posts/2099-01-01-e2e-mutation-canary",
        eventName: "pull_request",
        prTouchesFixture: true,
      }),
    ).toBe(false);

    // SAFE defaults: unknown event with default args ⇒ enforce; a
    // pull_request with an unknown touch-set (default true) ⇒ enforce.
    expect(shouldEnforceBaseline(MUTATE)).toBe(true);
    expect(shouldEnforceBaseline(MUTATE, { eventName: "pull_request" })).toBe(true);
  });

  test("isScheduledMustRun / loudBail: loud on schedule, fixme otherwise", () => {
    const orig = process.env.GITHUB_EVENT_NAME;
    try {
      for (const ev of ["schedule", "workflow_dispatch"]) {
        process.env.GITHUB_EVENT_NAME = ev;
        expect(isScheduledMustRun()).toBe(true);
        // loudBail must THROW (red) in a must-run context.
        let threw = false;
        try {
          loudBail({ fixme: () => {} }, "fixture missing");
        } catch (e) {
          threw = true;
          expect(e.message).toContain("#1053 loud-skip guard");
          expect(e.message).toContain("fixture missing");
        }
        expect(threw).toBe(true);
      }
      for (const ev of ["pull_request", "", "push"]) {
        process.env.GITHUB_EVENT_NAME = ev;
        expect(isScheduledMustRun()).toBe(false);
        // loudBail must call test.fixme(true, msg) and NOT throw.
        const calls = [];
        loudBail({ fixme: (c, m) => calls.push([c, m]) }, "no PAT");
        expect(calls).toEqual([[true, "no PAT"]]);
      }
    } finally {
      if (orig === undefined) delete process.env.GITHUB_EVENT_NAME;
      else process.env.GITHUB_EVENT_NAME = orig;
    }
  });
});
