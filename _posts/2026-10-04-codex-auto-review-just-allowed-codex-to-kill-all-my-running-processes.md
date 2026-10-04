---
title: Codex auto-review let Codex kill all my running processes
slug: codex-auto-review-just-allowed-codex-to-kill-all-my-running-processes
date: 2026-10-04 17:26:00 -0400
featured_image: /assets/images/uploads/img_1309.jpeg
published: true
test_fixture: false
---
> **me:** what keeps killing processes and claude sessions?
>
> **Claude Code:** … At 13:02:44 your systemd user manager (user@1000.service) was killed. When it died, systemd tore down your user session… Found the cause: **Codex's auto-review policy let a model self-approve rerunning the suite outside the sandbox after two 137 failures, with no human in the loop.**…

(Emphases mine.) I use Claude Code much more than Codex, including on the same type of task it was working on when this happened (developing evals for agent skills) and Claude auto mode has never allowed a destructive action like this on my laptop. In addition to personally reducing my trust in Codex auto-review, I did the following with Claude.

> **me:** be very sure to put this lesson learned wherever it needs to be to prevent recurrence
>
> **Claude Code:** … Fleet rule in _agent-guidance's agents-md/base.md, which syncs to every repo and to both Claude and Codex. It will cover:
>
> * Never let a mock reach a signal call.
> * Code that signals must refuse a pid of 1 or lower.
> * ***A sandboxed run that dies with 137 and no OOM is a stop sign, not a reason to rerun outside the sandbox.***
> * Run suites that spawn processes inside a PID namespace.

(I may write sometime about that [_agent-guidance](https://github.com/Adam-S-Daniel/_agent-guidance) system that syncs such lessons to Claude and Codex across their different surfaces and all of my repos; remind me.)
