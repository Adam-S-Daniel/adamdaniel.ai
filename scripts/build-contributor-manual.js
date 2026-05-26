#!/usr/bin/env node
/*
 * Collate captureStep records into docs/CONTRIBUTOR_MANUAL.md.
 *
 * Reads:
 *   manual-capture/*.json          — one file per (spec, test), array of step records
 *   docs/manual-overrides.yml      — optional: pre-section blurbs, custom ordering
 *
 * Writes:
 *   docs/CONTRIBUTOR_MANUAL.md     — human-readable markdown with embedded screenshots
 *
 * Section ordering: `docs/manual-overrides.yml` `section_order:` (array of section
 * names) is honoured first; any section not listed appears alphabetically after.
 *
 * Step ordering inside a section: lexicographic on the `step` string. Tests
 * should use a stable convention like "1.1", "1.2", "2.1" so the manual reads
 * top-to-bottom even when steps are written across multiple specs.
 */
const fs = require("node:fs");
const path = require("node:path");
const YAML = require("yaml");

const REPO_ROOT = path.resolve(__dirname, "..");
const CAPTURE_DIR = path.join(REPO_ROOT, "manual-capture");
const OUT_FILE = path.join(REPO_ROOT, "docs", "CONTRIBUTOR_MANUAL.md");
const OVERRIDES_FILE = path.join(REPO_ROOT, "docs", "manual-overrides.yml");

function readAllRecords() {
  if (!fs.existsSync(CAPTURE_DIR)) return [];
  const out = [];
  for (const name of fs.readdirSync(CAPTURE_DIR)) {
    if (!name.endsWith(".json")) continue;
    try {
      const records = JSON.parse(fs.readFileSync(path.join(CAPTURE_DIR, name), "utf8"));
      if (Array.isArray(records)) out.push(...records);
    } catch (_) {
      // skip — malformed files shouldn't break the doc build.
    }
  }
  return out;
}

function readOverrides() {
  if (!fs.existsSync(OVERRIDES_FILE)) return { section_order: [], section_intros: {} };
  try {
    return parseOverrides(fs.readFileSync(OVERRIDES_FILE, "utf8"));
  } catch (_) {
    return { section_order: [], section_intros: {} };
  }
}

/**
 * Parse docs/manual-overrides.yml into { section_order, section_intros }.
 * A real YAML parse (the `yaml` library) — block scalars, quoting, and
 * any future anchors are handled by the parser instead of the hand-rolled
 * line scanner this used to be. The shape is normalised so a malformed or
 * partial file still yields usable defaults.
 */
function parseOverrides(text) {
  const parsed = YAML.parse(text) || {};
  return {
    section_order: Array.isArray(parsed.section_order) ? parsed.section_order : [],
    section_intros:
      parsed.section_intros && typeof parsed.section_intros === "object"
        ? parsed.section_intros
        : {},
  };
}

function groupBySection(records) {
  const groups = new Map();
  for (const r of records) {
    if (!groups.has(r.section)) groups.set(r.section, []);
    groups.get(r.section).push(r);
  }
  return groups;
}

function sortSections(sectionNames, sectionOrder) {
  const ordered = [];
  const seen = new Set();
  for (const name of sectionOrder) {
    if (sectionNames.includes(name) && !seen.has(name)) {
      ordered.push(name);
      seen.add(name);
    }
  }
  for (const name of sectionNames.sort()) {
    if (!seen.has(name)) {
      ordered.push(name);
      seen.add(name);
    }
  }
  return ordered;
}

function sortSteps(records) {
  return [...records].sort((a, b) => {
    const cmp = String(a.step).localeCompare(String(b.step), undefined, {
      numeric: true,
    });
    if (cmp !== 0) return cmp;
    return String(a.title).localeCompare(String(b.title));
  });
}

function relPath(p) {
  // Resolve a path relative to docs/ so the manual links from inside docs/.
  return path.relative(path.dirname(OUT_FILE), path.join(REPO_ROOT, p)).split(path.sep).join("/");
}

function renderRecord(record) {
  const out = [];
  out.push(`### ${record.step}. ${record.title}`);
  out.push("");
  if (record.body && record.body.trim()) {
    out.push(record.body.trim());
    out.push("");
  }
  if (record.screenshot) {
    out.push(`![${record.title}](${relPath(record.screenshot)})`);
    out.push("");
  }
  if (record.url) {
    out.push(`<sub>URL: [${record.url}](${record.url})</sub>`);
    out.push("");
  }
  out.push(
    `<sub>Captured by \`${record.spec}\` → _${record.test}_ on \`${record.project}\` at ${record.capturedAt}.</sub>`,
  );
  out.push("");
  return out.join("\n");
}

function buildManual(records, overrides) {
  const groups = groupBySection(records);
  const sectionNames = sortSections([...groups.keys()], overrides.section_order || []);

  const intro = [
    "# Contributor Manual",
    "",
    "This manual is **assembled by the test suite**: every screenshot and step description below was captured during a real Playwright e2e run, so the document is always in sync with the actual contributor flow.",
    "",
    "If a step looks wrong, the test that captured it is wrong too. The fix is in the test file shown under each screenshot — open it, update the `captureStep(...)` call, push, and the manual regenerates on the next run of `.github/workflows/regenerate-manual.yml`.",
    "",
    "_Last regenerated: " + new Date().toISOString() + "_",
    "",
    "---",
    "",
    "## Sections",
    "",
    ...sectionNames.map((name, idx) => `${idx + 1}. [${name}](#${slugifyAnchor(name)})`),
    "",
  ];

  const body = [];
  for (const name of sectionNames) {
    body.push(`## ${name}`);
    body.push("");
    if (overrides.section_intros && overrides.section_intros[name]) {
      body.push(overrides.section_intros[name]);
      body.push("");
    }
    for (const record of sortSteps(groups.get(name))) {
      body.push(renderRecord(record));
    }
    body.push("---");
    body.push("");
  }

  if (sectionNames.length === 0) {
    body.push(
      "> _No captured steps yet. The manual will populate as more `captureStep(...)` calls are added to e2e specs._",
    );
    body.push("");
  }

  return (
    [...intro, ...body]
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trimEnd() + "\n"
  );
}

function slugifyAnchor(s) {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function main() {
  const records = readAllRecords();
  const overrides = readOverrides();
  const manual = buildManual(records, overrides);
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, manual);
  process.stdout.write(
    `Wrote ${OUT_FILE} (${records.length} step record(s) across ${new Set(records.map((r) => r.section)).size} section(s))\n`,
  );
}

if (require.main === module) main();

module.exports = {
  buildManual,
  groupBySection,
  parseOverrides,
  readAllRecords,
  sortSections,
  sortSteps,
};
