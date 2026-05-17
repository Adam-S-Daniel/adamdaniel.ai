---
title: Safely Keep Your Agent Iterating Autonomously With Gitleaks and PR Comments
date: 2026-05-17 08:46:00 -0400
published: true
---
“A practical fix if you want me to keep iterating autonomously: add a post-failure step to e2e-tests.yml that posts the relevant Playwright output as a PR comment with a marker (e.g. <!-- e2e-failure-summary -->). The MCP pull_request_read get_comments method can read PR comments — so the next time CI fails, I’d see the failure verbatim without needing you to paste it. Lightweight, keeps the existing artifact upload as-is. Want me to add that?”

Me: Yes, add that with a secrets-scrubbing feature that leverages whichever OSS secrets detection tool you evaluate as most appropriate. 




It used gitleaks. I should put this in my agents.md




“CI will exercise the new failure-summary bot on the next run; if the \[e2e testing workflow] still fails, the failure blocks will appear as a PR comment so I can iterate without you pasting logs.”
