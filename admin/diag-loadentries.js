/*
 * admin/diag-loadentries.js — diagnostic-only.
 *
 * Detects when Decap's "Loading Entries…" spinner persists for more
 * than HANG_THRESHOLD_MS and renders an in-page banner showing the
 * state needed to identify the cause of the hang:
 *
 *   - pending fetches (URL, method, ms-since-start)
 *   - failed fetches and their network-error category
 *   - the most recent api.github.com response statuses
 *   - any IndexedDB-open errors observed since page load
 *   - last 10 console errors
 *   - user agent, Decap version, localforage backend
 *
 * The banner has a "Copy diagnostic" button so the user can paste it
 * into a PR comment. It also writes the same blob into
 * `window.__adamdaniel_diag` for Web-Inspector access.
 *
 * Zero-cost when the spinner doesn't persist: the only at-rest work
 * is one MutationObserver text-content check that bails out the
 * moment "Loading Entries" leaves the DOM. The fetch wrap is a thin
 * passthrough that records URL + start-time and returns the original
 * fetch promise unchanged.
 *
 * Loaded by admin/index.html as a defer script; runs only in the
 * admin shell. Remove this file when the iOS Safari "Loading
 * Entries…" hang (PR #1228) is fully diagnosed and fixed.
 */
(function () {
  "use strict";
  if (typeof window === "undefined") return;
  if (window.__adamdaniel_diag_installed) return;
  window.__adamdaniel_diag_installed = true;

  var HANG_THRESHOLD_MS = 8000;
  var BANNER_ID = "adamdaniel-loadentries-diag";

  var pendingFetches = new Map();
  var recentResponses = [];
  var failedFetches = [];
  var consoleErrors = [];
  var idbErrors = [];
  var startedAt = Date.now();

  // ── fetch wrap ───────────────────────────────────────────────────
  var origFetch = window.fetch;
  if (typeof origFetch === "function") {
    window.fetch = function (input, init) {
      var url = typeof input === "string"
        ? input
        : (input && input.url) || "(unknown)";
      var method =
        ((init && init.method) ||
          (input && input.method) ||
          "GET").toUpperCase();
      var startedAt = Date.now();
      var rec = { url: url, method: method, startedAt: startedAt };
      pendingFetches.set(rec, rec);
      return origFetch.apply(this, arguments).then(
        function (res) {
          pendingFetches.delete(rec);
          if (/api\.github\.com/.test(url) || /\/git\//.test(url)) {
            recentResponses.push({
              url: url,
              method: method,
              status: res && res.status,
              elapsedMs: Date.now() - startedAt,
            });
            if (recentResponses.length > 20) recentResponses.shift();
          }
          return res;
        },
        function (err) {
          pendingFetches.delete(rec);
          failedFetches.push({
            url: url,
            method: method,
            error: (err && err.name) + ": " + (err && err.message),
            elapsedMs: Date.now() - startedAt,
          });
          if (failedFetches.length > 20) failedFetches.shift();
          throw err;
        }
      );
    };
  }

  // ── IndexedDB wrap ───────────────────────────────────────────────
  // localforage / Decap's backend cache uses indexedDB. In iOS Safari
  // Private mode the open() can succeed but later operations hang or
  // throw QuotaExceededError. Capture both.
  try {
    var origOpen = window.indexedDB && window.indexedDB.open;
    if (origOpen) {
      window.indexedDB.open = function () {
        var req = origOpen.apply(this, arguments);
        try {
          var dbName = arguments[0];
          req.addEventListener("error", function () {
            idbErrors.push({
              op: "open",
              dbName: dbName,
              error:
                (req.error && req.error.name) +
                ": " +
                (req.error && req.error.message),
              at: Date.now() - startedAt,
            });
          });
          req.addEventListener("blocked", function () {
            idbErrors.push({
              op: "open-blocked",
              dbName: dbName,
              at: Date.now() - startedAt,
            });
          });
        } catch (_) {}
        return req;
      };
    }
  } catch (_) {}

  // ── console.error capture ────────────────────────────────────────
  var origConsoleError = console.error;
  console.error = function () {
    try {
      var msg = Array.prototype.map
        .call(arguments, function (a) {
          if (a instanceof Error) return a.name + ": " + a.message;
          if (typeof a === "string") return a;
          try {
            return JSON.stringify(a);
          } catch (_) {
            return String(a);
          }
        })
        .join(" ");
      consoleErrors.push({ msg: msg.slice(0, 400), at: Date.now() - startedAt });
      if (consoleErrors.length > 10) consoleErrors.shift();
    } catch (_) {}
    return origConsoleError.apply(this, arguments);
  };

  window.addEventListener("unhandledrejection", function (e) {
    try {
      var r = e.reason;
      var msg = r instanceof Error ? r.name + ": " + r.message : String(r);
      consoleErrors.push({
        msg: "[unhandledrejection] " + msg.slice(0, 400),
        at: Date.now() - startedAt,
      });
      if (consoleErrors.length > 10) consoleErrors.shift();
    } catch (_) {}
  });

  // ── spinner detection ────────────────────────────────────────────
  // `textContent` walks the DOM but doesn't force layout, so it's
  // safe to call every 1.5s. Decap renders the spinner text as a
  // top-level child of the main pane, so substring match suffices.
  function spinnerVisible() {
    if (!document.body) return false;
    return /Loading Entries/i.test(document.body.textContent || "");
  }

  var firstSeenAt = null;
  var lastBannerAt = 0;
  var poll = setInterval(function () {
    if (!document.body) return;
    var visible = false;
    try {
      visible = spinnerVisible();
    } catch (_) {}
    if (visible) {
      if (firstSeenAt == null) firstSeenAt = Date.now();
      var elapsed = Date.now() - firstSeenAt;
      if (
        elapsed >= HANG_THRESHOLD_MS &&
        Date.now() - lastBannerAt > 2000
      ) {
        renderBanner(elapsed);
        lastBannerAt = Date.now();
      }
    } else {
      firstSeenAt = null;
      removeBanner();
    }
  }, 1500);

  function pendingArray() {
    var out = [];
    pendingFetches.forEach(function (r) {
      out.push({
        url: r.url,
        method: r.method,
        ageMs: Date.now() - r.startedAt,
      });
    });
    out.sort(function (a, b) {
      return b.ageMs - a.ageMs;
    });
    return out;
  }

  function buildDiag(spinnerElapsedMs) {
    var u =
      (function () {
        try {
          var raw = localStorage.getItem("decap-cms-user");
          if (!raw) return null;
          var p = JSON.parse(raw);
          return p && p.login ? { login: p.login, hasToken: !!p.token } : null;
        } catch (_) {
          return { error: "localStorage read failed" };
        }
      })();
    return {
      spinnerVisibleForMs: spinnerElapsedMs,
      userAgent: navigator.userAgent,
      decapVersion:
        (window.CMS && window.CMS.version) ||
        (window.netlifyCMS && window.netlifyCMS.version) ||
        "(unknown)",
      adminCommit:
        (document.querySelector("#cms-commit-pill") || {}).title || null,
      decapUser: u,
      url: location.href,
      pendingFetches: pendingArray(),
      failedFetches: failedFetches.slice(),
      recentApiResponses: recentResponses.slice(),
      idbErrors: idbErrors.slice(),
      consoleErrors: consoleErrors.slice(),
      storageProbe: probeStorage(),
    };
  }

  function probeStorage() {
    var out = {};
    try {
      out.localStorage = !!window.localStorage;
      try {
        window.localStorage.setItem("__diag_probe__", "1");
        window.localStorage.removeItem("__diag_probe__");
        out.localStorageWritable = true;
      } catch (e) {
        out.localStorageWritable = false;
        out.localStorageError = e.name + ": " + e.message;
      }
    } catch (e) {
      out.localStorageError = "outer: " + e.message;
    }
    try {
      out.indexedDB = !!window.indexedDB;
    } catch (_) {
      out.indexedDB = "throws";
    }
    try {
      out.broadcastChannel = typeof window.BroadcastChannel !== "undefined";
    } catch (_) {
      out.broadcastChannel = "throws";
    }
    try {
      out.serviceWorker = !!(navigator.serviceWorker);
    } catch (_) {
      out.serviceWorker = "throws";
    }
    out.iosSafariIdbWorkaroundActive =
      !!window.__adamdaniel_ios_safari_idb_workaround_active;
    return out;
  }

  function renderBanner(spinnerElapsedMs) {
    var diag = buildDiag(spinnerElapsedMs);
    window.__adamdaniel_diag = diag;

    var existing = document.getElementById(BANNER_ID);
    var banner = existing || document.createElement("div");
    banner.id = BANNER_ID;
    banner.style.cssText = [
      "position:fixed;top:1rem;left:50%;transform:translateX(-50%);",
      "z-index:2147483647;max-width:min(95vw,860px);max-height:80vh;",
      "overflow:auto;background:#fff7ed;border:2px solid #c2410c;",
      "border-radius:8px;padding:0.9rem 1rem;",
      "font:13px/1.45 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;",
      "color:#1f2937;box-shadow:0 8px 24px rgba(0,0,0,0.18);",
    ].join("");

    var pending = diag.pendingFetches
      .map(function (p) {
        return "  " + p.method + " " + p.url + " (pending " + p.ageMs + "ms)";
      })
      .join("\n");

    var recent = diag.recentApiResponses
      .map(function (r) {
        return "  " + r.status + " " + r.method + " " + r.url + " (" + r.elapsedMs + "ms)";
      })
      .join("\n");

    var fails = diag.failedFetches
      .map(function (f) {
        return "  " + f.method + " " + f.url + " → " + f.error;
      })
      .join("\n");

    var errs = diag.consoleErrors
      .map(function (c) {
        return "  [t+" + c.at + "ms] " + c.msg;
      })
      .join("\n");

    var idb = diag.idbErrors
      .map(function (e) {
        return "  " + e.op + " " + (e.dbName || "") + " " + (e.error || "");
      })
      .join("\n");

    var text =
      "Loading Entries… stuck for " +
      Math.round(spinnerElapsedMs / 1000) +
      "s\n\n" +
      "URL: " + diag.url + "\n" +
      "Admin: " + (diag.adminCommit || "(unknown)") + "\n" +
      "Decap: " + diag.decapVersion + "\n" +
      "User: " + JSON.stringify(diag.decapUser) + "\n" +
      "UA: " + diag.userAgent + "\n" +
      "Storage: " + JSON.stringify(diag.storageProbe) + "\n\n" +
      "Pending fetches:\n" + (pending || "  (none)") + "\n\n" +
      "Recent api.github.com responses:\n" + (recent || "  (none)") + "\n\n" +
      "Failed fetches:\n" + (fails || "  (none)") + "\n\n" +
      "Console errors:\n" + (errs || "  (none)") + "\n\n" +
      "IDB errors:\n" + (idb || "  (none)");

    banner.innerHTML =
      '<div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.5rem">' +
      '<strong style="color:#c2410c;font-size:14px">⚠ Loading Entries diagnostic</strong>' +
      '<button id="' + BANNER_ID + '-copy" style="margin-left:auto;font:inherit;padding:0.25rem 0.6rem;border:1px solid #c2410c;border-radius:4px;background:#fff;color:#c2410c;cursor:pointer">Copy</button>' +
      '<button id="' + BANNER_ID + '-close" style="font:inherit;padding:0.25rem 0.6rem;border:1px solid #9ca3af;border-radius:4px;background:#fff;color:#374151;cursor:pointer">×</button>' +
      "</div>" +
      '<pre id="' + BANNER_ID + '-pre" style="white-space:pre-wrap;word-break:break-all;margin:0;font:12px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;background:#fffbeb;padding:0.6rem;border-radius:4px;border:1px solid #fde68a"></pre>';
    banner.querySelector("#" + BANNER_ID + "-pre").textContent = text;

    if (!existing) document.body.appendChild(banner);

    var copyBtn = banner.querySelector("#" + BANNER_ID + "-copy");
    copyBtn.onclick = function () {
      try {
        navigator.clipboard.writeText(text);
        copyBtn.textContent = "Copied!";
        setTimeout(function () {
          copyBtn.textContent = "Copy";
        }, 1500);
      } catch (e) {
        copyBtn.textContent = "Copy failed";
      }
    };
    var closeBtn = banner.querySelector("#" + BANNER_ID + "-close");
    closeBtn.onclick = function () {
      banner.remove();
      clearInterval(poll);
    };
  }

  function removeBanner() {
    var b = document.getElementById(BANNER_ID);
    if (b) b.remove();
  }
})();
