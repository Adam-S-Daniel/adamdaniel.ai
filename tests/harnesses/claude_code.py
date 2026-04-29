"""Claude Code harness for the skill-mirror test suite."""
from __future__ import annotations

import shutil
from pathlib import Path

from .base import AgentHarness, HarnessResult, Outcome


class ClaudeCodeHarness(AgentHarness):
    name = "claude-code"

    def verify_offline(self, repo_root: Path, skill_name: str) -> HarnessResult:
        mirrored = repo_root / ".claude" / "skills" / skill_name / "SKILL.md"
        if not mirrored.is_file():
            return HarnessResult(
                self.name,
                Outcome.FAIL,
                f"Skill not reachable through mirror at {mirrored}",
            )

        try:
            mirrored.read_text(encoding="utf-8")
        except OSError as exc:
            return HarnessResult(
                self.name,
                Outcome.FAIL,
                f"Skill at {mirrored} not readable: {exc}",
            )

        canonical = (repo_root / ".agents" / "skills").resolve()
        try:
            resolved_parent = mirrored.resolve().parent.parent
        except OSError as exc:
            return HarnessResult(
                self.name,
                Outcome.FAIL,
                f"Could not resolve {mirrored}: {exc}",
            )

        if resolved_parent != canonical:
            return HarnessResult(
                self.name,
                Outcome.FAIL,
                (
                    "Mirror is not a link to .agents/skills — "
                    f"{mirrored} resolves under {resolved_parent}, "
                    f"expected {canonical}. Someone may have replaced the link "
                    "with a real copy."
                ),
            )

        return HarnessResult(
            self.name,
            Outcome.PASS,
            f"Claude Code would discover {skill_name} through .claude/skills",
        )

    def verify_live(self, repo_root: Path, skill_name: str) -> HarnessResult:
        if shutil.which("claude") is None:
            return HarnessResult(
                self.name, Outcome.SKIP, "claude CLI not on PATH"
            )
        # Step 6 wires up the actual `claude -p` invocation; for now the
        # offline-mode harness is the only thing this PR is shipping.
        return HarnessResult(
            self.name,
            Outcome.SKIP,
            "live verify_live not yet implemented (step 6)",
        )
