/*
 * admin/deploy-status-pill.js — surfaces deploy status (preview AND
 * production) in the Decap editor toolbar, peering with Decap's
 * built-in "Preview" link.
 *
 * Why both: Decap's built-in deploy-preview-links feature surfaces a
 * link once a deployment goes `success`, but it doesn't expose the
 * GitHub Actions run URL while the deploy is in flight, and it
 * doesn't show anything for production deploys at all (the github
 * backend doesn't track post-merge production deploys). This script
 * fills both gaps with two pills:
 *
 *   - Preview build status:  in_progress (link to deploy-preview run) /
 *                            failure (link to logs).
 *                            Hidden on success — Decap's built-in
 *                            preview link takes over.
 *   - Production publish status: in_progress (link to deploy-production
 *                            run) / failure (link to logs).
 *                            Hidden on success — the deployed-commit
 *                            pill covers the steady state.
 *
 * Wiring on the workflow side:
 *   - .github/workflows/deploy-preview.yml    → preview-pr-<N>
 *   - .github/workflows/deploy-production.yml → production
 *
 * Both register a GitHub Deployment with state=in_progress at job
 * start and update to success/failure at job end.
 *
 * Placement: injected INTO Decap's editor toolbar (next to the
 * built-in preview link) rather than floating in a viewport corner.
 * Decap re-renders the toolbar on entry switches and form mutations,
 * so the injection runs on a MutationObserver and is idempotent.
 *
 * Auth: uses the operator's Decap token from
 * `localStorage["decap-cms-user"].token`. No CMS_E2E_PAT.
 */
(function () {
  "use strict";

  if (typeof window === "undefined") return;
  if (window.__deployStatusPillInstalled) return;
  window.__deployStatusPillInstalled = true;

  var REPO = "Adam-S-Daniel/adamdaniel.ai";
  var API = "https://api.github.com/repos/" + REPO;
  var POLL_MS = 30 * 1000;
  var PROD_PILL_ID = "cms-prod-status-pill";
  var PREVIEW_PILL_ID = "cms-preview-build-pill";

  // ── Auth + GitHub helpers ────────────────────────────────────────
  function getToken() {
    try {
      var raw = localStorage.getItem("decap-cms-user");
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      return parsed && parsed.token ? parsed.token : null;
    } catch (e) {
      return null;
    }
  }

  function ghHeaders(token) {
    return {
      Authorization: "token " + token,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    };
  }

  async function fetchLatestStatusForEnvironment(token, environment) {
    var deplRes = await fetch(
      API + "/deployments?environment=" + encodeURIComponent(environment) + "&per_page=1",
      { headers: ghHeaders(token) }
    );
    if (!deplRes.ok) return null;
    var deployments = await deplRes.json();
    if (!Array.isArray(deployments) || deployments.length === 0) return null;
    var latest = deployments[0];
    var statRes = await fetch(
      API + "/deployments/" + latest.id + "/statuses?per_page=1",
      { headers: ghHeaders(token) }
    );
    if (!statRes.ok) return null;
    var statuses = await statRes.json();
    if (!Array.isArray(statuses) || statuses.length === 0) return null;
    return { deployment: latest, status: statuses[0] };
  }

  // For preview, environment names are `preview-pr-<N>`. There's no
  // single name to query — list recent deployments and pick the most
  // recent that matches. The list API doesn't accept wildcards, so
  // we paginate by created_at desc and filter in JS.
  async function fetchLatestPreviewStatus(token) {
    var deplRes = await fetch(
      API + "/deployments?per_page=20",
      { headers: ghHeaders(token) }
    );
    if (!deplRes.ok) return null;
    var deployments = await deplRes.json();
    var preview = deployments.filter(function (d) {
      return /^preview-pr-\d+$/.test(d.environment || "");
    })[0];
    if (!preview) return null;
    var statRes = await fetch(
      API + "/deployments/" + preview.id + "/statuses?per_page=1",
      { headers: ghHeaders(token) }
    );
    if (!statRes.ok) return null;
    var statuses = await statRes.json();
    if (!Array.isArray(statuses) || statuses.length === 0) return null;
    return { deployment: preview, status: statuses[0] };
  }

  // ── Pill rendering ───────────────────────────────────────────────
  function renderPill(pill, label, state, logUrl) {
    if (!pill) return;
    if (!state || state === "success") {
      pill.style.display = "none";
      return;
    }
    pill.href = logUrl ||
      "https://github.com/" + REPO + "/actions";

    if (state === "in_progress" || state === "queued" || state === "pending") {
      pill.style.color = "#0969da";
      pill.style.borderColor = "#0969da";
      pill.title = "Click to view the in-flight deploy run";
      pill.innerHTML =
        '<svg width="10" height="10" viewBox="0 0 24 24" style="vertical-align:-1px;margin-right:0.4em" aria-hidden="true">' +
        '<circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" fill="none" stroke-dasharray="40 20" stroke-linecap="round">' +
        '<animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="1.2s" repeatCount="indefinite"/>' +
        "</circle></svg>" +
        "<span>" + label + "…</span>";
      pill.style.display = "";
    } else if (state === "failure" || state === "error") {
      pill.style.color = "#cf222e";
      pill.style.borderColor = "#cf222e";
      pill.title = "Click to view the failed deploy run";
      pill.innerHTML = "<span>⚠ " + label + " failed — view logs</span>";
      pill.style.display = "";
    } else {
      pill.style.display = "none";
    }
  }

  // ── Toolbar insertion ────────────────────────────────────────────
  // Decap's toolbar's emotion-class label has been observed as either
  // `EditorToolbar` or `ToolbarContainer`; both contain "oolbar" in
  // their className. Mirror native-preview-href.js's selector.
  function findToolbar() {
    return document.querySelector('[class*="oolbar"]');
  }

  function buildPill(id) {
    var a = document.createElement("a");
    a.id = id;
    a.target = "_blank";
    a.rel = "noopener";
    // Inline-block so it sits in the toolbar's natural row, between
    // the built-in Preview link and the Save/Publish menu.
    a.style.cssText = [
      "display:none",
      "margin-left:0.5rem",
      "padding:0.2rem 0.55rem",
      "background:rgba(255,255,255,0.95)",
      "border:1px solid #d0d7de",
      "border-radius:3px",
      "color:#57606a",
      "font-family:ui-monospace,SFMono-Regular,Menlo,monospace",
      "font-size:0.7rem",
      "letter-spacing:0.03em",
      "text-decoration:none",
      "vertical-align:middle",
      "cursor:pointer",
      "transition:border-color 0.15s,color 0.15s",
    ].join(";") + ";";
    return a;
  }

  function ensurePillInToolbar(id) {
    var existing = document.getElementById(id);
    if (existing && existing.parentNode) return existing;
    var toolbar = findToolbar();
    if (!toolbar) return null;
    var pill = existing || buildPill(id);
    toolbar.appendChild(pill);
    return pill;
  }

  // ── Polling loop ─────────────────────────────────────────────────
  var lastSeenStatusIds = { prod: null, preview: null };

  async function tick() {
    var token = getToken();
    if (!token) return;

    var prodPill = ensurePillInToolbar(PROD_PILL_ID);
    var previewPill = ensurePillInToolbar(PREVIEW_PILL_ID);
    if (!prodPill && !previewPill) return; // no toolbar yet (collection list view)

    if (prodPill) {
      try {
        var p = await fetchLatestStatusForEnvironment(token, "production");
        if (p && p.status.id !== lastSeenStatusIds.prod) {
          lastSeenStatusIds.prod = p.status.id;
          renderPill(prodPill, "Publishing", p.status.state, p.status.log_url);
        } else if (!p) {
          renderPill(prodPill, "Publishing", null, null); // hide
        }
      } catch (e) { /* ignore */ }
    }

    if (previewPill) {
      try {
        var pr = await fetchLatestPreviewStatus(token);
        if (pr && pr.status.id !== lastSeenStatusIds.preview) {
          lastSeenStatusIds.preview = pr.status.id;
          renderPill(previewPill, "Preview build", pr.status.state, pr.status.log_url);
        } else if (!pr) {
          renderPill(previewPill, "Preview build", null, null); // hide
        }
      } catch (e) { /* ignore */ }
    }
  }

  // Decap re-renders the toolbar on entry switches and form mutations.
  // Re-attach the pills when the DOM changes; the polling tick takes
  // care of the actual content refresh.
  var observer;
  function watchToolbar() {
    if (observer) return;
    observer = new MutationObserver(function () {
      ensurePillInToolbar(PROD_PILL_ID);
      ensurePillInToolbar(PREVIEW_PILL_ID);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function start() {
    watchToolbar();
    tick();
    setInterval(tick, POLL_MS);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
