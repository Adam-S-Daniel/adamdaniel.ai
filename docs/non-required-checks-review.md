# Non-required CI checks review (May 2026)

Companion to `docs/required-checks-review.md`. That review covered which
checks should be **required** to gate merges to `main`; this one covers
every check that fires on a PR but is **not** in the required-status-checks
list. For each check we apply the per-(check × scenario) rubric:

- **A — keep non-required, keep running.** The check is informational, slow,
  flaky, optional, or otherwise unsuitable as a hard merge gate, but
  worth the cost to surface signal to humans / agents.
- **B — narrow scope so the check stops firing in this scenario.** Tighten
  `paths:`, `if:`, or trigger so the check no longer appears for that PR
  shape. Reduces noise without losing real coverage.
- **C — promote to required** (`.github/rulesets/main.json`). Only valid if
  the check ALWAYS fires when its workflow fires AND the workflow ALWAYS
  fires when the PR has the right shape. Path-filtered, label-gated,
  schedule-only, dispatch-only, or otherwise conditional checks fail
  this test (the missing-check trap, see existing `_comment` in
  `main.json`).

## Live required-status-checks (May 2026, post-#148)

```
validate-content   (cms-editorial-workflow.yml)
scan               (secrets-scan.yml)
select             (e2e-tests.yml)
unit               (e2e-tests.yml)
parity             (e2e-tests.yml)
e2e (1)            (e2e-tests.yml)
finalize           (e2e-tests.yml — in-tree only; live `gh api -X PUT` pending)
```

## PR scenarios considered

| ID | Scenario | Example PR | Trigger shape |
|---|---|---|---|
| S1 | Human PR with non-doc code change | #147 (ci/fix-firefox-home), #148 (ci/required-checks-review) | `pull_request`, head not `cms/*`, actor not `dependabot[bot]` |
| S2 | Doc-only PR (entire diff is `paths-ignore`d by e2e-tests.yml) | #149 (docs/audit-after-ci-overhaul) | `pull_request`, head not `cms/*`, all changed paths in e2e-tests.yml's `paths-ignore` |
| S3 | CMS-published PR | #131, #137, #142 (cms/posts/*, cms/e2e/*) | `pull_request`, head starts with `cms/` |
| S4 | Dependabot PR | #135, #121, #116 | `pull_request` and `pull_request_target`, actor `dependabot[bot]` |

## Per-(check × scenario) decisions

Order: by workflow, then by check name. One row per (check × scenario)
pair; rows where the check doesn't fire are listed only when the
behaviour is non-obvious (so a future reader can confirm "this case is
handled" without re-deriving it from the workflow YAML).

### `e2e-tests.yml` — non-required jobs

| # | Check | Scenario | Fires? | Decision | Justification |
|---|---|---|---|---|---|
| 1 | `e2e (2)` | S1 | only on subsets ≤6 / fanout brackets (per `pickShardCount`) | A | Shards 2-4 always reflect real coverage when present. Promoting any of them to required would block small subsets that collapse to `[1]` (the common case post-Layer-2). |
| 2 | `e2e (3)` | S1 | as above | A | Same as #1. |
| 3 | `e2e (4)` | S1 | as above | A | Same as #1. |
| 4 | `e2e (2..4)` | S2 | doesn't fire (workflow `paths-ignore` skips entirely) | n/a | See "doc-only PR missing-check trap" below — the issue is that `e2e (1)` doesn't fire either, and `e2e (1)` IS required. Fixing the trap fixes this row implicitly. |
| 5 | `e2e (2..4)` | S3 | fires when shard count ≥ 2 (post-Layer-3.A select-skip directives generally collapse cms/* to subsets) | A | Same as S1; the dynamic shard count is the right design. |
| 6 | `e2e (2..4)` | S4 | fires (most Dependabot PRs are non-trivial enough to fan out) | A | Same. |

### `cms-editorial-workflow.yml` — non-required job

| # | Check | Scenario | Fires? | Decision | Justification |
|---|---|---|---|---|---|
| 7 | `auto-merge-when-ready` | S1 | only on `labeled` events with `cms/ready` or `decap-cms/ready`; PRs the label-add doesn't reach show "Skipped" | A | The `labeled` event is the trigger that DRIVES merge for the editorial workflow — it's the gate, not gated. Promoting it would self-deadlock. |
| 8 | `auto-merge-when-ready` | S2/S3/S4 | same condition (any actor adding the label triggers it) | A | Same. |

### `cms-publish-loop-prod.yml`

| # | Check | Scenario | Fires? | Decision | Justification |
|---|---|---|---|---|---|
| 9–12 | `prod-mutate` | S1–S4 | **never on a PR** — the trigger moved from `pull_request` to `push` (main) with the same `paths:` allowlist (PR #1067). The spec drives a REAL prod mutation, so firing it per-PR raced the shared canary + the deploy-production queue and flaked; it now runs post-merge, serialized on pushes to `main`, plus `workflow_dispatch`. | A | Not a PR status context at all, so the missing-check trap is moot. Real prod-mutation coverage still runs (post-merge + manual); can't and need not be required. |

### `cms-publish-loop-host.yml`

| # | Check | Scenario | Fires? | Decision | Justification |
|---|---|---|---|---|---|
| 13 | `host-loop` | S1 | only when PR diff matches `paths:` allowlist | A | Path-filtered. Real end-to-end CMS publish-loop coverage when it fires; can't be required without converting to always-run + early-skip. |
| 14 | `host-loop` | S3 | always SKIPPED via job-level `if: !startsWith(github.head_ref, 'cms/')` (recursion guard — the spec ITSELF opens cms/* PRs) | A | Recursion guard is correct: without it, a cms/* PR re-triggers this same workflow on its own PR, creating a publish-loop infinite recursion. The skip is a feature; the check shows up as Skipped in the PR list. |
| 15 | `host-loop` | S2 | doesn't fire (paths) | A | Correct — nothing salient changed. |
| 16 | `host-loop` | S4 | fires when Dependabot bumps allowlisted paths (workflows, package*.json, _config.yml, _layouts/{canary,default}.html); has run+failed historically (PR #135) | A | Path-filtered, can't be required. |

### `deploy-preview.yml`

| # | Check | Scenario | Fires? | Decision | Justification |
|---|---|---|---|---|---|
| 17 | `deploy-preview` | S1 | fires unless diff is fully `paths-ignore`d (mostly the same negative-list as e2e-tests.yml) | A | Preview environment is a human-review aid, not a correctness gate. Build/deploy failures are visible in the PR's check list and the bot comment is missing — both adequate signals for a reviewer. Path-filtered → missing-check trap if promoted. |
| 18 | `deploy-preview` | S2 | doesn't fire (`paths-ignore` matches docs) | A | Correct — a doc-only PR can't change preview output. |
| 19 | `deploy-preview` | S3 | fires (cms PRs touch `_posts/`, `_projects/`, etc., none of which are in `paths-ignore`) | A | Same as S1. |
| 20 | `deploy-preview` | S4 | SKIPPED for Dependabot via job-level `if: github.actor != 'dependabot[bot]'` — Dependabot can't access OIDC role secret | A | Correct gate. The skip is intentional; preview-bucket access requires the AWS role. |
| 21 | `teardown-preview` | all | only on PR `closed`, never on `opened`/`synchronize` | A | By definition runs after merge intent. Can't be a pre-merge gate (the PR is already closed). |

### `dependabot-auto-merge.yml`

| # | Check | Scenario | Fires? | Decision | Justification |
|---|---|---|---|---|---|
| 22 | `auto-merge` | S1/S2/S3 | always SKIPPED via job-level `if: github.actor == 'dependabot[bot]'` | A | The skip is correct; non-Dependabot PRs shouldn't auto-merge through this workflow. Promoting would block every non-Dependabot PR forever. |
| 23 | `auto-merge` | S4 | fires; its purpose IS the merge gate (enables GH native auto-merge) | A | Self-deadlock if required: this check waits on every other required check, then enables auto-merge — but if `auto-merge` were itself required, it'd wait on itself. |

### `dependabot-comment-sync.yml` — `pull_request_target` workflow

| # | Check | Scenario | Fires? | Decision | Justification |
|---|---|---|---|---|---|
| 24 | `sync` | S1/S2/S3 | always SKIPPED via job-level `if: github.event.pull_request.user.login == 'dependabot[bot]'` | A | Correct — the workflow's whole point is refreshing version-comments on Dependabot bumps. Shouldn't fire on any other PR, and `pull_request_target` is the trigger we explicitly need (workflow-file push permissions). |
| 25 | `sync` | S4 | fires; depends on `secrets.ADAMDANIELAI_WORKFLOW_SHA_COMMENT_PAT` being set; bails early with a notice when not | A | Path-filtered + secret-conditional + `pull_request_target` trigger — three independent conditions mean it can't be in the required list (any one of them missing creates the trap). The check is informational: it ensures action-pin comments stay in sync with the SHA Dependabot just bumped to. |

### `visual-regression.yml`

| # | Check | Scenario | Fires? | Decision | Justification |
|---|---|---|---|---|---|
| 26 | `generate` | S1 | fires when diff matches `paths:` (positive list of site-source + pipeline tools) | A | Generates the visual-diff video + PR comment. Path-filtered → missing-check trap if promoted. The signal is human-review-grade; the regression-review GH Environment is the actual merge gate when there ARE diffs. |
| 27 | `generate` | S2 | doesn't fire (positive-list paths don't match) | A | Correct — a doc-only PR can't shift rendered output. |
| 28 | `generate` | S3 | fires (cms PRs touch `_posts/`, `_projects/`, etc.) | A | Same as S1. |
| 29 | `generate` | S4 | fires for `bundler/` Dependabot ecosystem only (Jekyll plugin bumps); skipped via job-level `if:` for `npm`/`github-actions` | A | The ecosystem gate is correct: npm/github-actions Dependabot bumps can't change rendered HTML. |
| 30 | `approve-regression` | all that fire | runs after `generate`; environment is `regression-review` only when `visually-different != 0`, otherwise empty (auto-pass) | A | The actual merge gate — but it's enforced via `environment: regression-review` (Settings → Environments → required reviewers), not via the required-status-checks list. Two reasons not to also list it as required: (a) it's path-filtered (inherits `generate`'s paths), so missing-check trap; (b) the GH Environment system is already the merge-blocker, doubling-up adds nothing. |

### `secrets-scan.yml`

| # | Check | Scenario | Fires? | Decision | Justification |
|---|---|---|---|---|---|
| (already required as `scan`; included here for completeness — no non-required jobs) ||||||

### `skills-mirror.yml`

| # | Check | Scenario | Fires? | Decision | Justification |
|---|---|---|---|---|---|
| 31 | `verify (ubuntu-latest)` | S1 | fires when diff matches `paths:` (skills, bootstrap scripts, the workflow itself) — narrow + recently-tightened (#122) | A | Verifies the skills-mirror invariant (`.agents/skills/` ↔ `.claude/skills/` symlink integrity). Path-filtered to only the files it covers; missing-check trap if promoted. The matrix entry pair gives Linux+Windows coverage; both should pass before merging the skills mirror but the verify itself is a structural lint, not site correctness. |
| 32 | `verify (windows-latest)` | S1 | as above | A | Same as #31. |
| 33 | `verify (*)` | S2 | doesn't fire when `docs/**` is the only diff but DOES fire when `tests/**` or workflow YAMLs change (PR #149 hit it because the diff included AGENTS.md + workflow YAMLs) | A | The `tests/**` + workflow path entries are correct: a workflow change should run the cross-platform verify. |
| 34 | `verify (*)` | S3 | usually skipped (cms PRs don't touch skills paths) | A | Correct — pure content edits don't perturb the skills mirror. |
| 35 | `verify (*)` | S4 | fires for workflow-YAML / dependabot-touched-paths bumps | A | Path-filtered correctly. |

## Doc-only PR missing-check trap (separate from this audit, flagged)

PR #149 is an active example: actor=`Adam-S-Daniel`, head=`docs/audit-after-ci-overhaul`, diff matches `e2e-tests.yml`'s `paths-ignore`. Result on the live ruleset:

- `validate-content` ✅ (no path filter on `cms-editorial-workflow.yml`)
- `scan` ✅ (no path filter on `secrets-scan.yml`)
- `select`, `unit`, `parity`, `e2e (1)`, `finalize` ❌ MISSING — workflow didn't fire, branch protection blocks the merge as designed

The `_comment` in `main.json` already calls this out: "the owner can override or the PR can be expanded with a small site change". The user has indicated they'll admin-override #149. Two architectural fixes are possible — both are out of scope for this audit but recommended as follow-ups:

1. **Drop the doc paths from `paths-ignore`.** Cheap, but every doc PR pays ~10-20 min of runner time for the e2e + parity build-up. Hot path for an Adam-only docs workflow.

2. **Synthetic-success on doc-only PRs (recommended).** Add a small sibling `e2e-required-stub.yml` workflow triggered on PR with the COMPLEMENT of `paths-ignore` — i.e., `paths:` listing only the doc patterns. It defines five trivial jobs named exactly `select`, `unit`, `parity`, `e2e (1)`, `finalize` that each `echo "doc-only PR; e2e-tests.yml correctly skipped"` and exit 0. GitHub merges status checks by name across workflows: when the real e2e-tests.yml runs (S1/S3/S4), the stub doesn't, so the real `e2e (1)` reports its real status; when the real e2e-tests.yml is skipped (S2 doc-only), the stub fires and stamps the same five names with success. The required check is satisfied either way.

Trade-off summary:

| Option | Cost on doc PRs | Cost on code PRs | Risk |
|---|---|---|---|
| Drop `paths-ignore` from e2e-tests.yml | ~20 min runner + Playwright bring-up | unchanged | low — just slower docs PRs |
| Synthetic-success stub workflow | ~10 s | unchanged | medium — duplicate-name mechanism is non-obvious; needs an `_comment` and an AGENTS.md note. Future shard-rename in real e2e-tests.yml requires a paired stub-rename |
| Status quo (admin override per doc PR) | 0 | unchanged | low/none for current owner-only repo, but breaks if a contributor opens a doc-only PR |

The audit's recommendation is option 2 (synthetic stub) as a follow-up PR. It preserves the e2e-on-real-changes-only cost model and unblocks doc PRs without admin override. **NOT included in this audit's PR**, per the user's "don't fix #149" instruction.

## Architectural follow-ups (separate PRs)

1. **Doc-only PR stub workflow** (above). Unblocks the missing-check trap without admin override.
2. **`approve-regression` Environment vs. required check:** today the merge-gate behaviour comes from `environment: regression-review` (Settings → Environments). If/when the `visual-regression.yml` workflow is converted to always-run + early-skip, `approve-regression` could become a real required check; today it can't.
3. **`prod-mutate`/`host-loop` always-run + early-skip refactor:** if either is ever wanted as a required check (e.g. the publish-loop is the regression target for an editorial-workflow change), refactor to the always-run + early-skip pattern documented in AGENTS.md "Workflow path-filtering rule" first. Currently neither would survive the missing-check check.
4. **`finalize` ruleset push:** the in-tree ruleset adds `finalize` (drift fix from #148). Once the user runs `gh api -X PUT repos/Adam-S-Daniel/adamdaniel.ai/rulesets/13985217 --input .github/rulesets/main.json`, the live and in-tree match. Surface in the audit PR body.

## Not changed

This audit's recommendation is to **keep every non-required check non-required and continue running it** (decision A across the board). Each path-filtered, label-gated, or actor-conditional check has been verified against the rubric: promoting any of them would create a missing-check trap. No workflow `paths:` or `if:` filters need narrowing — every existing filter has a documented rationale in this PR's table.

The audit's only ruleset change is the previously-staged drift fix from #148 (add `finalize`, remove `prod-mutate`), already in-tree and unchanged by this PR. The `gh api -X PUT` command in the PR body re-applies it to the live ruleset.
