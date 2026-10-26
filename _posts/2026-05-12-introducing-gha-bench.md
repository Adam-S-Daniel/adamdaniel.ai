---
title: Introducing GHA-bench
slug: introducing-gha-bench
date: 2026-05-13 08:51:00 -0400
excerpt: GHA-bench is a benchmark and a set of evals for how well different
  coding agents author and test GitHub Actions using different languages.
featured_image: /assets/images/uploads/img_9581-vignette.webp
published: true
---
[GHA-bench](https://github.com/Adam-S-Daniel/GHA-bench) is a benchmark and a set of evals for how well different coding agents author and test GitHub Actions.

## How it works

Agents (currently a variety of Anthropic models set to various effort levels, driven by Claude Code) are given [set of tasks](https://github.com/Adam-S-Daniel/GHA-bench/blob/main/benchmark-instructions-v4.md#tasks) they must automate using GitHub Actions, either using a particular scripting language or whichever they want.\* They must use Test-Driven Development (TDD)-- basically "write tests first, and don't come back until they all pass".\**

A panel of judges (Google Gemini and Claude Haiku) then [evaluates](https://github.com/Adam-S-Daniel/GHA-bench/blob/main/AGENTS.md#:~:text=Evaluate%20test%20%2B%20deliverable%20quality) the comprehensiveness of the tests and the quality of the code.

## Which model, effort level and scripting language should you use?

Adjust the sliders according to your priorities.

<!-- html-embed:start -->
<div class="post-embed">
<div class="bws-widget">
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
  <p class="bws-scroll-hint" aria-hidden="true">Swipe the table sideways for more columns &rarr;</p>
  <div class="bws-table-frame">
  <div class="bws-table-scroll" id="bws-scroll" tabindex="0" role="region" aria-label="GHA-bench results; scrolls sideways on narrow screens">
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
  </div>
</div>

<style>
.bws-widget { box-sizing: border-box; max-width: 100%; }
.bws-widget *, .bws-widget *::before, .bws-widget *::after { box-sizing: inherit; }
.bws-widget .bws-sliders { margin-bottom: 1em; }
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
.bws-widget .bws-table-scroll { max-width: 100%; overflow-x: auto; scrollbar-width: thin; }
/* The frame holds what must not scroll or be clipped by the scroller: the edge
   fade (an overlay, not a mask: a mask on the focusable scroller also clips its
   focus ring) and the focus ring itself. */
.bws-widget .bws-table-frame { position: relative; }
.bws-widget .bws-table-frame.bws-fade-right::after {
  content: "";
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: 2.5em;
  pointer-events: none;
  background: linear-gradient(to right, transparent, var(--bg-0, #04060f));
}
@supports selector(:has(*)) {
  .bws-widget .bws-table-scroll:focus-visible { outline: none; }
  .bws-widget .bws-table-frame:has(.bws-table-scroll:focus-visible) {
    outline: 2px solid var(--accent, #285aff);
    outline-offset: 2px;
  }
}
.bws-widget .bws-scroll-hint {
  display: none;
  margin: 0 0 0.4em;
  font-size: 0.8125rem;
  color: var(--text-dim, #8ab0e8);
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
  /* One line per row (a wrapped "opus / 4.7 / 1m / med" made rows 130px tall);
     the table scrolls sideways inside its box instead, with the Model column
     pinned and a hint plus an edge fade saying so. */
  .bws-widget .bws-table { border-collapse: separate; border-spacing: 0; width: auto; min-width: 100%; }
  .bws-widget .bws-table th,
  .bws-widget .bws-table td { white-space: nowrap; font-size: 0.875rem; }
  .bws-widget .bws-table th:first-child,
  .bws-widget .bws-table td:first-child {
    position: sticky;
    left: 0;
    background: var(--bg-0, #04060f);
    box-shadow: 1px 0 var(--border, #1a2a5e);
  }
  .bws-widget .bws-scroll-hint { display: block; }
  .bws-widget.bws-scrolled .bws-scroll-hint,
  .bws-widget.bws-no-overflow .bws-scroll-hint { display: none; }
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
    ["default","opus 4.7 1m med","A+","4.6min","B-","$1.18","B+","3.9","B","3.8"],
    ["default","opus 4.7 200k med","A+","4.2min","B-","$1.18","B","3.8","B","3.8"],
    ["ts-bun","opus 4.7 1m med","A-","5.5min","C+","$1.33","B+","4.0","B","3.8"],
    ["pwsh","opus 4.7 200k med","B+","5.8min","C","$1.53","B+","3.9","B+","3.9"],
    ["pwsh-tool","opus 4.7 1m med","B+","5.9min","C","$1.54","B+","3.9","B+","4.1"],
    ["pwsh-tool","opus 4.7 200k med","B+","5.7min","C","$1.53","B+","4.1","B","3.6"],
    ["bash","opus 4.7 1m med","A+","4.4min","B-","$1.16","B-","3.4","B-","3.4"],
    ["default","sonnet 46 1m med","B+","5.9min","B-","$1.06","B","3.8","B-","3.4"],
    ["ts-bun","opus 46 200k","B","6.2min","C+","$1.30","B","3.7","B","3.7"],
    ["pwsh","sonnet 46 1m med","C","8.4min","B-","$1.19","A-","4.2","C+","3.1"],
    ["ts-bun","opus 4.7 200k med","C+","7.6min","C","$1.56","B+","4.0","B","3.7"],
    ["pwsh","opus 4.7 1m med","B-","7.1min","C","$1.70","B","3.6","B","3.5"],
    ["ts-bun","sonnet 46 1m med","C+","7.7min","C+","$1.30","B","3.8","B","3.7"],
    ["bash","opus 4.7 200k med","A-","5.1min","C+","$1.42","C+","3.1","B","3.7"],
    ["default","opus 4.7 1m hi","C+","8.0min","D+","$2.20","B+","4.0","B","3.6"],
    ["ts-bun","sonnet 46 200k","C-","9.0min","C","$1.50","B+","3.9","B","3.8"],
    ["default","opus 46 200k","B","6.4min","C+","$1.37","B","3.6","C+","3.1"],
    ["pwsh","opus 4.7 1m hi","D+","10.3min","D","$2.80","A-","4.1","B+","4.0"],
    ["default","opus 4.7 1m xhi","D+","10.4min","D-","$3.30","A","4.4","B","3.8"],
    ["ts-bun","opus 4.7 1m hi","C-","8.9min","D","$2.75","A-","4.3","B","3.8"],
    ["pwsh-tool","opus 46 200k","C","8.1min","C","$1.56","B","3.8","B","3.6"],
    ["default","sonnet 46 200k","D+","9.9min","C+","$1.47","B+","3.9","B-","3.4"],
    ["default","haiku 45 200k","A","4.8min","A+","$0.38","C-","2.4","C","2.7"],
    ["bash","opus 46 200k","C","8.3min","C","$1.63","B+","4.1","C+","3.1"],
    ["pwsh","opus 46 200k","C-","8.8min","C","$1.79","B","3.5","B","3.8"],
    ["pwsh","sonnet 46 200k","D","11.2min","C","$1.63","B+","3.9","B-","3.4"],
    ["bash","sonnet 46 200k","D","11.3min","C","$1.62","B","3.6","B","3.5"],
    ["pwsh","opus 4.7 1m xhi","D-","12.5min","D-","$3.72","A-","4.2","B","3.8"],
    ["pwsh-tool","opus 4.7 1m hi","D-","11.8min","D-","$3.55","B+","3.9","B+","3.9"],
    ["ts-bun","opus 4.7 1m xhi","D-","12.3min","D-","$3.57","B+","4.1","B+","3.9"],
    ["pwsh-tool","sonnet 46 200k","D","10.7min","C+","$1.47","B-","3.4","B","3.6"],
    ["bash","opus 4.7 1m xhi","D","10.6min","D","$3.09","B","3.8","B+","4.1"],
    ["pwsh-tool","sonnet 46 1m med","D+","10.1min","C","$1.52","B","3.6","C+","3.1"],
    ["ts-bun","haiku 45 200k","A-","5.5min","A","$0.48","D","1.9","C+","3.1"],
    ["bash","sonnet 46 1m med","C","8.2min","B-","$1.19","C","2.9","B-","3.2"],
    ["pwsh-tool","haiku 45 200k","B-","7.2min","A","$0.48","C-","2.4","C-","2.4"],
    ["bash","opus 4.7 1m hi","D+","10.5min","D+","$2.56","B-","3.4","C+","3.0"],
    ["bash","haiku 45 200k","C+","7.6min","B+","$0.70","D","1.9","C-","2.5"]
  ];

  var KEYS = ["tests", "workflow", "duration", "cost"];
  var phoneModels = window.matchMedia("(max-width: 540px)");

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
      var model = phoneModels.matches ? r[1].replace(" ", "-").replace(/ /g, "·") : r[1];
      html +=
        "<tr>" +
        "<td>" + model + "</td>" +
        "<td>" + r[0] + "</td>" +
        "<td>" + r[2] + " (" + r[3] + ")</td>" +
        "<td>" + r[4] + " (" + r[5] + ")</td>" +
        "<td>" + r[6] + " (" + r[7] + ")</td>" +
        "<td>" + r[8] + " (" + r[9] + ")</td>" +
        "</tr>";
    }
    document.getElementById("bws-tbody").innerHTML = html;
    updateScrollCue();
  }

  // Weights live on the sliders' own step grid. A range input snaps whatever
  // is assigned to it to its step, so scaling the other weights to two
  // decimals let the browser round each one up (Home on every slider left
  // 33.5 + 33.5 + 33.5 + 0 = 100.5%). Work in whole steps and hand out the
  // remainder one step at a time, so the total is always exactly 100.
  var adjusting = false;
  function redistribute(changed) {
    if (adjusting) return;
    adjusting = true;
    var step = parseFloat(el(changed).step) || 1;
    var totalUnits = Math.round(100 / step);
    var units = Math.max(0, Math.min(totalUnits, Math.round((parseFloat(el(changed).value) || 0) / step)));
    var others = KEYS.filter(function (k) { return k !== changed; });
    var needed = totalUnits - units;
    var current = others.map(function (k) { return (parseFloat(el(k).value) || 0) / step; });
    var sumOthers = current.reduce(function (a, b) { return a + b; }, 0);
    var shares = current.map(function (c) {
      return sumOthers > 0 ? (c * needed) / sumOthers : needed / others.length;
    });
    var whole = shares.map(Math.floor);
    var leftover = needed - whole.reduce(function (a, b) { return a + b; }, 0);
    shares
      .map(function (s, i) { return { i: i, frac: s - Math.floor(s) }; })
      .sort(function (a, b) { return b.frac - a.frac || a.i - b.i; })
      .slice(0, leftover)
      .forEach(function (o) { whole[o.i] += 1; });
    el(changed).value = units * step;
    others.forEach(function (k, i) { el(k).value = whole[i] * step; });
    adjusting = false;
    render();
  }

  // Scroll cue: fade the right edge while columns wait off-screen, and drop
  // the "swipe" hint once the reader has found the gesture (or none is needed).
  var scroller = el("scroll");
  var frame = scroller.parentNode;
  var widget = frame.parentNode;
  function updateScrollCue() {
    var room = scroller.scrollWidth - scroller.clientWidth;
    frame.classList.toggle("bws-fade-right", room > 1 && scroller.scrollLeft < room - 1);
    widget.classList.toggle("bws-no-overflow", room <= 1);
    if (scroller.scrollLeft > 8) widget.classList.add("bws-scrolled");
  }
  scroller.addEventListener("scroll", updateScrollCue, { passive: true });
  window.addEventListener("resize", updateScrollCue);
  phoneModels.addEventListener("change", render);

  KEYS.forEach(function (k) {
    el(k).addEventListener("input", function () { redistribute(k); });
  });

  render();
})();
</script>
</div>
<!-- html-embed:end -->

*\* When allowed to choose, the agents [always](https://github.com/search?q=repo%3AAdam-S-Daniel%2FGHA-bench+path%3A.py+path%3A%2F%5Eresults%5C%2F2026-05-06_173435%5C%2Ftasks%5C%2F%5B%5E%5C%2F%5D%2B%5C%2F%5B%5E%5C%2F%5D%2B-%5B%5E%5C%2F%5D%2B%5C%2F%2F&type=code) choose Python.*

*\*\* Agents run their tests locally in [a container](https://github.com/Adam-S-Daniel/GHA-bench/blob/main/Dockerfile.act) that leverages [nektos act](https://github.com/nektos/act) to emulate a GitHub-hosted runner.*
