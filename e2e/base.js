const { test: base, expect } = require("@playwright/test");

// Custom fixture that adds a rootFontSize option.
// Projects can set rootFontSize (e.g. "20px") to simulate users who configure
// a larger default font in their browser — the root <html> element's font-size
// is applied via an init script before any navigation.
exports.test = base.extend({
  rootFontSize: [null, { option: true }],

  page: async ({ page, rootFontSize }, use) => {
    if (rootFontSize) {
      await page.addInitScript((size) => {
        document.documentElement.style.fontSize = size;
      }, rootFontSize);
    }
    await use(page);
  },
});

exports.expect = expect;
