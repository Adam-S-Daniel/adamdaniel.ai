# adamdaniel.ai

Personal website and blog for Adam Daniel — Freelance AI Engineer.

Built with Jekyll + Sveltia CMS, deployed to GitHub Pages with an AWS Lambda OAuth proxy.

## Architecture

```
adamdaniel.ai
├── Jekyll site          (GitHub Pages, custom domain)
├── Sveltia CMS          (/admin/ — headless CMS backed by this repo)
├── AWS OAuth Proxy      (Lambda + API Gateway HTTP API — ~$0/month)
└── GitHub Actions       (production deploy + PR preview environments)
```

## Content Model

| Collection | Type | Key Fields |
|---|---|---|
| **Posts** | Entry (folder: `_posts/`) | title, body, date, tags, excerpt, featured_image, published, reading_time* |
| **Tags** | Entry (folder: `_tags/`) | name, description |
| **Projects** | Entry (folder: `_projects/`) | title, description, images, url, technology, featured |
| **Pages** | File (About Me, Contact) | title, body |

*reading_time is auto-calculated at build time from word count (÷200 wpm + 1).

## CMS Setup (`/admin/`)

Sveltia CMS is configured at `/admin/config.yml`. To activate:

1. **Create a GitHub OAuth App** at https://github.com/settings/developers
   - Homepage URL: `https://adamdaniel.ai`
   - Callback URL: *(set after deploying the OAuth proxy — see below)*

2. **Deploy the OAuth proxy** (see `oauth-proxy/README.md`)
   ```bash
   cd oauth-proxy
   export GITHUB_CLIENT_ID=your_id
   export GITHUB_CLIENT_SECRET=your_secret
   bash deploy.sh
   ```

3. **Update `admin/config.yml`** with the deployed API URL:
   ```yaml
   backend:
     name: github
     repo: Adam-S-Daniel/adamdaniel.ai
     branch: main
     base_url: https://YOUR_API_ID.execute-api.us-east-1.amazonaws.com
     auth_endpoint: prod/auth
   ```

4. **Enable editorial workflow** (optional) by uncommenting in `admin/config.yml`:
   ```yaml
   publish_mode: editorial_workflow
   ```
   This creates PR branches for drafts and enables the draft→review→ready pipeline.

## OAuth Proxy (AWS Lambda)

Located in `oauth-proxy/`. Implements the GitHub OAuth handshake required by
Sveltia/Decap/Netlify CMS. Uses:

- **AWS Lambda** (Python 3.12, 128 MB) — free tier: 1M requests/month
- **API Gateway HTTP API** — cheapest API Gateway type, $1/M requests
- **No database, no VPC, no NAT** — pure function

**Estimated monthly cost: $0.00** for a personal blog (well within free tier).

Tests: `cd oauth-proxy && python -m pytest test_lambda.py -v`

## GitHub Actions

| Workflow | Trigger | What it does |
|---|---|---|
| `deploy-production.yml` | Push to `main` | Builds Jekyll, deploys to GitHub Pages |
| `deploy-preview.yml` | PR open/update | Builds Jekyll, deploys to S3 preview bucket, posts URL comment |
| `cms-editorial-workflow.yml` | PR from CMS | Validates front matter, applies `cms/draft` label; auto-merges on `cms/ready` |

### Preview Environments

PR previews are deployed to S3:
- Bucket: `adamdaniel-ai-previews`
- URL pattern: `http://adamdaniel-ai-previews.s3-website-us-east-1.amazonaws.com/pr-{N}/`
- Teardown: auto-deleted when the PR is closed/merged

Required secrets: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`

## Local Development

```bash
# Install dependencies
gem install jekyll jekyll-seo-tag jekyll-feed jekyll-sitemap webrick

# Build and serve
jekyll serve --livereload

# Site: http://localhost:4000
# CMS admin: http://localhost:4000/admin/
```

## Branching Strategy

```
main                    ← production (deploys automatically)
  └─ cms/draft-*        ← created by Sveltia CMS editorial workflow
      └─ PR opened      ← preview URL deployed, content validated
          └─ cms/ready  ← auto-merged to main, preview cleaned up
```
