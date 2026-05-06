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
---
Adam Daniel — E2E mutation canary post (do not edit by hand).

This file is the target of the nightly prod-mutation playground spec
(`e2e/cms-publish-loop-prod-mutate.spec.js`, scheduled by
`.github/workflows/cms-publish-loop-prod.yml`). While `prod` is a
"full mutation playground" — i.e. nobody is reading the site for SEO —
the spec exercises the **entire** Decap → cms PR → auto-merge →
deploy-production loop against a real `_posts/` entry rather than the
`_e2e/` canary subset.

The spec keeps `published: false` between runs, so this file does NOT
serve at any public URL until the spec flips it to `true`. After the
URL goes live and the spec asserts the deploy succeeded, a cleanup
commit flips it back to `false` and the URL 404s again. `sitemap: false`

e2e-prod-mutate:e2e-mutation-canary:1778070456463

e2e-prod-mutate:e2e-mutation-canary:1778071036971

e2e-prod-mutate:e2e-mutation-canary:1778072473570

e2e-prod-mutate:e2e-mutation-canary:1778083615231



e2e-prod-mutate:e2e-mutation-canary:1778085167033



e2e-prod-mutate:e2e-mutation-canary:1778084178562

e2e-prod-mutate:e2e-mutation-canary:1778072992742

e2e-prod-mutate:e2e-mutation-canary:1778071574906

e2e-prod-mutate:e2e-mutation-canary:1778070844071

and `robots: noindex,nofollow` are belt-and-suspenders so a stuck
"published: true" state never leaks into search.

Sunset path: when `prod` stops being a playground (real readers, real
SEO concerns), set the repo variable `PROD_PLAYGROUND_MODE=false` (or
unset it) and the workflow skips itself. This file stays as
documentation of the previous playground regime — it remains harmless
because `published: false` keeps it out of the build.

If this is the only thing you can see at `/blog/e2e-mutation-canary/`,
the spec ran but the cleanup step hasn't fired yet. The next nightly
run resets it; if the URL is still live tomorrow, check the latest
`cms-publish-loop-prod.yml` run.
