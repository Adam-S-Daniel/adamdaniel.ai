---
title: Skill Evals Explorer
slug: skills-evals
description: Do the instructions I give my AI coding agents actually help? Each skill tested with and without, in plain language.
featured: false
# The asset is owned by skills-evals' site-sync workflow (tool-sync/skills-evals
# PRs); don't hand-edit assets/tools/skills-evals/ or its _data/tool_sources record.
embed_src: /assets/tools/skills-evals/
source_url: https://github.com/Adam-S-Daniel/skills-evals
---
A skill is a page of instructions an AI coding agent reads before it starts a
task. This page shows, for each of mine, how the agent does on the same task
with the skill and without it — scored by fixed pass/fail checks and by a
second model acting as judge.

The numbers update on their own: every new test run lands on the
[results branch](https://github.com/Adam-S-Daniel/skills-evals/tree/persistent/eval-results)
and the page reads it fresh each time it loads. How the tests work is written
down in [How it works](https://github.com/Adam-S-Daniel/skills-evals/blob/main/docs/how-it-works.md).
