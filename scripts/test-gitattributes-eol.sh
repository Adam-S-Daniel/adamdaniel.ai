#!/usr/bin/env bash
# Regression test for .gitattributes (issue #4085): text files must be LF in the
# index AND the working tree even when the checking-out machine has
# core.autocrlf=true (the Windows default), or Jekyll's "\n\n" excerpt separator
# and bash scripts break.
#
#   bash scripts/test-gitattributes-eol.sh
#
# Deterministic and offline: it works in a throwaway `git init` repo under a temp
# dir (no remote) and never touches this checkout's index or working tree.
# Includes a negative control: with no attributes file the same CRLF input must
# come out CRLF, proving the check can fail. No CI lane runs it (like
# test-bootstrap-deploy-wrapper.sh); run it whenever .gitattributes changes.
# Exit 0 only when every case passes.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ATTRS="$ROOT/.gitattributes"
[[ -f "$ATTRS" ]] || { echo "FAIL: $ATTRS is missing" >&2; exit 1; }

SCRATCH="$(mktemp -d)"
trap 'rm -rf "$SCRATCH"' EXIT

fails=0
pass() { echo "ok   - $1"; }
fail() { echo "FAIL - $1" >&2; fails=$((fails + 1)); }

# Prints "yes" when the working-tree copy of a file written with CRLF (and then
# added and re-checked-out under core.autocrlf=true) still contains a CR.
checkout_has_cr() { # <repo dir> <file>
  local repo="$1" file="$2"
  printf 'one\r\n\r\ntwo\r\n' >"$repo/$file"
  git -C "$repo" add "$file"
  rm "$repo/$file"
  git -C "$repo" checkout-index -f -- "$file"
  # (tr, not grep: Git for Windows' grep does not match a bare CR)
  if [[ "$(tr -cd '\r' <"$repo/$file" | wc -c)" -gt 0 ]]; then echo yes; else echo no; fi
}

new_repo() { # <name> -> path
  local d="$SCRATCH/$1"
  git init -q "$d"
  git -C "$d" config core.autocrlf true
  git -C "$d" config user.name test
  git -C "$d" config user.email test@example.com
  echo "$d"
}

# Positive: with the real .gitattributes, CRLF input is LF on checkout.
with="$(new_repo with)"
cp "$ATTRS" "$with/.gitattributes"
[[ "$(checkout_has_cr "$with" post.md)" == no ]] \
  && pass "markdown is LF in the working tree under core.autocrlf=true" \
  || fail "markdown kept CRLF under core.autocrlf=true"
[[ "$(checkout_has_cr "$with" deploy.sh)" == no ]] \
  && pass "shell script is LF in the working tree under core.autocrlf=true" \
  || fail "shell script kept CRLF under core.autocrlf=true"

# Binary types are never treated as text.
for f in a.png b.jpeg c.webp d.webm e.ico; do
  if git -C "$with" check-attr text -- "$f" | grep -q 'text: unset'; then
    pass "$f is binary"
  else
    fail "$f is not marked binary"
  fi
done

# Negative control: no attributes file, same input -> CRLF survives.
without="$(new_repo without)"
[[ "$(checkout_has_cr "$without" post.md)" == yes ]] \
  && pass "negative control: without .gitattributes the checkout is CRLF" \
  || fail "negative control did not reproduce the bug (the check cannot fail)"

if [[ "$fails" -ne 0 ]]; then
  echo "$fails case(s) failed" >&2
  exit 1
fi
echo "all cases passed"
