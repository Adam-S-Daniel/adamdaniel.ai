#!/usr/bin/env node
// Real-browser check of the GHA-bench post's results table (issue #4114; the
// page-overflow half is #4084). Not a CI lane: this repo vendors no Node
// toolchain, so Playwright comes from the platform harness checkout.
//
//   bundle exec jekyll build -d /tmp/site          # then serve /tmp/site
//   PLAYWRIGHT_MODULE=<harness>/e2e/node_modules/playwright \
//     node scripts/check-gha-bench-phone.js http://127.0.0.1:<port>
// BROWSER_ENGINE=webkit (or firefox) picks another engine; the default is chromium.
//
// At phone widths the table must stay inside its own scroll box, keep rows to
// one line, say that it scrolls sideways (hint + edge fade), keep the Model
// column pinned and let the reader reach the Code column. The sliders must
// total exactly 100% after Home/End on every one. At desktop width nothing
// phone-specific may show.
"use strict";

const base = (process.argv[2] || "").replace(/\/$/, "");
if (!base) {
  console.error("usage: check-gha-bench-phone.js <site base URL>");
  process.exit(2);
}
const playwright = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const engine = playwright[process.env.BROWSER_ENGINE || "chromium"]; // or "webkit" / "firefox"

const failures = [];
let checks = 0;
function expect(cond, msg) {
  checks += 1;
  console.log(`  ${cond ? "ok  " : "FAIL"} ${msg}`);
  if (!cond) failures.push(msg);
}

const KEYS = ["duration", "cost", "tests", "workflow"];

async function pctTotal(page) {
  const texts = await Promise.all(KEYS.map((k) => page.locator(`#bws-${k}-pct`).textContent()));
  return texts.reduce((sum, t) => sum + parseFloat(t), 0);
}

async function snapshot(page) {
  return page.evaluate(() => {
    const scroll = document.querySelector(".bws-table-scroll");
    const hint = document.querySelector(".bws-scroll-hint");
    const th = [...scroll.querySelectorAll("th")];
    const code = th[th.length - 1].getBoundingClientRect();
    const model = scroll.querySelector("tbody td:first-child").getBoundingClientRect();
    const box = scroll.getBoundingClientRect();
    return {
      docScroll: document.documentElement.scrollWidth,
      docClient: document.documentElement.clientWidth,
      overflowX: getComputedStyle(scroll).overflowX,
      room: scroll.scrollWidth - scroll.clientWidth,
      rowHeight: scroll.querySelector("tbody tr").offsetHeight,
      hintShown: !!hint && getComputedStyle(hint).display !== "none",
      faded: scroll.classList.contains("bws-fade-right"),
      mask: getComputedStyle(scroll).maskImage || getComputedStyle(scroll).webkitMaskImage,
      codeRight: code.right,
      boxRight: box.right,
      boxLeft: box.left,
      modelLeft: model.left,
      focusable: scroll.tabIndex === 0 && scroll.getAttribute("role") === "region",
    };
  });
}

(async () => {
  const browser = await engine.launch();
  try {
    for (const width of [360, 390]) {
      console.log(`phone ${width}px`);
      const ctx = await browser.newContext({ viewport: { width, height: 844 }, hasTouch: true });
      const page = await ctx.newPage();
      await page.goto(`${base}/blog/introducing-gha-bench/`);
      await page.waitForSelector(".bws-table tbody tr");
      const s = await snapshot(page);
      expect(s.docScroll <= s.docClient, `page does not scroll sideways (${s.docScroll} <= ${s.docClient})`);
      expect(s.overflowX === "auto", "the table sits in an overflow-x: auto box");
      expect(s.room > 0, `the table is wider than its box (${s.room}px of sideways room)`);
      expect(s.rowHeight <= 50, `a row is one line tall (${s.rowHeight}px; 131px before #4114, limit 50px)`);
      expect(s.hintShown, "the swipe hint shows");
      expect(s.faded && s.mask !== "none", "the right edge fades while columns wait off-screen");
      expect(s.focusable, "the scroll box is keyboard-focusable and labelled as a region");
      await page.locator(".bws-table-scroll").evaluate((el) => {
        el.scrollLeft = el.scrollWidth;
        el.dispatchEvent(new Event("scroll"));
      });
      const e = await snapshot(page);
      expect(e.codeRight <= e.boxRight + 0.5, "scrolled to the end, the Code column is fully visible");
      expect(Math.abs(e.modelLeft - e.boxLeft) < 1.5, "the Model column stays pinned at the left edge");
      expect(!e.hintShown, "the hint goes away once the reader has scrolled");
      expect(!e.faded, "the fade goes away at the end");
      for (const key of KEYS) {
        await page.locator(`#bws-${key}`).focus();
        await page.keyboard.press("Home");
        const total = await pctTotal(page);
        expect(total === 100, `Home on ${key}: sliders total ${total}% (want 100)`);
      }
      for (const key of KEYS) {
        await page.locator(`#bws-${key}`).focus();
        await page.keyboard.press("End");
        const total = await pctTotal(page);
        expect(total === 100, `End on ${key}: sliders total ${total}% (want 100)`);
      }
      await ctx.close();
    }

    console.log("desktop 1280px");
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    await page.goto(`${base}/blog/introducing-gha-bench/`);
    await page.waitForSelector(".bws-table tbody tr");
    const d = await snapshot(page);
    expect(d.docScroll <= d.docClient, "page does not scroll sideways");
    expect(d.room <= 0, "the whole table fits, nothing scrolls");
    expect(!d.hintShown && !d.faded, "no hint and no fade when nothing scrolls");
    expect(d.rowHeight <= 50, `a row is one line tall (${d.rowHeight}px)`);
    await ctx.close();
  } finally {
    await browser.close();
  }
  console.log(`${checks} checks, ${failures.length} failed`);
  process.exit(failures.length ? 1 : 0);
})().catch((err) => {
  console.error(err.message);
  process.exit(2);
});
