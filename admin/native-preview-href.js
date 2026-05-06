/*
 * admin/native-preview-href.js — rewrites Decap CMS's native "View Live"
 * toolbar anchor href on every form mutation so it points at the same URL
 * the in-editor banner uses (`live-url-derive.js`'s `compute()`).
 *
 * Why this exists: Decap's per-collection `preview_path:` runs through a
 * TWO-PASS expansion. For Posts, `slug:` is `"{{year}}-{{month}}-{{day}}-{{slug}}"`
 * (Jekyll's `_posts/` folder requires the date-prefixed filename); that runs
 * first and produces the FILE slug. Then `preview_path: "/blog/{{slug}}/"`
 * substitutes `{{slug}}` with the FILE slug, NOT the entry's URL slug. That
 * diverges from `permalink: /blog/:slug/` in `_config.yml` which strips the
 * `_posts/` date prefix → the toolbar 404s on every Post.
 *
 * The `slug:` template can't be fixed without breaking Jekyll. The
 * `preview_path` template can't be fixed either: a naive `{{fields.slug}}`
 * swap expands to empty when the explicit slug field is blank (which it is
 * for many seed entries) → `/blog//`. The only path that matches the live
 * site is JS that mirrors the same `explicit slug → slugified title` chain
 * the banner already does — which is exactly what `window.LiveURL.compute()`
 * encapsulates.
 *
 * So: this script finds Decap's native toolbar anchor (the one Decap renders
 * at the top of the entry editor with `target="_blank"` to open the
 * `preview_path`-resolved URL) and rewrites its `href` whenever the form
 * mutates or the hash changes. The static `preview_path` value is now
 * decorative — kept as a hint for any internal Decap logic that touches it,
 * but no longer the source of truth.
 *
 * Selector strategy:
 *   - Decap's component class names are emotion-generated and churn between
 *     versions. The toolbar's emotion `label:` has been observed as both
 *     `EditorToolbar` and `ToolbarContainer` across recent releases; we
 *     match both via a `[class*="oolbar"]` substring (covers either, and
 *     emotion never strips that substring from a labelled component).
 *   - Inside that, the PreviewLink is an `<a>` with `target="_blank"` and
 *     `rel*="noopener"`.
 *   - Exclude the floating
 *     "Live Preview" button (`#live-preview-link`), and the deployed-commit
 *     pill (`#cms-commit-pill`) — those are also `target="_blank"` anchors
 *     in the same document and would otherwise match.
 */
(function () {
  "use strict";

  // Excluded anchor IDs — these are surfaces this site renders itself, not
  // Decap's native toolbar. Rewriting their href would clobber what those
  // affordances are pointing at.
  var EXCLUDE_IDS = [
    "live-preview-link",
    "cms-commit-pill",
    // The deploy-status pills inject INTO the toolbar with their own
    // target="_blank" links pointing at GitHub Actions runs. Without
    // this exclusion the override would rewrite their hrefs to
    // compute()'s live URL on every form mutation, defeating them.
    "cms-prod-status-pill",
    "cms-preview-build-pill",
  ];

  function findToolbarAnchors() {
    // Match either EditorToolbar (older Decap) or ToolbarContainer (newer).
    // Both contain "oolbar" in their emotion label, which gets baked into
    // the className.
    var toolbars = document.querySelectorAll('[class*="oolbar"]');
    var anchors = [];
    var seen = Object.create(null);
    for (var i = 0; i < toolbars.length; i++) {
      var as = toolbars[i].querySelectorAll(
        'a[target="_blank"][rel*="noopener"][href]'
      );
      for (var j = 0; j < as.length; j++) {
        var a = as[j];
        if (EXCLUDE_IDS.indexOf(a.id) !== -1) continue;
        // De-dup: an anchor inside nested toolbars matches both.
        var key = a.outerHTML;
        if (seen[key]) continue;
        seen[key] = true;
        anchors.push(a);
      }
    }
    return anchors;
  }

  function rewrite() {
    if (!window.LiveURL || typeof window.LiveURL.compute !== "function") {
      return; // derive script not loaded yet
    }
    var data = window.LiveURL.compute();
    if (!data || !data.url) return; // no destination computed; leave Decap's
                                    // placeholder alone.
    var anchors = findToolbarAnchors();
    for (var i = 0; i < anchors.length; i++) {
      var a = anchors[i];
      // Only rewrite if the href actually differs — avoids a write storm
      // on every observed mutation.
      if (a.getAttribute("href") !== data.url) {
        a.setAttribute("href", data.url);
      }
      if (a.getAttribute("target") !== "_blank") {
        a.setAttribute("target", "_blank");
      }
      var rel = a.getAttribute("rel") || "";
      if (rel.indexOf("noopener") === -1) {
        a.setAttribute("rel", (rel ? rel + " " : "") + "noopener");
      }
    }
  }

  var pending = false;
  function scheduleRewrite() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(function () {
      pending = false;
      rewrite();
    });
  }

  // Mutations re-rewrite when Decap (re)renders the toolbar — including the
  // initial mount, hash navigations between entries, and field updates that
  // change the computed URL.
  new MutationObserver(scheduleRewrite).observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["href"],
  });
  // Input / change events catch toggle flips and typed values immediately.
  document.addEventListener("input", scheduleRewrite, true);
  document.addEventListener("change", scheduleRewrite, true);
  // Hash changes navigate between entries — re-rewrite for the new context.
  window.addEventListener("hashchange", scheduleRewrite);
  scheduleRewrite();
})();
