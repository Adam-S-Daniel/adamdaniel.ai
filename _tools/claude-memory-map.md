---
title: Claude Memory Map
slug: claude-memory-map
description: An interactive map of what Claude remembers — check the ways you use Claude and watch every memory store, and how it flows, assemble live.
featured: true
embed_src: /assets/tools/claude-memory-map/
source_url: https://github.com/Adam-S-Daniel/claude-memory-map
---
Claude keeps separate memories in different places — and which ones follow you
around depends entirely on *how* you use it. A standalone chat, a Project chat,
Claude Code in WSL, the same Claude Code on the web, Cowork — each reads and
writes a different set of stores.

This tool turns that into something you can see. Check every context you
actually use, and the diagram composes itself: what gets in, where it lives,
and how it comes back out. Toggle the **scope lens** to ask "what follows me
across projects?" vs. "what stays put?", and flip between brief and full labels
when you want the official Anthropic terminology spelled out.

It's a single self-contained page — the diagram is generated live in your
browser from your selection, nothing is sent anywhere. The
[source is on GitHub]({{ page.source_url }}); every store, edge, and term traces
to documented Anthropic behavior.
