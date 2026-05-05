# frozen_string_literal: true
#
# Workflow-shape lint: assert that the `paths:` allowlist in
# `.github/workflows/required-check-stubs.yml` exactly mirrors the
# `paths-ignore:` list in `.github/workflows/e2e-tests.yml`. If the
# two drift, doc-only PRs hit the missing-check trap (e2e-tests skips,
# stub doesn't fire) or — worse — emit ambiguous duplicated checks on
# PRs the stub matches but e2e-tests would have run anyway.
#
# Run with:
#
#   bundle exec ruby _plugins_test/required_check_stubs_paths_test.rb
#
# The unit job in `.github/workflows/e2e-tests.yml` iterates every
# `_plugins_test/*_test.rb`, so this fires on every PR that triggers
# e2e — exactly when the lint is meaningful.

require 'yaml'

WORKFLOWS_DIR = File.expand_path('../.github/workflows', __dir__)
E2E_TESTS = File.join(WORKFLOWS_DIR, 'e2e-tests.yml')
STUBS = File.join(WORKFLOWS_DIR, 'required-check-stubs.yml')

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

if @failures.empty?
  puts "[ok] required-check-stubs.yml paths mirror e2e-tests.yml paths-ignore"
else
  warn @failures.join("\n\n")
  exit 1
end
