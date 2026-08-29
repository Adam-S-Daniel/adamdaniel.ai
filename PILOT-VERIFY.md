# PILOT-VERIFY

Measurement probe for the AGENTS.md stub + user-memory (`fleet-memory`) delivery
pilot. The STEP 1 answers were written from session-start context **before any
tool ran**; STEP 2 is raw command output captured afterwards.

Session: `adamdaniel.ai`, hosted (Claude Code remote), 2026-08-29.

---

## STEP 1 — introspection (from context only, pre-tool)

### (a) Verbatim `Contents of <path> ...` header lines in session-start context

```
Contents of /root/.claude/CLAUDE.md (user's private global instructions for all projects):
Contents of /home/user/adamdaniel.ai/CLAUDE.md (project instructions, checked into the codebase):
Contents of /home/user/adamdaniel.ai/AGENTS.md (project instructions, checked into the codebase):
```

Three headers, one per loaded memory file. No other `Contents of` lines were
present.

### (b) Is the fleet guidance present? Which path is it attributed to?

**YES.** The full managed block — incidents, the two GitHub connectors, SHA
pinning, subagent delegation, the `${PIPESTATUS[0]}` and `grep -q` traps,
workstation layout, the skills ecosystem — is in context, attributed to
**`/root/.claude/CLAUDE.md`**, labelled "user's private global instructions for
all projects". It is not attributed to any repo file.

### (c) Does `/home/user/adamdaniel.ai/AGENTS.md` as loaded contain the FULL guidance or a STUB?

**STUB.** As loaded it contains: the managed header, the section "Fleet guidance
is delivered once per session — not by this file", a "The floor" section
restating ~10 load-bearing rules for the DEGRADED case, then
`## Repo-specific additions` followed by the adamdaniel.ai project guide. The
long-form fleet guidance is not duplicated in it.

### (d) Which named Windows workstation holds local clones under `D:\repos`? (no file reads)

**`ZENDA`** — `D:\repos\<github-owner-or-org>\<repo>`.

### (e) Is the adamdaniel.ai repo-specific content still in context?

**YES.** Decap CMS and the gem-delivered `admin/`, the CloudFront preview
architecture (`preview-pr${N}.adamdaniel.ai` → S3 `/pr-${N}/`), the e2e
browser/viewport matrix with `@admin-read` / `@admin-write` tag routing, the AWS
resource table, the `CMS_E2E_PAT` secrets table, the `docs/`
progressive-disclosure map, and the "a green `e2e / e2e` is not proof" section
are all present.

### (f) Session-start `fleet-guidance` verdict line

```
fleet-guidance: installed (v293f2c87, 52279 bytes) -> ~/.claude/CLAUDE.md
```

Sibling hook verdicts in the same session-start output:

```
setup-hooks: exported LANG=C.UTF-8 for web-session shells
setup-hooks: core.hooksPath set to .githooks (git 2.43.0)
skills: 22/22 from Adam-S-Daniel/agentskills@b0b93b3, Adam-S-Daniel/cms-platform@633b865 — OK
```

---

## STEP 2 — gathered facts (raw command output)

### `wc -c ~/.claude/CLAUDE.md AGENTS.md`

```
52424 /root/.claude/CLAUDE.md
30686 AGENTS.md
83110 total
```

### `grep -c "BEGIN FLEET GUIDANCE" ~/.claude/CLAUDE.md`

```
1
```

### `grep -n "fleet-guidance-version" ~/.claude/CLAUDE.md | head -1`

```
2:<!-- fleet-guidance-version: 293f2c87 -->
```

### `head -20 AGENTS.md`

```
<!-- BEGIN MANAGED SECTION — DO NOT EDIT ABOVE "## Repo-specific additions" -->
<!-- Source: _agent-guidance -->
<!-- Sections: none -->
<!-- Mode: stub -->

# AGENTS.md

> **Managed by [`_agent-guidance`].**
> Edit only below the `## Repo-specific additions` header.
> Everything above it will be overwritten on the next sync.

## Fleet guidance is delivered once per session — not by this file

The account's full guidance — incidents, fleet policy, machine layout, the
traps that cost real outages — is installed into **user memory**
(`~/.claude/CLAUDE.md`) by the `fleet-memory` SessionStart hook, so it is
loaded **once per session** no matter how many repos are attached. It used to
be inlined here in every repo, which meant a session with 19 repos open
carried 19 identical copies: 332.3k tokens of a 1M window, measured
2026-08-29.
```

### `python3 -c "import json;print(json.dumps(json.load(open('.claude/settings.json')),indent=1))"`

```json
{
 "hooks": {
  "SessionStart": [
   {
    "matcher": "startup|resume",
    "hooks": [
     {
      "type": "command",
      "command": "bash \"$CLAUDE_PROJECT_DIR/scripts/setup-hooks.sh\"",
      "timeout": 30
     }
    ]
   },
   {
    "matcher": "startup|resume",
    "hooks": [
     {
      "type": "command",
      "command": "bash \"$CLAUDE_PROJECT_DIR/.claude/hooks/skills-bootstrap.sh\"",
      "timeout": 90
     }
    ]
   },
   {
    "matcher": "startup|resume",
    "hooks": [
     {
      "type": "command",
      "command": "bash \"$CLAUDE_PROJECT_DIR/.claude/hooks/fleet-memory.sh\"",
      "timeout": 30
     }
    ]
   }
  ]
 },
 "worktree": {
  "symlinkDirectories": [
   "vendor",
   "node_modules",
   ".bundle"
  ]
 }
}
```

---

## Reading of the result

The pilot behaves as designed on this surface. The repo's `AGENTS.md` is a stub
(`Mode: stub`, `Sections: none`); the full guidance arrives once via
`~/.claude/CLAUDE.md`, installed by the `fleet-memory.sh` SessionStart hook
wired in `.claude/settings.json`; and both the fleet-level knowledge (d) and the
repo-level knowledge (e) are simultaneously in context. The version marker in
user memory (`293f2c87`) matches the hook's own verdict line.

Two notes on the numbers:

- `~` resolves to `/root` in this session, so `~/.claude/CLAUDE.md` and the
  `/root/.claude/CLAUDE.md` context header name the same file.
- Its on-disk size (52424 bytes) exceeds the hook's reported payload (52279
  bytes) by 145 bytes — the version marker and managed-block wrapper the hook
  writes around the payload.

### Caveat on the STEP 1 answers

(a)–(f) are self-report. They are consistent with the STEP 2 measurements —
which is evidence, not proof — but nothing here independently verifies that the
pre-tool context was what this file says it was.
