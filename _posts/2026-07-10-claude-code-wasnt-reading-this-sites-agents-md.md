---
title: Claude Code wasn't reading this site's AGENTS.md
slug: claude-code-wasnt-reading-this-sites-agents-md
date: 2026-07-10 14:30:00 -0400
excerpt: The repo behind this site carries about 1,200 lines of agent guidance
  in AGENTS.md. Claude Code had never read a word of it, because my CLAUDE.md
  pointed there with a markdown link instead of an import.
published: false
---
The repository behind this site carries about 1,200 lines of guidance for coding agents in [`AGENTS.md`](https://github.com/Adam-S-Daniel/adamdaniel.ai/blob/main/AGENTS.md) — test-driven-development rules, e2e invariants that took real debugging pain to learn ("never bypass the UI in a UI test"), architecture notes, a warning not to re-vendor the gem-delivered admin machinery. As far as I can tell, Claude Code never read a word of it.

The mechanism is mundane. Claude Code loads `CLAUDE.md`, not `AGENTS.md` — [its docs say so flatly](https://code.claude.com/docs/en/memory). The supported way to bridge the two is an import line, `@AGENTS.md`, which the memory loader expands at session launch. My `CLAUDE.md` instead said:

```markdown
See [AGENTS.md](./AGENTS.md) for instructions, and make any updates/additions there.
```

That's a markdown link. It reads perfectly to a human, and the memory loader treats it as inert text. The agent got one sentence of context telling it where the instructions live, and — in my testing, at least — essentially never spent a tool call to go read them. Everything below that link was invisible.

## How I noticed

I'd read somewhere that Claude doesn't pick up files referenced from CLAUDE.md in some contexts, and since every repo I own uses the referenced-file pattern, I went to verify it empirically — planting unique magic tokens in AGENTS.md files across a matrix of layouts, then asking headless Claude Code sessions (with all file-reading tools disabled) to quote the token. If the model can say the word, the loader injected the file; if it can't, nothing did. The full matrix — imports, symlinks, subagents, the Agent SDK, and one embarrassing false positive where the model cheated by reading the file with its own tools — is in [the companion post](/testing-claude-code-agents-md-bridge/).

The `@AGENTS.md` import itself passed everywhere I could test it. The failure wasn't the mechanism I was worried about — it was sitting in this repo the whole time, one layer up: a bridge file that never bridged.

## Why nothing caught it

I run a small guidance layer, [`_agent-guidance`](https://github.com/Adam-S-Daniel/_agent-guidance), that syncs a managed `AGENTS.md` into every repo I own and adds the `CLAUDE.md` bridge where it's missing. It has a deliberate safety rule: never modify an existing `CLAUDE.md` — clobbering someone's hand-written file would be worse than warning. So for this repo it printed `WARN: CLAUDE.md exists but does not import @AGENTS.md` into a CI log nobody reads, every sync, and moved on. The nightly drift dashboard checks whether each repo's `AGENTS.md` matches the managed content — but never looks at `CLAUDE.md` at all.

Both behaviors are individually defensible, and together they add up to a silent failure that persisted for months: the guidance was perfectly up to date, and perfectly unread.

The fixes are filed: [a one-line bridge for this repo](https://github.com/Adam-S-Daniel/adamdaniel.ai/issues/2545), and [dashboard/monitoring changes in `_agent-guidance`](https://github.com/Adam-S-Daniel/_agent-guidance/issues/17) so a present-but-not-importing `CLAUDE.md` shows up as a red cell rather than a log line, backed by [a behavioral canary eval](https://github.com/Adam-S-Daniel/skills-evals/issues/5) so an upstream regression can't quietly undo the bridge either.

## The takeaway

Agent guidance is plumbing, and plumbing needs a pressure test. It's easy to reason "the file is there, the sync is green, therefore the agent sees it" — I did, for months. The only check that actually settles the question is behavioral: put a token in the file that the model could only know by having it in context, and ask. It costs one headless API call per repo, and I'm guessing I'm not the only person whose `CLAUDE.md` says something friendly and does nothing.

Not urgent for anyone else's stack, obviously — but if your CLAUDE.md "references" your AGENTS.md, it's worth thirty seconds to check whether that reference starts with `@`.
