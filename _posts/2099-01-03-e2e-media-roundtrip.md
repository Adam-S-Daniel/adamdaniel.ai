---
reading_time: null
excerpt: "Fixture for the media round-trip spec. Never serves at a public URL
  until a test flips published: true, then resets it."
robots: noindex,nofollow
title: E2E Media Roundtrip
slug: e2e-media-roundtrip
date: 2099-01-03 00:00:00 +0000
tags: []
featured_image: /assets/images/uploads/e2e-media-roundtrip-1779853920151.png
published: true
sitemap: false
publish_date: ""
test_fixture: true
---
Adam Daniel — E2E media round-trip fixture (do not edit by hand).

This file is the target of `e2e/cms-media-roundtrip.spec.js`, scheduled
by `.github/workflows/cms-media-roundtrip.yml`. The spec drives the real
Decap admin against the real GitHub backend to:

1. upload a unique image via the Media UI and attach it to this post,
2. publish, and assert the image loads on adamdaniel.ai,
3. remove the image from the post and publish,
4. delete the image via the Media UI,
5. assert the image's live URL 404s.

The baseline keeps `published: false` and `featured_image: ""`, so this
file does NOT serve at any public URL between runs. `sitemap: false` and
`robots: noindex,nofollow` are belt-and-suspenders so a stuck
`published: true` state never leaks into search.

If this is the only thing you can see at `/blog/e2e-media-roundtrip/`,
the spec ran but cleanup hasn't fired yet. Check the latest
`cms-media-roundtrip.yml` run.
