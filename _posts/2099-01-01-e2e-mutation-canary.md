---
reading_time: null
excerpt: "Fixture used by the nightly prod-mutation playground spec. Never
  serves at a public URL until a test flips published: true, then resets it."
robots: noindex,nofollow
title: E2E Mutation Canary
slug: e2e-mutation-canary
date: 2099-01-01 00:00:00 +0000
tags: []
featured_image: ""
published: true
sitemap: false
publish_date: ""
test_fixture: true
---
Adam Daniel — E2E mutation canary post (do not edit by hand).

This file is the target of the preview-env prod-mutation parity
spec (`e2e/cms-publish-loop-prod-mutate-preview.spec.js`, run by
`.github/workflows/cms-preview-loops.yml`). The spec drives the
full Decap → cms PR → label-driven auto-merge → deploy-preview
loop against the PR's `preview-pr<N>.adamdaniel.ai` 

e2e-preview-prod-mutate:e2e-mutation-canary:1780669549286

surface,


targeting the PR head branch — zero production blast radius.

Between runs the body is reset to this baseline and `published`
is forced back to `false`, so the public URL renders nothing.

preview-prod-mutate baseline — no test currently in progress
