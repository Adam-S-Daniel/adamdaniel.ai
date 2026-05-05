# frozen_string_literal: true
#
# Workflow-shape lint: assert that the `finalize` job in
# `.github/workflows/e2e-tests.yml` and its presence in
# `.github/rulesets/main.json`'s required-status-checks together form
# the merge gate for shards 2-4 of the dynamic e2e matrix.
#
# Background:
#
#   The branch ruleset for `main` requires `e2e (1)` and `finalize`,
#   but NOT `e2e (2)`, `e2e (3)`, `e2e (4)`. The matrix is dynamically
#   sized via `pickShardCount()` in `e2e/select-specs.js`, so promoting
#   shards 2-4 to required would create the missing-check trap (small
#   subsets only spawn shard 1, and the missing 2-4 contexts would
#   block every small-subset PR forever).
#
#   `finalize` closes the gap. It runs `if: !cancelled()` and depends
#   on `[e2e]`, so it executes after the matrix completes regardless of
#   shard outcomes. The "Re-fail if any shard failed" step at the bottom
#   of `finalize` runs `exit 1` whenever `needs.e2e.result == 'failure'`,
#   which propagates ANY shard's failure into a `finalize` failure,
#   which — because `finalize` is required — blocks the merge.
#
#   This lint asserts every link in that chain so that a future "let me
#   simplify finalize" change can't silently weaken the gate.
#
# Run with:
#
#   bundle exec ruby _plugins_test/finalize_gate_test.rb
#
# The unit job in `.github/workflows/e2e-tests.yml` iterates every
# `_plugins_test/*_test.rb`, so this fires on every PR that triggers
# e2e — exactly when the lint matters.

require 'json'
require 'yaml'

REPO_ROOT = File.expand_path('..', __dir__)
WORKFLOW = File.join(REPO_ROOT, '.github/workflows/e2e-tests.yml')
RULESET = File.join(REPO_ROOT, '.github/rulesets/main.json')

@failures = []

def fail(msg)
  @failures << msg
end

# psych (Ruby's YAML) is YAML 1.1, which parses bare `on:` as the boolean
# true. We don't read `on:` here, but the same shape may apply to other
# truthy bare keys — read everything via String fetches to be safe.
yaml = YAML.safe_load(File.read(WORKFLOW), aliases: true)

jobs = yaml.fetch('jobs')
finalize = jobs['finalize'] or fail("e2e-tests.yml: missing `finalize` job")

if finalize
  # ─── job-level invariants ─────────────────────────────────────────
  unless finalize['if'].to_s.include?('!cancelled()')
    fail("finalize: top-level `if:` must contain `!cancelled()` " \
         "(otherwise GHA skips the job when any shard fails, and the " \
         "merge gate evaporates). Got: #{finalize['if'].inspect}")
  end

  needs = finalize['needs']
  unless [needs].flatten.compact.include?('e2e')
    fail("finalize: `needs:` must include `e2e` so the matrix's " \
         "result is observable via `needs.e2e.result`. Got: #{needs.inspect}")
  end

  # ─── failure-propagation step ─────────────────────────────────────
  steps = finalize.fetch('steps', [])
  fail_step = steps.find do |s|
    s['name'].to_s.start_with?('Re-fail if any shard failed') ||
      s['if'].to_s.include?("needs.e2e.result == 'failure'")
  end

  if fail_step.nil?
    fail("finalize: missing the 'Re-fail if any shard failed' step " \
         "(or any step gated on `needs.e2e.result == 'failure'`). " \
         "Without it, shards 2-4 failures don't propagate to finalize " \
         "and the merge gate is open for them.")
  else
    unless fail_step['if'].to_s.include?("needs.e2e.result == 'failure'")
      fail("finalize: the failure-propagation step must be gated on " \
           "`needs.e2e.result == 'failure'`. Got: #{fail_step['if'].inspect}")
    end

    run_body = fail_step['run'].to_s
    unless run_body.match?(/^\s*exit\s+[1-9]\d*\s*$/m)
      fail("finalize: the failure-propagation step's `run:` must " \
           "execute `exit <non-zero>` so the job fails. Got run body:\n" \
           "  #{run_body.lines.map(&:rstrip).join("\n  ")}")
    end
  end
end

# ─── ruleset invariant: finalize is required ─────────────────────────
ruleset = JSON.parse(File.read(RULESET))
required_checks_rule = ruleset.fetch('rules').find do |r|
  r['type'] == 'required_status_checks'
end

if required_checks_rule.nil?
  fail("rulesets/main.json: no `required_status_checks` rule found")
else
  contexts = required_checks_rule.dig('parameters', 'required_status_checks').to_a
                                  .map { |c| c['context'] }
  unless contexts.include?('finalize')
    fail("rulesets/main.json: required_status_checks must include " \
         "'finalize' — it's the gate for shards 2-4 of the e2e matrix. " \
         "Currently: #{contexts.inspect}")
  end
  unless contexts.include?('e2e (1)')
    fail("rulesets/main.json: required_status_checks must include " \
         "'e2e (1)' — shard 1 always exists per pickShardCount() and " \
         "is the explicit shard-1-required gate. Currently: #{contexts.inspect}")
  end
end

if @failures.empty?
  puts "[ok] finalize gate is intact (job shape + failure-propagation step + ruleset entry)"
else
  warn @failures.map { |m| "FAIL: #{m}" }.join("\n\n")
  warn ''
  warn "If you intentionally restructured the matrix-failure propagation " \
       "(e.g. moved it to a separate `gate:` job), update this lint in the " \
       "same PR and explain in the commit message."
  exit 1
end
