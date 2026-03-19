#!/usr/bin/env python3
"""
Sveltia CMS demo using the File System Access API mock.

Sveltia CMS's "Work with Local Repository" uses window.showDirectoryPicker()
(the browser's native File System Access API).  In headless Chromium this
dialog can't be shown, so we inject a full in-memory mock backed by the actual
repo files before the page loads.  We also patch IndexedDB so Sveltia CMS can
persist the (non-serializable) mock handle across route transitions.

Flow:
  1. Inject mock showDirectoryPicker() + IDB patch via addInitScript
  2. Load the CMS admin page
  3. Click "Work with Local Repository"
  4. Navigate all collections — Posts, Tags, Projects, Pages
  5. Edit an existing post, add a new post, add a tag, add a project
  6. Screenshot + video every step
"""
import asyncio, json, os
from pathlib import Path
from playwright.async_api import async_playwright, Page

REPO_ROOT = Path("/home/user/adamdaniel.ai")
OUT       = Path(os.path.dirname(os.path.abspath(__file__)))
ADMIN_URL = "http://localhost:8766/admin/index-local.html"

CHROMIUM_ARGS = [
    "--no-sandbox", "--disable-setuid-sandbox",
    "--disable-dev-shm-usage", "--disable-web-security",
    "--allow-running-insecure-content",
]

# ── Screenshots ──────────────────────────────────────────────────────────────
n = 0
def next_shot(label):
    global n; n += 1
    return str(OUT / f"cms_{n:02d}_{label}.png")

async def shot(page, label, full_page=False, delay=600):
    await page.wait_for_timeout(delay)
    path = next_shot(label)
    await page.screenshot(path=path, full_page=full_page)
    size = os.path.getsize(path)
    print(f"  [{n:02d}] {label}  ({size:,} b)")
    return path

# ── Shadow-DOM helpers ───────────────────────────────────────────────────────

async def find_by_text(page: Page, text: str, tag: str = "button"):
    """Return {x, y} coords of first element whose innerText includes `text`."""
    return await page.evaluate(f"""
    (function() {{
      function find(root) {{
        for (const el of root.querySelectorAll('{tag}, [role="button"], [role="link"], a')) {{
          if (el.innerText && el.innerText.includes({json.dumps(text)})) {{
            const r = el.getBoundingClientRect();
            if (r.width > 0) return {{x: r.x+r.width/2, y: r.y+r.height/2, text: el.innerText.trim()}};
          }}
        }}
        for (const el of root.querySelectorAll('*')) {{
          if (el.shadowRoot) {{ const f = find(el.shadowRoot); if (f) return f; }}
        }}
        return null;
      }}
      return find(document);
    }})()
    """)

async def click_text(page: Page, text: str, wait: int = 1500):
    """Click first element whose visible text includes `text`."""
    info = await find_by_text(page, text)
    if info:
        await page.mouse.click(info['x'], info['y'])
        await page.wait_for_timeout(wait)
        return True
    return False

async def body_text(page: Page) -> str:
    return await page.evaluate("document.body.innerText")

async def wait_for_text(page: Page, text: str, timeout_ms: int = 20000) -> bool:
    """Poll until `text` appears in body, or timeout."""
    elapsed = 0
    while elapsed < timeout_ms:
        t = await body_text(page)
        if text in t:
            return True
        await page.wait_for_timeout(500)
        elapsed += 500
    return False

# ── File System Access API + IDB mock ────────────────────────────────────────

def build_fs_mock() -> str:
    """Build the JS init script with real repo file contents embedded."""
    # Collect real files
    def read_files(directory: Path, rel_prefix: str = "") -> list:
        """Return list of (relative_path, content_str) for all files."""
        results = []
        if not directory.exists():
            return results
        for entry in sorted(directory.iterdir()):
            if entry.name.startswith(".") or entry.name in {"__pycache__", "_site", "node_modules"}:
                continue
            rel = f"{rel_prefix}/{entry.name}" if rel_prefix else entry.name
            if entry.is_file():
                try:
                    content = entry.read_text(errors="replace")
                    results.append((rel, content))
                except Exception:
                    pass
            elif entry.is_dir():
                results.extend(read_files(entry, rel))
        return results

    files = {}
    for d in ["_posts", "_tags", "_projects", "pages", "admin"]:
        for rel, content in read_files(REPO_ROOT / d, d):
            files[rel] = content

    # Add _config.yml
    cfg = (REPO_ROOT / "_config.yml")
    if cfg.exists():
        files["_config.yml"] = cfg.read_text()

    files_json = json.dumps(files)
    print(f"  FS mock: {len(files)} files, {len(files_json):,} bytes")

    return r"""
(function() {
  'use strict';

  var FILES = """ + files_json + r""";

  var _handles = {};
  var _nid = 1;

  function makeFile(name, content) {
    var _c = content;
    var id = 'f' + (_nid++);
    var h = {
      kind: 'file', name: name, _mockId: id,
      queryPermission: async function() { return 'granted'; },
      requestPermission: async function() { return 'granted'; },
      isSameEntry: async function(o) { return !!(o && o._mockId === id); },
      getFile: async function() { return new File([_c], name, {type:'text/plain',lastModified:Date.now()}); },
      createWritable: async function() {
        return {
          write: async function(data) { _c = (data && data.type === 'write') ? data.data : String(data); },
          close: async function() { console.log('[FS] wrote: ' + name); }
        };
      }
    };
    _handles[id] = h;
    return h;
  }

  function makeDir(name, childList) {
    var ch = {};
    if (childList) for (var i=0;i<childList.length;i++) ch[childList[i].name] = childList[i];
    var id = 'd' + (_nid++);
    var h = {
      kind: 'directory', name: name, _mockId: id,
      queryPermission: async function() { return 'granted'; },
      requestPermission: async function() { return 'granted'; },
      isSameEntry: async function(o) { return !!(o && o._mockId === id); },
      getFileHandle: async function(n, opts) {
        opts = opts || {};
        if (!ch[n]) {
          if (opts.create) { var f=makeFile(n,''); ch[n]=f; return f; }
          throw Object.assign(new Error('NotFound:'+n), {name:'NotFoundError'});
        }
        if (ch[n].kind !== 'file') throw Object.assign(new Error('TypeMismatch'), {name:'TypeMismatchError'});
        return ch[n];
      },
      getDirectoryHandle: async function(n, opts) {
        opts = opts || {};
        if (!ch[n]) {
          if (opts.create) { var d=makeDir(n,[]); ch[n]=d; return d; }
          throw Object.assign(new Error('NotFound:'+n), {name:'NotFoundError'});
        }
        if (ch[n].kind !== 'directory') throw Object.assign(new Error('TypeMismatch'), {name:'TypeMismatchError'});
        return ch[n];
      },
      resolve: async function(target) {
        if (target && target._mockId === id) return [];
        for (var k in ch) if (ch[k]._mockId === (target && target._mockId)) return [k];
        return null;
      },
      entries: async function*() { for (var k in ch) yield [k, ch[k]]; },
      keys:    async function*() { for (var k in ch) yield k; },
      values:  async function*() { for (var k in ch) yield ch[k]; },
      [Symbol.asyncIterator]: async function*() { for (var k in ch) yield [k, ch[k]]; }
    };
    _handles[id] = h;
    return h;
  }

  // Build tree from FILES dict
  function buildTree() {
    // Parse flat path list into nested structure
    var dirs = {};
    dirs[''] = makeDir('adamdaniel.ai', null);
    // We'll add children after creating all dirs

    // First pass: collect all directory paths
    var filePaths = Object.keys(FILES);
    var dirPaths = new Set(['']);
    for (var i=0;i<filePaths.length;i++) {
      var parts = filePaths[i].split('/');
      for (var j=1;j<parts.length;j++) {
        dirPaths.add(parts.slice(0,j).join('/'));
      }
    }

    // Create all dir handles
    var sortedDirs = Array.from(dirPaths).sort();
    for (var i=0;i<sortedDirs.length;i++) {
      if (sortedDirs[i] !== '') {
        var parts = sortedDirs[i].split('/');
        var dname = parts[parts.length-1];
        dirs[sortedDirs[i]] = makeDir(dname, null);
      }
    }

    // Add .git
    dirs['.git'] = makeDir('.git', [
      makeFile('HEAD', 'ref: refs/heads/main\n'),
      makeFile('config', '[core]\n  repositoryformatversion = 0\n')
    ]);

    // Second pass: populate directories with files
    for (var path in FILES) {
      var parts = path.split('/');
      var fname = parts[parts.length-1];
      var parentPath = parts.slice(0,-1).join('/');
      var parentDir = dirs[parentPath] || dirs[''];
      var fileHandle = makeFile(fname, FILES[path]);
      // Inject into parent's ch
      parentDir._addChild(fname, fileHandle);
    }

    // Wire up subdirs to parents
    for (var i=0;i<sortedDirs.length;i++) {
      var dp = sortedDirs[i];
      if (dp === '') continue;
      var parts = dp.split('/');
      var dname = parts[parts.length-1];
      var parentPath = parts.slice(0,-1).join('/');
      var parentDir = dirs[parentPath] || dirs[''];
      parentDir._addChild(dname, dirs[dp]);
    }

    // Wire .git into root
    dirs['']._addChild('.git', dirs['.git']);

    return dirs[''];
  }

  // Patch makeDir to support _addChild
  var _origMakeDir = makeDir;
  makeDir = function(name, childList) {
    var ch = {};
    if (childList) for (var i=0;i<childList.length;i++) ch[childList[i].name] = childList[i];
    var id = 'd' + (_nid++);
    var h = {
      kind: 'directory', name: name, _mockId: id,
      _addChild: function(n, c) { ch[n] = c; },
      queryPermission: async function() { return 'granted'; },
      requestPermission: async function() { return 'granted'; },
      isSameEntry: async function(o) { return !!(o && o._mockId === id); },
      getFileHandle: async function(n, opts) {
        opts = opts || {};
        if (!ch[n]) {
          if (opts.create) { var f=makeFile(n,''); ch[n]=f; return f; }
          throw Object.assign(new Error('NotFound:'+n), {name:'NotFoundError'});
        }
        if (ch[n].kind !== 'file') throw Object.assign(new Error('TypeMismatch'), {name:'TypeMismatchError'});
        return ch[n];
      },
      getDirectoryHandle: async function(n, opts) {
        opts = opts || {};
        if (!ch[n]) {
          if (opts.create) { var d=makeDir(n,[]); ch[n]=d; return d; }
          throw Object.assign(new Error('NotFound:'+n), {name:'NotFoundError'});
        }
        if (ch[n].kind !== 'directory') throw Object.assign(new Error('TypeMismatch'), {name:'TypeMismatchError'});
        return ch[n];
      },
      resolve: async function(target) {
        if (target && target._mockId === id) return [];
        for (var k in ch) if (ch[k]._mockId === (target && target._mockId)) return [k];
        return null;
      },
      entries: async function*() { for (var k in ch) yield [k, ch[k]]; },
      keys:    async function*() { for (var k in ch) yield k; },
      values:  async function*() { for (var k in ch) yield ch[k]; },
      [Symbol.asyncIterator]: async function*() { for (var k in ch) yield [k, ch[k]]; }
    };
    _handles[id] = h;
    return h;
  };

  var root = buildTree();
  window._mockRoot = root;
  window._mockHandles = _handles;

  window.showDirectoryPicker = async function() {
    console.log('[FS] showDirectoryPicker called — returning mock root');
    return root;
  };

  // Patch IndexedDB so mock handles (non-cloneable) can be stored
  var _origPut = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function(value, key) {
    if (value && typeof value === 'object' && value._mockId) {
      console.log('[IDB] intercepting put of mock handle: ' + value._mockId);
      return _origPut.call(this, {__mockHandleId: value._mockId}, key);
    }
    return _origPut.apply(this, arguments);
  };

  var _origGet = IDBObjectStore.prototype.get;
  IDBObjectStore.prototype.get = function(key) {
    var req = _origGet.call(this, key);
    if (!req._resultPatched) {
      req._resultPatched = true;
      var _origResultDesc = Object.getOwnPropertyDescriptor(IDBRequest.prototype, 'result');
      Object.defineProperty(req, 'result', {
        get: function() {
          var r = _origResultDesc.get.call(this);
          if (r && r.__mockHandleId) {
            console.log('[IDB] restoring mock handle: ' + r.__mockHandleId);
            return window._mockHandles[r.__mockHandleId] || r;
          }
          return r;
        },
        configurable: true
      });
    }
    return req;
  };

  console.log('[FS] Mock installed — ' + Object.keys(FILES).length + ' files + .git');
})();
"""

# ── Main demo ────────────────────────────────────────────────────────────────

async def main():
    print("=" * 60)
    print("  Sveltia CMS — File System Access API demo")
    print(f"  Output: {OUT}")
    print("=" * 60)
    print()

    fs_mock = build_fs_mock()

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True, args=CHROMIUM_ARGS)
        ctx = await browser.new_context(
            viewport={"width": 1440, "height": 900},
            color_scheme="dark",
            record_video_dir=str(OUT),
            record_video_size={"width": 1440, "height": 900},
        )
        await ctx.add_init_script(fs_mock)

        page = await ctx.new_page()
        logs = []
        page.on("console", lambda m: logs.append(f"[{m.type}] {m.text}"))

        # ── 1. Load admin page ───────────────────────────────────────────────
        print("1. Loading CMS…")
        await page.goto(ADMIN_URL, wait_until="domcontentloaded")
        await shot(page, "loading_screen", delay=400)
        await page.wait_for_timeout(7000)
        await shot(page, "login_screen", delay=200)

        bt = await body_text(page)
        print(f"  Login screen: {'Work with Local Repository' in bt}")

        # ── 2. Click "Work with Local Repository" ───────────────────────────
        print("2. Entering local repository mode…")
        clicked = await click_text(page, "Work with Local Repository", wait=3000)
        print(f"  Clicked: {clicked}")
        await shot(page, "after_local_repo_click", delay=200)

        # ── 3. Wait for CMS to load collections ─────────────────────────────
        print("3. Waiting for CMS collections…")
        loaded = await wait_for_text(page, "Posts", timeout_ms=20000)
        print(f"  CMS loaded: {loaded}")
        await shot(page, "cms_loaded")

        bt = await body_text(page)
        print(f"  Collections visible: {[c for c in ['Posts','Tags','Projects','Pages'] if c in bt]}")

        # ── 4. Posts listing ─────────────────────────────────────────────────
        print("4. Posts collection…")
        await click_text(page, "Posts", wait=2000)
        await shot(page, "posts_listing", full_page=False)

        # ── 5. Open existing post ────────────────────────────────────────────
        print("5. Opening existing post…")
        # Find first post entry card
        entry = await page.evaluate("""
        () => {
          function find(root) {
            // Look for entry list items
            for (const el of root.querySelectorAll('li, [class*="entry"], [class*="card"], [class*="item"]')) {
              const r = el.getBoundingClientRect();
              if (r.width > 200 && r.height > 20) {
                const text = el.innerText || '';
                if (text.includes('Structured') || text.includes('RAG') || text.includes('Agent')) {
                  return {x: r.x+r.width/2, y: r.y+r.height/2, text: text.slice(0,50)};
                }
              }
            }
            for (const el of root.querySelectorAll('*')) {
              if (el.shadowRoot) { const f=find(el.shadowRoot); if(f) return f; }
            }
            return null;
          }
          return find(document);
        }
        """)
        if entry:
            print(f"  Entry: {entry['text']!r}")
            await page.mouse.click(entry['x'], entry['y'])
            await page.wait_for_timeout(2500)
            await shot(page, "post_editor_open", full_page=False)

            # Scroll to see more
            await page.evaluate("window.scrollBy(0, 300)")
            await page.wait_for_timeout(500)
            await shot(page, "post_editor_body", full_page=False)

            # Try toggling published
            toggled = await click_text(page, "Published", wait=500)
            if not toggled:
                # Try role=switch
                sw = await page.evaluate("""
                () => {
                  function find(root) {
                    for (const el of root.querySelectorAll('[role="switch"], input[type="checkbox"]')) {
                      const r = el.getBoundingClientRect();
                      if (r.width > 0) return {x:r.x+r.width/2, y:r.y+r.height/2};
                    }
                    for (const el of root.querySelectorAll('*')) {
                      if (el.shadowRoot) { const f=find(el.shadowRoot); if(f) return f; }
                    }
                    return null;
                  }
                  return find(document);
                }
                """)
                if sw:
                    await page.mouse.click(sw['x'], sw['y'])
                    await page.wait_for_timeout(500)
            await shot(page, "post_toggle_published", full_page=False)

            # Go back
            await page.go_back()
            await page.wait_for_timeout(1500)
        else:
            print("  No entry found, skipping")

        # ── 6. New blog post ─────────────────────────────────────────────────
        print("6. Creating new blog post…")
        await click_text(page, "Posts", wait=1500)
        await click_text(page, "New", wait=2000)
        await shot(page, "new_post_empty")

        # Fill title via keyboard
        title_filled = False
        # Find any text input that's visible
        inp = await page.evaluate("""
        () => {
          function find(root) {
            for (const el of root.querySelectorAll('input[type="text"], input:not([type]), textarea')) {
              const r = el.getBoundingClientRect();
              if (r.width > 200) return {x: r.x+r.width/2, y: r.y+r.height/2};
            }
            for (const el of root.querySelectorAll('*')) {
              if (el.shadowRoot) { const f=find(el.shadowRoot); if(f) return f; }
            }
            return null;
          }
          return find(document);
        }
        """)
        if inp:
            await page.mouse.click(inp['x'], inp['y'])
            await page.keyboard.type("Evaluating LLMs in Production: Beyond Benchmark Numbers", delay=15)
            title_filled = True
            await page.wait_for_timeout(400)
        print(f"  Title filled: {title_filled}")

        await shot(page, "new_post_title_filled")

        # Scroll down to see more fields
        await page.evaluate("window.scrollBy(0, 250)")
        await page.wait_for_timeout(400)
        await shot(page, "new_post_fields_visible")

        # Try the body/markdown editor
        editor = await page.evaluate("""
        () => {
          function find(root) {
            for (const el of root.querySelectorAll('.ProseMirror, [contenteditable="true"], .cm-content')) {
              const r = el.getBoundingClientRect();
              if (r.width > 200 && r.height > 50) return {x:r.x+r.width/2, y:r.y+r.height/2};
            }
            for (const el of root.querySelectorAll('*')) {
              if (el.shadowRoot) { const f=find(el.shadowRoot); if(f) return f; }
            }
            return null;
          }
          return find(document);
        }
        """)
        if editor:
            await page.mouse.click(editor['x'], editor['y'])
            await page.keyboard.type(
                "## The Problem with Benchmarks\n\n"
                "MMLU, HumanEval, GSM8K — useful signals, not production guarantees.\n\n"
                "## What Actually Matters\n\n"
                "- Task-specific accuracy against a golden dataset\n"
                "- Failure mode distribution — not just average quality\n"
                "- Latency and cost at your expected traffic levels\n",
                delay=10
            )
            await page.wait_for_timeout(400)
        await shot(page, "new_post_published", full_page=False)

        # Try to save
        saved = await click_text(page, "Save", wait=2000)
        if not saved:
            await click_text(page, "Publish", wait=2000)
        await shot(page, "new_post_saved", full_page=False)

        # ── 7. Tags collection ───────────────────────────────────────────────
        print("7. Tags collection…")
        await click_text(page, "Tags", wait=2000)
        await shot(page, "tags_listing")

        await click_text(page, "New", wait=2000)
        await shot(page, "new_tag_form")

        # Fill name field
        inp = await page.evaluate("""
        () => {
          function find(root) {
            for (const el of root.querySelectorAll('input[type="text"], input:not([type])')) {
              const r = el.getBoundingClientRect();
              if (r.width > 100) return {x: r.x+r.width/2, y: r.y+r.height/2};
            }
            for (const el of root.querySelectorAll('*')) {
              if (el.shadowRoot) { const f=find(el.shadowRoot); if(f) return f; }
            }
            return null;
          }
          return find(document);
        }
        """)
        if inp:
            await page.mouse.click(inp['x'], inp['y'])
            await page.keyboard.type("LLMs", delay=30)
            await page.wait_for_timeout(300)
        await shot(page, "new_tag_filled")

        await click_text(page, "Save", wait=1500)
        await shot(page, "new_tag_saved")

        # ── 8. Projects collection ────────────────────────────────────────────
        print("8. Projects collection…")
        await click_text(page, "Projects", wait=2000)
        await shot(page, "projects_listing")

        await click_text(page, "New", wait=2000)
        await shot(page, "new_project_form")

        inp = await page.evaluate("""
        () => {
          function find(root) {
            for (const el of root.querySelectorAll('input[type="text"], input:not([type])')) {
              const r = el.getBoundingClientRect();
              if (r.width > 200) return {x: r.x+r.width/2, y: r.y+r.height/2};
            }
            for (const el of root.querySelectorAll('*')) {
              if (el.shadowRoot) { const f=find(el.shadowRoot); if(f) return f; }
            }
            return null;
          }
          return find(document);
        }
        """)
        if inp:
            await page.mouse.click(inp['x'], inp['y'])
            await page.keyboard.type("Prompt Evaluation Dashboard", delay=20)
            await page.wait_for_timeout(300)
        await shot(page, "new_project_title")

        await page.evaluate("window.scrollBy(0, 300)")
        await page.wait_for_timeout(300)
        await shot(page, "new_project_more_fields")

        await click_text(page, "Save", wait=1500)
        await shot(page, "new_project_saved")

        # ── 9. Pages — About Me ───────────────────────────────────────────────
        print("9. Pages — About Me…")
        await click_text(page, "Pages", wait=2000)
        await shot(page, "pages_listing")

        # Click About
        about = await find_by_text(page, "About")
        if about:
            await page.mouse.click(about['x'], about['y'])
            await page.wait_for_timeout(2000)
        await shot(page, "about_editor", full_page=False)

        # Scroll to body editor
        await page.evaluate("window.scrollBy(0, 300)")
        await page.wait_for_timeout(400)
        await shot(page, "about_body_editor", full_page=False)

        # ── 10. Final overview ────────────────────────────────────────────────
        print("10. Final overview…")
        await click_text(page, "Posts", wait=2500)
        await shot(page, "final_posts_overview", full_page=False)

        # ── Done ─────────────────────────────────────────────────────────────
        print("\nClosing and finalising video…")
        await ctx.close()
        await browser.close()

        # Rename video
        videos = sorted(OUT.glob("*.webm"), key=lambda p: p.stat().st_mtime)
        if videos:
            latest = videos[-1]
            dest = OUT / "cms-demo-video.webm"
            if dest.exists():
                dest.unlink()
            latest.rename(dest)
            mb = dest.stat().st_size / 1_048_576
            print(f"\nVideo: {dest}  ({mb:.1f} MB)")

    # FS operation summary
    fs_logs = [l for l in logs if "[FS]" in l or "[IDB]" in l]
    print(f"\n  FS/IDB operations: {len(fs_logs)}")
    for l in fs_logs:
        print(f"    {l}")

    print(f"\nDone — {n} screenshots + video in {OUT}\n")


if __name__ == "__main__":
    asyncio.run(main())
