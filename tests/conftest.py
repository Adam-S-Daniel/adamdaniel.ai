import os
from pathlib import Path

import pytest

# Throwaway change to verify the e2e workflow's single-shard fast path
# (scope=skip → 1 matrix entry). Nothing here matches a SPEC_RULE or
# FANOUT_PATTERN, so the selector should resolve scope=skip.

def pytest_configure(config: pytest.Config) -> None:
    """Honor SKILLS_TEST_LIVE=1 by switching the default `-m 'not live'`
    marker filter to `-m live`, so the env var matches an explicit
    `pytest -m live` invocation."""
    if os.environ.get("SKILLS_TEST_LIVE") == "1":
        current = getattr(config.option, "markexpr", "") or ""
        if current in ("", "not live"):
            config.option.markexpr = "live"


@pytest.fixture(scope="session")
def repo_root() -> Path:
    return Path(__file__).resolve().parent.parent


@pytest.fixture(scope="session")
def canary_skill_name() -> str:
    return "test-canary"
