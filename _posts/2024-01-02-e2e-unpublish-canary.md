---
excerpt: "Fixture used by the cms-unpublish-republish spec. Never serves at a
  public URL until a test flips published: true; resets back to false in
  cleanup."
robots: noindex,nofollow
title: E2E Unpublish Canary
slug: e2e-unpublish-canary
date: 2024-01-02 00:00:00 +0000
tags: []
featured_image: ""
published: false
test_fixture: true
sitemap: false
publish_date: ""
---

This post is the fixture for `e2e/cms-unpublish-republish.spec.js`.
The spec toggles `published` on/off via the Decap UI and asserts
the public URL goes 200 → 404 → 200 in sync.

Baseline state is `published: false` so the post is never on the
public site between test runs. The spec restores this state in
cleanup. If you see the post at /blog/e2e-unpublish-canary/ when
no test is running, the cleanup leg failed — flip
`published: false` and merge the next test won't touch this file
until the next dispatch.
