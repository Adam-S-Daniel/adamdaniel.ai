#!/bin/bash
# Site-owned SessionStart hook. scripts/setup-hooks.sh is PLATFORM-authoritative
# (overwritten by dev-hooks-sync.yml), so web-session environment fixes live
# here instead.
#
# Claude Code on the web starts shells with no locale (LANG/LC_ALL unset ->
# US-ASCII), which crashes `bundle exec jekyll build`: the platform gem's
# Decap render hook reads UTF-8 site files and Ruby raises "invalid byte
# sequence in US-ASCII". CI exports a UTF-8 locale; do the same for every
# shell in a web session by appending to CLAUDE_ENV_FILE (set only on the
# web, so this is a no-op in local/CLI sessions).
set -euo pipefail

if [ -n "${CLAUDE_ENV_FILE:-}" ] && ! grep -qs '^export LANG=' "$CLAUDE_ENV_FILE"; then
  echo 'export LANG="${LANG:-C.UTF-8}"' >> "$CLAUDE_ENV_FILE"
  echo "session-start: exported LANG=C.UTF-8 for web-session shells"
fi
