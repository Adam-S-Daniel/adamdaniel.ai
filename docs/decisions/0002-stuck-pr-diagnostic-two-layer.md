# 0002. Diagnose stuck PRs via a two-layer, always-exit-0, read-only catch

**Status:** Accepted
**Date:** 2026-05-14
**Tags:** ci, diagnostics, publish-loop, e2e

## Context

Long-wait helpers in this repo — `waitForMerge`, `fetchPublicUrl`,
`waitForChangeReflected`, `waitForCmsPullRequest`, `waitForWorkflowRun`,
`waitForAutoMergeEnabled` — all die with a clear message of the form
`Timed out waiting for PR #N to merge` or `Timed out waiting for <url>`,
but say nothing about WHY the thing they were waiting on never happened.
The proximate cause is almost always **another** PR upstream:

- `BLOCKED` by a failing required check
- `DIRTY` with a real conflict
- `DIRTY` with a newline-only conflict that
  `auto-resolve-newline-conflict.yml` would close on its next tick
- Or a queued `deploy-production.yml` run holding the production deploy
  lane while the test waits for a URL to flip

In each case an operator triaging the failure has to manually run
`gh pr list`, eyeball `mergeable_state`, cross-reference workflow runs,
and decide whether to wait, rebase, or kick a workflow. The
[`cms-stuck-pr-triage`](../../.agents/skills/cms-stuck-pr-triage/SKILL.md)
skill captures that pattern, but it still requires a human or an agent
to read the failed-test comment, recognize the symptom, and walk the
diagnosis manually. The user's stored feedback says it explicitly: when
publish-loop / canary workflows look "stuck," the cause is almost
always a BLOCKED PR with stale CI — but it can take a couple of
minutes per incident to confirm that.

We wanted that triage step to happen automatically and arrive in the PR
conversation, so the next person opening the failed run sees the
suspect upstream PR named (or sees "the diagnostic ran and didn't find
anything obvious") before they have to investigate.

## Decision

Add a **two-layer** stuck-PR diagnostic that fires on `Timed out
waiting …` failures and posts a Markdown report into the failing PR's
conversation:

1. **In-spec layer** — `e2e/with-stuck-pr-diagnostic.js` exports
   `augmentTimeoutError(err, hint)`. Each `Timed out waiting for …`
   `throw` site in `e2e/github-actions-poll.js` and `e2e/deploy-pill.js`
   wraps. The wrapper spawns `scripts/diagnose-stuck-pr.js` and appends
   its Markdown to `err.message`. The augmented error lands in the
   Playwright HTML report and in the scrubbed PR comment posted by the
   existing `post-failure-comment` action.

2. **Workflow-level layer** — each long-running publish-loop workflow
   (`cms-publish-loop-host.yml`, `cms-publish-loop-prod.yml`,
   `cms-publish-loop-preview.yml`) gains two `if: failure()` post-steps
   that re-run the same diagnostic and post a labelled comment when the
   captured `/tmp/<workflow>.log` contains the line `Timed out
   waiting`. This catches the case where Playwright's outer 40-minute
   timeout kills the test before any individual wait helper got to
   throw, so the in-spec wrapper never ran.

`scripts/diagnose-stuck-pr.js` is the single classifier shared by both
layers. It is **read-only by construction**, has a hard 25-second
internal timebox, **always exits 0**, and is wrapped in a 30-second
outer budget at the spec layer. It can be disabled with
`NO_STUCK_PR_DIAGNOSTIC=1`. It re-uses `canonical()` and
`HEAD_REF_ALLOWLIST` from `scripts/auto-resolve-newline-conflict.js` so
its newline-only-conflict classification stays in sync with what the
auto-resolver will actually do on its next run.

Wired only into the three publish-loop workflows. `canary-prod.yml` and
`e2e-tests.yml` are intentionally out of scope (see "Alternatives
considered" below).

## Consequences

### Positive

- **Stuck-PR cause shows up in-band.** Operators reading the failed
  run's PR conversation see the suspect upstream PR named, with
  `mergeable_state`, failing required checks, deploy-queue counts, and
  whether `auto-resolve-newline-conflict.yml` will close the conflict
  on its own. Time-to-diagnose drops from a few minutes of manual `gh`
  spelunking to one read of the comment.
- **No back-doors.** The diagnostic is read-only — it never mutates PR
  state, never re-triggers workflows, never closes PRs. A future
  contributor cannot accidentally make the diagnostic introduce the
  kind of bug it was meant to catch.
- **Safe under `PROD_CANARY=1`.** Because it never writes, it is
  trivially safe to run on the production-mutating canary path.
- **Failure-mode hygiene.** Workflow-level steps are gated on
  `grep -q 'Timed out waiting' /tmp/<workflow>.log` — a non-timeout
  failure (compile error, DOM assertion, syntax error) does NOT trigger
  the diagnostic. Operators investigating a different bug class don't
  get a misleading "stuck PR" comment they have to disregard.
- **The two layers cover orthogonal cases.** The in-spec layer fires
  inside the test process and produces the richest error message
  possible in the Playwright report. The workflow-level layer fires
  even when the in-spec layer didn't get a chance to run, so the
  outer-timeout-kill case isn't a blind spot.
- **Stays in sync with the auto-resolver.** Importing `canonical()` and
  `HEAD_REF_ALLOWLIST` from `scripts/auto-resolve-newline-conflict.js`
  means a future change to the auto-resolver's newline-canonicalisation
  rules is automatically reflected in the diagnostic's "the
  auto-resolver will close this" classification. The two systems
  cannot drift.

### Negative

- **One more place to keep in sync when adding a new long-wait helper.**
  A new wait helper that throws `Timed out waiting for …` does NOT
  automatically get the diagnostic — it needs an explicit
  `augmentTimeoutError(…)` wrap at the throw site. Mitigation: the
  helper's reviewer notices the missing wrap, or the next stuck-PR
  incident surfaces the gap. The locked-in invariant
  (`shouldRunDiagnostic` only fires when a GH token is present) keeps
  unit-test runs of the wait helpers themselves quiet without manual
  flagging.
- **Two GitHub-API call budgets per failure.** When both layers fire on
  the same run (rare; usually only one will), they each spend up to
  ~10 API calls. Still well under any token quota.
- **`canary-prod.yml` and `e2e-tests.yml` are blind spots.** They
  surface timeouts via different paths (issues vs PR comments; many
  sharded jobs vs one); wiring them in needs a different surfacing
  contract. Captured as a future follow-up rather than forced into v1.
- **One more cross-script dependency.** `scripts/diagnose-stuck-pr.js`
  now imports from `scripts/auto-resolve-newline-conflict.js`. Renaming
  or restructuring either script breaks the other. Tests on both sides
  catch this; the import is intentional (see Positive bullet on
  staying in sync).

## Alternatives considered

### Single-layer: in-spec wrapper only

Wrap every `Timed out waiting …` throw and rely on the augmented error
message landing in the Playwright HTML report and in the
`post-failure-comment` PR comment. Rejected because Playwright's outer
per-test timeout (40-minute cap in this repo, see
`feedback_playwright_action_timeout`) kills the test process BEFORE the
in-spec throw fires. In that case the wrap never runs and the operator
gets the unhelpful generic outer-timeout error with no diagnostic. The
workflow-level layer exists exactly to cover that case.

### Single-layer: workflow-level step only

Drop the in-spec wrapper; run the diagnostic only as a post-step on
workflow failure, gated on `grep 'Timed out waiting'` in the log.
Rejected because (a) the in-spec layer attaches the diagnostic directly
to the failing test's error message, so the Playwright HTML report and
the failed-test PR comment both carry it — that's the surface most
operators look at first, and a workflow-level-only design loses it;
(b) the in-spec wrapper has process-local state (the exact PR being
waited on, the wait kind), so it can pass `WAIT_PR_NUMBER` and
`WAITING_FOR_KIND` to the script and get a sharper, target-PR-first
report. The workflow-level run has only the workflow's outer context.

### Make the diagnostic an auto-fixer

Have the script auto-rebase the BLOCKED PR, retry the failed required
check, or kick the queued deploy-production lane. Rejected because the
existing repo design separates "detect" from "fix" deliberately:
`auto-resolve-newline-conflict.yml` is the one auto-fixer, and it runs
on a known-narrow class of conflicts with an explicit allowlist of head
refs. Combining detection and remediation in one script would (a)
double the surface area for bugs that mutate production state, (b)
make the script no longer safe to run under `PROD_CANARY=1`, and
(c) hide the diagnostic from human review when the auto-fix succeeds —
which is exactly the case we want surfaced for pattern recognition.
Read-only diagnostic + targeted auto-resolver is the right factoring.

### Surface stuck-PR information without exiting 0

Let the diagnostic fail loudly when GitHub's API is unreachable, when
its 25-second timebox expires, or when the classification logic hits
an unexpected state. Rejected because a diagnostic that turns a real
failure into a redder one is worse than no diagnostic — operators
would start treating "stuck-PR diagnostic failed" as the headline and
miss the actual `Timed out waiting` bug. Errors instead land as a
`### Diagnostic itself failed` heading inside the report, where they're
visible but don't compete with the real failure for attention.

### Extend the cms-stuck-pr-triage skill instead

The existing
[`cms-stuck-pr-triage`](../../.agents/skills/cms-stuck-pr-triage/SKILL.md)
skill already encodes the manual diagnosis steps. We could leave it
there and rely on agents reading the skill on each incident. Rejected
because the skill helps humans/agents triage *after* they notice the
symptom and reach for the right tool — it doesn't automatically surface
the diagnosis in-band on every failure. The skill and this diagnostic
are complementary: the skill still applies when the diagnostic comes
back inconclusive, when a non-publish-loop workflow times out, or when
the failure mode isn't `Timed out waiting`. The skill's SKILL.md gains
a "Shortcut: look at the auto-generated diagnostic first" section to
point operators at the new comments.

### Wire `canary-prod.yml` and `e2e-tests.yml` now

Rejected for v1 scope. `canary-prod.yml` posts results to an issue, not
a PR — surfacing the diagnostic there needs a different
`post-failure-comment` invocation than the publish-loop wiring (issue
ID vs PR number). `e2e-tests.yml` runs many sharded jobs across the
browser matrix; the in-spec layer already covers the wait-helper case
there, and adding the workflow-level step to every shard would
multiply the API-call cost by the shard count for little additional
signal. Both are tracked as follow-ups, to be addressed if the
diagnostic proves out in the publish-loop case.

## How to verify

- `node --test scripts/diagnose-stuck-pr.test.js` — exercises the
  classifier with mocked `fetch` across each `mergeable_state`
  branch, the timebox hit, the rate-limit-floor degrade, and the
  `WAITING_FOR_KIND` biases.
- The next time a publish-loop run times out in production, the
  diagnostic should arrive as a labelled PR comment within ~30s of the
  failure. The PR description for #891 calls out the first-real-fire
  verification as a follow-up checkbox; if a fire happens and the
  comment does NOT land, the script's `### Diagnostic itself failed`
  section names the underlying API/timeout error.

## References

- PR [#891](https://github.com/Adam-S-Daniel/adamdaniel.ai/pull/891) —
  implements this decision (the diagnostic, both layers, the
  publish-loop wiring, the test suite, and the skill update).
- ADR [0001](0001-canary-body-widget-text.md) — the upstream stuck-PR
  symptom that prompted both #885 and this diagnostic; pre-fix, every
  publish-loop run had a roughly-perpetual `cms/e2e/canary-post` PR
  to triage.
- `scripts/diagnose-stuck-pr.js` — the read-only classifier (see file
  header for the in-file contract statement that mirrors this ADR).
- `scripts/auto-resolve-newline-conflict.js` — the targeted auto-fixer
  whose `canonical()` and `HEAD_REF_ALLOWLIST` the diagnostic re-uses
  to stay in sync.
- `e2e/with-stuck-pr-diagnostic.js` — the in-spec wrapper.
- `.agents/skills/cms-stuck-pr-triage/SKILL.md` — the manual-triage
  companion skill; the diagnostic is the "look here first" shortcut.
- [Decap CMS editorial workflow](https://decapcms.org/docs/editorial-workflows/)
  — context on why this repo has so many short-lived `cms/<col>/<slug>`
  PRs in flight at once, which is the population the diagnostic
  classifies.
