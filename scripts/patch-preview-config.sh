#!/usr/bin/env bash
#
# Patch admin/config.yml (in-place) so a preview deploy's CMS points at the
# right host, branch, and paths. See deploy-preview.yml for why each field
# has to change.
#
# Usage: patch-preview-config.sh <config_file> <pr_number> <branch> <preview_host>
set -euo pipefail

if [[ $# -ne 4 ]]; then
  echo "usage: $0 <config_file> <pr_number> <branch> <preview_host>" >&2
  exit 2
fi

CONFIG="$1"
PR_NUMBER="$2"
BRANCH="$3"
PREVIEW_HOST="$4"

PREVIEW_ORIGIN="https://${PREVIEW_HOST}"
PREVIEW_FULL="${PREVIEW_ORIGIN}/pr-${PR_NUMBER}"

# 1. site_url: Sveltia only keeps .origin() from this — path would be
#    stripped — so we set just the origin here and stuff the /pr-N prefix
#    into preview_path below.
sed -i -E "s|^site_url:.*|site_url: ${PREVIEW_ORIGIN}|" "$CONFIG"

# 2. display_url: used by the "Open Production Site" button only; full URL
#    is what we want so the button links to the preview, not prod.
sed -i -E "s|^display_url:.*|display_url: ${PREVIEW_FULL}|" "$CONFIG"

# 3. backend.branch: Sveltia's GitHub backend fetches posts from whichever
#    branch is listed here, not whatever branch the preview was built from.
#    Without repointing this, Sveltia reads stale `main` copies and URL
#    templates silently fall back to slugified titles for posts whose slug
#    frontmatter was only added on the PR branch.
sed -i -E "s|^(  branch:).*|\\1 ${BRANCH}|" "$CONFIG"

# 4. preview_path: prefix every collection's URL path with /pr-N so the
#    final URL lands inside the preview deploy's subpath. Uses perl so the
#    pattern can skip paths already prefixed with /pr-${PR_NUMBER}/ —
#    re-running the script must be a no-op.
perl -i -pe "s|(preview_path:\s*\"?)/(?!pr-${PR_NUMBER}/)|\$1/pr-${PR_NUMBER}/|g" "$CONFIG"
