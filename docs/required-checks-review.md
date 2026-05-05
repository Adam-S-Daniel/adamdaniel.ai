# Required-status-checks review (May 2026)

Audit of the `main` branch ruleset (id `13985217`) after the recent CI overhaul:
container conversion (#137/#138), Layer 1 path-filter cleanup (#138), Layer 2
dynamic e2e shard count (#139), Layer 3.A spec-metadata directives (#140),
per-test screenshot videos (#143), and Dependabot comment-sync (#144/#145/#146).

## Live ruleset snapshot

`gh api repos/Adam-S-Daniel/adamdaniel.ai/rulesets/13985217` (May 2026):

```
required_status_checks:
  - validate-content
  - scan
  - select
  - unit
  - parity
  - e2e (1)
```

## Local-vs-live drift (pre-existing)

`.github/rulesets/main.json` (pre-PR) listed `prod-mutate` in addition to the
six above — seven total contexts. `prod-mutate` was silently dropped from the
live ruleset some time after #138 promoted `cms-publish-loop-prod.yml` to a
workflow-level `paths:` filter (which makes the check missing on PRs that
don't touch the salient files — the missing-check trap). The live ruleset is
authoritative and correct; this PR reconciles the in-tree JSON to match.

## Per-check assessment

| Check | Workflow | PR behaviour | Always-fires? | Required today | Should be required? | Rationale |
|---|---|---|---|---|---|---|
| `validate-content` | cms-editorial-workflow | always (no `paths:`) | yes | YES | YES | <2 min budget, gates content correctness, no missing-check risk. Keep. |
| `scan` | secrets-scan | always (no `paths:`) | yes | YES | YES | Secret-leak gate must run on every diff. Keep. |
| `select` | e2e-tests | runs except docs-only PRs (`paths-ignore` on the workflow) | yes when e2e fires | YES | YES | Drives shard fanout; e2e is meaningless without it. Keep. |
| `unit` | e2e-tests | as above | yes when e2e fires | YES | YES | Plain-Ruby plugin tests + bash harness tests, ~30 s. Keep. |
| `parity` | e2e-tests | as above | yes when e2e fires | YES | YES | `@parity` subset against prod. No `needs:` from `select`, so a stuck selector can't block it. Keep. |
| `e2e (1)` | e2e-tests | as above; shard 1 always exists per `pickShardCount()` (returns 1 for `scope=skip`, ≥1 otherwise) and `case "$shard_count"` cases all include shard 1 | yes when e2e fires | YES | YES | Belt to `finalize`'s suspenders; shard 1 is contractually present. Keep. |
| `e2e (2)`, `e2e (3)`, `e2e (4)` | e2e-tests | only on subsets that hit the `≤6` / fanout brackets | NO — small subsets collapse to `[1]` | no | NO | Adding any of these would block small-subset PRs (the common case after #139). Don't add. |
| `finalize` | e2e-tests | runs whenever the e2e workflow fires (`if: !cancelled()`, `needs: [e2e]`); last step `Re-fail if any shard failed` re-emits failure when any shard failed | yes when e2e fires | no | YES (PROPOSED) | A roll-up of the matrix that doesn't depend on the shard-name spelling. Adding it gives "any-shard-failed" coverage that survives a future shard rename or count change without a ruleset edit. |
| `prod-mutate` | cms-publish-loop-prod | conditional on `paths:` (post-#138) | NO | not in live; in-tree JSON only (drift) | NO | Workflow-level `paths:` makes this miss on most PRs — classic missing-check trap. Remove from in-tree JSON. |
| `host-loop` | cms-publish-loop-host | conditional on `paths:` | NO | no | NO | Same trap as `prod-mutate`. |
| `deploy-preview` | deploy-preview | conditional (`paths-ignore`) | NO | no | NO (status quo) | Path-filtered, so missing-check trap. Also: a broken preview means the PR's preview URL doesn't render, but core merge correctness (content validity, tests, secrets) is independently gated. Document and skip. |
| `teardown-preview` | deploy-preview | only on PR `closed` | NO | no | NO | By definition runs after merge intent; can't be a pre-merge gate. |
| `auto-merge` (dependabot-auto-merge) / `auto-merge-when-ready` (cms-editorial-workflow) | their workflows | gates that drive merge | n/a | no | NO | Self-deadlock — these are the things waiting on required checks; making them required breaks the gate. |
| `approve-regression` | visual-regression | conditional on `paths:` (positive list) | NO | no | NO (status quo, but verify) | Path-filtered to site source / regression tooling. Missing-check trap on docs-only PRs. The previous AGENTS.md already noted this isn't required; the regression video is a human-review aid that doesn't need to be a hard merge gate now that the regression-review environment auto-passes when the diff count is zero. |
| `sync` (dependabot-comment-sync) | dependabot-comment-sync | only on Dependabot PRs touching workflow files (`pull_request_target`) | NO | no | NO | Trigger event is `pull_request_target`, doesn't show up on regular PRs at all. |

## Recommendation

**Add** to required-status-checks:

- `finalize` — roll-up of the e2e matrix; survives shard-name changes; re-fails
  when any shard failed.

**Remove** from in-tree JSON (drift reconciliation):

- `prod-mutate` — already removed from the live ruleset; remove from
  `main.json` so the file matches reality.

**Keep** unchanged:

- `validate-content`, `scan`, `select`, `unit`, `parity`, `e2e (1)`.

Final required list (8 → 7 → 7-with-finalize, see migration steps):

```
validate-content
scan
select
unit
parity
e2e (1)
finalize
```

### Trade-offs

1. **`finalize` vs. `e2e (N)` shards.** `finalize` is name-stable across shard
   renames and dynamic counts; if a future tweak renames `e2e (1)` to `e2e-1`,
   the required check goes missing and every PR is blocked. `e2e (N)`s are
   explicit per-shard signals, but require ruleset edits whenever the shard
   contract changes. Recommendation keeps `e2e (1)` AS WELL AS `finalize` for
   belt-and-suspenders coverage.

2. **`finalize` masking shard-specific issues.** `finalize` re-fails when any
   shard fails, so it can't mask a shard-1 failure. It can mask which shard
   failed (the developer has to click into the run log), but that's a UX
   concern, not a correctness one.

## Migration steps

1. Merge this PR. The in-tree `.github/rulesets/main.json` is now updated.
2. Apply the new ruleset to the live `main` branch:

   ```bash
   gh api -X PUT repos/Adam-S-Daniel/adamdaniel.ai/rulesets/13985217 \
     --input .github/rulesets/main.json
   ```

3. Verify with:

   ```bash
   gh api repos/Adam-S-Daniel/adamdaniel.ai/rulesets/13985217 \
     --jq '.rules[] | select(.type=="required_status_checks") | .parameters.required_status_checks[].context'
   ```

   Expected output (one per line, in this order):

   ```
   validate-content
   scan
   select
   unit
   parity
   e2e (1)
   finalize
   ```

4. Open a tiny throwaway PR (e.g. a comment-only edit) and confirm it shows
   the new `finalize` check in `gh pr checks <N>`, blocks merge until green,
   and clears once the e2e workflow finishes.

## Things explicitly NOT changing

- `e2e (2..4)`: stay non-required; would block small subsets.
- `prod-mutate`, `host-loop`, `deploy-preview`, `approve-regression`: stay
  non-required; all path-filtered, all missing-check traps if promoted.
- `auto-merge*`: stay non-required; would self-deadlock.
- `sync` (dependabot-comment-sync): irrelevant — runs on
  `pull_request_target`, not the regular PR check surface.
