const { test, expect } = require("./base");
const path = require("node:path");
const {
  buildFrameBannerLines,
  compareEntries,
  formatEastern,
  frameStepLabel,
  sanitizeBannerText,
  BANNER_MAX_CHARS,
} = require("./generate-test-videos");
const { safeTestId } = require("./base");

// Pure-function tests for the per-test video assembly script. No
// browser, no ffmpeg / ImageMagick — just verify the helpers behave
// as documented.

test.describe("generate-test-videos helpers", () => {
  test("safeTestId stays filesystem-safe and bounded", () => {
    const fakeInfo = {
      file: "/abs/path/to/cms-publish-flow.spec.js",
      title: "publishes a draft / saves it (then approves)",
      project: { name: "chromium-desktop" },
      repeatEachIndex: 2,
    };
    const id = safeTestId(fakeInfo);
    expect(id.length).toBeLessThanOrEqual(180);
    // No path separators or shell-hostile characters.
    expect(id).not.toMatch(/[\\/:*?"<>|\s]/);
    // Uses the project, basename, title, and repeat index.
    expect(id).toContain("chromium-desktop");
    expect(id).toContain("cms-publish-flow.spec.js");
    expect(id).toContain("publishes-a-draft");
    expect(id).toContain("r2");
  });

  test("safeTestId tolerates emoji + unicode without producing forbidden bytes", () => {
    const id = safeTestId({
      file: "weird.spec.js",
      title: "passes ✓ on UTF-8 path/with*chars",
      project: { name: "firefox-desktop" },
      repeatEachIndex: 0,
    });
    expect(id).not.toMatch(/[\\/:*?"<>|]/);
  });

  test("compareEntries sorts by (file, title, project, repeat)", () => {
    const e1 = {
      meta: {
        file: "a.spec.js",
        title: "one",
        projectName: "chromium-desktop",
        repeatEachIndex: 0,
      },
    };
    const e2 = {
      meta: {
        file: "a.spec.js",
        title: "one",
        projectName: "firefox-desktop",
        repeatEachIndex: 0,
      },
    };
    const e3 = {
      meta: {
        file: "b.spec.js",
        title: "first",
        projectName: "chromium-desktop",
        repeatEachIndex: 0,
      },
    };
    const e4 = {
      meta: {
        file: "a.spec.js",
        title: "one",
        projectName: "chromium-desktop",
        repeatEachIndex: 1,
      },
    };
    const sorted = [e3, e2, e4, e1].sort(compareEntries);
    expect(
      sorted.map((s) => s.meta.projectName + "#" + s.meta.repeatEachIndex),
    ).toEqual([
      "chromium-desktop#0",
      "chromium-desktop#1",
      "firefox-desktop#0",
      "chromium-desktop#0",
    ]);
  });

  test("formatEastern renders YYYY-MM-DD HH:MM:SS with EDT in summer", () => {
    // 2026-05-05T18:30:00Z → 14:30:00 in America/New_York (EDT, UTC-4).
    const out = formatEastern(new Date("2026-05-05T18:30:00Z"));
    expect(out).toMatch(/^2026-05-05 14:30:00 EDT$/);
  });

  test("formatEastern renders EST in winter", () => {
    // 2026-01-15T18:00:00Z → 13:00:00 in America/New_York (EST, UTC-5).
    const out = formatEastern(new Date("2026-01-15T18:00:00Z"));
    expect(out).toMatch(/^2026-01-15 13:00:00 EST$/);
  });

  test("formatEastern handles invalid input gracefully", () => {
    expect(formatEastern(null)).toBe("unknown-time");
    expect(formatEastern(undefined)).toBe("unknown-time");
    expect(formatEastern(new Date("not-a-date"))).toBe("unknown-time");
  });

  test("frameStepLabel prefers stepTitle when present", () => {
    expect(
      frameStepLabel({
        stepTitle: "Reset canary baseline",
        url: "http://localhost:4000/admin/index-local.html",
      }),
    ).toBe("Reset canary baseline");
  });

  test("frameStepLabel falls back to URL pathname when no stepTitle", () => {
    // No `test.step()` was active for this frame, so the banner falls
    // back to the URL path captured by the framenavigated event.
    expect(
      frameStepLabel({
        url: "http://localhost:4000/admin/index-local.html#/collections/posts",
      }),
    ).toBe("/admin/index-local.html");
    expect(
      frameStepLabel({
        url: "https://example.com/page?q=1",
      }),
    ).toBe("/page?q=1");
  });

  test("frameStepLabel handles missing stepTitle and url", () => {
    expect(frameStepLabel(null)).toBe("(no navigation)");
    expect(frameStepLabel({})).toBe("(no navigation)");
    expect(frameStepLabel({ stepTitle: "" })).toBe("(no navigation)");
  });

  test("buildFrameBannerLines line 1 includes PR + Test X of Y + identity", () => {
    const lines = buildFrameBannerLines({
      prNumber: 143,
      testIndex: 2,
      testCount: 5,
      file: "blog-post.spec.js",
      title: "displays the post title exactly once",
      stepIndex: 1,
      stepCount: 1,
      stepLabel: "/blog/replacement-test-post-1/",
      status: "passed",
      projectName: "chromium-desktop",
      endTime: new Date("2026-05-05T18:30:00Z"),
    });
    expect(lines[0]).toBe(
      "PR #143 · Test 2 of 5 · blog-post.spec.js::displays the post title exactly once",
    );
    // Line ordering: PR comes first, then index, then identity.
    const i1 = lines[0].indexOf("PR #143");
    const i2 = lines[0].indexOf("Test 2 of 5");
    const i3 = lines[0].indexOf("blog-post.spec.js");
    expect(i1).toBeLessThan(i2);
    expect(i2).toBeLessThan(i3);
  });

  test("buildFrameBannerLines line 2 includes Step x of y, label, status (in that order)", () => {
    const lines = buildFrameBannerLines({
      prNumber: 143,
      testIndex: 1,
      testCount: 3,
      file: "f.spec.js",
      title: "t",
      stepIndex: 4,
      stepCount: 7,
      stepLabel: "Click the login button",
      status: "passed",
      projectName: "chromium-desktop",
      endTime: new Date("2026-05-05T18:30:00Z"),
    });
    expect(lines[1]).toBe(
      "Step 4 of 7: Click the login button · passed",
    );
    const i1 = lines[1].indexOf("Step 4 of 7");
    const i2 = lines[1].indexOf("Click the login button");
    const i3 = lines[1].indexOf("passed");
    expect(i1).toBeLessThan(i2);
    expect(i2).toBeLessThan(i3);
  });

  test("buildFrameBannerLines line 2 falls back to URL path when no step name", () => {
    // Use frameStepLabel directly to derive the label from a frame
    // record that has no stepTitle — the most common scenario for
    // tests that don't wrap their navs in test.step().
    const stepLabel = frameStepLabel({
      url: "http://localhost:4000/blog/replacement-test-post-1/",
    });
    const lines = buildFrameBannerLines({
      prNumber: 143,
      testIndex: 1,
      testCount: 1,
      file: "f.spec.js",
      title: "t",
      stepIndex: 1,
      stepCount: 1,
      stepLabel,
      status: "passed",
      projectName: "chromium-desktop",
      endTime: new Date("2026-05-05T18:30:00Z"),
    });
    expect(lines[1]).toBe(
      "Step 1 of 1: /blog/replacement-test-post-1/ · passed",
    );
  });

  test("buildFrameBannerLines line 3 reads `project: ... · <date+time TZ>` in America/New_York", () => {
    const summer = buildFrameBannerLines({
      prNumber: 143,
      testIndex: 1,
      testCount: 1,
      file: "f.spec.js",
      title: "t",
      stepIndex: 1,
      stepCount: 1,
      stepLabel: "/x",
      status: "passed",
      projectName: "chromium-desktop",
      endTime: new Date("2026-05-05T18:30:00Z"),
    });
    expect(summer[2]).toBe(
      "project: chromium-desktop · 2026-05-05 14:30:00 EDT",
    );
    const winter = buildFrameBannerLines({
      prNumber: 143,
      testIndex: 1,
      testCount: 1,
      file: "f.spec.js",
      title: "t",
      stepIndex: 1,
      stepCount: 1,
      stepLabel: "/x",
      status: "passed",
      projectName: "firefox-desktop",
      endTime: new Date("2026-01-15T18:00:00Z"),
    });
    expect(winter[2]).toBe(
      "project: firefox-desktop · 2026-01-15 13:00:00 EST",
    );
    // TZ abbrev must be present.
    expect(summer[2]).toMatch(/\bEDT\b/);
    expect(winter[2]).toMatch(/\bEST\b/);
  });

  test("buildFrameBannerLines uses each frame's own end-time, not a run-wide stamp", () => {
    // Two tests with different endTimes — the banner on each must
    // reflect that test's own completion stamp.
    const a = buildFrameBannerLines({
      prNumber: 143,
      testIndex: 1,
      testCount: 2,
      file: "a.spec.js",
      title: "first",
      stepIndex: 1,
      stepCount: 1,
      stepLabel: "/x",
      status: "passed",
      projectName: "chromium-desktop",
      endTime: new Date("2026-05-05T18:30:00Z"),
    });
    const b = buildFrameBannerLines({
      prNumber: 143,
      testIndex: 2,
      testCount: 2,
      file: "b.spec.js",
      title: "second",
      stepIndex: 1,
      stepCount: 1,
      stepLabel: "/y",
      status: "passed",
      projectName: "chromium-desktop",
      endTime: new Date("2026-05-05T19:45:42Z"),
    });
    expect(a[2]).toContain("14:30:00 EDT");
    expect(b[2]).toContain("15:45:42 EDT");
    // Confirm independence: these two reach two distinct stamps.
    expect(a[2]).not.toBe(b[2]);
  });

  test("buildFrameBannerLines: rendering 5 fake test directories assigns X = 1..5 and Y = 5", () => {
    // Simulate the assembly's outer loop: testIndex iterates 1..N,
    // testCount = N. Verify each fake test gets the right banner.
    const fakeMetas = [
      { file: "a.spec.js", title: "x", projectName: "chromium-desktop" },
      { file: "b.spec.js", title: "y", projectName: "chromium-desktop" },
      { file: "c.spec.js", title: "z", projectName: "chromium-desktop" },
      { file: "d.spec.js", title: "p", projectName: "firefox-desktop" },
      { file: "e.spec.js", title: "q", projectName: "webkit-desktop" },
    ];
    const lines = fakeMetas.map((m, i) =>
      buildFrameBannerLines({
        prNumber: 99,
        testIndex: i + 1,
        testCount: fakeMetas.length,
        file: m.file,
        title: m.title,
        stepIndex: 1,
        stepCount: 3,
        stepLabel: "/foo",
        status: "passed",
        projectName: m.projectName,
        endTime: new Date("2026-05-05T18:30:00Z"),
      }),
    );
    for (let i = 0; i < 5; i++) {
      expect(lines[i][0]).toContain(`Test ${i + 1} of 5`);
      expect(lines[i][0]).toContain(fakeMetas[i].file);
      expect(lines[i][2]).toContain(`project: ${fakeMetas[i].projectName}`);
    }
  });

  test("sanitizeBannerText strips control chars and squeezes whitespace", () => {
    expect(sanitizeBannerText("abc def")).toBe("abc def");
    expect(sanitizeBannerText("a   b\nc")).toBe("a b c");
    expect(sanitizeBannerText("  trim me  ")).toBe("trim me");
  });

  test("sanitizeBannerText truncates oversized strings", () => {
    const huge = "x".repeat(BANNER_MAX_CHARS + 50);
    const out = sanitizeBannerText(huge);
    expect(out.length).toBeLessThanOrEqual(BANNER_MAX_CHARS);
    expect(out.endsWith("…")).toBe(true);
  });

  test("buildFrameBannerLines truncates very long step names without overflowing", () => {
    const longStep = "a".repeat(500);
    const lines = buildFrameBannerLines({
      prNumber: 143,
      testIndex: 1,
      testCount: 1,
      file: "f.spec.js",
      title: "t",
      stepIndex: 1,
      stepCount: 1,
      stepLabel: longStep,
      status: "passed",
      projectName: "p",
      endTime: new Date("2026-05-05T18:30:00Z"),
    });
    // line 2 must not exceed the per-line cap.
    expect(lines[1].length).toBeLessThanOrEqual(BANNER_MAX_CHARS);
    expect(lines[1]).toMatch(/^Step 1 of 1: /);
  });
});
