const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("./base");

// Drives the real Sveltia CMS editor against a hand-rolled
// FileSystemDirectoryHandle mock so we can exercise Sveltia's template
// engine — the layer the CMS preview_path bug (see _plugins/permalink_slug.rb)
// actually lived at. A pure JavaScript reproduction of the template logic
// (see e2e/cms-preview-url.spec.js) can't catch a Sveltia-specific quirk
// like `{{fields.slug}}` shadowing.
//
// The mock sidesteps `window.showDirectoryPicker`, which in Chromium
// requires a real user gesture and isn't automatable from Playwright
// (microsoft/playwright#18267). Sveltia only needs a handful of FSA methods
// on the returned handle; rolling them by hand keeps this under 100 lines
// with no extra dependencies.

const REPO_ROOT = path.join(__dirname, "..");

/**
 * Load a directory recursively into a plain JSON tree. Files include their
 * text content; directories include their children. Mirrors just the subset
 * the Sveltia admin needs to enumerate on boot.
 */
function loadTree(dir, relativeTo = dir) {
  const stat = fs.statSync(dir);
  const name = path.basename(dir);
  if (stat.isFile()) {
    return {
      kind: "file",
      name,
      content: fs.readFileSync(dir, "utf8"),
    };
  }
  const children = fs
    .readdirSync(dir)
    .filter((n) => !n.startsWith(".") && n !== "node_modules")
    .map((n) => loadTree(path.join(dir, n), relativeTo));
  return { kind: "directory", name, children };
}

// Populate only the collections the Posts-edit screen will walk.
const FIXTURES = {
  kind: "directory",
  name: "repo",
  children: [
    // The local backend sanity-checks the root by looking for `.git` (file or
    // directory). A stub file is enough.
    { kind: "file", name: ".git", content: "gitdir: ignored" },
    loadTree(path.join(REPO_ROOT, "_posts")),
    loadTree(path.join(REPO_ROOT, "_tags")),
    loadTree(path.join(REPO_ROOT, "_projects")),
    loadTree(path.join(REPO_ROOT, "pages")),
  ],
};

test.describe("CMS admin: View on Live Site", () => {
  test("link uses the post's permalink, not the slugified title", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "chromium-desktop",
      "Admin spec runs once on chromium-desktop — Sveltia is heavy to load",
    );

    await page.addInitScript((fixtures) => {
      // Capture window.open calls — the View on Live Site menu item navigates
      // via window.open() rather than a real <a href>.
      window.openedURLs = [];
      window.open = (url) => {
        window.openedURLs.push(String(url));
        return null;
      };

      /**
       * Build a tiny FileSystemDirectoryHandle / FileSystemFileHandle mock
       * backed by the fixtures tree. Implements the subset Sveltia's local
       * backend actually calls on the handle.
       */
      const makeFileHandle = (node) => ({
        kind: "file",
        name: node.name,
        async getFile() {
          return new File([node.content], node.name, { type: "text/plain" });
        },
        async createWritable() {
          // Read-only — the test never saves. Reject so any accidental write
          // surfaces as a test failure rather than silently passing.
          throw new Error("Read-only mock: createWritable is not supported");
        },
      });

      const makeDirHandle = (node) => {
        const byName = new Map(node.children.map((c) => [c.name, c]));
        const handle = {
          kind: "directory",
          name: node.name,
          async getFileHandle(name, opts = {}) {
            const child = byName.get(name);
            if (child?.kind === "file") return makeFileHandle(child);
            if (child?.kind === "directory") {
              const err = new Error(`${name} is a directory, not a file`);
              err.name = "TypeMismatchError";
              throw err;
            }
            if (opts.create) {
              const created = { kind: "file", name, content: "" };
              byName.set(name, created);
              node.children.push(created);
              return makeFileHandle(created);
            }
            const err = new Error(`No file named ${name}`);
            err.name = "NotFoundError";
            throw err;
          },
          async getDirectoryHandle(name, opts = {}) {
            const child = byName.get(name);
            if (child?.kind === "directory") return makeDirHandle(child);
            if (child?.kind === "file") {
              const err = new Error(`${name} is a file, not a directory`);
              err.name = "TypeMismatchError";
              throw err;
            }
            if (opts.create) {
              const created = { kind: "directory", name, children: [] };
              byName.set(name, created);
              node.children.push(created);
              return makeDirHandle(created);
            }
            const err = new Error(`No directory named ${name}`);
            err.name = "NotFoundError";
            throw err;
          },
          async *entries() {
            for (const child of node.children) {
              yield [
                child.name,
                child.kind === "file"
                  ? makeFileHandle(child)
                  : makeDirHandle(child),
              ];
            }
          },
          async *values() {
            for (const [, h] of handle.entries()) yield h;
          },
          async *keys() {
            for (const c of node.children) yield c.name;
          },
          async queryPermission() {
            return "granted";
          },
          async requestPermission() {
            return "granted";
          },
          async removeEntry(name) {
            byName.delete(name);
            node.children = node.children.filter((c) => c.name !== name);
          },
          async resolve() {
            return [];
          },
          [Symbol.asyncIterator]() {
            return handle.entries();
          },
        };
        return handle;
      };

      window.__rootDirHandle = makeDirHandle(fixtures);
      window.showDirectoryPicker = async () => window.__rootDirHandle;
    }, FIXTURES);

    // Go to the entry editor directly. Sveltia is an async SPA; the "Work
    // with Local Repository" landing page will surface until the user
    // triggers the picker, so we drive through it.
    await page.goto(
      "/admin/index-local.html#/collections/posts/entries/2025-03-01-structured-outputs-are-a-superpower",
    );

    await page
      .getByRole("button", { name: /work with local repository/i })
      .click();

    // Wait for the entry editor to render by looking for the renamed slug
    // field — its presence confirms the file content was parsed.
    await expect(page.getByLabel(/url slug/i)).toBeVisible({ timeout: 60_000 });

    // The View on Live Site action lives under the per-locale content-options
    // menu. Open it, then click the item.
    await page
      .getByRole("button", { name: /content options/i })
      .first()
      .click();
    await page
      .getByRole("menuitem", { name: /view on live site/i })
      .click();

    const openedURLs = await page.evaluate(() => window.openedURLs);
    expect(openedURLs).toHaveLength(1);

    const opened = openedURLs[0];
    expect(opened).toContain("/blog/structured-outputs-are-a-superpower/");
    // Regression guard: the slugified title is what the original bug produced.
    expect(opened).not.toContain("pellentesque-habitant-morbi-tristique");
  });
});
