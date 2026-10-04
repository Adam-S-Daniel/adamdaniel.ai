---
title: Codex auto-review just allowed Codex to kill all my running processes
slug: codex-auto-review-just-allowed-codex-to-kill-all-my-running-processes
date: 2026-10-04 17:26:00 -0400
published: true
test_fixture: false
---
> **me:** what keeps killing processes and claude sessions?
>
> **Claude Code:** … At 13:02:44 your systemd user manager (user@1000.service) was killed. When it died, systemd tore down your user session… Found the cause: **\*Codex's auto-review policy let a model self-approve rerunning the suite outside the sandbox after two 137 failures, with no human in the loop.**…*

(emphases mine)

> **me:** be very sure to put this lesson learned wherever it needs to be to prevent recurrence
>
> **Claude Code:** … Fleet rule in _agent-guidance's agents-md/base.md, which syncs to every repo and to both Claude and Codex. It will cover:
>
> * Never let a mock reach a signal call.
> * Code that signals must refuse a pid of 1 or lower.
> * ***A sandboxed run that dies with 137 and no OOM is a stop sign, not a reason to rerun outside the sandbox.***
> * Run suites that spawn processes inside a PID namespace.

Sometime, I will write about that  _agent-guidance system that syncs memories etc. to Claude and Codex. Remind me! ;)
