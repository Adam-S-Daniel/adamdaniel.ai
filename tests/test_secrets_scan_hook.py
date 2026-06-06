"""Tests for scripts/secrets-scan.sh and the pre-commit hook chain.

Each test builds a throwaway git repo in ``tmp_path``, copies the hook
scripts and gitleaks config in, plants a known input on the index, and
asserts the hook either blocks or allows the commit. The point is to
prove the hook actually catches stuff — the configuration is the same
gitleaks binary and ``.gitleaks.toml`` that runs in CI, so a passing
hook test means a passing CI scan.

Tests that depend on the gitleaks binary are skipped when it isn't on
``PATH`` (the skills-mirror CI workflow installs it before running
pytest; local runs without it skip these cases instead of false-failing).
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

_NOT_LINUX = sys.platform == "win32"
_NO_GITLEAKS = shutil.which("gitleaks") is None

# A literal AWS access-key id pattern that gitleaks' default ruleset flags
# (matches AKIA[0-9A-Z]{16} with adequate entropy). Not a real key. Not
# matched by any allowlist entry in .gitleaks.toml.
_PLANTED_AWS_KEY = "AKIA" + "QWERTYUIOPASDFGH"
_PLANTED_LINE = f'AWS_ACCESS_KEY_ID = "{_PLANTED_AWS_KEY}"\n'


def _copy_assets(repo_root: Path, dest: Path) -> None:
    """Mirror the minimum slice of the repo needed to exercise the hook."""
    src_scripts = repo_root / "scripts"
    (dest / "scripts").mkdir(parents=True, exist_ok=True)
    # Keep in sync with .githooks/pre-commit's guard chain.
    for n in (
        "bootstrap.sh",
        "verify-skills-mirror.sh",
        "secrets-scan.sh",
        "lint-staged.sh",
    ):
        s = src_scripts / n
        if s.exists():
            shutil.copy(s, dest / "scripts" / n)
            (dest / "scripts" / n).chmod(0o755)

    fragment = repo_root / ".gitconfig-fragment"
    if fragment.exists():
        shutil.copy(fragment, dest / ".gitconfig-fragment")

    hook_src = repo_root / ".githooks" / "pre-commit"
    if hook_src.exists():
        (dest / ".githooks").mkdir(exist_ok=True)
        shutil.copy(hook_src, dest / ".githooks" / "pre-commit")
        (dest / ".githooks" / "pre-commit").chmod(0o755)

    config = repo_root / ".gitleaks.toml"
    if config.exists():
        shutil.copy(config, dest / ".gitleaks.toml")

    # secrets-scan.sh parses GITLEAKS_VERSION out of the CI workflow as its
    # single source of truth, so the file has to exist in the synthetic repo.
    workflow = repo_root / ".github" / "workflows" / "secrets-scan.yml"
    if workflow.exists():
        (dest / ".github" / "workflows").mkdir(parents=True, exist_ok=True)
        shutil.copy(workflow, dest / ".github" / "workflows" / "secrets-scan.yml")

    # bootstrap insists on at least one .agents/skills/<name>/SKILL.md, since
    # the chained skills-mirror check rejects an empty mirror.
    demo = dest / ".agents" / "skills" / "demo"
    demo.mkdir(parents=True, exist_ok=True)
    (demo / "SKILL.md").write_text("---\nname: demo\ndescription: x\n---\n", encoding="utf-8")


def _git(*args: str, cwd: Path, env: dict | None = None) -> subprocess.CompletedProcess:
    real_env = {
        **os.environ,
        "GIT_AUTHOR_NAME": "Test",
        "GIT_AUTHOR_EMAIL": "t@example.com",
        "GIT_COMMITTER_NAME": "Test",
        "GIT_COMMITTER_EMAIL": "t@example.com",
    }
    if env:
        real_env.update(env)
    return subprocess.run(
        ["git", *args], cwd=str(cwd), capture_output=True, text=True, env=real_env
    )


def _bash(
    script: Path, *args: str, cwd: Path, env: dict | None = None
) -> subprocess.CompletedProcess:
    real_env = {**os.environ}
    if env:
        real_env.update(env)
    return subprocess.run(
        ["bash", str(script), *args],
        cwd=str(cwd),
        capture_output=True,
        text=True,
        env=real_env,
    )


def _stage(repo: Path, relpath: str, contents: str) -> None:
    full = repo / relpath
    full.parent.mkdir(parents=True, exist_ok=True)
    full.write_text(contents, encoding="utf-8")
    add = _git("add", relpath, cwd=repo)
    assert add.returncode == 0, add.stderr


@pytest.fixture
def synthetic_repo(tmp_path: Path, repo_root: Path) -> Path:
    _copy_assets(repo_root, tmp_path)
    init = _git("init", "-q", "-b", "main", cwd=tmp_path)
    assert init.returncode == 0, init.stderr
    # Override any host-level commit signing so end-to-end commits don't
    # depend on a signing service being reachable from the sandbox.
    _git("config", "--local", "commit.gpgsign", "false", cwd=tmp_path)
    _git("config", "--local", "tag.gpgsign", "false", cwd=tmp_path)
    return tmp_path


# ---------- direct script tests ----------


@pytest.mark.skipif(_NOT_LINUX, reason="bash hook is exercised on Unix-likes")
@pytest.mark.skipif(_NO_GITLEAKS, reason="gitleaks not installed")
def test_secrets_scan_blocks_planted_aws_key(synthetic_repo: Path) -> None:
    _stage(synthetic_repo, "config.txt", _PLANTED_LINE)
    result = _bash(synthetic_repo / "scripts" / "secrets-scan.sh", cwd=synthetic_repo)
    assert result.returncode != 0, (
        "hook should have caught the planted AWS key\n"
        f"stdout: {result.stdout}\nstderr: {result.stderr}"
    )


@pytest.mark.skipif(_NOT_LINUX, reason="bash hook is exercised on Unix-likes")
@pytest.mark.skipif(_NO_GITLEAKS, reason="gitleaks not installed")
def test_secrets_scan_passes_clean_diff(synthetic_repo: Path) -> None:
    _stage(synthetic_repo, "notes.md", "# nothing to see here\nplain prose only.\n")
    result = _bash(synthetic_repo / "scripts" / "secrets-scan.sh", cwd=synthetic_repo)
    assert result.returncode == 0, (
        f"clean diff was rejected\nstdout: {result.stdout}\nstderr: {result.stderr}"
    )


@pytest.mark.skipif(_NOT_LINUX, reason="bash hook is exercised on Unix-likes")
@pytest.mark.skipif(_NO_GITLEAKS, reason="gitleaks not installed")
def test_secrets_scan_respects_allowlisted_test_fixture(synthetic_repo: Path) -> None:
    """A fake-token under an allowlisted path (e2e/admin-reviews-auth.spec.js)
    must not block the commit, otherwise the .gitleaks.toml exemption is
    broken and the admin-reviews auth specs can't be edited."""
    fake = 'const token = "ghp_testaccessTokenForUnitTests1234567890";\n'
    _stage(synthetic_repo, "e2e/admin-reviews-auth.spec.js", fake)
    result = _bash(synthetic_repo / "scripts" / "secrets-scan.sh", cwd=synthetic_repo)
    assert result.returncode == 0, (
        f"allowlisted fixture should have passed\nstdout: {result.stdout}\nstderr: {result.stderr}"
    )


@pytest.mark.skipif(_NOT_LINUX, reason="bash hook is exercised on Unix-likes")
@pytest.mark.skipif(_NO_GITLEAKS, reason="gitleaks not installed")
def test_secrets_scan_skip_env_var_bypasses_check(synthetic_repo: Path) -> None:
    _stage(synthetic_repo, "config.txt", _PLANTED_LINE)
    result = _bash(
        synthetic_repo / "scripts" / "secrets-scan.sh",
        cwd=synthetic_repo,
        env={"SKIP_SECRETS_SCAN": "1"},
    )
    assert result.returncode == 0
    assert "SKIP_SECRETS_SCAN" in (result.stdout + result.stderr)


@pytest.mark.skipif(_NOT_LINUX, reason="bash hook is exercised on Unix-likes")
def test_secrets_scan_fails_clearly_when_gitleaks_missing(synthetic_repo: Path) -> None:
    """Strip gitleaks from PATH; the hook must fail (not silently skip) and
    print install instructions naming the CI-pinned version."""
    _stage(synthetic_repo, "notes.md", "ok\n")
    sterile = synthetic_repo / "_empty_bin"
    sterile.mkdir()
    minimal_path = f"{sterile}:/usr/bin:/bin"
    result = _bash(
        synthetic_repo / "scripts" / "secrets-scan.sh",
        cwd=synthetic_repo,
        env={"PATH": minimal_path},
    )
    assert result.returncode != 0
    combined = (result.stdout + result.stderr).lower()
    assert "gitleaks" in combined
    # Mentions the CI-pinned version so the developer installs the right thing.
    # The version itself is parsed from .github/workflows/secrets-scan.yml at runtime.
    assert "8.30" in combined


# ---------- end-to-end integration via git commit ----------


@pytest.mark.skipif(_NOT_LINUX, reason="hook integration is exercised on Unix-likes")
@pytest.mark.skipif(_NO_GITLEAKS, reason="gitleaks not installed")
def test_pre_commit_chain_blocks_commit_with_secret(synthetic_repo: Path) -> None:
    bootstrap = _bash(synthetic_repo / "scripts" / "bootstrap.sh", cwd=synthetic_repo)
    assert bootstrap.returncode == 0, bootstrap.stderr

    # Initial clean commit must land — proves the hook chain isn't a blanket block.
    _git("add", "-A", cwd=synthetic_repo)
    initial = _git("commit", "-m", "init", cwd=synthetic_repo)
    assert initial.returncode == 0, (
        f"initial commit blocked unexpectedly\nstdout: {initial.stdout}\nstderr: {initial.stderr}"
    )

    _stage(synthetic_repo, "config.txt", _PLANTED_LINE)
    blocked = _git("commit", "-m", "should be blocked", cwd=synthetic_repo)
    assert blocked.returncode != 0, (
        "hook should reject the commit containing a secret\n"
        f"stdout: {blocked.stdout}\nstderr: {blocked.stderr}"
    )


@pytest.mark.skipif(_NOT_LINUX, reason="hook integration is exercised on Unix-likes")
@pytest.mark.skipif(_NO_GITLEAKS, reason="gitleaks not installed")
def test_pre_commit_chain_allows_clean_commit(synthetic_repo: Path) -> None:
    bootstrap = _bash(synthetic_repo / "scripts" / "bootstrap.sh", cwd=synthetic_repo)
    assert bootstrap.returncode == 0

    _git("add", "-A", cwd=synthetic_repo)
    initial = _git("commit", "-m", "init", cwd=synthetic_repo)
    assert initial.returncode == 0

    _stage(synthetic_repo, "notes.md", "# tidy text only\n")
    ok = _git("commit", "-m", "tidy commit", cwd=synthetic_repo)
    assert ok.returncode == 0, f"clean commit should land\nstdout: {ok.stdout}\nstderr: {ok.stderr}"


@pytest.mark.skipif(_NOT_LINUX, reason="git hook list is exercised on Unix-likes")
def test_git_hook_list_shows_secrets_scan(synthetic_repo: Path) -> None:
    """On Git >= 2.54 + 2.45 (for `git hook list`), bootstrap must register
    secrets-scan via the config-based hook system. This is the modern path
    the repo prefers; the .githooks chain is only the < 2.54 fallback."""
    bootstrap = _bash(synthetic_repo / "scripts" / "bootstrap.sh", cwd=synthetic_repo)
    assert bootstrap.returncode == 0

    result = _git("hook", "list", "pre-commit", cwd=synthetic_repo)
    stderr = result.stderr or ""
    if result.returncode != 0 and (
        "is not a git command" in stderr or "unknown subcommand" in stderr
    ):
        pytest.skip(f"git hook list unavailable: {stderr.strip()[:120]}")
    assert result.returncode == 0
    out = result.stdout + result.stderr
    assert "secrets-scan" in out, f"expected secrets-scan in:\n{out}"
