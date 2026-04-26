const { test, expect } = require("./base");
const { selectSpecs, ALWAYS_RUN } = require("./select-specs");

// Pure-function unit tests for the e2e spec selector. No browser, no
// git — just verify each rule fires correctly.

test.describe("select-specs", () => {
  test("empty changeset → skip with baseline", () => {
    const r = selectSpecs([]);
    expect(r.scope).toBe("skip");
  });

  test("only docs → skip with baseline", () => {
    const r = selectSpecs([
      "README.md",
      "AGENTS.md",
      "docs/CONTENT_GUIDE.md",
    ]);
    expect(r.scope).toBe("skip");
  });

  test("layout change → fanout to all specs", () => {
    const r = selectSpecs(["_layouts/post.html"]);
    expect(r.scope).toBe("all");
  });

  test("_config.yml change → fanout", () => {
    const r = selectSpecs(["_config.yml"]);
    expect(r.scope).toBe("all");
  });

  test("CSS change → fanout (visual regression covers it)", () => {
    const r = selectSpecs(["assets/css/main.css"]);
    expect(r.scope).toBe("all");
  });

  test("test helper change → fanout (cms-test-helpers.js touches all CMS specs)", () => {
    const r = selectSpecs(["e2e/cms-test-helpers.js"]);
    expect(r.scope).toBe("all");
  });

  test("single post change → posts-related specs only", () => {
    const r = selectSpecs(["_posts/2026-04-25-something.md"]);
    expect(r.scope).toBe("subset");
    expect(r.files).toContain("e2e/admin-cms.spec.js");
    expect(r.files).toContain("e2e/cms-posts-crud.spec.js");
    expect(r.files).toContain("e2e/blog-post.spec.js");
    expect(r.files).toContain("e2e/visual-regression.spec.js");
    // CMS preview-url is post-specific
    expect(r.files).toContain("e2e/cms-preview-url.spec.js");
    // Tags / projects / pages CRUD aren't relevant
    expect(r.files).not.toContain("e2e/cms-tags-crud.spec.js");
    expect(r.files).not.toContain("e2e/cms-projects-crud.spec.js");
    expect(r.files).not.toContain("e2e/cms-pages-crud.spec.js");
    // Infrastructure isn't relevant
    expect(r.files).not.toContain("e2e/cloudfront-preview-router.spec.js");
    // Always-run baseline included
    for (const a of ALWAYS_RUN) expect(r.files).toContain(a);
  });

  test("admin/reviews change → reviews specs only", () => {
    const r = selectSpecs(["admin/reviews/index.html"]);
    expect(r.scope).toBe("subset");
    expect(r.files).toContain("e2e/admin-reviews-auth.spec.js");
    expect(r.files).toContain("e2e/admin-reviews-stats.spec.js");
    expect(r.files).not.toContain("e2e/blog-post.spec.js");
    expect(r.files).not.toContain("e2e/cloudfront-preview-router.spec.js");
  });

  test("oauth-proxy change → reviews-auth spec runs (proxy is the popup)", () => {
    const r = selectSpecs(["oauth-proxy/lambda.py"]);
    expect(r.scope).toBe("subset");
    expect(r.files).toContain("e2e/admin-reviews-auth.spec.js");
  });

  test("admin/config.yml change → CMS specs only", () => {
    const r = selectSpecs(["admin/config.yml"]);
    expect(r.scope).toBe("subset");
    expect(r.files).toContain("e2e/admin-cms.spec.js");
    expect(r.files).toContain("e2e/cms-config.spec.js");
    expect(r.files).toContain("e2e/cms-posts-crud.spec.js");
    expect(r.files).toContain("e2e/cms-tags-crud.spec.js");
    expect(r.files).toContain("e2e/cms-projects-crud.spec.js");
    expect(r.files).toContain("e2e/cms-pages-crud.spec.js");
    // Layouts aren't touched, so no fanout to e.g. CloudFront specs.
    expect(r.files).not.toContain("e2e/cloudfront-preview-router.spec.js");
  });

  test("infrastructure change → cloudfront specs only", () => {
    const r = selectSpecs([
      "infrastructure/bootstrap/template.yaml",
    ]);
    expect(r.scope).toBe("subset");
    expect(r.files).toContain("e2e/cloudfront-preview-router.spec.js");
    expect(r.files).toContain(
      "e2e/cloudfront-preview-location-fixer.spec.js",
    );
    expect(r.files).not.toContain("e2e/admin-cms.spec.js");
  });

  test("a spec file's own change → that spec runs", () => {
    const r = selectSpecs(["e2e/glow-banding.spec.js"]);
    expect(r.scope).toBe("subset");
    expect(r.files).toContain("e2e/glow-banding.spec.js");
  });

  test("compute-visual-diffs JS change → diff-related specs run", () => {
    const r = selectSpecs(["e2e/compute-visual-diffs.js"]);
    expect(r.scope).toBe("subset");
    expect(r.files).toContain("e2e/compute-visual-diffs.test.js");
    expect(r.files).toContain("e2e/admin-reviews-stats.spec.js");
  });

  test("plugin change → fanout (plugins affect rendered output)", () => {
    const r = selectSpecs(["_plugins/auto_tag_pages.rb"]);
    expect(r.scope).toBe("all");
  });

  test("mixed: tag + post change → both groups", () => {
    const r = selectSpecs([
      "_tags/python.md",
      "_posts/2026-01-01-hi.md",
    ]);
    expect(r.scope).toBe("subset");
    expect(r.files).toContain("e2e/cms-tags-crud.spec.js");
    expect(r.files).toContain("e2e/cms-posts-crud.spec.js");
  });

  test("disableSkip: docs change still runs baseline rather than skip", () => {
    const r = selectSpecs(["README.md"], { disableSkip: true });
    expect(r.scope).toBe("subset");
    // Baseline only — none of the CRUD specs.
    expect(r.files).toEqual(ALWAYS_RUN.slice().sort());
  });
});
