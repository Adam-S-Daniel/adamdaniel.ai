/*
 * Unit tests for the newline-conflict resolver. Pure Node, no network.
 * Run via `node --test scripts/auto-resolve-newline-conflict.test.js`.
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  canonical,
  isPathAllowed,
  isHeadRefAllowed,
  isAuthorAllowed,
  hasCodeFence,
  idempotencyKey,
  formatAbortComment,
  formatCloseComment,
  COMMENT_MARKER,
  run,
} = require("./auto-resolve-newline-conflict");

test("canonical() collapses runs of LFs to one LF", () => {
  assert.equal(canonical("a\nb"), "a\nb");
  assert.equal(canonical("a\n\nb"), "a\nb");
  assert.equal(canonical("a\n\n\nb"), "a\nb");
  assert.equal(canonical("a\n\n\n\nb"), "a\nb");
});

test("canonical() preserves single LF (paragraph structure is irrelevant after collapse)", () => {
  assert.equal(canonical("\n"), "\n");
  assert.equal(canonical("\n\n"), "\n");
  assert.equal(canonical("a\nb\nc"), "a\nb\nc");
});

test("canonical() — all three observed Slate transforms are equivalent under collapse", () => {
  // Soft wrap inside a paragraph doubled into a paragraph break.
  assert.equal(canonical("a\nb"), canonical("a\n\nb"), "\\n vs \\n\\n must collapse equal");
  // Paragraph break tripled.
  assert.equal(
    canonical("a\n\nb"),
    canonical("a\n\n\n\nb"),
    "\\n\\n vs \\n\\n\\n\\n must collapse equal",
  );
  // Blank between frontmatter and body eaten.
  assert.equal(
    canonical("---\n\nbody"),
    canonical("---\nbody"),
    "frontmatter blank eaten case must collapse equal",
  );
});

test("canonical() — real-world PR #882 base vs head bodies collapse equal", () => {
  const main =
    "Adam Daniel — E2E canary post (do not edit by hand).\n\n" +
    "This URL exists so the automated end-to-end publish-loop tests have a stable\n" +
    "target to assert against on both preview-pr<N>.adamdaniel.ai and\n" +
    "adamdaniel.ai. The body is replaced during a test run and reset to this\n" +
    "baseline in cleanup, so the public URL always renders innocuous content\n" +
    "between runs.\n\n" +
    "If this is the only thing you can see, no test is currently in progress.\n";
  // Mangled body matching the byte-level form in the actual PR #882
  // commit d668cf8 (each soft wrap doubled, each break tripled, blank
  // after `---` eaten — but the frontmatter is outside this body string).
  const pr882 =
    "Adam Daniel — E2E canary post (do not edit by hand).\n\n\n\n" +
    "This URL exists so the automated end-to-end publish-loop tests have a stable\n\n" +
    "target to assert against on both preview-pr<N>.adamdaniel.ai and\n\n" +
    "adamdaniel.ai. The body is replaced during a test run and reset to this\n\n" +
    "baseline in cleanup, so the public URL always renders innocuous content\n\n" +
    "between runs.\n\n\n\n" +
    "If this is the only thing you can see, no test is currently in progress.\n";
  assert.equal(
    canonical(main),
    canonical(pr882),
    "PR #882 mangling must canonical-collapse equal to main",
  );
});

test("canonical() — a real edit is NOT equivalent (added text)", () => {
  const main = "hello world\n";
  const edit = "hello there world\n";
  assert.notEqual(canonical(main), canonical(edit));
});

test("canonical() — paragraph re-flow (\\n vs space) is NOT equivalent", () => {
  // Intentional check: collapsing \n+ to a single \n does not equate
  // a line break with a space. A diff that turns `a\nb` into `a b`
  // is not a newline-only diff and the resolver should leave it alone.
  assert.notEqual(canonical("a\nb"), canonical("a b"));
});

test("isPathAllowed() — canary files match", () => {
  assert.ok(isPathAllowed("_e2e/canary-post.md"));
  assert.ok(isPathAllowed("_e2e/canary-page.md"));
  assert.ok(isPathAllowed("_e2e/canary-project.md"));
  assert.ok(isPathAllowed("_e2e/canary-delete-1778199094439.md"));
});

test("isPathAllowed() — CMS-managed content folders match", () => {
  assert.ok(isPathAllowed("_posts/2026-05-14-hello.md"));
  assert.ok(isPathAllowed("pages/about.md"));
  assert.ok(isPathAllowed("_projects/something.md"));
  assert.ok(isPathAllowed("_tags/python.md"));
});

test("isPathAllowed() — workflows and code are rejected", () => {
  assert.equal(isPathAllowed(".github/workflows/foo.yml"), false);
  assert.equal(isPathAllowed("admin/config.yml"), false);
  assert.equal(isPathAllowed("_config.yml"), false);
  assert.equal(isPathAllowed("scripts/foo.js"), false);
  assert.equal(isPathAllowed("e2e/foo.spec.js"), false);
  assert.equal(isPathAllowed("Gemfile"), false);
});

test("isPathAllowed() — _pages/ is rejected (this repo uses pages/, not _pages/)", () => {
  assert.equal(
    isPathAllowed("_pages/about.md"),
    false,
    "admin/config.yml's pages collection folder is `pages`, not `_pages`",
  );
});

test("isPathAllowed() — sibling files near canary are rejected", () => {
  assert.equal(isPathAllowed("_e2e/something-else.md"), false);
  assert.equal(isPathAllowed("_e2e/canary-post.txt"), false);
  assert.equal(isPathAllowed("_e2e/canary-post.md.bak"), false);
});

test("isHeadRefAllowed() — Decap editorial branches match", () => {
  assert.ok(isHeadRefAllowed("cms/e2e/canary-post"));
  assert.ok(isHeadRefAllowed("cms/e2e/canary-page"));
  assert.ok(isHeadRefAllowed("cms/posts/2026-05-14-hello"));
  assert.ok(isHeadRefAllowed("cms/pages/about"));
  assert.ok(isHeadRefAllowed("cms/projects/something"));
  assert.ok(isHeadRefAllowed("cms/tags/python"));
  assert.ok(isHeadRefAllowed("cms/e2e-fixture/seed-canary-post-12345"));
});

test("isHeadRefAllowed() — non-CMS branches are rejected", () => {
  assert.equal(isHeadRefAllowed("main"), false);
  assert.equal(isHeadRefAllowed("fix/something"), false);
  assert.equal(isHeadRefAllowed("feat/new-feature"), false);
  assert.equal(isHeadRefAllowed("claude/something"), false);
  assert.equal(isHeadRefAllowed("cms-something"), false);
  assert.equal(isHeadRefAllowed("cmsx/foo"), false);
});

test("isAuthorAllowed() — Decap bot + repo owner are accepted", () => {
  assert.ok(isAuthorAllowed("decap-cms[bot]"));
  assert.ok(isAuthorAllowed("Adam-S-Daniel"));
});

test("isAuthorAllowed() — random users are rejected", () => {
  assert.equal(isAuthorAllowed("dependabot[bot]"), false);
  assert.equal(isAuthorAllowed("github-actions[bot]"), false);
  assert.equal(isAuthorAllowed("attacker"), false);
});

test("hasCodeFence() — triple-backtick fences detected", () => {
  assert.ok(hasCodeFence("foo\n```\nbar\n```\n"));
  assert.ok(hasCodeFence("```js\ncode\n```"));
});

test("hasCodeFence() — tilde fences detected", () => {
  assert.ok(hasCodeFence("foo\n~~~\nbar\n~~~\n"));
});

test("hasCodeFence() — plain markdown is fine", () => {
  assert.equal(hasCodeFence("a paragraph\nwith line wrap\nand more"), false);
  assert.equal(hasCodeFence("**bold** and _italic_ inline"), false);
});

test("idempotencyKey() — encodes both SHAs deterministically", () => {
  const k = idempotencyKey("abc123", "def456");
  assert.equal(k, "<!-- key:abc123:def456 -->");
  // Order matters — different SHA pairs produce different keys
  assert.notEqual(idempotencyKey("abc", "def"), idempotencyKey("def", "abc"));
});

test("formatAbortComment() — embeds marker and key, lists reasons", () => {
  const c = formatAbortComment("<!-- key:a:b -->", ["path X not allowed", "binary file Y"]);
  assert.ok(c.includes(COMMENT_MARKER));
  assert.ok(c.includes("<!-- key:a:b -->"));
  assert.ok(c.includes("path X not allowed"));
  assert.ok(c.includes("binary file Y"));
  assert.ok(c.includes("cannot close this PR"));
});

test("formatCloseComment() — embeds marker, key, file list", () => {
  const c = formatCloseComment("<!-- key:a:b -->", ["_e2e/canary-post.md", "_posts/2026-foo.md"]);
  assert.ok(c.includes(COMMENT_MARKER));
  assert.ok(c.includes("<!-- key:a:b -->"));
  assert.ok(c.includes("_e2e/canary-post.md"));
  assert.ok(c.includes("_posts/2026-foo.md"));
  assert.ok(c.includes("Auto-closing"));
});

// ─── run() integration tests with mocked fetch ──────────────────────

function makeMockFetch(scenarios) {
  const calls = [];
  return {
    calls,
    fetch: async (url, opts = {}) => {
      const key = `${(opts.method || "GET").toUpperCase()} ${url.replace("https://api.github.com", "")}`;
      calls.push({ key, body: opts.body });
      if (!(key in scenarios)) {
        throw new Error(
          `unexpected call: ${key} (scenarios: ${Object.keys(scenarios).join(", ")})`,
        );
      }
      const s = scenarios[key];
      return {
        ok: s.status >= 200 && s.status < 300,
        status: s.status,
        text: async () => (typeof s.body === "string" ? s.body : JSON.stringify(s.body)),
        json: async () => s.body,
      };
    },
  };
}

test("run() — closes a pure-newline-mangling PR (#882-style case)", async () => {
  const baseSha = "deadbeef";
  const headSha = "feedface";
  const main =
    "Adam Daniel — E2E canary post (do not edit by hand).\n\nThis URL exists so the automated end-to-end publish-loop tests have a stable\ntarget to assert against on both preview-pr<N>.adamdaniel.ai and\nadamdaniel.ai. The body is replaced during a test run and reset to this\nbaseline in cleanup, so the public URL always renders innocuous content\nbetween runs.\n\nIf this is the only thing you can see, no test is currently in progress.\n";
  const mangled =
    "Adam Daniel — E2E canary post (do not edit by hand).\n\n\n\nThis URL exists so the automated end-to-end publish-loop tests have a stable\n\ntarget to assert against on both preview-pr<N>.adamdaniel.ai and\n\nadamdaniel.ai. The body is replaced during a test run and reset to this\n\nbaseline in cleanup, so the public URL always renders innocuous content\n\nbetween runs.\n\n\n\nIf this is the only thing you can see, no test is currently in progress.\n";
  const mock = makeMockFetch({
    "GET /repos/owner/r/pulls/123": {
      status: 200,
      body: {
        state: "open",
        mergeable_state: "dirty",
        head: {
          ref: "cms/e2e/canary-post",
          sha: headSha,
          repo: { full_name: "owner/r" },
        },
        base: { ref: "main", sha: baseSha },
        user: { login: "Adam-S-Daniel" },
      },
    },
    "GET /repos/owner/r/issues/123/comments?per_page=100": {
      status: 200,
      body: [],
    },
    "GET /repos/owner/r/pulls/123/files?per_page=300": {
      status: 200,
      body: [
        {
          filename: "_e2e/canary-post.md",
          status: "modified",
          changes: 12,
          patch: "@@...",
        },
      ],
    },
    "GET /repos/owner/r/contents/_e2e/canary-post.md?ref=main": {
      status: 200,
      body: {
        type: "file",
        content: Buffer.from(main, "utf8").toString("base64"),
      },
    },
    "GET /repos/owner/r/contents/_e2e/canary-post.md?ref=cms%2Fe2e%2Fcanary-post": {
      status: 200,
      body: {
        type: "file",
        content: Buffer.from(mangled, "utf8").toString("base64"),
      },
    },
    "POST /repos/owner/r/issues/123/comments": { status: 201, body: { id: 1 } },
    "PATCH /repos/owner/r/pulls/123": {
      status: 200,
      body: { state: "closed" },
    },
  });
  const origFetch = globalThis.fetch;
  globalThis.fetch = mock.fetch;
  process.env.GH_TOKEN = "test";
  try {
    const result = await run({
      repo: "owner/r",
      prNumber: 123,
      dryRun: false,
      log: () => {},
    });
    assert.equal(result.outcome, "closed");
    assert.deepEqual(result.paths, ["_e2e/canary-post.md"]);
    // Verify we posted the close-comment AND patched state to closed
    assert.ok(mock.calls.some((c) => c.key === "POST /repos/owner/r/issues/123/comments"));
    assert.ok(mock.calls.some((c) => c.key === "PATCH /repos/owner/r/pulls/123"));
  } finally {
    globalThis.fetch = origFetch;
  }
});

test("run() — aborts when a non-newline diff is detected (real content change)", async () => {
  const mock = makeMockFetch({
    "GET /repos/owner/r/pulls/124": {
      status: 200,
      body: {
        state: "open",
        mergeable_state: "dirty",
        head: {
          ref: "cms/posts/foo",
          sha: "h",
          repo: { full_name: "owner/r" },
        },
        base: { ref: "main", sha: "b" },
        user: { login: "Adam-S-Daniel" },
      },
    },
    "GET /repos/owner/r/issues/124/comments?per_page=100": {
      status: 200,
      body: [],
    },
    "GET /repos/owner/r/pulls/124/files?per_page=300": {
      status: 200,
      body: [
        {
          filename: "_posts/2026-foo.md",
          status: "modified",
          changes: 2,
          patch: "@@...",
        },
      ],
    },
    "GET /repos/owner/r/contents/_posts/2026-foo.md?ref=main": {
      status: 200,
      body: {
        type: "file",
        content: Buffer.from("Hello world\n", "utf8").toString("base64"),
      },
    },
    "GET /repos/owner/r/contents/_posts/2026-foo.md?ref=cms%2Fposts%2Ffoo": {
      status: 200,
      body: {
        type: "file",
        content: Buffer.from("Goodbye world\n", "utf8").toString("base64"),
      },
    },
    "POST /repos/owner/r/issues/124/comments": { status: 201, body: { id: 1 } },
  });
  const origFetch = globalThis.fetch;
  globalThis.fetch = mock.fetch;
  process.env.GH_TOKEN = "test";
  try {
    const result = await run({
      repo: "owner/r",
      prNumber: 124,
      dryRun: false,
      log: () => {},
    });
    assert.equal(result.outcome, "abort");
    assert.ok(result.reasons.some((r) => r.includes("canonical-collapse mismatch")));
    // We posted an abort-comment but did NOT close the PR
    assert.ok(mock.calls.some((c) => c.key === "POST /repos/owner/r/issues/124/comments"));
    assert.equal(mock.calls.filter((c) => c.key === "PATCH /repos/owner/r/pulls/124").length, 0);
  } finally {
    globalThis.fetch = origFetch;
  }
});

test("run() — aborts on non-allowlisted path", async () => {
  const mock = makeMockFetch({
    "GET /repos/owner/r/pulls/125": {
      status: 200,
      body: {
        state: "open",
        mergeable_state: "dirty",
        head: {
          ref: "cms/e2e/canary-post",
          sha: "h",
          repo: { full_name: "owner/r" },
        },
        base: { ref: "main", sha: "b" },
        user: { login: "Adam-S-Daniel" },
      },
    },
    "GET /repos/owner/r/issues/125/comments?per_page=100": {
      status: 200,
      body: [],
    },
    "GET /repos/owner/r/pulls/125/files?per_page=300": {
      status: 200,
      body: [
        {
          filename: "admin/config.yml",
          status: "modified",
          changes: 1,
          patch: "@@...",
        },
      ],
    },
    "POST /repos/owner/r/issues/125/comments": { status: 201, body: { id: 1 } },
  });
  const origFetch = globalThis.fetch;
  globalThis.fetch = mock.fetch;
  process.env.GH_TOKEN = "test";
  try {
    const result = await run({
      repo: "owner/r",
      prNumber: 125,
      dryRun: false,
      log: () => {},
    });
    assert.equal(result.outcome, "abort");
    assert.ok(result.reasons.some((r) => r.includes("PATH_ALLOWLIST")));
  } finally {
    globalThis.fetch = origFetch;
  }
});

test("run() — skips when head ref is not allowlisted", async () => {
  const mock = makeMockFetch({
    "GET /repos/owner/r/pulls/126": {
      status: 200,
      body: {
        state: "open",
        mergeable_state: "dirty",
        head: {
          ref: "feat/something",
          sha: "h",
          repo: { full_name: "owner/r" },
        },
        base: { ref: "main", sha: "b" },
        user: { login: "Adam-S-Daniel" },
      },
    },
  });
  const origFetch = globalThis.fetch;
  globalThis.fetch = mock.fetch;
  process.env.GH_TOKEN = "test";
  try {
    const result = await run({
      repo: "owner/r",
      prNumber: 126,
      dryRun: false,
      log: () => {},
    });
    assert.equal(result.outcome, "skip");
    assert.equal(result.reason, "head-ref=feat/something");
    // No comments, no PATCH
    assert.equal(mock.calls.filter((c) => c.key.startsWith("POST")).length, 0);
    assert.equal(mock.calls.filter((c) => c.key.startsWith("PATCH")).length, 0);
  } finally {
    globalThis.fetch = origFetch;
  }
});

test("run() — skips when already resolved at the same (base,head) SHA pair (idempotency)", async () => {
  const baseSha = "aaa";
  const headSha = "bbb";
  const existingCommentBody = `${COMMENT_MARKER}\n<!-- key:${baseSha}:${headSha} -->\n\nprior outcome`;
  const mock = makeMockFetch({
    "GET /repos/owner/r/pulls/127": {
      status: 200,
      body: {
        state: "open",
        mergeable_state: "dirty",
        head: {
          ref: "cms/e2e/canary-post",
          sha: headSha,
          repo: { full_name: "owner/r" },
        },
        base: { ref: "main", sha: baseSha },
        user: { login: "Adam-S-Daniel" },
      },
    },
    "GET /repos/owner/r/issues/127/comments?per_page=100": {
      status: 200,
      body: [{ body: existingCommentBody }],
    },
  });
  const origFetch = globalThis.fetch;
  globalThis.fetch = mock.fetch;
  process.env.GH_TOKEN = "test";
  try {
    const result = await run({
      repo: "owner/r",
      prNumber: 127,
      dryRun: false,
      log: () => {},
    });
    assert.equal(result.outcome, "skip");
    assert.equal(result.reason, "idempotent-already-resolved");
  } finally {
    globalThis.fetch = origFetch;
  }
});

test("run() — skips fork PRs", async () => {
  const mock = makeMockFetch({
    "GET /repos/owner/r/pulls/128": {
      status: 200,
      body: {
        state: "open",
        mergeable_state: "dirty",
        head: {
          ref: "cms/e2e/canary-post",
          sha: "h",
          repo: { full_name: "attacker/r" },
        },
        base: { ref: "main", sha: "b" },
        user: { login: "Adam-S-Daniel" },
      },
    },
  });
  const origFetch = globalThis.fetch;
  globalThis.fetch = mock.fetch;
  process.env.GH_TOKEN = "test";
  try {
    const result = await run({
      repo: "owner/r",
      prNumber: 128,
      dryRun: false,
      log: () => {},
    });
    assert.equal(result.outcome, "skip");
    assert.equal(result.reason, "fork-pr");
  } finally {
    globalThis.fetch = origFetch;
  }
});

test("run() — dry_run does NOT close or comment", async () => {
  const baseSha = "aaa";
  const headSha = "bbb";
  const main = "foo\nbar\n";
  const mangled = "foo\n\n\nbar\n";
  const mock = makeMockFetch({
    "GET /repos/owner/r/pulls/129": {
      status: 200,
      body: {
        state: "open",
        mergeable_state: "dirty",
        head: {
          ref: "cms/posts/x",
          sha: headSha,
          repo: { full_name: "owner/r" },
        },
        base: { ref: "main", sha: baseSha },
        user: { login: "Adam-S-Daniel" },
      },
    },
    "GET /repos/owner/r/issues/129/comments?per_page=100": {
      status: 200,
      body: [],
    },
    "GET /repos/owner/r/pulls/129/files?per_page=300": {
      status: 200,
      body: [
        {
          filename: "_posts/2026-x.md",
          status: "modified",
          changes: 2,
          patch: "@@...",
        },
      ],
    },
    "GET /repos/owner/r/contents/_posts/2026-x.md?ref=main": {
      status: 200,
      body: {
        type: "file",
        content: Buffer.from(main, "utf8").toString("base64"),
      },
    },
    "GET /repos/owner/r/contents/_posts/2026-x.md?ref=cms%2Fposts%2Fx": {
      status: 200,
      body: {
        type: "file",
        content: Buffer.from(mangled, "utf8").toString("base64"),
      },
    },
  });
  const origFetch = globalThis.fetch;
  globalThis.fetch = mock.fetch;
  process.env.GH_TOKEN = "test";
  try {
    const result = await run({
      repo: "owner/r",
      prNumber: 129,
      dryRun: true,
      log: () => {},
    });
    assert.equal(result.outcome, "would-close");
    assert.deepEqual(result.paths, ["_posts/2026-x.md"]);
    // dry_run: NO comment POST and NO state PATCH
    assert.equal(mock.calls.filter((c) => c.key.startsWith("POST")).length, 0);
    assert.equal(mock.calls.filter((c) => c.key.startsWith("PATCH")).length, 0);
  } finally {
    globalThis.fetch = origFetch;
  }
});

test("run() — code-fence guard aborts", async () => {
  const main = "intro\n\n```js\nlet x = 1;\n```\n";
  const mangled = "intro\n\n\n```js\nlet x = 1;\n```\n";
  const mock = makeMockFetch({
    "GET /repos/owner/r/pulls/130": {
      status: 200,
      body: {
        state: "open",
        mergeable_state: "dirty",
        head: {
          ref: "cms/posts/codefence",
          sha: "h",
          repo: { full_name: "owner/r" },
        },
        base: { ref: "main", sha: "b" },
        user: { login: "Adam-S-Daniel" },
      },
    },
    "GET /repos/owner/r/issues/130/comments?per_page=100": {
      status: 200,
      body: [],
    },
    "GET /repos/owner/r/pulls/130/files?per_page=300": {
      status: 200,
      body: [
        {
          filename: "_posts/2026-cf.md",
          status: "modified",
          changes: 2,
          patch: "@@...",
        },
      ],
    },
    "GET /repos/owner/r/contents/_posts/2026-cf.md?ref=main": {
      status: 200,
      body: {
        type: "file",
        content: Buffer.from(main, "utf8").toString("base64"),
      },
    },
    "GET /repos/owner/r/contents/_posts/2026-cf.md?ref=cms%2Fposts%2Fcodefence": {
      status: 200,
      body: {
        type: "file",
        content: Buffer.from(mangled, "utf8").toString("base64"),
      },
    },
    "POST /repos/owner/r/issues/130/comments": { status: 201, body: { id: 1 } },
  });
  const origFetch = globalThis.fetch;
  globalThis.fetch = mock.fetch;
  process.env.GH_TOKEN = "test";
  try {
    const result = await run({
      repo: "owner/r",
      prNumber: 130,
      dryRun: false,
      log: () => {},
    });
    assert.equal(result.outcome, "abort");
    assert.ok(result.reasons.some((r) => r.includes("markdown code fence")));
  } finally {
    globalThis.fetch = origFetch;
  }
});
