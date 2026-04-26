# adamdaniel.ai

Personal website and blog for Adam Daniel — Freelance AI Engineer.

Built with Jekyll + Sveltia CMS, deployed to S3 + CloudFront with an AWS Lambda OAuth proxy.

## Architecture

```
adamdaniel.ai
├── Jekyll site          (S3 + CloudFront, custom domain)
├── Sveltia CMS          (/admin/ — headless CMS backed by this repo)
├── AWS OAuth Proxy      (Lambda + API Gateway HTTP API — ~$0/month)
└── GitHub Actions       (production deploy + PR preview environments)
```

## AWS Bootstrap (One-Time Setup)

Before GitHub Actions can deploy previews or infrastructure, bootstrap the AWS
account with an OIDC identity provider, IAM role, and artifacts bucket.

**Prerequisites:** AWS CLI v2 with credentials configured, Route53 hosted zone
for `adamdaniel.ai`.

```bash
# Deploy the bootstrap CloudFormation stack
bash infrastructure/bootstrap/deploy.sh

# If a GitHub OIDC provider already exists in this account:
CREATE_OIDC_PROVIDER=false bash infrastructure/bootstrap/deploy.sh
```

Then add the stack outputs as GitHub Actions secrets (repo → Settings → Secrets → Actions):
- `AWS_ROLE_ARN` — the IAM role ARN for OIDC auth
- `PREVIEW_CLOUDFRONT_ID` — the CloudFront distribution ID for preview cache invalidation

After verifying OIDC works, remove the old `AWS_ACCESS_KEY_ID` and
`AWS_SECRET_ACCESS_KEY` secrets and deactivate the IAM user keys.

See `infrastructure/bootstrap/template.yaml` for full details on what is
provisioned.

## Content Model

| Collection | Type | Key Fields |
|---|---|---|
| **Posts** | Entry (folder: `_posts/`) | title, body, date, tags, excerpt, featured_image, published, publish_date |
| **Tags** | Entry (folder: `_tags/`) | name, description |
| **Projects** | Entry (folder: `_projects/`) | title, description, images, url_link, technology, featured |
| **Pages** | Entry (folder: `pages/`) | title, body, permalink, published |

`reading_time` is computed at build time from word count (÷200 wpm + 1) — there's no editor-facing field for it.

**Editor's guide:** see [`docs/CONTENT_GUIDE.md`](docs/CONTENT_GUIDE.md) for a walkthrough of the CMS UI (sign-in, all four collections, image uploads, scheduling, previews, and the Save → PR → review → publish pipeline).

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

4. **Editorial workflow is on by default** (`publish_mode: editorial_workflow` in `admin/config.yml`). Every Save in the CMS opens a PR on its own branch instead of committing straight to main, lighting up the `cms/draft` → `cms/ready` labels, the per-PR `preview-pr{N}.adamdaniel.ai` environment, and the visual-regression review at `/admin/reviews/`.

> **Sveltia config gotcha:** every folder collection needs **explicit** `create: true` AND `delete: true`. The Decap docs imply `delete` defaults to `true` when `create: true`, but Sveltia's UI hides the affordance when the flag isn't set. Set both flags on every folder collection. `files:` collections (a fixed list of named entries) never expose create or delete in Sveltia regardless of flags — convert to a folder collection if editors need to add or remove entries.

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
| `deploy-production.yml` | Push to `main` | Builds Jekyll, syncs to S3, invalidates CloudFront |
| `deploy-preview.yml` | PR open/update | Builds Jekyll, syncs to preview S3 prefix, posts URL comment |
| `cms-editorial-workflow.yml` | PR from CMS | Validates front matter, applies `cms/draft` label; auto-merges on `cms/ready` |
| `visual-regression.yml` | PR open/update | Screenshots every page on the PR vs prod, computes the per-page pixel diff (`screenshots/regression/diffs.json`), generates a 1920×1080 side-by-side video with a prominent VISUALLY DIFFERENT / IDENTICAL / NEW indicator per page, posts both stats to the PR, and gates merge on a human review at `/admin/reviews/`. **The `Waiting` state on the `approve-regression` job is GitHub Environment gating** — the job declares `environment: regression-review` and the environment has required reviewers configured in repo Settings → Environments. Time spent waiting for that approval **does not count toward Actions minutes** — no runner is allocated while the job is queued for review. |
| `e2e-tests.yml` | PR + push to main | Runs Playwright. On PRs, `e2e/select-specs.js` picks only the specs the diff can affect (full matrix on push to main). |

### Preview Environments

PR previews are deployed to S3 and served via CloudFront with HTTPS:
- URL pattern: `https://preview-pr{N}.adamdaniel.ai/` (paths identical to prod)
- Bucket: `adamdaniel-ai-previews` (one prefix per PR: `/pr-{N}/`)
- CDN: single CloudFront distribution with wildcard ACM cert
- Host-to-prefix mapping: a viewer-request CloudFront Function prepends `/pr-{N}` on every request; a viewer-response Function strips the same prefix from `Location` headers so S3's trailing-slash redirects (`/admin` → `/admin/`) don't leak the internal key space
- Teardown: auto-deleted when the PR is closed/merged

Required secrets:
- `AWS_ROLE_ARN` (see [AWS Bootstrap](#aws-bootstrap-one-time-setup))
- `PREVIEW_CLOUDFRONT_ID` — CloudFront distribution ID (output from bootstrap stack)

## Local Development

```bash
# Install dependencies
gem install jekyll jekyll-seo-tag jekyll-feed jekyll-sitemap webrick
npm ci

# Build and serve
jekyll serve --livereload

# Site:        http://localhost:4000
# CMS admin:   http://localhost:4000/admin/index-local.html  (uses config-local.yml)

# Run e2e tests (full matrix)
npx playwright test

# Run only the specs that the current diff can affect
node e2e/select-specs.js | jq -r '.files[]?' | xargs npx playwright test
```

## Branching Strategy

```
main                    ← production (deploys automatically)
  └─ cms/draft-*        ← created by Sveltia CMS editorial workflow
      └─ PR opened      ← preview URL deployed, content validated
          └─ cms/ready  ← auto-merged to main, preview cleaned up
```
