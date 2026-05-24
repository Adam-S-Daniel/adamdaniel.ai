"""Claude Code harness for the skill-mirror test suite."""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

from .base import AgentHarness, HarnessResult, Outcome


class ClaudeCodeHarness(AgentHarness):
    name = "claude-code"

    _LIVE_PROMPT_TEMPLATE = (
        "Read .claude/skills/{skill}/SKILL.md and output only the line that "
        "begins with SKILLS_MIRROR. No explanation, no other text."
    )
    _EXPECTED_MARKER = "SKILLS_MIRROR_CANARY_OK"
    _LIVE_TIMEOUT_SECONDS = 60
    _AUTH_FAIL_NEEDLES = (
        "auth",
        "log in",
        "logged out",
        "login",
        "unauthorized",
        "401",
        "credentials",
    )

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
            return HarnessResult(self.name, Outcome.SKIP, "claude CLI not on PATH")

        prompt = self._LIVE_PROMPT_TEMPLATE.format(skill=skill_name)
        cmd = [
            "claude",
            "-p",
            prompt,
            "--output-format",
            "json",
            "--allowedTools",
            "Read",
            "--no-session-persistence",
        ]

        try:
            proc = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                cwd=str(repo_root),
                timeout=self._LIVE_TIMEOUT_SECONDS,
            )
        except subprocess.TimeoutExpired:
            return HarnessResult(
                self.name,
                Outcome.FAIL,
                f"`claude -p` timed out after {self._LIVE_TIMEOUT_SECONDS}s",
            )

        if proc.returncode != 0:
            stderr_lower = (proc.stderr or "").lower()
            if any(needle in stderr_lower for needle in self._AUTH_FAIL_NEEDLES):
                return HarnessResult(
                    self.name,
                    Outcome.SKIP,
                    f"claude not authenticated: {(proc.stderr or '').strip()[:200]}",
                )
            return HarnessResult(
                self.name,
                Outcome.FAIL,
                (
                    f"`claude -p` exited {proc.returncode}\n"
                    f"stdout: {(proc.stdout or '')[:500]}\n"
                    f"stderr: {(proc.stderr or '')[:500]}"
                ),
            )

        try:
            payload = json.loads(proc.stdout)
        except json.JSONDecodeError as exc:
            return HarnessResult(
                self.name,
                Outcome.FAIL,
                f"could not parse claude output as JSON: {exc}\n"
                f"stdout: {(proc.stdout or '')[:500]}",
            )

        # `claude -p --output-format json` emits a JSON array of events;
        # the final `type=="result"` event carries the answer in `.result`.
        # Older versions returned a bare object — handle both shapes.
        body = ""
        if isinstance(payload, list):
            for event in reversed(payload):
                if isinstance(event, dict) and event.get("type") == "result":
                    body = event.get("result", "") or ""
                    break
        elif isinstance(payload, dict):
            body = payload.get("result", "") or ""
        if not isinstance(body, str):
            body = str(body)

        if self._EXPECTED_MARKER in body:
            return HarnessResult(
                self.name,
                Outcome.PASS,
                f"claude -p returned {self._EXPECTED_MARKER} via the mirror",
            )

        return HarnessResult(
            self.name,
            Outcome.FAIL,
            (
                f"canary marker {self._EXPECTED_MARKER!r} not found in claude response\n"
                f"result: {body[:500]}"
            ),
        )
