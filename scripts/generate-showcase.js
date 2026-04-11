#!/usr/bin/env node
// Generates a video slideshow of all visual regression snapshots.
// Each snapshot is displayed with a label for 3 seconds.
// Output: recordings/visual-regression-showcase.webm
//
// Usage: PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/generate-showcase.js

const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const SNAPSHOT_DIR = path.join(
  __dirname,
  "..",
  "e2e",
  "visual-regression.spec.js-snapshots",
);
const OUTPUT_DIR = path.join(__dirname, "..", "recordings");
const SECONDS_PER_SLIDE = 3;

(async () => {
  const files = fs
    .readdirSync(SNAPSHOT_DIR)
    .filter((f) => f.endsWith(".png"))
    .sort();

  if (files.length === 0) {
    console.error("No snapshots found. Run tests with --update-snapshots first.");
    process.exit(1);
  }

  console.log(`Found ${files.length} snapshots. Recording showcase...`);

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    recordVideo: {
      dir: OUTPUT_DIR,
      size: { width: 1920, height: 1080 },
    },
  });
  const page = await context.newPage();

  for (const file of files) {
    const label = file
      .replace(/-linux\.png$/, "")
      .replace(/-/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());

    const imgPath = path.join(SNAPSHOT_DIR, file);
    const base64 = fs.readFileSync(imgPath).toString("base64");

    await page.setContent(`
      <!DOCTYPE html>
      <html>
      <head><style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
          background: #04060f;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          height: 100vh;
          font-family: 'SF Mono', 'Consolas', monospace;
        }
        .label {
          color: #8ab0e8;
          font-size: 16px;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          margin-bottom: 16px;
        }
        .label strong { color: #d8e4ff; }
        img {
          max-width: 92%;
          max-height: 85vh;
          object-fit: contain;
          border: 1px solid #1a2a5e;
          border-radius: 8px;
        }
        .counter {
          color: #1a2a5e;
          font-size: 12px;
          margin-top: 12px;
          letter-spacing: 0.1em;
        }
      </style></head>
      <body>
        <div class="label">visual check &mdash; <strong>${label}</strong></div>
        <img src="data:image/png;base64,${base64}" />
        <div class="counter">${files.indexOf(file) + 1} / ${files.length}</div>
      </body>
      </html>
    `);

    await page.waitForTimeout(SECONDS_PER_SLIDE * 1000);
    console.log(`  [${files.indexOf(file) + 1}/${files.length}] ${label}`);
  }

  // Close context to flush the video file
  await context.close();
  await browser.close();

  // Playwright saves video with a random name — find and rename it
  const recordings = fs
    .readdirSync(OUTPUT_DIR)
    .filter((f) => f.endsWith(".webm"))
    .map((f) => ({
      name: f,
      mtime: fs.statSync(path.join(OUTPUT_DIR, f)).mtimeMs,
    }))
    .sort((a, b) => b.mtime - a.mtime);

  if (recordings.length > 0) {
    const latest = recordings[0].name;
    const dest = "visual-regression-showcase.webm";
    fs.renameSync(
      path.join(OUTPUT_DIR, latest),
      path.join(OUTPUT_DIR, dest),
    );
    console.log(`\nShowcase saved: recordings/${dest}`);
  }
})();
