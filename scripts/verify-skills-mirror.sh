#!/usr/bin/env bash
# Verify that .claude/skills is a link pointing at .agents/skills, and
# (optionally, with --staged) that the staged diff contains no new regular
# files under .claude/skills/. Exits non-zero with a human-readable message
# on any failure.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

STAGED=0
if [[ "${1:-}" == "--staged" ]]; then
  STAGED=1
fi

errors=0

if [[ ! -e .claude/skills ]]; then
  echo "FAIL: .claude/skills does not exist" >&2
  errors=$((errors + 1))
elif [[ ! -L .claude/skills ]]; then
  echo "FAIL: .claude/skills is a regular directory, not a symlink/junction." >&2
  echo "      Run scripts/bootstrap.sh to repair." >&2
  errors=$((errors + 1))
else
  actual="$(cd .claude/skills 2>/dev/null && pwd -P || true)"
  expected="$(cd .agents/skills 2>/dev/null && pwd -P || true)"
  if [[ -z "$actual" || -z "$expected" || "$actual" != "$expected" ]]; then
    echo "FAIL: .claude/skills does not resolve to .agents/skills" >&2
    echo "      actual:   ${actual:-<unresolved>}" >&2
    echo "      expected: ${expected:-<unresolved>}" >&2
    errors=$((errors + 1))
  fi
fi

if [[ ! -d .agents/skills ]]; then
  echo "FAIL: .agents/skills does not exist" >&2
  errors=$((errors + 1))
else
  if ! find .agents/skills -mindepth 2 -maxdepth 2 -name SKILL.md -print -quit 2>/dev/null | grep -q .; then
    echo "FAIL: .agents/skills contains no */SKILL.md" >&2
    errors=$((errors + 1))
  fi
fi

if ((STAGED)); then
  if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    # Staged additions/modifications under .claude/skills/ that are *regular files*
    # are forbidden — that's what "mirror replaced by copy" looks like.
    bad="$(git diff --cached --name-status -- '.claude/skills/' 2>/dev/null \
      | awk '$1 ~ /^[AM]/ {print $2}' \
      | while read -r f; do
        mode="$(git ls-files --stage -- "$f" 2>/dev/null | awk '{print $1}')"
        if [[ "$mode" == "100644" || "$mode" == "100755" ]]; then
          echo "$f"
        fi
      done)"
    if [[ -n "$bad" ]]; then
      echo "FAIL: staged regular files under .claude/skills/. Edit .agents/skills/ instead:" >&2
      echo "$bad" | sed 's/^/  /' >&2
      errors=$((errors + 1))
    fi
  fi
fi

if ((errors > 0)); then
  echo "skills mirror verification failed ($errors error(s))" >&2
  exit 1
fi

echo "skills mirror OK"
