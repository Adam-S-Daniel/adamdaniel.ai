#!/usr/bin/env python3
"""
Full Sveltia CMS demo with mocked GitHub API.

Strategy:
- Intercept all github.com / api.github.com calls via page.route()
- Return realistic mock responses backed by the real local files
- Click "Sign In with GitHub Using Token", provide a dummy token
- Navigate through all collections: Posts, Tags, Projects, Pages
- Edit content, create new entries, capture screenshots + video

No real GitHub account or network access required.
"""
import asyncio
import base64
import hashlib
import json
import os
import re
import time
from pathlib import Path
from playwright.async_api import async_playwright, Page, Route

REPO_ROOT = Path("/home/user/adamdaniel.ai")
OUT = Path(os.path.dirname(os.path.abspath(__file__)))
ADMIN_URL = "http://localhost:8766/admin/index-local.html"
OWNER = "Adam-S-Daniel"
REPO = "adamdaniel.ai"
BRANCH = "main"
FAKE_TOKEN = "ghp_fakeDemoToken1234567890abcdefghijklmn"

CHROMIUM_ARGS = [
    "--no-sandbox", "--disable-setuid-sandbox",
    "--disable-dev-shm-usage", "--disable-web-security",
]

# ── Helpers ──────────────────────────────────────────────────────────────────

def sha1(text: str) -> str:
    return hashlib.sha1(text.encode()).hexdigest()

def b64(path: Path) -> str:
    try:
        content = path.read_text(encoding="utf-8")
    except Exception:
        content = ""
    return base64.b64encode(content.encode()).decode()

def collect_repo_files() -> list[dict]:
    """Collect all content files from the repo as GitHub tree entries."""
    relevant_dirs = ["_posts", "_tags", "_projects", "pages", "assets/images"]
    entries = []
    for rel_dir in relevant_dirs:
        d = REPO_ROOT / rel_dir
        if d.is_dir():
            for f in d.rglob("*"):
                if f.is_file() and not f.name.startswith("."):
                    rel = f.relative_to(REPO_ROOT)
                    entries.append({
                        "path": str(rel).replace("\\", "/"),
                        "mode": "100644",
                        "type": "blob",
                        "sha": sha1(str(rel)),
                        "size": f.stat().st_size,
                        "url": f"https://api.github.com/repos/{OWNER}/{REPO}/git/blobs/{sha1(str(rel))}"
                    })
    return entries

TREE_ENTRIES = collect_repo_files()
FILE_INDEX = {e["path"]: e for e in TREE_ENTRIES}

# ── Mock response builders ───────────────────────────────────────────────────

def mock_user():
    return {"login": OWNER, "name": "Adam Daniel", "id": 99999,
            "avatar_url": "", "email": "adam@adamdaniel.ai", "type": "User"}

def mock_repo():
    return {
        "id": 1, "name": REPO, "full_name": f"{OWNER}/{REPO}",
        "private": False, "default_branch": BRANCH,
        "owner": {"login": OWNER, "id": 99999, "type": "User"},
        "permissions": {"admin": True, "push": True, "pull": True},
    }

def mock_branches():
    return [{"name": BRANCH, "commit": {"sha": "abc0001", "url": ""},
             "protected": False}]

def mock_branch(name=BRANCH):
    return {"name": name, "commit": {"sha": "abc0001", "url": "",
            "commit": {"author": {"date": "2025-03-01T00:00:00Z"}, "message": "latest"}},
            "protected": False}

def mock_tree():
    return {"sha": "abc0001", "url": "",
            "tree": TREE_ENTRIES, "truncated": False}

def mock_file_content(path: str):
    local_path = REPO_ROOT / path
    try:
        raw = local_path.read_text(encoding="utf-8")
        encoded = base64.b64encode(raw.encode()).decode()
        size = len(raw)
    except FileNotFoundError:
        encoded = ""
        size = 0
    file_sha = sha1(path)
    name = Path(path).name
    return {
        "type": "file", "encoding": "base64",
        "content": encoded + "\n",
        "sha": file_sha, "name": name, "path": path, "size": size,
        "url": f"https://api.github.com/repos/{OWNER}/{REPO}/contents/{path}",
        "download_url": "",
        "git_url": f"https://api.github.com/repos/{OWNER}/{REPO}/git/blobs/{file_sha}",
    }

def mock_create_file(path: str, content: str):
    """Simulate creating/updating a file — write it to disk too."""
    try:
        decoded = base64.b64decode(content).decode("utf-8")
        local = REPO_ROOT / path
        local.parent.mkdir(parents=True, exist_ok=True)
        local.write_text(decoded, encoding="utf-8")
    except Exception as e:
        print(f"  [write] {path}: {e}")
    file_sha = sha1(path + str(time.time()))
    return {
        "content": mock_file_content(path),
        "commit": {
            "sha": file_sha, "message": f"Update {path}",
            "html_url": "", "url": "",
            "author": {"name": "Adam Daniel", "date": "2025-03-19T00:00:00Z"},
        },
    }

def json_response(route: Route, data, status=200):
    route.fulfill(
        status=status,
        content_type="application/json",
        headers={
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "*",
            "Access-Control-Allow-Methods": "*",
            "X-RateLimit-Limit": "5000",
            "X-RateLimit-Remaining": "4999",
            "X-RateLimit-Reset": str(int(time.time()) + 3600),
            "X-OAuth-Scopes": "repo,user",
        },
        body=json.dumps(data),
    )

async def setup_github_mocks(page: Page):
    """Route all GitHub API requests to our mock handlers."""

    async def handle(route: Route):
        url = route.request.url
        method = route.request.method

        # OPTIONS pre-flight
        if method == "OPTIONS":
            await route.fulfill(status=204, headers={"Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "*"})
            return

        # ── Auth ──────────────────────────────────────────────────────────
        if re.search(r"/user$", url):
            await json_response(route, mock_user()); return
        if re.search(r"/user/repos", url):
            await json_response(route, [mock_repo()]); return

        # ── Repo ──────────────────────────────────────────────────────────
        if re.search(rf"/repos/{OWNER}/{REPO}$", url):
            await json_response(route, mock_repo()); return

        # ── Branches ──────────────────────────────────────────────────────
        if re.search(rf"/repos/{OWNER}/{REPO}/branches$", url):
            await json_response(route, mock_branches()); return
        m = re.search(rf"/repos/{OWNER}/{REPO}/branches/(.+)", url)
        if m:
            await json_response(route, mock_branch(m.group(1))); return

        # ── Git refs ──────────────────────────────────────────────────────
        if re.search(rf"/repos/{OWNER}/{REPO}/git/refs", url):
            await json_response(route, [
                {"ref": f"refs/heads/{BRANCH}", "object": {"sha": "abc0001", "type": "commit",
                 "url": ""}}]); return

        # ── Git tree ──────────────────────────────────────────────────────
        if re.search(rf"/repos/{OWNER}/{REPO}/git/trees", url):
            await json_response(route, mock_tree()); return

        # ── Commits ───────────────────────────────────────────────────────
        if re.search(rf"/repos/{OWNER}/{REPO}/commits", url):
            await json_response(route, [{"sha": "abc0001", "commit": {
                "message": "latest", "author": {"date": "2025-03-19T00:00:00Z"}}}]); return
        if re.search(rf"/repos/{OWNER}/{REPO}/git/commits", url):
            await json_response(route, {"sha": "abc0001", "message": "latest",
                "tree": {"sha": "tree001"}}); return

        # ── File contents (GET) ───────────────────────────────────────────
        if method == "GET" and re.search(rf"/repos/{OWNER}/{REPO}/contents/", url):
            path_match = re.search(rf"/repos/{OWNER}/{REPO}/contents/(.+?)(\?|$)", url)
            if path_match:
                file_path = path_match.group(1)
                local = REPO_ROOT / file_path
                if local.is_dir():
                    entries = []
                    for f in local.iterdir():
                        if not f.name.startswith("."):
                            entries.append({
                                "type": "dir" if f.is_dir() else "file",
                                "name": f.name,
                                "path": str((REPO_ROOT / file_path / f.name).relative_to(REPO_ROOT)),
                                "sha": sha1(str(f)),
                                "size": f.stat().st_size if f.is_file() else 0,
                            })
                    await json_response(route, entries)
                else:
                    await json_response(route, mock_file_content(file_path))
                return

        # ── File create/update (PUT) ──────────────────────────────────────
        if method == "PUT" and re.search(rf"/repos/{OWNER}/{REPO}/contents/", url):
            path_match = re.search(rf"/repos/{OWNER}/{REPO}/contents/(.+?)(\?|$)", url)
            if path_match:
                file_path = path_match.group(1)
                try:
                    body = json.loads(route.request.post_data or "{}")
                    content = body.get("content", "")
                    result = mock_create_file(file_path, content)
                except Exception as e:
                    print(f"  [PUT error] {e}")
                    result = mock_create_file(file_path, "")
                await json_response(route, result, status=201)
                return

        # ── Git blobs ─────────────────────────────────────────────────────
        if re.search(rf"/repos/{OWNER}/{REPO}/git/blobs", url):
            if method == "POST":
                await json_response(route, {"sha": sha1(str(time.time())), "url": ""})
            else:
                await json_response(route, {"content": "", "encoding": "base64", "sha": "blob001"})
            return

        # ── Git tree create ───────────────────────────────────────────────
        if method == "POST" and re.search(rf"/repos/{OWNER}/{REPO}/git/trees", url):
            await json_response(route, {"sha": sha1(str(time.time())), "url": "",
                "tree": []}, status=201); return

        # ── Git commit create ─────────────────────────────────────────────
        if method == "POST" and re.search(rf"/repos/{OWNER}/{REPO}/git/commits", url):
            await json_response(route, {"sha": sha1(str(time.time())), "url": "",
                "message": "commit"}, status=201); return

        # ── Update ref ────────────────────────────────────────────────────
        if method == "PATCH" and re.search(rf"/repos/{OWNER}/{REPO}/git/refs", url):
            await json_response(route, {"ref": f"refs/heads/{BRANCH}",
                "object": {"sha": "abc9999"}}); return

        # ── Anything else: allow through or return empty ──────────────────
        print(f"  [unhandled] {method} {url[:80]}")
        await json_response(route, {}); return

    await page.route("**/api.github.com/**", handle)
    await page.route("**/github.com/login/**", handle)

# ── Screenshot helper ────────────────────────────────────────────────────────

n = 0
async def shot(page: Page, label: str, full_page=False, wait=600):
    global n
    n += 1
    await page.wait_for_timeout(wait)
    path = str(OUT / f"cms_{n:02d}_{label}.png")
    await page.screenshot(path=path, full_page=full_page)
    size = os.path.getsize(path)
    print(f"  [{n:02d}] {label}  ({size:,} b)")

# ── Navigation helpers ───────────────────────────────────────────────────────

async def click_any(page: Page, selectors: list[str], wait=1500) -> bool:
    for sel in selectors:
        try:
            el = page.locator(sel).first
            if await el.is_visible(timeout=2500):
                await el.click()
                await page.wait_for_timeout(wait)
                return True
        except Exception:
            continue
    return False

async def fill_first(page: Page, selectors: list[str], value: str, delay=25) -> bool:
    for sel in selectors:
        try:
            el = page.locator(sel).first
            if await el.is_visible(timeout=2000):
                await el.triple_click()
                await el.type(value, delay=delay)
                return True
        except Exception:
            continue
    return False

async def nav_collection(page: Page, name: str) -> bool:
    return await click_any(page, [
        f'[class*="sidebar"] a:has-text("{name}")',
        f'[class*="nav"] a:has-text("{name}")',
        f'nav a:has-text("{name}")',
        f'a[href*="{name.lower()}"]:has-text("{name}")',
        f'button:has-text("{name}")',
        f'[role="link"]:has-text("{name}")',
        f'a:has-text("{name}")',
    ], wait=2000)

async def click_new(page: Page) -> bool:
    return await click_any(page, [
        'button:has-text("New ")',
        '[class*="NewButton"]',
        '[class*="new-button"]',
        'a[href*="new"]',
        'button[aria-label*="new" i]',
        'button[aria-label*="create" i]',
    ], wait=2000)

# ── Main ─────────────────────────────────────────────────────────────────────

async def main():
    print(f"\nSveltia CMS mocked demo — output: {OUT}\n")

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True, args=CHROMIUM_ARGS)
        ctx = await browser.new_context(
            viewport={"width": 1440, "height": 900},
            color_scheme="dark",
            record_video_dir=str(OUT),
            record_video_size={"width": 1440, "height": 900},
        )
        page = await ctx.new_page()

        console_errors = []
        page.on("console", lambda m: console_errors.append(f"[{m.type}] {m.text}") if m.type == "error" else None)

        await setup_github_mocks(page)

        # ── 1. Load admin ────────────────────────────────────────────────
        print("1. Loading CMS…")
        await page.goto(ADMIN_URL, wait_until="domcontentloaded")
        await shot(page, "loading_screen", wait=500)
        await page.wait_for_timeout(5000)
        await shot(page, "login_screen", wait=300)

        # ── 2. Sign in with token ────────────────────────────────────────
        print("2. Signing in with token…")
        token_clicked = await click_any(page, [
            'button:has-text("Sign In with GitHub Using Token")',
            'button:has-text("Using Token")',
            'a:has-text("Using Token")',
            '[class*="token"]',
        ], wait=1500)

        await shot(page, "token_input_screen", wait=400)

        # Fill token field
        await fill_first(page, [
            'input[type="text"]', 'input[type="password"]',
            'input[placeholder*="token" i]', 'input[placeholder*="Token" i]',
            'input', 'textarea',
        ], FAKE_TOKEN)

        await shot(page, "token_entered", wait=300)

        # Submit
        await click_any(page, [
            'button:has-text("Sign In")',
            'button[type="submit"]',
            'button:has-text("Login")',
            'button:has-text("Continue")',
            'button:has-text("OK")',
        ], wait=4000)

        await shot(page, "after_auth_attempt", wait=800)

        # Wait longer for CMS to load collections
        await page.wait_for_timeout(5000)
        await shot(page, "cms_main_loaded", wait=500)

        # Check what text is visible
        body_text = await page.evaluate("document.body.innerText")
        print(f"  Visible text (first 300 chars): {body_text[:300].strip()}")

        # ── 3. Posts collection ──────────────────────────────────────────
        print("3. Posts collection…")
        navigated = await nav_collection(page, "Posts")
        print(f"  Nav to Posts: {navigated}")
        await page.wait_for_timeout(3000)
        await shot(page, "posts_listing", wait=500)

        # ── 4. Open first post ───────────────────────────────────────────
        print("4. Opening a post…")
        post_opened = await click_any(page, [
            '[class*="entry-card"]:first-child',
            '[class*="EntryCard"]:first-child',
            '[class*="list-item"]:first-child a',
            'ul li:first-child a',
            '[role="listitem"]:first-child',
            'article:first-child',
            'li:first-child',
        ], wait=2500)
        print(f"  Opened post: {post_opened}")

        await shot(page, "post_editor", wait=500)
        await page.evaluate("window.scrollBy(0, 300)")
        await shot(page, "post_editor_body", wait=400)

        # Toggle Published
        toggled = await click_any(page, [
            '[role="switch"]', 'input[type="checkbox"]',
            '[class*="Toggle"]', '[class*="toggle"]',
        ], wait=600)
        if toggled:
            await shot(page, "post_published_toggled", wait=300)

        # Navigate back
        await click_any(page, [
            'button[aria-label*="back" i]', 'a[aria-label*="back" i]',
            'button:has-text("Cancel")', 'a:has-text("Cancel")',
            'button:has-text("Back")', 'a:has-text("Back")',
            '[class*="BackButton"]', '[class*="back-button"]',
        ], wait=1500)

        # ── 5. Tags ──────────────────────────────────────────────────────
        print("5. Tags collection…")
        await nav_collection(page, "Tags")
        await page.wait_for_timeout(2000)
        await shot(page, "tags_listing")

        await click_new(page)
        await page.wait_for_timeout(2000)
        await shot(page, "new_tag_form")

        await fill_first(page, ['input[type="text"]', '[class*="StringInput"] input',
                                 '[class*="string-input"] input', 'input'], "LLMs")
        await page.wait_for_timeout(400)
        await shot(page, "new_tag_name_filled")

        # ── 6. New blog post ─────────────────────────────────────────────
        print("6. Creating new post…")
        await nav_collection(page, "Posts")
        await page.wait_for_timeout(1500)
        await click_new(page)
        await page.wait_for_timeout(2500)
        await shot(page, "new_post_form")

        # Title
        await fill_first(page, [
            '[class*="field"]:first-child input',
            'input[placeholder*="title" i]',
            'input:first-of-type',
            'input[type="text"]:first-of-type',
        ], "Evaluating LLMs in Production: Beyond Benchmark Numbers")
        await page.wait_for_timeout(500)
        await shot(page, "new_post_title")

        # Scroll down and fill more fields
        await page.evaluate("window.scrollBy(0, 250)")
        await page.wait_for_timeout(400)

        # Try to find and fill the body/markdown editor
        body_typed = False
        for sel in ['.ProseMirror', '[contenteditable="true"]',
                    '[class*="MarkdownEditor"] [contenteditable]',
                    '.cm-content', '[class*="editor"] [contenteditable]']:
            try:
                el = page.locator(sel).first
                if await el.is_visible(timeout=2000):
                    await el.click()
                    await page.wait_for_timeout(200)
                    await el.type(
                        "## The Problem with Benchmarks\n\n"
                        "Benchmark scores don't capture production behaviour. "
                        "Build evaluation harnesses that reflect your actual use case.\n\n"
                        "## What to Measure\n\n"
                        "- Task-specific accuracy on a domain golden dataset\n"
                        "- Failure mode distribution (not just average quality)\n"
                        "- Latency and cost at expected traffic levels\n",
                        delay=12,
                    )
                    body_typed = True
                    break
            except Exception:
                continue

        await shot(page, "new_post_with_content", full_page=False)

        # Save
        saved = await click_any(page, [
            'button:has-text("Save")', 'button:has-text("Publish")',
            'button[class*="save" i]', 'button[class*="primary"]',
        ], wait=2500)
        print(f"  Saved: {saved}")
        await shot(page, "new_post_saved", wait=500)

        # ── 7. Projects ──────────────────────────────────────────────────
        print("7. Projects collection…")
        await nav_collection(page, "Projects")
        await page.wait_for_timeout(2000)
        await shot(page, "projects_listing")

        await click_new(page)
        await page.wait_for_timeout(2000)
        await shot(page, "new_project_form")

        await fill_first(page, ['input[type="text"]:first-of-type', 'input:first-of-type'],
                         "Prompt Evaluation Dashboard")
        await page.wait_for_timeout(300)
        await shot(page, "new_project_filled")

        # ── 8. Pages / About ─────────────────────────────────────────────
        print("8. Pages collection…")
        await nav_collection(page, "Pages")
        await page.wait_for_timeout(2000)
        await shot(page, "pages_listing")

        await click_any(page, [
            'a:has-text("About Me")', 'button:has-text("About Me")',
            '[class*="file-item"]', '[class*="FileItem"]',
            'li a', 'ul li:first-child',
        ], wait=2500)
        await shot(page, "about_editor", wait=500)

        # ── 9. Final overview ────────────────────────────────────────────
        print("9. Final overview…")
        await nav_collection(page, "Posts")
        await page.wait_for_timeout(2500)
        await shot(page, "final_posts_overview")

        print(f"\n  Console errors: {len(console_errors)}")
        for e in console_errors[-5:]:
            print(f"  {e[:120]}")

        print("\nClosing and finalising video…")
        await ctx.close()
        await browser.close()

        # Rename video
        videos = [v for v in OUT.glob("*.webm") if "cms-demo" not in v.name]
        if videos:
            latest = sorted(videos, key=lambda p: p.stat().st_mtime)[-1]
            dest = OUT / "cms-demo-video.webm"
            if dest.exists():
                dest.unlink()
            latest.rename(dest)
            mb = dest.stat().st_size / 1_048_576
            print(f"Video: {dest}  ({mb:.1f} MB)")

    print(f"\nDone — {n} screenshots in {OUT}\n")

if __name__ == "__main__":
    asyncio.run(main())
