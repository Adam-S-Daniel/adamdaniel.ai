"""Tests for scripts/bootstrap.ps1 — the native-Windows variant.

End-to-end tests run only on Windows; they create a synthetic minimal repo in
tmp_path, run bootstrap.ps1, and assert the resulting on-disk state.

A parse-check that runs anywhere pwsh is on PATH is also included so we catch
syntax regressions on the Linux CI job and on local WSL runs.
"""

from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

import pytest

_IS_WINDOWS = sys.platform == "win32"
_PWSH = shutil.which("pwsh") or shutil.which("powershell")


def _copy_scripts(repo_root: Path, dest: Path) -> None:
    src = repo_root / "scripts"
    dest_scripts = dest / "scripts"
    dest_scripts.mkdir(parents=True, exist_ok=True)
    for name in ("bootstrap.ps1", "verify-skills-mirror.ps1"):
        s = src / name
        if s.exists():
            shutil.copy(s, dest_scripts / name)


def _make_skill(skills_root: Path, name: str) -> None:
    (skills_root / name).mkdir(parents=True, exist_ok=True)
    (skills_root / name / "SKILL.md").write_text(
        f"---\nname: {name}\ndescription: synthetic test skill\n---\n",
        encoding="utf-8",
    )


def _run_pwsh_bootstrap(repo: Path) -> subprocess.CompletedProcess:
    assert _PWSH, "pwsh/powershell required for this test"
    return subprocess.run(
        [
            _PWSH,
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            str(repo / "scripts" / "bootstrap.ps1"),
        ],
        capture_output=True,
        text=True,
    )


@pytest.fixture
def synthetic_repo(tmp_path: Path, repo_root: Path) -> Path:
    _copy_scripts(repo_root, tmp_path)
    return tmp_path


@pytest.mark.skipif(not _PWSH, reason="pwsh / powershell not on PATH")
def test_bootstrap_ps1_parses(repo_root: Path) -> None:
    """Runs anywhere pwsh exists. Verifies the script is syntactically valid."""
    script = repo_root / "scripts" / "bootstrap.ps1"
    assert script.is_file(), f"{script} does not exist"
    cmd = (
        "$tokens=$null; $errs=$null;"
        f"[System.Management.Automation.Language.Parser]::ParseFile("
        f"'{script.as_posix()}',[ref]$tokens,[ref]$errs) | Out-Null;"
        "if ($errs.Count -gt 0) { $errs | ForEach-Object { Write-Error $_ }; exit 1 }"
    )
    result = subprocess.run(
        [_PWSH, "-NoProfile", "-Command", cmd],
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, f"parse errors:\n{result.stderr}"


@pytest.mark.skipif(not _PWSH, reason="pwsh / powershell not on PATH")
def test_verify_ps1_parses(repo_root: Path) -> None:
    script = repo_root / "scripts" / "verify-skills-mirror.ps1"
    assert script.is_file(), f"{script} does not exist"
    cmd = (
        "$tokens=$null; $errs=$null;"
        f"[System.Management.Automation.Language.Parser]::ParseFile("
        f"'{script.as_posix()}',[ref]$tokens,[ref]$errs) | Out-Null;"
        "if ($errs.Count -gt 0) { $errs | ForEach-Object { Write-Error $_ }; exit 1 }"
    )
    result = subprocess.run(
        [_PWSH, "-NoProfile", "-Command", cmd],
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, f"parse errors:\n{result.stderr}"


@pytest.mark.skipif(not _IS_WINDOWS, reason="Windows-only end-to-end test")
def test_bootstrap_ps1_creates_link_when_only_agents_skills_exist(synthetic_repo: Path) -> None:
    _make_skill(synthetic_repo / ".agents" / "skills", "demo")

    result = _run_pwsh_bootstrap(synthetic_repo)
    assert result.returncode == 0, (
        f"bootstrap failed:\nstdout={result.stdout}\nstderr={result.stderr}"
    )

    mirror = synthetic_repo / ".claude" / "skills"
    assert mirror.exists(), "mirror should exist"
    canonical = (synthetic_repo / ".agents" / "skills").resolve()
    assert mirror.resolve() == canonical, (
        f"{mirror} should resolve to {canonical}, got {mirror.resolve()}"
    )


@pytest.mark.skipif(not _IS_WINDOWS, reason="Windows-only end-to-end test")
def test_bootstrap_ps1_is_idempotent(synthetic_repo: Path) -> None:
    _make_skill(synthetic_repo / ".agents" / "skills", "demo")

    first = _run_pwsh_bootstrap(synthetic_repo)
    assert first.returncode == 0
    second = _run_pwsh_bootstrap(synthetic_repo)
    assert second.returncode == 0


@pytest.mark.skipif(not _IS_WINDOWS, reason="Windows-only end-to-end test")
def test_bootstrap_ps1_aborts_on_dual_content(synthetic_repo: Path) -> None:
    _make_skill(synthetic_repo / ".agents" / "skills", "alpha")
    legacy = synthetic_repo / ".claude" / "skills"
    legacy.mkdir(parents=True)
    (legacy / "beta").mkdir()
    (legacy / "beta" / "SKILL.md").write_text("---\nname: beta\n---\n", encoding="utf-8")

    result = _run_pwsh_bootstrap(synthetic_repo)
    assert result.returncode != 0, "should abort on dual-content"
    assert (synthetic_repo / ".claude" / "skills" / "beta").exists()
    assert (synthetic_repo / ".agents" / "skills" / "alpha").exists()
