#!/usr/bin/env bash
#
# scripts/setup-test-environment.sh — install everything needed to run the
# full test stack locally on a Debian/Ubuntu machine (or WSL2).
#
# What "running the tests locally" means here:
#   - bundle exec jekyll build            (the site build the harness serves)
#   - cd .cms-platform/e2e && SITE_ROOT=<this repo> npx playwright test …
#     (the Playwright harness is platform-owned and runs from that checkout;
#     this repo vendors no Node toolchain — no root package.json since
#     2026-09-14 — so nothing here runs `npm` at the repo root)
#
# This script does NOT check out .cms-platform/. Do that first, at the
# platform_ref pinned in platform.lock, and section 7 below installs the
# harness's npm deps + Playwright browsers there; without the checkout it
# prints how and skips that section.
#
# The script is idempotent: running it a second time skips anything that's
# already present. Sudo is invoked only for system packages — npm and bundle
# install run as the current user.
#
# Tested on: Ubuntu 24.04 (noble) under WSL2.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# ── Helpers ───────────────────────────────────────────────────────────────
have() { command -v "$1" >/dev/null 2>&1; }
note() { printf '\033[1;34m[setup]\033[0m %s\n' "$*"; }
ok() { printf '\033[1;32m[ ok  ]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[warn ]\033[0m %s\n' "$*"; }

# Single sudo prompt up front, then `sudo -n` for the rest.
need_sudo() {
  if [ "$(id -u)" = 0 ]; then return 0; fi
  if sudo -n true 2>/dev/null; then return 0; fi
  note "Will need sudo to install system packages — prompting once now."
  sudo -v
}

apt_install() {
  local missing=()
  for pkg in "$@"; do
    if ! dpkg -s "$pkg" >/dev/null 2>&1; then missing+=("$pkg"); fi
  done
  if [ "${#missing[@]}" -eq 0 ]; then
    ok "apt: all of [$*] already installed"
    return 0
  fi
  note "apt: installing ${missing[*]}"
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "${missing[@]}"
}

# ── 1. Sanity: Debian-flavoured environment ───────────────────────────────
if ! have apt-get; then
  warn "This script targets Debian/Ubuntu (apt-get not found). On macOS use Homebrew; on Fedora use dnf."
  exit 1
fi

# ── 2. Sudo upfront + apt update ──────────────────────────────────────────
need_sudo
note "Refreshing apt indices…"
sudo apt-get update -qq

# ── 3. Node (already on the system in CI; warn if missing locally) ────────
if ! have node; then
  warn "node is missing — install Node 20+ before re-running this script."
  warn "Ubuntu: see https://github.com/nodesource/distributions for the official packages."
  exit 1
fi
ok "node $(node --version)"
ok "npm $(npm --version)"

# ── 4. ffmpeg (visual-regression video generation in e2e/generate-video.sh) ─
apt_install ffmpeg

# ── 5. Ruby + Bundler + Jekyll deps ───────────────────────────────────────
# `ruby-bundler` lives in /usr/bin/bundle so future shells find it without
# any PATH gymnastics; preferred over `gem install --user-install bundler`.
apt_install ruby-full ruby-bundler build-essential zlib1g-dev
ok "bundler $(bundle --version | awk '{print $3}')"

note "Installing Gemfile dependencies (jekyll, jekyll-seo-tag, etc.)…"
bundle config set --local path 'vendor/bundle' >/dev/null
bundle install --quiet --jobs 4 --retry 2
ok "Gemfile installed (vendor/bundle/)"

# ── 7. Playwright harness deps + browsers (in the platform checkout) ──────
# The harness and everything it needs (@playwright/test, decap-server, serve)
# live in cms-platform's e2e/, checked out into .cms-platform/ — the same
# dot-dir the CI reusables use. Install its deps and browsers THERE; the
# repo root has no package.json to install.
HARNESS="$REPO_ROOT/.cms-platform/e2e"
if [ -f "$HARNESS/package.json" ]; then
  note "Installing harness npm dependencies in .cms-platform/e2e…"
  (cd "$HARNESS" && npm ci --no-audit --no-fund --silent)
  ok ".cms-platform/e2e/node_modules/ ready"

  # `playwright install-deps` knows the full apt set for all three browsers
  # (libgtk-4, libwebpdemux, libgraphene, libenchant-2 — too many to hand
  # list and they shift between Playwright versions). Run BEFORE the browser
  # download so the post-download host-validation step doesn't print a long
  # scary "missing libraries" warning. Sudo, since it shells out to
  # apt-get install. Both run from the harness so the pinned Playwright
  # there is the one that installs.
  note "Installing Playwright apt deps for all three browsers…"
  (cd "$HARNESS" && sudo DEBIAN_FRONTEND=noninteractive npx playwright install-deps)

  note "Downloading Playwright browser binaries (chromium, firefox, webkit)…"
  (cd "$HARNESS" && npx playwright install chromium firefox webkit)
  ok "Playwright browsers + system deps installed"

  # ── 8. Final smoke: confirm Chromium can launch ─────────────────────────
  note "Smoke-testing Playwright's chromium launch…"
  (cd "$HARNESS" && node -e "
    const { chromium } = require('playwright');
    (async () => {
      const browser = await chromium.launch();
      const page = await browser.newPage();
      await page.goto('about:blank');
      await browser.close();
      console.log('chromium launch ok');
    })().catch(e => { console.error(e); process.exit(1); });
  ")
else
  warn "No platform checkout at .cms-platform/ — skipping the Playwright harness."
  warn "To run the e2e suite locally, check the platform out at platform.lock's"
  warn "platform_ref and re-run this script:"
  warn '  ref=$(sed -n "s/^platform_ref: *//p" platform.lock)'
  warn '  git clone --depth 1 --branch "$ref" https://github.com/Adam-S-Daniel/cms-platform .cms-platform'
fi

cat <<'EOF'

────────────────────────────────────────────────────────────────────────
[setup] All prerequisites installed.

Run the test stack (Playwright runs from the platform harness, against
this site):

  export SITE_ROOT="$(git rev-parse --show-toplevel)"
  cd .cms-platform/e2e
  npx playwright test                            # full e2e matrix
  npx playwright test --project chromium-desktop-1080 # single-browser run
  npx playwright test cms-smoke.spec.js          # Decap admin save/delete
  bundle exec jekyll build                       # site build (repo root)

Notes:
  - The bundler `path` is set to `vendor/bundle/` so gems live alongside
    the repo. Delete that directory to fully reset the Ruby env.
────────────────────────────────────────────────────────────────────────
EOF
