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

  test("single post change → posts-related specs only", () => {
    const r = selectSpecs(["_posts/2026-04-25-something.md"]);
    expect(r.scope).toBe("subset");
    expect(r.files).toContain("e2e/cms-smoke.spec.js");
    expect(r.files).toContain("e2e/cms-editorial-workflow.spec.js");
    expect(r.files).toContain("e2e/blog-post.spec.js");
    expect(r.files).toContain("e2e/visual-regression.spec.js");
    // CMS preview-url is post-specific
    expect(r.files).toContain("e2e/cms-preview-url.spec.js");
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
    expect(r.files).toContain("e2e/cms-smoke.spec.js");
    expect(r.files).toContain("e2e/cms-editorial-workflow.spec.js");
    expect(r.files).toContain("e2e/cms-config.spec.js");
    expect(r.files).toContain("e2e/cms-preview-url.spec.js");
    // Layouts aren't touched, so no fanout to e.g. CloudFront specs.
    expect(r.files).not.toContain("e2e/cloudfront-preview-router.spec.js");
  });

  test("admin/config-test.yml change → editorial workflow + config specs", () => {
    const r = selectSpecs(["admin/config-test.yml"]);
    expect(r.scope).toBe("subset");
    expect(r.files).toContain("e2e/cms-editorial-workflow.spec.js");
    expect(r.files).toContain("e2e/cms-config.spec.js");
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

  test("mixed: tag + post change → CMS smoke + blog/tags page specs", () => {
    const r = selectSpecs([
      "_tags/python.md",
      "_posts/2026-01-01-hi.md",
    ]);
    expect(r.scope).toBe("subset");
    expect(r.files).toContain("e2e/cms-smoke.spec.js");
    expect(r.files).toContain("e2e/blog-post.spec.js");
    expect(r.files).toContain("e2e/tags.spec.js");
  });

  test("disableSkip: docs change still runs baseline rather than skip", () => {
    const r = selectSpecs(["README.md"], { disableSkip: true });
    expect(r.scope).toBe("subset");
    // Baseline only — none of the CRUD specs.
    expect(r.files).toEqual(ALWAYS_RUN.slice().sort());
  });

  test("non-doc change that matches no SPEC_RULES collapses to skip", () => {
    // The skills-mirror unification PR's signature: lots of files
    // touched (tests/, scripts/, .githooks/, .claude/, _plugins_test/)
    // but none match any spec rule or fanout pattern. Without the
    // collapse this returns subset = ALWAYS_RUN, which is identical to
    // scope=skip but pays for a full 4-way matrix.
    const r = selectSpecs([
      "tests/test_bootstrap.py",
      "scripts/bootstrap.sh",
      ".githooks/pre-commit",
      "pyproject.toml",
    ]);
    expect(r.scope).toBe("skip");
  });

  test("disableSkip: baseline-only collapse is also bypassed", () => {
    const r = selectSpecs(["tests/test_bootstrap.py"], { disableSkip: true });
    expect(r.scope).toBe("subset");
    expect(r.files).toEqual(ALWAYS_RUN.slice().sort());
  });

  test("canary collection edit → canary invariants + publish-loop specs", () => {
    const r = selectSpecs(["_e2e/canary-post.md"]);
    expect(r.scope).toBe("subset");
    expect(r.files).toContain("e2e/canary-content.test.js");
    expect(r.files).toContain("e2e/cms-publish-loop.spec.js");
    expect(r.files).toContain("e2e/cms-publish-loop-preview.spec.js");
  });

  test("canary layout change → canary invariants run", () => {
    const r = selectSpecs(["_layouts/canary.html"]);
    // _layouts/* is a fanout pattern, so we expect scope=all here.
    expect(r.scope).toBe("all");
  });

  test("github-actions-poll helper change → publish-loop specs", () => {
    const r = selectSpecs(["e2e/github-actions-poll.js"]);
    expect(r.scope).toBe("subset");
    expect(r.files).toContain("e2e/cms-publish-loop.spec.js");
    expect(r.files).toContain("e2e/cms-publish-loop-preview.spec.js");
  });

  test("decap-pat helper change → publish-loop specs", () => {
    const r = selectSpecs(["e2e/decap-pat.js"]);
    expect(r.scope).toBe("subset");
    expect(r.files).toContain("e2e/cms-publish-loop.spec.js");
    expect(r.files).toContain("e2e/cms-publish-loop-preview.spec.js");
  });
});
