// @lane: local — verifies admin/ios-safari-idb-workaround.js contract
//
// Tests run on BOTH webkit-iphone16 (the workaround target — should
// activate) AND chromium-desktop-3k (where it should NOT activate).
//
// This locks in the contract for PR #1228's iOS Safari "Loading
// Entries…" hang workaround. It can't fully reproduce the iOS Safari
// IndexedDB silent-hang bug — Playwright WebKit doesn't emulate that
// runtime quirk — but it does verify:
//
//   1. UA detection: iPhone UA → workaround activates;
//      desktop UA → workaround is a no-op.
//   2. `window.indexedDB` and the companion IDB globals are
//      undefined after the workaround runs. localforage's
//      `typeof indexedDB === 'undefined'` driver-detect check
//      therefore returns false, so IDB is skipped entirely and
//      localforage uses the localStorage driver from the start.
//   3. The script is loaded BEFORE decap-cms.js (so the stub is in
//      place when Decap initialises localforage).
//   4. With the workaround active, Decap CMS still loads cleanly
//      (the login button appears, window.CMS is defined, no JS
//      errors) — i.e. the override doesn't break Decap.

const { test, expect } = require("./base");

test.describe(
  "admin/ios-safari-idb-workaround.js",
  { tag: ["@admin-read"] },
  () => {
    test("loads BEFORE decap-cms.js in admin/index.html script order", async ({
      page,
    }) => {
      // The local-served admin file is the same HTML the prod /admin/
      // serves; checking it once is enough.
      await page.goto("/admin/");
      const scripts = await page.$$eval('script[src]', (els) =>
        els.map((e) => e.getAttribute("src")),
      );
      const workaroundIdx = scripts.findIndex((s) =>
        /ios-safari-idb-workaround\.js$/.test(s),
      );
      const decapIdx = scripts.findIndex((s) =>
        /decap-cms@.*\/decap-cms\.js$/.test(s),
      );
      expect(workaroundIdx).toBeGreaterThanOrEqual(0);
      expect(decapIdx).toBeGreaterThanOrEqual(0);
      expect(workaroundIdx).toBeLessThan(decapIdx);
    });

    test("activates on webkit-iphone16, no-op on chromium-desktop-3k", async ({
      page,
      browserName,
    }, testInfo) => {
      await page.goto("/admin/");
      // Wait for the workaround script to have executed (sync, top of
      // body) — defer scripts may not have run yet but the workaround
      // isn't a defer script, so it's available immediately on
      // document end.
      await page.waitForFunction(
        () => window.__adamdaniel_ios_safari_idb_workaround_installed === true,
        { timeout: 10_000 },
      );

      const state = await page.evaluate(() => ({
        installed: !!window.__adamdaniel_ios_safari_idb_workaround_installed,
        active: !!window.__adamdaniel_ios_safari_idb_workaround_active,
        ua: navigator.userAgent,
      }));

      expect(state.installed).toBe(true);

      // webkit-iphone16 project sets a real iPhone-like UA; the
      // workaround should activate. Other projects (chromium-desktop-3k)
      // should NOT have it active.
      const isIphoneProject = /iphone/i.test(testInfo.project.name);
      expect(state.active).toBe(isIphoneProject);
    });

    test("on iPhone, window.indexedDB and IDB companion globals are undefined", async ({
      page,
    }, testInfo) => {
      test.skip(!/iphone/i.test(testInfo.project.name),
        "Workaround only activates on iPhone UA; nothing to verify on desktop.");

      await page.goto("/admin/");
      await page.waitForFunction(
        () => window.__adamdaniel_ios_safari_idb_workaround_active === true,
        { timeout: 10_000 },
      );

      const probes = await page.evaluate(() => ({
        indexedDBType: typeof window.indexedDB,
        idbKeyRangeType: typeof window.IDBKeyRange,
        idbDatabaseType: typeof window.IDBDatabase,
        // localforage's actual driver-detect check.
        localforageWouldSkipIDB: typeof indexedDB === "undefined",
      }));

      expect(probes.indexedDBType).toBe("undefined");
      expect(probes.idbKeyRangeType).toBe("undefined");
      expect(probes.idbDatabaseType).toBe("undefined");
      expect(probes.localforageWouldSkipIDB).toBe(true);
    });

    test("with workaround active, Decap still loads cleanly", async ({
      page,
    }) => {
      const pageErrors = [];
      page.on("pageerror", (e) => pageErrors.push(`${e.name}: ${e.message}`));

      await page.goto("/admin/");

      // Login button is Decap's first user-visible UI element. If
      // Decap failed to initialise (workaround broke something) it
      // would never appear.
      const loginBtn = page.getByRole("button", { name: /login/i });
      await expect(loginBtn).toBeVisible({ timeout: 30_000 });

      // window.CMS is defined when Decap's bundle has fully executed.
      const cmsType = await page.evaluate(() => typeof window.CMS);
      expect(cmsType).toBe("object");

      expect(pageErrors).toEqual([]);
    });
  },
);
