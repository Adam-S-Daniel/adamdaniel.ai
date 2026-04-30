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
| Upload a featured image | `e2e/cms-image-upload.spec.js` — uploads `e2e/fixtures/tiny-pixel.png`, asserts it lands under `assets/images/uploads/YYYY/MM/`, that the front matter references the public URL, and that `<img.featured-image>` resolves on the rendered post | yes |
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
- **`{{year}}/{{month}}` media-folder template expansion**: decap-server
  (the local backend) does not expand the template — it writes the
  literal path. The production GitHub backend does expand it. The
  template's presence in `admin/config.yml` is enforced by
  `e2e/cms-config.spec.js`; the runtime expansion behaviour fires only
  on the GitHub backend, where `cms-publish-flow.spec.js` and the
  preview pipeline cover the live render.
