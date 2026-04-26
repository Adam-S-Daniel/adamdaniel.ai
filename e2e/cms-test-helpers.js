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
    // ── Pre-seed Sveltia user prefs ───────────────────────────────
    // Match admin/index.html's behaviour so the test harness sees
    // the same post-save flow real editors do (closeOnSave=false →
    // Save stays on the entry-edit form). Without this the Edit
    // step's Description/menu lookups race against Sveltia routing
    // back to the collection list.
    try {
      const KEY = "sveltia-cms.prefs";
      const raw = localStorage.getItem(KEY);
      const prefs = raw ? JSON.parse(raw) : {};
      if (typeof prefs.closeOnSave === "undefined") {
        prefs.closeOnSave = false;
        localStorage.setItem(KEY, JSON.stringify(prefs));
      }
    } catch (_) { /* localStorage disabled — keep Sveltia's defaults */ }

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
    //
    // File handles know their parent directory node (`parent`) so
    // `move(newName)` can rewire the parent's children list — this is
    // how Sveltia commits a save: write to `.sveltia-tmp-<uuid>`,
    // close, then move() to the final filename. Without move() in
    // the mock, the temp file lingers and the final file never
    // appears.
    function makeFileHandle(node, parent) {
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
        // FileSystemFileHandle.move(newName) — rename within the
        // current parent directory. (W3C draft; Sveltia uses this for
        // atomic saves: write to a temp file then move() to the final
        // name.)
        // Two-arg form move(destDir, newName) supported too, though
        // Sveltia's local backend currently only uses the one-arg form.
        async move(...args) {
          if (!parent) throw new Error("move() needs a parent directory");
          let destNode = parent;
          let newName = node.name;
          if (args.length === 1) {
            newName = args[0];
          } else if (args.length === 2) {
            // First arg is a directory handle — find its underlying node.
            const destHandle = args[0];
            destNode = destHandle?.__node || parent;
            newName = args[1];
          }
          if (!newName || typeof newName !== "string") {
            throw new Error("move() requires a target name");
          }
          // Remove old name from current parent.
          parent.children = parent.children.filter((c) => c !== node);
          // Replace any existing entry at the target name in dest.
          destNode.children = destNode.children.filter((c) => c.name !== newName);
          // Re-insert with new name (may also be the new parent).
          node.name = newName;
          destNode.children.push(node);
          parent = destNode; // reflect the new parent for subsequent ops
          this.name = newName;
        },
        async queryPermission() { return "granted"; },
        async requestPermission() { return "granted"; },
      };
    }

    function makeDirHandle(node) {
      // Live lookups against node.children — not a snapshot Map —
      // since move() rewires children at runtime.
      const find = (name) => node.children.find((c) => c.name === name);
      const handle = {
        kind: "directory",
        name: node.name,
        __node: node, // exposed so move(destDirHandle, name) can re-target
        async getFileHandle(name, opts = {}) {
          const child = find(name);
          if (child?.kind === "file") return makeFileHandle(child, node);
          if (child?.kind === "directory") {
            const err = new Error(`${name} is a directory, not a file`);
            err.name = "TypeMismatchError";
            throw err;
          }
          if (opts.create) {
            const created = { kind: "file", name, content: "" };
            node.children.push(created);
            return makeFileHandle(created, node);
          }
          const err = new Error(`No file named ${name}`);
          err.name = "NotFoundError";
          throw err;
        },
        async getDirectoryHandle(name, opts = {}) {
          const child = find(name);
          if (child?.kind === "directory") return makeDirHandle(child);
          if (child?.kind === "file") {
            const err = new Error(`${name} is a file, not a directory`);
            err.name = "TypeMismatchError";
            throw err;
          }
          if (opts.create) {
            const created = { kind: "directory", name, children: [] };
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
                ? makeFileHandle(child, node)
                : makeDirHandle(child),
            ];
          }
        },
        async *values() { for (const [, h] of handle.entries()) yield h; },
        async *keys() { for (const c of node.children) yield c.name; },
        async queryPermission() { return "granted"; },
        async requestPermission() { return "granted"; },
        async removeEntry(name) {
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
