"""Tests for scripts/bootstrap.sh and scripts/bootstrap.ps1.

Each test runs bootstrap inside a synthetic minimal repo in tmp_path so the
real repo state is never disturbed.
"""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

_NOT_LINUX = sys.platform == "win32"


def _copy_scripts(repo_root: Path, dest: Path) -> None:
    src = repo_root / "scripts"
    dest_scripts = dest / "scripts"
    dest_scripts.mkdir(parents=True, exist_ok=True)
    for name in ("bootstrap.sh", "verify-skills-mirror.sh"):
        s = src / name
        if s.exists():
            shutil.copy(s, dest_scripts / name)
            (dest_scripts / name).chmod(0o755)


def _run_bash_bootstrap(repo: Path) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["bash", str(repo / "scripts" / "bootstrap.sh")],
        capture_output=True,
        text=True,
        env={**os.environ, "GIT_DIR": "", "GIT_WORK_TREE": ""},
    )


def _make_skill(skills_root: Path, name: str) -> None:
    (skills_root / name).mkdir(parents=True, exist_ok=True)
    (skills_root / name / "SKILL.md").write_text(
        f"---\nname: {name}\ndescription: synthetic test skill\n---\n\n# {name}\n",
        encoding="utf-8",
    )


@pytest.fixture
def synthetic_repo(tmp_path: Path, repo_root: Path) -> Path:
    _copy_scripts(repo_root, tmp_path)
    return tmp_path


@pytest.mark.skipif(_NOT_LINUX, reason="bash bootstrap is for Unix-likes; Windows test is separate")
def test_bootstrap_creates_symlink_when_only_agents_skills_exist(synthetic_repo: Path) -> None:
    _make_skill(synthetic_repo / ".agents" / "skills", "demo")

    result = _run_bash_bootstrap(synthetic_repo)
    assert result.returncode == 0, f"bootstrap failed:\nstdout={result.stdout}\nstderr={result.stderr}"

    mirror = synthetic_repo / ".claude" / "skills"
    assert mirror.is_symlink(), f"{mirror} should be a symlink, got {mirror!r}"
    assert mirror.resolve() == (synthetic_repo / ".agents" / "skills").resolve()


@pytest.mark.skipif(_NOT_LINUX, reason="bash bootstrap is for Unix-likes")
def test_bootstrap_is_idempotent(synthetic_repo: Path) -> None:
    _make_skill(synthetic_repo / ".agents" / "skills", "demo")
    first = _run_bash_bootstrap(synthetic_repo)
    assert first.returncode == 0

    second = _run_bash_bootstrap(synthetic_repo)
    assert second.returncode == 0, f"second run failed:\nstderr={second.stderr}"

    mirror = synthetic_repo / ".claude" / "skills"
    assert mirror.is_symlink()
    assert mirror.resolve() == (synthetic_repo / ".agents" / "skills").resolve()


@pytest.mark.skipif(_NOT_LINUX, reason="bash bootstrap is for Unix-likes")
def test_bootstrap_migrates_when_only_claude_skills_has_content(synthetic_repo: Path) -> None:
    legacy = synthetic_repo / ".claude" / "skills"
    legacy.mkdir(parents=True)
    (legacy / "demo").mkdir()
    (legacy / "demo" / "SKILL.md").write_text(
        "---\nname: demo\ndescription: legacy\n---\n", encoding="utf-8"
    )

    result = _run_bash_bootstrap(synthetic_repo)
    assert result.returncode == 0, f"bootstrap failed:\nstderr={result.stderr}"

    moved = synthetic_repo / ".agents" / "skills" / "demo" / "SKILL.md"
    assert moved.is_file(), "legacy skill should have been moved into .agents/skills/"

    mirror = synthetic_repo / ".claude" / "skills"
    assert mirror.is_symlink()
    assert mirror.resolve() == (synthetic_repo / ".agents" / "skills").resolve()


@pytest.mark.skipif(_NOT_LINUX, reason="bash bootstrap is for Unix-likes")
def test_bootstrap_aborts_when_both_have_content(synthetic_repo: Path) -> None:
    _make_skill(synthetic_repo / ".agents" / "skills", "alpha")

    legacy = synthetic_repo / ".claude" / "skills"
    legacy.mkdir(parents=True)
    (legacy / "beta").mkdir()
    (legacy / "beta" / "SKILL.md").write_text(
        "---\nname: beta\ndescription: legacy\n---\n", encoding="utf-8"
    )

    result = _run_bash_bootstrap(synthetic_repo)
    assert result.returncode != 0, "bootstrap should abort on dual-content"
    assert "alpha" in (result.stdout + result.stderr) or "beta" in (
        result.stdout + result.stderr
    ), "abort message should mention what's in each directory"

    assert (synthetic_repo / ".agents" / "skills" / "alpha").is_dir(), (
        "alpha must not be moved or deleted on abort"
    )
    assert (synthetic_repo / ".claude" / "skills" / "beta").is_dir(), (
        "beta must not be moved or deleted on abort"
    )


@pytest.mark.skipif(_NOT_LINUX, reason="bash bootstrap is for Unix-likes")
def test_bootstrap_finishes_under_three_seconds(synthetic_repo: Path) -> None:
    """Bootstrap is in the cloud-session-startup critical path (sessionStart hook)."""
    _make_skill(synthetic_repo / ".agents" / "skills", "demo")

    import time

    start = time.monotonic()
    result = _run_bash_bootstrap(synthetic_repo)
    elapsed = time.monotonic() - start

    assert result.returncode == 0
    assert elapsed < 3.0, f"bootstrap took {elapsed:.2f}s; spec budget is 3s"
