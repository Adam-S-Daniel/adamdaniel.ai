#!/usr/bin/env ruby
# frozen_string_literal: true

# Unit tests for _includes/favicon.html, which shadows the cms-platform theme's
# include, and for the assets/favicon.svg it links. The theme's contract that
# `cms.favicon_url` is honored verbatim must survive the shadowing (the theme's
# include documents it as the way to swap the icon). No build, no network:
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

# assets/favicon.svg: the AD monogram, option #13 (near-black tile, cobalt glow,
# pale-blue letters outlined as a path). Parsed with REXML, never a regex scan.
require "rexml/document"
# Loaded lazily so a missing file fails the tests that need it instead of crashing the run.
def svg_root = (@svg_root ||= REXML::Document.new(File.read(File.expand_path("../assets/favicon.svg", __dir__), encoding: "UTF-8")).root)

def els(name) = REXML::XPath.match(svg_root, ".//*[local-name()='#{name}']")
def attrs(el, *names) = names.map { |n| el.attributes[n] }

test "favicon.svg is a 64x64 labeled icon" do
  expect(svg_root.attributes["viewBox"] == "0 0 64 64", svg_root.attributes["viewBox"].inspect)
  expect(svg_root.attributes["aria-label"] == "AD", svg_root.attributes["aria-label"].inspect)
end

test "favicon.svg letters are outlined paths, not <text>" do
  expect(els("text").empty?, "found a <text> element: a tab has no Fira Code to draw it with")
  paths = els("path")
  expect(paths.size == 1 && paths[0].attributes["fill"] == "#d8e4ff", paths.map(&:to_s).inspect)
  expect(paths[0].attributes["d"].to_s.length > 100, "path data is missing or implausibly short")
  expect(paths[0].attributes["stroke"].nil?, "letters must be filled outlines, not strokes")
end

test "favicon.svg is a near-black rounded tile with a cobalt glow overlay" do
  rects = els("rect")
  expect(rects.size == 2, "expected the tile and the glow overlay, got #{rects.size} rects")
  tile, glow = rects
  expect(attrs(tile, "width", "height", "rx", "fill") == ["64", "64", "14", "#04060f"], tile.to_s)
  expect(attrs(glow, "width", "height", "rx", "fill") == ["64", "64", "14", "url(#glow)"], glow.to_s)
  grads = els("radialGradient")
  expect(grads.size == 1 && grads[0].attributes["id"] == "glow", grads.map(&:to_s).inspect)
  expect(attrs(grads[0], "cx", "cy", "r") == %w[50% 55% 60%], grads[0].to_s)
  stops = REXML::XPath.match(grads[0], "*[local-name()='stop']")
  got = stops.map { |s| attrs(s, "offset", "stop-color", "stop-opacity") }
  expect(got == [["0", "#285aff", "0.55"], ["1", "#285aff", "0"]], got.inspect)
end

test "favicon.svg letters sit upright on the y=43 baseline" do
  d = els("path")[0].attributes["d"]
  # The first subpath is the A's outer outline (straight segments only). Upright, its apex
  # (top row) is narrower than its feet (bottom row); an upside-down A is the reverse.
  a = d.split(/(?=M)/).first.scan(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/).map { |x, y| [x.to_f, y.to_f] }
  ys = a.map(&:last)
  expect(ys.max.round(2) == 43.0, "baseline: lowest point is #{ys.max}, expected 43")
  expect(ys.min.between?(20.0, 24.0), "cap height: top of the A is at #{ys.min}")
  span = ->(y) { xs = a.select { |_, v| v == y }.map(&:first); xs.max - xs.min }
  expect(span.call(ys.min) < span.call(ys.max), "the A is upside down: apex is wider than its feet")
end

puts "#{$failures.empty? ? 'All' : "#{$failures.size} FAILED of"} 8 favicon tests#{$failures.empty? ? ' passed' : ''}."
exit($failures.empty? ? 0 : 1)
