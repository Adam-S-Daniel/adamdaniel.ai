---
title: Safely Keep Your Agent Iterating Autonomously With Gitleaks and PR Comments
date: 2026-07-03 08:01:00 -0400
published: false
test_fixture: false
---
[
Failure-comment composite action](https://github.com/Adam-S-Daniel/adamdaniel.ai/blob/main/AGENTS.md#failure-comment-composite-action)


“A practical fix if you want me to keep iterating autonomously: add a post-failure step to e2e-tests.yml that posts the relevant Playwright output as a PR comment with a marker (e.g. <!-- e2e-failure-summary -->). The MCP pull_request_read get_comments method can read PR comments — so the next time CI fails, I’d see the failure verbatim without needing you to paste it. Lightweight, keeps the existing artifact upload as-is. Want me to add that?”

Me: Yes, add that with a secrets-scrubbing feature that leverages whichever OSS secrets detection tool you evaluate as most appropriate. 

It used gitleaks. I put this in my agents.md

“CI will exercise the new failure-summary bot on the next run; if the \[e2e testing workflow] still fails, the failure blocks will appear as a PR comment so I can iterate without you pasting logs.”

## Failure-comment composite action

In environments with no pre-authenticated `gh` cli, workflow logs are not directly readable (the GitHub MCP server has no `actions/runs/.../logs` tool and unauthenticated `curl` to `api.github.com/.../actions/runs/.../logs` returns 403). To make CI failures triage-able from inside a PR conversation, every Playwright-running workflow forwards its captured log to a shared composite action:

```yaml
# Caller-side gating — failure() / success() at the workflow
# level is the canonical pattern. Two call sites: one for the
# failure post, one for the green-run resolve.
- name: Post failure summary
if: ${{ failure() && github.event_name == 'pull_request' }}
uses: ./.github/actions/post-failure-comment
with:
mode: post
log-file: /tmp/<your-log>.log
marker: <unique-marker-slug> # NO `<!-- -->` — the action wraps it
title: <short label>

- name: Resolve failure summary on success
if: ${{ success() && github.event_name == 'pull_request' }}
uses: ./.github/actions/post-failure-comment
with:
mode: resolve
marker: <unique-marker-slug>
title: <short label>
```

The action is mode-driven and does NOT detect job state itself. Earlier versions tried `${{ job.status }}` (silently empty inside composite `with:` blocks) and `failure()` / `success()` inside the action's own step `if:` clauses (also unreliable for our composite case). v3 pushes the gate to the caller, where `failure()` / `success()` are well-tested workflow primitives.

For MULTI-job workflows (e.g. `e2e-tests.yml`'s `finalize` job posting on behalf of the upstream `e2e` matrix), `failure()` / `success()` reflect only the FINALIZE job's state, not the matrix's. Gate on `needs.<job>.result` instead:

```yaml
- if: ${{ needs.e2e.result == 'failure' && github.event_name == 'pull_request' }}
uses: ./.github/actions/post-failure-comment
with: { mode: post, log-file: /tmp/playwright-output.log, marker: e2e-failure-summary, title: E2E tests }

- if: ${{ needs.e2e.result == 'success' && github.event_name == 'pull_request' }}
uses: ./.github/actions/post-failure-comment
with: { mode: resolve, marker: e2e-failure-summary, title: E2E tests }
```

For workflows that don't fire on `pull_request` (e.g. `cms-publish-loop-preview.yml` on `workflow_dispatch`), pass `pr-number: ${{ inputs.pr_number }}` as well — the action falls back to looking up the head SHA via the API.

**The caller MUST grant `pull-requests: write` to the workflow** (or to the calling job, if you scope per-job). Without it, the embedded `actions/github-script` call 403s silently and no comment lands. A typical block:

```yaml
permissions:
contents: read
pull-requests: write
```

The composite action is **platform-delivered** — the callers reference the platform's copy (checked out under `.cms-platform/.github/actions/post-failure-comment/action.yml`), and the action runs its OWN bundled helper scripts via `$ACTION_PATH`, not consumer-owned `scripts/`:

1. Installs `gitleaks` to `$HOME/.local/bin` (no sudo, works in both the Playwright Docker container and on `ubuntu-latest`).
2. Runs the action's bundled `extract-playwright-failures.sh` against the captured log to pull just the numbered failure blocks; falls back to `tail -c 80000` if the extractor finds nothing.
3. Pipes the result through the action's bundled `scrub-secrets.js` (gitleaks-backed) and truncates to 60 KB to fit in a GitHub comment.
4. Posts (or updates, via marker-based dedup) a PR comment under `<!-- <marker> -->`.
5. Resolves the comment to a "passing on `<sha>`" stub on the next green run.

**Markers in use** (must be globally unique to avoid clobbering each other):

| Marker | Workflow / job |
| --- | --- |
| `e2e-failure-summary` | `e2e-tests.yml` → `finalize` (aggregates the e2e matrix) |
| `unit-failure-summary` | `e2e-tests.yml` → `unit` |
| `e2e-real-failure-summary` | `e2e-tests.yml` → `e2e-real` |
| `parity-failure-summary` | `e2e-tests.yml` → `parity` |
| `select-failure-summary` | `e2e-tests.yml` → `select` |
| `host-loop-failure-summary` | `cms-publish-loop-host.yml` |
| `prod-mutate-failure-summary` | `cms-publish-loop-prod.yml` |
| `preview-loop-failure-summary` | `cms-publish-loop-preview.yml` |
| `preview-delete-failure-summary` | `cms-delete-published-preview.yml` |
| `preview-loops-failure-summary` | `cms-preview-loops.yml` (distinct from the singular `preview-loop-…`) |

**Gitleaks pass-through is non-optional.** Every comment that lands on a PR via this action runs through the action's bundled `scrub-secrets.js` (which shells out to `gitleaks detect`) inside the action's `Extract and scrub failure summary` step. There is no caller-side switch to disable it; if you extend the action with a new mode, keep the scrubber call on every code path that emits log content into a comment body. A leaked PAT in failure output that bypasses gitleaks would be visible to anyone with read access to the PR — treat the scrubber the same as the secrets-scan pre-commit hook.

**Security note.** The embedded `actions/github-script` calls receive their inputs as `env:` vars and read them via `process.env.X` — never inline `${{ inputs.x }}` directly into a script body. This pattern is what `actions/github-script`'s README explicitly requires, and it's a script-injection vector if you skip it. Same rule applies to any extension of the action.

The full convention (when to use, when NOT to use, common refactor pitfalls, how to test wiring) lives in the cms-platform `post-failure-comment` skill.
