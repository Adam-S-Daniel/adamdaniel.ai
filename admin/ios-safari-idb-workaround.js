/*
 * admin/ios-safari-idb-workaround.js — fix for the iOS Safari
 * "Loading Entries…" hang (PR #1228).
 *
 * Decap CMS's lib-util `readFile` caches GitHub blob content with
 * `localforage.getItem` / `localforage.setItem` (see
 * `packages/decap-cms-lib-util/src/API.ts:readFile`, called from
 * every backend's `getMediaAsBlob` / `getMedia` / `entry-load`
 * code path). localforage defaults to IndexedDB.
 *
 * iOS Safari (both regular and Private modes) has long-standing
 * IndexedDB issues where individual transactions silently hang —
 * the open() succeeds, but getItem() / setItem() awaits never
 * resolve and never throw. Decap awaits localforage with no
 * timeout, so loadEntries gets stuck after fetching the file
 * list — the user sees "Loading Entries…" forever, the network
 * tab shows no in-flight request, and no error reaches the
 * console.
 *
 * The cleanest workaround is to force localforage to skip IDB
 * entirely on iOS Safari and fall through to its localStorage
 * driver. localforage's driver-selection happens at first
 * .getItem() call, so we have to make IDB look unavailable
 * BEFORE Decap's bundle initialises its localforage instance.
 *
 * Earlier rev of this file stubbed `indexedDB.open()` to fire
 * `error` on the request — localforage's open-failure path
 * then falls through. But user testing (PR #1228 retest after
 * editorial-workflow PR cleanup) showed that path still hangs:
 * Decap re-renders fire fresh getItem()s on every state
 * transition, and the IDB driver re-attempts open each time,
 * piling up async timers that never converge. Now we
 * `Object.defineProperty` `indexedDB` to undefined so
 * localforage's `typeof indexedDB === 'undefined'` driver-
 * detection check returns false at module init and IDB is
 * skipped entirely — never even tried.
 *
 * Safe for our admin: no other admin script (preview-bridge,
 * posts-list-enhance, deploy-status-pill, etc.) uses IndexedDB
 * — they all key off sessionStorage / localStorage. Decap's
 * localforage cache is small (file contents, 5-min TTL) and
 * fits comfortably inside localStorage's 5–10 MB origin quota
 * even for repos with hundreds of small markdown files.
 *
 * Targeted by UA so other browsers (Chrome, Firefox, desktop
 * Safari without ITP weirdness) keep IndexedDB and the bigger
 * quota that comes with it. UA-sniff is justified here because
 * the workaround targets a runtime bug in WebKit's IDB
 * implementation that has no feature-detect counterpart.
 *
 * Load order: MUST run before decap-cms.js so the override is
 * in place when Decap initialises localforage. admin/index.html
 * loads this immediately after publish-via-auto-merge.js and
 * before the Decap CDN script.
 *
 * Remove this file when iOS Safari IDB stops hanging, or when
 * Decap upstream adds a timeout around localforage calls
 * (decaporg/decap-cms#3605 + #3649 added fetch timeouts in
 * 2020 but cache-layer awaits are still unguarded as of 3.12.2).
 */
(function () {
  "use strict";
  if (typeof window === "undefined") return;
  if (window.__adamdaniel_ios_safari_idb_workaround_installed) return;
  window.__adamdaniel_ios_safari_idb_workaround_installed = true;

  // UA-detect iOS Safari. Match real iOS (iPhone / iPad / iPod) AND
  // iPadOS 13+ which reports as Macintosh + touch (so additionally
  // require `maxTouchPoints > 1` for the Mac case). Exclude in-app
  // browsers (Chrome iOS = CriOS, Firefox iOS = FxiOS, etc.) which
  // are all WebKit underneath but have their own quirks we don't
  // want to second-guess.
  function isIOSSafari() {
    try {
      var ua = navigator.userAgent || "";
      var isIOSDevice = /iPad|iPhone|iPod/.test(ua) && !window.MSStream;
      var isiPadOSMasqueradingAsMac =
        /Macintosh/.test(ua) &&
        navigator.maxTouchPoints &&
        navigator.maxTouchPoints > 1;
      if (!(isIOSDevice || isiPadOSMasqueradingAsMac)) return false;
      // Exclude embedded WebViews (CriOS = Chrome, FxiOS = Firefox,
      // EdgiOS = Edge, OPiOS = Opera, GSA = Google App).
      if (/CriOS|FxiOS|EdgiOS|OPiOS|GSA/.test(ua)) return false;
      return true;
    } catch (_) {
      return false;
    }
  }

  if (!isIOSSafari()) return;

  try {
    if (typeof window.indexedDB === "undefined" || !window.indexedDB) {
      return;
    }

    // window.indexedDB is a getter on WindowOrWorkerGlobalScope's
    // prototype in WebKit, so plain assignment won't take. Use
    // defineProperty to install an own-property that shadows the
    // prototype getter and resolves to `undefined`. Also blank out
    // the companion IDB globals (IDBKeyRange, IDBDatabase, etc.)
    // because some libraries probe those instead of `indexedDB`
    // itself, and we want any IDB feature-detect to return false.
    var idbGlobals = [
      "indexedDB",
      "IDBKeyRange",
      "IDBDatabase",
      "IDBTransaction",
      "IDBObjectStore",
      "IDBIndex",
      "IDBCursor",
      "IDBRequest",
      "IDBOpenDBRequest",
      "IDBVersionChangeEvent",
      "IDBFactory",
    ];
    for (var i = 0; i < idbGlobals.length; i++) {
      var key = idbGlobals[i];
      try {
        Object.defineProperty(window, key, {
          value: undefined,
          configurable: true,
          writable: true,
        });
      } catch (_) {
        // Fall back to plain assignment if defineProperty fails
        // (e.g. if a non-configurable descriptor already exists).
        try {
          window[key] = undefined;
        } catch (__) {}
      }
    }

    // Mark on the global so the diagnostic banner can report
    // whether the workaround is active.
    window.__adamdaniel_ios_safari_idb_workaround_active = true;
  } catch (_) {
    // If the override itself throws, leave IDB alone — better to
    // let Decap hit the hang than to break it harder.
  }
})();
