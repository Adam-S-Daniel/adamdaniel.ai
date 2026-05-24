# 0001. Use `widget: text` for the e2e canary collection body in Decap CMS

**Status:** Accepted
**Date:** 2026-05-14
**Tags:** cms, decap, e2e, content-pipeline

## Context

Decap CMS 3.x's `widget: markdown` renders a Slate-based WYSIWYG editor whose serializer mangles markdown line-breaks on every save round-trip:

- `\n` (soft line wrap inside a paragraph) → `\n\n` (becomes a paragraph break)
- `\n\n` (paragraph break) → `\n\n\n\n` (triple blank line)
- The blank line between the closing frontmatter `---` and the first body paragraph gets eaten

The `cms-publish-loop` spec's cleanup leg (step 9a in `e2e/cms-publish-loop.spec.js`) drives Decap's UI to type the canonical baseline body into the canary file and publish. With `widget: markdown`, the resulting file disagrees with the same baseline that the API-path setup-reset and `test.afterAll` safety-net write — those go through the Contents API directly, byte-for-byte, no Slate. The Decap-opened `cms/e2e/canary-post` PR ends up perpetually `dirty` against `main` because a sibling safety-net PR (which writes the un-mangled canonical body) lands first and the mangled head no longer canonical-collapses cleanly to main.

PR #882 was the concrete instance: a `cms/e2e/canary-post` PR whose only diff vs `main` was Slate's newline doubling, conflicting with `main` after a later `harness-cleanup-*` safety-net commit landed the canonical baseline. It sat indefinitely.

The e2e collection in `admin/config.yml` is the `[E2E TEST FIXTURES — DO NOT EDIT]` system collection. Humans do not edit it; only the Playwright publish-loop spec drives it.

## Decision

Switch the e2e collection's `body` field from `widget: markdown` (Slate WYSIWYG, with `modes: [rich_text, raw]`) to `widget: text` (plain HTML `<textarea>`). No changes to other collections.

`e2e/canary-content.test.js` adds a positive assertion that the e2e body is `widget: text` and a negative assertion that it is NOT `widget: markdown`, so a future config edit can't silently regress the choice.

## Consequences

### Positive

- **No Slate round-trip.** A `<textarea>` writes typed bytes verbatim; the canary file the publish-loop's UI cleanup commits matches the API-path baseline byte-for-byte. The `cms/e2e/canary-post` PR Decap opens has no spurious newline-doubling diff against main.
- **No editor-facing regression for humans.** The collection is system-only ("DO NOT EDIT"). Humans editing real content (posts, pages, projects) still get the `widget: markdown` WYSIWYG editor.
- **Rendering on the public site is unchanged.** Widget choice is purely an editor-UI concern. The body is still stored as markdown text in the `.md` file, and Jekyll's kramdown still renders it as HTML at build time. `https://adamdaniel.ai/e2e/canary-post/` looks identical.
- **The Playwright test code is simpler.** Locator moves from `[role="textbox"][contenteditable="true"]` to `textarea`. `pressSequentially()` still works.
- **The locked-in invariant catches drift.** `canary-content.test.js`'s body-equality assertion fails CI loudly if a future Decap config edit re-introduces `widget: markdown` and a save mangles the file. No more "stuck PR" mystery.

### Negative

- **WYSIWYG features (bold, italic, image embed, link-picker) are unavailable in the editor for this collection.** The collection's label is `[E2E TEST FIXTURES — DO NOT EDIT]` and the Playwright tests drive it via raw text typing only, so this is not a real loss — but if a future requirement demands rich editing of canary fixtures, this ADR will need to be revisited (probably superseded with "register a custom markdown widget that doesn't go through Slate's broken serializer").
- **Asymmetric collection config.** The e2e collection's body field is now structurally different from posts/pages/projects. A reader scanning `admin/config.yml` may wonder why. The inline comment block at the field (and this ADR) explains.

## Alternatives considered

### `modes: [raw]` only (keep `widget: markdown`)

Restrict the markdown widget to raw mode by removing `rich_text` from `modes:`. The toolbar disappears and the editor renders as a CodeMirror textarea-like editor. Rejected because the raw mode in Decap 3.x still routes saves through the markdown serializer pipeline — observed mangling is reduced but not zero, and the test would still depend on `widget: markdown` machinery for a use case (the canary collection) that has no need for it. `widget: text` is a cleaner break.

### Keep `widget: markdown`, single-line baseline

Restructure the canary baseline to have no hard line wraps and no paragraph breaks — collapse the whole body to one long line. The Slate round-trip can't double newlines that aren't there. Rejected because:

- The baseline source becomes ugly and hard to maintain.
- It doesn't fix the underlying bug for any future regression that adds a second paragraph.
- The fix lives in the wrong place (content shape, not editor config).

### Register a custom markdown widget with a non-mangling serializer

Override Decap's default Slate serializer via `CMS.registerWidget(...)` in `admin/index.html`. Rejected for v1 because:

- Significant work (vendoring or forking parts of Decap's widget chain).
- Risk of breaking *real* content collections that depend on the standard widget.
- The e2e collection has no need for the rich editor, so a per-collection switch (`widget: text`) is a 5-line change vs. a multi-day fork-and-maintain commitment.

If a future requirement forces rich editing of canary fixtures (or if we hit the same round-trip bug on a non-canary collection), this becomes the next thing to try.

### Bypass Decap UI for cleanup entirely (skip step 9a)

Make the publish-loop spec's cleanup ALWAYS go through the API-path `seedFixtureViaPr` helper instead of the editor UI. Rejected because the spec's explicit contract is to exercise the full editor flow end-to-end (per `AGENTS.md` "no back doors in setup or cleanup either"). The UI cleanup IS what's being validated — bypassing it is what `test.afterAll`'s safety-net already does as a last resort.

## Why this doesn't break the editor

A common reaction on first reading this change is "but doesn't switching the widget break editing?" Walking through the layers:

1. **The widget is presentation-only — it does not change file storage.** Both `widget: markdown` and `widget: text` write the body as plain text after the frontmatter `---`. The file on disk is byte-for-byte the same shape either way.

2. **Jekyll rendering is unchanged.** Jekyll reads `.md` files and runs the body through kramdown at build time, regardless of which widget Decap used in the editor. The HTML at `/e2e/canary-post/` is identical before and after this change. (Verified: the canary URL on prod renders the same.)

3. **The editor still works as an editor.** `widget: text` renders an HTML `<textarea>`. You can click, type, select, paste, save, and publish. Save → Status: Ready → Publish flow is owned by the collection, not the body field; nothing in that chain depends on the widget being markdown.

4. **Removing the `modes:` block is a no-op for `widget: text`.** The `modes` config is honored only by `widget: markdown` (it picks which Slate editor mode to render). On `widget: text` there's no mode to toggle. No regression.

5. **Other collections are untouched.** The change is scoped to the `e2e` collection's body field at `admin/config.yml`'s `- name: e2e` block. Posts, pages, projects, tags retain their `widget: markdown` config with `modes: [rich_text, raw]`. Human-facing content editing is unchanged.

The only material difference is that the e2e collection's body field no longer offers WYSIWYG features (bold/italic toolbar, image embed) in the editor. The collection is labeled `[E2E TEST FIXTURES — DO NOT EDIT]` and the Playwright tests drove the field via raw text typing, never via the toolbar, so that "loss" is intentional.

## References

- PR #882 — the original stuck-PR symptom that prompted the investigation
- PR #885 — implements this decision; adds the locked-in invariants
- PR #891 (stacked on #885) — timeout-trap diagnostic that surfaces this class of stuck-PR via a per-PR comment
- `admin/config.yml` — the `- name: e2e` collection block + inline comment
- `e2e/canary-content.test.js` — `widget: text` invariant assertion
- `e2e/canary-content.js` — canonical `baselineBody` shared by setup-reset, UI cleanup, and the safety-net
- [Decap CMS widgets reference](https://decapcms.org/docs/widgets/) — `text` vs `markdown` widget docs
- Decap CMS 3.12.2 (pinned in `package.json` and `admin/index.html`) — the version exhibiting the Slate round-trip
