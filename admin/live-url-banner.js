/*
 * admin/live-url-banner.js — renders a "View page on site:" banner at
 * the top of every entry-edit page in the Decap admin.
 *
 * Reads the form state (title, slug or permalink, Published toggle)
 * directly from the DOM, computes the entry's live URL, and inserts
 * a banner above the Title field. If the entry isn't published (or
 * has no slug yet for a new entry) the banner shows placeholder
 * text instead of a link.
 *
 * Stateful sources:
 *   - `<input id="title-field-N">` — title text
 *   - `<input id="slug-field-N">` — explicit URL slug (optional)
 *   - `<input id="name-field-N">` — for tags (label is the slug source)
 *   - `<input id="permalink-field-N">` — for pages
 *   - `<button role="switch">` inside the Published field's
 *     ControlContainer — aria-checked = "true" / "false"
 *
 * URL templates mirror Jekyll's _config.yml permalinks:
 *   posts    -> /blog/<slug>/
 *   tags     -> /tags/<slug>/
 *   projects -> /projects/<slug>/
 *   pages    -> the permalink field's value (verbatim)
 *
 * Robust against Decap class churn: the only emotion-class anchors
 * are `ControlPaneContainer` (insertion point) and `ControlContainer`
 * (Published toggle's wrapper) — both stable component names.
 */
(function () {
  "use strict";

  var BANNER_ID = "cms-live-url";

  function getCollection() {
    var m = /#\/collections\/([^\/]+)/.exec(window.location.hash || "");
    return m ? m[1] : null;
  }

  function readField(name) {
    var el = document.querySelector(
      'input[id^="' + name + '-field"], textarea[id^="' + name + '-field"]'
    );
    return el ? el.value : null;
  }

  function slugify(s) {
    return String(s || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  // null = no Published toggle in this schema → treat as always live.
  // true / false = current toggle state.
  function readPublished() {
    var matches = [];
    var nodes = document.querySelectorAll("*");
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var direct = "";
      for (var j = 0; j < el.childNodes.length; j++) {
        var n = el.childNodes[j];
        if (n.nodeType === 3) direct += n.textContent;
      }
      if (/^\s*Published\s*$/i.test(direct)) matches.push(el);
    }
    for (var k = 0; k < matches.length; k++) {
      var cur = matches[k];
      for (var d = 0; d < 6 && cur; d++) {
        if (
          typeof cur.className === "string" &&
          cur.className.indexOf("ControlContainer") !== -1
        ) {
          var toggle = cur.querySelector('button[role="switch"]');
          if (toggle) return toggle.getAttribute("aria-checked") === "true";
        }
        cur = cur.parentElement;
      }
    }
    return null;
  }

  function compute() {
    var collection = getCollection();
    if (!collection) return null;
    var origin = window.location.origin;

    if (collection === "pages") {
      var permalink = readField("permalink");
      return {
        collection: collection,
        published: readPublished(),
        url: permalink ? origin + permalink : null,
      };
    }

    var explicitSlug = (readField("slug") || "").trim();
    var fallback = readField("title") || readField("name") || "";
    var slug = explicitSlug || slugify(fallback);

    var path = {
      posts: "/blog/",
      tags: "/tags/",
      projects: "/projects/",
    }[collection];

    return {
      collection: collection,
      published: readPublished(),
      url: path && slug ? origin + path + slug + "/" : null,
    };
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
