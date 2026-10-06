#!/usr/bin/env node
// Generates assets/favicon.svg, the site's "AD" monogram, with the letters drawn as
// OUTLINED PATHS (no <text>): a browser tab has no Fira Code to draw them with and an
// SVG icon cannot load a font.
//
//   node scripts/build-favicon.mjs            # rewrite assets/favicon.svg
//   node scripts/build-favicon.mjs --check    # exit 1 if assets/favicon.svg is stale
//
// Needs `opentype.js` (2.x) resolvable from the working directory or NODE_PATH. Not run
// by the build; the SVG is committed and `scripts/` is excluded from the Jekyll build.
// After rewriting the SVG, run scripts/render-icons.mjs to refresh favicon.ico and
// apple-touch-icon.png.
//
// Font: Fira Code SemiBold (weight 600), release 6.2 (2021-12-06) of
// https://github.com/tonsky/FiraCode, vendored unmodified at scripts/fonts/ with its SIL
// Open Font License 1.1 (scripts/fonts/OFL.txt). Outlining text into paths is allowed by
// the OFL; the license text travels with the font file.
//
// Layout, in the 64 x 64 viewBox: "AD" at font-size 30, letter-spacing -1, baseline y=43,
// centered on x=32. CSS letter-spacing is added after EVERY character (the last one
// included), so the run is advance("A") + advance("D") - 2 units wide and its left edge
// is 32 - width / 2. Fira Code is monospaced (600/1000 em), so each advance is 18 units
// at this size and the run is 34 wide.
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(process.cwd(), "noop.js"));
const opentype = require("opentype.js");

const FONT_FILE = join(root, "scripts", "fonts", "FiraCode-SemiBold.ttf");
// sha256 of FiraCode-SemiBold.ttf from the Fira_Code_v6.2.zip release asset (ttf/ directory).
const FONT_SHA256 = "500c74eec6249b06d49aef922dd3e8fc754c70c3b3f7791cd7b1a09ca9a26140";
const TEXT = "AD";
const SIZE = 30;
const LETTER_SPACING = -1;
const BASELINE_Y = 43;
const CENTER_X = 32;

const bytes = readFileSync(FONT_FILE);
const actual = createHash("sha256").update(bytes).digest("hex");
if (actual !== FONT_SHA256) {
  throw new Error(`${FONT_FILE} sha256 is ${actual}, expected ${FONT_SHA256}`);
}
const font = opentype.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
const scale = SIZE / font.unitsPerEm;

// cmap lookup per character, not stringToGlyphs: opentype.js's GSUB shaping throws on Fira
// Code's ligature tables, and "AD" has no ligature or contextual alternate to apply.
const glyphs = [...TEXT].map((ch) => font.charToGlyph(ch));
const advances = glyphs.map((g, i) => {
  const kern = i + 1 < glyphs.length ? font.getKerningValue(g, glyphs[i + 1]) : 0;
  return (g.advanceWidth + kern) * scale + LETTER_SPACING;
});
const width = advances.reduce((a, b) => a + b, 0);
let x = CENTER_X - width / 2;
const commands = [];
glyphs.forEach((g, i) => {
  commands.push(...g.getPath(x, BASELINE_Y, SIZE).commands);
  x += advances[i];
});
const outline = new opentype.Path();
outline.commands = commands;
// getPath already returns SVG (y-down) coordinates, so do not let toPathData flip them again.
const d = outline.toPathData({ decimalPlaces: 2, optimize: true, flipY: false });

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="AD">
  <!-- Adam Daniel's "AD" monogram in the site's Cobalt Thermal palette (the theme's
       main.css :root tokens): near-black #04060f tile, a #285aff glow rising from
       below center, text-primary #d8e4ff letters (the same pale blue as
       assets/images/logo.svg). The letters are outlined paths, not <text>, because a
       browser tab has no Fira Code to draw them with and an SVG icon cannot load a
       font. They are Fira Code SemiBold 600 at size 30, letter-spacing -1, baseline
       y=43, centered on x=32, outlined from scripts/fonts/FiraCode-SemiBold.ttf (Fira
       Code 6.2, SIL OFL 1.1) by scripts/build-favicon.mjs; edit that script, not the
       path. This file shadows the cms-platform theme's placeholder favicon.svg.
       favicon.ico and apple-touch-icon.png are rendered from it by
       scripts/render-icons.mjs, which drops the rounded corners for the full-bleed
       Apple icon and keeps the glow; rerun it after regenerating this. -->
  <defs>
    <radialGradient id="glow" cx="50%" cy="55%" r="60%">
      <stop offset="0" stop-color="#285aff" stop-opacity="0.55"/>
      <stop offset="1" stop-color="#285aff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="64" height="64" rx="14" fill="#04060f"/>
  <rect width="64" height="64" rx="14" fill="url(#glow)"/>
  <path fill="#d8e4ff" d="${d}"/>
</svg>
`;

const target = join(root, "assets", "favicon.svg");
if (process.argv.includes("--check")) {
  if (readFileSync(target, "utf8") !== svg) {
    console.error("assets/favicon.svg is stale: rerun node scripts/build-favicon.mjs");
    process.exit(1);
  }
} else {
  writeFileSync(target, svg);
}
