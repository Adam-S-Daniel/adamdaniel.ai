/*
 * admin/live-url-banner.js — renders a "View page on site:" banner at
 * the top of every entry-edit page in the Decap admin.
 *
 * The whole banner row is a single anchor when there's a destination
 * to click through to — `data-testid="cms-live-url-banner-link"` is the
 * stable hook e2e specs use to find it (e2e/cms-banner-clickable.spec.js).
 *
 * URL computation lives in `admin/live-url-derive.js` so the native
 * "View Live" toolbar override (`admin/native-preview-href.js`) can
 * compute the same URL without bundling. This file owns rendering only.
 *
 * Stateful sources (read inside `live-url-derive.js`):
 *   - `<input id="title-field-N">` — title text
 *   - `<input id="slug-field-N">` — explicit URL slug (optional)
 *   - `<input id="name-field-N">` — for tags (label is the slug source)
 *   - `<input id="permalink-field-N">` — for pages
 *   - `<button role="switch">` inside the Published field's
 *     ControlContainer — aria-checked = "true" / "false"
 *
 * Robust against Decap class churn: the only emotion-class anchors
 * are `ControlPaneContainer` (insertion point) and `ControlContainer`
 * (Published toggle's wrapper) — both stable component names.
 */
(function () {
  "use strict";

  var BANNER_ID = "cms-live-url";

  // window.LiveURL is provided by admin/live-url-derive.js, which MUST be
  // loaded before this script (see admin/index*.html ordering).
  function compute() {
    return window.LiveURL ? window.LiveURL.compute() : null;
  }

  function ensureBanner() {
    var existing = document.getElementById(BANNER_ID);
    if (existing) return existing;
    // Inner ControlPaneContainer = the form area; outer is the split-pane
    // parent that contains both form + preview panes. We want the inner.
    var panes = document.querySelectorAll('[class*="ControlPaneContainer"]');
    var pane = null;
    for (var i = 0; i < panes.length; i++) {
      if (panes[i].className.indexOf("PreviewPaneContainer") === -1) {
        pane = panes[i];
        break;
      }
    }
    if (!pane) return null;

    var b = document.createElement("div");
    b.id = BANNER_ID;
    b.style.cssText = [
      "padding:0.55rem 0.85rem",
      "margin:0.75rem 5rem 1rem",
      "border:1px solid #1a2a5e",
      "border-radius:6px",
      "background:#060d1f",
      "font-family:'Helvetica Neue',Arial,sans-serif",
      "font-size:0.78rem",
      "color:#a8b3c8",
      "display:flex",
      "align-items:baseline",
      "gap:0.5em",
      "flex-wrap:wrap",
    ].join(";") + ";";
    pane.insertBefore(b, pane.firstChild);
    return b;
  }

  // Cache the last-rendered markup so unchanged re-renders are no-ops.
  // Without this, the MutationObserver on document.body would observe
  // every `banner.innerHTML = …` write and schedule another render,
  // detaching the anchor mid-click and producing a "click → element
  // detached" flake against the very thing this banner is for.
  var lastHTML = null;

  function render() {
    var banner = ensureBanner();
    if (!banner) return;
    var data = compute();
    if (!data) {
      if (banner.style.display !== "none") banner.style.display = "none";
      return;
    }
    if (banner.style.display === "none") banner.style.display = "";

    // Label span — same styling whether or not the row is wrapped in an
    // anchor. Color stays even on the anchor case (the outer anchor uses
    // `color:inherit` so children render their own colors).
    var labelHTML =
      '<span style="font-weight:600;color:#8ab0e8;text-transform:uppercase;letter-spacing:0.08em;font-size:0.7rem;font-family:\'SF Mono\',\'Fira Code\',monospace;">View page on site:</span>';

    var nextHTML;
    if (data.published === false) {
      // No destination → render plain spans, no anchor. An anchor with
      // no href would be misleading; the row is informational here.
      nextHTML =
        labelHTML + ' <span style="font-style:italic;">Not yet published.</span>';
    } else if (!data.url) {
      nextHTML =
        labelHTML +
        ' <span style="font-style:italic;">Set a title or slug to see the URL.</span>';
    } else {
      // Live URL state: wrap the *entire row* in a single anchor so any
      // click in the banner opens the live URL. The URL span keeps the
      // accent color + underline so it still LOOKS like a link, but the
      // label and any whitespace between them are part of the same
      // clickable surface. data-testid is the contract e2e tests assert
      // on.
      var safeURL = String(data.url).replace(/[<>"']/g, function (c) {
        return { "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
      });
      var urlSpanHTML =
        '<span style="color:#7bb3ff;text-decoration:underline;word-break:break-all;">' +
        safeURL +
        "</span>";
      nextHTML =
        '<a id="cms-live-url-banner-link" data-testid="cms-live-url-banner-link" ' +
        'target="_blank" rel="noopener" href="' + safeURL + '" ' +
        'style="display:flex;align-items:baseline;gap:0.5em;flex-wrap:wrap;color:inherit;text-decoration:none;width:100%;">' +
        labelHTML + urlSpanHTML +
        "</a>";
    }

    if (nextHTML !== lastHTML) {
      banner.innerHTML = nextHTML;
      lastHTML = nextHTML;
    }
  }

  var pending = false;
  function scheduleRender() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(function () {
      pending = false;
      render();
    });
  }

  // Mutations re-render the banner when the form mounts / fields update.
  new MutationObserver(scheduleRender).observe(document.body, {
    childList: true,
    subtree: true,
  });
  // Input / change events catch toggle flips and typed values immediately.
  document.addEventListener("input", scheduleRender, true);
  document.addEventListener("change", scheduleRender, true);
  // Hash changes navigate between entries — refresh the banner.
  window.addEventListener("hashchange", scheduleRender);
  scheduleRender();
})();
