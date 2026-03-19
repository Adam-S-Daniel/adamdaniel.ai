#!/usr/bin/env python3
"""
Full Sveltia CMS demo with local_backend.
Captures screenshots and a video walkthrough showing:
  1. CMS login / local-backend entry
  2. Posts collection listing
  3. Opening an existing post for editing
  4. Editing the post body and toggling published
  5. Tags collection — adding a new tag
  6. Creating a brand-new blog post
  7. Projects collection — adding a new project
  8. Pages — editing the About page

Prerequisites:
  - decap-server running on :8081  (npx decap-server)
  - HTTP server on :8766 serving the repo root  (python3 -m http.server 8766)
"""
import asyncio
import os
import shutil
from pathlib import Path
from playwright.async_api import async_playwright, Page, expect

OUT = Path(os.path.dirname(os.path.abspath(__file__)))
ADMIN_URL = "http://localhost:8766/admin/index-local.html"

CHROMIUM_ARGS = [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--disable-web-security",  # allow XHR to localhost:8081
    "--allow-running-insecure-content",
]

n = 0
def next_shot(label: str) -> str:
    global n
    n += 1
    return str(OUT / f"cms_{n:02d}_{label}.png")


async def shot(page: Page, label: str, full_page: bool = False, delay: int = 800):
    await page.wait_for_timeout(delay)
    path = next_shot(label)
    await page.screenshot(path=path, full_page=full_page)
    size = os.path.getsize(path)
    print(f"  [{n:02d}] {label}  ({size:,} b)")
    return path


async def wait_for_cms(page: Page, timeout: int = 25_000):
    """Wait until Sveltia CMS has rendered its main UI."""
    # CMS is ready when the sidebar nav appears or a collection heading shows
    try:
        await page.wait_for_selector(
            '[class*="sidebar"], [class*="Sidebar"], nav[aria-label], [class*="AppShell"], '
            '[class*="collection"], [class*="Collection"], '
            'button:has-text("Login"), button:has-text("Log in"), '
            'a:has-text("Login"), [class*="login"], [class*="Login"]',
            timeout=timeout,
        )
    except Exception:
        pass  # Screenshot whatever state we're in


async def click_login_or_local(page: Page):
    """Click whatever auth button Sveltia CMS shows for local_backend."""
    for selector in [
        'button:has-text("Use local backend")',
        'button:has-text("Login")',
        'button:has-text("Log in")',
        'button:has-text("Continue")',
        'a:has-text("Login")',
        '[class*="login"] button',
        '[class*="Login"] button',
        'button[type="submit"]',
    ]:
        try:
            el = page.locator(selector).first
            if await el.is_visible(timeout=2000):
                await el.click()
                await page.wait_for_timeout(1500)
                print(f"  Clicked: {selector}")
                return True
        except Exception:
            continue
    return False


async def navigate_to_collection(page: Page, name: str):
    """Click a collection link in the CMS sidebar."""
    for selector in [
        f'a:has-text("{name}")',
        f'[class*="sidebar"] a:has-text("{name}")',
        f'nav a:has-text("{name}")',
        f'button:has-text("{name}")',
        f'[role="link"]:has-text("{name}")',
    ]:
        try:
            el = page.locator(selector).first
            if await el.is_visible(timeout=3000):
                await el.click()
                await page.wait_for_timeout(1500)
                return True
        except Exception:
            continue
    return False


async def click_new_entry(page: Page):
    """Click the 'New entry' / '+' button in a collection."""
    for selector in [
        'button:has-text("New")',
        'a:has-text("New")',
        'button:has-text("+")',
        '[aria-label*="new" i]',
        '[aria-label*="create" i]',
        '[class*="NewEntry"]',
        '[class*="new-entry"]',
    ]:
        try:
            el = page.locator(selector).first
            if await el.is_visible(timeout=3000):
                await el.click()
                await page.wait_for_timeout(1500)
                return True
        except Exception:
            continue
    return False


async def fill_field(page: Page, label_text: str, value: str):
    """Fill a CMS field by its label text."""
    # Try different widget patterns
    for selector in [
        f'label:has-text("{label_text}") + * input',
        f'label:has-text("{label_text}") + * textarea',
        f'[placeholder*="{label_text}" i]',
        f'input[name*="{label_text.lower()}"]',
        f'textarea[name*="{label_text.lower()}"]',
    ]:
        try:
            el = page.locator(selector).first
            if await el.is_visible(timeout=2000):
                await el.triple_click()
                await el.type(value, delay=30)
                return True
        except Exception:
            continue
    return False


async def main():
    print(f"\nSveltia CMS demo — output: {OUT}\n")

    async with async_playwright() as p:
        # ── Video recording context ──────────────────────────────────────
        browser = await p.chromium.launch(headless=True, args=CHROMIUM_ARGS)

        ctx = await browser.new_context(
            viewport={"width": 1440, "height": 900},
            color_scheme="dark",
            record_video_dir=str(OUT),
            record_video_size={"width": 1440, "height": 900},
        )

        page = await ctx.new_page()

        # ── 1. Load the CMS admin ────────────────────────────────────────
        print("1. Loading CMS admin…")
        await page.goto(ADMIN_URL, wait_until="domcontentloaded")
        await shot(page, "loading_screen", delay=600)

        # Wait for CMS JS to boot
        await page.wait_for_timeout(9000)
        await shot(page, "cms_booted", delay=300)

        # ── 2. Login / enter local backend ───────────────────────────────
        print("2. Authenticating…")
        await click_login_or_local(page)
        await page.wait_for_timeout(3000)
        await shot(page, "after_login")

        # Try a second click if we got a two-step flow
        await click_login_or_local(page)
        await page.wait_for_timeout(3000)
        await shot(page, "cms_main_ui")

        # ── 3. Posts collection ──────────────────────────────────────────
        print("3. Navigating to Posts…")
        await navigate_to_collection(page, "Posts")
        await page.wait_for_timeout(2000)
        await shot(page, "posts_listing", full_page=False)

        # ── 4. Open existing post ────────────────────────────────────────
        print("4. Opening existing post…")
        # Try to click the first post entry in the list
        post_clicked = False
        for selector in [
            '[class*="EntryCard"]:first-child',
            '[class*="entry-card"]:first-child',
            '[class*="ListItem"]:first-child a',
            '[class*="list"] [class*="item"]:first-child',
            'ul li:first-child a',
            'ul li:first-child',
            '[role="listitem"]:first-child',
        ]:
            try:
                el = page.locator(selector).first
                if await el.is_visible(timeout=3000):
                    await el.click()
                    post_clicked = True
                    await page.wait_for_timeout(2000)
                    break
            except Exception:
                continue

        if post_clicked:
            await shot(page, "post_editor_open", full_page=False)

            # Scroll down to see more of the editor
            await page.evaluate("window.scrollBy(0, 200)")
            await page.wait_for_timeout(500)
            await shot(page, "post_editor_body", full_page=False)

            # Try toggling the Published switch
            print("  Toggling Published…")
            for sel in ['[class*="toggle"]', '[class*="Toggle"]', 'input[type="checkbox"]',
                        '[class*="switch"]', '[class*="Switch"]', '[role="switch"]']:
                try:
                    el = page.locator(sel).first
                    if await el.is_visible(timeout=2000):
                        await el.click()
                        await page.wait_for_timeout(800)
                        break
                except Exception:
                    continue
            await shot(page, "post_published_toggled", full_page=False)

        # Navigate back
        await page.go_back()
        await page.wait_for_timeout(1500)

        # ── 5. Tags collection ───────────────────────────────────────────
        print("5. Tags collection…")
        await navigate_to_collection(page, "Tags")
        await page.wait_for_timeout(2000)
        await shot(page, "tags_listing")

        print("  Creating new tag…")
        await click_new_entry(page)
        await page.wait_for_timeout(2000)
        await shot(page, "new_tag_form")

        await fill_field(page, "Name", "LLMs")
        await page.wait_for_timeout(500)
        await fill_field(page, "Description", "Large Language Models — architecture, capabilities, and practical applications.")
        await page.wait_for_timeout(600)
        await shot(page, "new_tag_filled")

        # ── 6. New blog post ─────────────────────────────────────────────
        print("6. Creating new blog post…")
        await navigate_to_collection(page, "Posts")
        await page.wait_for_timeout(1500)
        await click_new_entry(page)
        await page.wait_for_timeout(2500)
        await shot(page, "new_post_empty")

        # Fill title
        await fill_field(page, "Title", "Evaluating LLMs in Production: Beyond Benchmark Numbers")
        await page.wait_for_timeout(500)

        # Fill excerpt
        await fill_field(page, "Excerpt",
            "Benchmark scores look great on paper. Here's how to build evaluation harnesses that actually tell you whether your LLM deployment is working.")
        await page.wait_for_timeout(500)
        await shot(page, "new_post_metadata_filled")

        # Try to type in the markdown body editor
        print("  Writing post body…")
        for sel in [
            '.ProseMirror',
            '[class*="rich-text"] [contenteditable]',
            '[contenteditable="true"]',
            '.cm-content',
            'textarea[class*="code"]',
        ]:
            try:
                el = page.locator(sel).first
                if await el.is_visible(timeout=3000):
                    await el.click()
                    await page.wait_for_timeout(300)
                    await el.type(
                        "## The Problem with Benchmarks\n\n"
                        "MMLU, HumanEval, GSM8K — these are useful signals, not production guarantees. "
                        "The gap between 'scores well on benchmarks' and 'works reliably in your specific domain' "
                        "is where most AI projects quietly fail.\n\n"
                        "## What Actually Matters\n\n"
                        "- **Task-specific accuracy** against a golden dataset from your domain\n"
                        "- **Failure mode distribution** — not just average quality, but tail behaviour\n"
                        "- **Latency and cost** at your expected traffic levels\n"
                        "- **Regression tracking** across model versions\n\n"
                        "## Building a Minimal Eval Harness\n\n"
                        "Start with 50 representative examples. Classify outputs as pass/fail. "
                        "Track the score over time. That's it. Sophistication comes later.",
                        delay=8,
                    )
                    await page.wait_for_timeout(500)
                    break
            except Exception:
                continue

        await shot(page, "new_post_body_written", full_page=False)

        # Toggle Published on
        for sel in ['[role="switch"]', 'input[type="checkbox"]', '[class*="Toggle"]', '[class*="toggle"]']:
            try:
                el = page.locator(sel).first
                if await el.is_visible(timeout=2000):
                    checked = await el.get_attribute("aria-checked") or await el.is_checked()
                    if not checked or checked == "false":
                        await el.click()
                        await page.wait_for_timeout(600)
                    break
            except Exception:
                continue

        await shot(page, "new_post_ready_to_save", full_page=False)

        # Try to save
        print("  Saving post…")
        for sel in [
            'button:has-text("Save")',
            'button:has-text("Publish")',
            'button[class*="save"]',
            'button[class*="Save"]',
            'button[class*="primary"]',
        ]:
            try:
                el = page.locator(sel).first
                if await el.is_visible(timeout=2000):
                    await el.click()
                    await page.wait_for_timeout(2000)
                    break
            except Exception:
                continue

        await shot(page, "new_post_saved", full_page=False)

        # ── 7. Projects collection ───────────────────────────────────────
        print("7. Projects collection…")
        await navigate_to_collection(page, "Projects")
        await page.wait_for_timeout(2000)
        await shot(page, "projects_listing")

        await click_new_entry(page)
        await page.wait_for_timeout(2000)
        await shot(page, "new_project_empty")

        await fill_field(page, "Title", "Prompt Evaluation Dashboard")
        await page.wait_for_timeout(400)
        await fill_field(page, "Technology / Stack", "Python · FastAPI · React · LangSmith")
        await page.wait_for_timeout(400)
        await fill_field(page, "Project URL", "https://github.com/Adam-S-Daniel")
        await page.wait_for_timeout(400)

        # Toggle featured
        for sel in ['[role="switch"]', 'input[type="checkbox"]', '[class*="Toggle"]']:
            try:
                el = page.locator(sel).first
                if await el.is_visible(timeout=2000):
                    await el.click()
                    await page.wait_for_timeout(500)
                    break
            except Exception:
                continue

        await shot(page, "new_project_filled")

        # ── 8. Pages — About Me ──────────────────────────────────────────
        print("8. Editing About page…")
        await navigate_to_collection(page, "Pages")
        await page.wait_for_timeout(2000)
        await shot(page, "pages_collection")

        for sel in ['a:has-text("About")', 'button:has-text("About")',
                    '[class*="file"] a', '[class*="FileItem"]']:
            try:
                el = page.locator(sel).first
                if await el.is_visible(timeout=3000):
                    await el.click()
                    await page.wait_for_timeout(2000)
                    break
            except Exception:
                continue

        await shot(page, "about_page_editor", full_page=False)

        # ── Final overview ───────────────────────────────────────────────
        print("9. Final overview…")
        await navigate_to_collection(page, "Posts")
        await page.wait_for_timeout(2500)
        await shot(page, "final_posts_with_new_entry", full_page=False)

        print("\nClosing browser and finalising video…")
        await ctx.close()
        await browser.close()

        # Rename video
        videos = list(OUT.glob("*.webm"))
        if videos:
            latest = sorted(videos, key=lambda p: p.stat().st_mtime)[-1]
            dest = OUT / "cms-demo-video.webm"
            if dest.exists():
                dest.unlink()
            latest.rename(dest)
            mb = dest.stat().st_size / 1_048_576
            print(f"\nVideo: {dest}  ({mb:.1f} MB)")

    print(f"\nDone — {n} screenshots + 1 video in {OUT}\n")


if __name__ == "__main__":
    asyncio.run(main())
