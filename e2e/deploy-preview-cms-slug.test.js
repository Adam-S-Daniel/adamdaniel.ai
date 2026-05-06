const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("./base");

// Locks in the per-CMS-slug preview alias structure of
// .github/workflows/deploy-preview.yml — added per the spike at
// docs/preview-pr-ruleset-spike.md. The structural invariant is:
//
//   1. Both `deploy-preview` and `teardown-preview` derive `cms_slug`
//      from `head_ref` using the SAME sed expression (otherwise a
//      cleanup mismatch would orphan S3 files when the slug shape
//      drifts).
//   2. The deploy job syncs the alias prefix `cms-<slug>/` and registers
//      a `preview-cms-<slug>` GitHub Deployment.
//   3. The teardown job removes the alias prefix.
//   4. The CloudFront invalidation step lists both prefixes when the
//      branch is a `cms/<col>/<slug>` branch.
//   5. The PR-comment step surfaces the slug-derived URL as an
//      additional row when applicable.
//
// All structural invariants are pure-text greps against the workflow
// file — same approach as visual-regression-skip-review.test.js.

const WORKFLOW = path.join(
  __dirname,
  "..",
  ".github",
  "workflows",
  "deploy-preview.yml",
);

// Canonical slug-derivation sed expression. Both deploy-preview and
// teardown-preview must use this exact form so they agree on what
// `cms-<slug>/` prefix needs cleanup at PR-close.
const SLUG_SED = "'s|^cms/||; s|/|-|g'";

function readWorkflow() {
  return fs.readFileSync(WORKFLOW, "utf8");
}

test.describe("deploy-preview workflow: per-CMS-slug preview alias", () => {
  test("both jobs derive cms_slug with the same sed expression", () => {
    const yml = readWorkflow();
    // Count occurrences of the canonical sed expression. Should be
    // exactly two: one in deploy-preview, one in teardown-preview.
    const escaped = SLUG_SED.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const matches = yml.match(new RegExp(escaped, "g")) || [];
    expect(
      matches.length,
      `expected exactly two slug-sed expressions (deploy + teardown); found ${matches.length}`,
    ).toBe(2);
  });

  test("both jobs gate on `BRANCH == cms/*`", () => {
    const yml = readWorkflow();
    // The bash test for `cms/*` should appear in both jobs. Allow any
    // amount of whitespace and either single or double quotes around
    // `cms/*` to accommodate future refactors that don't change the
    // semantics.
    const matches = yml.match(/\[\[\s*"\$BRANCH"\s*==\s*cms\/\*\s*\]\]/g) || [];
    expect(matches.length, "expected `[[ \"$BRANCH\" == cms/* ]]` in both deploy + teardown").toBe(2);
  });

  test("deploy syncs the cms-<slug> S3 prefix", () => {
    const yml = readWorkflow();
    expect(yml, "missing `s3://${PREVIEW_BUCKET}/cms-${SLUG}/` sync").toMatch(
      /s3:\/\/\$\{PREVIEW_BUCKET\}\/cms-\$\{?SLUG\}?\//,
    );
  });

  test("deploy gates the slug sync on `cms_slug.outputs.slug != ''`", () => {
    const yml = readWorkflow();
    // Without this gate, every regular code PR would attempt to sync
    // an empty `cms-/` prefix, which would either no-op-fail (best
    // case) or pollute the bucket (worst).
    expect(
      yml,
      "missing `if: steps.cms_slug.outputs.slug != ''` gate on the cms-slug sync",
    ).toMatch(
      /Sync to S3 — per-CMS-slug alias[\s\S]{0,400}if:\s*steps\.cms_slug\.outputs\.slug\s*!=\s*''/,
    );
  });

  test("deploy registers a `preview-cms-<slug>` GitHub Deployment", () => {
    const yml = readWorkflow();
    expect(
      yml,
      "missing `environment: \\`preview-cms-${slug}\\`` deployment registration",
    ).toMatch(
      /environment:\s*`preview-cms-\$\{slug\}`/,
    );
  });

  test("teardown removes the cms-<slug> S3 prefix", () => {
    const yml = readWorkflow();
    expect(yml, "missing `aws s3 rm s3://${PREVIEW_BUCKET}/cms-${SLUG}/`").toMatch(
      /aws s3 rm "?s3:\/\/\$\{PREVIEW_BUCKET\}\/cms-\$\{SLUG\}\/"?\s+--recursive/,
    );
  });

  test("invalidation step is gated to the cms-<slug> path conditionally", () => {
    const yml = readWorkflow();
    // Both deploy + teardown invalidation steps should add the
    // `/cms-${SLUG}/*` path only when SLUG is non-empty. Look for the
    // shared pattern.
    const matches = yml.match(
      /PATHS\+=\("\/cms-\$\{SLUG\}\/\*"\)/g,
    ) || [];
    expect(
      matches.length,
      "expected both deploy + teardown to conditionally add the cms-slug path to the invalidation batch",
    ).toBe(2);
  });

  test("PR-comment renders the cms-slug alias URL when applicable", () => {
    const yml = readWorkflow();
    // The comment-builder branches on `slug` and renders an extra
    // table row mentioning the alias URL.
    expect(
      yml,
      "PR comment is missing the cms-slug alias row — editors won't see the stable URL",
    ).toMatch(
      /CMS slug alias[\s\S]{0,200}stable across draft cycles/,
    );
  });
});

// ── Slug-derivation sanity (the bash logic, ported to JS for the test) ──
//
// `printf '%s' "cms/posts/foo-bar" | sed -E 's|^cms/||; s|/|-|g'`  → "posts-foo-bar"
// We re-implement the same transformation here to assert specific
// inputs produce the expected slugs. If the workflow's sed expression
// changes, this re-implementation needs to track it (and the
// `SLUG_SED` constant above keeps them locked).
function deriveSlug(branch) {
  // Strip leading `cms/` then replace `/` with `-`.
  const stripped = branch.replace(/^cms\//, "");
  return stripped.replace(/\//g, "-");
}

test.describe("deploy-preview workflow: slug-derivation cases", () => {
  test("posts/foo-bar → posts-foo-bar", () => {
    expect(deriveSlug("cms/posts/foo-bar")).toBe("posts-foo-bar");
  });

  test("date-prefixed post slug rounds-trips", () => {
    expect(deriveSlug("cms/posts/2099-01-01-foo-bar")).toBe(
      "posts-2099-01-01-foo-bar",
    );
  });

  test("pages/about → pages-about", () => {
    expect(deriveSlug("cms/pages/about")).toBe("pages-about");
  });

  test("non-cms branch flattens slashes too — but the workflow's `cms/*` gate prevents this from being reached in practice", () => {
    // Documents the raw transformation: the sed pipeline doesn't
    // discriminate; only the surrounding `[[ "$BRANCH" == cms/* ]]`
    // bash test gates whether the slug is ever produced.
    expect(deriveSlug("feat/some-feature")).toBe("feat-some-feature");
  });

  test("nested slug paths flatten to dashes", () => {
    expect(deriveSlug("cms/projects/category/item")).toBe(
      "projects-category-item",
    );
  });
});
