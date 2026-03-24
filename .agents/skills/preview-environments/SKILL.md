---
name: preview-environments
description: Work with PR preview environments for adamdaniel.ai. Use when checking preview status, debugging failed deployments, understanding the S3/CloudFront pipeline, fixing the preview bot comment, investigating cache issues, or explaining how previews are deployed and torn down.
compatibility: Requires AWS CLI v2 and gh CLI for debugging tasks.
---

# Preview Environments

Each PR gets a preview at `https://preview.adamdaniel.ai/pr-{N}/`.

## Architecture

```
PR push
  → deploy-preview.yml
  → Jekyll build (--baseurl /pr-{N})
  → aws s3 sync → s3://adamdaniel-ai-previews/pr-{N}/
  → CloudFront invalidation /pr-{N}/*
  → Bot comment updated: https://preview.adamdaniel.ai/pr-{N}/

PR close/merge
  → teardown-preview.yml
  → aws s3 rm s3://adamdaniel-ai-previews/pr-{N}/ --recursive
  → CloudFront invalidation /pr-{N}/*
  → Bot comment: "Preview environment cleaned up."
```

## Key resources

| Resource | Value |
|---|---|
| S3 bucket | `adamdaniel-ai-previews` (static website hosting, public read) |
| CloudFront ID | `E2OBHKV0LC6CJ2` |
| Preview domain | `preview.adamdaniel.ai` |
| AWS region | `us-east-1` |

## Workflow file: `.github/workflows/deploy-preview.yml`

**Triggers:** `pull_request` types `[opened, synchronize, reopened, closed]` targeting `main`

**Permissions:** `contents: read`, `pull-requests: write`, `id-token: write`

**Required secrets:**
- `AWS_ROLE_ARN` — OIDC role for AWS auth (no long-lived keys)
- `PREVIEW_CLOUDFRONT_ID` — CloudFront distribution ID (`E2OBHKV0LC6CJ2`)

If `PREVIEW_CLOUDFRONT_ID` is unset, the workflow gracefully falls back to the S3 website URL (HTTP only — won't work with Sveltia CMS).

## Jekyll baseurl

The build uses `--baseurl "/pr-{N}"` so all asset paths are prefixed. The site is built into `./_site_preview/` then synced to the S3 prefix `pr-{N}/`. This lets multiple PRs coexist in the same bucket.

## CloudFront cache behaviour

- Cache policy: `CachingDisabled` (4135ea2d-...) — previews always serve fresh content
- Invalidations run on every push and on teardown
- CloudFront origin: S3 website endpoint (`adamdaniel-ai-previews.s3-website-us-east-1.amazonaws.com`) via `http-only` custom origin

## Bot comment

The bot uses `<!-- adamdaniel-preview-bot -->` as a marker to find and update the existing comment rather than posting a new one each push. The comment renders a markdown table with preview URL, commit SHA, and branch name.

## Debugging

**Check workflow status for a PR:**
```bash
gh pr checks <pr-number> --repo Adam-S-Daniel/adamdaniel.ai
```

**Check what's in S3 for a PR:**
```bash
aws s3 ls s3://adamdaniel-ai-previews/pr-<N>/ --region us-east-1
```

**Manually invalidate CloudFront cache:**
```bash
aws cloudfront create-invalidation \
  --distribution-id E2OBHKV0LC6CJ2 \
  --paths "/pr-<N>/*"
```

**Check CloudFront distribution status:**
```bash
aws cloudfront get-distribution --id E2OBHKV0LC6CJ2 \
  --query 'Distribution.{Status: Status, Domain: DomainName}'
```

**Manually sync a build to S3:**
```bash
bundle exec jekyll build --baseurl "/pr-<N>" --destination ./_site_preview
aws s3 sync ./_site_preview s3://adamdaniel-ai-previews/pr-<N>/ \
  --delete --cache-control "no-cache, must-revalidate"
```

## Common issues

**Preview URL shows HTTP S3 link instead of HTTPS:**
The `PREVIEW_CLOUDFRONT_ID` secret was not set when the workflow ran. Add the secret and re-trigger (push an empty commit).

**Sveltia CMS won't load from the preview URL:**
Sveltia CMS requires HTTPS or localhost. The preview domain must be served via CloudFront (HTTPS). If the S3 fallback URL appears, check the secret is set.

**Preview loads but assets 404:**
Jekyll `--baseurl` mismatch. Ensure the baseurl matches the S3 prefix exactly: `/pr-{N}` (no trailing slash).

**Old preview content still showing:**
CloudFront cache not yet invalidated, or the invalidation is in progress. Wait ~30s or manually invalidate (see above).

**Teardown left orphaned S3 files:**
```bash
aws s3 rm s3://adamdaniel-ai-previews/pr-<N>/ --recursive --region us-east-1
```
