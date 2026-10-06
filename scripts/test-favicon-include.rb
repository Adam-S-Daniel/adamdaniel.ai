#!/usr/bin/env ruby
# frozen_string_literal: true

# Unit tests for _includes/favicon.html, which shadows the cms-platform theme's
# include. The theme's contract that `cms.favicon_url` is honored verbatim must
# survive the shadowing (the theme's include documents it as the way to swap the
# icon). No build, no network:
#
#   ruby scripts/test-favicon-include.rb
#
# Plain assertions, no test framework: the verifier runs this with a bare `ruby`,
# and minitest is a bundled gem a bare Ruby may not be able to load.

# Liquid ships with Jekyll, so it is a bundle gem, not a system one: plain `ruby`
# may not see it. Fall back to the repo's bundle when it is missing.
begin
  require "liquid"
rescue LoadError
  ENV["BUNDLE_GEMFILE"] ||= File.expand_path("../Gemfile", __dir__)
  require "bundler/setup"
  require "liquid"
end

SOURCE = File.read(File.expand_path("../_includes/favicon.html", __dir__), encoding: "UTF-8")

# Jekyll's relative_url with an empty baseurl is the identity on these paths.
module Filters
  def relative_url(input) = input
end

def render(cms)
  Liquid::Template.parse(SOURCE).render({ "site" => { "cms" => cms } }, filters: [Filters])
end

def icon_links(html)
  html.scan(/<link rel="icon"[^>]*>/)
end

$failures = []
def test(name)
  yield
  puts "  ok   #{name}"
rescue StandardError => e
  puts "  FAIL #{name}: #{e.message}"
  $failures << name
end

def expect(condition, message)
  raise message unless condition
end

test "default links favicon.ico and the SVG" do
  links = icon_links(render({}))
  expect(links.size == 2, links.inspect)
  expect(links.join.include?('href="/favicon.ico"'), links.inspect)
  expect(links.join.include?('href="/assets/favicon.svg"'), links.inspect)
end

test "default links the apple touch icon" do
  html = render({})
  expect(html.include?('<link rel="apple-touch-icon" href="/apple-touch-icon.png">'), html)
end

test "cms.favicon_url is honored verbatim as the only icon" do
  html = render({ "favicon_url" => "https://example.com/brand.png" })
  expect(icon_links(html) == ['<link rel="icon" href="https://example.com/brand.png">'], html)
  expect(!html.include?("/favicon.ico") && !html.include?("/assets/favicon.svg"), html)
end

test "cms.favicon_url still links the apple touch icon" do
  html = render({ "favicon_url" => "https://example.com/brand.png" })
  expect(html.include?('rel="apple-touch-icon"'), html)
end

puts "#{$failures.empty? ? 'All' : "#{$failures.size} FAILED of"} 4 favicon include tests#{$failures.empty? ? ' passed' : ''}."
exit($failures.empty? ? 0 : 1)
