/*
 * admin/preview-bridge.js — wires Decap CMS saves to the live preview page.
 *
 * Boots after Decap's `window.CMS` global is defined, then:
 *   1. Registers a `postSave` event listener. On every save, the current
 *      entry is broadcast via a same-origin BroadcastChannel that the
 *      `/preview/` page subscribes to, so every open preview tab updates
 *      within a frame of Save being pressed.
 *   2. Injects a "Live Preview" link into the editor toolbar. Clicking it
 *      opens `/preview/?collection=<current>` in a new tab.
 *
 * Uses only Decap's public CMS API (`registerEventListener`) and a generic
 * DOM observer for the button — no internal selectors, so it survives
 * Decap minor-version churn.
 *
 * Exposed for tests: window.adamdaniel_cms_preview_url(collection).
 */
(function () {
  "use strict";

  var CHANNEL_NAME = "adamdaniel-cms-preview";
  var CMS_READY_TIMEOUT_MS = 30_000;
  var CMS_POLL_INTERVAL_MS = 100;

  var channel = null;
  try {
    channel = new BroadcastChannel(CHANNEL_NAME);
  } catch (_) {
    // Very old browser — no live preview, but don't break the admin.
  }

  function buildPreviewURL(collection) {
    var safe = String(collection || "posts").replace(/[^a-zA-Z0-9_-]/g, "");
    return (
      window.location.origin + "/preview/?collection=" + encodeURIComponent(safe)
    );
  }
  window.adamdaniel_cms_preview_url = buildPreviewURL;

  function readEntry(entry) {
    if (!entry) return null;

    // Decap passes Immutable.js records with `get()` / `toJS()`; our
    // test harness passes plain objects with the same shape. Handle both.
    var dataHolder = typeof entry.get === "function" ? entry.get("data") : entry.data;
    var fields =
      dataHolder && typeof dataHolder.toJS === "function"
        ? dataHolder.toJS()
        : dataHolder || {};

    var collection =
      (typeof entry.get === "function" ? entry.get("collection") : entry.collection) ||
      null;

    return { collection: collection, fields: fields };
  }

  function broadcast(entry) {
    if (!channel) return;
    var payload = readEntry(entry);
    if (!payload) return;
    channel.postMessage({
      type: "cms-preview-update",
      collection: payload.collection,
      fields: payload.fields,
    });
  }

  function registerWithCMS(CMS) {
    if (!CMS || typeof CMS.registerEventListener !== "function") return false;
    CMS.registerEventListener({
      name: "postSave",
      handler: function (event) {
        broadcast(event && event.entry);
      },
    });
    return true;
  }

  function waitForCMS() {
    var start = Date.now();
    var tick = function () {
      if (registerWithCMS(window.CMS)) return;
      if (Date.now() - start > CMS_READY_TIMEOUT_MS) {
        // Give up silently. The admin still works; only live preview is lost.
        return;
      }
      setTimeout(tick, CMS_POLL_INTERVAL_MS);
    };
    tick();
  }

  // Inject a "Live Preview" link into Decap's entry editor toolbar.
  // The toolbar selectors may shift across Decap releases, so the injector
  // is defensive: it looks for any anchor/button labelled "View on Live
  // Site" and attaches a sibling. If no such anchor is found, the link
  // simply doesn't appear — a harmless no-op.
  function injectLivePreviewButton() {
    var inferCollection = function () {
      // URL hash pattern: #/collections/<name>/entries/<id>
      var m = /#\/collections\/([^\/]+)/.exec(window.location.hash || "");
      return m ? m[1] : "posts";
    };

    var already = function (root) {
      return root.querySelector('[data-adamdaniel-live-preview]');
    };

    var tryInject = function () {
      // Walk all candidate roots including shadow DOMs.
      var roots = [document];
      var walk = function (node) {
        if (node.shadowRoot) roots.push(node.shadowRoot);
        for (var i = 0; i < node.children.length; i++) walk(node.children[i]);
      };
      walk(document.documentElement);

      for (var i = 0; i < roots.length; i++) {
        var root = roots[i];
        if (already(root)) continue;
        var anchor = root.querySelector(
          'a[aria-label*="Live Site" i], button[aria-label*="Live Site" i]'
        );
        if (!anchor) continue;
        var link = document.createElement("a");
        link.setAttribute("data-adamdaniel-live-preview", "");
        link.textContent = "Live Preview";
        link.href = buildPreviewURL(inferCollection());
        link.target = "_blank";
        link.rel = "noopener";
        link.style.cssText =
          "margin-left:0.5em;font-size:0.85em;color:var(--primary-color,#285aff);" +
          "text-decoration:underline;cursor:pointer;align-self:center;";
        anchor.parentNode.insertBefore(link, anchor.nextSibling);
        return true;
      }
      return false;
    };

    var observer = new MutationObserver(function () {
      tryInject();
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
    tryInject();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      waitForCMS();
      injectLivePreviewButton();
    });
  } else {
    waitForCMS();
    injectLivePreviewButton();
  }
})();
