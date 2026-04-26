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

The left sidebar shows everything you can edit:

| Collection | What it holds | When to use it |
|---|---|---|
| **Posts** | Blog articles in `_posts/` | Anything dated; goes on `/blog/` |
| **Tags** | Tag descriptions in `_tags/` | Optional — only needed if you want a description on a tag's archive page |
| **Projects** | Portfolio entries in `_projects/` | Featured work shown on `/projects/` |
| **Pages** | Two fixed files: *About Me* and *Contact* | Editing the static pages |

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
- **Featured Image** — uploaded into a date-bucketed folder
  (`assets/images/uploads/<year>/<month>/`). Used as the post hero and
  the social-share thumbnail.

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

Hit **Save**. The editorial workflow is enabled, so:

1. **A pull request is opened** on its own branch — your changes are *not*
   pushed straight to production.
2. The PR is automatically labelled `cms/draft`.
3. A **preview environment** is built at
   `https://preview-pr<N>.adamdaniel.ai/` (the bot posts the URL as a
   PR comment within ~30 seconds). This is the full site, with your
   changes, on a real CloudFront distribution.
4. A **visual-regression video** is generated, showing every changed
   page side-by-side with production. The video is posted as another PR
   comment.
5. Open the **Reviews dashboard** at
   <https://adamdaniel.ai/admin/reviews/> to watch the regression video
   inline and approve or request changes — same GitHub login, no need to
   visit the PR on GitHub.
6. Once you (or another reviewer) change the label from `cms/draft` to
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

The About Me and Contact pages are file entries — you edit them in
place rather than creating new ones. Just edit **Content** (Markdown)
and Save. Title and permalink are fixed and hidden from the form.

## 7. Media library

All uploads land in `assets/images/uploads/<year>/<month>/` so the picker
stays browsable as the archive grows. Browsing or re-using a previously
uploaded image:

- Click any image field → **Choose Image** → search the library, or
  navigate by year/month folder.
- Public URLs always start at `/assets/images/uploads/...` regardless of
  which subdirectory the file actually lives in — Jekyll serves them all
  from the same root.

## 8. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| "Login with GitHub" loops back to the login screen | Browser blocked third-party cookies for the OAuth proxy | Allow cookies for `*.execute-api.us-east-1.amazonaws.com`, or use a different browser |
| Saved a post but it's not on the live site | **Published** toggle is OFF (draft) | Open the post, flip Published to ON, Save again |
| Scheduled post never went live | **Published** is ON (so the date is ignored), or the publish date is in the future, or the hourly cron hasn't run yet | Confirm Published is OFF and the timestamp is in the past UTC |
| `/preview/` tab isn't updating | The two tabs aren't on the same origin | Open the preview from `https://adamdaniel.ai/preview/...` (or the same `preview-pr<N>` host you logged into the CMS on), not localhost or a different subdomain |
| Tag pill on a post doesn't link to a styled page | Either the tag is brand-new (auto-generated archive pages have an empty description) or there's a typo | Add a `_tags/<slug>.md` entry in the Tags collection if you want a description; otherwise the page works as-is |

## 9. What's happening behind the scenes

You don't need this to use the CMS, but for context:

- The CMS commits to a `cms/draft-…` branch, opens a PR, and labels it
  `cms/draft`.
- GitHub Actions builds a preview at `preview-pr<N>.adamdaniel.ai` and
  generates a visual-regression video.
- Changing the label to `cms/ready` enables auto-merge.
- When required checks pass (`e2e`, `visual-regression / approve-regression`),
  the PR squash-merges to `main` with the title `publish: <PR title>`.
- The push to `main` triggers `deploy-production.yml`, which builds with
  Jekyll, syncs to S3, and invalidates CloudFront. Post is live within
  ~1–2 minutes of merge.

The only manual step in this entire pipeline (after you've written and
saved your content) is changing the label from `cms/draft` to
`cms/ready` and approving the visual regression in the Reviews
dashboard.
