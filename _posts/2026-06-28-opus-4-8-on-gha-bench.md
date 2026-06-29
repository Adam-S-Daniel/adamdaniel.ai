---
title: "Opus 4.8 on GHA-bench: the new quality leader, at a price"
slug: opus-4-8-on-gha-bench
date: 2026-06-28 12:00:00 -0400
excerpt: Anthropic's Opus 4.8 is now the strongest model on GHA-bench at writing
  and testing GitHub Actions — and also the slowest and most expensive. Here's the
  shape of the tradeoff.
featured_image: /assets/images/uploads/img_9581.png
published: false
---
[GHA-bench](https://github.com/Adam-S-Daniel/GHA-bench) — my benchmark for how well coding agents author and test GitHub Actions — now includes Anthropic's **Opus 4.8**. The short version: it's the best model I've measured at this task, and also the slowest and priciest. Here's the shape of the tradeoff.

The run is a full sweep: 7 tasks × 5 scripting languages × 4 effort levels = 140 agent runs, each graded by a panel of judges (Google Gemini and Claude Haiku) on test comprehensiveness and code quality.

## Opus 4.8 tops the quality charts

Across the board, Opus 4.8 produces the strongest **tests** and the strongest **deliverable code** of any model in the benchmark. At high, xhigh, and the new "ultra" effort it earns A‑/A grades for test quality in nearly every language — for example A (4.6) on the default language at ultra effort, and A (4.5) for PowerShell at high. The two judges, despite coming from different labs, agree on the ranking (Spearman +0.83 on test quality, +0.90 on code quality), so this isn't one judge's quirk.

## …but you pay for it

The flip side is time and money. Relative to Opus 4.7, the premium is steepest at **medium** effort — roughly **+65% on both wall-clock time and cost** — and, interestingly, *compresses to about +15% at high effort* (4.7's "high" is comparatively expensive, so 4.8 closes the gap). At the top two efforts (xhigh and "ultra"), individual runs routinely take **15–25 minutes and cost $4.50–$7.35**, landing in the D / D‑ bands on the speed and cost curves.

If you want most of Opus 4.8's quality without the worst of the bill, **medium effort is the value sweet spot**: B+/B‑ on speed, C+/C on cost, and still A‑/B+ on test quality in several languages.

## The new "ultra" effort

This run introduces a fourth effort level — **"ultra"** — which layers multi-agent orchestration on top of the highest reasoning setting. It tops the test-quality charts (it's the single best column for tests) but is the most expensive option on the board, and it's Opus‑4.8‑only, so there's no older-model baseline to compare it against yet. Treat it as "spend more for the most thorough tests," not as a free win.

## It iterates a lot — but it isn't getting stuck

Opus 4.8 writes **more and denser tests** than its predecessor, and it shows: it also trips GHA-bench's "trap" detectors (heuristics that flag things like re-running the same test command many times) about **twice as often** as Opus 4.7. That sounds alarming, so I hand-reviewed **all 201** of those occurrences. The result:

- **99% show no looping at all.**
- **86%** are legitimate engineering — red-green TDD cycles, designing fixtures up front, fixing a real type error — that merely tripped a count-based heuristic.
- **~1%** looked like genuine distress.

So read "~2× the traps" as **"iterates ~2× more granularly," not "fails ~2× as often."** A good chunk of the gap is also a measurement artifact (the way 4.8 prefixes its shell commands defeats the detector's de-duplication) plus a Claude Code version difference between the two runs, not the model spinning its wheels. The [full investigation](https://github.com/Adam-S-Daniel/GHA-bench/blob/main/results/analysis/opus48-trap-investigation_2026-06-28.md) has the details.

## Which should you use? Try it yourself

Pick a preset, or drag the sliders to weight speed, cost, test quality, and code quality for *your* situation — the table re-ranks every model / effort / language combination live. (Same widget as in [the original GHA-bench post](/introducing-gha-bench), now with Opus 4.8 and the new "ultra" effort.)

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
  //  tests_tier, tests_label, wf_tier, wf_label]
  var ROWS = [
    ["default", "opus 4.8 1m med", "B+", "7.5min", "C+", "$1.89", "B+", "4.0", "B", "3.5"],
    ["bash", "opus 4.8 1m med", "B-", "9.2min", "C", "$2.38", "B-", "3.2", "A-", "4.2"],
    ["pwsh", "opus 4.8 1m med", "B+", "7.4min", "C+", "$1.81", "A-", "4.2", "B+", "4.0"],
    ["pwsh-tool", "opus 4.8 1m med", "B-", "10.1min", "C", "$2.57", "A-", "4.2", "A-", "4.2"],
    ["ts-bun", "opus 4.8 1m med", "C+", "11.7min", "C", "$2.73", "A-", "4.3", "A", "4.7"],
    ["default", "opus 4.8 1m hi", "B-", "9.4min", "C", "$2.74", "B-", "3.4", "A-", "4.1"],
    ["bash", "opus 4.8 1m hi", "B-", "10.5min", "C", "$2.80", "A-", "4.3", "A-", "4.3"],
    ["pwsh", "opus 4.8 1m hi", "C", "13.8min", "C-", "$3.24", "A", "4.5", "B", "3.8"],
    ["pwsh-tool", "opus 4.8 1m hi", "C", "12.4min", "C-", "$2.89", "A", "4.4", "B+", "4.1"],
    ["ts-bun", "opus 4.8 1m hi", "C+", "12.2min", "D+", "$3.68", "A-", "4.3", "A-", "4.2"],
    ["default", "opus 4.8 1m xhi", "C-", "15.3min", "D+", "$4.48", "A-", "4.4", "B+", "3.9"],
    ["bash", "opus 4.8 1m xhi", "D", "20.3min", "D", "$5.74", "B+", "4.1", "B+", "3.9"],
    ["pwsh", "opus 4.8 1m xhi", "D-", "21.9min", "D-", "$6.08", "A-", "4.3", "A", "4.4"],
    ["pwsh-tool", "opus 4.8 1m xhi", "D-", "24.6min", "D-", "$6.51", "A", "4.5", "A-", "4.3"],
    ["ts-bun", "opus 4.8 1m xhi", "D", "20.4min", "D", "$5.76", "A-", "4.4", "A-", "4.1"],
    ["default", "opus 4.8 1m ultra", "D+", "17.0min", "D", "$4.90", "A", "4.6", "A-", "4.2"],
    ["bash", "opus 4.8 1m ultra", "D", "19.9min", "D", "$5.39", "B+", "3.9", "A-", "4.1"],
    ["pwsh", "opus 4.8 1m ultra", "D-", "23.2min", "D-", "$6.87", "A", "4.4", "B+", "4.1"],
    ["pwsh-tool", "opus 4.8 1m ultra", "D-", "24.9min", "D-", "$6.39", "A", "4.5", "A-", "4.3"],
    ["ts-bun", "opus 4.8 1m ultra", "D-", "24.0min", "D-", "$7.35", "A", "4.5", "B+", "3.9"],
    ["default", "opus 4.7 1m med", "A+", "5.0min", "B", "$1.11", "B+", "3.9", "B", "3.8"],
    ["bash", "opus 4.7 1m med", "A+", "4.7min", "B", "$1.13", "B-", "3.4", "B-", "3.4"],
    ["pwsh", "opus 4.7 1m med", "B", "8.6min", "B-", "$1.61", "B", "3.6", "B", "3.5"],
    ["pwsh-tool", "opus 4.7 1m med", "B+", "6.9min", "B-", "$1.48", "B+", "3.9", "B+", "4.1"],
    ["ts-bun", "opus 4.7 1m med", "A-", "6.5min", "B", "$1.31", "B+", "4.0", "B", "3.8"],
    ["default", "opus 4.7 1m hi", "B+", "7.6min", "C+", "$2.08", "B+", "4.0", "B", "3.6"],
    ["bash", "opus 4.7 1m hi", "B", "8.7min", "C+", "$2.10", "B-", "3.4", "C+", "3.0"],
    ["pwsh", "opus 4.7 1m hi", "B-", "9.4min", "C", "$2.58", "A-", "4.1", "B+", "4.0"],
    ["pwsh-tool", "opus 4.7 1m hi", "B-", "10.6min", "C-", "$3.03", "B+", "3.9", "B+", "3.9"],
    ["ts-bun", "opus 4.7 1m hi", "B", "9.0min", "C", "$2.56", "A-", "4.3", "B", "3.8"],
    ["default", "opus 4.7 1m xhi", "B", "9.1min", "C", "$2.79", "A", "4.4", "B", "3.8"],
    ["bash", "opus 4.7 1m xhi", "C", "13.6min", "C-", "$2.98", "B", "3.8", "B+", "4.1"],
    ["pwsh", "opus 4.7 1m xhi", "C+", "12.0min", "C-", "$3.47", "A-", "4.2", "B", "3.8"],
    ["pwsh-tool", "opus 4.7 1m xhi", "C+", "11.4min", "C-", "$3.49", "B+", "4.0", "B", "3.7"],
    ["ts-bun", "opus 4.7 1m xhi", "C+", "12.2min", "C-", "$3.55", "B+", "4.1", "B+", "3.9"],
    ["default", "opus 4.7 200k med", "A+", "4.5min", "B", "$1.17", "B", "3.8", "B", "3.8"],
    ["bash", "opus 4.7 200k med", "A+", "4.9min", "B", "$1.26", "C+", "3.1", "B", "3.7"],
    ["pwsh", "opus 4.7 200k med", "A-", "6.1min", "B-", "$1.55", "B+", "3.9", "B+", "3.9"],
    ["pwsh-tool", "opus 4.7 200k med", "A", "5.7min", "B-", "$1.50", "B+", "4.1", "B", "3.6"],
    ["ts-bun", "opus 4.7 200k med", "A-", "6.6min", "B-", "$1.45", "B+", "4.0", "B", "3.7"],
    ["default", "sonnet 46 1m med", "A-", "6.4min", "B+", "$1.01", "B", "3.8", "B-", "3.4"],
    ["bash", "sonnet 46 1m med", "B-", "10.1min", "B", "$1.36", "C", "2.9", "B-", "3.2"],
    ["pwsh", "sonnet 46 1m med", "B", "8.2min", "B", "$1.12", "A-", "4.2", "C+", "3.1"],
    ["pwsh-tool", "sonnet 46 1m med", "B-", "9.2min", "B", "$1.32", "B", "3.6", "C+", "3.1"],
    ["ts-bun", "sonnet 46 1m med", "B+", "7.9min", "B", "$1.18", "B", "3.8", "B", "3.7"],
    ["default", "sonnet 46 200k", "B", "8.3min", "B", "$1.22", "B", "3.6", "B+", "4.0"],
    ["bash", "sonnet 46 200k", "B-", "9.8min", "B", "$1.35", "B", "3.8", "A-", "4.1"],
    ["pwsh", "sonnet 46 200k", "B-", "9.2min", "B", "$1.22", "B", "3.7", "B-", "3.3"],
    ["pwsh-tool", "sonnet 46 200k", "B-", "9.4min", "B", "$1.26", "B-", "3.4", "B", "3.6"],
    ["ts-bun", "sonnet 46 200k", "B", "8.5min", "B", "$1.21", "B", "3.6", "B-", "3.2"],
    ["default", "opus 46 200k", "A-", "6.7min", "B-", "$1.42", "B-", "3.4", "B", "3.5"],
    ["bash", "opus 46 200k", "B", "8.3min", "B-", "$1.63", "B-", "3.4", "C+", "3.2"],
    ["pwsh", "opus 46 200k", "B", "8.5min", "B-", "$1.68", "C+", "3.1", "B", "3.6"],
    ["pwsh-tool", "opus 46 200k", "B", "8.1min", "B-", "$1.56", "B", "3.8", "B", "3.6"],
    ["ts-bun", "opus 46 200k", "A-", "6.4min", "B", "$1.30", "B-", "3.2", "B-", "3.5"],
    ["default", "haiku 45 200k", "B", "8.3min", "A+", "$0.42", "C-", "2.5", "C+", "3.0"],
    ["bash", "haiku 45 200k", "B+", "7.9min", "A", "$0.60", "D+", "2.0", "C-", "2.6"],
    ["pwsh", "haiku 45 200k", "A-", "6.4min", "A+", "$0.50", "D+", "2.1", "C+", "2.9"],
    ["pwsh-tool", "haiku 45 200k", "B+", "7.2min", "A+", "$0.48", "C-", "2.5", "C-", "2.5"],
    ["ts-bun", "haiku 45 200k", "A", "5.7min", "A+", "$0.48", "D", "1.9", "B-", "3.2"],
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
      html +=
        "<tr>" +
        "<td>" + r[1] + "</td>" +
        "<td>" + r[0] + "</td>" +
        "<td>" + r[2] + " (" + r[3] + ")</td>" +
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

The complete data lives in the [cross-run report](https://github.com/Adam-S-Daniel/GHA-bench/tree/main/results) on GitHub.

*\* The Gemini judge now runs via Google's Antigravity (`agy`) CLI, which replaced the retired Gemini CLI in June 2026. It grades about 0.3 points stricter on a 1–5 scale than the prior harness (overall correlation r ≈ 0.90), so Opus 4.8's quality grades are, if anything, very slightly conservative relative to the older models'.*

*\*\* The two runs being compared used different Claude Code versions (2.1.131/132 for Opus 4.7, 2.1.195 for Opus 4.8). A clean, model-only comparison would re-run both on the same version; that's on the to-do list.*
