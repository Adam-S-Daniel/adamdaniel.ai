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

| File | Trigger | What it does |
|---|---|---|
| `deploy-production.yml` | push to main | Jekyll build → GitHub Pages |
| `deploy-preview.yml` | PR open/update/close | Jekyll build → S3 → CloudFront invalidation → PR comment |
| `cms-editorial-workflow.yml` | PR with content changes | Front matter validation, `cms/draft` label, auto-merge on `cms/ready` |

## Preview environment flow

1. PR opened → Jekyll builds with `--baseurl /pr-{N}` → sync to `s3://adamdaniel-ai-previews/pr-{N}/`
2. CloudFront cache invalidated at `/pr-{N}/*`
3. Bot posts `https://preview.adamdaniel.ai/pr-{N}/` as PR comment
4. PR closed → S3 files deleted, CloudFront invalidated, comment updated

## Skills

- `.agents/skills/aws-bootstrap/` — bootstrap stack deployment and troubleshooting
- `.agents/skills/preview-environments/` — preview pipeline, CloudFront, S3 debugging
