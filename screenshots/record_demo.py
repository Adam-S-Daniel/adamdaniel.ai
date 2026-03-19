#!/usr/bin/env python3
"""
Record a demo video walkthrough of the site and CMS loading screen.
Uses Playwright's built-in video recording (WebM/VP8).
"""
import asyncio
import os
from pathlib import Path
from playwright.async_api import async_playwright

SCREENSHOTS_DIR = Path(os.path.dirname(os.path.abspath(__file__)))
BASE_URL = "http://localhost:8765"
ADMIN_URL = "http://localhost:8766"


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
        )

        ctx = await browser.new_context(
            viewport={"width": 1440, "height": 900},
            record_video_dir=str(SCREENSHOTS_DIR),
            record_video_size={"width": 1440, "height": 900},
            color_scheme="dark",
        )

        page = await ctx.new_page()

        print("Recording demo video…")

        # Homepage — let thermal animation breathe for 3 seconds
        await page.goto(f"{BASE_URL}/", wait_until="networkidle")
        await page.wait_for_timeout(3000)

        # Scroll slowly to reveal blog posts and projects sections
        for y in range(0, 1800, 60):
            await page.evaluate(f"window.scrollTo(0, {y})")
            await page.wait_for_timeout(40)

        await page.wait_for_timeout(1500)

        # Navigate to blog listing
        await page.click("a[href*='/blog/']", timeout=5000)
        await page.wait_for_load_state("networkidle")
        await page.wait_for_timeout(2000)

        # Open a post
        await page.click(".post-title a", timeout=5000)
        await page.wait_for_load_state("networkidle")
        await page.wait_for_timeout(1500)

        # Scroll through the post
        for y in range(0, 2500, 80):
            await page.evaluate(f"window.scrollTo(0, {y})")
            await page.wait_for_timeout(30)

        await page.wait_for_timeout(1000)

        # Navigate to projects
        await page.goto(f"{BASE_URL}/projects/", wait_until="networkidle")
        await page.wait_for_timeout(2000)

        # Navigate to CMS loading screen
        await page.goto(f"{ADMIN_URL}/admin/", wait_until="domcontentloaded")
        await page.wait_for_timeout(4000)  # Watch the loading screen animation

        await ctx.close()
        await browser.close()

        # Find the recorded video file
        videos = list(SCREENSHOTS_DIR.glob("*.webm"))
        if videos:
            latest = sorted(videos, key=lambda p: p.stat().st_mtime)[-1]
            final_path = SCREENSHOTS_DIR / "demo-walkthrough.webm"
            latest.rename(final_path)
            size_mb = final_path.stat().st_size / 1_048_576
            print(f"Video saved: {final_path} ({size_mb:.1f} MB)")
        else:
            print("No video file found — check Playwright recording support.")


if __name__ == "__main__":
    asyncio.run(main())
