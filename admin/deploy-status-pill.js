/*
 * admin/deploy-status-pill.js — surfaces the production deploy status
 * in the editor toolbar's top-right.
 *
 * Why: Decap CMS doesn't track post-merge production deploys for the
 * github backend. After "Publish Now" succeeds, the entry leaves the
 * Workflow tab and the merged PR is gone — but the actual S3 sync +
 * CloudFront invalidation in `.github/workflows/deploy-production.yml`
 * runs invisibly for ~5–10 minutes. Editors have no way to tell whether
 * "the post is live yet" without manually opening the live site.
 *
 * Wiring:
 *   1. deploy-production.yml registers a GitHub Deployment with
 *      `environment: production` at job start (state=in_progress) and
 *      updates state=success or state=failure at job end (see the
 *      "Register GitHub Deployment (in_progress)" + "Update GitHub
 *      Deployment status (success/failure)" steps in that workflow).
 *   2. This script polls /repos/.../deployments?environment=production
 *      every 30 seconds, gets the most recent deployment's latest
 *      status, and renders a pill above the existing commit pill.
 *
 * UI states:
 *   - in_progress / queued → blue "Publishing… (run #NNN)" with spinner.
 *     Refreshes the existing commit pill once the deploy completes.
 *   - success → hidden (the existing commit pill already shows the
 *     deployed SHA, so two pills would be redundant). The poll stops
 *     after a short cooldown.
 *   - failure  → red "Deploy failed — view logs" linking to the run.
 *     Stays until the next deploy starts or the editor reloads.
 *
 * Auth: uses the operator's Decap token from
 * `localStorage["decap-cms-user"].token`. No CMS_E2E_PAT here — the
 * polling runs with whatever scope the operator's OAuth grant carries
 * (`repo` is sufficient to read deployments on the host repo).
 *
 * No-ops if the token is missing (operator not signed in yet) or if
 * the deployments endpoint returns 404 (deploy-production hasn't
 * registered any deployments yet, e.g. before this feature shipped).
 */
(function () {
  "use strict";

  if (typeof window === "undefined") return;
  if (window.__deployStatusPillInstalled) return;
  window.__deployStatusPillInstalled = true;

  var REPO = "Adam-S-Daniel/adamdaniel.ai";
  var API = "https://api.github.com/repos/" + REPO;
  var POLL_MS = 30 * 1000;
  var PILL_ID = "cms-deploy-status-pill";

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

  // The latest production deployment + its latest status.
  async function fetchLatestProductionStatus(token) {
    var deplRes = await fetch(
      API + "/deployments?environment=production&per_page=1",
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
    return {
      deployment: latest,
      status: statuses[0],
    };
  }

  function ensurePill() {
    var existing = document.getElementById(PILL_ID);
    if (existing) return existing;
    var a = document.createElement("a");
    a.id = PILL_ID;
    a.target = "_blank";
    a.rel = "noopener";
    // Stack ABOVE the #cms-commit-pill in the bottom-right corner
    // (commit pill sits at bottom:0.25rem; this one at bottom:1.85rem).
    // Both pills are corner-tucked — informational, not action-
    // grabbing. The deploy-status pill is opaque when visible because
    // it usually means a deploy is in flight or broken — the editor
    // needs to see it.
    a.style.cssText = [
      "position:fixed",
      "bottom:1.85rem",
      "right:0.25rem",
      "z-index:10001",
      "padding:0.15rem 0.45rem",
      "background:rgba(255,255,255,0.95)",
      "border:1px solid #d0d7de",
      "border-radius:3px",
      "color:#57606a",
      "font-family:ui-monospace,SFMono-Regular,Menlo,monospace",
      "font-size:0.65rem",
      "letter-spacing:0.04em",
      "text-decoration:none",
      "box-shadow:0 1px 3px rgba(0,0,0,0.08)",
      "display:none",
    ].join(";") + ";";
    document.body.appendChild(a);
    return a;
  }

  function renderPill(status) {
    var pill = ensurePill();
    if (!status) {
      pill.style.display = "none";
      return;
    }
    var state = status.status.state; // "in_progress" | "queued" | "pending" | "success" | "failure" | "error"
    var logUrl = status.status.log_url ||
      "https://github.com/" + REPO + "/actions";
    pill.href = logUrl;

    if (state === "in_progress" || state === "queued" || state === "pending") {
      pill.style.borderColor = "#0969da";
      pill.style.color = "#0969da";
      pill.title = "Click to view the in-progress deploy run";
      // Inline SVG spinner so we don't rely on Decap's CSS framework.
      pill.innerHTML =
        '<svg width="10" height="10" viewBox="0 0 24 24" style="vertical-align:-1px;margin-right:0.4em" aria-hidden="true">' +
        '<circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" fill="none" stroke-dasharray="40 20" stroke-linecap="round">' +
        '<animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="1.2s" repeatCount="indefinite"/>' +
        "</circle></svg>" +
        "<span>Publishing…</span>";
      pill.style.display = "";
    } else if (state === "failure" || state === "error") {
      pill.style.borderColor = "#cf222e";
      pill.style.color = "#cf222e";
      pill.title = "Click to view the failed deploy run";
      pill.innerHTML = '<span>⚠ Deploy failed — view logs</span>';
      pill.style.display = "";
    } else {
      // success → hide. Existing #cms-commit-pill already renders the
      // deployed SHA + date; the deploy-status pill is purely the
      // "something is happening or just broke" indicator.
      pill.style.display = "none";
    }
  }

  var lastSeenStatusId = null;

  async function tick() {
    var token = getToken();
    if (!token) return;
    var s = await fetchLatestProductionStatus(token).catch(function () { return null; });
    if (!s) return;
    var statusId = s.status.id;
    if (statusId === lastSeenStatusId) return;
    lastSeenStatusId = statusId;
    renderPill(s);
    // If we just transitioned to success, refresh the existing commit
    // pill so it picks up the new SHA without requiring an editor reload.
    if (s.status.state === "success") {
      var commitPill = document.getElementById("cms-commit-pill");
      if (commitPill && typeof window.__refreshCommitPill === "function") {
        try { window.__refreshCommitPill(); } catch (e) { /* ignore */ }
      }
    }
  }

  function start() {
    tick();
    setInterval(tick, POLL_MS);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
