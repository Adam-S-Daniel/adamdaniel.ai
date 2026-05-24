/*
 * Unit tests for the stuck-PR diagnostic. Pure Node, no network.
 * Run via `node --test scripts/diagnose-stuck-pr.test.js`.
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildReport,
  classifyPr,
  tryCanonicalCollapse,
  shouldCheckDeployQueue,
} = require("./diagnose-stuck-pr");

function makeMockFetch(scenarios) {
  const calls = [];
  return {
    calls,
    fetch: async (url) => {
      const key = url.replace("https://api.github.com", "");
      calls.push(key);
      if (!(key in scenarios)) {
        // Default rate-limited-ok response with empty body
        return {
          ok: true,
          status: 200,
          headers: new Map([["x-ratelimit-remaining", "5000"]]),
          json: async () => [],
          text: async () => "",
        };
      }
      const s = scenarios[key];
      const headers = new Map([
        ["x-ratelimit-remaining", String(s.rateLimitRemaining ?? 5000)],
        ["x-ratelimit-reset", String(s.rateLimitReset ?? Math.floor(Date.now() / 1000) + 3600)],
      ]);
      return {
        ok: s.status >= 200 && s.status < 300,
        status: s.status,
        headers: {
          get: (k) => headers.get(k.toLowerCase()) || null,
        },
        json: async () => s.body,
        text: async () => (typeof s.body === "string" ? s.body : JSON.stringify(s.body)),
      };
    },
  };
}

function withMockFetch(scenarios, fn) {
  const mock = makeMockFetch(scenarios);
  const orig = globalThis.fetch;
  globalThis.fetch = mock.fetch;
  process.env.GH_TOKEN = "test-token";
  return Promise.resolve(fn(mock)).finally(() => {
    globalThis.fetch = orig;
  });
}

test("shouldCheckDeployQueue() — true for URL-class waits", () => {
  assert.equal(shouldCheckDeployQueue("URL serving baseline", "url"), true);
  assert.equal(shouldCheckDeployQueue("waiting for fetchPublicUrl", ""), true);
  assert.equal(shouldCheckDeployQueue("change reflected on prod", ""), true);
});

test("shouldCheckDeployQueue() — true for merge-class waits (queue blocks required checks)", () => {
  assert.equal(shouldCheckDeployQueue("PR #123 to merge", "merge"), true);
});

test("shouldCheckDeployQueue() — true when waiting-for is unspecified (default-on)", () => {
  assert.equal(shouldCheckDeployQueue("", ""), true);
});

test("shouldCheckDeployQueue() — false for clearly-non-URL kinds", () => {
  assert.equal(
    shouldCheckDeployQueue("Decap to open cms/... PR", "pr-open"),
    false,
    "pr-open kind should skip deploy queue (orthogonal cause)",
  );
});

test("classifyPr() — dirty PR with newline-only collapse → resolver hint", async () => {
  const baseRef = "main";
  const headRef = "cms/e2e/canary-post";
  const scenarios = {
    [`/repos/o/r/pulls/882/files?per_page=50`]: {
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
    [`/repos/o/r/contents/_e2e/canary-post.md?ref=${baseRef}`]: {
      status: 200,
      body: {
        type: "file",
        content: Buffer.from("a\nb\n", "utf8").toString("base64"),
      },
    },
    [`/repos/o/r/contents/_e2e/canary-post.md?ref=${encodeURIComponent(headRef)}`]: {
      status: 200,
      body: {
        type: "file",
        content: Buffer.from("a\n\n\nb\n", "utf8").toString("base64"),
      },
    },
  };
  await withMockFetch(scenarios, async () => {
    const lines = await classifyPr(
      "o/r",
      {
        number: 882,
        title: "Update canary",
        head: { ref: headRef, sha: "h" },
        base: { ref: baseRef },
        mergeable_state: "dirty",
        html_url: "https://github.com/o/r/pull/882",
      },
      Date.now() + 25_000,
    );
    const joined = lines.join("\n");
    assert.ok(joined.includes("PR #882"));
    assert.ok(joined.includes("newline-only"));
    assert.ok(joined.includes("auto-resolve-newline-conflict.yml"));
    assert.ok(joined.includes("pr_number=882"));
  });
});

test("classifyPr() — dirty PR with non-newline diff → 'not auto-resolvable'", async () => {
  const baseRef = "main";
  const headRef = "cms/posts/foo";
  const scenarios = {
    [`/repos/o/r/pulls/200/files?per_page=50`]: {
      status: 200,
      body: [
        {
          filename: "_posts/foo.md",
          status: "modified",
          changes: 2,
          patch: "@@...",
        },
      ],
    },
    [`/repos/o/r/contents/_posts/foo.md?ref=${baseRef}`]: {
      status: 200,
      body: {
        type: "file",
        content: Buffer.from("hello world\n", "utf8").toString("base64"),
      },
    },
    [`/repos/o/r/contents/_posts/foo.md?ref=${encodeURIComponent(headRef)}`]: {
      status: 200,
      body: {
        type: "file",
        content: Buffer.from("goodbye world\n", "utf8").toString("base64"),
      },
    },
  };
  await withMockFetch(scenarios, async () => {
    const lines = await classifyPr(
      "o/r",
      {
        number: 200,
        title: "Edit a post",
        head: { ref: headRef, sha: "h" },
        base: { ref: baseRef },
        mergeable_state: "dirty",
        html_url: "https://github.com/o/r/pull/200",
      },
      Date.now() + 25_000,
    );
    const joined = lines.join("\n");
    assert.ok(joined.includes("not auto-resolvable"));
    assert.ok(joined.includes("manual rebase"));
  });
});

test("classifyPr() — blocked PR lists failing checks", async () => {
  const scenarios = {
    [`/repos/o/r/commits/h/check-runs?per_page=50`]: {
      status: 200,
      body: {
        check_runs: [
          {
            name: "validate-content",
            conclusion: "failure",
            status: "completed",
            html_url: "https://example/c1",
          },
          {
            name: "e2e (1)",
            conclusion: "success",
            status: "completed",
            html_url: "https://example/c2",
          },
          {
            name: "deploy-preview",
            status: "in_progress",
            html_url: "https://example/c3",
          },
        ],
      },
    },
  };
  await withMockFetch(scenarios, async () => {
    const lines = await classifyPr(
      "o/r",
      {
        number: 300,
        title: "blocked",
        head: { ref: "cms/posts/foo", sha: "h" },
        base: { ref: "main" },
        mergeable_state: "blocked",
        html_url: "https://github.com/o/r/pull/300",
      },
      Date.now() + 25_000,
    );
    const joined = lines.join("\n");
    assert.ok(joined.includes("1 failing"));
    assert.ok(joined.includes("validate-content"));
  });
});

test("classifyPr() — clean PR with no auto-merge intent → label-race hint", async () => {
  await withMockFetch({}, async () => {
    const lines = await classifyPr(
      "o/r",
      {
        number: 400,
        title: "clean",
        head: { ref: "cms/posts/foo", sha: "h" },
        base: { ref: "main" },
        mergeable_state: "clean",
        auto_merge: null,
        html_url: "https://github.com/o/r/pull/400",
      },
      Date.now() + 25_000,
    );
    assert.ok(lines.join("\n").includes("label-race"));
  });
});

test("classifyPr() — clean PR with auto-merge enabled → 'merging when checks pass'", async () => {
  await withMockFetch({}, async () => {
    const lines = await classifyPr(
      "o/r",
      {
        number: 401,
        title: "auto-merging",
        head: { ref: "cms/e2e/canary-post", sha: "h" },
        base: { ref: "main" },
        mergeable_state: "clean",
        auto_merge: { enabled_by: { login: "Adam-S-Daniel" } },
        html_url: "https://github.com/o/r/pull/401",
      },
      Date.now() + 25_000,
    );
    assert.ok(lines.join("\n").includes("auto-merge enabled by @Adam-S-Daniel"));
  });
});

test("tryCanonicalCollapse() — handles indeterminate (missing files)", async () => {
  const scenarios = {
    [`/repos/o/r/pulls/500/files?per_page=50`]: { status: 200, body: [] },
  };
  await withMockFetch(scenarios, async () => {
    const verdict = await tryCanonicalCollapse(
      "o/r",
      { number: 500, head: { ref: "cms/posts/x" }, base: { ref: "main" } },
      Date.now() + 25_000,
    );
    assert.equal(verdict, "indeterminate");
  });
});

test("buildReport() — happy path includes target PR, open CMS PR list, and deploy queue", async () => {
  const scenarios = {
    [`/repos/o/r/pulls/882`]: {
      status: 200,
      body: {
        number: 882,
        title: "Update E2E Canary canary-post",
        head: {
          ref: "cms/e2e/canary-post",
          sha: "h",
          repo: { full_name: "o/r" },
        },
        base: { ref: "main" },
        mergeable_state: "dirty",
        html_url: "https://github.com/o/r/pull/882",
      },
    },
    [`/repos/o/r/pulls/882/files?per_page=50`]: {
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
    [`/repos/o/r/contents/_e2e/canary-post.md?ref=main`]: {
      status: 200,
      body: {
        type: "file",
        content: Buffer.from("a\nb\n", "utf8").toString("base64"),
      },
    },
    [`/repos/o/r/contents/_e2e/canary-post.md?ref=${encodeURIComponent("cms/e2e/canary-post")}`]: {
      status: 200,
      body: {
        type: "file",
        content: Buffer.from("a\n\nb\n", "utf8").toString("base64"),
      },
    },
    [`/repos/o/r/pulls?state=open&per_page=100`]: {
      status: 200,
      body: [
        {
          number: 882,
          title: "Update E2E Canary canary-post",
          head: { ref: "cms/e2e/canary-post", sha: "h" },
          base: { ref: "main" },
          mergeable_state: "dirty",
          html_url: "https://github.com/o/r/pull/882",
        },
      ],
    },
    [`/repos/o/r/actions/workflows/deploy-production.yml/runs?per_page=15`]: {
      status: 200,
      body: {
        workflow_runs: [
          {
            id: 12345,
            status: "queued",
            conclusion: null,
            head_branch: "main",
            head_sha: "abc1234",
            html_url: "https://github.com/o/r/actions/runs/12345",
          },
        ],
      },
    },
  };
  await withMockFetch(scenarios, async () => {
    const md = await buildReport({
      repo: "o/r",
      waitingFor: "URL serving baseline",
      waitPrNumber: 882,
      kind: "url",
      log: () => {},
    });
    assert.ok(md.includes("### Stuck-PR diagnostic"));
    assert.ok(md.includes("Was waiting for:** URL serving baseline"));
    assert.ok(md.includes("Target PR #882"));
    assert.ok(md.includes("Open CMS PRs"));
    assert.ok(md.includes("deploy-production.yml"));
    assert.ok(md.includes("in-flight: 0, queued: 1"));
    assert.ok(md.includes("newline-only"));
  });
});

test("buildReport() — no waitPrNumber, no deploy-queue check on non-URL kind", async () => {
  const scenarios = {
    [`/repos/o/r/pulls?state=open&per_page=100`]: { status: 200, body: [] },
  };
  await withMockFetch(scenarios, async () => {
    const md = await buildReport({
      repo: "o/r",
      waitingFor: "Decap to open cms/... PR",
      waitPrNumber: null,
      kind: "pr-open",
      log: () => {},
    });
    assert.ok(md.includes("### Stuck-PR diagnostic"));
    assert.ok(md.includes("Open CMS PRs (0)"));
    assert.ok(!md.includes("deploy-production.yml"), "should skip deploy-queue for pr-open kind");
  });
});

test("buildReport() — empty open-PR list emits the 'look elsewhere' line", async () => {
  const scenarios = {
    [`/repos/o/r/pulls?state=open&per_page=100`]: { status: 200, body: [] },
    [`/repos/o/r/actions/workflows/deploy-production.yml/runs?per_page=15`]: {
      status: 200,
      body: { workflow_runs: [] },
    },
  };
  await withMockFetch(scenarios, async () => {
    const md = await buildReport({
      repo: "o/r",
      waitingFor: "anything",
      waitPrNumber: null,
      kind: "",
      log: () => {},
    });
    assert.ok(md.includes("Open CMS PRs (0)"));
    assert.ok(md.includes("not a CMS PR"));
  });
});
