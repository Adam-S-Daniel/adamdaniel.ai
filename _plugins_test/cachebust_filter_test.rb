# frozen_string_literal: true

#
# Unit tests for _plugins/cachebust_filter.rb. Run with:
#
#   bundle exec ruby _plugins_test/cachebust_filter_test.rb
#
# Mirrors the plain-Ruby pattern in normalize_empty_slug_test.rb so we
# don't drag minitest into the site Gemfile.

require 'tmpdir'
require 'fileutils'
require 'digest'

# Stub Liquid::Template.register_filter so loading the plugin file outside
# Jekyll doesn't blow up.
module Liquid
  class Template
    def self.register_filter(_); end
  end
end

require_relative '../_plugins/cachebust_filter'

# Minimal stand-in for a Jekyll::Site — the filter only reads `.config`
# (a Hash) and `.source` (a path).
FakeSite = Struct.new(:source, :config)

# Minimal stand-in for the Liquid context the filter looks at via
# `@context.registers[:site]`.
class FakeContext
  attr_reader :registers

  def initialize(site)
    @registers = { site: site }
  end
end

@failures = []

def check(condition, message)
  @failures << message unless condition
end

def run(label)
  yield
rescue StandardError => e
  @failures << "#{label}: raised #{e.class}: #{e.message}"
end

# Build a filter instance with a fake context bound to a temp source dir.
def build_filter(source:, baseurl: '')
  site = FakeSite.new(source, { 'baseurl' => baseurl })
  ctx  = FakeContext.new(site)
  klass = Class.new { include Jekyll::CachebustFilter }
  inst  = klass.new
  inst.instance_variable_set(:@context, ctx)
  inst
end

Dir.mktmpdir('cachebust-test') do |root|
  css_dir = File.join(root, 'assets', 'css')
  FileUtils.mkdir_p(css_dir)
  css_path = File.join(css_dir, 'main.css')
  File.write(css_path, 'body { color: red; }')

  filter = build_filter(source: root)

  # ── Stable: same bytes → same hash on repeated calls ────────────────
  run('stable: identical bytes yield identical hashes') do
    a = filter.cachebust('/assets/css/main.css')
    b = filter.cachebust('/assets/css/main.css')
    check(a == b, "expected stable, got #{a.inspect} vs #{b.inspect}")
    check(a =~ %r{^/assets/css/main\.css\?v=[0-9a-f]{8}$},
          "expected /assets/css/main.css?v=<8 hex>, got #{a.inspect}",)
  end

  # ── Mutating: byte change → hash changes ────────────────────────────
  run('mutating: edited bytes yield different hash') do
    before = filter.cachebust('/assets/css/main.css')
    File.write(css_path, 'body { color: blue; }')
    after = filter.cachebust('/assets/css/main.css')
    check(before != after,
          "expected hash to change after edit, got #{before.inspect} both times",)
  end

  # ── Edge: missing file → bare path, no `?v=` ───────────────────────
  # The implementation explicitly degrades to the URL with no query when
  # `File.file?` returns false — locks that contract in.
  run('missing file: returns bare path, no query string') do
    out = filter.cachebust('/assets/css/does-not-exist.css')
    check(out == '/assets/css/does-not-exist.css',
          "expected '/assets/css/does-not-exist.css', got #{out.inspect}",)
  end

  # ── Edge: nil / empty input passes through ─────────────────────────
  run('nil input: passed through') do
    check(filter.cachebust(nil).nil?,
          'expected nil for nil input',)
  end

  run('empty input: passed through') do
    check(filter.cachebust('') == '',
          'expected empty string for empty input',)
  end

  # ── Edge: respects configured baseurl ──────────────────────────────
  run('baseurl: stripped before resolving against source tree') do
    f = build_filter(source: root, baseurl: '/site')
    out = f.cachebust('/site/assets/css/main.css')
    check(out =~ %r{^/site/assets/css/main\.css\?v=[0-9a-f]{8}$},
          "expected baseurl-prefixed URL with hash, got #{out.inspect}",)
  end
end

if @failures.empty?
  puts 'cachebust_filter: all 6 checks passed'
else
  warn "cachebust_filter: #{@failures.length} failure(s)"
  @failures.each { |m| warn "  - #{m}" }
  exit 1
end
