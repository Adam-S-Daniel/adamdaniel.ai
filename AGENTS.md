# adamdaniel.ai — Project Guide

Personal website and blog for Adam Daniel (Freelance AI Engineer). Jekyll static site with Sveltia CMS, AWS OAuth proxy, and PR preview environments.

## Architecture

```
Production:   adamdaniel.ai           → GitHub Pages (Jekyll)
Preview:      preview.adamdaniel.ai   → CloudFront → S3
CMS:          adamdaniel.ai/admin/    → Sveltia CMS → GitHub OAuth → Lambda
```

## Key commands

```bash
# Local dev
jekyll serve --livereload          # http://localhost:4000
npx decap-server                   # CMS local backend (port 8081)

# AWS infrastructure
bash infrastructure/bootstrap/deploy.sh     # deploy/update bootstrap stack
bash oauth-proxy/deploy.sh                  # deploy OAuth proxy (needs env vars)

# Tests
cd oauth-proxy && python -m pytest test_lambda.py -v
```

## GitHub Actions secrets

| Secret | Source | Used by |
|---|---|---|
| `AWS_ROLE_ARN` | bootstrap stack output | deploy-preview.yml |
| `PREVIEW_CLOUDFRONT_ID` | bootstrap stack output | deploy-preview.yml |

No secrets needed for production deploy (GitHub Pages uses GITHUB_TOKEN).

## AWS resources (us-east-1)

| Resource | Name / ID |
|---|---|
| CloudFormation stack | `adamdaniel-ai-bootstrap` |
| S3 artifacts bucket | `adamdaniel-ai-cfn-artifacts` |
| S3 preview bucket | `adamdaniel-ai-previews` (external, not CFN-managed) |
| CloudFront distribution | `E2OBHKV0LC6CJ2` |
| Preview URL | `https://preview.adamdaniel.ai` |
| IAM role | `adamdaniel-ai-github-actions` |
| OAuth proxy stack | `adamdaniel-ai-oauth-proxy` |

## Content model

| Collection | Folder | Key fields |
|---|---|---|
| Posts | `_posts/` | title, date, tags, excerpt, featured_image, published, reading_time |
| Tags | `_tags/` | name, description |
| Projects | `_projects/` | title, technology, url_link, featured, images |
| Pages | `pages/` | about.md, contact.md |

`reading_time` is auto-calculated at build time (word count ÷ 200 + 1).

## Workflows

### `deploy-production.yml`

**Trigger:** push to `main`, or manual `workflow_dispatch`

**Jobs:** `build` → `deploy`

1. Checkout full git history (needed for Jekyll last-modified dates)
2. Calculate `reading_time` for every post (word count ÷ 200 + 1) → `_data/reading_times.yml`
3. `bundle exec jekyll build` with `JEKYLL_ENV=production`
4. Upload artifact → `actions/deploy-pages` → live at `adamdaniel.ai`

**Concurrency:** `group: pages`, `cancel-in-progress: false` — queued deploys wait, never interrupt a live deploy.

**Secrets needed:** none (uses built-in `GITHUB_TOKEN` for Pages).

---

### `deploy-preview.yml`

**Trigger:** `pull_request` types `[opened, synchronize, reopened, closed]` targeting `main`

**Secrets needed:** `AWS_ROLE_ARN`, `PREVIEW_CLOUDFRONT_ID`

#### Job: `deploy-preview` (when action ≠ `closed`)

1. Build Jekyll with `--baseurl "/pr-{N}"` → `./_site_preview/`
2. AWS OIDC auth via `AWS_ROLE_ARN`
3. `aws s3 sync` → `s3://adamdaniel-ai-previews/pr-{N}/` with `no-cache` headers
4. CloudFront invalidation at `/pr-{N}/*` (skipped if `PREVIEW_CLOUDFRONT_ID` not set)
5. Post/update PR comment using `<!-- adamdaniel-preview-bot -->` marker to avoid duplicates

URL shown in comment:
- With `PREVIEW_CLOUDFRONT_ID`: `https://preview.adamdaniel.ai/pr-{N}/`
- Without: `http://adamdaniel-ai-previews.s3-website-us-east-1.amazonaws.com/pr-{N}/` (HTTP fallback — Sveltia CMS won't work over this)

#### Job: `teardown-preview` (when action == `closed`)

1. AWS OIDC auth
2. `aws s3 rm s3://adamdaniel-ai-previews/pr-{N}/ --recursive`
3. CloudFront invalidation
4. Updates the existing `<!-- adamdaniel-preview-bot -->` comment to "cleaned up" (never creates a duplicate)

---

### `cms-editorial-workflow.yml`

**Trigger:** `pull_request` types `[opened, synchronize, labeled]` targeting `main`, only when files in `_posts/`, `_projects/`, `_tags/`, or `pages/` change.

**Secrets needed:** none (uses built-in `GITHUB_TOKEN`).

#### Job: `validate-content`

Runs on every open/update/label event:

1. Validates front matter: every `_posts/*.md` must have `title:` and `date:` fields
2. Full `bundle exec jekyll build` sanity check
3. On `opened`: creates `cms/draft` (dark blue) and `cms/ready` (green) labels if they don't exist, then applies `cms/draft` to the PR

#### Job: `auto-merge-when-ready`

Runs **only** when `cms/ready` label is added, and **only after `validate-content` passes** (`needs: validate-content`). Merges with squash, commit title: `publish: {PR title}`.

This ordering ensures broken content cannot merge to production even if `cms/ready` is applied.

#### CMS editorial flow

```
CMS creates PR (branch: cms/draft-{timestamp})
  → validate-content runs → adds cms/draft label
  → preview deployed at preview.adamdaniel.ai/pr-{N}/
  → editor reviews preview
  → editor (or admin) changes label: cms/draft → cms/ready
  → validate-content re-runs → if passes → auto-merge → deploy-production triggers
```

## Preview environment flow

1. PR opened → Jekyll builds with `--baseurl /pr-{N}` → sync to `s3://adamdaniel-ai-previews/pr-{N}/`
2. CloudFront cache invalidated at `/pr-{N}/*`
3. Bot posts `https://preview.adamdaniel.ai/pr-{N}/` as PR comment
4. PR closed → S3 files deleted, CloudFront invalidated, existing comment updated to "cleaned up"

## Skills

- `.agents/skills/aws-bootstrap/` — bootstrap stack deployment and troubleshooting
- `.agents/skills/preview-environments/` — preview pipeline, CloudFront, S3 debugging
