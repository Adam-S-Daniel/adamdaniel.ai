---
title: Improvement Loop Explorer
slug: evals
description: "Git hook checks, skills, and rules for my AI coding agents:
  lessons harvested from real work, codified by the agents themselves, then
  measured, improved, and kept or cut."
featured: true
embed_src: /assets/tools/skills-evals/
source_url: https://github.com/Adam-S-Daniel/skills-evals
---
Three mechanisms help guide my AI coding agents. A git hook check is a rule the
computer enforces by refusing a commit or push that breaks it. A skill is a page
of instructions an agent reads before a particular kind of task. The guidance is
one page of rules every agent reads at the start of every session — nearly
every rule on it was learned from a real mistake.

One of those rules keeps the rest growing. When an agent makes a mistake, gets
corrected, or has to work out a procedure that could come up again, it writes
the lesson down before it finishes: as a git hook check if a commit can show the
problem, otherwise as a skill, otherwise as a new section of the guidance.

An automated loop does the rest. It centralizes the lessons that are widely
applicable, delivers them to every project, and creates additional ones by
analyzing past work sessions itself. It counts how often each git hook check
actually stops something, and it tests each skill and each guidance section on
the same task with it and without it, scored by fixed pass/fail checks and by a
second model acting as judge. Then it revises what could work better and
removes what doesn't earn its place.

This page shows all of it: each keep-or-cut verdict and the evidence behind it,
what the loop changed, how often each item gets used in real work, and what the
testing costs.

The numbers update on their own: the page reads the latest data from the
[results branch](https://github.com/Adam-S-Daniel/skills-evals/tree/persistent/eval-results)
each time it loads, and that data is rebuilt after every test run. How the
tests work is written down in
[How it works](https://github.com/Adam-S-Daniel/skills-evals/blob/main/docs/how-it-works.md),
and the keep-or-cut rules in
[the rules](https://github.com/Adam-S-Daniel/skills-evals/blob/main/docs/rules.md).
