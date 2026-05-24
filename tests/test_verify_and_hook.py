"""Tests for scripts/verify-skills-mirror.sh and the pre-commit hook integration.

The hook integration tests build a synthetic git repository in tmp_path, run
the bootstrap to register the hook, then attempt to commit a corrupted state
and assert the commit is rejected.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

_NOT_LINUX = sys.platform == "win32"


def _copy_assets(repo_root: Path, dest: Path) -> None:
    src_scripts = repo_root / "scripts"
    (dest / "scripts").mkdir(parents=True, exist_ok=True)
    # Every script the pre-commit chain invokes must be present, or the
    # hook aborts before its guard even runs. Keep this list in sync with
    # .githooks/pre-commit (skills-mirror, secrets-scan, lint-staged).
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


def _make_skill(skills_root: Path, name: str) -> None:
    (skills_root / name).mkdir(parents=True, exist_ok=True)
    (skills_root / name / "SKILL.md").write_text(
        f"---\nname: {name}\ndescription: x\n---\n", encoding="utf-8"
    )


def _git(*args: str, cwd: Path, env: dict | None = None) -> subprocess.CompletedProcess:
    real_env = {
        **os.environ,
        "GIT_AUTHOR_NAME": "Test",
        "GIT_AUTHOR_EMAIL": "t@example.com",
        "GIT_COMMITTER_NAME": "Test",
        "GIT_COMMITTER_EMAIL": "t@example.com",
        # These tests exercise the skills-mirror hook in isolation. The
        # secrets-scan hook is also registered by bootstrap; short-circuit
        # it so this file isn't gated on gitleaks being installed.
        "SKIP_SECRETS_SCAN": "1",
    }
    if env:
        real_env.update(env)
    return subprocess.run(
        ["git", *args], cwd=str(cwd), capture_output=True, text=True, env=real_env
    )


def _bash(script: Path, *args: str, cwd: Path) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["bash", str(script), *args], cwd=str(cwd), capture_output=True, text=True
    )


@pytest.fixture
def synthetic_git_repo(tmp_path: Path, repo_root: Path) -> Path:
    """A throwaway git repo with bootstrap + verify available, no commits yet."""
    _copy_assets(repo_root, tmp_path)
    init = _git("init", "-q", "-b", "main", cwd=tmp_path)
    assert init.returncode == 0, init.stderr
    # Override any host-level commit signing so commits in these tests don't
    # depend on a signing service being reachable.
    _git("config", "--local", "commit.gpgsign", "false", cwd=tmp_path)
    _git("config", "--local", "tag.gpgsign", "false", cwd=tmp_path)
    return tmp_path


@pytest.mark.skipif(_NOT_LINUX, reason="bash verify is for Unix-likes")
def test_verify_fails_when_mirror_is_a_real_directory(synthetic_git_repo: Path) -> None:
    _make_skill(synthetic_git_repo / ".agents" / "skills", "demo")
    real_mirror = synthetic_git_repo / ".claude" / "skills"
    real_mirror.mkdir(parents=True)
    (real_mirror / "demo").mkdir()
    (real_mirror / "demo" / "SKILL.md").write_text("---\nname: demo\n---\n", encoding="utf-8")

    result = _bash(
        synthetic_git_repo / "scripts" / "verify-skills-mirror.sh", cwd=synthetic_git_repo
    )
    assert result.returncode != 0
    assert "regular directory" in (result.stdout + result.stderr)


@pytest.mark.skipif(_NOT_LINUX, reason="bash verify is for Unix-likes")
def test_verify_fails_when_mirror_missing(synthetic_git_repo: Path) -> None:
    _make_skill(synthetic_git_repo / ".agents" / "skills", "demo")

    result = _bash(
        synthetic_git_repo / "scripts" / "verify-skills-mirror.sh", cwd=synthetic_git_repo
    )
    assert result.returncode != 0


@pytest.mark.skipif(_NOT_LINUX, reason="bash verify is for Unix-likes")
def test_verify_passes_after_bootstrap(synthetic_git_repo: Path) -> None:
    _make_skill(synthetic_git_repo / ".agents" / "skills", "demo")

    bootstrap = _bash(synthetic_git_repo / "scripts" / "bootstrap.sh", cwd=synthetic_git_repo)
    assert bootstrap.returncode == 0

    result = _bash(
        synthetic_git_repo / "scripts" / "verify-skills-mirror.sh", cwd=synthetic_git_repo
    )
    assert result.returncode == 0


@pytest.mark.skipif(_NOT_LINUX, reason="bash verify is for Unix-likes")
def test_verify_staged_rejects_real_file_under_mirror(synthetic_git_repo: Path) -> None:
    _make_skill(synthetic_git_repo / ".agents" / "skills", "demo")
    _bash(synthetic_git_repo / "scripts" / "bootstrap.sh", cwd=synthetic_git_repo)

    # Manually stage a regular file at .claude/skills/oops.md by removing the
    # symlink, creating a real directory, dropping a file in, and `git add`-ing.
    mirror = synthetic_git_repo / ".claude" / "skills"
    mirror.unlink()
    mirror.mkdir()
    (mirror / "oops.md").write_text("clobber\n", encoding="utf-8")

    add = _git("add", ".claude/skills/oops.md", cwd=synthetic_git_repo)
    assert add.returncode == 0, add.stderr

    result = _bash(
        synthetic_git_repo / "scripts" / "verify-skills-mirror.sh",
        "--staged",
        cwd=synthetic_git_repo,
    )
    assert result.returncode != 0
    combined = result.stdout + result.stderr
    assert "oops.md" in combined or "regular files" in combined


@pytest.mark.skipif(_NOT_LINUX, reason="hook integration is exercised on Unix-likes")
def test_pre_commit_hook_blocks_corrupted_commit(synthetic_git_repo: Path) -> None:
    """End-to-end: with the hook registered, attempting to commit a real file
    under .claude/skills/ should fail."""
    _make_skill(synthetic_git_repo / ".agents" / "skills", "demo")

    bootstrap = _bash(synthetic_git_repo / "scripts" / "bootstrap.sh", cwd=synthetic_git_repo)
    assert bootstrap.returncode == 0, f"bootstrap failed:\n{bootstrap.stderr}"

    # Commit the initial state cleanly first to prove the hook lets good commits through.
    _git("add", "-A", cwd=synthetic_git_repo)
    initial = _git("commit", "-m", "init", cwd=synthetic_git_repo)
    assert initial.returncode == 0, (
        f"initial commit blocked unexpectedly:\n{initial.stderr}\n{initial.stdout}"
    )

    # Now corrupt: replace the symlink with a real directory + a real file, stage, try to commit.
    mirror = synthetic_git_repo / ".claude" / "skills"
    if mirror.is_symlink():
        mirror.unlink()
    mirror.mkdir(exist_ok=True)
    (mirror / "leak.md").write_text("clobber\n", encoding="utf-8")

    _git("add", ".claude/skills/leak.md", cwd=synthetic_git_repo)
    blocked = _git("commit", "-m", "should be blocked", cwd=synthetic_git_repo)
    assert blocked.returncode != 0, (
        f"hook should reject the bad commit, but it succeeded:\n{blocked.stdout}\n{blocked.stderr}"
    )


@pytest.mark.skipif(_NOT_LINUX, reason="git hook list is exercised on Unix-likes")
def test_git_hook_list_shows_skills_mirror_check(synthetic_git_repo: Path) -> None:
    """Acceptance criterion: `git hook list pre-commit` lists skills-mirror-check
    in the local scope after bootstrap."""
    _make_skill(synthetic_git_repo / ".agents" / "skills", "demo")
    bootstrap = _bash(synthetic_git_repo / "scripts" / "bootstrap.sh", cwd=synthetic_git_repo)
    assert bootstrap.returncode == 0

    result = _git("hook", "list", "pre-commit", cwd=synthetic_git_repo)
    # `git hook list` landed in Git 2.45; older Gits return "is not a git
    # command" (no `git hook` at all) or "unknown subcommand: \`list'"
    # (`git hook run` exists, list does not). Skip in both cases.
    stderr = result.stderr or ""
    if result.returncode != 0 and (
        "is not a git command" in stderr or "unknown subcommand" in stderr
    ):
        pytest.skip(f"git hook list not available on this git version: {stderr.strip()[:120]}")
    assert result.returncode == 0
    out = result.stdout + result.stderr
    assert "skills-mirror-check" in out, f"expected skills-mirror-check in:\n{out}"
