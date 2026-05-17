# frozen_string_literal: true
#
# Workflow-shape lint with two invariants:
#
#   1. The `paths:` allowlist in
#      `.github/workflows/required-check-stubs.yml` exactly mirrors the
#      `paths-ignore:` list in `.github/workflows/e2e-tests.yml`. If the
#      two drift, doc-only PRs hit the missing-check trap (e2e-tests
#      skips, stub doesn't fire) or — worse — emit ambiguous duplicated
#      checks on PRs the stub matches but e2e-tests would have run.
#
#   2. Every merge-gating context in `.github/rulesets/main.json` that
#      is produced by a path-filtered workflow has a matching stub job
#      in required-check-stubs.yml. Paths parity alone is insufficient:
#      `e2e-admin` was in the required list and the paths mirrored
#      perfectly, yet no `e2e-admin` stub existed, so docs-only PRs sat
#      blocked on `e2e-admin` forever. `validate-content` and `scan`
#      are exempt — cms-editorial-workflow.yml / secrets-scan.yml carry
#      no path filters by design, so they always report and the trap
#      can't reach them.
#
# Run with:
#
#   bundle exec ruby _plugins_test/required_check_stubs_paths_test.rb
#
# The unit job in `.github/workflows/e2e-tests.yml` iterates every
# `_plugins_test/*_test.rb`, so this fires on every PR that triggers
# e2e — exactly when the lint is meaningful.

require 'yaml'
require 'json'

WORKFLOWS_DIR = File.expand_path('../.github/workflows', __dir__)
E2E_TESTS = File.join(WORKFLOWS_DIR, 'e2e-tests.yml')
STUBS = File.join(WORKFLOWS_DIR, 'required-check-stubs.yml')
RULESET = File.expand_path('../.github/rulesets/main.json', __dir__)

# Required contexts produced by workflows that ALWAYS report regardless
# of the changed paths — so the missing-check trap can't reach them and
# they need no stub. Two reasons a context qualifies:
#   - validate-content / scan: their workflows carry no path filter.
#   - preview-media: preview-media.yml is the always-run + early-skip
#     pattern — fires on every PR with no `paths:`, detects media-
#     salient changes in an early step, reports success immediately
#     otherwise. The context is therefore always present.
# Keep this list tight and justified; anything not here is assumed
# path-filtered and MUST have a stub job.
ALWAYS_FIRE_CONTEXTS = %w[validate-content scan preview-media].freeze

# Ruby's standard YAML loader doesn't accept the `on:` short form
# without `permitted_classes`, but we're only reading scalars/arrays
# under `on.pull_request.paths{,-ignore}`. `safe_load` is fine.
e2e_yaml = YAML.safe_load(File.read(E2E_TESTS), aliases: true)
stubs_yaml = YAML.safe_load(File.read(STUBS), aliases: true)

# YAML parses `on:` as the boolean `true` (the YAML 1.1 booleans-trap).
# The actual key is the literal string "on" only on YAML 1.2-only loaders;
# Ruby's psych is YAML 1.1 by default, so we look up by `true`.
on_key = e2e_yaml.key?('on') ? 'on' : true
e2e_pr = e2e_yaml.fetch(on_key).fetch('pull_request')
stubs_pr = stubs_yaml.fetch(on_key).fetch('pull_request')

paths_ignore = e2e_pr.fetch('paths-ignore')
paths = stubs_pr.fetch('paths')

@failures = []

if paths_ignore != paths
  missing_in_stub = paths_ignore - paths
  extra_in_stub = paths - paths_ignore
  msg = +"e2e-tests.yml#paths-ignore and required-check-stubs.yml#paths drifted.\n"
  msg << "  In e2e-tests but missing from stubs: #{missing_in_stub.inspect}\n" unless missing_in_stub.empty?
  msg << "  In stubs but missing from e2e-tests: #{extra_in_stub.inspect}\n" unless extra_in_stub.empty?
  msg << "  Keep them byte-for-byte identical (in the same order) so doc-only PRs\n"
  msg << "  always satisfy the required-status-checks rule. See the comment block\n"
  msg << "  at the top of required-check-stubs.yml for the rationale."
  @failures << msg
end

# Invariant 2 — every path-filtered required context has a stub job.
ruleset = JSON.parse(File.read(RULESET))
rsc_rule = ruleset.fetch('rules').find { |r| r['type'] == 'required_status_checks' }
raise 'main.json: no required_status_checks rule found' unless rsc_rule

required_contexts = rsc_rule.fetch('parameters')
                            .fetch('required_status_checks')
                            .map { |c| c.fetch('context') }

# Contexts that need a stub = required, minus the always-fire ones.
# Map each to its stub job key: a matrix-derived context like
# `e2e (1)` is emitted by a job keyed `e2e`, so strip a trailing
# ` (<n>)` suffix; every other context's job key is identical.
need_stub = required_contexts - ALWAYS_FIRE_CONTEXTS
expected_job_keys = need_stub.map { |c| c.sub(/\s*\(\d+\)\z/, '') }.uniq
stub_job_keys = stubs_yaml.fetch('jobs').keys

missing_jobs = expected_job_keys - stub_job_keys
unless missing_jobs.empty?
  msg = +"required-check-stubs.yml is missing a stub job for required context(s).\n"
  msg << "  Required (rulesets/main.json) but no stub job: #{missing_jobs.inspect}\n"
  msg << "  required_status_checks: #{required_contexts.inspect}\n"
  msg << "  stub jobs present: #{stub_job_keys.inspect}\n"
  msg << "  Add a trivial stub job (key = context, sans any ` (n)` matrix\n"
  msg << "  suffix) to required-check-stubs.yml, or, if the context now\n"
  msg << "  comes from an always-firing workflow, add it to\n"
  msg << "  ALWAYS_FIRE_CONTEXTS with a justification. Without the stub,\n"
  msg << "  docs/tooling-only PRs block forever on that check."
  @failures << msg
end

if @failures.empty?
  puts "[ok] required-check-stubs.yml paths mirror e2e-tests.yml paths-ignore"
  puts "[ok] every path-filtered required context has a stub job"
else
  warn @failures.join("\n\n")
  exit 1
end
