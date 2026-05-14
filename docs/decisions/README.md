# Architecture Decision Records

This folder captures **why** non-obvious decisions were made — the kind of context
that's not in the code, that git blame won't surface, and that a contributor a
year from now would re-derive (badly) without it.

Format: lightweight [Nygard-style ADRs](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions).

## When to write one

Write an ADR when **any** of these are true:

- The decision is surprising at first glance and would invite "let's just change it back" without context. Example: switching the e2e canary body from `widget: markdown` to `widget: text` looks like a downgrade until you know about the Slate round-trip.
- The decision rules out an obvious-looking alternative for a non-obvious reason. Document the alternative AND the reason, so future-you doesn't waste a day re-evaluating it.
- The decision is load-bearing for a workflow that costs real runner minutes or affects production state (e.g. the publish-loop's cleanup contract, the ruleset on `main`, the choice to use `CMS_E2E_PAT` vs `GITHUB_TOKEN`).
- The decision was prompted by a specific incident or PR — link to it. Memory rots; PR links don't.

Skip an ADR when:

- The "why" is already in a code comment near the decision, AND that code is unlikely to move.
- The decision is a one-character cosmetic preference.
- The decision was made for you by an external constraint (a library API shape, a GitHub Actions limitation) — those go in the call site, not here.

## Naming

`NNNN-kebab-case-title.md`, starting at `0001`. Pad to 4 digits so they sort right when there are more than ten.

## Template

Copy this for new ADRs:

```markdown
# NNNN. Title (imperative verb + object)

**Status:** Accepted | Proposed | Superseded by [NNNN](NNNN-…) | Deprecated
**Date:** YYYY-MM-DD
**Tags:** comma, separated, optional

## Context

What was the situation that forced a decision? What constraints applied? What did we observe?

## Decision

What we did, in one or two sentences.

## Consequences

What changes for callers / contributors / operators because of this decision? Both positive and negative — be honest about the trade-off.

## Alternatives considered

For each alternative, one short paragraph: what it was, why we rejected it. This is the section that earns its keep when a future contributor proposes one of them.

## References

PRs, issues, commits, external links. Anchor the ADR to artefacts that won't go stale.
```

## How to update

- **Don't edit accepted ADRs in place** to change the decision. Write a new ADR that supersedes the old one (`Status: Superseded by NNNN-…`) and update the old one's status. This preserves the audit trail.
- **Do edit accepted ADRs** to fix typos, add references, or clarify confusing phrasing — anything that doesn't change the recorded decision.

## Index

| # | Title | Status |
|---|---|---|
| [0001](0001-canary-body-widget-text.md) | Use `widget: text` for the e2e canary collection body in Decap CMS | Accepted |
