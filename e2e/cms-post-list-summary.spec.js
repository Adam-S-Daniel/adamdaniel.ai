const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("./base");

// Locks the posts-collection list summary template across all three Decap
// configs. The summary is what editors see in the Posts list view — the
// at-a-glance label for each entry. Without this, an unpublished post is
// visually indistinguishable from a published one in the list, so an editor
// scanning for drafts has to open each entry to check the `published`
// toggle.
//
// The template is shared verbatim between admin/config.yml (production /
// editorial-workflow), admin/config-local.yml (decap-server local backend),
// and admin/config-test.yml (test-repo backend driven by Playwright).
// Drift between the three would mean the local + test runs render a
// different list label than production — the kind of subtle divergence
// that audit-style YAML invariants exist to catch.
//
// The two ternary clauses cover the two non-overlapping draft-shaped
// states:
//
//   1. `published: false` AND no `publish_date` → " — DRAFT"
//      (this unit's contribution; surfaces the unpublished state).
//   2. `publish_date` set (regardless of `published`)  → " — Scheduled"
//      (pre-existing; flags posts the scheduled-publish workflow will
//      flip on at a future date).
//
// `published: true` with no `publish_date` renders bare ("title (date)")
// — the steady-state published case.

const REPO_ROOT = path.join(__dirname, "..");
const CONFIGS = [
  path.join(REPO_ROOT, "admin/config.yml"),
  path.join(REPO_ROOT, "admin/config-local.yml"),
  path.join(REPO_ROOT, "admin/config-test.yml"),
];

const EXPECTED_SUMMARY =
  "    summary: \"{{title}} ({{date | date('MMM D, YYYY')}})" +
  "{{published | ternary('', ' — DRAFT')}}" +
  "{{publish_date | ternary(' — Scheduled', '')}}\"";

const DRAFT_CLAUSE = "{{published | ternary('', ' — DRAFT')}}";
const SCHEDULED_CLAUSE = "{{publish_date | ternary(' — Scheduled', '')}}";

function readConfig(file) {
  return fs.readFileSync(file, "utf8");
}

function findCollection(yml, name) {
  // Same chunking strategy as e2e/cms-config.spec.js — split on the
  // `  - name:` collection-separator lines and pick the chunk whose
  // first key matches.
  const lines = yml.split(/\r?\n/);
  const starts = [];
  lines.forEach((line, idx) => {
    if (/^\s{2}-\s+name:\s*\S+/.test(line)) starts.push(idx);
  });
  starts.push(lines.length);
  for (let i = 0; i < starts.length - 1; i++) {
    const chunk = lines.slice(starts[i], starts[i + 1]).join("\n");
    const m = chunk.match(/^\s{2}-\s+name:\s*(\S+)/);
    if (m && m[1] === name) return chunk;
  }
  return null;
}

function findSummaryLine(collectionChunk) {
  // The summary key sits at indent 4 inside a collection block. Return
  // the literal line so the assertion is on the exact bytes the spec is
  // locking — not a parsed/normalised form.
  const lines = collectionChunk.split(/\r?\n/);
  for (const line of lines) {
    if (/^\s{4}summary:/.test(line)) return line;
  }
  return null;
}

test.describe("Decap CMS posts-list summary template", () => {
  test.describe.configure({ mode: "serial" });

  for (const configPath of CONFIGS) {
    const label = path.relative(REPO_ROOT, configPath);

    test(`${label}: posts.summary line equals the locked template verbatim`, () => {
      const yml = readConfig(configPath);
      const posts = findCollection(yml, "posts");
      expect(posts, "posts collection must exist").not.toBeNull();
      const summary = findSummaryLine(posts);
      expect(
        summary,
        "posts collection must declare a summary template",
      ).not.toBeNull();
      // The literal template is shared across all three configs — drift
      // between them would mean the local / test runs render a different
      // list label than production.
      expect(summary).toBe(EXPECTED_SUMMARY);
    });

    test(`${label}: posts.summary surfaces both DRAFT and Scheduled states`, () => {
      const yml = readConfig(configPath);
      const posts = findCollection(yml, "posts");
      const summary = findSummaryLine(posts);
      // The DRAFT clause is the new contribution (D3) — `published: false`
      // appends " — DRAFT" so editors see the state at a glance in the
      // Posts list. The Scheduled clause was already there; locking both
      // together prevents a future edit from regressing one in passing
      // while landing the other.
      expect(summary).toContain(DRAFT_CLAUSE);
      expect(summary).toContain(SCHEDULED_CLAUSE);
    });
  }
});
