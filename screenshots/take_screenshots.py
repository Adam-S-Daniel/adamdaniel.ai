#!/usr/bin/env python3
"""
Take screenshots of the Sveltia CMS admin interface and the Jekyll blog site.
Runs headlessly against the locally-served built site.
"""
import asyncio
import os
from playwright.async_api import async_playwright

SCREENSHOTS_DIR = os.path.dirname(os.path.abspath(__file__))
BASE_URL = "http://localhost:8765"
ADMIN_URL = "http://localhost:8766"  # admin served from source (has Sveltia CMS JS)


async def shot(page, url: str, filename: str, wait_ms: int = 2000, full_page: bool = True):
    print(f"  [{filename}]  {url}")
    await page.goto(url, wait_until="networkidle")
    await page.wait_for_timeout(wait_ms)
    path = os.path.join(SCREENSHOTS_DIR, filename)
    await page.screenshot(path=path, full_page=full_page)
    size = os.path.getsize(path)
    print(f"    ✓ {size:,} bytes")


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
        )

        # ── Desktop — built Jekyll site ─────────────────────────────────
        desktop = await browser.new_page(viewport={"width": 1440, "height": 900})
        await desktop.emulate_media(color_scheme="dark")

        print("\n── Desktop screenshots (built site) ──────────────────────────")
        await shot(desktop, f"{BASE_URL}/",         "01-homepage.png",     wait_ms=3500)
        await shot(desktop, f"{BASE_URL}/blog/",    "02-blog-listing.png", wait_ms=2000)
        await shot(desktop, f"{BASE_URL}/blog/building-ai-agents-with-langgraph/",
                   "03-post-detail.png", wait_ms=1500)
        await shot(desktop, f"{BASE_URL}/projects/","04-projects.png",     wait_ms=1500)
        await shot(desktop, f"{BASE_URL}/pages/about/", "05-about.png",    wait_ms=1500)

        # ── Desktop — CMS admin (served from source dir) ────────────────
        print("\n── CMS admin screenshots ────────────────────────────────────")
        cms_page = await browser.new_page(viewport={"width": 1440, "height": 900})
        await cms_page.emulate_media(color_scheme="dark")

        # Our custom loading screen (captured immediately on navigation)
        await cms_page.goto(f"{ADMIN_URL}/admin/", wait_until="domcontentloaded")
        await cms_page.wait_for_timeout(400)
        await cms_page.screenshot(
            path=os.path.join(SCREENSHOTS_DIR, "06-cms-loading-screen.png"),
            full_page=False,
        )
        print(f"  [06-cms-loading-screen.png] ✓")

        # Wait for Sveltia CMS JS to boot and render
        await cms_page.wait_for_timeout(7000)
        await cms_page.screenshot(
            path=os.path.join(SCREENSHOTS_DIR, "07-cms-booted.png"),
            full_page=False,
        )
        print(f"  [07-cms-booted.png] ✓")

        # ── Mobile ──────────────────────────────────────────────────────
        print("\n── Mobile screenshots ───────────────────────────────────────")
        mobile = await browser.new_page(viewport={"width": 390, "height": 844})
        await mobile.emulate_media(color_scheme="dark")
        await shot(mobile, f"{BASE_URL}/",      "08-homepage-mobile.png",  wait_ms=3000, full_page=False)
        await shot(mobile, f"{BASE_URL}/blog/", "09-blog-mobile.png",      wait_ms=2000, full_page=False)

        await browser.close()
        print(f"\nAll screenshots saved to: {SCREENSHOTS_DIR}\n")


if __name__ == "__main__":
    asyncio.run(main())
