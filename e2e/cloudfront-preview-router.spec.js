const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("./base");

// Pulls the inline FunctionCode of the CloudFront preview-router function out
// of the CloudFormation template, runs it in Node, and asserts each routing
// case. Keeps the template as the single source of truth — no duplicate
// copy of the function body to drift.

const TEMPLATE_PATH = path.join(
  __dirname,
  "..",
  "infrastructure/bootstrap/template.yaml",
);

function loadHandler() {
  const template = fs.readFileSync(TEMPLATE_PATH, "utf8");
  // Match the `FunctionCode: |` block literal body. The scalar ends when a
  // line returns to outer indentation (two or fewer spaces).
  const match = template.match(
    /FunctionCode:\s*\|\s*\n((?:[ \t]{8,}.*(?:\n|$))+)/,
  );
  if (!match) {
    throw new Error(
      "Could not locate PreviewRouterFunction.FunctionCode in template.yaml",
    );
  }
  // Dedent the block (block scalars preserve leading spaces past the
  // indicator's indent). 8 spaces is the baseline indentation in this
  // template — strip it so the code runs as plain JS.
  const src = match[1].replace(/^[ \t]{8}/gm, "");
  // Expose `handler` out of a fresh Function scope.
  // eslint-disable-next-line no-new-func
  return new Function(`${src}\nreturn handler;`)();
}

function request(host, uri) {
  const req = {
    uri,
    headers: host ? { host: { value: host } } : {},
  };
  return { request: req };
}

test.describe("CloudFront preview-router function", () => {
  const handler = loadHandler();

  test("preview-pr21.adamdaniel.ai rewrites /blog/foo/ to /pr-21/blog/foo/", () => {
    const evt = request("preview-pr21.adamdaniel.ai", "/blog/foo/");
    handler(evt);
    expect(evt.request.uri).toBe("/pr-21/blog/foo/");
  });

  test("rewrites root / to /pr-N/ so S3 website index resolves", () => {
    const evt = request("preview-pr21.adamdaniel.ai", "/");
    handler(evt);
    expect(evt.request.uri).toBe("/pr-21/");
  });

  test("handles multi-digit PR numbers", () => {
    const evt = request("preview-pr12345.adamdaniel.ai", "/blog/foo/");
    handler(evt);
    expect(evt.request.uri).toBe("/pr-12345/blog/foo/");
  });

  test("leaves apex adamdaniel.ai requests alone", () => {
    const evt = request("adamdaniel.ai", "/blog/foo/");
    handler(evt);
    expect(evt.request.uri).toBe("/blog/foo/");
  });

  test("leaves unrelated subdomains alone", () => {
    const evt = request("preview.adamdaniel.ai", "/");
    handler(evt);
    expect(evt.request.uri).toBe("/");
  });

  test("does not rewrite when the subdomain almost matches", () => {
    const evt = request("preview-pr21.example.com", "/blog/foo/");
    handler(evt);
    expect(evt.request.uri).toBe("/blog/foo/");
  });

  test("returns the request unchanged when no host header is present", () => {
    const evt = request(undefined, "/blog/foo/");
    expect(() => handler(evt)).not.toThrow();
    expect(evt.request.uri).toBe("/blog/foo/");
  });
});
