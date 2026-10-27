#!/usr/bin/env node
// Renders the raster icons from the source monogram, assets/favicon.svg:
//
//   favicon.ico            16, 32 and 48 px, PNG-in-ICO (the /favicon.ico probe)
//   apple-touch-icon.png   180 px, full-bleed square (iOS rounds the corners itself
//                          and paints transparent pixels black); keeps the glow
//
//   node scripts/render-icons.mjs
//
// Needs `playwright-core` resolvable from the working directory (or NODE_PATH) and a
// Chromium: set CHROME to a chrome/chrome-headless-shell binary, or leave it unset to
// use Playwright's own. Not run by the build; the PNG/ICO outputs are committed, and
// the SVG is the source of truth. `scripts/` is excluded from the Jekyll build.
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(process.cwd(), "noop.js"));
const { chromium } = require("playwright-core");

const svg = readFileSync(join(root, "assets", "favicon.svg"), "utf8");
if (!svg.includes(' rx="14"')) throw new Error('assets/favicon.svg lost its rounded background (rx="14")');
if (!svg.includes('fill="url(#glow)"')) throw new Error('assets/favicon.svg lost its glow overlay (fill="url(#glow)")');
// The Apple icon is a full-bleed square: iOS rounds it itself, so drop the tile's and the
// glow overlay's corner radius (the glow stays).
const square = svg.replaceAll(' rx="14"', "");

const browser = await chromium.launch({
  executablePath: process.env.CHROME || undefined,
  args: ["--no-sandbox"],
});

async function png(source, size) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  const html = `<!doctype html><style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${source}`;
  await page.setContent(html);
  const buf = await page.screenshot({ omitBackground: true });
  await page.close();
  return buf;
}

const icoPngs = [];
for (const size of [16, 32, 48]) icoPngs.push({ size, data: await png(svg, size) });

// ICO container: ICONDIR, one ICONDIRENTRY per image, then the PNG payloads.
const header = Buffer.alloc(6);
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(icoPngs.length, 4);
let offset = 6 + 16 * icoPngs.length;
const entries = icoPngs.map(({ size, data }) => {
  const e = Buffer.alloc(16);
  e.writeUInt8(size, 0);
  e.writeUInt8(size, 1);
  e.writeUInt16LE(1, 4); // planes
  e.writeUInt16LE(32, 6); // bits per pixel
  e.writeUInt32LE(data.length, 8);
  e.writeUInt32LE(offset, 12);
  offset += data.length;
  return e;
});
writeFileSync(join(root, "favicon.ico"), Buffer.concat([header, ...entries, ...icoPngs.map((i) => i.data)]));
writeFileSync(join(root, "apple-touch-icon.png"), await png(square, 180));

await browser.close();
