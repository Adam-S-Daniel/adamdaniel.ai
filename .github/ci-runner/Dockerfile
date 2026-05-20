# syntax=docker/dockerfile:1.7
#
# CI runner image — pre-bakes the apt deps, Ruby + Gemfile.lock gems,
# Node + package-lock.json node_modules, and the gitleaks binary that
# every Playwright-running workflow in this repo would otherwise install
# from scratch on each job (≈90–180 s per job). With the cached image,
# `container: image: ghcr.io/adam-s-daniel/adamdaniel.ai/ci-runner:<tag>`
# starts ready to `bundle exec jekyll build` / `npx playwright test`
# immediately.
#
# Base: Microsoft's prebuilt Playwright image. Already carries Chromium,
# Firefox, WebKit, Node 20, and the apt deps Playwright needs at the
# pinned version. We layer Ruby + bundle + npm cache + gitleaks on top.
#
# Tag scheme: the build workflow tags the image by the SHA-256 of
# (Dockerfile + Gemfile.lock + package-lock.json). The same workflow
# also pushes `:latest` on main, so PR consumers can fall back to
# `:latest` when their lockfile-hash tag is missing (e.g. before the
# main-side build has caught up after a dependency bump).
#
# OCI labels link this package to the source repo. With the
# `org.opencontainers.image.source` label set, GHCR auto-inherits the
# repo's public visibility, so pulling the image needs no auth (which
# keeps fork PRs and unauthenticated local pulls trivial) and storage
# bandwidth is free regardless of plan limits.

ARG PLAYWRIGHT_IMAGE_TAG=v1.59.1-noble
FROM mcr.microsoft.com/playwright:${PLAYWRIGHT_IMAGE_TAG}

# OCI annotations — these flow into both the image config and the GHCR
# package metadata, so the package surface in the GitHub UI links back
# to the source repo and shares its visibility.
LABEL org.opencontainers.image.source="https://github.com/Adam-S-Daniel/adamdaniel.ai"
LABEL org.opencontainers.image.description="CI runner image for adamdaniel.ai — Playwright + Ruby/Jekyll + Node deps prebaked."
LABEL org.opencontainers.image.licenses="MIT"

ENV DEBIAN_FRONTEND=noninteractive

# apt deps: libyaml-0-2 (Ruby YAML), build-essential (native gem
# extensions), curl + ca-certificates (gitleaks fetch). All small;
# layered separately from gem/node installs so a Dockerfile-only edit
# doesn't have to rebuild the heavier layers.
RUN apt-get update -qq \
    && apt-get install -y -qq --no-install-recommends \
        libyaml-0-2 \
        build-essential \
        ca-certificates \
        curl \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Ruby 3.2 from the ruby-build PPA via rbenv would add complexity for
# little gain — Ubuntu noble ships Ruby 3.2 in `ruby-full` which is the
# same version `.github/workflows/*.yml` pins via ruby/setup-ruby.
RUN apt-get update -qq \
    && apt-get install -y -qq --no-install-recommends ruby-full \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* \
    && ruby --version

# Bundle install — gems live under /usr/local/bundle so subsequent
# `bundle exec` calls (in any job working tree) find them without a
# repeat install. `bundle config --global` writes to /root/.bundle.
# Gemfile.lock is tracked, so the prebuild resolves the same gem
# versions every time → reproducible layers.
WORKDIR /tmp/bundle-prebuild
COPY Gemfile Gemfile.lock ./
RUN gem install bundler --no-document \
    && bundle config --global path /usr/local/bundle \
    && bundle config --global without 'development:test' \
    && bundle install --jobs 4 --retry 3 \
    && rm -rf /tmp/bundle-prebuild

# npm ci — pre-warms node_modules under /opt/npm-cache so the consumer
# job can copy or symlink. We don't bake the working tree's
# node_modules directly because the consumer's $GITHUB_WORKSPACE path
# isn't fixed at image build time; `npm ci` against the same lockfile
# inside the job is fast (~5 s) when the cache is populated.
WORKDIR /tmp/npm-prebuild
COPY package.json package-lock.json ./
RUN npm config set cache /opt/npm-cache --global \
    && npm ci --prefer-offline --no-audit --no-fund \
    && rm -rf /tmp/npm-prebuild /root/.npm

# gitleaks — pinned to the version `.github/workflows/secrets-scan.yml`
# resolves at runtime. Inside the post-failure-comment composite, the
# scan path expects the binary on $PATH; baking it in saves the
# install-from-release step the composite would otherwise do per job.
ARG GITLEAKS_VERSION=8.30.1
RUN set -eux \
    && arch="$(dpkg --print-architecture)" \
    && case "${arch}" in \
        amd64) gl_arch="x64" ;; \
        arm64) gl_arch="arm64" ;; \
        *) echo "Unsupported arch: ${arch}" >&2; exit 1 ;; \
       esac \
    && curl -fsSL \
        "https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/gitleaks_${GITLEAKS_VERSION}_linux_${gl_arch}.tar.gz" \
        | tar -xz -C /usr/local/bin gitleaks \
    && gitleaks version

# Reset CWD — consumer workflows rely on $GITHUB_WORKSPACE being the
# active dir, not the build's prebuild dirs.
WORKDIR /
