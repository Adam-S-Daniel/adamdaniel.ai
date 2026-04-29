"""Base classes for agent test harnesses.

Each registered harness has an offline check (always runs) and a live check
(runs when the agent's CLI is reachable and SKILLS_TEST_LIVE / pytest -m live
is set). Adding a harness for a new agent is a pure config + new module
change — see tests/harness-config.yaml.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from enum import Enum
from pathlib import Path


class Outcome(Enum):
    PASS = "pass"
    FAIL = "fail"
    SKIP = "skip"


@dataclass
class HarnessResult:
    harness: str
    outcome: Outcome
    detail: str


class AgentHarness(ABC):
    """An adapter that proves a given agent discovers skills via the mirror."""

    name: str  # short identifier, e.g. "claude-code"

    @abstractmethod
    def verify_offline(self, repo_root: Path, skill_name: str) -> HarnessResult:
        """Structural check that this agent would discover the skill.

        No network, no auth. Required.
        """

    @abstractmethod
    def verify_live(self, repo_root: Path, skill_name: str) -> HarnessResult:
        """Actually invoke the agent.

        Must return SKIP if the agent CLI is not on PATH or not authenticated,
        so the runner can call it uniformly without a missing-binary failure
        breaking a developer's local run.
        """
