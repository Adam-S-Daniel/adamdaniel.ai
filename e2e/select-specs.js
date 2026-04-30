#!/usr/bin/env node
//
// Decide which e2e spec files actually need to run for a given diff.
//
// Why: the full matrix is 8 projects × ~20 specs. A typo fix in a
// single blog post shouldn't pay for cross-browser admin-CMS specs,
// preview-bridge specs, or CloudFront router specs — those tests
// can't possibly be affected. Visual regression already does this on
// a per-page basis; this script extends the same idea to the rest of
// the e2e suite.
//
// CLI:
//   node e2e/select-specs.js [--base <ref>]
//
// Output (stdout): JSON envelope
//   {
//     "scope": "all" | "skip" | "subset",
//     "files": ["e2e/foo.spec.js", ...],     // only when scope=subset
//     "reason": "human-readable explanation"
//   }
//
// Exit code: 0 for success in all scopes (including "skip" — that's
// not an error). Non-zero only if git diff fails outright.
//
// Always-run baseline (cheap, no browser): compute-visual-diffs.test.js,
// cms-config.spec.js, visual-change-guard.spec.js, canary-content.test.js.
// If only those run, CI is essentially a no-op smoke check.
//
// Rules are intentionally over-eager on the "include" side: when in
// doubt, run the spec. Missing a relevant test is far more costly
// than running an irrelevant one.

const { execSync } = require("node:child_process");
const path = require("node:path");

const ALWAYS_RUN = [
  "e2e/compute-visual-diffs.test.js",
  "e2e/cms-config.spec.js",
  "e2e/visual-change-guard.spec.js",
  "e2e/canary-content.test.js",
];

// Files that fan out to "every spec is potentially affected". Includes
// shared infrastructure (layouts/css/plugins), test infrastructure
// (helpers, base, configs), and dependency manifests.
const FANOUT_PATTERNS = [
  /^_layouts\//,
  /^_includes\//,
  /^_config\.yml$/,
  /^assets\/css\//,
  /^_plugins\//,
  /^Gemfile/,
  /^package(-lock)?\.json$/,
  /^playwright(\.regression)?\.config\.js$/,
  /^e2e\/base\.js$/,
  /^\.github\/workflows\/e2e-tests\.yml$/,
];

// Per-spec inclusion rules. Each entry says: "if any changed file
// matches one of these patterns, include this spec." A spec NOT named
// here is included only via fanout (or because its own file changed).
const SPEC_RULES = {
  "e2e/admin-reviews-auth.spec.js": [
    /^admin\/reviews\//,
    /^oauth-proxy\//,
  ],
  "e2e/admin-reviews-stats.spec.js": [
    /^admin\/reviews\//,
    /^e2e\/compute-visual-diffs\.js$/,
    /^e2e\/generate-video\.sh$/,
    /^\.github\/workflows\/visual-regression\.yml$/,
  ],
  "e2e/detect-changed-pages.test.js": [
    /^e2e\/detect-changed-pages\.js$/,
  ],
  "e2e/cms-smoke.spec.js": [
    /^admin\//,
    /^_posts\//,
    /^_tags\//,
    /^_projects\//,
    /^pages\//,
  ],
  "e2e/cms-editorial-workflow.spec.js": [
    /^admin\//,
    /^_posts\//,
  ],
  // Canary content invariants — fast, no browser. Cross-checks the
  // _e2e/ collection wiring stays consistent across _config.yml,
  // admin/config.yml, and the canary source files.
  "e2e/canary-content.test.js": [
    /^_e2e\//,
    /^admin\//,
    /^_config\.yml$/,
    /^_layouts\/canary\.html$/,
  ],
  // Real-network publish-loop specs. Heavy and slow; run only when
  // something contributor-relevant changed.
  "e2e/cms-publish-loop.spec.js": [
    /^admin\//,
    /^_layouts\/(post|page|project|canary|default)\.html$/,
    /^_layouts\/preview\.html$/,
    /^_e2e\//,
    /^scripts\/patch-preview-config\.sh$/,
    /^\.github\/workflows\/cms-editorial-workflow\.yml$/,
    /^\.github\/workflows\/deploy-production\.yml$/,
    /^\.github\/workflows\/deploy-preview\.yml$/,
    /^e2e\/(decap-pat|github-actions-poll|canary-content)\.js$/,
  ],
  "e2e/cms-publish-loop-preview.spec.js": [
    /^admin\//,
    /^_layouts\/(post|page|project|canary|default)\.html$/,
    /^_e2e\//,
    /^scripts\/patch-preview-config\.sh$/,
    /^\.github\/workflows\/cms-editorial-workflow\.yml$/,
    /^\.github\/workflows\/deploy-preview\.yml$/,
    /^e2e\/(decap-pat|github-actions-poll|canary-content)\.js$/,
  ],
  "e2e/cms-publish-flow.spec.js": [
    /^admin\//,
    /^_posts\//,
    /^_layouts\/(post|default)\.html$/,
    /^_includes\//,
  ],
  "e2e/cms-preview-url.spec.js": [
    /^admin\//,
    /^_posts\//,
  ],
  "e2e/blog-post.spec.js": [
    /^_posts\//,
    /^blog\//,
  ],
  "e2e/tags.spec.js": [
    /^_tags\//,
    /^tags\//,
  ],
  "e2e/not-found.spec.js": [
    /^404\.html$/,
  ],
  "e2e/glow-banding.spec.js": [
    // CSS-only spec; otherwise idle. Picks up via fanout.
  ],
  "e2e/preview-bridge.spec.js": [
    /^admin\/preview-bridge\.js$/,
    /^_layouts\/preview\.html$/,
    /^preview\.md$/,
  ],
  "e2e/preview-shell.spec.js": [
    /^_layouts\/preview\.html$/,
    /^admin\/preview-bridge\.js$/,
    /^preview\.md$/,
  ],
  "e2e/preview-config-patch.spec.js": [
    /^scripts\/patch-preview-config\.sh$/,
    /^admin\/(config\.yml|config-local\.yml)$/,
  ],
  "e2e/cloudfront-preview-router.spec.js": [
    /^infrastructure\//,
  ],
  "e2e/cloudfront-preview-location-fixer.spec.js": [
    /^infrastructure\//,
  ],
  "e2e/visual-regression.spec.js": [
    // Master visual gate — always include when *anything* visual could
    // have shifted. Our fanout patterns cover that.
    /^_posts\//,
    /^_tags\//,
    /^_projects\//,
    /^pages\//,
    /^index\.html$/,
    /^blog\/index\.html$/,
    /^projects\/index\.html$/,
    /^tags\/index\.html$/,
  ],
};

function getChangedFiles(baseRef) {
  try {
    const out = execSync(`git diff --name-only ${baseRef}...HEAD`, {
      encoding: "utf8",
    }).trim();
    return out.split("\n").filter(Boolean);
  } catch {
    // Fallback: list current uncommitted changes.
    const out = execSync("git status --porcelain", { encoding: "utf8" });
    return out
      .split("\n")
      .map((line) => line.slice(3).trim())
      .filter(Boolean);
  }
}

function selectSpecs(changedFiles, options = {}) {
  if (changedFiles.length === 0) {
    return {
      scope: "skip",
      reason: "No changed files detected — running baseline only.",
    };
  }

  const specs = new Set(ALWAYS_RUN);

  // Fanout files include all specs.
  const fanoutHit = changedFiles.find((f) =>
    FANOUT_PATTERNS.some((rx) => rx.test(f)),
  );
  if (fanoutHit) {
    return {
      scope: "all",
      reason: `Fanout file changed: ${fanoutHit} — running full matrix.`,
    };
  }

  // Direct: a spec file's own change includes itself.
  for (const f of changedFiles) {
    if (/^e2e\/.*\.spec\.js$/.test(f) || /^e2e\/.*\.test\.js$/.test(f)) {
      specs.add(f);
    }
  }

  // Indirect: rules from SPEC_RULES.
  for (const [spec, patterns] of Object.entries(SPEC_RULES)) {
    for (const f of changedFiles) {
      if (patterns.some((rx) => rx.test(f))) {
        specs.add(spec);
        break;
      }
    }
  }

  // Quirk: changes ONLY to docs / READMEs / AGENTS.md don't need any
  // browser specs at all. Detect this by checking if everything outside
  // ALWAYS_RUN stayed unselected after the rule pass.
  const onlyDocs = changedFiles.every((f) =>
    /^(README\.md|AGENTS\.md|docs\/|\.agents\/skills\/)/.test(f),
  );
  if (onlyDocs && !options.disableSkip) {
    return {
      scope: "skip",
      reason: "Only documentation changed — running baseline only.",
    };
  }

  // If after all the rules the only specs that survived are the always-
  // run baselines, the payload is identical to scope=skip. Collapse it
  // so the workflow can run a single shard instead of a 4-way matrix —
  // sharding 3 sub-second file-comparison tests is pure overhead.
  const onlyBaseline =
    specs.size === ALWAYS_RUN.length &&
    ALWAYS_RUN.every((s) => specs.has(s));
  if (onlyBaseline && !options.disableSkip) {
    return {
      scope: "skip",
      reason: `${changedFiles.length} file(s) changed but none affect a non-baseline spec.`,
    };
  }

  return {
    scope: "subset",
    files: [...specs].sort(),
    reason: `Matched ${specs.size} spec(s) from ${changedFiles.length} changed file(s).`,
  };
}

module.exports = {
  ALWAYS_RUN,
  FANOUT_PATTERNS,
  SPEC_RULES,
  selectSpecs,
  getChangedFiles,
};

if (require.main === module) {
  const args = process.argv.slice(2);
  const baseIdx = args.indexOf("--base");
  const baseRef = baseIdx >= 0 ? args[baseIdx + 1] : "origin/main";
  const changed = getChangedFiles(baseRef);
  const result = selectSpecs(changed);
  // Make output stable across CI runs by sorting and including the
  // changed-files list for traceability.
  result.changedFiles = changed;
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}
