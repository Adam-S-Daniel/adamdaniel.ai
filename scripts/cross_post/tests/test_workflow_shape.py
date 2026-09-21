"""Shape tests for the cross-post workflows.

These parse the real workflow YAML with `yaml.safe_load` (never a
regex/line-scanner — see AGENTS.md "Parse structured formats with a real
parser") and assert the structural contract that
`.github/workflows/cross-post.yml` and `.github/workflows/cross-post-tests.yml`
must hold: trigger shape, dispatch inputs, minimal permissions, concurrency,
pinned `uses:` refs, no unsafe `${{ }}` interpolation into `run:` blocks, and
that the Mastodon token only ever travels through one step's `env:`.

PyYAML resolves the bare mapping key `on` to the boolean `True` (YAML 1.1
scalar resolution), not the string `"on"` — every lookup below uses
`data[True]` to account for that.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

import pytest
import yaml

REPO_ROOT = Path(__file__).resolve().parents[3]
WORKFLOWS_DIR = REPO_ROOT / ".github" / "workflows"
CROSS_POST_YML = WORKFLOWS_DIR / "cross-post.yml"
CROSS_POST_TESTS_YML = WORKFLOWS_DIR / "cross-post-tests.yml"
PLATFORM_LOCK = REPO_ROOT / "platform.lock"

FULL_SHA_RE = re.compile(r"^[0-9a-f]{40}$")
CMS_PLATFORM_PREFIX = "Adam-S-Daniel/cms-platform/"


def _load_yaml(path: Path) -> dict[str, Any]:
    assert path.is_file(), f"missing workflow file: {path}"
    with path.open(encoding="utf-8") as fh:
        data = yaml.safe_load(fh)
    assert isinstance(data, dict)
    return data


def _raw_lines(path: Path) -> list[str]:
    return path.read_text(encoding="utf-8").splitlines()


def _platform_ref() -> str:
    assert PLATFORM_LOCK.is_file(), f"missing {PLATFORM_LOCK}"
    with PLATFORM_LOCK.open(encoding="utf-8") as fh:
        lock = yaml.safe_load(fh)
    return lock["platform_ref"]


def _uses_entries(lines: list[str]) -> list[tuple[str, str]]:
    """Return (raw_line, uses_value) for every `uses:` line in the file."""
    entries = []
    for line in lines:
        stripped = line.strip()
        if stripped.startswith("uses:"):
            value = stripped[len("uses:") :].strip()
            entries.append((line, value))
    return entries


def _iter_steps(data: dict[str, Any]):
    for job in data["jobs"].values():
        for step in job.get("steps", []) or []:
            yield step


class TestCrossPostWorkflow:
    @pytest.fixture(autouse=True)
    def _setup(self):
        self.data = _load_yaml(CROSS_POST_YML)
        self.lines = _raw_lines(CROSS_POST_YML)

    def test_push_trigger_branches_main_only(self):
        push = self.data[True]["push"]
        assert push["branches"] == ["main"]

    def test_push_paths_include_posts_glob_and_fixture_negations(self):
        paths = self.data[True]["push"]["paths"]
        assert "_posts/**" in paths
        assert "!_posts/2099-*" in paths
        assert "!_posts/*-e2e-*" in paths

    def test_workflow_dispatch_post_path_input(self):
        inputs = self.data[True]["workflow_dispatch"]["inputs"]
        post_path = inputs["post_path"]
        assert post_path["type"] == "string"
        assert post_path["required"] is True

    def test_workflow_dispatch_dry_run_input(self):
        inputs = self.data[True]["workflow_dispatch"]["inputs"]
        dry_run = inputs["dry_run"]
        assert dry_run["type"] == "boolean"
        assert dry_run["default"] is True

    def test_workflow_dispatch_visibility_input(self):
        inputs = self.data[True]["workflow_dispatch"]["inputs"]
        visibility = inputs["visibility"]
        assert visibility["type"] == "choice"
        assert visibility["options"] == ["public", "unlisted", "direct"]
        assert visibility["default"] == "public"

    def test_permissions_minimal_contents_read(self):
        assert self.data["permissions"] == {"contents": "read"}

    def test_concurrency_group_and_no_cancel(self):
        concurrency = self.data["concurrency"]
        assert concurrency["group"] == "cross-post"
        assert concurrency["cancel-in-progress"] is False

    def test_third_party_uses_pinned_to_full_sha_no_trailing_comment(self):
        entries = _uses_entries(self.lines)
        assert entries, "expected at least one `uses:` step"
        for raw_line, value in entries:
            if value.startswith(CMS_PLATFORM_PREFIX):
                continue
            if value.startswith("./"):
                # A local-path composite (e.g. the checked-out platform's
                # await-prod-deploy) has no `@ref` of its own — it's pinned by
                # the `actions/checkout` step that placed it on disk instead.
                continue
            assert "@" in value, f"uses line missing @ref: {value}"
            ref = value.rsplit("@", 1)[-1]
            assert FULL_SHA_RE.match(ref), f"uses ref is not a full 40-char sha: {value}"
            # Lexical check on the raw line: no trailing `#comment` after the pin.
            after_at = raw_line.split("@", 1)[-1]
            assert "#" not in after_at, f"trailing comment on uses line: {raw_line!r}"

    def test_no_remote_cms_platform_composite_reference(self):
        # A remote `Adam-S-Daniel/cms-platform/.github/actions/...@<ref>` is
        # rejected at job setup by this repo's SHA-pinning policy when <ref>
        # is a tag, and a SHA there would fail the platform pin-consistency
        # guard (every cms-platform ref must equal platform.lock's
        # platform_ref, which is a tag, not a sha). The composite must be
        # invoked by local path instead, after checking the platform out.
        entries = _uses_entries(self.lines)
        remote_composite_entries = [
            value for _, value in entries if value.startswith(f"{CMS_PLATFORM_PREFIX}.github/actions/")
        ]
        assert not remote_composite_entries, (
            "found remote cms-platform composite reference(s), expected local-path "
            f"invocation instead: {remote_composite_entries}"
        )

    def test_platform_checkout_pinned_to_platform_lock_ref(self):
        platform_ref = _platform_ref()
        checkout_steps = [
            step
            for step in _iter_steps(self.data)
            if str(step.get("uses", "")).startswith("actions/checkout@")
            and (step.get("with") or {}).get("repository") == "Adam-S-Daniel/cms-platform"
        ]
        assert len(checkout_steps) == 1, (
            f"expected exactly one actions/checkout step for Adam-S-Daniel/cms-platform, "
            f"found {len(checkout_steps)}"
        )
        with_block = checkout_steps[0]["with"]
        assert with_block["ref"] == platform_ref, (
            f"platform checkout ref {with_block.get('ref')!r} does not match "
            f"platform.lock's platform_ref ({platform_ref})"
        )
        assert with_block["path"] == ".cms-platform"

        await_steps = [
            step
            for step in _iter_steps(self.data)
            if "await-prod-deploy" in str(step.get("uses", ""))
        ]
        assert len(await_steps) == 1, (
            f"expected exactly one await-prod-deploy step, found {len(await_steps)}"
        )
        assert await_steps[0]["uses"] == "./.cms-platform/.github/actions/await-prod-deploy"

    def test_no_inline_expression_interpolation_in_run_blocks(self):
        for step in _iter_steps(self.data):
            run = step.get("run")
            if not run:
                continue
            assert "${{ inputs." not in run, f"run: block interpolates inputs directly: {run!r}"
            assert "${{ github.event." not in run, (
                f"run: block interpolates github.event directly: {run!r}"
            )

    def test_mastodon_token_referenced_exactly_once_and_only_under_env(self):
        steps_referencing_secret = []
        for step in _iter_steps(self.data):
            run = step.get("run") or ""
            with_block = step.get("with") or {}
            env_block = step.get("env") or {}
            in_run = "secrets.MASTODON_ACCESS_TOKEN" in run
            in_with = any(
                "secrets.MASTODON_ACCESS_TOKEN" in str(v) for v in with_block.values()
            )
            in_env = any(
                "secrets.MASTODON_ACCESS_TOKEN" in str(v) for v in env_block.values()
            )
            if in_run or in_with or in_env:
                steps_referencing_secret.append((step, in_run, in_with, in_env))

        assert len(steps_referencing_secret) == 1, (
            "expected exactly one step referencing secrets.MASTODON_ACCESS_TOKEN, "
            f"found {len(steps_referencing_secret)}"
        )
        _, in_run, in_with, in_env = steps_referencing_secret[0]
        assert in_env is True
        assert in_run is False
        assert in_with is False


class TestCrossPostTestsWorkflow:
    @pytest.fixture(autouse=True)
    def _setup(self):
        self.data = _load_yaml(CROSS_POST_TESTS_YML)

    def test_pull_request_trigger_types_and_paths(self):
        pr = self.data[True]["pull_request"]
        assert set(pr["types"]) == {"opened", "synchronize", "reopened"}
        paths = pr["paths"]
        assert "scripts/cross_post/**" in paths
        assert ".github/workflows/cross-post.yml" in paths
        assert ".github/workflows/cross-post-tests.yml" in paths

    def test_workflow_dispatch_present(self):
        assert "workflow_dispatch" in self.data[True]

    def test_permissions_minimal_contents_read(self):
        assert self.data["permissions"] == {"contents": "read"}

    def test_pinned_pip_install_pytest_and_pyyaml(self):
        pip_install_runs = [
            step.get("run", "")
            for step in _iter_steps(self.data)
            if "pip install" in (step.get("run") or "")
        ]
        assert pip_install_runs, "expected a pip install step"
        run = pip_install_runs[0]
        assert re.search(r"pytest==\d", run), f"pytest not pinned with ==: {run!r}"
        pyyaml_pin = re.search(r"[Pp][Yy][Yy][Aa][Mm][Ll]==\d", run)
        assert pyyaml_pin, f"pyyaml not pinned with ==: {run!r}"
