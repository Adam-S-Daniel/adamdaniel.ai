/*
 * Unit tests for the contributor-manual collator. Pure data — no browser.
 * Runs via `node --test` (Node ≥ 18) without extra deps.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildManual,
  groupBySection,
  parseSimpleYaml,
  sortSections,
  sortSteps,
} = require("./build-contributor-manual");

const sample = [
  {
    section: "Logging in",
    step: "1.2",
    title: "Click sign-in",
    body: "Click it.",
    screenshot: "docs/manual-screenshots/logging-in/1.2-click-sign-in.png",
    url: "https://preview-pr123.adamdaniel.ai/admin/#/collections/posts",
    spec: "e2e/cms-publish-loop.spec.js",
    test: "publish loop",
    project: "chromium-desktop-3k",
    capturedAt: "2026-04-29T00:00:00Z",
  },
  {
    section: "Logging in",
    step: "1.1",
    title: "Open admin",
    body: "Visit /admin/.",
    screenshot: "docs/manual-screenshots/logging-in/1.1-open-admin.png",
    url: "https://preview-pr123.adamdaniel.ai/admin/",
    spec: "e2e/cms-publish-loop.spec.js",
    test: "publish loop",
    project: "chromium-desktop-3k",
    capturedAt: "2026-04-29T00:00:00Z",
  },
  {
    section: "Editing",
    step: "2.1",
    title: "Pick the Posts collection",
    body: "",
    screenshot: "docs/manual-screenshots/editing/2.1-pick-posts.png",
    url: "https://preview-pr123.adamdaniel.ai/admin/#/collections/posts",
    spec: "e2e/cms-publish-loop.spec.js",
    test: "publish loop",
    project: "chromium-desktop-3k",
    capturedAt: "2026-04-29T00:00:00Z",
  },
];

test("groupBySection groups records by section", () => {
  const g = groupBySection(sample);
  assert.equal(g.size, 2);
  assert.equal(g.get("Logging in").length, 2);
  assert.equal(g.get("Editing").length, 1);
});

test("sortSteps sorts numerically across step ids", () => {
  const sorted = sortSteps(groupBySection(sample).get("Logging in"));
  assert.deepEqual(
    sorted.map((r) => r.step),
    ["1.1", "1.2"],
  );
});

test("sortSections honours section_order then alphabetises the rest", () => {
  const ordered = sortSections(
    ["Editing", "Logging in", "Cleanup"],
    ["Logging in"],
  );
  assert.deepEqual(ordered, ["Logging in", "Cleanup", "Editing"]);
});

test("buildManual emits sections in order and embeds screenshots", () => {
  const md = buildManual(sample, {
    section_order: ["Logging in", "Editing"],
    section_intros: {},
  });
  // Section ordering by header position
  const lp = md.indexOf("## Logging in");
  const ep = md.indexOf("## Editing");
  assert.ok(lp > 0 && ep > lp);
  // Step ordering inside section
  const s1 = md.indexOf("### 1.1. Open admin");
  const s2 = md.indexOf("### 1.2. Click sign-in");
  assert.ok(s1 > 0 && s2 > s1);
  // Embedded screenshot path is relative to docs/
  assert.ok(md.includes("manual-screenshots/logging-in/1.1-open-admin.png"));
  // Browser URL captured at screenshot time is shown beneath the image as a clickable link
  assert.ok(
    md.includes(
      "<sub>URL: [https://preview-pr123.adamdaniel.ai/admin/](https://preview-pr123.adamdaniel.ai/admin/)</sub>",
    ),
  );
  // Footer with spec + test reference
  assert.ok(md.includes("`e2e/cms-publish-loop.spec.js`"));
});

test("buildManual produces a placeholder when no records exist", () => {
  const md = buildManual([], { section_order: [], section_intros: {} });
  assert.ok(md.includes("# Contributor Manual"));
  assert.ok(md.includes("No captured steps yet"));
});

test("parseSimpleYaml extracts section_order and section_intros", () => {
  const yaml = `# manual-overrides.yml
section_order:
  - Logging in
  - Editing
section_intros:
  Logging in: |
    Visit /admin/ to open the editor.
    The login uses GitHub OAuth.
`;
  const out = parseSimpleYaml(yaml);
  assert.deepEqual(out.section_order, ["Logging in", "Editing"]);
  assert.match(out.section_intros["Logging in"], /Visit \/admin\//);
});
