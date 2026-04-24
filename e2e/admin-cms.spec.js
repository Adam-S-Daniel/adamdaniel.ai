const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("./base");

// Drives the real Sveltia CMS editor against a hand-rolled
// FileSystemDirectoryHandle mock so we can exercise Sveltia's template
// engine — the layer the "View on Live Site" preview URL bug actually
// lives at. A pure JavaScript reproduction of the template logic
// (see e2e/cms-preview-url.spec.js) can't catch a Sveltia-specific
// quirk in how `{{fields.X}}` resolves against loaded entry content.
//
// The mock sidesteps `window.showDirectoryPicker`, which in Chromium
// requires a real user gesture and isn't automatable from Playwright
// (microsoft/playwright#18267). Sveltia only needs a handful of FSA
// methods on the returned handle; rolling them by hand keeps this
// self-contained with no extra dependencies.

const REPO_ROOT = path.join(__dirname, "..");

/**
 * Load a directory recursively into a plain JSON tree. Files include
 * their text content; directories include their children. Mirrors just
 * the subset the Sveltia admin needs to enumerate on boot.
 */
function loadTree(dir) {
  const stat = fs.statSync(dir);
  const name = path.basename(dir);
  if (stat.isFile()) {
    return { kind: "file", name, content: fs.readFileSync(dir, "utf8") };
  }
  const children = fs
    .readdirSync(dir)
    .filter((n) => !n.startsWith(".") && n !== "node_modules")
    .map((n) => loadTree(path.join(dir, n)));
  return { kind: "directory", name, children };
}

function loadTreeIfExists(dir) {
  return fs.existsSync(dir) ? loadTree(dir) : null;
}

const FIXTURES = {
  kind: "directory",
  name: "repo",
  children: [
    // Sveltia's local backend sanity-checks the root by looking for `.git`
    // (file or directory). A stub file is enough.
    { kind: "file", name: ".git", content: "gitdir: ignored" },
    loadTreeIfExists(path.join(REPO_ROOT, "_posts")),
    loadTreeIfExists(path.join(REPO_ROOT, "_tags")),
    loadTreeIfExists(path.join(REPO_ROOT, "_projects")),
    loadTreeIfExists(path.join(REPO_ROOT, "pages")),
  ].filter(Boolean),
};

/**
 * Extract `title:` and `slug:` from a post's YAML front matter so we can
 * verify Sveltia's View on Live Site URL against the actual source file
 * rather than hardcoded values.
 */
function parseFrontMatter(filepath) {
  const src = fs.readFileSync(filepath, "utf8");
  const match = src.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const fm = {};
  for (const line of (match?.[1] ?? "").split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/);
    if (!kv) continue;
    fm[kv[1]] = kv[2].trim().replace(/^["'](.*)["']$/, "$1");
  }
  return fm;
}

const POSTS = fs
  .readdirSync(path.join(REPO_ROOT, "_posts"))
  .filter((f) => f.endsWith(".md"))
  .map((file) => {
    const fm = parseFrontMatter(path.join(REPO_ROOT, "_posts", file));
    return {
      file,
      entryId: file.replace(/\.md$/, ""),
      title: fm.title,
      slug: fm.slug,
    };
  })
  .filter((p) => p.slug);

/**
 * Install the test stubs + FileSystemDirectoryHandle mock in the page
 * before Sveltia loads.
 */
async function installSveltiaStubs(page) {
  await page.addInitScript((fixtures) => {
    // The View on Live Site toolbar button calls window.open() rather
    // than following a real <a href>. Capture the URL so the test can
    // navigate to it afterwards.
    window.openedURLs = [];
    window.open = (url) => {
      window.openedURLs.push(String(url));
      return null;
    };

    // Sveltia caches the picked root directory handle in IndexedDB so a
    // reload skips the picker. Real FileSystemDirectoryHandles have
    // built-in structured-clone support; our plain-object mock does not,
    // so store.put throws DataCloneError and crashes sign-in. Swallow
    // that one error and return a fake-success IDBRequest so Sveltia's
    // wrapper resolves and the flow continues.
    const origPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, ...rest) {
      try {
        return origPut.call(this, value, ...rest);
      } catch (err) {
        if (err.name !== "DataCloneError") throw err;
        const req = {
          readyState: "done",
          result: 1,
          error: null,
          source: this,
          transaction: this.transaction,
          onsuccess: null,
          onerror: null,
        };
        queueMicrotask(() => {
          if (typeof req.onsuccess === "function") {
            req.onsuccess(new Event("success"));
          }
        });
        return req;
      }
    };

    // Minimal FileSystemFileHandle / FileSystemDirectoryHandle mock.
    const makeFileHandle = (node) => ({
      kind: "file",
      name: node.name,
      async getFile() {
        return new File([node.content], node.name, { type: "text/plain" });
      },
      async createWritable() {
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
}

/**
 * Open the admin editor for an entry and click "View on Live Site".
 * Returns the URL the button would have opened.
 */
async function captureViewOnLiveSiteURL(page, entryId, consoleLogs) {
  await page.goto(
    `/admin/index-local.html#/collections/posts/entries/${entryId}`,
  );

  await page
    .getByRole("button", { name: /work with local repository/i })
    .click();

  const viewLiveSiteBtn = page.getByRole("button", {
    name: /view on live site/i,
  });
  try {
    await expect(viewLiveSiteBtn).toBeVisible({ timeout: 60_000 });
  } catch (err) {
    console.log("=== Captured console output ===\n" + consoleLogs.join("\n"));
    throw err;
  }

  await viewLiveSiteBtn.click();

  const openedURLs = await page.evaluate(() => window.openedURLs);
  expect(openedURLs).toHaveLength(1);
  return openedURLs[0];
}

test.describe("CMS admin: View on Live Site", () => {
  test.describe.configure({ timeout: 120_000 });

  for (const { entryId, title, slug } of POSTS) {
    test(`${entryId} opens the post at /blog/${slug}/ on the CMS-configured host`, async ({
      page,
    }, testInfo) => {
      test.skip(
        testInfo.project.name !== "chromium-desktop",
        "Admin spec runs once on chromium-desktop — Sveltia is heavy to load",
      );

      const consoleLogs = [];
      page.on("console", (msg) =>
        consoleLogs.push(`[${msg.type()}] ${msg.text()}`),
      );
      page.on("pageerror", (err) =>
        consoleLogs.push(`[pageerror] ${err.name}: ${err.message}`),
      );

      await installSveltiaStubs(page);

      const opened = await captureViewOnLiveSiteURL(page, entryId, consoleLogs);
      const url = new URL(opened);

      // The CMS-configured host (from admin/config-local.yml's display_url)
      // must match Jekyll's serving origin — otherwise the button navigates
      // off to a different deploy.
      expect(`${url.protocol}//${url.host}`).toBe("http://localhost:4000");

      // The CMS preview_path template must resolve to the post's actual
      // Jekyll permalink. This is the exact invariant the original bug
      // broke: Sveltia emitted /blog/<slugified-title>/ instead of
      // /blog/<fields.slug>/.
      expect(url.pathname).toBe(`/blog/${slug}/`);

      // Finally: navigating to that URL must actually load the post.
      // Catches any drift between "the CMS thinks this URL exists" and
      // "Jekyll serves it with the expected content".
      const response = await page.goto(opened);
      expect(response.status()).toBe(200);
      await expect(page.locator(".post-header h1")).toHaveText(title);
    });
  }
});
