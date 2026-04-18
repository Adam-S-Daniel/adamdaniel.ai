const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { test, expect } = require("./base");

// Unit-ish test for scripts/patch-preview-config.sh: copies the real
// admin/config.yml into a temp dir, runs the script, and asserts the
// patched output has the four fields the preview deploy depends on.
// Catches regressions when admin/config.yml's layout changes.

const REPO_ROOT = path.join(__dirname, "..");
const SCRIPT = path.join(REPO_ROOT, "scripts/patch-preview-config.sh");
const CONFIG_SOURCE = path.join(REPO_ROOT, "admin/config.yml");

const PR_NUMBER = "9999";
const BRANCH = "feature/some-branch-name";
const HOST = "preview.example.test";

test.describe("Preview deploy: patch-preview-config.sh", () => {
  let tmpConfig;
  let patched;

  test.beforeAll(() => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "preview-config-"));
    tmpConfig = path.join(tmpDir, "config.yml");
    fs.copyFileSync(CONFIG_SOURCE, tmpConfig);
    execFileSync(SCRIPT, [tmpConfig, PR_NUMBER, BRANCH, HOST], {
      stdio: "pipe",
    });
    patched = fs.readFileSync(tmpConfig, "utf8");
  });

  test("site_url is set to the preview origin (no /pr-N path — Sveltia strips it)", () => {
    expect(patched).toMatch(/^site_url: https:\/\/preview\.example\.test$/m);
  });

  test("display_url is the full preview URL for Open Production Site", () => {
    expect(patched).toMatch(
      /^display_url: https:\/\/preview\.example\.test\/pr-9999$/m,
    );
  });

  test("backend.branch points at the PR head ref, not main", () => {
    expect(patched).toMatch(/^ {2}branch: feature\/some-branch-name$/m);
  });

  test("every preview_path is prefixed with /pr-N", () => {
    const previewPaths = [...patched.matchAll(/preview_path:\s*"?(\/[^"\s]+)/g)]
      .map((m) => m[1]);
    expect(previewPaths.length).toBeGreaterThan(0);
    for (const p of previewPaths) {
      expect(p).toMatch(new RegExp(`^/pr-${PR_NUMBER}/`));
    }
  });

  test("no path is double-prefixed even if the script ran twice", () => {
    // Running the script a second time must be a no-op for already-patched
    // paths — the sed rule matches `/` after `preview_path:`, so if we've
    // already prepended /pr-N the next `/` is a step further in.
    const twiceTmp = fs.mkdtempSync(path.join(os.tmpdir(), "preview-twice-"));
    const twice = path.join(twiceTmp, "config.yml");
    fs.copyFileSync(tmpConfig, twice);
    execFileSync(SCRIPT, [twice, PR_NUMBER, BRANCH, HOST], { stdio: "pipe" });
    const rePatched = fs.readFileSync(twice, "utf8");
    expect(rePatched).not.toMatch(
      new RegExp(`/pr-${PR_NUMBER}/pr-${PR_NUMBER}/`),
    );
  });
});
