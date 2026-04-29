const { test, expect } = require("./base");
const {
  classifyPages,
  mapFileToUrls,
} = require("./detect-changed-pages");

// Pure-function unit tests for the page-change classifier. No browser,
// no git — just verify each rule fires correctly.
//
// These exist specifically to catch the false-negative class of bug
// where the classifier returns "nothing changed" even when something
// did. A previous version of detect-changed-pages.js silently swallowed
// a `git diff` failure and fell through to an empty changeset, which
// made the visual-regression workflow report
// `potentiallyAffected: 0` on every PR regardless of the diff. Fanout
// inputs (layouts/includes/css/_config.yml) are exercised here so a
// future regression that breaks the classifier — or anything that
// silently feeds it an empty list — fails loudly.

const ALL_PAGES = new Set([
  "/",
  "/admin/",
  "/admin/reviews/",
  "/blog/",
  "/blog/hello-world/",
  "/projects/example/",
  "/tags/python/",
]);

test.describe("classifyPages", () => {
  test("empty changeset → everything unchanged", () => {
    const r = classifyPages({ allPages: ALL_PAGES, changedFiles: [] });
    expect(r.changed).toEqual([]);
    expect(r.new).toEqual([]);
    expect(r.unchanged.sort()).toEqual([...ALL_PAGES].sort());
  });

  // ── Fanout inputs: every page must move into `changed`.
  // These are the regression-bait cases — if the classifier ever silently
  // returns "nothing changed" for a layout edit, this fails.
  for (const fanoutFile of [
    "_layouts/post.html",
    "_includes/header.html",
    "_config.yml",
    "assets/css/main.css",
  ]) {
    test(`fanout: ${fanoutFile} → all pages changed`, () => {
      const r = classifyPages({
        allPages: ALL_PAGES,
        changedFiles: [fanoutFile],
      });
      expect(r.changed.sort()).toEqual([...ALL_PAGES].sort());
      expect(r.unchanged).toEqual([]);
      expect(r.new).toEqual([]);
    });
  }

  test("post change → only the matching blog page is in changed", () => {
    const r = classifyPages({
      allPages: ALL_PAGES,
      changedFiles: ["_posts/2026-01-01-hello-world.md"],
    });
    expect(r.changed).toEqual(["/blog/hello-world/"]);
    expect(r.new).toEqual([]);
    expect(r.unchanged).toContain("/");
    expect(r.unchanged).toContain("/admin/");
  });

  test("admin shell change → /admin/ and /admin/reviews/ are in changed", () => {
    const r = classifyPages({
      allPages: ALL_PAGES,
      changedFiles: ["admin/index.html"],
    });
    expect(r.changed.sort()).toEqual(["/admin/", "/admin/reviews/"]);
    expect(r.unchanged).toContain("/");
  });

  test("project change → only the matching project page is in changed", () => {
    const r = classifyPages({
      allPages: ALL_PAGES,
      changedFiles: ["_projects/example.md"],
    });
    expect(r.changed).toEqual(["/projects/example/"]);
  });

  test("unmapped file (e.g. README.md) → nothing changes", () => {
    const r = classifyPages({
      allPages: ALL_PAGES,
      changedFiles: ["README.md"],
    });
    expect(r.changed).toEqual([]);
    expect(r.new).toEqual([]);
  });

  test("new file (not on main) → goes to `new`, not `changed`", () => {
    const r = classifyPages({
      allPages: new Set([...ALL_PAGES, "/blog/brand-new/"]),
      changedFiles: ["_posts/2026-04-29-brand-new.md"],
      // Stub: this file is NOT on main yet.
      fileExistsOnMain: () => false,
    });
    expect(r.new).toEqual(["/blog/brand-new/"]);
    expect(r.changed).toEqual([]);
  });

  test("fanout + post → fanout wins, every page is in changed", () => {
    const r = classifyPages({
      allPages: ALL_PAGES,
      changedFiles: [
        "_layouts/default.html",
        "_posts/2026-01-01-hello-world.md",
      ],
    });
    expect(r.changed.sort()).toEqual([...ALL_PAGES].sort());
    expect(r.unchanged).toEqual([]);
  });
});

test.describe("mapFileToUrls", () => {
  test("post → /blog/<slug>/", () => {
    expect(mapFileToUrls("_posts/2026-01-01-hello.md")).toEqual([
      "/blog/hello/",
    ]);
  });

  test("project → /projects/<slug>/", () => {
    expect(mapFileToUrls("_projects/foo.md")).toEqual(["/projects/foo/"]);
  });

  test("tag → /tags/<slug>/", () => {
    expect(mapFileToUrls("_tags/python.md")).toEqual(["/tags/python/"]);
  });

  test("admin/ → /admin/ + /admin/reviews/", () => {
    expect(mapFileToUrls("admin/config.yml").sort()).toEqual([
      "/admin/",
      "/admin/reviews/",
    ]);
  });

  test("layout/include/css/_config → __ALL__", () => {
    expect(mapFileToUrls("_layouts/post.html")).toEqual(["__ALL__"]);
    expect(mapFileToUrls("_includes/footer.html")).toEqual(["__ALL__"]);
    expect(mapFileToUrls("assets/css/main.css")).toEqual(["__ALL__"]);
    expect(mapFileToUrls("_config.yml")).toEqual(["__ALL__"]);
  });

  test("unrelated file → []", () => {
    expect(mapFileToUrls("README.md")).toEqual([]);
    expect(mapFileToUrls("Gemfile.lock")).toEqual([]);
    expect(mapFileToUrls("package.json")).toEqual([]);
  });
});
