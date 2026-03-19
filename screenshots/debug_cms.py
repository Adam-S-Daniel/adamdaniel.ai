#!/usr/bin/env python3
"""Debug what Sveltia CMS is actually rendering and any console errors."""
import asyncio
from playwright.async_api import async_playwright

ADMIN_URL = "http://localhost:8766/admin/index-local.html"

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-setuid-sandbox",
                  "--disable-dev-shm-usage", "--disable-web-security",
                  "--allow-running-insecure-content"],
        )
        page = await browser.new_page(
            viewport={"width": 1440, "height": 900},
            color_scheme="dark",
        )

        errors = []
        logs = []
        page.on("console", lambda m: logs.append(f"[{m.type}] {m.text}"))
        page.on("pageerror", lambda e: errors.append(str(e)))

        await page.goto(ADMIN_URL, wait_until="domcontentloaded")
        await page.wait_for_timeout(12000)

        # Capture DOM state
        html = await page.content()
        print("=== PAGE HTML (truncated) ===")
        print(html[:3000])

        print("\n=== CONSOLE LOGS ===")
        for log in logs[-30:]:
            print(log)

        print("\n=== ERRORS ===")
        for e in errors:
            print(e)

        # Try to find any visible elements
        body_text = await page.evaluate("document.body.innerText")
        print("\n=== BODY TEXT ===")
        print(body_text[:1000])

        # Check what elements exist in shadow DOM or custom elements
        elements = await page.evaluate("""
            () => {
                const all = document.querySelectorAll('*');
                const found = [];
                for (const el of all) {
                    if (el.tagName.includes('-') || el.shadowRoot) {
                        found.push(el.tagName + ' (shadowRoot=' + !!el.shadowRoot + ')');
                    }
                }
                return found.slice(0, 20);
            }
        """)
        print("\n=== CUSTOM ELEMENTS ===")
        for e in elements:
            print(e)

        await page.screenshot(path="/home/user/adamdaniel.ai/screenshots/debug_state.png", full_page=False)
        await browser.close()

asyncio.run(main())
