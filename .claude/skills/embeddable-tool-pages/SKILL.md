---
name: embeddable-tool-pages
description: Add a self-contained interactive tool to the site's Tools section, or embed one in a blog post. Use when asked to "add a tool", "add a tools page", "publish an explorable/calculator/widget as a page", "embed an interactive HTML app", or "add a new top-level site section". Covers the `tools` Jekyll collection, the static-asset + iframe embed pattern, the Decap CMS wiring (admin/collections.site.yml), the local nav override, and embedding the same tool in a post. Trigger on mentions of "tools section", "tool page", "embed", "explorable", or "iframe widget".
---

# Embeddable tool pages

The site has a **Tools** section (`/tools/`) for small, self-contained
interactive things — explorables, calculators, diagrams. Each tool is a
standalone HTML app served as a static asset and shown inside the site chrome
via an `<iframe>`. The same asset can be embedded in a blog post.

This pattern keeps a self-contained app (its own `<head>`, scripts, CDN deps)
isolated from the site's CSS/JS — no collisions — while still giving it a real
page with the header, footer, and a clean `/tools/<slug>/` URL.

## How the Tools section is wired

Five pieces, all already in place. To add a *new* tool you usually only touch
the last two (asset + collection entry).

| Piece | File | Role |
| --- | --- | --- |
| Collection | `_config.yml` → `collections.tools` (`output: true`, `permalink: /tools/:slug/`) + a `defaults` entry mapping `type: tools` → `layout: tool` | makes `_tools/*.md` render at `/tools/<slug>/` |
| Layout | `_layouts/tool.html` (local; extends the gem's `default`) | renders title, description, the embed `<iframe>`, "Open full screen" + "Source" links, and the markdown body |
| Index | `tools/index.html` (`permalink: /tools/`) | the card grid, modeled on `projects/index.html`; featured tools sort first |
| Nav | `_includes/header.html` (local override of the gem header) | adds the **Tools** nav link. This is a full copy of the gem's `_includes/header.html` plus one line — re-sync it with the gem when bumping the platform |
| CMS | `admin/collections.site.yml` | surfaces a **Tools** collection in the Decap admin. Spliced into the generated `admin/config.yml` at the `# __SITE_COLLECTIONS__` marker by the gem's `decap_config_hook.rb` |

The local `_includes/header.html` and `_layouts/tool.html` **shadow** the
gem-shipped versions (Jekyll prefers site files over theme-gem files). That's
the sanctioned override seam (see the `theme:` note in `_config.yml`), but it
does mean the header can drift from the gem — keep it minimal.

## Add a new tool

1. **Drop the self-contained app** at `assets/tools/<slug>/index.html`. It must
   be a complete HTML document and should not assume the site's CSS. A file
   with no YAML front matter is copied through verbatim and served at
   `/assets/tools/<slug>/`. (Keep a copy verbatim from its source repo so it
   stays easy to re-sync; note the source commit in the page/PR.)

2. **Create the collection entry** `_tools/<slug>.md`:

   ```yaml
   ---
   title: My Tool
   slug: my-tool
   description: One-line summary (shown on the index and the page header).
   featured: false
   embed_src: /assets/tools/my-tool/
   source_url: https://github.com/Adam-S-Daniel/my-tool   # optional
   ---
   Markdown context shown below the embed.
   ```

   `embed_src` is what the layout iframes. Omit it for a non-embed page.

3. **Build and verify** (the static-asset + iframe approach has no CSP issues —
   no CSP is enforced; inline scripts and CDN deps work):

   ```bash
   bundle exec jekyll build
   # confirm _site/tools/<slug>/index.html exists, the iframe src is
   # /assets/tools/<slug>/, and _site/admin/config.yml parses and lists the
   # tool under collections (the CMS render runs at post_write).
   ```

That's it — the index, nav, and CMS pick it up automatically from the
collection.

## Embed a tool in a blog post

Use the standard HTML-embed seam (see *Embedding HTML / Widgets* in AGENTS.md):
an `<iframe>` to the same asset, inside the sentinel block, and link the
permanent `/tools/<slug>/` page so readers can open it full-screen.

```html
<!-- html-embed:start -->
<div class="post-embed">
<iframe src="/assets/tools/<slug>/" title="My Tool" loading="lazy"
  style="width:100%; height:80vh; min-height:560px; border:1px solid #E4DFD4; border-radius:8px;"></iframe>
<p style="font-size:0.85em"><a href="/tools/<slug>/">Open the full-page version →</a></p>
</div>
<!-- html-embed:end -->
```

The Decap `/preview/` renders the embed but does **not** run iframe content
(scripts inserted via `innerHTML` don't execute); confirm the live behavior on
the PR preview environment, where the page loads as a real document.

## Notes

- New `_tools/*.md` entries render at build; no Decap UI delete spec exists for
  the collection, so the `create:`/`delete:` flags in `admin/collections.site.yml`
  are informational (both `true`, per the standing rule).
- `assets/tools/claude-memory-map/index.html` is **automation-managed**: the
  source repo's workflows sync it (PR w/ auto-merge) and mirror source-repo PRs
  into `tool-preview/*` draft PRs for previews. Don't hand-edit the asset or
  its `_data/tool_sources/` record here — see "Vendored-tool sync + previews"
  in AGENTS.md. A tool synced this way needs the same two workflows in *its*
  repo (copy `site-{sync,preview}.yml` + `scripts/sync-to-site.sh` from
  claude-memory-map and change the slug/paths).
- A `tool-sync/*` PR is expected to auto-pass `visual-regression`'s
  `approve-regression` gate with no human reviewer — deliberately so from the
  cms-platform release that adds `assets/tools/**` + `_data/tool_sources/**`
  to `e2e/visual-regression-salient.js`'s `NON_SALIENT_OVERRIDES` (pinned
  ≤v0.1.58, it's a side effect of the tool's page not yet being in the
  regression page universe, not an explicit carve-out). See AGENTS.md's
  "Visual-regression gotchas" (under `visual-regression.yml`) for the full
  mechanics — a sync PR that unexpectedly hits a human review prompt means
  something outside the tool's own asset changed.
- This skill lives at `.claude/skills/embeddable-tool-pages/` — the one
  site-owned skill in the repo (the old `.agents/skills/` mirror and the
  vendored platform skill set were removed in the #2007-P7 thin-ification).
