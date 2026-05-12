---
title: Test html widget post
date: 2026-05-10 22:19:00 -0400
published: true
---
Check this out:

<!-- html-embed:start -->
<div class="post-embed">
<div class="bws-widget">
  <div class="bws-sliders">
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
  </div>
  <table class="bws-table">
    <thead>
      <tr>
        <th>Model</th>
        <th>Language</th>
        <th>Duration</th>
        <th>Cost</th>
        <th>Tests Quality</th>
        <th>Code Maintainability</th>
      </tr>
    </thead>
    <tbody id="bws-tbody"></tbody>
  </table>
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
    ["default","opus47 1m medium","A+","4.6min","B-","$1.18","B+","3.9","B","3.8"],
    ["default","opus47 200k medium","A+","4.2min","B-","$1.18","B","3.8","B","3.8"],
    ["typescript-bun","opus47 1m medium","A-","5.5min","C+","$1.33","B+","4.0","B","3.8"],
    ["pwsh","opus47 200k medium","B+","5.8min","C","$1.53","B+","3.9","B+","3.9"],
    ["pwsh-tool","opus47 1m medium","B+","5.9min","C","$1.54","B+","3.9","B+","4.1"],
    ["pwsh-tool","opus47 200k medium","B+","5.7min","C","$1.53","B+","4.1","B","3.6"],
    ["bash","opus47 1m medium","A+","4.4min","B-","$1.16","B-","3.4","B-","3.4"],
    ["default","sonnet46 1m medium","B+","5.9min","B-","$1.06","B","3.8","B-","3.4"],
    ["typescript-bun","opus46 200k","B","6.2min","C+","$1.30","B","3.7","B","3.7"],
    ["pwsh","sonnet46 1m medium","C","8.4min","B-","$1.19","A-","4.2","C+","3.1"],
    ["typescript-bun","opus47 200k medium","C+","7.6min","C","$1.56","B+","4.0","B","3.7"],
    ["pwsh","opus47 1m medium","B-","7.1min","C","$1.70","B","3.6","B","3.5"],
    ["typescript-bun","sonnet46 1m medium","C+","7.7min","C+","$1.30","B","3.8","B","3.7"],
    ["bash","opus47 200k medium","A-","5.1min","C+","$1.42","C+","3.1","B","3.7"],
    ["default","opus47 1m high","C+","8.0min","D+","$2.20","B+","4.0","B","3.6"],
    ["typescript-bun","sonnet46 200k","C-","9.0min","C","$1.50","B+","3.9","B","3.8"],
    ["default","opus46 200k","B","6.4min","C+","$1.37","B","3.6","C+","3.1"],
    ["pwsh","opus47 1m high","D+","10.3min","D","$2.80","A-","4.1","B+","4.0"],
    ["default","opus47 1m xhigh","D+","10.4min","D-","$3.30","A","4.4","B","3.8"],
    ["typescript-bun","opus47 1m high","C-","8.9min","D","$2.75","A-","4.3","B","3.8"],
    ["pwsh-tool","opus46 200k","C","8.1min","C","$1.56","B","3.8","B","3.6"],
    ["default","sonnet46 200k","D+","9.9min","C+","$1.47","B+","3.9","B-","3.4"],
    ["default","haiku45 200k","A","4.8min","A+","$0.38","C-","2.4","C","2.7"],
    ["bash","opus46 200k","C","8.3min","C","$1.63","B+","4.1","C+","3.1"],
    ["pwsh","opus46 200k","C-","8.8min","C","$1.79","B","3.5","B","3.8"],
    ["pwsh","sonnet46 200k","D","11.2min","C","$1.63","B+","3.9","B-","3.4"],
    ["bash","sonnet46 200k","D","11.3min","C","$1.62","B","3.6","B","3.5"],
    ["pwsh","opus47 1m xhigh","D-","12.5min","D-","$3.72","A-","4.2","B","3.8"],
    ["pwsh","haiku45 200k*","B","6.4min","A","$0.54","D+","2.0","B-","3.2"],
    ["pwsh-tool","opus47 1m high","D-","11.8min","D-","$3.55","B+","3.9","B+","3.9"],
    ["typescript-bun","opus47 1m xhigh","D-","12.3min","D-","$3.57","B+","4.1","B+","3.9"],
    ["pwsh-tool","sonnet46 200k","D","10.7min","C+","$1.47","B-","3.4","B","3.6"],
    ["bash","opus47 1m xhigh","D","10.6min","D","$3.09","B","3.8","B+","4.1"],
    ["pwsh-tool","sonnet46 1m medium","D+","10.1min","C","$1.52","B","3.6","C+","3.1"],
    ["typescript-bun","haiku45 200k","A-","5.5min","A","$0.48","D","1.9","C+","3.1"],
    ["pwsh-tool","opus47 1m xhigh*","D-","12.4min","D-","$3.88","B+","4.0","B","3.6"],
    ["bash","sonnet46 1m medium","C","8.2min","B-","$1.19","C","2.9","B-","3.2"],
    ["pwsh-tool","haiku45 200k","B-","7.2min","A","$0.48","C-","2.4","C-","2.4"],
    ["bash","opus47 1m high","D+","10.5min","D+","$2.56","B-","3.4","C+","3.0"],
    ["bash","haiku45 200k","C+","7.6min","B+","$0.70","D","1.9","C-","2.5"]
  ];

  var KEYS = ["tests", "workflow", "duration", "cost"];

  function el(id) { return document.getElementById("bws-" + id); }

  function readWeights() {
    var w = {};
    KEYS.forEach(function (k) { w[k] = parseFloat(el(k).value) || 0; });
    return w;
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
      return { row: r, score: score };
    });
    scored.sort(function (a, b) { return a.score - b.score; });
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

  KEYS.forEach(function (k) {
    el(k).addEventListener("input", function () { redistribute(k); });
  });

  render();
})();
</script>
</div>
<!-- html-embed:end -->
