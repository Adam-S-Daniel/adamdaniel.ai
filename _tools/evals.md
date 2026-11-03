---
title: Evals Explorer
slug: evals
description: Do the skills and rules I give my AI coding agents actually help? Each one tested with and without, in plain language.
featured: false
# The asset is owned by skills-evals' site-sync workflow (tool-sync/skills-evals
# PRs); don't hand-edit assets/tools/skills-evals/ or its _data/tool_sources record.
embed_src: /assets/tools/skills-evals/
source_url: https://github.com/Adam-S-Daniel/skills-evals
---
My AI coding agents read two kinds of instructions. A skill is a page of
instructions an agent reads before a particular kind of task. The guidance is
one page of rules every agent reads at the start of every session — nearly
every rule on it was learned from a real mistake. This page shows, for each
skill and each section of the guidance, how the agent does on the same task
with it and without it, scored by fixed pass/fail checks and by a second model
acting as judge. Switch between skills and guidance at the top of the page.

The numbers update on their own: every new test run lands on the
[results branch](https://github.com/Adam-S-Daniel/skills-evals/tree/persistent/eval-results)
and the page reads it fresh each time it loads. How the tests work is written
down in [How it works](https://github.com/Adam-S-Daniel/skills-evals/blob/main/docs/how-it-works.md).
