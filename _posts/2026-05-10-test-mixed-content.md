---
title: Test mixed content
date: 2026-05-10 17:59:00 -0400
published: true
---
<!-- html-embed:start -->
<div class="post-embed">
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>How this benchmark works (in 5 minutes)</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  :root {
    --bg: #fafaf7;
    --ink: #1b1b1b;
    --mute: #555;
    --line: #d8d4c8;
    --accent: #b53d1f;
    --accent-2: #2c5e8a;
    --chip: #efece2;
    --good: #2f7d4f;
    --warn: #b08818;
    --bad:  #a23b1f;
  }
  html { background: var(--bg); color: var(--ink); }
  body {
    font: 16px/1.55 -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif;
    max-width: 760px; margin: 0 auto; padding: 32px 22px 80px;
  }
  h1 { font-size: 28px; line-height: 1.2; margin: 0 0 4px; }
  h1 + p.sub { color: var(--mute); margin: 0 0 28px; font-size: 15px; }
  h2 { font-size: 20px; margin: 36px 0 10px; border-bottom: 1px solid var(--line); padding-bottom: 4px; }
  h3 { font-size: 16px; margin: 22px 0 6px; }
  p { margin: 0 0 12px; }
  code, .mono { font-family: "SF Mono", Menlo, Consolas, monospace; font-size: 0.92em; }
  code { background: var(--chip); padding: 1px 5px; border-radius: 3px; }
  ul { margin: 0 0 14px; padding-left: 20px; }
  li { margin: 2px 0; }
  a { color: var(--accent-2); }
  .lede {
    background: white; border: 1px solid var(--line); border-left: 4px solid var(--accent);
    padding: 14px 16px; margin: 0 0 24px; border-radius: 3px;
  }
  .lede strong { display: block; margin-bottom: 4px; }
  .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
  .card {
    background: white; border: 1px solid var(--line); border-radius: 4px;
    padding: 12px 14px;
  }
  .card h4 { margin: 0 0 4px; font-size: 14px; letter-spacing: 0.02em; text-transform: uppercase; color: var(--mute); }
  .card p { margin: 0; font-size: 14px; }
  table { border-collapse: collapse; width: 100%; font-size: 14px; margin: 8px 0 16px; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--line); vertical-align: top; }
  th { background: var(--chip); font-weight: 600; }
  .tier-row { display: flex; gap: 4px; margin: 6px 0 4px; flex-wrap: wrap; }
  .tier {
    flex: 1; min-width: 38px; text-align: center; padding: 6px 4px; border-radius: 3px;
    font-weight: 600; font-size: 13px; color: white;
  }
  .t-aplus { background: #1f7a3a; }
  .t-a     { background: #2f8a4a; }
  .t-aminus{ background: #4a9a5e; }
  .t-bplus { background: #6ea34d; }
  .t-b     { background: #8aa83c; }
  .t-bminus{ background: #a89f30; }
  .t-cplus { background: #c2902a; }
  .t-c     { background: #c97524; }
  .t-cminus{ background: #c95824; }
  .t-dplus { background: #b9421f; }
  .t-d     { background: #a8331c; }
  .t-dminus{ background: #8e2818; }
  .t-f     { background: #5a1810; }
  .legend { font-size: 12px; color: var(--mute); margin-top: 4px; }
  svg { display: block; max-width: 100%; height: auto; }
  .pipe-wrap { background: white; border: 1px solid var(--line); border-radius: 4px; padding: 10px; margin: 8px 0 18px; overflow-x: auto; }
  .matrix-eq {
    display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
    font-size: 14px; margin: 8px 0 4px;
  }
  .mbox {
    background: white; border: 1px solid var(--line); border-radius: 4px;
    padding: 10px 12px; min-width: 110px; text-align: center;
  }
  .mbox b { display: block; font-size: 22px; line-height: 1.1; color: var(--accent); }
  .mbox span { font-size: 12px; color: var(--mute); text-transform: uppercase; letter-spacing: 0.04em; }
  .mbox.eq { border: none; background: transparent; font-size: 22px; min-width: 0; padding: 0 4px; color: var(--mute); }
  .mbox.total { background: var(--accent); color: white; border-color: var(--accent); }
  .mbox.total b { color: white; }
  .mbox.total span { color: rgba(255,255,255,0.85); }
  details { background: white; border: 1px solid var(--line); border-radius: 4px; padding: 8px 12px; margin: 8px 0; }
  summary { cursor: pointer; font-weight: 600; }
  details[open] summary { margin-bottom: 8px; }
  .chip { display: inline-block; background: var(--chip); padding: 1px 7px; border-radius: 10px; font-size: 12px; }
  .footer { color: var(--mute); font-size: 13px; margin-top: 40px; border-top: 1px solid var(--line); padding-top: 14px; }
</style>
</head>
<body>

<h1>How this benchmark works</h1>
<p class="sub">A 5-minute orientation before you read any blog post about the numbers.</p>

<div class="lede">
  <strong>The one-sentence version</strong>
  We give a Claude Code agent a small DevOps scripting task, force it to write the solution in
  a chosen language (or let it pick), watch it build and test the thing inside a real GitHub
  Actions container, and grade the result on speed, cost, and quality.
</div>

<h2>The pipeline (one run)</h2>
<p>Every data point in the report is one of these:</p>

<div class="pipe-wrap">
<svg viewBox="0 0 720 240" xmlns="http://www.w3.org/2000/svg" aria-label="Pipeline diagram">
  <defs>
    <marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
      <path d="M0,0 L10,5 L0,10 z" fill="#555"/>
    </marker>
    <style>
      .box { fill: #fff; stroke: #d8d4c8; stroke-width: 1.2; }
      .box-accent { fill: #fff5ee; stroke: #b53d1f; stroke-width: 1.4; }
      .box-judge  { fill: #eaf1f6; stroke: #2c5e8a; stroke-width: 1.4; }
      .lbl  { font: 600 12px -apple-system, sans-serif; fill: #1b1b1b; }
      .sub  { font: 11px -apple-system, sans-serif; fill: #555; }
      .arr  { stroke: #555; stroke-width: 1.4; fill: none; marker-end: url(#arr); }
      .annot{ font: italic 11px -apple-system, sans-serif; fill: #888; }
    </style>
  </defs>

  <!-- Prompt -->
  <rect class="box-accent" x="10" y="50" width="120" height="64" rx="4"/>
  <text class="lbl" x="70" y="76" text-anchor="middle">Task prompt</text>
  <text class="sub" x="70" y="94" text-anchor="middle">e.g. semver bumper</text>
  <text class="sub" x="70" y="108" text-anchor="middle">+ language constraint</text>

  <!-- Agent -->
  <rect class="box" x="160" y="40" width="140" height="84" rx="4"/>
  <text class="lbl" x="230" y="64" text-anchor="middle">Claude Code agent</text>
  <text class="sub" x="230" y="82" text-anchor="middle">writes script + tests</text>
  <text class="sub" x="230" y="98" text-anchor="middle">+ .github/workflows/*.yml</text>
  <text class="sub" x="230" y="114" text-anchor="middle">red/green TDD</text>

  <!-- act -->
  <rect class="box" x="330" y="50" width="120" height="64" rx="4"/>
  <text class="lbl" x="390" y="76" text-anchor="middle">act push</text>
  <text class="sub" x="390" y="94" text-anchor="middle">runs workflow in</text>
  <text class="sub" x="390" y="108" text-anchor="middle">a Docker container</text>

  <!-- Metrics -->
  <rect class="box" x="480" y="50" width="120" height="64" rx="4"/>
  <text class="lbl" x="540" y="72" text-anchor="middle">metrics.json</text>
  <text class="sub" x="540" y="89" text-anchor="middle">duration, cost, turns,</text>
  <text class="sub" x="540" y="103" text-anchor="middle">tests pass, act pass</text>

  <!-- Judges -->
  <rect class="box-judge" x="330" y="155" width="270" height="68" rx="4"/>
  <text class="lbl" x="465" y="178" text-anchor="middle">Panel of LLM judges</text>
  <text class="sub" x="465" y="196" text-anchor="middle">Haiku 4.5 + Gemini 3.1 Pro score</text>
  <text class="sub" x="465" y="212" text-anchor="middle">Tests Quality &amp; Workflow Craft (1&ndash;5)</text>

  <!-- Tier -->
  <rect class="box-accent" x="620" y="80" width="90" height="120" rx="4"/>
  <text class="lbl" x="665" y="100" text-anchor="middle">Report</text>
  <text class="sub" x="665" y="118" text-anchor="middle">tier A+ &hellip; F</text>
  <text class="sub" x="665" y="134" text-anchor="middle">per language</text>
  <text class="sub" x="665" y="148" text-anchor="middle">&times; model</text>
  <text class="sub" x="665" y="162" text-anchor="middle">&times; effort</text>

  <!-- Arrows -->
  <path class="arr" d="M130 82 L160 82"/>
  <path class="arr" d="M300 82 L330 82"/>
  <path class="arr" d="M450 82 L480 82"/>
  <path class="arr" d="M540 114 L540 155"/>
  <path class="arr" d="M600 82 L620 110"/>
  <path class="arr" d="M600 189 L620 170"/>

  <text class="annot" x="230" y="138" text-anchor="middle">workspace files</text>
  <text class="annot" x="390" y="138" text-anchor="middle">act-result.txt</text>
</svg>
</div>

<p>The runner never intervenes &mdash; it only observes. If the agent
ships broken code, broken code is what we score.</p>

<h2>The matrix (280 runs)</h2>
<p>The current canonical dataset is one big cross-product:</p>

<div class="matrix-eq">
  <div class="mbox"><b>7</b><span>tasks</span></div>
  <div class="mbox eq">&times;</div>
  <div class="mbox"><b>5</b><span>languages</span></div>
  <div class="mbox eq">&times;</div>
  <div class="mbox"><b>8</b><span>model + effort</span></div>
  <div class="mbox eq">=</div>
  <div class="mbox total"><b>280</b><span>runs</span></div>
</div>
<p class="legend">Run <span class="chip">2026-05-06_173435</span> &middot; ~38h wall &middot; ~$534 ($493 agent + $41 judges).</p>

<h3>The 7 tasks</h3>
<p>All have a GitHub Actions theme. Each requires a script, tests, and a working workflow YAML.</p>
<table>
  <tr><th>#</th><th>Task</th><th>Gist</th></tr>
  <tr><td>11</td><td>Semantic Version Bumper</td><td>parse conventional commits, bump <code>X.Y.Z</code></td></tr>
  <tr><td>12</td><td>PR Label Assigner</td><td>glob path rules &rarr; labels</td></tr>
  <tr><td>13</td><td>Dependency License Checker</td><td>allow / deny list &rarr; compliance report</td></tr>
  <tr><td>15</td><td>Test Results Aggregator</td><td>JUnit + JSON &rarr; markdown summary, flaky detection</td></tr>
  <tr><td>16</td><td>Environment Matrix Generator</td><td>config &rarr; <code>strategy.matrix</code> JSON</td></tr>
  <tr><td>17</td><td>Artifact Cleanup Script</td><td>retention rules &rarr; deletion plan</td></tr>
  <tr><td>18</td><td>Secret Rotation Validator</td><td>last-rotated dates &rarr; expiry report</td></tr>
</table>

<h3>The 5 languages</h3>
<table>
  <tr><th>Language</th><th>What it means</th></tr>
  <tr><td><code>default</code></td><td>Agent picks. <strong>It picks Python ~98% of the time.</strong> Treat this as the Python row.</td></tr>
  <tr><td><code>bash</code></td><td>Forced bash + <code>bats-core</code>. The "is this really just shell?" control.</td></tr>
  <tr><td><code>powershell</code></td><td>Forced PowerShell + Pester, invoked through the Bash tool.</td></tr>
  <tr><td><code>powershell-tool</code></td><td>Same as above, but Claude Code's <em>native</em> PowerShell tool is enabled (no shell wrapping).</td></tr>
  <tr><td><code>typescript-bun</code></td><td>Forced TypeScript on Bun, <code>bun test</code>.</td></tr>
</table>

<h3>The 8 model + effort combos</h3>
<p>"Effort" tunes how much extended thinking the model gets. "1m" / "200k" is the context window.</p>
<table>
  <tr><th>Model</th><th>Variants run</th></tr>
  <tr><td>Haiku 4.5</td><td><code>haiku45-200k</code></td></tr>
  <tr><td>Sonnet 4.6</td><td><code>sonnet46-200k</code>, <code>sonnet46-1m-medium</code></td></tr>
  <tr><td>Opus 4.6</td><td><code>opus46-200k</code></td></tr>
  <tr><td>Opus 4.7</td><td><code>opus47-200k-medium</code>, <code>opus47-1m-medium</code>, <code>opus47-1m-high</code>, <code>opus47-1m-xhigh</code></td></tr>
</table>

<h2>What gets measured</h2>
<p>Every <em>(language &times; model+effort)</em> cell of the report has four headline columns:</p>
<div class="grid-2">
  <div class="card"><h4>Duration</h4><p>Wall-clock minutes per run. Mean across the 7 tasks.</p></div>
  <div class="card"><h4>Cost</h4><p>USD per run from the CLI's own token accounting. Mean across the 7 tasks.</p></div>
  <div class="card"><h4>Tests Quality</h4><p>Panel-LLM score 1&ndash;5 of the <em>test code</em>. Coverage / rigor / design / overall.</p></div>
  <div class="card"><h4>Workflow Craft</h4><p>Panel-LLM score 1&ndash;5 of the <em>deliverable</em> (YAML + scripts, not tests).</p></div>
</div>

<h3>How tiers work</h3>
<p>Each headline column is normalised against the best cell observed,
then sliced into 13 letter bands. <strong>A+ is the best in the run; F is reserved for ratios worse than the worst observed.</strong> Bands are auto-calibrated &mdash; an A+ in one report is not directly comparable to an A+ in a different report.</p>

<div class="tier-row" aria-label="Tier scale">
  <div class="tier t-aplus">A+</div>
  <div class="tier t-a">A</div>
  <div class="tier t-aminus">A&minus;</div>
  <div class="tier t-bplus">B+</div>
  <div class="tier t-b">B</div>
  <div class="tier t-bminus">B&minus;</div>
  <div class="tier t-cplus">C+</div>
  <div class="tier t-c">C</div>
  <div class="tier t-cminus">C&minus;</div>
  <div class="tier t-dplus">D+</div>
  <div class="tier t-d">D</div>
  <div class="tier t-dminus">D&minus;</div>
  <div class="tier t-f">F</div>
</div>
<p class="legend">Duration &amp; Cost: lower ratio &rarr; better tier. Quality scores: 5.0 &rarr; A+, 1.0 &rarr; F.</p>

<h2>How quality is judged</h2>
<p>Two LLMs &mdash; <strong>Haiku 4.5</strong> (via Claude CLI) and <strong>Gemini 3.1 Pro</strong> (via Gemini CLI) &mdash; independently score every run on a 1&ndash;5 rubric. The cell shown in the report is the mean. A separate <em>Judge Consistency</em> section flags rows where the two judges disagree by &ge; 4 points and audits their rationales against the actual generated files; if a judge made a false claim it gets dropped from that cell.</p>
<p>So when a blog post says "Workflow Craft B+", that is &mdash; literally &mdash; the average of two LLM opinions, sanity-checked.</p>

<h2>Concepts that show up in posts</h2>

<details>
  <summary>Traps</summary>
  <p>Heuristic detectors for known agent anti-patterns: running <code>act push</code> more than twice, 4+ identical test reruns, fixture rewrites, TypeScript type-error fix cycles, mid-run module restructuring, and so on. Each detection is converted to estimated wasted seconds and dollars. The "Avg Duration Net of Traps" column reads as <em>"how fast it would have been without the self-inflicted detours"</em>.</p>
</details>

<details>
  <summary>Hooks</summary>
  <p><code>PostToolUse</code> hooks run a syntax / type / lint check after every <code>Write</code> or <code>Edit</code>. If the check fails, the diagnostic is fed back to the agent before its next turn. The <em>Hook Savings</em> table is a counterfactual: if the hook caught an error, that's one test cycle the agent didn't have to spend. <code>tsc --noEmit</code> is the most active hook by far.</p>
</details>

<details>
  <summary>Default = Python</summary>
  <p>In the unconstrained <code>default</code> mode the agent picks its own language. In the latest run it picks Python ~98% of the time, so any "default vs forced" comparison is essentially "Python vs the forced language."</p>
</details>

<details>
  <summary>Where the raw numbers live</summary>
  <p>Per-run artefacts in <code>results/&lt;date&gt;/tasks/&lt;task&gt;/&lt;variant&gt;/</code>: full CLI JSON stream, console transcript, <code>metrics.json</code>, before/after workspace listings, and a copy of every file the agent generated. Aggregated tables: <code>results/&lt;date&gt;/results.md</code>.</p>
</details>

<h2>Caveats worth keeping in mind</h2>
<ul>
  <li><strong>n is small.</strong> 7 tasks per cell. A single bad run moves the mean visibly.</li>
  <li><strong>Cost is what the CLI reported</strong>, not a third-party meter. Cache reads count cheap.</li>
  <li><strong>Tiers are relative to this run.</strong> Re-calibrated each report; do not compare A+ across runs.</li>
  <li><strong>The agent's own tests can lie.</strong> "tests pass" means the agent's tests passed &mdash; not that the script is correct. Tests Quality is the partial answer to that.</li>
  <li><strong>Judges have biases.</strong> They tend to dock structural counters they can't see (low coverage scores despite many tests). The Judge Consistency section is the place to verify before quoting a number.</li>
</ul>

<p class="footer">
  Source repo: <code>compare-agent-scripting-by-language</code>. Latest data: <code>results/2026-05-06_173435/results.md</code>.
  Methodology: <code>benchmark-instructions-v4.md</code>.
</p>

</body>
</html>
</div>
<!-- html-embed:end -->

**Test**
