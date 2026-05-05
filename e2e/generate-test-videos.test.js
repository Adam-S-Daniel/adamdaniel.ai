const { test, expect } = require("./base");
const path = require("node:path");
const {
  buildBannerLines,
  compareEntries,
  formatUTC,
} = require("./generate-test-videos");
const { safeTestId } = require("./base");

// Pure-function tests for the per-test video assembly script. No
// browser, no ffmpeg — just verify the helpers behave as documented.

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

  test("buildBannerLines includes file::title, PR, project, status", () => {
    const meta = {
      file: "blog-post.spec.js",
      title: "displays the post title exactly once",
      projectName: "chromium-desktop",
      repeatEachIndex: 0,
      status: "passed",
    };
    process.env.PR_NUMBER = "42";
    process.env.TIMESTAMP_UTC = "2026-05-05 12:00 UTC";
    // buildBannerLines reads PR_NUMBER / TIMESTAMP_UTC at module load,
    // so a fresh require is needed if env was changed mid-run. For
    // this test we just assert the static fields.
    const lines = buildBannerLines(meta, 1);
    expect(lines[0]).toContain("blog-post.spec.js");
    expect(lines[0]).toContain("displays the post title exactly once");
    expect(lines[2]).toContain("project: chromium-desktop");
    expect(lines[2]).toContain("status: passed");
    // No `repeat:` for the singleton case.
    expect(lines[2]).not.toContain("repeat:");
  });

  test("buildBannerLines appends repeat marker on collision", () => {
    const meta = {
      file: "flaky.spec.js",
      title: "occasionally fails",
      projectName: "chromium-desktop",
      repeatEachIndex: 1,
      status: "flaky",
    };
    const lines = buildBannerLines(meta, 2);
    expect(lines[2]).toContain("repeat: 1");
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
    expect(sorted.map((s) => s.meta.projectName + "#" + s.meta.repeatEachIndex)).toEqual([
      "chromium-desktop#0",
      "chromium-desktop#1",
      "firefox-desktop#0",
      "chromium-desktop#0",
    ]);
  });

  test("formatUTC drops sub-second precision and is stable", () => {
    const out = formatUTC(new Date("2026-05-05T18:30:42.123Z"));
    expect(out).toMatch(/^2026-05-05 18:30 UTC$/);
  });
});
