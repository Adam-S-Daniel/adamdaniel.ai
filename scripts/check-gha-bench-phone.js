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
// phone-specific may show. Model labels compact every token at phone widths,
// survive slider rerenders, and restore full desktop labels across resizes.
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
const MODEL_LABELS = [
  ["opus 4.7 1m med", "opus-4.7·1m·med"],
  ["opus 4.7 200k med", "opus-4.7·200k·med"],
  ["sonnet 46 1m med", "sonnet-46·1m·med"],
  ["opus 46 200k", "opus-46·200k"],
  ["opus 4.7 1m hi", "opus-4.7·1m·hi"],
  ["sonnet 46 200k", "sonnet-46·200k"],
  ["opus 4.7 1m xhi", "opus-4.7·1m·xhi"],
  ["haiku 45 200k", "haiku-45·200k"],
];

async function checkModels(page, compact, stage) {
  const labels = await page.locator("#bws-tbody tr td:first-child").allTextContents();
  const actual = [...new Set(labels)].sort();
  const expected = MODEL_LABELS.map((pair) => pair[compact ? 1 : 0]).sort();
  expect(JSON.stringify(actual) === JSON.stringify(expected), `${stage}: all Model labels match`);
}

async function resizeModels(page, width, compact) {
  await page.setViewportSize({ width, height: 844 });
  await page.waitForFunction(
    (label) => [...document.querySelectorAll("#bws-tbody tr td:first-child")]
      .some((cell) => cell.textContent === label),
    MODEL_LABELS[0][compact ? 1 : 0]
  );
  await checkModels(page, compact, `resized to ${width}px`);
}

async function pctTotal(page) {
  const texts = await Promise.all(KEYS.map((k) => page.locator(`#bws-${k}-pct`).textContent()));
  return texts.reduce((sum, t) => sum + parseFloat(t), 0);
}

// Keyboard focus on the scroll box must be visible. A ring clipped by the box's
// own mask or overflow draws nothing, so compare a thin band just OUTSIDE the
// box's top edge (where the ring sits) with and without focus. Animations are
// frozen so only the ring can differ; two unfocused shots must match first.
async function checkFocusRing(page) {
  await page.locator("#bws-workflow").focus();
  await page.keyboard.press("Tab"); // keyboard modality, so :focus-visible applies
  const onRegion = await page.evaluate(() => document.activeElement === document.querySelector(".bws-table-scroll"));
  expect(onRegion, "Tab from the last slider lands on the scroll box");
  await page.locator(".bws-table-scroll").evaluate((el) => el.scrollIntoView({ block: "start" }));
  await page.evaluate(() => window.scrollBy(0, -200)); // keep the band inside the viewport
  const box = await page.locator(".bws-table-scroll").boundingBox();
  const band = { x: box.x, y: box.y - 5, width: box.width, height: 4 };
  const shot = () => page.screenshot({ clip: band, animations: "disabled" });
  const focused = await shot();
  await page.evaluate(() => document.activeElement.blur());
  const idle = await shot();
  const idleAgain = await shot();
  expect(idle.equals(idleAgain), "control: two unfocused shots of the band are identical");
  expect(!focused.equals(idle), "the focused scroll box shows a visible focus ring");
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
      faded:
        scroll.parentNode.classList.contains("bws-fade-right") &&
        getComputedStyle(scroll.parentNode, "::after").content !== "none",
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
      await checkModels(page, true, `initial ${width}px phone`);
      const s = await snapshot(page);
      expect(s.docScroll <= s.docClient, `page does not scroll sideways (${s.docScroll} <= ${s.docClient})`);
      expect(s.overflowX === "auto", "the table sits in an overflow-x: auto box");
      expect(s.room > 0, `the table is wider than its box (${s.room}px of sideways room)`);
      expect(s.rowHeight <= 50, `a row is one line tall (${s.rowHeight}px; 131px before #4114, limit 50px)`);
      expect(s.hintShown, "the swipe hint shows");
      expect(s.faded, "the right edge fades while columns wait off-screen");
      expect(s.focusable, "the scroll box is keyboard-focusable and labelled as a region");
      await checkFocusRing(page);
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
        await checkModels(page, true, `Home on ${key} keeps compact labels`);
      }
      for (const key of KEYS) {
        await page.locator(`#bws-${key}`).focus();
        await page.keyboard.press("End");
        const total = await pctTotal(page);
        expect(total === 100, `End on ${key}: sliders total ${total}% (want 100)`);
        await checkModels(page, true, `End on ${key} keeps compact labels`);
      }
      await resizeModels(page, 541, false);
      await resizeModels(page, 540, true);
      await ctx.close();
    }

    console.log("desktop 1280px");
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    await page.goto(`${base}/blog/introducing-gha-bench/`);
    await page.waitForSelector(".bws-table tbody tr");
    await checkModels(page, false, "initial desktop");
    const d = await snapshot(page);
    expect(d.docScroll <= d.docClient, "page does not scroll sideways");
    expect(d.room <= 0, "the whole table fits, nothing scrolls");
    expect(!d.hintShown && !d.faded, "no hint and no fade when nothing scrolls");
    expect(d.rowHeight <= 50, `a row is one line tall (${d.rowHeight}px)`);
    await resizeModels(page, 390, true);
    await resizeModels(page, 1280, false);
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
