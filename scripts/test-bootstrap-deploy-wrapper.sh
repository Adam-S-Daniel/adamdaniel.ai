#!/usr/bin/env bash
# Regression test for infrastructure/bootstrap/deploy.sh (the thin wrapper around
# cms-platform's parameterized bootstrap deploy).
#
#   bash scripts/test-bootstrap-deploy-wrapper.sh
#
# Pins the site params the wrapper hands to the platform deploy.sh, chiefly
# ADMIN_CSP_MODE: the platform script defaults it to `report-only`, so a plain
# redeploy of this site would silently revert the admin CSP from enforce unless
# the wrapper exports `enforce` itself. The wrapper does NOT source
# site-params.env, so that file is no place for the setting.
#
# Deterministic and offline: the wrapper runs from a scratch copy (it `rm -rf`s
# `.cms-platform/` under its own repo root), `aws` and `git` are stubs on PATH,
# and the "platform" deploy.sh is a stub that prints the env it received. No AWS
# call is made. There is no CI lane for it (like test-verify-build-artifacts.rb);
# run it whenever the wrapper changes. Exit 0 only when every case passes.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WRAPPER="$ROOT/infrastructure/bootstrap/deploy.sh"
[[ -f "$WRAPPER" ]] || { echo "FAIL: wrapper not found: $WRAPPER" >&2; exit 1; }

SCRATCH="$(mktemp -d)"
trap 'rm -rf "$SCRATCH"' EXIT

mkdir -p "$SCRATCH/repo/infrastructure/bootstrap" "$SCRATCH/bin"
cp "$WRAPPER" "$SCRATCH/repo/infrastructure/bootstrap/deploy.sh"
cp "$ROOT/platform.lock" "$SCRATCH/repo/platform.lock"

cat >"$SCRATCH/bin/aws" <<'STUB'
#!/usr/bin/env bash
echo "aws stub must never be called: $*" >&2
exit 99
STUB

# `git clone ... <dest>`: build a fake platform checkout whose deploy.sh reports its env.
cat >"$SCRATCH/bin/git" <<'STUB'
#!/usr/bin/env bash
[[ "$1" == "clone" ]] || { echo "unexpected git call: $*" >&2; exit 98; }
dest="${@: -1}"
mkdir -p "$dest/infrastructure/bootstrap"
: >"$dest/infrastructure/bootstrap/template.yaml"
cat >"$dest/infrastructure/bootstrap/deploy.sh" <<'PLATFORM'
#!/usr/bin/env bash
echo "ADMIN_CSP_MODE=${ADMIN_CSP_MODE-<unset>}"
echo "CREATE_APEX_DNS_RECORDS=${CREATE_APEX_DNS_RECORDS-<unset>}"
PLATFORM
STUB
chmod +x "$SCRATCH/bin/aws" "$SCRATCH/bin/git"

PASS=0
FAILED=0

# run_wrapper [VAR=value ...] -> stdout of the stub platform deploy.sh
run_wrapper() {
  env -u ADMIN_CSP_MODE -u CREATE_APEX_DNS_RECORDS "$@" PATH="$SCRATCH/bin:$PATH" \
    bash "$SCRATCH/repo/infrastructure/bootstrap/deploy.sh" 2>"$SCRATCH/stderr"
}

expect() { # name, expected line, actual output
  if grep -qxF -- "$2" <<<"$3"; then
    PASS=$((PASS + 1))
    echo "ok   $1"
  else
    FAILED=$((FAILED + 1))
    echo "FAIL $1: wanted '$2', got:"
    printf '       %s\n' "${3//$'\n'/$'\n'       }"
  fi
}

out="$(run_wrapper)" || out="wrapper exited non-zero: $(cat "$SCRATCH/stderr")"
expect "admin CSP defaults to enforce" "ADMIN_CSP_MODE=enforce" "$out"
expect "apex DNS records stay stack-managed" "CREATE_APEX_DNS_RECORDS=true" "$out"

out="$(run_wrapper ADMIN_CSP_MODE=report-only)" || out="wrapper exited non-zero: $(cat "$SCRATCH/stderr")"
expect "ADMIN_CSP_MODE=report-only rolls back" "ADMIN_CSP_MODE=report-only" "$out"

out="$(run_wrapper ADMIN_CSP_MODE=enforce)" || out="wrapper exited non-zero: $(cat "$SCRATCH/stderr")"
expect "explicit ADMIN_CSP_MODE=enforce passes through" "ADMIN_CSP_MODE=enforce" "$out"

echo "$PASS passed, $FAILED failed"
[[ "$FAILED" -eq 0 ]]
