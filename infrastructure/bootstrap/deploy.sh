#!/usr/bin/env bash
# =============================================================================
# deploy.sh — Bootstrap AWS account for adamdaniel.ai CI/CD
# =============================================================================
#
# Thin wrapper around the cms-platform repo's PARAMETERIZED bootstrap stack.
# This site no longer vendors its own CloudFormation template — the template
# (and the deploy logic) are the single source of truth in cms-platform, so a
# fix made there (e.g. the CloudFront ErrorCachingMinTTL=0 fix) flows to every
# consumer site on the next platform_ref bump, instead of having to be applied
# in two places.
#
# How it works (mirrors the repo-wide ".cms-platform/ checkout-at-platform_ref"
# pattern the reusable-workflow callers use — see deploy-preview.yml, which
# `actions/checkout`s the platform repo at inputs.platform_ref into
# .cms-platform/):
#   1. Read platform_repo + platform_ref from platform.lock.
#   2. Check the platform repo out at that ref into .cms-platform/ (a dot-dir
#      Jekyll ignores; already gitignored — never committed).
#   3. Export adamdaniel.ai's site parameters and delegate to the platform's
#      .cms-platform/infrastructure/bootstrap/deploy.sh, which deploys
#      .cms-platform/infrastructure/bootstrap/template.yaml as the
#      `adamdaniel-ai-bootstrap` stack with CAPABILITY_NAMED_IAM.
#
# One-time setup that creates (via the platform template):
#   1. S3 bucket for CloudFormation/SAM deployment artifacts
#   2. GitHub OIDC identity provider in AWS IAM
#   3. IAM role for GitHub Actions (assumed via OIDC — no long-lived keys)
#   4. ACM certs + preview/production CloudFront distributions + Route53 records
#
# Prerequisites:
#   • AWS CLI v2  (aws --version)
#   • git         (to check out the platform repo)
#   • AWS credentials configured (aws configure or IAM role)
#
# Usage:
#   bash infrastructure/bootstrap/deploy.sh
#
# If a GitHub OIDC provider already exists in this account:
#   CREATE_OIDC_PROVIDER=false bash infrastructure/bootstrap/deploy.sh
#
# This script is idempotent — safe to re-run at any time.
# =============================================================================

set -euo pipefail

# ── Colour output ──────────────────────────────────────────────────────────
BLUE='\033[0;34m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

info() { echo -e "${BLUE}[INFO]${NC}  $*"; }
success() { echo -e "${GREEN}[OK]${NC}    $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error() {
  echo -e "${RED}[ERROR]${NC} $*" >&2
  exit 1
}

# ── Validate prerequisites ─────────────────────────────────────────────────
command -v aws >/dev/null 2>&1 || error "AWS CLI not found. Install: https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html"
command -v git >/dev/null 2>&1 || error "git not found — needed to check out the cms-platform template."

# ── Locate repo root + platform.lock ───────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
LOCK_FILE="$REPO_ROOT/platform.lock"
[[ -f "$LOCK_FILE" ]] || error "platform.lock not found at $LOCK_FILE"

# Parse platform_repo + platform_ref out of platform.lock (the same lock the
# reusable-workflow callers pin platform_ref from). Format is `key: value`.
read_lock() {
  # shellcheck disable=SC2016  # awk field refs ($1/$2), not shell expansion.
  awk -v k="$1" '$1==k":" {print $2; exit}' "$LOCK_FILE"
}
PLATFORM_REPO="${PLATFORM_REPO:-$(read_lock platform_repo)}"
PLATFORM_REF="${PLATFORM_REF:-$(read_lock platform_ref)}"
[[ -n "$PLATFORM_REPO" ]] || error "platform_repo not found in $LOCK_FILE"
[[ -n "$PLATFORM_REF" ]] || error "platform_ref not found in $LOCK_FILE"

# ── Check the platform out at platform_ref into .cms-platform/ ──────────────
# Mirrors the workflow pattern (actions/checkout repository=<platform_repo>
# ref=<platform_ref> path=.cms-platform). The dot-dir is gitignored + excluded
# from Jekyll, so it never pollutes the site or the working tree.
PLATFORM_DIR="$REPO_ROOT/.cms-platform"
PLATFORM_URL="${PLATFORM_URL:-https://github.com/${PLATFORM_REPO}.git}"

info "Platform: ${PLATFORM_REPO}@${PLATFORM_REF}"
info "Checking platform out into .cms-platform/ …"
rm -rf "$PLATFORM_DIR"
git clone --quiet --depth 1 --branch "$PLATFORM_REF" "$PLATFORM_URL" "$PLATFORM_DIR" \
  || error "Failed to check out ${PLATFORM_REPO}@${PLATFORM_REF} into .cms-platform/"

PLATFORM_DEPLOY="$PLATFORM_DIR/infrastructure/bootstrap/deploy.sh"
PLATFORM_TEMPLATE="$PLATFORM_DIR/infrastructure/bootstrap/template.yaml"
[[ -f "$PLATFORM_TEMPLATE" ]] || error "Platform bootstrap template missing: $PLATFORM_TEMPLATE"
[[ -f "$PLATFORM_DEPLOY" ]] || error "Platform bootstrap deploy script missing: $PLATFORM_DEPLOY"
success "Platform checked out — deploying from $PLATFORM_TEMPLATE"

# ── adamdaniel.ai site parameters ──────────────────────────────────────────
# These reproduce the live `adamdaniel-ai-bootstrap` stack's parameters exactly.
# Everything else (RESOURCE_PREFIX=adamdaniel-ai, the three bucket names,
# STACK_NAME=adamdaniel-ai-bootstrap, PREVIEW_DOMAIN=*.adamdaniel.ai) derives
# from APEX_DOMAIN inside the platform deploy.sh — see its defaults. HOSTED_ZONE_ID
# is auto-detected from Route53 there if unset, preserving the old behavior.
# CAPABILITY_NAMED_IAM is applied by the platform deploy.sh.
export GITHUB_ORG="${GITHUB_ORG:-Adam-S-Daniel}"
export GITHUB_REPO="${GITHUB_REPO:-adamdaniel.ai}"
export APEX_DOMAIN="${APEX_DOMAIN:-adamdaniel.ai}"
export AWS_REGION="${AWS_REGION:-us-east-1}"
export CREATE_OIDC_PROVIDER="${CREATE_OIDC_PROVIDER:-true}"
# HOSTED_ZONE_ID passes through if the caller exported it; otherwise the
# platform script auto-detects it from Route53 (same as the old behavior).

# ── Delegate to the platform's bootstrap deploy.sh ─────────────────────────
# It cd's into its own script dir and deploys ./template.yaml (i.e.
# .cms-platform/infrastructure/bootstrap/template.yaml) as the
# adamdaniel-ai-bootstrap stack, then prints the stack outputs + next steps.
exec bash "$PLATFORM_DEPLOY"
