/*
 * Shared YAML helpers for the workflow-lint test suite.
 *
 * GitHub Actions YAML is regular enough that a tiny indentation-aware
 * extractor handles every lint we currently care about — `jobs:`,
 * `on:`, and `run: |` blocks. js-yaml isn't in package.json and the
 * lints don't need full structural parsing, so we keep this string-
 * based and dependency-free.
 */
const fs = require("node:fs");
const path = require("node:path");

const WORKFLOW_DIR = path.resolve(__dirname, "..", ".github", "workflows");

function workflowPath(name) {
  return path.join(WORKFLOW_DIR, name);
}

function readWorkflow(name) {
  return fs.readFileSync(workflowPath(name), "utf8");
}

function listWorkflows() {
  return fs
    .readdirSync(WORKFLOW_DIR)
    .filter((f) => /\.ya?ml$/.test(f))
    .map((f) => path.join(WORKFLOW_DIR, f));
}

// Pull the body of a top-level block whose head is `<key>:` (e.g.
// `on:`). Stops when the next top-level key (zero-indent, non-comment)
// appears.
function topBlock(yaml, key) {
  const lines = yaml.split("\n");
  const head = new RegExp(`^${key}:`);
  const start = lines.findIndex((l) => head.test(l));
  if (start === -1) return "";
  const out = [lines[start]];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\S/.test(lines[i])) break;
    out.push(lines[i]);
  }
  return out.join("\n");
}

// Extract a single named job's text from `jobs:`. Two-space indentation
// is the GitHub Actions convention for job heads.
function jobBlock(yaml, name) {
  const lines = yaml.split("\n");
  const head = `  ${name}:`;
  const start = lines.findIndex((l) => l === head);
  if (start === -1) return null;
  const out = [lines[start]];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^ {2}\S/.test(line) && line.trim().endsWith(":")) break;
    if (/^\S/.test(line)) break;
    out.push(line);
  }
  return out.join("\n");
}

// Walk every two-space-indent job under `jobs:`. Each entry carries
// the leading comment block immediately above the job head — used by
// the dependabot-skip lint to recognise an explicit allow-list comment.
function jobBlocks(yaml) {
  const lines = yaml.split("\n");
  const jobsStart = lines.findIndex((l) => /^jobs:/.test(l));
  if (jobsStart === -1) return [];
  const jobs = [];
  for (let i = jobsStart + 1; i < lines.length; i++) {
    const m = lines[i].match(/^ {2}([A-Za-z0-9_-]+):\s*$/);
    if (!m) continue;
    const name = m[1];
    const startLine = i;
    const leadingComments = [];
    for (let j = i - 1; j > jobsStart && /^\s*#/.test(lines[j]); j--) {
      leadingComments.unshift(lines[j]);
    }
    const body = [];
    let k = i + 1;
    while (k < lines.length) {
      if (/^ {2}\S/.test(lines[k]) && lines[k].trim().endsWith(":")) break;
      if (/^\S/.test(lines[k])) break;
      body.push(lines[k]);
      k++;
    }
    jobs.push({ name, leadingComments, body: body.join("\n"), startLine });
    i = k - 1;
  }
  return jobs;
}

// Pull every `run: |` shell block out of a workflow. The body ends at
// the next non-blank line whose indent is shallower than the run-
// block's body indent.
function runBlocks(yaml) {
  const lines = yaml.split("\n");
  const blocks = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\s*)run:\s*\|\s*$/);
    if (!m) continue;
    const indent = m[1].length + 2;
    const body = [];
    let j = i + 1;
    while (j < lines.length) {
      const l = lines[j];
      if (l.trim() === "") {
        body.push(l);
        j++;
        continue;
      }
      if (l.match(/^(\s*)/)[1].length < indent) break;
      body.push(l);
      j++;
    }
    blocks.push({ body: body.join("\n"), startLine: i + 1 });
    i = j - 1;
  }
  return blocks;
}

module.exports = {
  WORKFLOW_DIR,
  jobBlock,
  jobBlocks,
  listWorkflows,
  readWorkflow,
  runBlocks,
  topBlock,
  workflowPath,
};
