#!/usr/bin/env bash
#
# scripts/setup-test-environment.sh — install everything needed to run the
# full test stack locally on a Debian/Ubuntu machine (or WSL2).
#
# What "running the tests locally" means here:
#   - npx playwright test                (e2e + browser specs)
#   - bundle exec jekyll build            (used by playwright.config.js's webServer)
#   - npx playwright test e2e/cms-smoke   (Decap admin → save → delete)
#   - cd oauth-proxy && python3 -m pytest test_lambda.py -v
#   - bash _plugins_test/run.sh           (Jekyll plugin unit tests)
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
have()    { command -v "$1" >/dev/null 2>&1; }
note()    { printf '\033[1;34m[setup]\033[0m %s\n' "$*"; }
ok()      { printf '\033[1;32m[ ok  ]\033[0m %s\n' "$*"; }
warn()    { printf '\033[1;33m[warn ]\033[0m %s\n' "$*"; }

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

# ── 7. Node deps + Playwright browsers ────────────────────────────────────
note "Installing npm dependencies…"
npm install --no-audit --no-fund --silent
ok "node_modules/ ready"

note "Downloading Playwright browser binaries (chromium, firefox, webkit)…"
npx --yes playwright install chromium firefox webkit
# `playwright install-deps` knows the full apt set for all three browsers
# (libgtk-4, libwebpdemux, libgraphene, libenchant-2 — too many to hand
# list and they shift between Playwright versions). Sudo, since it shells
# out to apt-get install.
note "Installing Playwright apt deps for all three browsers…"
sudo DEBIAN_FRONTEND=noninteractive npx --yes playwright install-deps
ok "Playwright browsers + system deps installed"

# ── 8. Python + pytest (for oauth-proxy unit tests) ───────────────────────
apt_install python3 python3-pip python3-venv
if ! python3 -c "import pytest" >/dev/null 2>&1; then
  note "Installing pytest in a project-local venv (oauth-proxy/.venv)…"
  python3 -m venv oauth-proxy/.venv
  oauth-proxy/.venv/bin/pip install --quiet --upgrade pip
  oauth-proxy/.venv/bin/pip install --quiet pytest
fi
ok "pytest available (use oauth-proxy/.venv/bin/pytest or pip-install pytest globally)"

# ── 9. Final smoke: confirm Chromium can launch ───────────────────────────
note "Smoke-testing Playwright's chromium launch…"
node -e "
  const { chromium } = require('playwright');
  (async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage();
    await page.goto('about:blank');
    await browser.close();
    console.log('chromium launch ok');
  })().catch(e => { console.error(e); process.exit(1); });
"

cat <<'EOF'

────────────────────────────────────────────────────────────────────────
[setup] All prerequisites installed.

Run the test stack:

  npx playwright test                            # full e2e matrix
  npx playwright test --project chromium-desktop # single-browser run
  npx playwright test e2e/cms-smoke.spec.js      # Decap admin save/delete
  bundle exec jekyll build                       # site build
  cd oauth-proxy && python3 -m pytest test_lambda.py -v   # OAuth proxy
  bundle exec ruby _plugins_test/auto_tag_pages_test.rb   # Jekyll plugin unit tests

Notes:
  - The bundler `path` is set to `vendor/bundle/` so gems live alongside
    the repo. Delete that directory to fully reset the Ruby env.
  - If your system python doesn't have pytest, this script created a
    venv at oauth-proxy/.venv — use `oauth-proxy/.venv/bin/pytest` in
    that case (or `source oauth-proxy/.venv/bin/activate`).
────────────────────────────────────────────────────────────────────────
EOF
