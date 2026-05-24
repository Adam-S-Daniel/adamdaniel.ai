// @lane: local — pure-fs/logic invariants for the shared fixture-baseline helpers (#1053)
const { test, expect } = require("./base");
const fs = require("node:fs");
const path = require("node:path");
const {
  readPublishedFlag,
  forcePublishedFalse,
  sanitizeToBaseline,
  ownDecapBranchFor,
  baselineAssertionApplies,
  isScheduledMustRun,
  loudBail,
} = require("./fixture-baseline");

const REPO_ROOT = path.resolve(__dirname, "..");

// The real fixtures the prod loops operate on. These MUST be checked
// in `published: false` after #1053's unstick; the assertion below is
// the regression guard that keeps them that way (a future commit that
// flips one back to `published: true` re-creates the stuck fixed
// point this whole change exists to kill).
const PROD_FIXTURES = [
  "_posts/2099-01-01-e2e-mutation-canary.md",
  "_posts/2099-01-03-e2e-media-roundtrip.md",
];

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
    for (const rel of PROD_FIXTURES) {
      const abs = path.join(REPO_ROOT, rel);
      const text = fs.readFileSync(abs, "utf8");
      const flag = readPublishedFlag(text);

      // ALWAYS enforced, every branch: `published:` must parse as a
      // boolean. `null` is genuine front-matter corruption — a real
      // defect wherever it occurs, including the loop's own branch.
      expect(
        flag,
        `${rel} 'published:' must be a parseable boolean (got null) — ` +
          `fix the fixture's front matter`,
      ).not.toBeNull();

      // On the loop's OWN Decap branch for THIS fixture, a transient
      // `published: true` is the expected in-flight state: the
      // prod-mutate / media-roundtrip round trip publishes here and
      // REQUIRES this PR to merge+deploy before it reverts (spec
      // step 9 + afterAll + step-0b force baseline). Failing this
      // required check there deadlocks the very PR the spec waits on
      // — the #1053 force-baseline change (3dbade7) regressed exactly
      // this (scheduled media run 26114167560). #1053's real hazard
      // is `published: true` PERSISTING on main, still guarded by the
      // push/main run of this same test + the spec's initialPublished
      // loudBail + the force-baseline. Relax ONLY here, per fixture.
      if (!baselineAssertionApplies(rel, headRef)) continue;

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
