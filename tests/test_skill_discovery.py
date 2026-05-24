"""Run every active agent harness against the canary skill.

Driven entirely by tests/harness-config.yaml. Adding a harness means dropping
a module under tests/harnesses/ and flipping `enabled: true` in the config —
no edits to this file needed.
"""

from __future__ import annotations

import importlib
from pathlib import Path
from typing import Any

import pytest
import yaml

from tests.harnesses.base import AgentHarness, HarnessResult, Outcome

CONFIG_PATH = Path(__file__).resolve().parent / "harness-config.yaml"


def _load_config() -> dict[str, Any]:
    return yaml.safe_load(CONFIG_PATH.read_text(encoding="utf-8")) or {}


def _active_harnesses() -> list[tuple[str, AgentHarness]]:
    cfg = _load_config()
    out: list[tuple[str, AgentHarness]] = []
    for entry in cfg.get("harnesses") or []:
        if not entry.get("enabled"):
            continue
        module = importlib.import_module(entry["module"])
        cls = getattr(module, entry["class"])
        instance = cls()
        out.append((entry["name"], instance))
    return out


def _canary_name() -> str:
    return _load_config().get("canary_skill", "test-canary")


_HARNESSES = _active_harnesses()
_CANARY = _canary_name()


def _ids(harnesses: list[tuple[str, AgentHarness]]) -> list[str]:
    return [name for name, _ in harnesses]


def _assert_outcome(result: HarnessResult, *, allow_skip: bool) -> None:
    if result.outcome == Outcome.PASS:
        return
    if result.outcome == Outcome.SKIP:
        if allow_skip:
            pytest.skip(f"{result.harness}: {result.detail}")
        pytest.fail(f"{result.harness} unexpectedly skipped offline check: {result.detail}")
    pytest.fail(f"{result.harness} FAIL: {result.detail}")


@pytest.mark.parametrize("name, harness", _HARNESSES, ids=_ids(_HARNESSES))
def test_offline_discovery(repo_root: Path, name: str, harness: AgentHarness) -> None:
    """Each active harness's verify_offline must PASS for the canary."""
    result = harness.verify_offline(repo_root, _CANARY)
    assert result.harness == name, "harness name mismatch"
    _assert_outcome(result, allow_skip=False)


@pytest.mark.live
@pytest.mark.parametrize("name, harness", _HARNESSES, ids=_ids(_HARNESSES))
def test_live_discovery(repo_root: Path, name: str, harness: AgentHarness) -> None:
    """Each active harness's verify_live must PASS or SKIP (never FAIL)."""
    result = harness.verify_live(repo_root, _CANARY)
    assert result.harness == name, "harness name mismatch"
    _assert_outcome(result, allow_skip=True)
