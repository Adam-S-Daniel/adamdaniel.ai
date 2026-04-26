// Shared helpers for end-to-end specs that drive the real Sveltia CMS
// against an in-memory fake repository. The fake mirrors just enough
// of the File System Access API for Sveltia's local-backend mode to
// boot, list collections, edit entries, save them back, and delete
// them — without ever needing a real GitHub login.
//
// `loadTree` snapshots a directory off disk into a JSON tree of
// {kind: 'file' | 'directory', name, content?, children?} nodes.
// `installSveltiaStubs` injects a window.showDirectoryPicker that
// returns a FileSystemDirectoryHandle proxy over that tree, with
// writable streams that mutate the in-memory tree on close.
//
// The point: tests can take an action in the UI ("save", "delete"),
// then read back the resulting file contents directly from the tree
// snapshot — no fragile DOM scraping required.

const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.join(__dirname, "..");

function loadTree(dir) {
  if (!fs.existsSync(dir)) return undefined;
  const stat = fs.statSync(dir);
  const name = path.basename(dir);
  if (stat.isFile()) {
    return { kind: "file", name, content: fs.readFileSync(dir, "utf8") };
  }
  const children = fs
    .readdirSync(dir)
    .filter((n) => !n.startsWith(".") && n !== "node_modules")
    .map((n) => loadTree(path.join(dir, n)))
    .filter(Boolean);
  return { kind: "directory", name, children };
}

/**
 * Build a fixture tree containing the project's content collections plus a
 * `.git` stub Sveltia uses to sanity-check the repo root.
 */
function buildFixtures() {
  return {
    kind: "directory",
    name: "repo",
    children: [
      { kind: "file", name: ".git", content: "gitdir: ignored" },
      loadTree(path.join(REPO_ROOT, "_posts")),
      loadTree(path.join(REPO_ROOT, "_tags")),
      loadTree(path.join(REPO_ROOT, "_projects")),
      loadTree(path.join(REPO_ROOT, "pages")),
      loadTree(path.join(REPO_ROOT, "assets")),
    ].filter(Boolean),
  };
}

function parseFrontMatter(src) {
  const match = src.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const fm = {};
  for (const line of (match?.[1] ?? "").split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/);
    if (!kv) continue;
    fm[kv[1]] = kv[2].trim().replace(/^["'](.*)["']$/, "$1");
  }
  return fm;
}

/**
 * Install a writable FileSystemDirectoryHandle mock + the small set of
 * window-level stubs Sveltia needs (window.open capture for the
 * View on Live Site button, IDBObjectStore.put hardening for the
 * directory-handle cache, structured-clone-safe IDB inserts).
 *
 * Pass the result of `buildFixtures()` (or your own tree) as fixtures.
 */
async function installSveltiaStubs(page, fixtures) {
  await page.addInitScript((fx) => {
    // ── Capture window.open URLs for the View on Live Site button ──
    window.openedURLs = [];
    window.open = (url) => {
      window.openedURLs.push(String(url));
      return null;
    };

    // ── IndexedDB.put hardening (Sveltia caches the picked dir handle) ──
    const origPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, ...rest) {
      try {
        return origPut.call(this, value, ...rest);
      } catch (err) {
        if (err.name !== "DataCloneError") throw err;
        const req = {
          readyState: "done", result: 1, error: null,
          source: this, transaction: this.transaction,
          onsuccess: null, onerror: null,
        };
        queueMicrotask(() => {
          if (typeof req.onsuccess === "function") {
            req.onsuccess(new Event("success"));
          }
        });
        return req;
      }
    };

    // ── FileSystemFileHandle / FileSystemDirectoryHandle mock ─────
    function makeFileHandle(node) {
      return {
        kind: "file",
        name: node.name,
        async getFile() {
          const content = node.content ?? "";
          if (content instanceof ArrayBuffer) {
            return new File([content], node.name);
          }
          return new File([content], node.name, { type: "text/plain" });
        },
        async createWritable() {
          // The buffer Sveltia writes is collected here and atomically
          // replaces the node's content on close. Sveltia uses both the
          // streaming and one-shot write APIs, so support both.
          const chunks = [];
          return {
            async write(data) {
              if (data && typeof data === "object" && "type" in data && "data" in data) {
                if (data.type === "write" || data.type === "seek") {
                  if (data.data !== undefined) chunks.push(data.data);
                }
              } else if (data !== undefined) {
                chunks.push(data);
              }
            },
            async truncate(size) { /* atomic replacement, no-op */ void size; },
            async seek() { /* no-op */ },
            async close() {
              // Concatenate chunks: text + Blob/ArrayBuffer.
              if (chunks.every((c) => typeof c === "string")) {
                node.content = chunks.join("");
                return;
              }
              const blobs = chunks.map((c) =>
                typeof c === "string"
                  ? new Blob([c])
                  : c instanceof Blob
                    ? c
                    : new Blob([c]),
              );
              const merged = new Blob(blobs);
              node.content = await merged.arrayBuffer();
            },
            async abort() { /* no-op */ },
          };
        },
        async queryPermission() { return "granted"; },
        async requestPermission() { return "granted"; },
      };
    }

    function makeDirHandle(node) {
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
        async *values() { for (const [, h] of handle.entries()) yield h; },
        async *keys() { for (const c of node.children) yield c.name; },
        async queryPermission() { return "granted"; },
        async requestPermission() { return "granted"; },
        async removeEntry(name) {
          byName.delete(name);
          node.children = node.children.filter((c) => c.name !== name);
        },
        async resolve() { return []; },
        [Symbol.asyncIterator]() { return handle.entries(); },
      };
      return handle;
    }

    window.__rootDirHandle = makeDirHandle(fx);
    window.__rootFixtures = fx;
    window.showDirectoryPicker = async () => window.__rootDirHandle;
  }, fixtures);
}

/**
 * Click "Work with local repository" to skip the directory picker. Idempotent.
 */
async function signInLocal(page) {
  const btn = page.getByRole("button", { name: /work with local repository/i });
  if (await btn.isVisible().catch(() => false)) {
    await btn.click();
  }
}

/**
 * Look up the current snapshot of the in-memory file system. Useful in
 * assertions: after Save, read the saved file out of the fixtures tree.
 */
async function readFixtureFile(page, ...segments) {
  return page.evaluate((parts) => {
    let node = window.__rootFixtures;
    for (const seg of parts) {
      const child = (node.children || []).find((c) => c.name === seg);
      if (!child) return null;
      node = child;
    }
    return node.kind === "file"
      ? { content: typeof node.content === "string" ? node.content : "[binary]" }
      : { kind: "directory", names: node.children.map((c) => c.name) };
  }, segments);
}

async function listFixtureDir(page, ...segments) {
  const result = await readFixtureFile(page, ...segments);
  return result?.names || [];
}

module.exports = {
  REPO_ROOT,
  buildFixtures,
  loadTree,
  parseFrontMatter,
  installSveltiaStubs,
  signInLocal,
  readFixtureFile,
  listFixtureDir,
};
