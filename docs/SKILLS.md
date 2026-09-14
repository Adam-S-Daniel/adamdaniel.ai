# Skills delivery

How agent skills reach a session working in this repo: what this consumer does
and does not vendor, how the `skills-bootstrap` SessionStart hook installs from
the committed `skills.lock`, which bundle each "see also the **X** skill"
pointer in AGENTS.md resolves to, and the one site-owned skill. Read this before
adding a skill pointer, regenerating `skills.lock`, or working out why a skill
you expected is not loaded. Moved verbatim from AGENTS.md's `## Skills` section,
which keeps the rules in short form.

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
