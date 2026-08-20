<!-- BEGIN MANAGED SECTION — DO NOT EDIT ABOVE "## Repo-specific additions" -->
<!-- Source: _agent-guidance -->
<!-- Sections: none -->

# AGENTS.md

> **Managed by [`_agent-guidance`].**
> Edit only below the `## Repo-specific additions` header.
> Everything above it will be overwritten on the next sync.

This block is deliberately short. It carries the things that are **specific to
this account and learned the hard way** — incidents, fleet policy, machine
layout. It does not restate general engineering practice, and it does not
describe anything you can learn by reading the repo. Depth lives in each repo's
`docs/` and in the skills registry; follow the pointers when the work touches
that area.

## Working in these repos

- Fix what was asked. No speculative features, premature abstractions, or
  unused helpers.
- Prefer editing an existing file over creating a new one.
- Every public interface change updates the corresponding tests.
- Run the existing test suite before calling a task complete, and say plainly
  what you ran. New behaviour gets a test; a bug fix gets a regression test.
- Tests must be deterministic — no sleeps, no network, no reliance on
  wall-clock time.

## Finding your unknowns

Output quality on a non-trivial task is bounded by how well the ambiguities got
resolved — and most of them surface *during* implementation, not before it. So
treat unknown-hunting as part of the work, not a phase that ends at the plan:

- Before building: name what you don't know. Prefer a reference in **code** — an
  existing implementation to mirror, a failing test, a rubric, an HTML mockup —
  over a prose description of the same thing.
- While building: keep a running note of decisions that departed from the plan
  and edge cases you hit. Surface them; don't silently absorb them.
- After building: be able to explain what changed and why it is correct.
- Durable findings go in the **repo**, not in agent memory — an environment
  quirk, non-obvious wiring, where a source of truth actually lives, a
  sequencing constraint. Repo files version with the code and every person and
  every harness that opens the repo sees them; agent memory is per-agent and is
  silently missed by the next session. A fleet-wide rule goes in
  `_agent-guidance`'s `agents-md/base.md`, a repo fact below the
  `## Repo-specific additions` marker, a reusable procedure into the skills
  registry. A memory note is a supplement, never the only copy.

The full workflow (blind-spot pass, self-interview, implementation notes,
post-hoc explainer) is the **`finding-unknowns`** skill in the registry. Reach
for it on unfamiliar code, a new domain, or anything with subjective acceptance
criteria.

## Workstation layout

Repo locations are host-specific — match the convention of the machine you're on
(on Windows, check `$env:COMPUTERNAME`).

- **`ZENDA`** (Windows): local clones live under `D:\repos\<github-owner-or-org>\<repo>`
  (for example `D:\repos\adam-s-daniel\wsl-automation`). Clone new repos there, and
  assume existing repos live there rather than under the user profile
  (`C:\Users\<user>\...`).

## Sessions get cut off

**`ZENDA` drops sessions mid-task, frequently.** Assume any run can end between
one tool call and the next, and keep the work recoverable throughout rather
than only at the end.

- **Commit and push as you go**, on a branch. A pushed branch survives the
  laptop; the conversation, a dirty tree and a worktree do not — a worktree can
  be deleted with the session that made it. Small commits *are* the checkpoint.
- **Persist the expensive part**, which is the investigation and not the diff:
  the root cause, the baseline test result, the option already ruled out. A
  fresh session can regenerate a patch quickly; it cannot cheaply re-derive why
  the obvious fix was wrong. Put it in the commit message, the PR body, or an
  ADR — all of which outlive the context window. Chat does not.
- **Say where things stand before a long step** — a full test suite, a CI
  watch, a wide refactor — so a resumed session starts from a statement of what
  is done and what is next, not a reconstruction of it.
- **Report a resume pointer, not just an outcome:** branch, PR number, worktree
  path, and the next command to run.

## Security

Standard practice applies without being restated here. These are the ones with
teeth in this account:

- Validate anything that crosses a trust boundary — user input, API responses,
  file contents.
- Never build SQL, shell commands, or HTML by string-concatenating untrusted
  data. Use parameterized queries, shell arrays, and context-aware escaping.
- Never commit secrets, credentials, or `.env` files.
- Never disable TLS verification, authentication, or CSRF protection.

## Data exposure in CI and public repos

Treat CI run logs, job summaries, artifacts, workflow run pages, and git history
as **public** on a public repo. (Real incident: a workflow printed the owner's
email addresses and their correspondents' into a public Actions log.)

- **Never print personal or sensitive data to a log** — no emails, contacts,
  names, IDs, mailbox sizes/counts, tokens, or anything "useful to an attacker or
  scammer." Deliver sensitive results out-of-band (e.g. email the account itself,
  write to a private store) and log only a non-identifying status line.
- **Don't interpolate `${{ inputs.* }}` / `${{ github.event.* }}` into a `run:`
  block** — the rendered command is echoed to the log. Read inputs from
  `$GITHUB_EVENT_PATH` inside the script and `::add-mask::` sensitive values
  before use. `::add-mask::` only scrubs the log *stream*, not other surfaces.
- **Put sensitive config in secrets, not plaintext inputs or `vars`.** Only
  secret *values* are masked in logs.
- **Sanitize error output** — never dump an API/HTTP response body on failure (it
  can quote personal data); reduce it to a status code + machine error type, and
  keep the data-bearing serialization/call inside the try/catch.
- **Least privilege:** set `permissions:` to the minimum (usually
  `contents: read`) and require approval for outside-collaborator fork PRs.
- **Test fixtures use reserved `example.com` / `example.net` domains only** —
  never a real address; fixtures get committed and logged.

### git history & metadata
- **Sanitize before the first commit.** Fixing the current file does not remove
  data from history. If sensitive data was committed, rewrite history to drop the
  commits, delete every ref that points at them (branches, tags, **PRs**), and
  force-push. GitHub garbage-collects unreachable objects on its own schedule
  (days to weeks) — until then they remain reachable *by SHA* — and you can ask
  GitHub Support to expedite for a public repo. (This is the deliberate exception
  to "don't force-push"; it is a security remediation.)
- **Commit with the GitHub `…@users.noreply.github.com` identity** on public
  repos so a real email is not baked into commit author/committer metadata.

## Automation vs branch protection

Fleet repos enforce PR-only default branches via ruleset, managed as code in
`repo-settings` (see its ADR 0001). Design automation accordingly:

- Never design a bot that pushes to a protected default branch ad hoc — the
  push is rejected (GH013), even from the repo's own workflows.
- Generated data (badges, run summaries, reports, dashboards) belongs on a
  dedicated unprotected results branch (e.g. skills-evals' `eval-results`);
  consumers read from that branch and treat its content as untrusted.
- The rare bot that genuinely must write to a default branch needs a ruleset
  bypass actor declared in repo-settings' `fleet.yml` — never a hand-granted
  UI bypass (the drift report flags those). The AGENTS.md sync App is the
  standing example.
- PR + auto-merge is not a sanctioned bot-write path for fleet repos; the
  cms-platform-managed repos (outside the fleet ruleset) use it by their own
  design.

### A required status check gets no `concurrency` group

A job that publishes a **required** status context and can fire more than once
on the same head sha — label events, an `opened` + `synchronize` burst, any
multi-event trigger — gets no `concurrency` block at all.

- GitHub picks **non-deterministically** between a cancelled run and a
  successful one for the same context + sha. When cancelled wins the PR is hard
  blocked: the merge API returns `405 Required status check "<ctx>" is
  cancelled`, and nothing overrides it — not native auto-merge, not an explicit
  merge call, not a nudge bot. The PR looks all-green and simply never lands.
- **`cancel-in-progress: false` is not "run them all."** GitHub keeps the
  in-progress run plus only the *latest* pending run in the group and cancels
  the other pending duplicates, so a same-sha burst still leaves cancelled runs
  behind. Flipping that flag is the fix that looks right and changes nothing.
- Same mechanic on any shared lane: when one push drives two workflows into one
  group, the older pending sibling is cancelled. Make the triggers pairwise
  disjoint — a shared group only serialises runs that already arrive apart.
- Jobs triggered only by `push` / `synchronize` — each a new sha — are safe to
  cancel and keep `cancel-in-progress: true`.
- Lock the invariant with a test that **parses** the workflow YAML (the `yaml`
  package — never a regex or line scan, which reads clean on text it cannot
  see), so the block cannot come back.

## Two GitHub connectors, and which one you are holding

A session here can see **two** GitHub MCP servers at once. They authenticate as
the same person, so `get_me` will not tell them apart, and the tool names do
not say which is which. Establish it before you reach for one:

- **`mcp__github__*` — session-provisioned.** It does NOT appear in
  `ListConnectors`; the remote environment supplies it and the session's own
  system prompt points at it. It is the **only** one with GitHub Actions tools
  (`actions_list`, `actions_get`, `actions_run_trigger`), CI introspection
  (`get_check_run`, `get_job_logs`), auto-merge control, and review-thread
  resolution. Its reach is the session's attached repositories; `add_repo`
  widens it mid-session.
- **`mcp__b26ebb34-…__*` — the claude.ai org connector `github-mcp`.** It lists
  in `ListConnectors` as `connected: true`. Its tool set is a **strict subset**
  of the above: same reads, same PR and issue writes, same `merge_pull_request`,
  `push_files` and `delete_file` — and no Actions, no job logs, no auto-merge,
  no review threads. Its reach comes from a GitHub App installation allowlist
  that is INDEPENDENT of the session's attached repos.

Three consequences, and the first is why this section sits where it does:

- **Everything that verifies CI is `mcp__github__`-only.** Dispatching a run,
  reading a rollup, pulling a failed job's log — the org connector can do none
  of it. A session holding only `github-mcp` cannot follow the rule below at
  all: it can merge a pull request but it cannot check one.
- **Fewer tools is not less dangerous.** Both connectors merge, push and
  delete. The subset one is the connector whose reach you cannot infer from the
  session's repo list, so a write through it can land somewhere the session was
  never scoped to. Measured 2026-08-19: `github-mcp` 404s on the private
  `repo-settings` even though the account can push there, while both read a
  public non-attached repo fine.
- **A 404 means "not visible to THIS connector"** — never that a repo or file
  does not exist. Re-check on the other one before concluding anything; the
  next section is how to tell the two apart.

Prefer `mcp__github__` for everything. Reach for `github-mcp` only when the
other genuinely cannot see a repo, and say so out loud when you do. When you
report a verification, name the connector it came from.

## A GitHub 404 means "not authorized", not "not there"

GitHub answers **404 rather than 403** when a caller is not authorized to know a
private repo exists — it will not confirm the repo either way. So a 404 from any
GitHub API or MCP call is ambiguous by design: either the thing is gone, or the
credential simply lacks that repo. The body says "Not Found" in both cases,
which is why the wrong reading — telling someone their PR was deleted — is the
easy one to reach for.

- **Probe the repo, not the object.** If `GET /repos/<owner>/<repo>/pulls` 404s
  as well, the whole repo is invisible to that credential: a scope gap, not a
  missing PR. If the repo answers and only the object 404s, it is genuinely
  gone.
- **Try the other connector before concluding anything.** The two servers above
  do not share an installation, so one can be blind to a repo the other reads
  fine. (Real incident, 2026-08-19: a mid-session MCP reconnect brought up a
  second GitHub server whose credential could not see a private repo. Every call
  against it 404ed — including on a PR the *other* connector had read
  successfully minutes earlier — and the repo was neither deleted nor unshared.
  `add_repo` reported it already attached, which is about session scope and does
  not widen a connector's own installation.)
- **Git is a separate credential path** and often still works when the API
  token does not. `git ls-remote origin '<ref>'` answers "does this branch
  exist"; `git merge-base --is-ancestor <sha> origin/main` answers "was it
  merged". Neither touches the API, so both stay available to report real state
  while a connector is blind.
- Never report a repo, PR, or branch as gone on a 404 alone. Say which
  credential could not see it, and what you checked with.

## "The watch finished" is not "CI passed"

Never read CI pass/fail off a watch command's exit code, or off the fact that it
returned. Three failure modes stack: in `cmd | tail` the shell's `$?` is
`tail`'s — always 0 — masking the non-zero from `gh pr checks`; a backgrounded
watch reports that same pipeline code, so its "completed (exit code 0)"
notification says nothing about the build; and `tail -N` can show only the
passing and skipping lines while the FAILURE lines scrolled out of the window,
so eyeballing it looks green too. (Real incident: all three lined up on one PR —
e2e and lint were FAILURE while the session reported CI green and moved on.)

- Capture the real code with `${PIPESTATUS[0]}`, or don't pipe the watch at all.
- After **any** CI watch, query the conclusions explicitly and report the parsed
  result before acting on it:

  ```bash
  gh pr view <n> --repo <owner>/<repo> --json statusCheckRollup --jq \
    '.statusCheckRollup[] | (.conclusion // .state) as $c
     | select($c != null and $c != "SUCCESS" and $c != "NEUTRAL")
     | "\(.name // .context): \($c)"'
  ```

  A check run carries `.conclusion`, a legacy commit status carries `.state` —
  filter on only one and the other's failures read as clean.
- Treat "watch done" as "now verify", never as "passed". Don't launch a watch
  and go passive without a definite verify-the-rollup step on resume.

## Dependency updates

Dependabot runs with a **minimum package age** (`cooldown`) so an unattended
merge still gets a cooling-off period: `default-days: 7`, `semver-major-days: 30`.
Two things about that setting are easy to get wrong:

- It applies to **version** updates only. A security advisory bypasses cooldown
  entirely and opens immediately — the wait never delays a vulnerability fix.
- An unset `cooldown` is **not** "no wait": GitHub applies an implicit 3-day
  minimum age to version updates. Writing 7 is a raise from 3, not from zero.

`semver-minor-days` / `semver-patch-days` are deliberately left undefined —
they fall back to `default-days`, and spelling them out only invites drift.

The window is not only Dependabot's. A package you add or bump **by hand** mid-task
is the case with no automation watching it: check the publish date
(`npm view <pkg> time --json`), take the newest release that has already cleared
the 7 days rather than the freshest one, and pin it exact (no caret) so `npm ci`
cannot drift onto a version that has had no cooling-off at all.

## A name you choose becomes data a scanner reads

gitleaks' `generic-api-key` rule fires on a **keyword** next to a
high-entropy value. The keyword list is short and ordinary:

```
access  auth  api  credential  creds  key  passwd  password  secret  token
```

Nothing warns you that those words are reserved, because they are not — they
are only reserved *in the position a scanner looks at*. Name a skill, a config
key, a job output, an artifact or a fixture with one of them, and every
generated file that serialises `name: value` alongside a hash, id or digest
starts looking like a leak.

That is not hypothetical. A skill named **`cms-platform-secrets`** put the line
`"cms-platform/cms-platform-secrets": "<64-hex>"` into `skills.lock`, which is
generated, committed, and scanned. Both consumer sites went red on every push
to `main` — adamdaniel.ai for eight consecutive pushes, each one a blocked
editorial publish. An audit of all 34 skill names across both registries found
exactly one hit: that name. One word, one outage.

The shape that makes it hard to catch:

- **The repo that chooses the name is not the repo that breaks.** cms-platform
  named the skill; the two sites that install its bundle are what went red.
  cms-platform's own lock lists only `adam/*` skills, so it stayed green and
  the author had no signal at all.
- **A pull request cannot see it.** The PR lane scans `base..head`; the push,
  schedule and dispatch lanes scan full history. A finding that lives in an
  older commit is invisible to every PR and fires on every push.
- **History is immutable, so the name outlives the rename.** Fixing the
  generator or renaming the skill fixes the working tree and nothing else. The
  old line stays in every clone until history is rewritten.

So:

- **Check a name against that list before you commit to it**, whenever the name
  will land in a generated or serialised artifact. It costs one grep. Prefer a
  name that says what the thing is for over one that names the sensitive noun —
  `consumer-repo-provisioning` carries the same meaning as
  `cms-platform-secrets` and trips nothing.
- **Fix it at the source, not with an allowlist.** An allowlist entry is
  per-repo; a `.gitleaksignore` fingerprint is `<commit>:<file>:<rule>:<line>`
  and commit shas are repo-unique, so it cannot be propagated *at all* — copied
  to another repo it names a commit that does not exist there and silently
  suppresses nothing while looking like coverage. One rename immunises every
  consumer at once; N exclusions immunise N repos until the next one adopts.
- **Do not lean on a scanner's internals.** Labelling a digest `sha256:<hex>`
  currently dodges the rule because `:` falls outside its capture class — a
  welcome side effect, and a bad thing to depend on. Justify such a label as
  self-documentation (it says which algorithm produced the digest); if the
  upstream regex ever widens, every lock in the fleet goes red at once.
- **Suppress by value, never by path.** A `paths` entry does not filter
  findings, it skips the file before any rule runs, so a real credential pasted
  into it is never reported (cms-platform#260 — 29KB of a public repo left
  unscanned that way, suppressing nothing that the value regexes did not
  already cover).

## Pinning GitHub Actions

**Every `uses:` is pinned to a full 40-character commit SHA** — in workflows,
composite actions, and reusable-workflow references alike, with exactly one
carve-out, named below. Never a tag, never a branch, never an abbreviated SHA. A
tag is a movable pointer: pinning to one gives whoever can retag the upstream
repo a shell on the runner, holding that job's token.

```yaml
uses: actions/checkout@b4ffde65f46336ab88eb53be808477a3936bae11 # v4.1.1 (2023-10-17)
```

- **The trailing `# vX.Y.Z (YYYY-MM-DD)` comment is part of the pin.** Forty hex
  characters say nothing on their own; the version says what it is and the date
  says how stale it is. Dependabot rewrites the SHA and the version but not the
  date, so dates drift — cosmetic, a chore, never an incident.
- **Wait 7 days after a release before adopting it** — the cooling-off above,
  applied by hand. If the newest release is younger than that, pin the previous
  one.
- **Dereference annotated tags.** `gh api repos/<owner>/<repo>/git/ref/tags/<tag>`
  returning `.object.type == "tag"` gives you the tag object's SHA, not the
  commit's, and pinning that fails at runtime. Follow it with
  `git/tags/<that-sha>`, or ask git directly:
  `git ls-remote <url> 'refs/tags/<tag>^{}'`.
- **The one carve-out: a reusable *workflow* from a repo this account owns stays
  on a tag.** `uses: Adam-S-Daniel/cms-platform/.github/workflows/<x>.yml@v0.1.85`
  is correct as written — do not "fix" it to a SHA. The tag is the platform's
  release identity: `platform-bump.yml` moves the `uses:@` refs, the theme gem,
  `platform.lock` and every `platform_ref:` input to one release in a single PR,
  and `check-platform-pin-consistency.js` asserts each of those refs equals
  `platform.lock`'s `platform_ref` — a SHA there fails the lint and strands the
  bump. It stops there: the platform's own composite actions under
  `.github/actions/` take a SHA and the usual `# vX.Y.Z` comment, and nothing
  third-party is ever a tag.
- `./local/path` and `docker://` refs have nothing to pin. Leave them.

`sha_pinning_required: true` enforces the rule at the repo level — set by
`repo-settings`' `fleet.yml` for the fleet and `cms-platform`'s
`repo-settings.yml` for the three sites it manages. It governs **actions**, not
reusable-workflow refs: adamdaniel.ai and jodidaniel.com were already enforcing
it at the 2026-07-13 audit and still call 32 tag-pinned cms-platform reusables
apiece, and four repos on the `fleet.yml` default call one each. That is what
makes the carve-out workable — and what leaves a tag in a *third-party* reusable
ref for review, not the setting, to catch.

## Subagent delegation (model routing)

- Don't write code in the main loop: run the implementation in a subagent on an
  appropriately lower-power model (e.g. the Agent tool's `model` override in
  Claude Code; skip if the harness has no subagent support).
- Route by mechanicalness: smallest model (haiku-class) for exactly-specified
  edits — pin bumps, renames, config/doc tweaks; mid-tier (sonnet-class) for
  normal implementation from a clear spec. Escalate rather than ship a wrong
  diff when the task is genuinely subtle (cross-repo invariants, race
  conditions).
- The main loop keeps root-cause investigation, architectural decisions,
  writing the spec, and review of the subagent's diff before commit.
- Delegated work is done when a **verifier exits 0**, not when the report reads
  as finished. Name the exact command in the spec and require its exit code
  back. A subagent that cannot run it reports BLOCKED; a count that disagrees
  with the spec's stated expectation is a stop-and-report condition, never a
  rounding difference.
- Don't assume the subagent sees this file: general-purpose and custom
  subagents receive the full memory hierarchy (imports included), but
  Explore/Plan-type agents and SDK harnesses with `settingSources: []` skip
  repo guidance entirely. Restate load-bearing constraints (style, test
  command, invariants) in the delegation prompt, and don't hand
  guidance-sensitive work to agents that won't see it.
- **Any prompt that sends a subagent to live-test states the credential
  boundary** — which `HOME`/profile it may use, what it may read, and that it
  must not copy real credentials anywhere to make the test pass. (Real
  incident: a reviewer live-testing a plugin migration in a scratch `HOME`
  copied the account's real OAuth credentials into it. The test worked; nobody
  had asked, and nothing in the prompt forbade it.)
- Supply a throwaway credential, or scope the test to what runs
  unauthenticated. If it genuinely cannot run without a real one, that is the
  operator's call — not a gap for the subagent to close on its own initiative.

## Skills ecosystem

- The canonical skills registry is `github.com/Adam-S-Daniel/agentskills`,
  organized as three bundle plugins — `adam` (general-purpose, cloud-safe;
  default-on), `adam-local` (machine-bound), and `fastmail` — each holding
  `skills/<skill>/` directories.
- In Claude Code with the marketplace installed, invoke a skill as
  `/adam:<skill>` (e.g. `/adam:finding-unknowns`).
- Local machines get the marketplace plus per-agent symlinks via that repo's
  `setup.sh`.
- Cloud/ephemeral sessions still get **no** plugins from repo-declared
  settings — that Claude Code limitation (agentskills' `docs/decisions/0001`)
  is unchanged. What changed is that it now has a fix: a repo carrying its own
  `skills.lock` plus the `skills-bootstrap` SessionStart hook installs the
  bundles that lock names directly into those sessions, verified against a
  pinned commit and per-skill digests. Such a session opens with a `skills:`
  verdict naming what loaded, or why nothing did — read it instead of guessing.
- **Adoption is opt-in and double-keyed, and no longer rare.** Delivery needs
  an allowlist entry in `_agent-guidance`'s `repos.yml` AND a `skills.lock` the
  repo committed itself — the fleet sync never writes one, because the lock is
  where a repo declares which bundles it installs (some federate several
  registries). A repo holds both keys, or is mid-adoption holding one, or is
  deliberately out for a reason — a propagation experiment the bundle would
  contaminate, a dormant repo whose sessions never happen. Which of the three
  fits an unfamiliar repo is not guessable: look for `skills.lock`. Bundles
  cost always-on context in every session that carries them, which is why this
  stays a deliberate per-repo decision and not a fleet default.
- New reusable skills graduate **into** the registry (sensitive ones into
  `agentskills-private`) rather than living on in a consumer repo. A long skill
  splits across files rather than growing into one wall of text.

## Git practices

- Write concise commit messages that explain *why*, not just *what*.
- One logical change per commit.
- Do not amend published commits or force-push shared branches.
- **Merge with a merge commit — `gh pr merge --merge`.** Squash and rebase are
  disabled on every fleet repo, so `--squash` fails rather than falling back;
  do not try it, and do not offer it as a choice. The exceptions are the three
  cms-platform-managed repos (`cms-platform`, `adamdaniel.ai`,
  `jodidaniel.com`), where squash stays enabled because the Decap publish chain
  arms SQUASH auto-merge on every editorial PR and squash is what collapses an
  editor's many per-save commits into one `publish: <title>` commit. Merge
  commits work there too, so `--merge` is the one form that works everywhere.

  Squash is off elsewhere because it is actively unsafe for a repo that pins
  commits by sha: it collapses a branch into a new commit and strands the
  originals on no branch, so a lockfile naming the pre-merge content commit
  (agentskills' `skills.lock`) ends up pinning something a fresh clone of the
  default branch does not contain. Measured on throwaway clones 2026-08-15 —
  `generate_skills_lock.py --check` then fails with `cannot resolve ref`.
  Settings are enforced as code: `repo-settings`' `fleet.yml` for the fleet,
  `cms-platform`'s `repo-settings.yml` for the three above.

<!-- END MANAGED SECTION -->
## Repo-specific additions

# adamdaniel.ai — Project Guide

Personal website and blog for Adam Daniel (Freelance AI Engineer). Jekyll static site with Decap CMS, AWS OAuth proxy, and PR preview environments.

## Scope & Boundaries

- **Stay within the requested scope.** Only act on the explicitly requested scope (e.g. user-level vs repo-level placement). When in doubt about scope, confirm before proceeding.

## Test-Driven Design

- **Red-green TDD.** Write a failing test first, then make it pass, then refactor. Always follow this cycle.
- **Never bypass the UI in a UI test.** If a spec exists to validate that an editor's click does what we expect — driving Decap admin, the deploy-status pill, the publish-via-auto-merge shim from the editor's POV — the test MUST go through the actual UI. Calling the underlying API programmatically (e.g. `page.evaluate(fetch(...))` against the GitHub API, hitting the shim's `__callMerge` directly, peeking at workflow runs / PR state instead of waiting for the user-visible signal) defeats the test's purpose and lets a broken UI silently regress. If the UI is broken, the test surfacing that breakage IS the point — fix the UI, don't paper over it. The publish-via-auto-merge-browser.spec.js route-mocked unit test exists for the shim's internal contract; the real-network specs (`cms-publish-loop*`, `cms-delete-published`) cover the Decap-UI-driven chain end-to-end and must keep doing so.
- **No back doors in the spec body — with an explicit harness-hygiene carve-out for setup/cleanup.** "Never bypass the UI" governs the *behaviour under test*: the spec's own forward (and, where applicable, backward) leg MUST drive the real Decap UI through Save → Status:Ready / `cms/ready` → auto-merge → deploy, never a programmatic API substitute. **Setup and post-test cleanup, however, MAY use the GitHub API for fixture LIFECYCLE** — reading a fixture's state from `main`, seeding/removing a fixture through a labelled fixture PR (`cms-fixture-pr.js`'s `seedFixtureViaPr`/`removeFixtureViaPr`), or an existence-only delete in `afterAll`. That is *harness hygiene* (resetting/reaping test state between runs), not the behaviour the spec validates, so it does not "skip the chain the test exists to validate" — the chain is still exercised by the spec body's UI-driven legs. The important invariant is that the **primary** leg stays UI-driven; only the safety-net is API. Per #1771 step 4 the prod-loop `afterAll` is now an existence-only **delete** (remove the uniquely-named ephemeral post if it is still on `main`) rather than a content-restore — there is no shared baseline to restore, so there is nothing for an API write to corrupt. (Where a spec *also* drives a backward leg through the UI — e.g. the toggle-only `cms-unpublish-republish` specs — that is still good practice for the extra coverage; it is no longer a hard requirement of this rule.) The route-mocked `publish-via-auto-merge-browser.spec.js` is still allowed to use the shim's programmatic `__callMerge` because that spec's entire reason for existing is the shim's internal contract, not the editor's experience.

## Architecture

```text
Production:   adamdaniel.ai                     → CloudFront → S3
Preview:      preview-pr${N}.adamdaniel.ai      → CloudFront → S3 (/pr-${N}/)
CMS:          adamdaniel.ai/admin/              → Decap CMS → GitHub OAuth → Lambda
```

Each PR gets its own subdomain under `*.adamdaniel.ai`. A single
preview CloudFront distribution serves the whole preview bucket; a
viewer-request CloudFront Function maps `Host: preview-pr${N}...` to
the S3 object-key prefix `/pr-${N}/`, and a sibling viewer-response
Function strips the same prefix from `Location` headers so S3's
trailing-slash redirects (e.g. `/admin` → `/admin/`) don't leak the
internal key space. Pages on preview and prod share the same
root-relative URL structure (no `/pr-N/` in any visible URL).

**`admin/` is GEM-DELIVERED (do not re-vendor the machinery).** As of cms-platform v0.1.4 the Decap admin UI + its `config*.base.yml` templates ship inside the `cms-platform-theme` gem (pinned in `Gemfile` / `platform.lock`); the gem's Decap render hook copies that machinery into `_site/admin/` and renders `_site/admin/config.yml` at build time. This repo therefore tracks **only the site-owned seam TEMPLATE** `admin/collections.site.yml.example` — a contributor copies it to `admin/collections.site.yml` (untracked, not gitignored — the real seam file is local-only / never committed) to supply the per-site collection list the render hook splices into the platform's base collections; the `admin/*.js` / `admin/*.base.yml` / `admin/index*.html` machinery is **no longer vendored here** (the full e2e harness moved to the platform too — `e2e/` is no longer tracked in this repo). To change the admin UI, edit it in **cms-platform** and ship a release; the sync path is a gem bump (`Gemfile` tag + `platform.lock`) landed by **`platform-bump.yml`** — Dependabot's `bundler` ecosystem `ignore`s this gem (cms-platform#242). Do NOT copy admin machinery back into this repo — a re-vendored copy would shadow the gem and silently drift. Anything below that references in-repo `admin/config*.yml` or `e2e/cms-*.spec.js` describes the platform-owned source of truth, not files you edit here.

## Deeper references

Progressive-disclosure docs — read the relevant one before working in that area; this file stays a map, not the territory.

- [`docs/WORKFLOWS.md`](docs/WORKFLOWS.md) — read when adding/changing a GitHub Actions workflow, debugging a required-status-check, or touching the failure-comment / recursion-gate composite actions.
- [`docs/CMS-ADMIN.md`](docs/CMS-ADMIN.md) — read when changing a Decap collection/field, the live-preview machinery, the posts-list dashboard, mobile admin CSS, or the HTML-embed widget seam.
- [`docs/CI-INVARIANTS.md`](docs/CI-INVARIANTS.md) — read before touching a prod publish loop, a deploy-wait, or any required check that asserts a `main`-state invariant.
- [`docs/TESTING.md`](docs/TESTING.md) — read when adding a test, debugging a flaky e2e run, or deciding which spec/project a new test belongs in.
- [`docs/CONTENT_GUIDE.md`](docs/CONTENT_GUIDE.md) — editor-facing walkthrough of the CMS for someone using it for the first time.
- [`docs/CONTRIBUTOR_CAPABILITIES.md`](docs/CONTRIBUTOR_CAPABILITIES.md) — maps documented contributor capabilities to the e2e spec that proves each one.
- [`docs/decisions/`](docs/decisions/) — ADRs for non-obvious, load-bearing decisions; read the README there for the format and when to add one.

## Environment / WSL

- **No `sudo` in the non-interactive shell.** Do NOT run `sudo` commands inside the non-interactive bash session — they fail because no password prompt is available. Instead, output the `sudo` commands for the user to run manually in their own terminal.

## Key commands

**Check out the platform e2e harness before running any Playwright command locally.**
`scripts/setup-test-environment.sh` does NOT check out `.cms-platform/` or the e2e
harness (verified: zero `cms-platform` matches in that script — it only installs apt
packages, Bundler/Gemfile gems, npm deps, and Playwright browser binaries). Before
`npx playwright test`, `e2e/select-specs.js`, or anything that resolves
`.cms-platform/e2e/playwright.config.js` will work, separately check out
`Adam-S-Daniel/cms-platform` at the `platform_ref` pinned in `platform.lock` into
`.cms-platform/` yourself — matching what the CI reusable workflows do.

```bash
# Local dev
jekyll serve --livereload          # http://localhost:4000
npx decap-server                   # CMS local backend (port 8081)

# AWS infrastructure
bash infrastructure/bootstrap/deploy.sh     # deploy/update bootstrap stack (consumes the PLATFORM template — see note below)
bash oauth-proxy/deploy.sh                  # deploy OAuth proxy (delegates to the platform at platform_ref; needs env vars)

# Tests
npx playwright test                               # full browser matrix (8 projects)
npx playwright test --project chromium-desktop-1080 # single project (public lane)
npx playwright test e2e/glow-banding.spec.js       # single test file
```

**Running the admin (`@admin-read` / `@admin-write`) e2e lane in a sandboxed / Claude-Code-web session.** Three gotchas bite in that order; CI hits none of them (it has the egress proxy's CA and a working Jekyll — CI installs browsers per job, not from a prebaked image, which is why the CDN allowlist below matters for CI too):

1. **Decap never mounts — only the static "PENDING" banner, no Login button.** The `/admin` shells load the Decap bundle from `https://unpkg.com/decap-cms@…`; the sandbox's egress TLS proxy presents a CA that Playwright's bundled Chromium/WebKit don't trust, so the `<script src>` dies with `net::ERR_CERT_AUTHORITY_INVALID` (`curl` works — it trusts the system CA bundle; the browser doesn't). **Fix:** run with a throwaway config that sets `use.ignoreHTTPSErrors: true` — `playwright.localcert.config.js` is **gitignored** (CI has no such proxy, and the flag doesn't change the rendered DOM / aria tree):

   ```js
   // playwright.localcert.config.js  (sandbox-only; gitignored)
   // The Playwright harness config is platform-delivered — base off the
   // copy the platform checks out under `.cms-platform/e2e/`.
   const base = require("./.cms-platform/e2e/playwright.config.js");
   module.exports = { ...base, use: { ...base.use, ignoreHTTPSErrors: true } };
   ```

   then `npx playwright test e2e/<spec> --config=playwright.localcert.config.js`.
2. **`bundle exec jekyll` → "command not found: jekyll" (rbenv shim not rehashed).** Don't fight it: build once with the full-path binary (`"$(rbenv which jekyll 2>/dev/null || echo /opt/rbenv/versions/*/bin/jekyll)" build`) and start the two servers **manually** — `npx serve _site -l 4000 --no-clipboard` + `npx decap-server`. Playwright's `webServer.reuseExistingServer` (true off-CI) then sees ports 4000/8081 already up and skips its own failing `bundle exec jekyll build` command.
3. **WebKit launch fails with missing `.so`s** (`libflite…`, `libwebpdemux…`). Once: `npx playwright install-deps webkit` (needs apt/root).

## GitHub Actions secrets

| Secret | Source | Used by |
| --- | --- | --- |
| `AWS_ROLE_ARN` | bootstrap stack output | deploy-production.yml, deploy-preview.yml |
| `PRODUCTION_CLOUDFRONT_ID` | bootstrap stack output | deploy-production.yml |
| `PREVIEW_CLOUDFRONT_ID` | bootstrap stack output | deploy-preview.yml |
| `CMS_E2E_PAT` | fine-grained PAT, host repo only | `e2e/cms-publish-loop*.spec.js`, `e2e/cms-delete-published.spec.js`, `e2e/cms-delete-published-preview.spec.js` (drive the full Decap → cms PR → auto-merge → deploy → public-URL loop). Token permissions: `Contents: r/w`, `Pull requests: r/w`, `Actions: r`, `Metadata: r`. `Actions: r` is needed by the test helpers that poll workflow run state while waiting for auto-merge + deploy-production to finish; no dispatch is needed (the earlier shim → `delete-via-pr.yml` recovery path was removed once we confirmed Decap's delete UI uses the git data API directly, not `DELETE /contents`). |

## AWS resources (us-east-1)

| Resource | Name / ID |
| --- | --- |
| CloudFormation stack | `adamdaniel-ai-bootstrap` |
| S3 artifacts bucket | `adamdaniel-ai-cfn-artifacts` |
| S3 production bucket | `adamdaniel-ai-production` (external, not CFN-managed) |
| S3 preview bucket | `adamdaniel-ai-previews` (external, not CFN-managed) |
| CloudFront (production) | see bootstrap stack output `ProductionDistributionId` |
| CloudFront (preview) | see bootstrap stack output `PreviewDistributionId` |
| Production URL | `https://adamdaniel.ai` |
| Preview URL | `https://preview-pr${N}.adamdaniel.ai` |
| IAM role | `adamdaniel-ai-github-actions` |
| OAuth proxy stack | `adamdaniel-ai-oauth-proxy` |

**Bootstrap template is PLATFORM-OWNED (do not re-vendor it).** This repo no longer
ships its own `infrastructure/bootstrap/template.yaml`; the CloudFormation template is
the single source of truth in **cms-platform** (`infrastructure/bootstrap/template.yaml`,
parameterized by `ResourcePrefix` / `ProductionDomainName` / bucket names / `GitHubRepo`).
`infrastructure/bootstrap/deploy.sh` is a thin wrapper that reads `platform_repo` +
`platform_ref` from `platform.lock`, checks the platform out at that ref into `.cms-platform/`
(the same gitignored dot-dir the reusable-workflow callers use — see `deploy-preview.yml`),
exports adamdaniel.ai's site params (`APEX_DOMAIN=adamdaniel.ai`, etc., which derive
`RESOURCE_PREFIX=adamdaniel-ai`, the three bucket names, `STACK_NAME=adamdaniel-ai-bootstrap`,
`PREVIEW_DOMAIN=*.adamdaniel.ai`), and delegates to `.cms-platform/infrastructure/bootstrap/deploy.sh`
(which deploys the platform template with `CAPABILITY_NAMED_IAM`). **The wrapper exports
`CREATE_APEX_DNS_RECORDS=true`** — adamdaniel.ai is LIVE at its apex and the
apex/www A-records are STACK-MANAGED, but the platform template gates them on
`CreateApexDnsRecords` (default `false`, safe for fresh sites). Without that
export a redeploy would DELETE the live apex DNS (site offline) — a
reviewer-caught regression in the template-removal PR (#1922). Do NOT drop it. A bootstrap-infra fix
(e.g. CloudFront `ErrorCachingMinTTL=0`) is now made **once in cms-platform** and flows here on the
next `platform_ref` bump — never apply it locally. This mirrors jodidaniel.com, which has no local
bootstrap template either. (`infrastructure/rum/` is **not** affected — its template is not an exact
vendored copy of the platform's and is out of scope.)

## Content model

Posts, Tags, Projects, Tools, Pages, and the `_e2e/` canary system collection are all Decap folder collections with their own field sets and gotchas (the `test_fixture` flag, the posts-list summary date-format contract, the Tools section's static-asset + iframe embed pattern, vendored-tool sync). → read `docs/CMS-ADMIN.md` before adding a field, changing a collection, or touching the Tools section; see also the **embeddable-tool-pages** skill for adding a new tool.

## Live preview

The `/preview/` WYSIWYG surface, the posts-list dashboard (live-url banner, published/draft links), mobile-responsive admin CSS, and the HTML-embed widget seam are all interlinked, script-load-order-sensitive admin machinery with locked invariants (e.g. the `live-url-derive.js` → `live-url-banner.js` → `native-preview-href.js` → `posts-list-enhance.js` load order). → read `docs/CMS-ADMIN.md` before touching any admin-loaded script or the preview layout; see also the **browser-testing** and **admin-config-render** skills.

## Analytics

Real-user monitoring is via Amazon CloudWatch RUM, deployed as a sibling CloudFormation stack `adamdaniel-ai-rum` (see `infrastructure/rum/`). The Jekyll snippet in `_includes/analytics/cloudwatch-rum.html` is a no-op unless **both** `JEKYLL_ENV=production` AND `site.analytics.cloudwatch_rum.app_monitor_id` are set, so local `jekyll serve` and PR previews stay silent. Identity-pool / app-monitor IDs are non-sensitive (visible in the rendered page source) so they live in `_config.yml`, not GitHub secrets. End-to-end test: `e2e/analytics-cloudwatch-rum.test.js`. Full deploy + tuning notes: [`ANALYTICS_SETUP.md`](ANALYTICS_SETUP.md).

## Code quality

Every language in the repo has a best-in-class linter + static-analyzer + style tool, configured to pass at a strong-but-pragmatic strength. The heavyweight lint toolchain is **platform-internal** — there is no consumer lint CI here. The checks run locally on demand (`npm run lint`, or each tool directly) and as a staged-file pre-commit guard (`scripts/lint-staged.sh`), the consumer's only lint backstop.

**Line width — 100 columns, house-wide.** The formatters that reflow code all target 100: Prettier (`printWidth: 100`, on top of the otherwise-standard config), Ruff (`line-length = 100`), and RuboCop (`Layout/LineLength: Max: 100`). `.editorconfig` carries `max_line_length = 100` as the editor hint. The 80-column default wrapped Playwright method chains onto 3-4 lines each and inflated the JS line count far past what the dedup pass removed; 100 keeps statements on one line without sprawling. **Markdown and YAML opt out** (`max_line_length = off`; yamllint `line-length: disable`; markdownlint `MD013: false`) — prose, long URLs/tables, and workflow `${{ }}` expressions / SHA-pin comments run longer by nature, and rewrapping them is pure churn. CSS has no line-length rule. When adding a new code language, set its formatter's width to 100 too.

**Local — pre-commit hook.** `scripts/lint-staged.sh` (wired into `.githooks/pre-commit` and `.gitconfig-fragment`) lints only the **staged** files of each language, and **skips any linter whose tool is absent**. This hook is the consumer's only lint backstop — the heavyweight toolchain is platform-internal, so a contributor without the full toolchain is never blocked. Bypass one commit with `SKIP_LINT_STAGED=1`. `npm run lint` / `npm run format` cover the npm-based tools.

**Parse structured formats with a real parser — never hand-roll.** Anything that reads a workflow, an `action.yml`, or the Decap/Jekyll config YAML goes through a real parser (the [`yaml`](https://www.npmjs.com/package/yaml) library in JS, `YAML.safe_load_file(..., aliases: true)` in Ruby), never a regex or line-scanner. GitHub enabled YAML anchors in workflows on 2025-09-18, so a line-based scanner now silently mis-reads aliased values. Kept inline rather than deferred to a skill because it governs any script written here, not just the lint toolchain.

Per-language linter tables and the deliberate rule relaxations describe the platform-internal toolchain, most of which has no local target left in this thin consumer — no `e2e/`, `admin/*.css`, `assets/css/`, `*.py`, `*.rb`, `pyproject.toml`, or `tests/` exist here today. Full detail lives in the **code-quality** skill.

## Workflow path-filtering rule

Every workflow that triggers on `pull_request` or `push` must filter on its salient paths, or use the always-run + early-skip pattern if it's a required check — get this wrong and you either burn runner minutes on no-ops or create a missing-check trap that blocks every merge. → read `docs/WORKFLOWS.md` before adding a workflow trigger or changing a `paths:`/`paths-ignore:` list; see also the **workflow-path-audit** skill.

## CI / GitHub Actions

- **Validate workflow / composite-action YAML before committing.** Quote `description` and other string values that contain special characters, and parse the file with the [`yaml`](https://www.npmjs.com/package/yaml) library or `yamllint` before committing — never eyeball it. (Complements the parser rule under Code quality, which governs how tests/scripts *read* these files at runtime.)

## Workflows

Every workflow's trigger, jobs, required-secrets, and the full `main` branch-protection required-status-check topology — deploy-production/preview, the CMS editorial workflow (and the persistent "adding labels" dialog it can trigger), visual-regression, the real-network publish-loop family, sweep-stale-cms-prs, auto-resolve-newline-conflict, dependabot-auto-merge, e2e-tests, secrets-scan, plus branch hygiene and how to read a PR diff after a squash-merge. → read `docs/WORKFLOWS.md` before adding a workflow, changing branch protection, or triaging a stuck/failing CI run; see also the **cms-stuck-pr-triage**, **editorial-label-audit**, **post-failure-comment**, and **platform-release-and-bump** skills.

## E2E testing

The 10-project browser/viewport matrix (public-page lane + admin lane), tag-based project routing (`@admin-write`/`@admin-read`), the custom `e2e/base.js` fixture, and CI harness mechanics (sandboxed-shell gotchas, the Playwright browser-download CDN allowlist, per-project worker counts). → read `docs/TESTING.md` before writing a new e2e test or debugging a matrix/tag-routing failure; see also the **browser-testing** skill.

## Failure-comment composite action

Every Playwright-running workflow forwards its captured log to a shared, gitleaks-scrubbing composite action that posts (and resolves) a marker-tagged PR comment, so CI failures are triage-able without an authenticated `gh` CLI. → read `docs/WORKFLOWS.md` before adding a new Playwright-running workflow or a new failure-comment marker; see also the **post-failure-comment** skill.

## Recursion gate composite action

The three real-prod loop workflows can re-trigger themselves (their own canary-merge push matches their own `paths:` filter); a shared `recursion-gate` composite decides per-event whether the heavy loop job actually runs, replacing a commit-message-prefix guard that was structurally unreliable. → read `docs/WORKFLOWS.md` before touching loop trigger logic or adding a new self-triggering workflow; see also the **ci-watcher-loops** skill.

## Loop-aware required checks and byte-preserving harness baselines

When a real-prod loop spec mutates a persistent fixture in place, a required check and a harness `afterAll` safety net both need to agree on the fixture's canonical state — get the loop-aware exemption or the byte-preserving derivation wrong and you either deadlock the loop or silently corrupt `main`. → read `docs/CI-INVARIANTS.md` before changing a required check that asserts a `main`-state invariant or a harness baseline-restore safety net.

## CI-flakiness invariants (#1723) — read before touching the prod loops / deploy waits

Six root-caused, lint-locked flakiness classes from the 2026-05 CI audit — future-dated fixture builds, test-fixture leakage into public listings/crawls, the queue-aware deploy-lane wait, and more — each with a standing "do NOT undo this" guard. → read `docs/CI-INVARIANTS.md` before touching a prod loop, a deploy wait, or a public-content crawl exclusion; see also the **ci-watcher-loops** skill.

## Preview environment flow

1. PR opened → Jekyll builds at root (no baseurl) → sync to `s3://adamdaniel-ai-previews/pr-{N}/`
2. CloudFront cache invalidated at `/pr-{N}/*` (what the viewer-request Function rewrites requests to)
3. Bot posts `https://preview-pr{N}.adamdaniel.ai/` as PR comment
4. PR closed → S3 files deleted, CloudFront invalidated, existing comment updated to "cleaned up"

## Skills

**This consumer vendors no platform skills — do NOT re-vendor them.** Until
issue #3104 it mirrored 15 of them byte-for-byte under `.claude/skills/`, kept
in step by a weekly `skills-sync` rsync and a `platform-drift-guard` byte
check. Both are gone: cms-platform v0.1.83 deleted the transport, and its
`skills/` is now published as the federated **`cms-platform` bundle** in the
`agentskills` marketplace. (The gem is NOT the skills channel — it ships the
`/admin` machinery. The two are unrelated deliveries.)

Skills reach an **ephemeral** session (cloud, CI runner, container) through the
`skills-bootstrap` SessionStart hook in `.claude/hooks/`, copied verbatim from
`agentskills` and wired in `.claude/settings.json`. It installs from the
committed **`skills.lock`**, which pins two registries at immutable commits
with a per-skill sha256: `Adam-S-Daniel/agentskills` for the `adam` bundle and
`Adam-S-Daniel/cms-platform` for the `cms-platform` bundle — 23 skills, all
verified before they land in `~/.claude/skills`. On a durable machine the hook
is a deliberate no-op; the marketplace plugin install is authoritative there.

Two things to know when touching this:

- **`skills.lock` pins commits, not branches, so it does not self-update.** A
  skill added or changed upstream reaches no session here until the lock is
  regenerated against the published commit — with `agentskills`'
  `scripts/generate_skills_lock.py` (`--check-current` reports the gap).
  Bumping `platform_ref` does NOT move it; the two pins are independent.
- **That hook’s SessionStart entry carries `timeout: 90`, not the `30` its
  sibling uses.** The hook’s own budget for fetching all sources is 60s, so a
  30s harness timeout would kill it mid-fetch and lose the fail-soft verdict it
  exists to print. JSON has no comments, hence the note here.

**Where the "see also the **X** skill" pointers in this file resolve.** They
still resolve — a skill being delivered rather than vendored does not move it —
but nothing in the repo shows you *which* bundle any given one comes from, so:
the CMS/site-machinery skills (`browser-testing`, `admin-config-render`,
`ci-watcher-loops`, `cms-stuck-pr-triage`, `editorial-label-audit`,
`post-failure-comment`, `platform-release-and-bump`, `code-quality`,
`preview-environments`, `aws-bootstrap`, `cms-platform-secrets`,
`github-actions-sha-pinning`, `sveltia-cms-playwright-demo`, `test-canary`)
are the `cms-platform` bundle; the general-purpose ones (`finding-unknowns`,
`writing-adrs`, `skills-doctor`, …) are `adam`. The one that MOVED is
**`workflow-path-audit`**, cited under "Workflow path-filtering
rule" and in `docs/WORKFLOWS.md`: v0.1.83 dropped it from cms-platform and it
now ships in `adam`. Same skill, same name, different bundle — which matters
only if you go looking for its source.

The secrets-scan + lint-staged pre-commit guards that used to ride the old
skills `bootstrap.sh` arrive via the platform’s `dev-hooks-sync.yml` (see
`docs/WORKFLOWS.md`, "`secrets-scan.yml`") — unaffected by any of this.

The one **site-owned** skill is `.claude/skills/embeddable-tool-pages/`
(how to add a `/tools/` page or embed a tool in a post — see
`docs/CMS-ADMIN.md`, "Tools section"). It lives in Claude Code’s native
project-skill location, and is site content rather than platform machinery, so
no registry ships it and nothing syncs it. Neither bundle uses that basename,
so the hook’s collision guard never has to arbitrate over it.

## A green `e2e / e2e` is not proof the real e2e lane ran

- **On a mixed PR — one touching both a code path and an ignored path — treat a
  green `e2e / e2e` as unverified until you have watched the real run finish.**
  Two workflows emit that same context: the heavy `e2e-tests.yml` and the
  instant-green `e2e-stub.yml`, whose positive `paths:` byte-mirrors the real
  caller's `paths-ignore:` (`README.md`, `AGENTS.md`, `CLAUDE.md`, `docs/**`,
  `infrastructure/**`, `oauth-proxy/**`, `LICENSE`, `.gitignore`). A mixed PR
  matches both filters, so **both fire**. Branch protection keys on the context
  NAME, not on which workflow produced it — so if the stub reports green before
  the real run's check-run exists, the context can read satisfied and auto-merge
  can merge on the stub alone.
- cms-platform's `e2e-required-stub.yml` header claims the opposite ("on a mixed
  (docs + code) PR BOTH fire and the REAL e2e still gates"). PR #1711 — merged
  2026-05-26 20:52 under the older multi-context topology — merged on stub greens
  while the real e2e was still running, and it went red three minutes later. The
  window is narrower now that the e2e family has collapsed into a single
  `e2e / e2e`, and the race has not been re-reproduced under that topology — but
  no fix has shipped either. Re-read the reusable's header before relying on its
  reassurance; until it is qualified, treat it as unproven.
- **So: when a mixed PR merges, watch the real run to completion**
  (`gh run watch <run-id>`) and fix forward on `main` if it goes red. Don't walk
  away on the merge notification.
