---
title: Introducing GHA-bench
slug: introducing-gha-bench
date: 2026-05-13 08:51:00 -0400
excerpt: GHA-bench is a benchmark and a set of evals for how well different
  coding agents author and test GitHub Actions using different languages.
featured_image: /assets/images/uploads/img_9581.png
published: true
---
[GHA-bench](https://github.com/Adam-S-Daniel/GHA-bench) is a benchmark and a set of evals for how well different coding agents author and test GitHub Actions.

## How it works

Agents (currently a variety of Anthropic models set to various effort levels, driven by Claude Code) are given [set of tasks](https://github.com/Adam-S-Daniel/GHA-bench/blob/main/benchmark-instructions-v4.md#tasks) they must automate using GitHub Actions, either using a particular scripting language or whichever they want.\* They must use Test-Driven Development (TDD)-- basically "write tests first, and don't come back until they all pass".\**

A panel of judges (Google Gemini and Claude Haiku) then [evaluates](https://github.com/Adam-S-Daniel/GHA-bench/blob/main/AGENTS.md#:~:text=Evaluate%20test%20%2B%20deliverable%20quality) the comprehensiveness of the tests and the quality of the code.\***

## Which model, effort level and scripting language should you use?

The table below now includes **Opus 4.8** — at medium, high, and xhigh effort, plus a new "ultra" effort that layers in multi-agent orchestration — alongside Opus 4.7, Sonnet 4.6, Opus 4.6, Sonnet 5, Fable 5, and Haiku 4.5, with the two PowerShell variants pooled into a single `pwsh` column. Every row is graded on a single shared curve pooled across all runs, so the letter grades are comparable across models.

Pick a preset, or adjust the sliders yourself.

<!-- html-embed:start -->
<div class="post-embed">
<div class="bws-widget">
  <div class="bws-presets">
    <span class="bws-presets-label">Presets:</span>
    <button type="button" class="bws-preset" data-preset="balanced">Balanced</button>
    <button type="button" class="bws-preset" data-preset="quality">Max quality</button>
    <button type="button" class="bws-preset" data-preset="qpd">Quality on a budget</button>
    <button type="button" class="bws-preset" data-preset="budget">Cheapest</button>
    <button type="button" class="bws-preset" data-preset="speed">Fastest</button>
  </div>
  <div class="bws-sliders">
    <div class="bws-slider-row">
      <label class="bws-label" for="bws-duration">Duration</label>
      <input class="bws-range" type="range" id="bws-duration" min="0" max="100" step="0.5" value="17.5">
      <span class="bws-pct" id="bws-duration-pct">17.5%</span>
    </div>
    <div class="bws-slider-row">
      <label class="bws-label" for="bws-cost">Cost</label>
      <input class="bws-range" type="range" id="bws-cost" min="0" max="100" step="0.5" value="17.5">
      <span class="bws-pct" id="bws-cost-pct">17.5%</span>
    </div>
    <div class="bws-slider-row">
      <label class="bws-label" for="bws-tests">Tests Quality</label>
      <input class="bws-range" type="range" id="bws-tests" min="0" max="100" step="0.5" value="40">
      <span class="bws-pct" id="bws-tests-pct">40.0%</span>
    </div>
    <div class="bws-slider-row">
      <label class="bws-label" for="bws-workflow">Code Maintainability</label>
      <input class="bws-range" type="range" id="bws-workflow" min="0" max="100" step="0.5" value="25">
      <span class="bws-pct" id="bws-workflow-pct">25.0%</span>
    </div>
  </div>
  <table class="bws-table">
    <thead>
      <tr>
        <th>Model</th>
        <th>Language</th>
        <th>Duration</th>
        <th>Cost</th>
        <th>Tests</th>
        <th>Code</th>
      </tr>
    </thead>
    <tbody id="bws-tbody"></tbody>
  </table>
  <p class="bws-footnote">&dagger; at least one run in this combination hit the 30-minute
  timeout cap; its slowest-run figure (hover/long-press the Duration cell) is a lower
  bound, shown with &ge;.</p>
</div>

<style>
.bws-widget { box-sizing: border-box; max-width: 100%; }
.bws-widget *, .bws-widget *::before, .bws-widget *::after { box-sizing: inherit; }
.bws-widget .bws-sliders { margin-bottom: 1em; }
.bws-widget .bws-presets {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4em;
  align-items: center;
  margin-bottom: 0.9em;
}
.bws-widget .bws-presets-label { font-weight: 600; }
.bws-widget .bws-preset {
  cursor: pointer;
  padding: 0.25em 0.75em;
  border: 1px solid;
  border-radius: 999px;
  background: transparent;
  color: inherit;
  font: inherit;
  line-height: 1.4;
}
.bws-widget .bws-preset:hover { background: rgba(127, 127, 127, 0.15); }
.bws-widget .bws-preset.bws-active { font-weight: 700; background: rgba(127, 127, 127, 0.22); }
.bws-widget .bws-slider-row {
  display: grid;
  grid-template-columns: minmax(8em, 14em) 1fr 4em;
  gap: 0.75em;
  align-items: center;
  margin-bottom: 0.4em;
}
.bws-widget .bws-label { white-space: nowrap; }
.bws-widget .bws-range { width: 100%; min-width: 0; margin: 0; }
.bws-widget .bws-pct {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.bws-widget .bws-table {
  width: 100%;
  border-collapse: collapse;
  margin: 0;
}
.bws-widget .bws-table th,
.bws-widget .bws-table td {
  text-align: left;
  padding: 0.3em 0.6em;
  border-bottom: 1px solid;
  /* white-space: nowrap; */
}
.bws-widget .bws-table th { border-bottom-width: 2px; }
.bws-widget .bws-table td:nth-child(n+3) { font-variant-numeric: tabular-nums; }
.bws-widget .bws-footnote { font-size: 0.85em; opacity: 0.75; margin: 0.5em 0 0; }
@media (max-width: 540px) {
  .bws-widget .bws-slider-row {
    grid-template-columns: 1fr 3.5em;
    grid-template-areas: "label pct" "range range";
    row-gap: 0.1em;
  }
  .bws-widget .bws-label { grid-area: label; }
  .bws-widget .bws-pct   { grid-area: pct; }
  .bws-widget .bws-range { grid-area: range; }
  .bws-widget .bws-table th,
  .bws-widget .bws-table td { padding: 0.25em 0.35em; }
}
</style>

<script>
(function () {
  var TIER_RANK = {
    "A+": 1, "A": 2, "A-": 3,
    "B+": 4, "B": 5, "B-": 6,
    "C+": 7, "C": 8, "C-": 9,
    "D+": 10, "D": 11, "D-": 12,
    "F": 13
  };

  // [language, model, dur_tier, dur_label, cost_tier, cost_label,
  //  tests_tier, tests_label, wf_tier, wf_label, max_dur_label]
  var ROWS = [
    ["default", "opus 4.8 1m med", "B+", "7.4min", "C+", "$1.87", "A-", "4.1", "A-", "4.3", "9.9min"],
    ["bash", "opus 4.8 1m med", "B+", "7.8min", "C+", "$2.06", "B-", "3.3", "B", "3.7", "23.9min"],
    ["pwsh", "opus 4.8 1m med", "B+", "7.9min", "C+", "$2.03", "A-", "4.2", "B+", "4.1", "12.9min"],
    ["ts-bun", "opus 4.8 1m med", "C+", "10.9min", "C", "$2.65", "A-", "4.4", "A-", "4.3", "23.0min"],
    ["default", "opus 4.8 1m hi", "B-", "9.2min", "C", "$2.66", "B-", "3.4", "A-", "4.1", "12.2min"],
    ["bash", "opus 4.8 1m hi", "B-", "10.3min", "C-", "$2.74", "A-", "4.3", "A-", "4.3", "15.0min"],
    ["pwsh", "opus 4.8 1m hi", "C", "12.9min", "C-", "$3.04", "A", "4.5", "B+", "3.9", "17.3min"],
    ["ts-bun", "opus 4.8 1m hi", "C+", "10.9min", "C-", "$3.33", "A-", "4.3", "A-", "4.2", "19.2min"],
    ["default", "opus 4.8 1m xhi", "C-", "15.0min", "D+", "$4.31", "A-", "4.4", "B+", "3.9", "19.1min"],
    ["bash", "opus 4.8 1m xhi", "D", "20.2min", "D-", "$5.67", "B+", "4.1", "B+", "3.9", "23.9min"],
    ["pwsh", "opus 4.8 1m xhi", "D-", "24.6min", "D-", "$6.18", "A-", "4.4", "A-", "4.4", "≥30.0min"],
    ["ts-bun", "opus 4.8 1m xhi", "D", "20.2min", "D-", "$5.69", "A-", "4.4", "A-", "4.1", "25.3min"],
    ["default", "opus 4.8 1m ultra", "D+", "16.6min", "D", "$4.79", "A", "4.6", "A-", "4.2", "22.7min"],
    ["bash", "opus 4.8 1m ultra", "D", "19.5min", "D", "$5.29", "B+", "3.9", "A-", "4.1", "26.1min"],
    ["pwsh", "opus 4.8 1m ultra", "D-", "22.2min", "D-", "$5.98", "A", "4.5", "A-", "4.2", "33.6min"],
    ["ts-bun", "opus 4.8 1m ultra", "D-", "23.5min", "D-", "$6.94", "A", "4.5", "B+", "3.9", "32.3min"],
    ["default", "opus 4.7 1m med", "A+", "4.5min", "B", "$1.10", "B", "3.7", "B", "3.6", "8.2min"],
    ["bash", "opus 4.7 1m med", "A+", "4.7min", "B", "$1.20", "B-", "3.2", "B-", "3.5", "7.1min"],
    ["pwsh", "opus 4.7 1m med", "A-", "6.5min", "B-", "$1.47", "B+", "3.8", "B", "3.7", "22.5min"],
    ["ts-bun", "opus 4.7 1m med", "A-", "6.5min", "B-", "$1.36", "B+", "3.9", "B", "3.7", "15.2min"],
    ["default", "opus 4.7 1m hi", "B+", "7.5min", "C+", "$2.05", "B+", "4.1", "B+", "3.9", "10.3min"],
    ["bash", "opus 4.7 1m hi", "B+", "7.6min", "C+", "$1.93", "B-", "3.4", "B", "3.5", "20.6min"],
    ["pwsh", "opus 4.7 1m hi", "B-", "9.5min", "C", "$2.65", "A-", "4.1", "B+", "4.1", "18.4min"],
    ["ts-bun", "opus 4.7 1m hi", "B", "8.8min", "C", "$2.48", "A-", "4.2", "B+", "3.9", "10.9min"],
    ["default", "opus 4.7 1m xhi", "B", "8.9min", "C-", "$2.70", "A-", "4.2", "B+", "4.0", "13.4min"],
    ["bash", "opus 4.7 1m xhi", "C+", "12.1min", "C-", "$2.88", "B", "3.8", "B+", "3.9", "39.8min"],
    ["pwsh", "opus 4.7 1m xhi", "C+", "11.7min", "C-", "$3.35", "B+", "4.1", "B+", "3.9", "≥28.0min"],
    ["ts-bun", "opus 4.7 1m xhi", "C+", "11.8min", "D+", "$3.43", "A-", "4.3", "B+", "3.9", "20.8min"],
    ["default", "opus 4.7 200k med", "A+", "4.6min", "B", "$1.13", "B+", "3.8", "B", "3.6", "6.1min"],
    ["bash", "opus 4.7 200k med", "A+", "4.5min", "B", "$1.09", "B-", "3.2", "A-", "4.2", "7.5min"],
    ["pwsh", "opus 4.7 200k med", "A", "5.9min", "B-", "$1.49", "B", "3.8", "B", "3.5", "8.5min"],
    ["ts-bun", "opus 4.7 200k med", "A", "5.4min", "B", "$1.31", "B", "3.8", "B-", "3.4", "6.9min"],
    ["default", "opus 46 200k med", "B+", "7.0min", "B-", "$1.44", "B-", "3.4", "B-", "3.4", "9.2min"],
    ["bash", "opus 46 200k med", "B+", "7.5min", "B-", "$1.55", "B-", "3.4", "B-", "3.4", "15.8min"],
    ["pwsh", "opus 46 200k med", "B+", "7.8min", "B-", "$1.49", "C+", "3.1", "B", "3.6", "12.4min"],
    ["ts-bun", "opus 46 200k med", "A-", "6.1min", "B", "$1.23", "B-", "3.3", "B-", "3.5", "10.3min"],
    ["default", "opus 46 200k hi", "A-", "6.2min", "B-", "$1.33", "B", "3.6", "C+", "3.1", "8.3min"],
    ["bash", "opus 46 200k hi", "B+", "7.6min", "B-", "$1.63", "B+", "4.1", "C+", "3.1", "19.3min"],
    ["pwsh", "opus 46 200k hi", "B+", "7.6min", "B-", "$1.54", "B", "3.6", "B", "3.7", "18.5min"],
    ["ts-bun", "opus 46 200k hi", "A-", "6.0min", "B", "$1.25", "B", "3.7", "B", "3.7", "9.0min"],
    ["default", "sonnet 5 1m low", "A", "5.9min", "B", "$1.10", "C+", "3.0", "B", "3.6", "10.7min"],
    ["bash", "sonnet 5 1m low", "B+", "7.1min", "A", "$0.59", "C", "2.9", "B", "3.5", "13.7min"],
    ["pwsh", "sonnet 5 1m low", "B", "8.5min", "B", "$1.20", "C", "2.8", "C", "2.8", "15.4min"],
    ["ts-bun", "sonnet 5 1m low", "B+", "7.8min", "B", "$1.07", "D+", "2.1", "C", "2.7", "12.0min"],
    ["default", "sonnet 5 1m med", "B+", "7.9min", "C+", "$1.98", "C+", "3.1", "B+", "4.0", "11.5min"],
    ["bash", "sonnet 5 1m med", "C+", "11.9min", "C-", "$2.77", "B+", "3.9", "C+", "3.1", "16.9min"],
    ["pwsh", "sonnet 5 1m med", "C", "12.9min", "C", "$2.21", "B", "3.7", "B+", "3.9", "18.8min"],
    ["ts-bun", "sonnet 5 1m med", "C", "12.8min", "C", "$2.64", "C+", "3.1", "B", "3.8", "17.0min"],
    ["default", "sonnet 5 1m hi", "C", "13.1min", "D+", "$3.44", "B", "3.6", "B", "3.6", "18.0min"],
    ["bash", "sonnet 5 1m hi", "D+", "18.2min", "D", "$4.96", "B", "3.8", "B", "3.7", "≥30.0min"],
    ["pwsh", "sonnet 5 1m hi", "D-", "24.9min", "D", "$4.52", "A-", "4.2", "A-", "4.2", "≥30.0min"],
    ["ts-bun", "sonnet 5 1m hi", "D", "21.1min", "D-", "$5.62", "A-", "4.3", "A-", "4.1", "25.3min"],
    ["default", "sonnet 46 1m med", "A-", "6.1min", "B+", "$0.98", "B", "3.5", "B-", "3.2", "9.6min"],
    ["bash", "sonnet 46 1m med", "B", "8.8min", "B", "$1.24", "C+", "3.1", "B-", "3.3", "29.1min"],
    ["pwsh", "sonnet 46 1m med", "B", "8.1min", "B", "$1.13", "B", "3.7", "C+", "3.2", "16.7min"],
    ["ts-bun", "sonnet 46 1m med", "B+", "7.5min", "B", "$1.12", "B", "3.7", "B", "3.5", "12.2min"],
    ["default", "sonnet 46 200k med", "B+", "7.2min", "B", "$1.04", "B", "3.6", "B", "3.5", "11.7min"],
    ["bash", "sonnet 46 200k med", "B", "8.3min", "B", "$1.10", "B", "3.5", "B", "3.8", "15.6min"],
    ["pwsh", "sonnet 46 200k med", "B+", "7.4min", "B+", "$0.93", "B", "3.6", "B-", "3.3", "12.3min"],
    ["ts-bun", "sonnet 46 200k med", "B+", "8.0min", "B+", "$1.02", "B-", "3.4", "C+", "3.1", "11.0min"],
    ["default", "sonnet 46 200k hi", "B-", "9.6min", "B-", "$1.44", "B+", "3.9", "B-", "3.4", "14.9min"],
    ["bash", "sonnet 46 200k hi", "C+", "10.7min", "B-", "$1.56", "B", "3.6", "B", "3.5", "17.4min"],
    ["pwsh", "sonnet 46 200k hi", "B-", "10.5min", "B-", "$1.47", "B", "3.6", "B", "3.5", "15.1min"],
    ["ts-bun", "sonnet 46 200k hi", "B", "8.9min", "B-", "$1.48", "B+", "3.9", "B", "3.8", "10.8min"],
    ["default", "fable 5 1m med", "B", "8.7min", "D+", "$3.94", "B-", "3.2", "B+", "3.9", "12.1min"],
    ["bash", "fable 5 1m med", "B+", "7.9min", "D+", "$3.61", "A-", "4.1", "B+", "4.1", "9.4min"],
    ["pwsh", "fable 5 1m med", "C-", "14.7min", "D", "$4.57", "A", "4.5", "B", "3.6", "19.0min"],
    ["ts-bun", "fable 5 1m med", "C+", "10.6min", "D", "$4.60", "A", "4.4", "A-", "4.1", "14.5min"],
    ["default", "fable 5 1m hi", "C+", "11.3min", "D-", "$5.74", "B-", "3.2", "A", "4.4", "15.1min"],
    ["bash", "fable 5 1m hi", "C+", "11.8min", "D", "$5.47", "A-", "4.3", "B+", "4.1", "13.7min"],
    ["pwsh", "fable 5 1m hi", "D+", "16.9min", "D-", "$5.96", "A-", "4.4", "A-", "4.4", "21.5min"],
    ["ts-bun", "fable 5 1m hi", "C+", "12.2min", "D-", "$5.98", "A-", "4.3", "B+", "3.9", "15.2min"],
    ["default", "haiku 45 200k", "A+", "5.2min", "A+", "$0.40", "D+", "2.2", "C-", "2.5", "59.1min"],
    ["bash", "haiku 45 200k", "B-", "9.8min", "A", "$0.56", "D+", "2.1", "C-", "2.6", "≥322.8min"],
    ["pwsh", "haiku 45 200k", "A-", "6.6min", "A+", "$0.47", "D+", "2.3", "C-", "2.6", "≥29.1min"],
    ["ts-bun", "haiku 45 200k", "A", "5.4min", "A+", "$0.46", "D+", "2.0", "C", "2.7", "8.5min"],
  ];

  var KEYS = ["tests", "workflow", "duration", "cost"];

  function el(id) { return document.getElementById("bws-" + id); }

  function readWeights() {
    var w = {};
    KEYS.forEach(function (k) { w[k] = parseFloat(el(k).value) || 0; });
    return w;
  }

  function parseNum(s) {
    var m = String(s).match(/-?\d+(?:\.\d+)?/);
    return m ? parseFloat(m[0]) : 0;
  }

  function render() {
    var w = readWeights();
    KEYS.forEach(function (k) {
      el(k + "-pct").textContent = w[k].toFixed(1) + "%";
    });
    var scored = ROWS.map(function (r) {
      var score =
        (w.tests    / 100) * TIER_RANK[r[6]] +
        (w.workflow / 100) * TIER_RANK[r[8]] +
        (w.duration / 100) * TIER_RANK[r[2]] +
        (w.cost     / 100) * TIER_RANK[r[4]];
      // Tiebreaker: lower minutes/dollars is better, higher tests/workflow is better.
      var tiebreak =
        (w.duration / 100) * parseNum(r[3]) +
        (w.cost     / 100) * parseNum(r[5]) -
        (w.tests    / 100) * parseNum(r[7]) -
        (w.workflow / 100) * parseNum(r[9]);
      return { row: r, score: score, tiebreak: tiebreak };
    });
    scored.sort(function (a, b) {
      if (a.score !== b.score) return a.score - b.score;
      return a.tiebreak - b.tiebreak;
    });
    var html = "";
    for (var i = 0; i < scored.length; i++) {
      var r = scored[i].row;
      var maxd = r[10] || "";
      var cens = maxd.charAt(0) === "≥";
      html +=
        "<tr>" +
        "<td>" + r[1] + "</td>" +
        "<td>" + r[0] + "</td>" +
        "<td title=\"Slowest run: " + maxd + (cens ? " (hit the timeout cap)" : "") + "\">" +
          r[2] + " (" + r[3] + ")" + (cens ? "<sup>†</sup>" : "") + "</td>" +
        "<td>" + r[4] + " (" + r[5] + ")</td>" +
        "<td>" + r[6] + " (" + r[7] + ")</td>" +
        "<td>" + r[8] + " (" + r[9] + ")</td>" +
        "</tr>";
    }
    document.getElementById("bws-tbody").innerHTML = html;
  }

  var adjusting = false;
  function redistribute(changed) {
    if (adjusting) return;
    adjusting = true;
    var newVal = Math.max(0, Math.min(100, parseFloat(el(changed).value) || 0));
    el(changed).value = newVal;
    var others = KEYS.filter(function (k) { return k !== changed; });
    var sumOthers = 0;
    others.forEach(function (k) { sumOthers += parseFloat(el(k).value) || 0; });
    var needed = 100 - newVal;
    if (sumOthers <= 0) {
      var each = needed / others.length;
      others.forEach(function (k) { el(k).value = each.toFixed(2); });
    } else {
      var scale = needed / sumOthers;
      others.forEach(function (k) {
        var v = (parseFloat(el(k).value) || 0) * scale;
        el(k).value = Math.max(0, v).toFixed(2);
      });
    }
    adjusting = false;
    render();
  }

  function clearActivePreset() {
    var btns = document.querySelectorAll(".bws-preset");
    for (var i = 0; i < btns.length; i++) btns[i].classList.remove("bws-active");
  }

  KEYS.forEach(function (k) {
    el(k).addEventListener("input", function () { clearActivePreset(); redistribute(k); });
  });

  // Preset weightings (each sums to 100). Keys: duration, cost, tests, workflow.
  var PRESETS = {
    balanced: { duration: 25, cost: 25, tests: 25, workflow: 25 },
    quality:  { duration: 10, cost: 10, tests: 45, workflow: 35 },
    qpd:      { duration: 10, cost: 35, tests: 35, workflow: 20 },
    budget:   { duration: 15, cost: 55, tests: 15, workflow: 15 },
    speed:    { duration: 55, cost: 15, tests: 15, workflow: 15 }
  };
  function applyPreset(name) {
    var p = PRESETS[name];
    if (!p) return;
    KEYS.forEach(function (k) { el(k).value = p[k]; });
    var btns = document.querySelectorAll(".bws-preset");
    for (var i = 0; i < btns.length; i++) {
      btns[i].classList.toggle("bws-active", btns[i].getAttribute("data-preset") === name);
    }
    render();
  }
  (function () {
    var btns = document.querySelectorAll(".bws-preset");
    for (var i = 0; i < btns.length; i++) {
      btns[i].addEventListener("click", function () {
        applyPreset(this.getAttribute("data-preset"));
      });
    }
  })();

  render();
})();
</script>
</div>
<!-- html-embed:end -->

*\* When allowed to choose, the earlier models [always](https://github.com/search?q=repo%3AAdam-S-Daniel%2FGHA-bench+path%3A.py+path%3A%2F%5Eresults%5C%2F2026-05-06_173435%5C%2Ftasks%5C%2F%5B%5E%5C%2F%5D%2B%5C%2F%5B%5E%5C%2F%5D%2B-%5B%5E%5C%2F%5D%2B%5C%2F%2F&type=code) chose Python; Opus 4.8 occasionally reaches for JavaScript or PowerShell instead. (The "default" rows reflect whatever each agent chose.)*

*\*\* Agents run their tests locally in [a container](https://github.com/Adam-S-Daniel/GHA-bench/blob/main/Dockerfile.act) that leverages [nektos act](https://github.com/nektos/act) to emulate a GitHub-hosted runner.*

*\*\*\* The Gemini judge now runs via Google's Antigravity (`agy`) CLI, which replaced the retired Gemini CLI in June 2026. Calibration shows `agy` grades ~0.3 points stricter on a 1–5 scale (overall correlation r ≈ 0.90 with the prior harness), so quality grades for the newest (Opus 4.8) rows are, if anything, very slightly conservative relative to the older rows.*
