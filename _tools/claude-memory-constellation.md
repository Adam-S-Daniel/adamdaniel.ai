---
title: Claude Memory Constellation
slug: claude-memory-constellation
description: A living-graph prototype of the Claude Memory Map — toggle the ways you use Claude and watch shared memory stores pull contexts together while machine-local silos drift apart.
featured: false
embed_src: /assets/tools/claude-memory-constellation/
source_url: https://github.com/Adam-S-Daniel/claude-memory-map/tree/main/prototypes
---
A prototype reimagining of the [Claude Memory Map](/tools/claude-memory-map/)
— same carefully sourced model of what Claude remembers, different experience.
Instead of a generated diagram, the map is a live force-directed constellation:
each way you use Claude flies in as you toggle it, shared stores become hubs
that pull contexts together, and machine-local stores (Mac, Windows, WSL)
drift apart into visibly separate islands. Sync vs. silo is something you
*see* before you read a single label.

Tap any store for the dossier: what gets in, how it comes back out, who in
your selection touches it, whether it's in sync or kept separate — and, where
there's something to do about it, how (settings pages, file paths, the
`autoMemoryDirectory` escape hatch). Surprising stores carry a badge; their
dossiers link to sibling stores so you can see for yourself that, say, WSL
and native Windows each keep their own memory even on one machine.

Everything runs in your browser from a single self-contained page — nothing
is sent anywhere. This is an exploratory prototype living alongside the
original tool ([source]({{ page.source_url }})); the facts and terminology
trace to the same documented Anthropic behavior as the original map.
