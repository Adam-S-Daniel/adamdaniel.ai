---
name: post-failure-comment
description: Wire a workflow's Playwright (or other captured-log) failures into the PR conversation as a marker-tagged, secret-scrubbed comment via the `.github/actions/post-failure-comment` composite action. Use when adding a new long-running/Playwright workflow, when a workflow's failures are opaque to agents iterating on a PR, when the user asks to "make CI failures self-report", or when refactoring inline gitleaks-scrub-and-comment blocks into the shared action.
---

# Failure-comment composite action

## Why this exists

Workflow logs in this repo are not directly readable by the Claude agent (no `gh` CLI, no logs surface in the GitHub MCP server, `actions/runs/.../logs` returns 403 unauthenticated). When a long-running workflow fails on a PR, the agent has to either ask the user to paste the log or open the run in a browser.

The composite action at `.github/actions/post-failure-comment/action.yml` solves this: it scrubs the captured log via `gitleaks` and posts (or updates, via marker-based dedup) a PR comment with the failure block. PR comments arrive as `<github-webhook-activity>` events the agent can read directly, and are also fetchable via `mcp__github__pull_request_read`.

Built once; every Playwright-running workflow should call it.

## Caller convention

For a workflow that fires on `pull_request`:

```yaml
- name: Post / resolve failure summary
  if: ${{ always() && github.event_name == 'pull_request' }}
  uses: ./.github/actions/post-failure-comment
  with:
    log-file: /tmp/<your-log>.log
    marker: <unique-marker-slug>     # NO `<!-- -->` — the action wraps it
    title: <short label>             # shown in the comment heading
    outcome: ${{ job.status }}       # success | failure | cancelled
```

For a workflow that fires on `workflow_dispatch` (or any non-`pull_request` event), pass the parent PR explicitly:

```yaml
- uses: ./.github/actions/post-failure-comment
  if: always()
  with:
    log-file: /tmp/<your-log>.log
    marker: <unique-marker-slug>
    title: <short label>
    outcome: ${{ job.status }}
    pr-number: ${{ inputs.pr_number }}   # or some other source of the PR #
```

For a workflow whose runtime gate matches the upload-artifact step (e.g. `vars.PROD_PLAYGROUND_MODE == 'true'`), match the `if:` to the upload step's gate so the comment-step inheritance is consistent.

## Required upstream conditions

1. **Capture the log.** The Playwright invocation must `2>&1 | tee /tmp/<your-log>.log`. The action reads from this path verbatim. If the log is missing or empty, the action emits a "(no log captured)" comment instead of failing.
2. **Pin a unique marker.** The action wraps `<your-marker>` as `<!-- your-marker -->`. Two workflows MUST NOT share a marker — they will clobber each other's comments. Existing markers in use:
   - `e2e-failure-summary` — `e2e-tests.yml`
   - `host-loop-failure-summary` — `cms-publish-loop-host.yml`
   - `prod-mutate-failure-summary` — `cms-publish-loop-prod.yml`
   - `preview-loop-failure-summary` — `cms-publish-loop-preview.yml`
3. **Have `actions/checkout` run first.** The action shells out to `$GITHUB_WORKSPACE/scripts/extract-playwright-failures.sh` and `$GITHUB_WORKSPACE/scripts/scrub-secrets.js`. No checkout = no scripts.
4. **Have the GitHub-script token write access.** The default `GITHUB_TOKEN` works for posting comments on the same repo. The composite action does NOT require `CMS_E2E_PAT`.

## What the action does internally

| Step | Gate | Notes |
|---|---|---|
| Install gitleaks | `outcome == 'failure'` | Installs to `$HOME/.local/bin` (no sudo). Adds to `$GITHUB_PATH` so subsequent steps see it. |
| Extract & scrub | `outcome == 'failure'` | Runs `extract-playwright-failures.sh`; falls back to `tail -c 80000` if the extractor finds nothing. Scrubs via `scrub-secrets.js` (gitleaks). Truncates to 60 KB. |
| Post comment | `outcome == 'failure'` AND (`pull_request` event OR `pr-number` set) | Marker-based update-or-create. |
| Resolve on success | `outcome == 'success'` AND (`pull_request` event OR `pr-number` set) | Replaces an existing failure comment with a "passing on `<sha>`" stub. |

The action no-ops on `cancelled`, `skipped`, or `null` outcomes — those rarely indicate a real failure that warrants a comment.

## Security: env vars, not interpolation

Inputs to the embedded `actions/github-script` calls are passed via `env:` and read as `process.env.X`, **not** inlined as `${{ inputs.x }}` into the script body. This is the pattern the github-script README explicitly requires; inlining input strings into a JS body is a classic script-injection vector. If you extend the action with new fields, follow the same pattern.

## Common refactor pitfalls

- **Forgetting `actions/checkout`** — happens when slotting the action into a one-step workflow. The action's extractor + scrubber require the repo on disk. Add a checkout step if there isn't one.
- **Overlapping markers** — copy-pasting from another workflow without changing the marker. Always pick a globally-unique slug.
- **Wrong outcome source** — `${{ job.status }}` is the canonical source for single-job workflows. For workflows with multiple dependent jobs (like `e2e-tests.yml`'s post-job), pass `${{ needs.<job>.result }}` instead.
- **Skipping the gate on `pull_request`** — for workflows that ALSO fire on `schedule` or `workflow_dispatch`, the action's `if:` will skip posting (no PR context) but the gitleaks install still runs. To save runtime, add `&& github.event_name == 'pull_request'` to the caller's `if:` or use `pr-number` for explicit-target workflows.

## When NOT to use this

- **Non-Playwright workflows with short logs.** The extractor matches Playwright's `--reporter=list` blocks; for other tooling it falls back to `tail -c`, which is usually less useful than the workflow's own native error output. If your workflow already prints a clear single-line error, a comment with 60 KB of tail noise is worse than no comment.
- **Workflows with no PR context AND no parent PR.** `schedule`-only workflows (e.g. `canary-prod.yml`) have no PR to comment on. Open an issue instead, which is what `canary-prod.yml` already does in its `if: failure()` branch.
- **One-off / hotfix workflows.** The marker dedup convention requires a stable name; ad-hoc workflows would pollute the PR with stale "passing" stubs.

## Testing your wiring

1. Push a deliberately-broken commit (e.g. add `await page.waitForTimeout(99999999)` to a spec).
2. Watch for the workflow to fail.
3. Check the PR for a new `<!-- your-marker -->` comment — it should arrive ~30s after the workflow ends.
4. Push a fix that turns the workflow green.
5. The comment should refresh to `## <title> passing on <sha>` within ~30s of the green run.

## Files

- `.github/actions/post-failure-comment/action.yml` — the composite action.
- `scripts/extract-playwright-failures.sh` — awk-based extractor for Playwright `--reporter=list` failure blocks.
- `scripts/scrub-secrets.js` — gitleaks-backed scrubber. Replaces detected secrets in-place with `<REDACTED:RuleID>`.
- AGENTS.md "Failure-comment composite action" — short reference; this skill is the long-form.
