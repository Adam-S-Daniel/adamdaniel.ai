"""Structural tests for the .claude/skills → .agents/skills mirror."""
from __future__ import annotations

from pathlib import Path


def test_agents_skills_exists(repo_root: Path) -> None:
    agents = repo_root / ".agents" / "skills"
    assert agents.is_dir(), f"{agents} must exist as the canonical skills home"


def test_claude_skills_is_a_link(repo_root: Path) -> None:
    mirror = repo_root / ".claude" / "skills"
    assert mirror.exists(), f"{mirror} must exist (as a symlink or junction)"
    assert mirror.is_symlink() or _is_windows_junction(mirror), (
        f"{mirror} must be a symlink (Unix) or junction (Windows), "
        "not a regular directory"
    )


def test_claude_skills_resolves_to_agents_skills(repo_root: Path) -> None:
    mirror = repo_root / ".claude" / "skills"
    canonical = (repo_root / ".agents" / "skills").resolve()
    assert mirror.resolve() == canonical, (
        f"{mirror} must resolve to {canonical}, "
        f"got {mirror.resolve()}"
    )


def test_canary_skill_present(repo_root: Path, canary_skill_name: str) -> None:
    direct = repo_root / ".agents" / "skills" / canary_skill_name / "SKILL.md"
    assert direct.is_file(), f"canary skill {direct} must exist"


def test_canary_skill_readable_through_mirror(
    repo_root: Path, canary_skill_name: str
) -> None:
    mirrored = repo_root / ".claude" / "skills" / canary_skill_name / "SKILL.md"
    direct = repo_root / ".agents" / "skills" / canary_skill_name / "SKILL.md"
    assert mirrored.is_file(), f"canary skill not reachable via mirror at {mirrored}"
    assert mirrored.read_text(encoding="utf-8") == direct.read_text(encoding="utf-8")
    assert mirrored.resolve() == direct.resolve()


def test_at_least_one_skill_present(repo_root: Path) -> None:
    skill_files = list((repo_root / ".agents" / "skills").glob("*/SKILL.md"))
    assert skill_files, ".agents/skills must contain at least one <name>/SKILL.md"


def _is_windows_junction(path: Path) -> bool:
    """Junctions on Windows aren't symlinks but reparse points; treat them as links."""
    import os
    import sys

    if sys.platform != "win32":
        return False
    try:
        attrs = os.stat(path, follow_symlinks=False).st_file_attributes  # type: ignore[attr-defined]
    except (AttributeError, OSError):
        return False
    FILE_ATTRIBUTE_REPARSE_POINT = 0x400
    return bool(attrs & FILE_ATTRIBUTE_REPARSE_POINT)
