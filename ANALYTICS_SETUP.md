# Analytics Setup (CloudWatch RUM)

This site uses [Amazon CloudWatch RUM](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch-RUM.html)
for real-user monitoring: Core Web Vitals (LCP, CLS, INP), JS errors, page-load
timings, and sessions. The integration is AWS-native, fits the existing
S3 + CloudFront + CloudFormation stack, and stores raw events in the same
AWS account as the rest of the infrastructure.

## What it costs

- **$1 per 100,000 RUM events** (us-east-1; small regional variation).
- AWS includes a one-time **1 million-event free trial** per account.
- At ~1K visits/month this is roughly **$0.10/month** — effectively free.

## Setup

### 1. Deploy the RUM CloudFormation stack

```bash
bash infrastructure/rum/deploy.sh
```

The script creates a Cognito identity pool, a guest IAM role scoped to
`rum:PutRumEvents`, and the RUM app monitor itself. It is idempotent — safe
to re-run.

The stack name is `adamdaniel-ai-rum`; deploy region defaults to `us-east-1`.

### 2. Copy stack outputs into `_config.yml`

The script prints the values you need. Paste them into `_config.yml` under
`analytics.cloudwatch_rum`:

```yaml
analytics:
  cloudwatch_rum:
    app_monitor_id: "<AppMonitorId from stack outputs>"
    identity_pool_id: "<IdentityPoolId from stack outputs>"
    region: "us-east-1"
```

Neither value is sensitive — they are visible in the rendered page source —
so no GitHub secret is required.

### 3. Deploy the site

Push to `main`. The production deploy workflow sets `JEKYLL_ENV=production`,
which is the gate that activates the snippet. Local `jekyll serve` and PR
previews remain silent regardless of the config values.

### 4. Verify

1. Load <https://adamdaniel.ai>.
2. Open the AWS console → CloudWatch → RUM → `adamdaniel-ai`. A page-view
   should appear within ~5 minutes; Web Vitals populate within 24 hours.
3. CloudWatch → Log groups → `/aws/vendedlogs/RUMAccessLogs/adamdaniel-ai`
   should also be receiving JSON event records.

## How the Liquid guard works

The include in `_includes/analytics/cloudwatch-rum.html` is a no-op unless
**both** conditions are true:

- `JEKYLL_ENV=production`
- `site.analytics.cloudwatch_rum.app_monitor_id` is non-empty

This means a contributor who only sets one (or neither) cannot accidentally
ship the snippet to a non-production environment.

## Retention and portability

CloudWatch RUM's own dashboard retains data for **30 days only**, then
auto-deletes. The CloudFormation template sets `CwLogEnabled: true`, which
mirrors every event to a CloudWatch Logs group:

```
/aws/vendedlogs/RUMAccessLogs/adamdaniel-ai
```

That log group is the long-term store. Default retention is "Never expire"
(adjust later via `AWS::Logs::LogGroup` resource if cost becomes a concern).

To take RUM data out of AWS later:

- **One-shot S3 export:** CloudWatch Logs → Actions → Export data to S3.
- **Streaming:** add a subscription filter that pushes events through
  Kinesis Firehose into S3 in near-real-time.

Once events land in S3, query them with Athena or any other tooling. The
RUM event format is documented JSON; no other product natively imports it,
so cross-product migration would require a transform.

## Tuning

- **Sampling.** `SessionSampleRate` is `1` (every session) by default. Lower
  it (e.g. `0.1` for 10%) by passing `--parameter-overrides
  SessionSampleRate=0.1` to `aws cloudformation deploy` if traffic grows
  enough that event cost matters.
- **Telemetries.** The template enables `performance`, `errors`, and `http`.
  Edit the `Telemetries` list in the template to add or drop categories.
- **Cookies.** `AllowCookies: false` keeps the integration cookie-less; do
  not enable cookies without reviewing the privacy implications.
