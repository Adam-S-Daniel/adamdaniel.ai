# Editor's guide to adamdaniel.ai

A walkthrough for someone using the CMS for the first time. You only need
GitHub for the initial sign-in — everything else happens inside the editor.

---

## 1. Sign in

1. Go to <https://adamdaniel.ai/admin/>.
2. Click **Login with GitHub** and authorize the app.

That's the only time you'll touch GitHub. From here on you work inside the
CMS shell.

## 2. The four collections

The left sidebar shows everything you can edit. All four are folder
collections — you can **create**, **edit**, and **delete** entries in
each from the CMS UI:

| Collection | What it holds | When to use it |
|---|---|---|
| **Posts** | Blog articles in `_posts/` | Anything dated; goes on `/blog/` |
| **Tags** | Tag descriptions in `_tags/` | Optional — only needed if you want a description on a tag's archive page |
| **Projects** | Portfolio entries in `_projects/` | Featured work shown on `/projects/` |
| **Pages** | Static pages in `pages/` | About Me, Contact, plus any new pages you create |

## 3. Write a blog post

Click **Posts → New Post** and fill in the fields. The form is
self-documenting — every field has a hint underneath — but here's the
guided tour:

### Required

- **Title** — the headline. Used for the `<h1>`, browser tab, and social
  cards. The URL slug is auto-generated from this if you leave the URL
  Slug field blank.
- **Date** — defaults to "now". Don't change it unless you're backdating
  a post on purpose; the URL contains the date.
- **Body** — the article itself, in Markdown. Toggle between *rich text*
  and *raw* with the toolbar button at the top of the editor. Drag images
  straight in to upload them.

### Optional but recommended

- **URL Slug** — leave blank to auto-generate from the title. Only set it
  manually if you need a specific URL or you're replacing an existing
  published post (in which case the slug must match the old one to avoid
  breaking inbound links).
- **Excerpt** — one or two sentences shown in listings, RSS, and social
  share cards. Aim for ≤ 160 characters.
- **Tags** — type a tag and press Enter; repeat for additional tags. New
  tags get an archive page automatically — no need to create them up
  front. (See *Tags collection* below if you want to give a tag a
  description.)
- **Featured Image** — uploaded into `assets/images/uploads/`. Used as
  the post hero and the social-share thumbnail.

### Publishing controls

The two fields decide *when* the post goes live:

- **Published** (toggle):
  - **OFF** — the post is a draft. Jekyll excludes it from the build, so
    it won't appear on the site. The file is still committed.
  - **ON** — goes live on the next deploy (≈ 1–2 min after merge).
- **Publish Date** (datetime, optional):
  - Set a future UTC timestamp to schedule a publish. The
    `publish-scheduled-posts` workflow runs hourly, finds drafts whose
    publish date has passed, and flips **Published** to ON for you.
  - **Only honoured when Published is OFF.** If Published is ON, the
    post goes live immediately and this field is ignored.

So:

| Published | Publish Date | Result |
|---|---|---|
| OFF | (blank) | Permanent draft — manually publish later |
| OFF | future timestamp | Auto-publish at that time |
| ON | (anything) | Live on next deploy |

The **Reading Time** that appears on each post is calculated automatically
at build time from word count — there's nothing for you to set.

## 4. Two ways to preview

### In-CMS preview (fast, slight fidelity gap)

Built into the editor as a side pane. Uses a generic Markdown renderer,
which is fine for prose but doesn't render footnotes or attribute lists
the way the live site does.

### Real-layout preview (higher fidelity)

Open <https://adamdaniel.ai/preview/?collection=posts> in a second
browser tab and snap it next to the editor. Every time you hit **Save**,
that tab updates within a frame and renders the post with the actual
`_layouts/post.html` — the same template the live site uses.

For other collections:

- Projects: `/preview/?collection=projects`
- Pages: `/preview/?collection=pages`

The body field's hint reminds you of these URLs while you write.

## 5. Save → review → publish

### Status vs. Published — they gate two different things

The Decap toolbar shows a **Status** dropdown (Draft / In Review / Ready)
and the post form has a **Published** toggle field. They look similar.
They aren't.

| Dimension | What it controls | Where it lives |
|---|---|---|
| **Status** (Draft / In Review / Ready) | Whether the *PR* gets merged into its base branch | Decap's editorial workflow — translates to the `cms/draft` / `cms/ready` PR labels in `cms-editorial-workflow.yml`. Auto-merge fires on `cms/ready`. |
| **Published** toggle | Whether the *post*, once on its base branch, is rendered on the live site | A custom front-matter field. Jekyll filters `published: false` out of `site.posts` at build time. |

Mental model:

- **Status** = "is this *change* ready?"
- **Published** = "should this *post* be visible right now?"

A summary version of this table lives in [`README.md`](../README.md);
the cases below are the editor-facing detail.

#### Editing on `main` (the normal case)

When you edit a post via `/admin/` on the production site
(`adamdaniel.ai/admin/`), Decap creates a `cms/<collection>/<slug>`
branch off `main` and opens a PR back into `main`.

| Status | Published | Result |
|---|---|---|
| Draft / In Review | OFF or ON | PR open against `main`, not merged. Nothing on the live site. |
| Ready | OFF | PR auto-merges into `main`. Post sits in the repo on `main` but **stays hidden** on the live site. |
| Ready | ON | PR auto-merges into `main`. Post goes live on the next deploy (~1 min). |
| Ready | OFF + Publish Date set | PR auto-merges into `main`. Post stays hidden until the daily 14:00 UTC cron flips Published=ON when the date arrives. Hands-off scheduled publishing. |

#### Editing on a preview branch (e.g. PR #48 = `restore-decap-cms`)

When you edit a post via the **preview admin** at
`preview-pr<N>.adamdaniel.ai/admin/`, the deploy-preview workflow has
patched `backend.branch` to point at that PR's head ref (e.g.
`restore-decap-cms`). So Decap creates `cms/<collection>/<slug>` off
`restore-decap-cms` and PRs into `restore-decap-cms` — **not** `main`.

| Status | Published | Result |
|---|---|---|
| Draft / In Review | OFF or ON | PR open against the preview branch. Visible only on `preview-pr<N>`. |
| Ready | OFF or ON | PR auto-merges into the preview branch. The change shows up on `preview-pr<N>.adamdaniel.ai` once the preview redeploys (~1 min). **Does not affect production.** |

Important: **content edits made on a preview branch are not meant to
flow to production.** They exist to demonstrate / test the preview's
changes against real content. When the preview branch itself
eventually merges into `main`, drop those content edits from the
merge — keep only the structural / code changes the preview was
opened for. The admin's commit pill in the top-right shows the
current backend branch when it's not `main`, so you can spot at a
glance that you're editing on a preview.

### What Save actually does

1. **A pull request is opened** on its own branch — your changes are *not*
   pushed straight to production.
2. The PR is automatically labelled `cms/draft`.
3. A **preview environment** is built at
   `https://preview-pr<N>.adamdaniel.ai/` (the bot posts the URL as a
   PR comment within ~30 seconds). This is the full site, with your
   changes, on a real CloudFront distribution.
4. **Content-only PRs skip the visual-regression video.** When the
   diff only touches `_posts/`, `_tags/`, `_projects/`, `pages/`,
   `_e2e/`, or media uploads (`assets/images/uploads/`), the
   regression workflow does not run — the pixel diff is the *intent*
   of your edit, not a regression to flag, so the video would be pure
   noise. PRs that touch a layout, template, stylesheet, or the admin
   shell still trigger the regression video and the
   `/admin/reviews/` dashboard review.
5. Once you (or another reviewer) change the label from `cms/draft` to
   `cms/ready`, auto-merge enables. As soon as all checks pass, the PR
   merges and the production deploy fires.

In the meantime, you can keep editing. Each Save updates the same PR.

## 6. Other content types

### Tags collection

Optional — only create a `_tags/<slug>.md` entry when you want to add a
description that shows on the tag's archive page. Posts can reference
any tag string; the site auto-generates archive pages for all of them.

Fields: **Name** (the human label, e.g. "Machine Learning"),
**Description** (one or two sentences, shown on `/tags/<slug>/`).

### Projects collection

For portfolio cards on `/projects/`. Fields:

- **Title** — project name.
- **Technology / Stack** — short string, e.g. `Python · LangChain · FastAPI`.
- **Project URL** — live demo or GitHub repo.
- **Featured** — toggle on to also surface the project on the homepage.
- **Images** — gallery of screenshots/demo shots (uses the same
  date-bucketed media folder as posts).
- **Description** — Markdown, full project write-up.

Same Save-to-PR flow as posts.

### Pages collection

For one-off static pages outside the blog/projects flow. Click
**Pages → New Page** to create one. Fields:

- **Title** — the heading and browser tab title.
- **Permalink** — the URL the page lives at. Defaults to `/pages/`,
  which you finish (e.g. `/pages/about/`). Must start and end with
  a slash. **Don't change this on an existing page** — that breaks
  inbound links.
- **Published** — same gate as posts; OFF means the page is a draft.
- **Content** — the page body in Markdown.

About Me and Contact already exist as page entries — open either to
edit. Same Save-to-PR flow as posts.

> **Historical note:** Pages used to be a fixed-list (`files:`)
> collection in the CMS — only the two pre-existing files were
> editable, and there was no way to add or remove pages from the UI.
> This is now a folder collection, so you have full create / edit /
> delete control.

## 7. Media library

All uploads land directly in `assets/images/uploads/` (one flat folder).
Browsing or re-using a previously uploaded image:

- Click any image field → **Choose Image** → search the library by
  filename, or use the standalone **Media** library to browse and
  **Copy Path**.
- Every image's public URL is `/assets/images/uploads/<filename>` —
  byte-identical to where the file is committed. That's why **Copy
  Path** gives a working URL and images never render broken. (The path
  is deliberately flat and template-free: a date-bucketed
  `media_folder` desyncs the on-disk path from the URL Decap writes
  into content and breaks **Copy Path** in the standalone Media
  library, which has no post date to expand a `{{year}}` template
  against.)

## 8. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| "Login with GitHub" loops back to the login screen | Browser blocked third-party cookies for the OAuth proxy | Allow cookies for `*.execute-api.us-east-1.amazonaws.com`, or use a different browser |
| `+ Create` button missing on a folder collection | Either you're not signed in (Decap hides write affordances when there's no GitHub token), or someone removed `create: true` / `delete: true` from `admin/config.yml` | Sign out and back in; verify the config has both flags explicitly set |
| Saved a post but it's not on the live site | **Published** toggle is OFF (draft), or the PR hasn't been approved yet (editorial workflow) | Either flip Published to ON, or finish the review flow: change the PR label from `cms/draft` to `cms/ready` and approve the visual regression in the dashboard |
| Scheduled post never went live | **Published** is ON (so the date is ignored), or the publish date is in the future, or the daily cron hasn't run yet (runs at 14:00 UTC = 9–10am ET) | Confirm Published is OFF and the timestamp is in the past UTC |
| `/preview/` tab isn't updating | The two tabs aren't on the same origin | Open the preview from `https://adamdaniel.ai/preview/...` (or the same `preview-pr<N>` host you logged into the CMS on), not localhost or a different subdomain |
| Tag pill on a post doesn't link to a styled page | Either the tag is brand-new (auto-generated archive pages have an empty description) or there's a typo | Add a `_tags/<slug>.md` entry in the Tags collection if you want a description; otherwise the page works as-is |
| Reviews dashboard hangs on "Completing authorisation…" | Old version of `admin/reviews/index.html` that doesn't echo back the OAuth handshake | Hard-refresh the dashboard tab; the fix landed in commit `50779fd` |
| Editor opens a post but every field looks read-only / Delete is greyed out | Stale browser cache of an older Decap bundle, or an OAuth state mismatch (token returns no repo write access) | First, hard-refresh the admin tab (Cmd-Shift-R). If still broken, open <https://adamdaniel.ai/admin/index-test.html> — same CMS bundle against an in-browser test backend with no OAuth in the way. The status banner says **EDITABLE** if the renderer is healthy or **FIELDS DISABLED** if there's a bundle / theme regression. If the diagnostic says EDITABLE but the real admin still doesn't accept input, the issue is in the GitHub auth round-trip — sign out, clear cookies for the admin and the OAuth proxy domain, sign in again. |

### Always-available verification: `/admin/index-test.html`

`/admin/index-test.html` ships next to the real admin and uses Decap's
in-browser `test-repo` backend — no GitHub round-trip, no OAuth, no
network. It pre-seeds a sample post with the same edge-case
front-matter shape the real admin saves (empty-string slug, empty
publish_date, etc.), and a status banner at the top inspects every
widget on every render and reports **EDITABLE** or **FIELDS DISABLED**.

You can use it to quickly answer: "is the bundle / theme broken, or
is something specific to the GitHub-backend code path broken?". It
won't help you publish content — anything you save there lives only
in your tab's memory — but it tells you immediately whether the form
renderer is healthy.

### Local-only authoring (escape hatch)

If the live admin is unusable for any reason, you can edit and
publish from your laptop. The repo's `local_backend` mode bypasses
GitHub OAuth entirely and writes directly to your working tree:

```bash
# Terminal 1 — Jekyll dev server (so /admin/ has somewhere to load from)
bundle exec jekyll serve --livereload

# Terminal 2 — Decap proxy that turns Save into a real file write
npx decap-server
```

Open <http://localhost:4000/admin/index-local.html>, click **Login**
(no real auth — `local_backend: true` accepts any keystrokes), edit
freely. Each Save lands as a real `_posts/<slug>.md` (or
`_tags/<slug>.md`, etc.) on disk. When you're done:

```bash
git add _posts/ _tags/ _projects/ pages/  # whichever you touched
git commit -m "publish: <what you wrote>"
git push origin main                      # the deploy workflow takes it from here
```

This skips the editorial-workflow PR + visual-regression review, so
use it only when the live admin is actively blocked. The `cms-smoke`
and `cms-publish-flow` Playwright specs exercise this exact flow on
every PR, so it's verified end-to-end.

## 9. What's happening behind the scenes

You don't need this to use the CMS, but for context:

- The CMS commits to a `cms/draft-…` branch, opens a PR, and labels it
  `cms/draft`.
- GitHub Actions builds a preview at `preview-pr<N>.adamdaniel.ai`. A
  visual-regression video is generated only for PRs that touch
  templates / layouts / styling / the admin shell — pure content edits
  skip it (the pixel diff is intentional, so the video adds no signal).
- Changing the label to `cms/ready` enables auto-merge.
- When required checks pass (`e2e` + the always-fire jobs), the PR
  squash-merges to `main` with the title `publish: <PR title>`. The
  `visual-regression / approve-regression` review only gates merge
  when the workflow actually fires (template/styling changes).
- The push to `main` triggers `deploy-production.yml`, which builds with
  Jekyll, syncs to S3, and invalidates CloudFront. Post is live within
  ~1–2 minutes of merge.

The only manual step in this entire pipeline (after you've written and
saved your content) is changing the label from `cms/draft` to
`cms/ready` and approving the visual regression in the Reviews
dashboard.
