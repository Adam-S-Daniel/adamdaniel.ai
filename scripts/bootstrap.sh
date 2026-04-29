#!/usr/bin/env bash
# Skills mirror bootstrap (macOS / Linux / WSL).
# Idempotent. Safe to run from a sessionStart hook on every Claude Code session.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

AGENTS_DIR=".agents/skills"
MIRROR_DIR=".claude/skills"
MIRROR_TARGET="../.agents/skills"
GITCONFIG_FRAGMENT=".gitconfig-fragment"
HOOKS_DIR=".githooks"

log() { printf 'bootstrap: %s\n' "$*"; }
err() { printf 'bootstrap: %s\n' "$*" >&2; }

dir_has_content() {
    local d="$1"
    [[ -d "$d" ]] || return 1
    [[ -n "$(find "$d" -mindepth 1 -maxdepth 1 -print -quit 2>/dev/null)" ]]
}

mkdir -p .claude .agents

# 1. Migration: handle existing real .claude/skills directory.
if [[ -e "$MIRROR_DIR" && ! -L "$MIRROR_DIR" ]]; then
    if [[ -f "$MIRROR_DIR" ]]; then
        # Likely a "fake symlink" file from a checkout with core.symlinks=false.
        # Discard it; the link will be recreated below.
        log "Removing stale plain file at $MIRROR_DIR (was probably a checkout-emitted text symlink)"
        rm -f "$MIRROR_DIR"
    elif [[ ! -d "$MIRROR_DIR" ]]; then
        err "ERROR: $MIRROR_DIR exists but is not a regular file, directory, or symlink."
        exit 2
    fi
fi

if [[ -d "$MIRROR_DIR" && ! -L "$MIRROR_DIR" ]]; then

    if dir_has_content "$MIRROR_DIR" && dir_has_content "$AGENTS_DIR"; then
        err "ERROR: Both $AGENTS_DIR and $MIRROR_DIR contain content."
        err "Cannot auto-merge — please consolidate manually."
        err "  $AGENTS_DIR contains:"
        ls "$AGENTS_DIR" | sed 's/^/    /' >&2
        err "  $MIRROR_DIR contains:"
        ls "$MIRROR_DIR" | sed 's/^/    /' >&2
        exit 2
    fi

    if dir_has_content "$MIRROR_DIR"; then
        log "Migrating $MIRROR_DIR contents into $AGENTS_DIR"
        mkdir -p "$AGENTS_DIR"
        # Use shopt to handle dotfiles; mv pattern into AGENTS_DIR
        shopt -s dotglob nullglob
        mv "$MIRROR_DIR"/* "$AGENTS_DIR"/
        shopt -u dotglob nullglob
    fi

    rmdir "$MIRROR_DIR"
fi

mkdir -p "$AGENTS_DIR"

# 2. Create or repair the symlink.
if [[ -L "$MIRROR_DIR" ]]; then
    current="$(readlink "$MIRROR_DIR")"
    if [[ "$current" != "$MIRROR_TARGET" ]]; then
        log "Repairing $MIRROR_DIR symlink (was: $current)"
        rm "$MIRROR_DIR"
        ln -s "$MIRROR_TARGET" "$MIRROR_DIR"
    fi
elif [[ ! -e "$MIRROR_DIR" ]]; then
    log "Creating $MIRROR_DIR -> $MIRROR_TARGET"
    ln -s "$MIRROR_TARGET" "$MIRROR_DIR"
fi

# 3. Git-local config: symlinks on, hook registration.
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    git config --local core.symlinks true >/dev/null 2>&1 || true

    git_version="$(git --version 2>/dev/null | awk '{print $3}')"
    major="${git_version%%.*}"
    rest="${git_version#*.}"
    minor="${rest%%.*}"

    use_config_hooks=0
    if [[ "$major" =~ ^[0-9]+$ && "$minor" =~ ^[0-9]+$ ]]; then
        if (( major > 2 || ( major == 2 && minor >= 54 ) )); then
            use_config_hooks=1
        fi
    fi

    if (( use_config_hooks )) && [[ -f "$GITCONFIG_FRAGMENT" ]]; then
        include_value="../$GITCONFIG_FRAGMENT"
        if ! git config --local --get-all include.path 2>/dev/null | grep -qFx "$include_value"; then
            git config --local --add include.path "$include_value"
        fi
    elif [[ -d "$HOOKS_DIR" ]]; then
        git config --local core.hooksPath "$HOOKS_DIR" >/dev/null 2>&1 || true
    fi
fi

# 4. Run verify if present.
if [[ -x "$SCRIPT_DIR/verify-skills-mirror.sh" ]]; then
    "$SCRIPT_DIR/verify-skills-mirror.sh"
fi

log "OK"
