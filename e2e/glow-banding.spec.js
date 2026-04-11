const { test, expect } = require("./base");
const { PNG } = require("pngjs");

test.describe("Glow effect quality", () => {
  test("background glow gradient renders without visible color banding", async ({
    page,
  }) => {
    await page.goto("/");

    // Forced-colors mode strips decorative backgrounds — no gradient to sample.
    const isForcedColors = await page.evaluate(() =>
      window.matchMedia("(forced-colors: active)").matches,
    );
    test.skip(isForcedColors, "Gradient not rendered in forced-colors mode");

    // Hide page content so only background glow is visible for pixel analysis.
    // Freeze all animations at peak glow (end of the 8s warmth cycle = max opacity).
    await page.addStyleTag({
      content: `
        .site-wrapper { visibility: hidden !important; }
        *, *::before, *::after {
          animation-play-state: paused !important;
          animation-delay: -8s !important;
        }
      `,
    });

    await page.waitForTimeout(200);

    const screenshot = await page.screenshot({ type: "png" });
    const png = PNG.sync.read(screenshot);

    // Sample a horizontal line at the vertical center of the viewport,
    // from 10% to 50% width — this crosses through the radial gradient
    // transition where banding is most visible.
    const y = Math.floor(png.height / 2);
    const startX = Math.floor(png.width * 0.1);
    const endX = Math.floor(png.width * 0.5);

    const pixelColors = [];
    for (let x = startX; x < endX; x++) {
      const idx = (y * png.width + x) * 4;
      pixelColors.push({
        r: png.data[idx],
        g: png.data[idx + 1],
        b: png.data[idx + 2],
      });
    }

    // Measure the longest consecutive run of identical pixel colors.
    // With banding, the gradient forms visible "steps" — large blocks of the
    // same color that the eye perceives as discrete bands rather than a smooth
    // transition.  A smooth (dithered) gradient should never produce runs
    // longer than a few pixels.
    let maxRun = 1;
    let currentRun = 1;
    for (let i = 1; i < pixelColors.length; i++) {
      const prev = pixelColors[i - 1];
      const curr = pixelColors[i];
      if (prev.r === curr.r && prev.g === curr.g && prev.b === curr.b) {
        currentRun++;
        if (currentRun > maxRun) maxRun = currentRun;
      } else {
        currentRun = 1;
      }
    }

    // Anything over 4 identical consecutive pixels is perceptible banding.
    expect(maxRun).toBeLessThanOrEqual(4);
  });
});
