---
title: A map of what Claude actually remembers
slug: claude-memory-map
date: 2026-06-25 09:00:00 -0400
excerpt: Claude keeps separate memories in different places, and which ones follow you around depends entirely on how you use it. So I built an interactive map.
published: false
---
Claude's memory is scattered across more places than most people realize — and
which memories follow you around depends entirely on *how* you're using it. A
standalone chat draws on your account-level memory; a chat inside a Project
draws on that Project's own store instead. Claude Code running in WSL keeps a
set of notes your Windows-side Claude Code never sees. Claude Code on the web
reads only the repo's `CLAUDE.md` and nothing else. Cowork has its own
per-project memory again.

I kept having to re-derive all of this from memory — ironically — every time
someone asked me "wait, will it remember that?" So I built a small thing to
answer the question once: an interactive map of every place Claude stores
something, and how it flows in and out.

Check the ways you actually use Claude and the diagram composes itself — no
pre-baked variants, it's generated live from your selection. There's a scope
lens to ask the two questions that usually matter ("what follows me across
projects?" vs. "what stays put?"), and a toggle for the full, official
Anthropic terminology when you want the precise names rather than the friendly
ones. It's one self-contained page; nothing you check is sent anywhere.

The permanent home is here — **[Claude Memory Map](/tools/claude-memory-map/)** —
and it's embedded below so you can poke at it without leaving the page:

<!-- html-embed:start -->
<div class="post-embed">
<iframe
  src="/assets/tools/claude-memory-map/"
  title="Claude Memory Map — an interactive map of what Claude remembers"
  loading="lazy"
  style="width:100%; height:80vh; min-height:560px; border:1px solid #E4DFD4; border-radius:8px; background:#FDFBF7;"></iframe>
<p style="font-size:0.85em; margin-top:0.5rem;">
  Trouble with the embed? <a href="/tools/claude-memory-map/">Open the full-page version →</a>
</p>
</div>
<!-- html-embed:end -->

The whole thing is open source — the
[code is on GitHub](https://github.com/Adam-S-Daniel/claude-memory-map) — and
every store, edge, and label traces back to documented Anthropic behavior
(where the docs and the shipping app disagreed, the app won). If you spot
something that's drifted out of date, a pull request or a note is very welcome.
