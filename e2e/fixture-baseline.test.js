// @lane: local — pure-fs/logic invariants for the shared fixture-baseline helpers (#1053)
const { test, expect } = require("./base");
const fs = require("node:fs");
const path = require("node:path");
const {
  readPublishedFlag,
  forcePublishedFalse,
  sanitizeToBaseline,
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
    throw new Error(
      `Fixture ${FIXTURE_PATH} is missing its closing front-matter delimiter.`,
    );
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
    throw new Error(
      `Fixture ${FIXTURE_PATH} is missing its closing front-matter delimiter.`,
    );
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
    const src =
      "---\ntitle: T\npublished: true\ntags: []\n---\nBODY line 1\nBODY 2\n";
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
    const src =
      "---\ntitle: T\npublished: true\n---\nstale marker e2e:run:123\n";
    const out = sanitizeToBaseline(src, "x.md", "CLEAN BASELINE BODY");
    expect(readPublishedFlag(out)).toBe(false);
    expect(out).toBe(
      "---\ntitle: T\npublished: false\n---\nCLEAN BASELINE BODY",
    );
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
      expect(forcePublishedFalse(s, "f.md")).toBe(
        legacyForcePublishedFalse(s, "f.md"),
      );
      expect(sanitizeToBaseline(s, "f.md", "BASE")).toBe(
        legacySanitizeToBaseline(s, "f.md", "BASE"),
      );
    }
  });

  test("checked-in prod-loop fixtures are at baseline (published: false)", () => {
    for (const rel of PROD_FIXTURES) {
      const abs = path.join(REPO_ROOT, rel);
      const text = fs.readFileSync(abs, "utf8");
      expect(
        readPublishedFlag(text),
        `${rel} MUST be checked in 'published: false' — a 'published: true' here ` +
          `recreates the #1053 stuck fixed point (loop skips into a green check forever)`,
      ).toBe(false);
      // forcePublishedFalse on the real file must be a no-op (proves
      // the on-disk baseline already agrees with what the loop writes).
      expect(forcePublishedFalse(text, rel)).toBe(text);
    }
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
