---
title: "Symlink or @import? Testing how Claude Code actually loads AGENTS.md"
slug: testing-claude-code-agents-md-bridge
date: 2026-07-10 15:00:00 -0400
excerpt: I planted magic tokens in AGENTS.md files across sixteen repo layouts
  and asked headless Claude Code sessions to quote them. Results — including
  the round-one false positive where the model cheated by reading the file
  with its own tools.
published: false
test_fixture: false
---
`AGENTS.md` has quietly become the cross-tool standard for agent instructions — [agents.md](https://agents.md) lists twenty-three tools, Codex, Jules, Devin, Cursor, Copilot's coding agent, Aider, goose, opencode, and Zed among them. Claude Code is conspicuously not on that list. It reads `CLAUDE.md`, [says so in its docs](https://code.claude.com/docs/en/memory), and the feature request for native AGENTS.md support ([anthropics/claude-code#6235](https://github.com/anthropics/claude-code/issues/6235), opened August 2025, thousands of 👍) is still open — the changelog through v2.1.206 has zero AGENTS.md entries. I checked byte-by-byte, and then grepped the shipped binary for good measure: the string appears exactly twice, both inside the `/init` prompt.

So if you keep guidance in `AGENTS.md` (I sync a managed one into every repo I own), you need a bridge. There are two candidates:

1. a `CLAUDE.md` containing the import line `@AGENTS.md`, or
2. a symlink: `ln -s AGENTS.md CLAUDE.md`.

I'd read that Claude doesn't pick up referenced files in some contexts, which — given that all my repos use option 1 — seemed worth actually testing rather than worrying about. Sixteen layouts later, here's what holds up.

## Method, and the trap

Each test directory plants a unique token ("The magic word is FLUMMOX-7291") somewhere in the layout, and a headless session gets asked: *what's the magic word?* If the loader injected the file, the model can answer; if not, it can't.

Except that's not quite true, and my first run produced a beautiful false positive. In a directory with **only** an `AGENTS.md` — no CLAUDE.md, no bridge — the model answered correctly. Native AGENTS.md support, undocumented? No: headless Claude Code still has its Read and Glob tools, and the model, asked about project instructions it didn't have, simply went and read the file like a sensible agent. The control — rerunning with every file-reading tool disallowed — flipped the answer to NONE.

Agents make lousy lab rats; they cheat. Every result below is from the tools-disabled runs (Claude Code v2.1.206, Agent SDK v0.3.206, Linux).

## Results

| Layout | Guidance visible? |
|---|---|
| `CLAUDE.md` = `@AGENTS.md` | ✅ |
| `CLAUDE.md` → symlink to AGENTS.md | ✅ |
| Only `AGENTS.md`, no CLAUDE.md | ❌ no native support, no fallback |
| `CLAUDE.md` without an import, AGENTS.md alongside | ❌ AGENTS.md invisible |
| `@AGENTS.md` inside a fenced code block | ❌ (documented: imports skip code blocks) |
| Import chains (CLAUDE.md → AGENTS.md → deeper file) | ✅ up to 4 hops |
| Subdirectory CLAUDE.md + import, loaded lazily on file access | ✅ |
| Subdirectory AGENTS.md alone | ❌ |
| `CLAUDE.local.md` with an import | ✅ |
| `--add-dir` directory's CLAUDE.md (headless, even with the documented env flag) | ❌ |
| Agent SDK, default options | ✅ imports expanded |
| Agent SDK, `settingSources: []` | ❌ nothing loads |
| Subagent, `general-purpose` type | ✅ full memory incl. imports |
| Subagent, `Explore` type | ❌ by design |
| `@file` reference in a slash command | ✅ expanded |
| `@file` reference in a SKILL.md body | ❌ not an import — the agent is expected to Read it |

Two things I'd half-remembered turned out to be true *once*, and stale now. The Agent SDK really did ship a breaking change (v0.1.0) that stopped loading CLAUDE.md by default — it was reverted; current SDKs load it again unless you opt out. And through this spring there were open issues reporting that subagents didn't receive CLAUDE.md at all (v2.1.62–v2.1.152 era); on current builds the [documented behavior](https://code.claude.com/docs/en/sub-agents) — everything except Explore and Plan gets the full memory hierarchy — is what I measured. I'm guessing one of those two is the "Claude ignores referenced files" claim I ran into. In fairness, it was hard to check without running the experiment: this stuff has changed three times in a year.

## So: symlink or import?

The symlink works — on my Linux box. But every place the two approaches differ, the import wins:

- **Windows.** Git only materializes real symlinks with Developer Mode or admin rights plus `core.symlinks=true`; otherwise the checkout contains a plain text file whose content is the string `AGENTS.md`. Which is not an import, so the bridge silently degrades to exactly the broken state the symlink was meant to prevent. Anthropic's own memory doc recommends the import over the symlink on Windows.
- **Anything that reads files over the GitHub API** gets a symlink's target *path*, not its content.
- **Track record.** The Claude Code changelog is a small museum of symlink fixes — sandbox startup failures when `.claude/skills` is a symlink, rules not loading via symlinked paths, symlinked-settings hot-reload bugs. And there's an open bug filed against this exact pattern: with `ln -s AGENTS.md CLAUDE.md`, current versions read the file fine but [refuse to Edit or Write through the symlink](https://github.com/anthropics/claude-code/issues/66559) — so `/init` and any agent-driven memory update break. Imports have no comparable history.
- And the contexts where imports genuinely don't help — Explore subagents, `settingSources: []`, claude.ai chat — don't read `CLAUDE.md` **at all**. A symlink is equally invisible there. There is, as far as I can tell, no surface that reads CLAUDE.md but refuses to expand its imports.

So the import bridge stays. What actually needed fixing was operational, not mechanical: my sync tool refuses (correctly) to edit a hand-written CLAUDE.md and only warns in CI logs, my drift dashboard never checked the bridge file at all — and one of my repos, [including the one that builds this site](https://github.com/Adam-S-Daniel/adamdaniel.ai/issues/2545), had a CLAUDE.md that *linked* to AGENTS.md instead of importing it. Months of well-maintained guidance, never loaded.

The implementation issues that came out of this — bridge checks in the drift report, a magic-token canary eval so a CLI regression can't quietly undo the bridge, and prompt-inlining guidance for Explore-type subagents that never see memory — are in [`_agent-guidance#17`](https://github.com/Adam-S-Daniel/_agent-guidance/issues/17) and [`skills-evals#5`](https://github.com/Adam-S-Daniel/skills-evals/issues/5).

If you take one thing from this: don't audit your agent plumbing by reading it. Plant a token, disable the tools, and ask.
