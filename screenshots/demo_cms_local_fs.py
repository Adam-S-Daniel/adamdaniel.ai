#!/usr/bin/env python3
"""
Sveltia CMS demo — File System Access API mock.

Key learnings (see skill: sveltia-cms-headless-demo):
  • Sveltia checks for .git/ in the selected directory → include it in the mock
  • IDBObjectStore can't store mock objects (functions fail structured clone)
    → patch put/get to substitute {__mockHandleId} placeholders
  • Google Fonts blocked in headless Chromium → route fonts.googleapis.com to
    a local @font-face that points to vendor/fonts/material-symbols-outlined.woff2
    The FULL .material-symbols-outlined CSS class must be in the response, not
    just the @font-face rule, or ligature rendering won't activate
  • Sidebar nav items are button[role="option"] in the document root (no shadow DOM)
  • "New" button text is "edit\\nNew" (icon ligature + label) → use .includes()
  • Title input is at x≈20 (form left-edge, no sidebar when editing) → filter
    by r.y > 100 && r.width > 200 to exclude the search bar (y=12)
  • Body editor is a div[contenteditable] at x=20, y≈1080 → scroll 300 px then
    filter by r.width > 300 (NOT r.x > 200)
"""
import asyncio
import json
import os
import subprocess
import threading
import http.server
from pathlib import Path
from playwright.async_api import async_playwright, Page, BrowserContext

REPO_ROOT = Path("/home/user/adamdaniel.ai")
OUT       = REPO_ROOT / "screenshots"
PORT      = 8774
ADMIN_URL = f"http://localhost:{PORT}/admin/index-local.html"

CHROMIUM_ARGS = [
    "--no-sandbox", "--disable-setuid-sandbox",
    "--disable-dev-shm-usage", "--disable-web-security",
    "--allow-running-insecure-content",
]

# Full CSS for Material Symbols (font-face + class) served locally
# so headless Chromium never needs fonts.googleapis.com
LOCAL_FONT_CSS = f"""
@font-face {{
  font-family: "Material Symbols Outlined";
  font-style: normal;
  font-weight: 100 700;
  font-display: block;
  src: url("http://localhost:{PORT}/admin/vendor/fonts/material-symbols-outlined.woff2")
       format("woff2");
}}
.material-symbols-outlined {{
  font-family: "Material Symbols Outlined";
  font-weight: normal;
  font-style: normal;
  font-size: 24px;
  line-height: 1;
  letter-spacing: normal;
  text-transform: none;
  display: inline-block;
  white-space: nowrap;
  word-wrap: normal;
  direction: ltr;
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
  font-feature-settings: "liga";
  font-variation-settings: "FILL" 0, "wght" 400, "GRAD" 0, "opsz" 24;
}}
"""

# ── Local HTTP server ─────────────────────────────────────────────────────────

def _start_server():
    handler = http.server.SimpleHTTPRequestHandler
    handler.log_message = lambda *a: None
    os.chdir(REPO_ROOT)
    with http.server.HTTPServer(("", PORT), handler) as s:
        s.serve_forever()

# ── Screenshots ───────────────────────────────────────────────────────────────

_n = 0
async def shot(page: Page, label: str, delay: int = 0) -> None:
    global _n
    if delay:
        await page.wait_for_timeout(delay)
    _n += 1
    path = str(OUT / f"cms_{_n:02d}_{label}.png")
    await page.screenshot(path=path)
    size = os.path.getsize(path)
    print(f"  [{_n:02d}] {label}  ({size:,} b)")

# ── Navigation helpers ────────────────────────────────────────────────────────

_COLLECTION_SLUGS = {
    "Posts": "posts", "Tags": "tags", "Projects": "projects", "Pages": "pages"
}

async def click_sidebar(page: Page, collection: str, wait: int = 1500) -> bool:
    """Navigate to a collection.
    From listing views: clicks the visible sidebar button[role='option'].
    From edit views (new/existing post editor): sidebar is off-screen, so falls back
    to direct hash navigation (location.hash = '#/collections/<slug>').
    """
    # Try visual click first — only works if button is on-screen
    clicked = await page.evaluate(f"""
    (() => {{
      for (const b of document.querySelectorAll('button[role="option"]')) {{
        if ((b.innerText || '').includes({json.dumps(collection)})) {{
          const r = b.getBoundingClientRect();
          if (r.width > 0 && r.y >= 0 && r.y < 900) {{
            b.click();
            return 'visual';
          }}
        }}
      }}
      return null;
    }})()
    """)
    if not clicked:
        # Sidebar is off-screen (edit mode) — navigate via page.goto hash URL.
        slug = _COLLECTION_SLUGS.get(collection)
        if slug:
            base = page.url.split("#")[0].split("?")[0]
            await page.goto(f"{base}#/collections/{slug}", wait_until="commit")
            clicked = 'hash'
    if clicked:
        await page.wait_for_timeout(wait)
        return True
    return False

async def click_button(page: Page, label: str, wait: int = 1000, min_x: int = 0) -> bool:
    """Click a button whose innerText includes label (walks shadow DOM)."""
    result = await page.evaluate(f"""
    (() => {{
      function find(root) {{
        for (const e of root.querySelectorAll('button, [role="button"]')) {{
          const t = (e.innerText || '').trim();
          const r = e.getBoundingClientRect();
          if (r.width > 0 && r.x >= {min_x} && t.includes({json.dumps(label)}))
            return {{x: r.x + r.width/2, y: r.y + r.height/2}};
        }}
        for (const e of root.querySelectorAll('*'))
          if (e.shadowRoot) {{ const f = find(e.shadowRoot); if (f) return f; }}
        return null;
      }}
      return find(document);
    }})()
    """)
    if result:
        await page.mouse.click(result['x'], result['y'])
        await page.wait_for_timeout(wait)
        return True
    return False

async def click_entry(page: Page, substring: str, wait: int = 2000) -> bool:
    """Click an entry row in the right-side listing panel."""
    result = await page.evaluate(f"""
    (() => {{
      function find(root) {{
        for (const el of root.querySelectorAll('li, tr, [role="listitem"], [role="row"]')) {{
          const r = el.getBoundingClientRect();
          if (r.x > 200 && r.width > 400 && r.height > 20) {{
            const t = el.innerText || '';
            if (t.includes({json.dumps(substring)}))
              return {{x: r.x + r.width/2, y: r.y + r.height/2, t: t.slice(0,60)}};
          }}
        }}
        for (const el of root.querySelectorAll('*'))
          if (el.shadowRoot) {{ const f = find(el.shadowRoot); if (f) return f; }}
        return null;
      }}
      return find(document);
    }})()
    """)
    if result:
        print(f"    → entry: {result.get('t','')!r}")
        await page.mouse.click(result['x'], result['y'])
        await page.wait_for_timeout(wait)
        return True
    return False

async def type_into_title(page: Page, text: str) -> bool:
    """
    Type into the post/entry Title input.
    The edit form has no sidebar; title is at x≈20, y≈156.
    Filter: y > 100 (excludes search bar at y=12) AND width > 200.
    """
    inp = await page.evaluate("""
    (() => {
      function find(root) {
        for (const el of root.querySelectorAll('input[type="text"], input:not([type])')) {
          const r = el.getBoundingClientRect();
          if (r.y > 100 && r.width > 200) return {x: r.x + r.width/2, y: r.y + r.height/2};
        }
        for (const el of root.querySelectorAll('*'))
          if (el.shadowRoot) { const f = find(el.shadowRoot); if (f) return f; }
        return null;
      }
      return find(document);
    })()
    """)
    if inp:
        await page.mouse.click(inp['x'], inp['y'])
        await page.keyboard.press("Control+a")
        await page.keyboard.type(text, delay=18)
        return True
    return False

async def scroll_into_view_and_find_editor(page: Page):
    """Scroll the body editor into view using scrollIntoView(), then return its position."""
    # Step 1: scroll the element into the viewport using scrollIntoView
    scrolled = await page.evaluate("""
    (() => {
      function find(root) {
        for (const el of root.querySelectorAll(
          '[contenteditable="true"], [contenteditable=""], .cm-content, .ProseMirror'
        )) {
          if (el.getBoundingClientRect().width > 300) {
            el.scrollIntoView({block: 'center', behavior: 'instant'});
            return true;
          }
        }
        for (const el of root.querySelectorAll('*'))
          if (el.shadowRoot) { const f = find(el.shadowRoot); if (f) return f; }
        return false;
      }
      return find(document);
    })()
    """)
    if not scrolled:
        return None
    await page.wait_for_timeout(400)
    # Step 2: get updated position after scroll
    return await page.evaluate("""
    (() => {
      function find(root) {
        for (const el of root.querySelectorAll(
          '[contenteditable="true"], [contenteditable=""], .cm-content, .ProseMirror'
        )) {
          const r = el.getBoundingClientRect();
          if (r.width > 300 && r.height > 40 && r.y >= 0 && r.y < 900)
            return {x: r.x + r.width/2, y: r.y + r.height/2};
        }
        for (const el of root.querySelectorAll('*'))
          if (el.shadowRoot) { const f = find(el.shadowRoot); if (f) return f; }
        return null;
      }
      return find(document);
    })()
    """)

async def fill_body_editor(page: Page, markdown: str) -> bool:
    """
    Find the markdown body editor and type the given markdown into it.
    Uses scrollIntoView() — window.scrollBy doesn't scroll the CMS's own container.
    """
    editor = await scroll_into_view_and_find_editor(page)
    if editor:
        await page.mouse.click(editor['x'], editor['y'])
        await page.keyboard.press("Control+a")
        await page.keyboard.press("Delete")
        await page.keyboard.type(markdown, delay=6)
        return True
    return False

async def wait_for_text(page: Page, text: str, ms: int = 20000) -> bool:
    for _ in range(ms // 400):
        if text in await page.evaluate("document.body.innerText"):
            return True
        await page.wait_for_timeout(400)
    return False

# ── File System mock builder ──────────────────────────────────────────────────

def build_fs_mock() -> str:
    files: dict[str, str] = {}
    for d in ["_posts", "_tags", "_projects", "pages", "admin"]:
        base = REPO_ROOT / d
        if not base.exists():
            continue
        for p in sorted(base.rglob("*")):
            if p.is_file() and not p.name.startswith("."):
                try:
                    files[str(p.relative_to(REPO_ROOT))] = p.read_text(errors="replace")
                except Exception:
                    pass
    cfg = REPO_ROOT / "_config.yml"
    if cfg.exists():
        files["_config.yml"] = cfg.read_text()
    print(f"  FS mock: {len(files)} files, {sum(len(v) for v in files.values()):,} bytes")
    return r"""
(function () {
  'use strict';
  var FILES = """ + json.dumps(files) + r""";
  var _h = {}, _id = 1;

  function makeFile(name, content) {
    var _c = content, id = 'f' + (_id++);
    var h = {
      kind: 'file', name: name, _mockId: id,
      queryPermission:  async () => 'granted',
      requestPermission: async () => 'granted',
      isSameEntry: async (o) => !!(o && o._mockId === id),
      getFile: async () => new File([_c], name, { type: 'text/plain', lastModified: Date.now() }),
      createWritable: async () => ({
        write: async (data) => {
          _c = (data && data.type === 'write') ? data.data : String(data);
        },
        close: async () => {}
      })
    };
    _h[id] = h; return h;
  }

  function makeDir(name, kids) {
    var ch = {}, id = 'd' + (_id++);
    if (kids) kids.forEach(k => ch[k.name] = k);
    var h = {
      kind: 'directory', name: name, _mockId: id, _ch: ch,
      queryPermission:  async () => 'granted',
      requestPermission: async () => 'granted',
      isSameEntry: async (o) => !!(o && o._mockId === id),
      getFileHandle: async (n, o = {}) => {
        if (!ch[n]) {
          if (o.create) { var f = makeFile(n, ''); ch[n] = f; return f; }
          throw Object.assign(new Error('NotFound:' + n), { name: 'NotFoundError' });
        }
        if (ch[n].kind !== 'file')
          throw Object.assign(new Error('TypeMismatch'), { name: 'TypeMismatchError' });
        return ch[n];
      },
      getDirectoryHandle: async (n, o = {}) => {
        if (!ch[n]) {
          if (o.create) { var d = makeDir(n, []); ch[n] = d; return d; }
          throw Object.assign(new Error('NotFound:' + n), { name: 'NotFoundError' });
        }
        if (ch[n].kind !== 'directory')
          throw Object.assign(new Error('TypeMismatch'), { name: 'TypeMismatchError' });
        return ch[n];
      },
      resolve: async (target) => {
        if (target && target._mockId === id) return [];
        for (var k in ch) if (ch[k]._mockId === (target && target._mockId)) return [k];
        return null;
      },
      entries:  async function* () { for (var k in ch) yield [k, ch[k]]; },
      keys:     async function* () { for (var k in ch) yield k; },
      values:   async function* () { for (var k in ch) yield ch[k]; },
      [Symbol.asyncIterator]: async function* () { for (var k in ch) yield [k, ch[k]]; }
    };
    _h[id] = h; return h;
  }

  function buildTree() {
    var dirs = { '': makeDir('adamdaniel.ai', []) };
    var paths = Object.keys(FILES);
    var dirSet = new Set(['']);
    for (var p of paths) {
      var parts = p.split('/');
      for (var j = 1; j < parts.length; j++) dirSet.add(parts.slice(0, j).join('/'));
    }
    for (var dp of Array.from(dirSet).sort()) {
      if (dp !== '') {
        var ps = dp.split('/');
        dirs[dp] = makeDir(ps[ps.length - 1], []);
      }
    }
    // .git — required by Sveltia's repo-root check
    dirs['.git'] = makeDir('.git', [
      makeFile('HEAD', 'ref: refs/heads/main\n'),
      makeFile('config', '[core]\n  repositoryformatversion = 0\n')
    ]);
    // populate files into their parent dirs
    for (var path in FILES) {
      var ps = path.split('/');
      var fname = ps[ps.length - 1];
      var parent = dirs[ps.slice(0, -1).join('/')] || dirs[''];
      parent._ch[fname] = makeFile(fname, FILES[path]);
    }
    // wire sub-dirs into parents
    for (var dp of Array.from(dirSet).sort()) {
      if (dp === '') continue;
      var ps = dp.split('/');
      var parent = dirs[ps.slice(0, -1).join('/')] || dirs[''];
      parent._ch[ps[ps.length - 1]] = dirs[dp];
    }
    dirs['']._ch['.git'] = dirs['.git'];
    return dirs[''];
  }

  var root = buildTree();
  window._mockRoot = root;
  window._mockHandles = _h;

  window.showDirectoryPicker = async () => {
    console.log('[FS] showDirectoryPicker called');
    return root;
  };

  // IDB patch: mock handles contain functions → can't be structured-cloned.
  // Store a lightweight {__mockHandleId} proxy and restore on read.
  var _origPut = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (value, key) {
    if (value && typeof value === 'object' && value._mockId)
      return _origPut.call(this, { __mockHandleId: value._mockId }, key);
    return _origPut.apply(this, arguments);
  };
  var _origGet = IDBObjectStore.prototype.get;
  IDBObjectStore.prototype.get = function (key) {
    var req = _origGet.call(this, key);
    if (!req._patched) {
      req._patched = true;
      var desc = Object.getOwnPropertyDescriptor(IDBRequest.prototype, 'result');
      Object.defineProperty(req, 'result', {
        get() {
          var r = desc.get.call(this);
          if (r && r.__mockHandleId) return window._mockHandles[r.__mockHandleId] || r;
          return r;
        },
        configurable: true
      });
    }
    return req;
  };

  console.log('[FS] mock installed — ' + Object.keys(FILES).length + ' files');
})();
"""

# ── Post body content ─────────────────────────────────────────────────────────

BODY_MARKDOWN = """\
## Why Benchmarks Lie

MMLU, HumanEval, GSM8K — each measures a narrow slice of capability. They tell you \
how a model performs on a curated test set, not in your production environment.

## What Actually Matters

When deploying LLMs you need to measure:

- **Task-specific accuracy** against a golden dataset drawn from *your* data
- **Failure-mode distribution** — not just average quality but tail behaviour
- **Latency** at expected traffic (p50, p95, p99)
- **Cost per correct answer**, not just cost per token

## Building a Real Eval Suite

Start with [your existing content](/projects/) as ground truth. \
Annotate 100–500 examples manually, then automate with LLM-as-judge.

See also the [RAG Evaluation Toolkit](/projects/rag-evaluation-toolkit/).

![Eval pipeline diagram](/assets/images/uploads/eval-pipeline.png)

## Benchmark Numbers

| Model | Accuracy | p95 latency | Cost/1 k |
|-------|----------|-------------|----------|
| GPT-4o | 91 % | 2.1 s | $5.00 |
| Claude Sonnet | 93 % | 1.8 s | $3.00 |
| Llama 3 70B | 85 % | 0.6 s | $0.90 |

## Conclusion

Measure what matters. Ship with confidence.
"""

# ── Main ─────────────────────────────────────────────────────────────────────

async def main():
    print("=" * 60)
    print("  Sveltia CMS — FS API demo")
    print(f"  Output: {OUT}")
    print("=" * 60)

    for f in OUT.glob("cms_*.png"): f.unlink()
    for f in OUT.glob("cms-demo-video.*"): f.unlink()

    fs_mock = build_fs_mock()

    # Start HTTP server
    threading.Thread(target=_start_server, daemon=True).start()
    await asyncio.sleep(0.4)

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True, args=CHROMIUM_ARGS)
        ctx: BrowserContext = await browser.new_context(
            viewport={"width": 1440, "height": 900},
            color_scheme="dark",
            record_video_dir=str(OUT),
            record_video_size={"width": 1440, "height": 900},
        )
        await ctx.add_init_script(fs_mock)

        # Route Google Fonts → local font (must include full .material-symbols-outlined
        # class, not just @font-face, or ligature rendering won't activate)
        async def _font_route(route):
            url = route.request.url
            if "fonts.googleapis.com" in url:
                await route.fulfill(status=200,
                                    content_type="text/css; charset=utf-8",
                                    body=LOCAL_FONT_CSS)
            elif "fonts.gstatic.com" in url:
                await route.abort()
            else:
                await route.continue_()
        await ctx.route("**/*", _font_route)

        page = await ctx.new_page()
        logs = []
        page.on("console", lambda m: logs.append(f"[{m.type}] {m.text}"))

        # ── 1. Branded loading screen ────────────────────────────────────────
        print("\n1. Loading screen…")
        # Use "commit" to capture page before Sveltia JS runs (shows our loading overlay)
        await page.goto(ADMIN_URL, wait_until="commit")
        await shot(page, "loading_screen")              # before any JS fires

        await page.wait_for_load_state("domcontentloaded")
        await page.wait_for_timeout(6000)
        await shot(page, "login_screen")

        # ── 2. Enter local repository mode ───────────────────────────────────
        print("2. Entering local repository mode…")
        # Click button with no post-click wait so we can screenshot the transition
        await click_button(page, "Work with Local Repository", wait=0)
        await page.wait_for_timeout(200)
        await shot(page, "work_with_local_repo_clicked")  # login screen or brief loader

        await wait_for_text(page, "Posts")
        await shot(page, "cms_loaded_collections")
        print("   Collections visible:", [c for c in ["Posts","Tags","Projects","Pages"]
                                          if c in await page.evaluate("document.body.innerText")])

        # ── 3. Existing post — open & edit ───────────────────────────────────
        print("3. Opening existing post…")
        await click_sidebar(page, "Posts")
        await shot(page, "posts_listing")

        await click_entry(page, "Building", wait=2500)
        await shot(page, "existing_post_open")

        # Edit the title
        await type_into_title(page, "Building Production AI Agents with LangGraph (2025 Edition)")
        await shot(page, "existing_post_title_edited", delay=400)

        # Scroll to see the body editor with its existing content (use scrollIntoView)
        await page.evaluate("""
        (() => {
          function find(root) {
            for (const el of root.querySelectorAll(
              '[contenteditable="true"], [contenteditable=""], .cm-content, .ProseMirror'
            )) {
              if (el.getBoundingClientRect().width > 300) {
                el.scrollIntoView({block: 'center', behavior: 'instant'});
                return true;
              }
            }
            for (const el of root.querySelectorAll('*'))
              if (el.shadowRoot) { const f = find(el.shadowRoot); if (f) return f; }
            return false;
          }
          return find(document);
        })()
        """)
        await page.wait_for_timeout(500)
        await shot(page, "existing_post_body_editor")

        # Save the edits
        await page.evaluate("window.scrollTo(0, 0)")
        await click_button(page, "Save", min_x=900, wait=2000)
        await shot(page, "existing_post_saved", delay=300)

        # ── 4. New blog post ─────────────────────────────────────────────────
        print("4. Creating new post…")
        await click_sidebar(page, "Posts")
        # "New" button text is "edit\nNew" (icon ligature + label)
        await click_button(page, "New", min_x=400, wait=2500)
        await shot(page, "new_post_empty")

        # Title
        await type_into_title(page, "Evaluating LLMs in Production: Beyond Benchmark Numbers")
        await shot(page, "new_post_title_typed", delay=400)

        # Check a tag — find by text content (innerText structure varies in Sveltia)
        tag_pos = await page.evaluate("""
        (() => {
          // Strategy 1: find element whose trimmed textContent is exactly "AI Engineering"
          for (const el of document.querySelectorAll('span, div, label, li')) {
            if ((el.textContent || '').trim() === 'AI Engineering') {
              const r = el.getBoundingClientRect();
              if (r.width > 0 && r.y > 60 && r.y < 900)
                return {x: r.x + r.width/2, y: r.y + r.height/2};
            }
          }
          // Strategy 2: find checkbox whose ancestor contains "AI Engineering"
          for (const cb of document.querySelectorAll('input[type="checkbox"]')) {
            const p = cb.closest('div, li, tr') || cb.parentElement;
            if (p && (p.textContent || '').includes('AI Engineering')) {
              const r = cb.getBoundingClientRect();
              if (r.width > 0 && r.y > 60 && r.y < 900)
                return {x: r.x + r.width/2, y: r.y + r.height/2};
            }
          }
          return null;
        })()
        """)
        if tag_pos:
            await page.mouse.click(tag_pos['x'], tag_pos['y'])
            await page.wait_for_timeout(500)
        await shot(page, "new_post_tag_selected")

        # Body editor — scroll to it, type rich markdown
        print("   Filling body editor…")
        found = await fill_body_editor(page, BODY_MARKDOWN)
        print(f"   Body editor found: {found}")
        await shot(page, "new_post_body_filled", delay=500)

        # Scroll to Published toggle and enable it.
        # After fill_body_editor (which scrolls form down), Published toggle is above viewport.
        # Use force=True to bypass interactivity checks and dispatch events directly.
        try:
            await page.click('[role="switch"]', force=True, timeout=3000)
            await page.wait_for_timeout(400)
        except Exception as e:
            print(f"   toggle click error: {e}")
        await shot(page, "new_post_published_toggled")

        # Save — button is in fixed top-right header, accessible regardless of scroll
        await click_button(page, "Save", min_x=900, wait=2500)
        await shot(page, "new_post_saved", delay=500)

        # After saving a NEW post, Sveltia stays on the editor.
        # Hash navigation / sidebar JS click doesn't work from the edit view —
        # reload the CMS and re-initialize to reach other collections.
        body_text = await page.evaluate("document.body.innerText")
        if "Creating Post" in body_text or "Editing Post" in body_text:
            print("   Reloading CMS to escape the new post editor…")
            await page.reload(wait_until="domcontentloaded")
            await page.wait_for_timeout(5000)
            await click_button(page, "Work with Local Repository", wait=0)
            await wait_for_text(page, "Posts", ms=10000)
            await page.wait_for_timeout(1000)

        # ── 5. Tags ──────────────────────────────────────────────────────────
        print("5. Tags collection…")
        await click_sidebar(page, "Tags", wait=2000)
        await shot(page, "tags_listing")

        await click_button(page, "New", min_x=400, wait=2500)
        await shot(page, "new_tag_empty")

        # Name field (first input below header)
        await type_into_title(page, "LLMs")
        await page.wait_for_timeout(200)

        # Slug field (second text input)
        slug = await page.evaluate("""
        (() => {
          function find(root) {
            var inputs = Array.from(root.querySelectorAll('input[type="text"], input:not([type])'))
              .filter(el => { const r = el.getBoundingClientRect(); return r.y > 100 && r.width > 100; });
            if (inputs.length > 1) {
              const r = inputs[1].getBoundingClientRect();
              return {x: r.x + r.width/2, y: r.y + r.height/2};
            }
            return null;
          }
          for (const el of document.querySelectorAll('*'))
            if (el.shadowRoot) { const f = find(el.shadowRoot); if (f) return f; }
          return find(document);
        })()
        """)
        if slug:
            await page.mouse.click(slug['x'], slug['y'])
            await page.keyboard.press("Control+a")
            await page.keyboard.type("llms", delay=20)
        await shot(page, "new_tag_filled", delay=300)

        await click_button(page, "Save", min_x=900, wait=1500)
        await shot(page, "new_tag_saved", delay=300)

        # ── 6. Projects ──────────────────────────────────────────────────────
        print("6. Projects collection…")
        await click_sidebar(page, "Projects", wait=2000)
        await shot(page, "projects_listing")

        await click_button(page, "New", min_x=400, wait=2500)
        await type_into_title(page, "Prompt Evaluation Dashboard")
        await shot(page, "new_project_title_filled", delay=400)

        # Description (textarea or next field) - scroll down to show more fields
        desc = await page.evaluate("""
        (() => {
          // find a textarea or second text input below the title
          const inputs = Array.from(document.querySelectorAll('textarea, input[type="text"], input:not([type])'))
            .filter(el => { const r = el.getBoundingClientRect(); return r.y > 100 && r.width > 200; });
          if (inputs.length > 1) {
            inputs[1].scrollIntoView({block: 'center', behavior: 'instant'});
            return true;
          }
          return false;
        })()
        """)
        await page.wait_for_timeout(400)
        await shot(page, "new_project_more_fields")

        await page.evaluate("window.scrollTo(0, 0)")
        await click_button(page, "Save", min_x=900, wait=1500)
        await shot(page, "new_project_saved", delay=300)

        # ── 7. Pages — About Me ──────────────────────────────────────────────
        print("7. Pages — About Me…")
        await click_sidebar(page, "Pages", wait=2000)
        await shot(page, "pages_listing")

        await click_entry(page, "About", wait=2000)
        await shot(page, "about_editor_open")

        await page.evaluate("""
        (() => {
          function find(root) {
            for (const el of root.querySelectorAll(
              '[contenteditable="true"], [contenteditable=""], .cm-content, .ProseMirror'
            )) {
              if (el.getBoundingClientRect().width > 300) {
                el.scrollIntoView({block: 'center', behavior: 'instant'});
                return true;
              }
            }
            for (const el of root.querySelectorAll('*'))
              if (el.shadowRoot) { const f = find(el.shadowRoot); if (f) return f; }
            return false;
          }
          return find(document);
        })()
        """)
        await page.wait_for_timeout(500)
        await shot(page, "about_body_visible")

        # ── 8. Final overview ────────────────────────────────────────────────
        print("8. Final overview…")
        await click_sidebar(page, "Posts", wait=2000)
        await shot(page, "final_posts_overview")

        print("\nClosing…")
        await ctx.close()
        await browser.close()

    # Convert to MP4
    webms = sorted(OUT.glob("*.webm"), key=lambda p: p.stat().st_mtime)
    if webms:
        mp4 = OUT / "cms-demo-video.mp4"
        r = subprocess.run(
            ["ffmpeg", "-y", "-i", str(webms[-1]),
             "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart",
             str(mp4)],
            capture_output=True, text=True
        )
        if r.returncode == 0:
            webms[-1].unlink()
            print(f"Video: cms-demo-video.mp4  ({mp4.stat().st_size/1e6:.1f} MB)")
        else:
            print(f"ffmpeg error: {r.stderr[-300:]}")

    fs_logs = [l for l in logs if "[FS]" in l or "[IDB]" in l]
    print(f"\nFS/IDB ops: {len(fs_logs)}")
    for l in fs_logs: print(f"  {l}")
    print(f"\nDone — {_n} screenshots in {OUT}")


if __name__ == "__main__":
    asyncio.run(main())
