// @lane: real — read-only probe of the deployed preview surface
// @select-skip-when-head-ref-prefix: cms/
//
// Lightweight companion to the heavy cms-media-roundtrip loop. Where
// that spec drives the full Decap upload → publish → delete cycle
// (slow, dispatch/nightly, NON-required), THIS spec is the fast,
// read-only merge gate: it asserts that a committed image under the
// flat `media_folder` (assets/images/uploads/) actually RESOLVES on
// the PR's already-deployed preview-pr<N>.adamdaniel.ai surface —
// i.e. the exact regression class fixed in PR #952 (flattened
// media_folder / broken image + Copy Path), verified on the real
// S3+CloudFront preview build rather than only structurally
// (cms-config.spec.js) or against a local Jekyll build.
//
// No CMS, no PAT, no mutation — a single HTTP GET. Self-skips when no
// preview env is resolvable (no PR number), so it is safe to select
// anywhere; the dedicated preview-media.yml workflow supplies
// PR_NUMBER and is what turns this into a stable, required check.
// `@select-skip-when-head-ref-prefix: cms/` keeps it out of
// Decap-opened editorial PRs (consistent with its heavy siblings).

const { test, expect } = require("./base");
const { previewTarget } = require("./cms-host");

// 1×1 PNG committed at the flat media_folder path, so it ships with
// every Jekyll build (and therefore every preview deploy). If the
// flat media_folder regresses (a templated subfolder creeps back, or
// the CloudFront/S3 preview routing drops the prefix), this exact URL
// 404s on the deployed surface and the gate fails.
const PROBE_PATH = "/assets/images/uploads/e2e-preview-media-probe.png";

const target = previewTarget();
const PROBE_URL = target.host ? `${target.host}${PROBE_PATH}` : "";

test.describe("preview media resolves on the deployed surface", () => {
  test.skip(
    !target.host,
    "No preview-pr<N> host resolvable (PR_NUMBER/GITHUB_PR_NUMBER unset) — " +
      "this gate is a no-op outside the dedicated preview-media.yml workflow.",
  );

  test("committed media_folder image returns 200 on the preview env", async ({
    page,
  }) => {
    const res = await page.request.get(PROBE_URL, { failOnStatusCode: false });

    expect(
      res.status(),
      `${PROBE_URL} must serve HTTP 200 on the deployed preview. A 4xx/5xx ` +
        `here means the flat media_folder path (assets/images/uploads/) is ` +
        `broken on the real S3/CloudFront preview build — the PR #952 ` +
        `regression class (broken images / Copy Path) reaching the deployed ` +
        `surface, which local-only tests cannot catch.`,
    ).toBe(200);

    const contentType = res.headers()["content-type"] || "";
    expect(
      contentType,
      `${PROBE_URL} resolved but with a non-image content-type ` +
        `(${contentType || "<none>"}) — likely an SPA/404 HTML fallback ` +
        `being served in place of the asset.`,
    ).toMatch(/^image\//i);

    const body = await res.body();
    expect(
      body.length,
      `${PROBE_URL} served a 200 with an empty body.`,
    ).toBeGreaterThan(0);
  });
});
