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

## Try it yourself

The interactive sorting widget in [the original GHA-bench post](/introducing-gha-bench) now includes Opus 4.8 (and the new "ultra" effort). Drag the sliders to weight speed, cost, test quality, and code quality for *your* situation and see which model / effort / language combination comes out on top. The complete data lives in the [cross-run report](https://github.com/Adam-S-Daniel/GHA-bench/tree/main/results) on GitHub.

*\* The Gemini judge now runs via Google's Antigravity (`agy`) CLI, which replaced the retired Gemini CLI in June 2026. It grades about 0.3 points stricter on a 1–5 scale than the prior harness (overall correlation r ≈ 0.90), so Opus 4.8's quality grades are, if anything, very slightly conservative relative to the older models'.*

*\*\* The two runs being compared used different Claude Code versions (2.1.131/132 for Opus 4.7, 2.1.195 for Opus 4.8). A clean, model-only comparison would re-run both on the same version; that's on the to-do list.*
