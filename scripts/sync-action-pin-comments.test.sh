#!/usr/bin/env bash
#
# Unit tests for sync-action-pin-comments.sh.
#
# Strategy: stub `gh` via a path-shadowing wrapper that returns
# canned JSON for known (repo, endpoint) pairs, drive the script
# against a fixture workflow file, and assert byte-for-byte on the
# output (and on `--check` exit code + stdout).
#
# Pure bash — no Node, no Python, no bats. Wired into e2e-tests.yml
# unit job alongside the Ruby plugin tests.
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT="${REPO_ROOT}/scripts/sync-action-pin-comments.sh"
TMPROOT="$(mktemp -d)"
trap 'rm -rf "$TMPROOT"' EXIT

PASS=0
FAIL=0

# ANSI off if not a tty.
if [[ -t 1 ]]; then
  GREEN=$'\e[32m'; RED=$'\e[31m'; RESET=$'\e[0m'
else
  GREEN=""; RED=""; RESET=""
fi

assert_eq() {
  local label="$1" want="$2" got="$3"
  if [[ "$want" == "$got" ]]; then
    echo "${GREEN}PASS${RESET} $label"
    PASS=$((PASS + 1))
  else
    echo "${RED}FAIL${RESET} $label"
    diff <(printf '%s' "$want") <(printf '%s' "$got") || true
    FAIL=$((FAIL + 1))
  fi
}

assert_file_eq() {
  local label="$1" want_file="$2" got_file="$3"
  if cmp -s "$want_file" "$got_file"; then
    echo "${GREEN}PASS${RESET} $label"
    PASS=$((PASS + 1))
  else
    echo "${RED}FAIL${RESET} $label"
    diff "$want_file" "$got_file" || true
    FAIL=$((FAIL + 1))
  fi
}

# ---------- Build a fake `gh` ----------
# The fake is a single bash script that pattern-matches on its argv.
# Each test seeds canned responses by writing files under
# $GH_FIXTURE_DIR — the fake script reads them. This keeps test data
# obvious in-tree.
FAKE_GH_DIR="${TMPROOT}/fake-bin"
mkdir -p "$FAKE_GH_DIR"
cat >"${FAKE_GH_DIR}/gh" <<'GH'
#!/usr/bin/env bash
# Minimal mock of `gh api`. Reads canned JSON from $GH_FIXTURE_DIR.
set -uo pipefail
if [[ "${1:-}" != "api" ]]; then
  echo "fake-gh: unsupported subcommand: $*" >&2
  exit 2
fi
shift
endpoint="$1"; shift
# Drop --paginate — we serve everything at once.
args=()
jq_filter=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --paginate) shift ;;
    --jq) jq_filter="$2"; shift 2 ;;
    *) args+=("$1"); shift ;;
  esac
done
# Endpoint -> filename. Sanitise slashes to underscores.
fname="$(printf '%s' "$endpoint" | tr '/' '_')"
path="${GH_FIXTURE_DIR}/${fname}.json"
if [[ ! -f "$path" ]]; then
  echo "fake-gh: no fixture for endpoint $endpoint at $path" >&2
  exit 22
fi
if [[ -n "$jq_filter" ]]; then
  jq -r "$jq_filter" <"$path"
else
  cat "$path"
fi
GH
chmod +x "${FAKE_GH_DIR}/gh"

# ---------- Fixture data ----------
# Pretend repo "fake/action" has these tags:
#   v1.0.0      -> sha A
#   v1.1.0      -> sha B
#   v2.0.0      -> sha C
#   v2 (alias)  -> sha C
#   v2.0.1      -> sha D
#   v2 (alias)  -> sha D   (overlapping major alias; tested below)
#
# We exercise:
#   1. STALE  comment: SHA C, comment says "v1.1.0 (2025-01-01)" ->
#      should rewrite to "v2.0.0 (2026-04-10)".
#   2. CURRENT comment: SHA D, comment already says
#      "v2.0.1 (2026-04-15)" -> idempotent, no rewrite.
#   3. UNKNOWN SHA E (no tag): rewrites comment to "(no tag found)".
#   4. Multi-tag SHA C tagged both "v2" and "v2.0.0" -> picks v2.0.0
#      (more specific).

GH_FIXTURE_DIR="${TMPROOT}/gh-fixtures"
mkdir -p "$GH_FIXTURE_DIR"

# matching-refs/tags response.
cat >"${GH_FIXTURE_DIR}/repos_fake_action_git_matching-refs_tags.json" <<'JSON'
[
  {"ref":"refs/tags/v1.0.0","object":{"sha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","type":"commit"}},
  {"ref":"refs/tags/v1.1.0","object":{"sha":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","type":"commit"}},
  {"ref":"refs/tags/v2","object":{"sha":"dddddddddddddddddddddddddddddddddddddddd","type":"commit"}},
  {"ref":"refs/tags/v2.0.0","object":{"sha":"cccccccccccccccccccccccccccccccccccccccc","type":"commit"}},
  {"ref":"refs/tags/v2.0.1","object":{"sha":"dddddddddddddddddddddddddddddddddddddddd","type":"commit"}}
]
JSON

# Per-commit committer.date responses.
cat >"${GH_FIXTURE_DIR}/repos_fake_action_git_commits_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.json" <<'JSON'
{"author":{"date":"2025-01-01T00:00:00Z"},"committer":{"date":"2025-01-01T00:00:00Z"}}
JSON
cat >"${GH_FIXTURE_DIR}/repos_fake_action_git_commits_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.json" <<'JSON'
{"author":{"date":"2025-06-15T12:00:00Z"},"committer":{"date":"2025-06-15T12:30:00Z"}}
JSON
cat >"${GH_FIXTURE_DIR}/repos_fake_action_git_commits_cccccccccccccccccccccccccccccccccccccccc.json" <<'JSON'
{"author":{"date":"2026-04-10T08:00:00Z"},"committer":{"date":"2026-04-10T08:00:00Z"}}
JSON
cat >"${GH_FIXTURE_DIR}/repos_fake_action_git_commits_dddddddddddddddddddddddddddddddddddddddd.json" <<'JSON'
{"author":{"date":"2026-04-15T22:15:48Z"},"committer":{"date":"2026-04-15T22:18:50Z"}}
JSON
# SHA E — no tag points at it, but commit exists. Script shouldn't even
# call this endpoint for the no-tag case (per the script's design),
# but we provide a fixture defensively.
cat >"${GH_FIXTURE_DIR}/repos_fake_action_git_commits_eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee.json" <<'JSON'
{"author":{"date":"2026-04-20T00:00:00Z"},"committer":{"date":"2026-04-20T00:00:00Z"}}
JSON

export GH_FIXTURE_DIR
export PATH="${FAKE_GH_DIR}:$PATH"

# ---------- Build fixture workflow ----------
WORKFLOWS_DIR="${TMPROOT}/wf"
mkdir -p "$WORKFLOWS_DIR"
FIXTURE_BEFORE="${WORKFLOWS_DIR}/test.yml"
cat >"$FIXTURE_BEFORE" <<'YAML'
name: test
on: [push]
jobs:
  one:
    runs-on: ubuntu-latest
    steps:
      # 1) STALE — bumped SHA, untouched comment.
      - uses: fake/action@cccccccccccccccccccccccccccccccccccccccc  # v1.1.0 (2025-01-01)
      # 2) CURRENT — should be idempotent.
      - uses: fake/action@dddddddddddddddddddddddddddddddddddddddd  # v2.0.1 (2026-04-15)
      # 3) UNKNOWN SHA — no tag points at it.
      - uses: fake/action@eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee  # v0.0.0 (1999-01-01)
      # 4) ALREADY (no tag found) — idempotent for the no-tag case too.
      - uses: fake/action@eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee  # (no tag found)
      # 5) Comment-less — should grow a comment with two-space gap.
      - uses: fake/action@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
YAML

EXPECTED_AFTER="${TMPROOT}/expected.yml"
cat >"$EXPECTED_AFTER" <<'YAML'
name: test
on: [push]
jobs:
  one:
    runs-on: ubuntu-latest
    steps:
      # 1) STALE — bumped SHA, untouched comment.
      - uses: fake/action@cccccccccccccccccccccccccccccccccccccccc  # v2.0.0 (2026-04-10)
      # 2) CURRENT — should be idempotent.
      - uses: fake/action@dddddddddddddddddddddddddddddddddddddddd  # v2.0.1 (2026-04-15)
      # 3) UNKNOWN SHA — no tag points at it.
      - uses: fake/action@eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee  # (no tag found)
      # 4) ALREADY (no tag found) — idempotent for the no-tag case too.
      - uses: fake/action@eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee  # (no tag found)
      # 5) Comment-less — should grow a comment with two-space gap.
      - uses: fake/action@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa  # v1.0.0 (2025-01-01)
YAML

# ---------- Test 1: --check on stale fixture exits non-zero, no write ----------
ORIG_HASH=$(sha256sum "$FIXTURE_BEFORE" | awk '{print $1}')
set +e
CHECK_OUT="$(bash "$SCRIPT" --check --workflows-dir "$WORKFLOWS_DIR" 2>/dev/null)"
CHECK_RC=$?
set -e
NEW_HASH=$(sha256sum "$FIXTURE_BEFORE" | awk '{print $1}')

assert_eq "test1: --check exit code is 1 when changes pending" "1" "$CHECK_RC"
assert_eq "test1: --check does not modify file" "$ORIG_HASH" "$NEW_HASH"
case "$CHECK_OUT" in
  *"would update"*)
    echo "${GREEN}PASS${RESET} test1: --check stdout mentions pending updates"
    PASS=$((PASS + 1)) ;;
  *)
    echo "${RED}FAIL${RESET} test1: --check stdout missing 'would update'"
    echo "stdout: $CHECK_OUT"
    FAIL=$((FAIL + 1)) ;;
esac

# ---------- Test 2: real run rewrites stale + comment-less, leaves rest ----------
bash "$SCRIPT" --workflows-dir "$WORKFLOWS_DIR" >/dev/null
assert_file_eq "test2: real run produces expected output" "$EXPECTED_AFTER" "$FIXTURE_BEFORE"

# ---------- Test 3: idempotent re-run is a no-op ----------
HASH_BEFORE_RERUN=$(sha256sum "$FIXTURE_BEFORE" | awk '{print $1}')
set +e
RERUN_OUT="$(bash "$SCRIPT" --workflows-dir "$WORKFLOWS_DIR" 2>/dev/null)"
RERUN_RC=$?
set -e
HASH_AFTER_RERUN=$(sha256sum "$FIXTURE_BEFORE" | awk '{print $1}')
assert_eq "test3: re-run exit 0" "0" "$RERUN_RC"
assert_eq "test3: re-run no diff" "$HASH_BEFORE_RERUN" "$HASH_AFTER_RERUN"
case "$RERUN_OUT" in
  *"no changes"*)
    echo "${GREEN}PASS${RESET} test3: re-run stdout says 'no changes'"
    PASS=$((PASS + 1)) ;;
  *)
    echo "${RED}FAIL${RESET} test3: re-run stdout missing 'no changes'"
    echo "stdout: $RERUN_OUT"
    FAIL=$((FAIL + 1)) ;;
esac

# ---------- Test 4: --check on already-clean tree exits 0 ----------
set +e
CHECK2_OUT="$(bash "$SCRIPT" --check --workflows-dir "$WORKFLOWS_DIR" 2>/dev/null)"
CHECK2_RC=$?
set -e
assert_eq "test4: --check on clean tree exits 0" "0" "$CHECK2_RC"
case "$CHECK2_OUT" in
  *"no changes"*)
    echo "${GREEN}PASS${RESET} test4: --check on clean tree says 'no changes'"
    PASS=$((PASS + 1)) ;;
  *)
    echo "${RED}FAIL${RESET} test4: --check on clean tree missing 'no changes'"
    FAIL=$((FAIL + 1)) ;;
esac

# ---------- Test 5: no-tag fallback is also idempotent ----------
# Already covered by case (4) in the fixture, but assert explicitly that
# the (no tag found) line is preserved verbatim.
NO_TAG_LINE="$(grep -F '(no tag found)' "$FIXTURE_BEFORE" | head -1)"
case "$NO_TAG_LINE" in
  *"# (no tag found)")
    echo "${GREEN}PASS${RESET} test5: (no tag found) marker preserved"
    PASS=$((PASS + 1)) ;;
  *)
    echo "${RED}FAIL${RESET} test5: (no tag found) marker missing or malformed"
    echo "got: $NO_TAG_LINE"
    FAIL=$((FAIL + 1)) ;;
esac

# ---------- Summary ----------
echo
echo "sync-action-pin-comments tests: ${PASS} passed, ${FAIL} failed"
if [[ "$FAIL" -gt 0 ]]; then
  exit 1
fi
exit 0
