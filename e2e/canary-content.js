/*
 * Canary fixture descriptors. The publish-loop tests use these to drive
 * admin-side edits and then assert the change appears at the public URL.
 *
 * Every entry has:
 *   - `id`             — matches the `canary_id:` front-matter, used as a
 *                        DOM attribute so tests don't need to grep markup
 *   - `slug`           — the URL slug; tests can derive both the CMS
 *                        navigation path and the public URL from this
 *   - `path`           — the source-file path under `_e2e/`
 *   - `cmsCollection`  — Decap collection name (`e2e`, since canaries live
 *                        in their own system collection)
 *   - `publicPath`     — root-relative URL the public site renders at
 *   - `baseline`       — the canonical body text the cleanup step writes
 *                        back so the URL always shows innocuous content
 *                        between runs
 *
 * The baseline strings here MUST stay in sync with the body text in the
 * checked-in `_e2e/canary-*.md` files. The unit test
 * `e2e/canary-content.test.js` enforces that drift is caught at CI time.
 */
const path = require("node:path");
const fs = require("node:fs");

const REPO_ROOT = path.resolve(__dirname, "..");

const CANARIES = [
  {
    id: "post",
    slug: "canary-post",
    path: "_e2e/canary-post.md",
    cmsCollection: "e2e",
    publicPath: "/e2e/canary-post/",
    baseline: "Adam Daniel — E2E canary post (do not edit by hand).",
  },
  {
    id: "page",
    slug: "canary-page",
    path: "_e2e/canary-page.md",
    cmsCollection: "e2e",
    publicPath: "/e2e/canary-page/",
    baseline: "Adam Daniel — E2E canary page (do not edit by hand).",
  },
  {
    id: "project",
    slug: "canary-project",
    path: "_e2e/canary-project.md",
    cmsCollection: "e2e",
    publicPath: "/e2e/canary-project/",
    baseline: "Adam Daniel — E2E canary project (do not edit by hand).",
  },
];

function findCanary(idOrSlug) {
  const c = CANARIES.find((x) => x.id === idOrSlug || x.slug === idOrSlug);
  if (!c) throw new Error(`Unknown canary: ${idOrSlug}`);
  return c;
}

function readCanarySource(canary) {
  return fs.readFileSync(path.join(REPO_ROOT, canary.path), "utf8");
}

function makeMarker(canaryId, runId = Date.now()) {
  return `e2e-publish-loop:${canaryId}:${runId}`;
}

module.exports = {
  CANARIES,
  REPO_ROOT,
  findCanary,
  makeMarker,
  readCanarySource,
};
