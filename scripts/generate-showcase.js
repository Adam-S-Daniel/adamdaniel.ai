#!/usr/bin/env node
// Generates a before/after video slideshow of visual regression snapshots.
//
// Workflow:
//   1. cp -r e2e/visual-regression.spec.js-snapshots{,-before}
//   2. npx playwright test e2e/visual-regression.spec.js --update-snapshots
//   3. node scripts/generate-showcase.js
//
// If a -before/ directory exists, each slide shows the old and new snapshot
// side by side.  If no -before/ exists, shows current snapshots only.
// The -before/ directory is removed after the video is written.
//
// Output: recordings/visual-regression-showcase.webm

const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const AFTER_DIR = path.join(
  __dirname,
  "..",
  "e2e",
  "visual-regression.spec.js-snapshots",
);
const BEFORE_DIR = AFTER_DIR + "-before";
const OUTPUT_DIR = path.join(__dirname, "..", "recordings");
const MS_PER_SLIDE = 3500;

function toBase64(filePath) {
  return fs.readFileSync(filePath).toString("base64");
}

function prettyLabel(filename) {
  return filename
    .replace(/-linux\.png$/, "")
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// ── Slide HTML generators ───────────────────────────────────────────

function comparisonSlide({ label, beforeB64, afterB64, index, total }) {
  return `<!DOCTYPE html><html><head><style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body {
      background:#04060f; height:100vh;
      display:flex; flex-direction:column; align-items:center; justify-content:center;
      font-family:'SF Mono','Consolas',monospace;
    }
    .title {
      color:#8ab0e8; font-size:15px; letter-spacing:.14em;
      text-transform:uppercase; margin-bottom:18px;
    }
    .title strong { color:#d8e4ff; }
    .pair {
      display:flex; gap:20px; align-items:center; justify-content:center;
      max-width:96%; max-height:82vh;
    }
    .panel { display:flex; flex-direction:column; align-items:center; }
    .panel-label {
      font-size:11px; letter-spacing:.18em; text-transform:uppercase;
      margin-bottom:8px;
    }
    .before .panel-label { color:#8ab0e8; }
    .after  .panel-label { color:#285aff; }
    .panel img {
      max-height:74vh; max-width:44vw; object-fit:contain;
      border:1px solid #1a2a5e; border-radius:6px;
    }
    .divider {
      width:1px; height:60vh; background:linear-gradient(transparent,#1a2a5e,transparent);
    }
    .counter { color:#1a2a5e; font-size:11px; margin-top:14px; letter-spacing:.1em; }
  </style></head><body>
    <div class="title">visual check &mdash; <strong>${label}</strong></div>
    <div class="pair">
      <div class="panel before">
        <div class="panel-label">before</div>
        <img src="data:image/png;base64,${beforeB64}" />
      </div>
      <div class="divider"></div>
      <div class="panel after">
        <div class="panel-label">after</div>
        <img src="data:image/png;base64,${afterB64}" />
      </div>
    </div>
    <div class="counter">${index} / ${total}</div>
  </body></html>`;
}

function singleSlide({ label, imgB64, index, total }) {
  return `<!DOCTYPE html><html><head><style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body {
      background:#04060f; height:100vh;
      display:flex; flex-direction:column; align-items:center; justify-content:center;
      font-family:'SF Mono','Consolas',monospace;
    }
    .title {
      color:#8ab0e8; font-size:15px; letter-spacing:.14em;
      text-transform:uppercase; margin-bottom:18px;
    }
    .title strong { color:#d8e4ff; }
    .panel-label {
      font-size:11px; letter-spacing:.18em; text-transform:uppercase;
      color:#285aff; margin-bottom:8px;
    }
    img {
      max-width:92%; max-height:82vh; object-fit:contain;
      border:1px solid #1a2a5e; border-radius:6px;
    }
    .counter { color:#1a2a5e; font-size:11px; margin-top:14px; letter-spacing:.1em; }
  </style></head><body>
    <div class="title">visual check &mdash; <strong>${label}</strong></div>
    <div class="panel-label">current baseline</div>
    <img src="data:image/png;base64,${imgB64}" />
    <div class="counter">${index} / ${total}</div>
  </body></html>`;
}

// ── Main ────────────────────────────────────────────────────────────

(async () => {
  const afterFiles = fs
    .readdirSync(AFTER_DIR)
    .filter((f) => f.endsWith(".png"))
    .sort();

  if (afterFiles.length === 0) {
    console.error(
      "No snapshots found. Run tests with --update-snapshots first.",
    );
    process.exit(1);
  }

  const hasBefore = fs.existsSync(BEFORE_DIR);
  const mode = hasBefore ? "before/after comparison" : "current baselines";
  console.log(
    `Found ${afterFiles.length} snapshots (${mode}). Recording showcase...`,
  );

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    recordVideo: { dir: OUTPUT_DIR, size: { width: 1920, height: 1080 } },
  });
  const page = await context.newPage();

  for (let i = 0; i < afterFiles.length; i++) {
    const file = afterFiles[i];
    const label = prettyLabel(file);
    const afterB64 = toBase64(path.join(AFTER_DIR, file));
    const index = i + 1;
    const total = afterFiles.length;

    let html;
    if (hasBefore && fs.existsSync(path.join(BEFORE_DIR, file))) {
      const beforeB64 = toBase64(path.join(BEFORE_DIR, file));
      html = comparisonSlide({ label, beforeB64, afterB64, index, total });
    } else {
      html = singleSlide({ label, imgB64: afterB64, index, total });
    }

    await page.setContent(html);
    await page.waitForTimeout(MS_PER_SLIDE);
    console.log(`  [${index}/${total}] ${label}`);
  }

  await context.close();
  await browser.close();

  // Playwright saves video with a random name — find the newest and rename it
  const dest = "visual-regression-showcase.webm";
  const recordings = fs
    .readdirSync(OUTPUT_DIR)
    .filter((f) => f.endsWith(".webm") && f !== dest)
    .map((f) => ({
      name: f,
      mtime: fs.statSync(path.join(OUTPUT_DIR, f)).mtimeMs,
    }))
    .sort((a, b) => b.mtime - a.mtime);

  if (recordings.length > 0) {
    const destPath = path.join(OUTPUT_DIR, dest);
    if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
    fs.renameSync(path.join(OUTPUT_DIR, recordings[0].name), destPath);
    console.log(`\nShowcase saved: recordings/${dest}`);
  }

  // Clean up the before directory
  if (hasBefore) {
    fs.rmSync(BEFORE_DIR, { recursive: true, force: true });
    console.log("Cleaned up before/ snapshots.");
  }
})();
