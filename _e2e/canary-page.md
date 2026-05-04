---
title: E2E Canary — Page
layout: canary
permalink: /e2e/canary-page/
canary_baseline: Adam Daniel — E2E canary page (do not edit by hand)
canary_id: page
collection_label: page
slug: canary-page
sitemap: false
robots: noindex,nofollow
---
Adam Daniel — E2E canary page (do not edit by hand).

This URL exists so the automated end-to-end publish-loop tests have a stable
target to assert against on both preview-pr&lt;N&gt;.adamdaniel.ai and
adamdaniel.ai. The body is replaced during a test 



e2e-publish-loop:post:1777911685640

run and reset to this
baseline in cleanup, so the public URL always renders innocuous content
between runs.

If this is the only thing you can see, no test is currently in progress.
