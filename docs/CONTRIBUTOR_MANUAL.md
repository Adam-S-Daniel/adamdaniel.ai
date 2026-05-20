# Contributor Manual

This manual is **assembled by the test suite**: every screenshot and step description below was captured during a real Playwright e2e run, so the document is always in sync with the actual contributor flow.

If a step looks wrong, the test that captured it is wrong too. The fix is in the test file shown under each screenshot — open it, update the `captureStep(...)` call, push, and the manual regenerates on the next run of `.github/workflows/regenerate-manual.yml`.

_Last regenerated: 2026-05-20T19:35:23.266Z_

---

## Sections

1. [Logging in](#logging-in)
2. [Editing a post](#editing-a-post)
3. [Marking ready and publishing](#marking-ready-and-publishing)

## Logging in

Decap CMS authenticates through a small Lambda OAuth proxy. Visit `/admin/`
on either the production site or a PR preview subdomain — both go through
the same proxy and end up logged in as the same GitHub user.

### 1.1. Open the admin

Visit `/admin/` to open the editor. Decap shows a single login button — click it to start the OAuth flow against the small Lambda proxy. On a PR preview the URL is `https://preview-pr<N>.adamdaniel.ai/admin/`; on production it's `https://adamdaniel.ai/admin/`. Both flow through the same proxy and end up logged in as the same GitHub user.

![Open the admin](manual-screenshots/logging-in/1-1-open-the-admin.png)

<sub>URL: [http://localhost:4000/admin/index-local#/](http://localhost:4000/admin/index-local#/)</sub>

<sub>Captured by `e2e/cms-smoke.spec.js` → _admin loads, logs in, creates a tag, saves it, deletes it_ on `chromium-desktop-3k` at 2026-05-20T19:29:14.922Z.</sub>

---

## Editing a post

### 3.2. Open an existing post in the editorial workflow

Editorial workflow mode loads the existing entry into a fully editable form. Every widget — Title, Slug, Date, Body, Tags, Featured Image — is enabled (no read-only state) and the toolbar shows a Status dropdown plus a Delete published entry button.

![Open an existing post in the editorial workflow](manual-screenshots/editing-a-post/3-2-open-an-existing-post-in-the-editorial-workflow.png)

<sub>URL: [http://localhost:4000/admin/index-test#/collections/posts/entries/2026-04-25-replacement-test-post-1](http://localhost:4000/admin/index-test#/collections/posts/entries/2026-04-25-replacement-test-post-1)</sub>

<sub>Captured by `e2e/cms-editorial-workflow.spec.js` → _opening an existing post renders all fields editable + Delete button enabled_ on `chromium-desktop-3k` at 2026-05-20T19:22:50.484Z.</sub>

---

## Marking ready and publishing

### 5.1. Save in editorial workflow

With `publish_mode: editorial_workflow`, the toolbar's primary action is **Save** rather than Publish. The first Save creates a `cms/posts/<slug>` branch and opens a PR; subsequent Saves push commits onto that branch. The PR appears with the `cms/draft` label and stays in draft until you change the Status.

![Save in editorial workflow](manual-screenshots/marking-ready-and-publishing/5-1-save-in-editorial-workflow.png)

<sub>URL: [http://localhost:4000/admin/index-test#/collections/posts/entries/2026-04-25-replacement-test-post-1](http://localhost:4000/admin/index-test#/collections/posts/entries/2026-04-25-replacement-test-post-1)</sub>

<sub>Captured by `e2e/cms-editorial-workflow.spec.js` → _editing an existing post and saving creates a workflow draft_ on `chromium-desktop-3k` at 2026-05-20T19:22:56.155Z.</sub>

### 6.1. Filled-out post ready to publish

Title, slug, body, tags, and the Published toggle are all set. In editorial workflow mode (production), the toolbar shows **Save** and a separate Status dropdown; clicking Save opens a PR in draft. Setting the dropdown to **Ready** is what triggers the auto-merge.

![Filled-out post ready to publish](manual-screenshots/marking-ready-and-publishing/6-1-filled-out-post-ready-to-publish.png)

<sub>URL: [http://localhost:4000/admin/index-local#/collections/posts/new](http://localhost:4000/admin/index-local#/collections/posts/new)</sub>

<sub>Captured by `e2e/cms-publish-flow.spec.js` → _create a post in Decap, rebuild, and assert /blog/<slug>/ renders it_ on `chromium-desktop-3k` at 2026-05-20T19:22:51.540Z.</sub>

### 6.2. Publish menu open

Decap's primary button is a split control. Clicking the Publish trigger opens a menu — **Publish now** commits the entry; **Publish and create new** commits then routes you to a fresh blank entry. In editorial-workflow mode this is replaced with a Save → Status flow.

![Publish menu open](manual-screenshots/marking-ready-and-publishing/6-2-publish-menu-open.png)

<sub>URL: [http://localhost:4000/admin/index-local#/collections/posts/new](http://localhost:4000/admin/index-local#/collections/posts/new)</sub>

<sub>Captured by `e2e/cms-publish-flow.spec.js` → _create a post in Decap, rebuild, and assert /blog/<slug>/ renders it_ on `chromium-desktop-3k` at 2026-05-20T19:22:51.920Z.</sub>

### 6.3. Published post live

After the publish settles, the post is reachable at its public URL — here `/blog/<slug>/`. In production the same URL pattern is served by CloudFront once `deploy-production.yml` finishes its `aws s3 sync` and invalidation, typically within ~2 minutes of the merge.

![Published post live](manual-screenshots/marking-ready-and-publishing/6-3-published-post-live.png)

<sub>URL: [http://localhost:4000/blog/e2e-publish-flow-smoke/](http://localhost:4000/blog/e2e-publish-flow-smoke/)</sub>

<sub>Captured by `e2e/cms-publish-flow.spec.js` → _create a post in Decap, rebuild, and assert /blog/<slug>/ renders it_ on `chromium-desktop-3k` at 2026-05-20T19:22:56.620Z.</sub>

---
