# Contributor capabilities — e2e coverage

Each row maps a documented contributor capability (from `AGENTS.md`,
`admin/config.yml`, and `docs/CONTENT_GUIDE.md`) to the Playwright spec
that proves it works end-to-end against the local Decap backend.

| Capability | Spec | Verified |
|---|---|---|
| Login → admin loads with collections sidebar | `e2e/cms-smoke.spec.js` | yes |
| Create a new Post (full schema) | `e2e/cms-publish-flow.spec.js` (CMS → disk → live URL) and `e2e/cms-smoke.spec.js` (Posts schema render audit) | yes |
| Edit an existing Post | `e2e/cms-editorial-workflow.spec.js` (`editing an existing post and saving creates a workflow draft`) | yes |
| Delete a Post | `e2e/cms-editorial-workflow.spec.js` asserts the "Delete published entry" toolbar button is enabled on an existing post; `cms-smoke` exercises the full delete code path on Tags (shared persistEntry path). | yes |
| Schedule a Post for future publishing | `e2e/cms-scheduled-post.spec.js` — drives the editor for the future-dated draft AND runs `scripts/publish_scheduled_posts.py` against a fixture to prove the flip-on-arrival half | yes |
| Upload a featured image | `e2e/cms-image-upload.spec.js` — uploads `e2e/fixtures/tiny-pixel.png`, asserts it lands directly in `assets/images/uploads/` (flat, no subdirectory), that the front matter references the byte-identical public URL, and that the rendered `<img.featured-image>` src actually fetches **200** | yes |
| Full media round trip on the real live site (upload via Media UI → add to post → publish → image loads on adamdaniel.ai → remove from post → publish → delete via Media UI → image URL 404s) | `e2e/cms-media-roundtrip.spec.js` — real Decap + real GitHub backend + real production deploy, no backdoors. Gated to the `cms-publish-loop-prod.yml` workflow (PROD_PLAYGROUND_MODE) | yes |
| Create / edit / delete a Tag | `e2e/cms-smoke.spec.js` (create+save+delete) and `e2e/cms-editorial-workflow.spec.js` (create-through-workflow) | yes |
| Create / edit / delete a Project | `e2e/cms-project-crud.spec.js` — drives title / technology / url_link / featured, asserts the on-disk file at create / edit / delete | yes |
| Create / edit / delete a Page (with permalink) | `e2e/cms-page-crud.spec.js` — drives title / permalink / published / body, rebuilds Jekyll, fetches the permalink, asserts the body renders, then edits + deletes | yes |
| Open Live Preview | `e2e/preview-shell.spec.js` (preview shell contract) and `e2e/preview-bridge.spec.js` (admin → preview broadcast bridge) | yes |
| Use Status dropdown (Draft → In Review → Ready) | `e2e/cms-editorial-workflow.spec.js` (`Status dropdown cycles Draft → In Review → Ready on the saved draft`) | yes |
| Visit `/admin/reviews/` and approve a regression | `e2e/admin-reviews-auth.spec.js`, `e2e/admin-reviews-stats.spec.js` | yes |
| `?notheme` kill-switch in admin | `e2e/admin-notheme.spec.js` — guardrail spec (the cobalt theme it killed was retired in PR #81; the spec asserts the theme markers are absent on both `/admin/` and `/admin/?notheme` so a future re-introduction must ship the kill-switch alongside) | yes |

## What is NOT covered end-to-end

- **`publish-scheduled-posts.yml` cron firing live.** The spec only
  invokes the underlying Python script and yaml-parses the workflow
  wiring; the GitHub Actions cron itself runs daily at 14:00 UTC and
  exercising the live trigger requires waiting for the schedule.
- **GitHub-backed Save → PR loop.** Driving real OAuth + GitHub from a
  spec is out of scope; `e2e/cms-publish-flow.spec.js` already covers the
  publish loop against `local_backend: true`, and the editorial-workflow
  branching is covered against Decap's in-browser `test-repo` backend in
  `e2e/cms-editorial-workflow.spec.js`.
- **Media path is flat + template-free, by design.** `media_folder`
  and `public_folder` are both `assets/images/uploads` (no
  `{{year}}/{{month}}`). Decap appends only the file's basename to
  `public_folder`, so a date-bucketed `media_folder` would desync the
  on-disk path from the URL written into content (broken images) and
  leave a literal `{{year}}` in the standalone Media library's Copy
  Path. The structural invariant (`public_folder == "/" +
  media_folder`, no template tokens) is enforced by
  `e2e/cms-config.spec.js`. Because the path is flat, decap-server and
  the production GitHub backend now write the IDENTICAL path, so the
  local upload specs are faithful end-to-end checks; the full real-
  backend round trip (including delete-via-Media-UI → live 404) is
  covered by `e2e/cms-media-roundtrip.spec.js`.
