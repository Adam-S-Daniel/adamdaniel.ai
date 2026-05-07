// @lane: local — pure-fs invariants on _e2e canary collection wiring
const { test, expect } = require("./base");
const fs = require("node:fs");
const path = require("node:path");
const { CANARIES, readCanarySource } = require("./canary-content");

test.describe("Canary content invariants", () => {
  test.describe.configure({ mode: "serial" });

  test("every canary descriptor matches a checked-in source file", () => {
    for (const c of CANARIES) {
      const src = readCanarySource(c);
      // The baseline text MUST appear verbatim in the source body. The
      // cleanup step writes it back after each test run, so a drift
      // here means the canary doesn't reset to the same content the
      // descriptor claims.
      expect(src, `${c.path} body must contain the baseline string`).toContain(c.baseline);
      expect(src).toContain(`canary_id: ${c.id}`);
      expect(src).toContain(`permalink: ${c.publicPath}`);
      expect(src).toMatch(/^layout: canary$/m);
      expect(src).toMatch(/^robots: noindex,nofollow$/m);
      expect(src).toMatch(/^sitemap: false$/m);
    }
  });

  test("admin/config.yml exposes the e2e canary collection", () => {
    const cfg = fs.readFileSync(
      path.join(__dirname, "..", "admin", "config.yml"),
      "utf8",
    );
    // The publish-loop test drives admin actions on this collection.
    // If it disappears, the test goes silently green (no PR opened ≠
    // success) — fail loudly here.
    expect(cfg).toMatch(/^\s{2}- name: e2e\s*$/m);
    // Canaries are system fixtures; contributors must not be able to
    // create new ones through the admin UI (`create: false`).
    // `delete: true` IS required by `cms-delete-published.spec.js`,
    // which clicks the Decap UI's "Delete published entry" menuitem
    // — Decap renders that menuitem only when the collection allows
    // deletes. The "[E2E TEST FIXTURES — DO NOT EDIT]" collection
    // label is the convention-only guardrail against accidental
    // editor-driven deletion.
    expect(cfg).toMatch(/^\s{4}folder: _e2e\s*$/m);
    expect(cfg).toMatch(/^\s{4}create: false\s*$/m);
    expect(cfg).toMatch(/^\s{4}delete: true\s*$/m);
  });

  test("_config.yml registers the e2e collection with the right permalink", () => {
    const cfg = fs.readFileSync(path.join(__dirname, "..", "_config.yml"), "utf8");
    // Without `output: true` Jekyll won't render an HTML file; the
    // publish-loop's "assert it shows up at the public URL" step would
    // never satisfy.
    expect(cfg).toMatch(/^\s{2}e2e:/m);
    expect(cfg).toMatch(/output:\s*true/);
    expect(cfg).toMatch(/permalink:\s*\/e2e\/:slug\//);
    // Defaults must propagate the noindex + sitemap-exclude so an editor
    // who clones a canary doesn't accidentally publish it to search.
    expect(cfg).toMatch(/sitemap:\s*false/);
    expect(cfg).toMatch(/robots:\s*"noindex,nofollow"/);
  });
});
