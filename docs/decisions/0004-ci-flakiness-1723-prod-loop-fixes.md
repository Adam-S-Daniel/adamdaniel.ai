# 0004. Fix the #1723 CI-flakiness classes without weakening the prod-loop guarantees

**Status:** Accepted
**Date:** 2026-05-27
**Tags:** ci, prod-loops, jekyll, playwright, flakiness

## Context

Issue #1723 audited recurring CI reds and grouped them into six "flakiness"
classes. Two of them blocked or dominated CI:

- **Cat 1 (dominant):** the prod-mutate + media loops timed out on the in-spec
  `waitForChangeReflected` URL wait. The audit hypothesised a **deploy
  backlog**: the shared `production` lane (`deploy-production.yml`,
  `cancel-in-progress: false`) serialises every deploy, so a loop's own canary
  deploy sits queued past the blind 900 s budget.
- **Cat 2 (PR-blocker):** `fixture-baseline.test.js` (required `e2e (1)`) reds an
  *unrelated* PR whenever a prod loop has a canary at `published: true` on `main`
  at the moment the PR's merge-ref is computed (it blocked #1715).

While fixing Cat 1 we made the wait **queue-aware** with a *sharpened* failure
message ("lane idle → chain never fired" vs "still draining a backlog"). That
diagnostic immediately disproved the backlog hypothesis: a failing prod-mutate
run's published PR had merged and deployed (the merge commit *contained* the run
marker), yet the URL never reflected it. The `deploy-production` build log gave
the real cause:

```text
Skipping: _posts/2099-01-01-e2e-mutation-canary.md has a future date
Skipping: _posts/2099-01-03-e2e-media-roundtrip.md has a future date
```

The canaries are dated **2099**, and Jekyll's default `future: false` **skips
future-dated posts even when `published: true`**. So `/blog/e2e-mutation-canary/`
404'd forever and the reflect-wait timed out *every* run. The future date was an
attempt to keep the canary hidden; it instead made the spec's premise
(publish → URL serves) impossible. The host loop passed only because its `_e2e/`
and 2024-dated canaries aren't future-dated.

## Decision

Fix each class at its true root cause, and **lint-lock** every fix so it can't
silently regress (see AGENTS.md "CI-flakiness invariants (#1723)"):

1. **Set `future: true` in `_config.yml`** so the published canaries build. Safe
   because scheduling here is `published: false` + `publish_date`
   (`publish_scheduled_posts.py`), not future-dates, and the *only* future-dated
   posts in the repo are the two `published: false` canaries (still skipped at
   baseline; built only when a spec publishes them). `test_fixture: true` posts
   are excluded from the homepage + blog index so a briefly-published canary
   serves only at its own `/blog/<slug>/` URL.
2. **Queue-aware reflect wait, gated on the user-facing URL — not the GHA API.**
   `deploy-pill.js` stays DOM-pure; an injected `onBudgetExhausted`
   (`makeDeployQueueExtender`) probes the deploy lane's *activity* (in-flight or
   recently cycling → extend; genuinely quiescent → fail fast as a real miss).
3. **Diff-aware canary baseline assertion.** The `select` job emits the
   `PROD_FIXTURES` the PR's own diff touched; the assertion enforces a canary's
   `published: false` only for touched fixtures on a `pull_request`.
4. **`await-prod-deploy` step 2 defers a superseded conclusion to step 3's
   ground-truth descendant check** (extends #1714 to step 2).
5. **Drift-guard the ci-runner Dockerfile `ARG PLAYWRIGHT_IMAGE_TAG`** (not just
   workflow files, which no longer reference the raw image) + an install-on-miss
   `globalSetup` fallback.
6. **`parity-preview` / `preview-media` require a preview only for
   render-affecting PRs** (`RENDER_FANOUT_PATTERNS`), and `preview-media-resolves`
   runs only under its dedicated workflow's reachability-gated opt-in.

## Consequences

- The prod-mutate + media loops can actually go green (publish → build → serve →
  reflect → unpublish), and a genuine "chain never fired" now surfaces with an
  actionable message instead of a 15-minute mystery timeout.
- An unrelated PR is no longer red-failed by a prod loop's transient `main`
  state; e2e/CI-only PRs no longer trip `parity` for want of a preview (no more
  per-PR owner override).
- `future: true` means *any* future-dated published post would build. That's
  acceptable only because this repo schedules via `published`, not dates — the
  invariant is now lint-locked (`fixture-baseline.test.js` fails if a canary is
  future-dated while `future: true` is absent). A contributor who wants a
  scheduled post must use `published: false` + `publish_date`.
- A briefly-published canary is in `feed.xml` for the ~10-min test window
  (jekyll-feed has no per-post exclude); it is `noindex`, `sitemap: false`, and
  absent from the on-site listings. Acceptable for the playground prod.

## Alternatives considered

- **Past-date the canaries instead of `future: true`.** Consistent with the
  working 2024 unpublish canary and avoids a site-wide build flag, but renaming
  `_posts/2099-*` ripples through `PROD_FIXTURES`, `select-specs` rules, the
  recursion-churn map, the spec constants, the Decap branch name, and several
  workflow path filters — high blast radius for no extra safety, since
  `published: false` already hides the canary. Rejected for risk; `future: true`
  is one line + a lint-lock.
- **Keep the blind 900 s budget but make it bigger.** Doesn't distinguish a real
  miss from a backlog and would only have masked the future-date bug longer.
- **Make the in-spec wait poll the deploy run via the GHA API (issue mitigation
  #1).** Contradicts `deploy-pill.js`'s deliberate "gate on the user-facing
  signal, not the mechanism" design. We kept the URL as the success gate and used
  the API only to decide *whether to extend*.
- **Exclude the canaries from the required `fixture-baseline` check entirely
  (issue mitigation, Cat 2).** Loses the "a PR can't commit a stuck
  `published: true`" protection. The diff-aware approach keeps it for PRs that
  touch the canary.

## References

- Issue #1723 (audit + closeout comments)
- PRs: #1727 (Cat 2), #1728 (Cat 3), #1729 (Cat 5), #1730 (Cat 1 wait),
  #1735 (Cat 4), #1736 (Cat 6 JSON), #1740 (parity render-only fanout),
  #1751 (code-quality merge-base), #1753 (`future: true` root-cause fix),
  #1754 (activity-aware idle probe)
- `deploy-production` build log showing `Skipping: …-canary.md has a future date`
  (deploy of merge `a4210e6c`, run 26487689695)
