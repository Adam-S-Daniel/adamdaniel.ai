# Preview-PR mimicry for CMS draft branches — discovery memo

**Status:** spike (Phase A3 — direction, not completeness).
**Goal:** decide whether each in-progress CMS entry can live on a long-lived
`cms/<slug>` branch with its own preview env, the way `preview-pr-<N>`
works for code today.

## What `main` is governed by today

`.github/rulesets/main.json` enforces, on `refs/heads/main`: `deletion`
block, `non_fast_forward`, `pull_request` (every change via PR — what
forced `seedFixtureViaPr` in the publish-loop spec), and a full
`required_status_checks` list (`validate-content`, `scan`, `select`,
`unit`, `parity`, `e2e (1)`, `finalize`).

`.github/rulesets/cms-feature-branches.json` already governs `cms/**`,
`feat/**`, `fix/**`, etc. with the lighter set: `non_fast_forward`,
`pull_request` (squash/merge, 0 reviewers), and `validate-content` as
the single required check (the issue #79 fix for "unstable" merge state).

## Which `main`-rules need to apply to long-lived `cms/<slug>` branches

- **`deletion`** — Yes. Decap needs the branch to exist while the draft
  is open; accidental deletion orphans the draft.
- **`non_fast_forward`** — already inherited from `cms-feature-branches.json`.
- **`pull_request` rule** — No. On `cms/<slug>` we *want* Decap's
  Contents-API per-keystroke commit to keep working.
- **Full `required_status_checks` list** — No. Promoting `e2e (1)` /
  `finalize` makes every Save burn 7 min of CI. Keep just
  `validate-content`.

So the only delta the new ruleset adds on top of `cms-feature-branches.json`
is **deletion-block**.

## Decap support for per-entry `backend.branch` — verdict

`backend.branch` is a **single global string** in Decap's GitHub backend
(confirmed against [Decap docs](https://decapcms.org/docs/) — backends
overview, configuration options, editorial workflow). **No per-entry or
per-collection override exists.** What Decap already provides:
editorial workflow commits each Save to a `cms/<collection>/<slug>`
branch and opens a PR back to `backend.branch`. The branch persists
until merge/close; subsequent saves push more commits to it — so
**per-entry branching already exists**, always rebased on the single
configured `backend.branch`.

The user's vision (each `cms/<slug>` gets its own preview subdomain à la
`preview-pr-<N>`) needs **no Decap config change** — `backend.branch:
main` is already correct. What it requires is follow-up work *outside*
this spike:

1. `deploy-preview.yml` needs to publish a preview keyed on the
   `cms/<slug>` head branch, not just the parent feature-branch's PR
   number. Today it triggers on PRs into `main`; a Decap PR's head ref
   is `cms/<col>/<slug>`, but the preview subdomain comes from the
   parent PR number, not a slug-derived host.
2. The CloudFront router (or a sibling distribution) needs a route for
   `cms-<slug>.adamdaniel.ai` (or `preview-cms-<slug>.adamdaniel.ai`).
   The existing host→prefix Function is config-shaped, not
   architectural.
3. The `cms-content-branches` ruleset (this spike, Step 3) so deletion
   is gated.

None of (1)/(2) is in scope for this spike.

## Harness spec

`e2e/cms-preview-pr-self-contained.spec.js` is a real-but-skeleton
`@lane: real` Playwright spec that exercises today's `cms/<slug>` flow
end-to-end (Save → PR → preview env → label flip → merge). Once the new
model is implemented, the spec gets extended (not replaced) to assert
the per-slug preview URL is reachable.
