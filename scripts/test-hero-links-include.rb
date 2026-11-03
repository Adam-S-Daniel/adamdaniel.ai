#!/usr/bin/env ruby
# frozen_string_literal: true

# Unit tests for _includes/hero-links.html, the homepage hero's link rail picked
# in docs/design/links-playground.html (variant 1 "Divided rail", ord=blog,
# li=rule, rss=hero, ic=off): Blog, RSS, Mastodon, Substack, HN, a divider,
# then LinkedIn on its own. No build, no network:
#
#   ruby scripts/test-hero-links-include.rb
#
# Plain assertions, no test framework (same reason as test-favicon-include.rb).

begin
  require "liquid"
rescue LoadError
  ENV["BUNDLE_GEMFILE"] ||= File.expand_path("../Gemfile", __dir__)
  require "bundler/setup"
  require "liquid"
end
require "rexml/document"

SOURCE = File.read(File.expand_path("../_includes/hero-links.html", __dir__), encoding: "UTF-8")

module Filters
  def relative_url(input) = input
end

PROFILES = {
  "mastodon" => "https://hachyderm.io/@superoutrigger",
  "linkedin" => "https://www.linkedin.com/in/adam-s-daniel",
  "substack" => "https://adamdanielai.substack.com"
}.freeze

def render(profiles: PROFILES, hn: nil)
  site = { "cross_post" => { "profiles" => profiles }, "hero" => { "hacker_news_id" => hn } }
  Liquid::Template.parse(SOURCE).render({ "site" => site }, filters: [Filters])
end

def root(html) = REXML::Document.new("<r>#{html}</r>").root
def links(html) = REXML::XPath.match(root(html), ".//a")
def labels(html) = links(html).map { |a| a.text.to_s.strip }
def link(html, label) = links(html).find { |a| a.text.to_s.strip == label }

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

test "reading links come in playground order, LinkedIn last" do
  got = labels(render(hn: "someone"))
  expect(got == %w[Blog RSS Mastodon Substack HN LinkedIn], got.inspect)
end

test "hrefs come from the site config" do
  html = render(hn: "someone")
  want = {
    "Blog" => "/blog/", "RSS" => "/feed.xml",
    "Mastodon" => PROFILES["mastodon"], "Substack" => PROFILES["substack"],
    "HN" => "https://news.ycombinator.com/submitted?id=someone", "LinkedIn" => PROFILES["linkedin"]
  }
  want.each { |label, href| expect(link(html, label)&.attributes&.[]("href") == href, "#{label}: #{html}") }
end

test "HN is left out until hero.hacker_news_id is set" do
  expect(!labels(render(hn: nil)).include?("HN"), labels(render(hn: nil)).inspect)
  expect(!labels(render(hn: "")).include?("HN"), labels(render(hn: "")).inspect)
end

test "a missing profile drops its link" do
  got = labels(render(profiles: PROFILES.reject { |k, _| k == "substack" }))
  expect(got == %w[Blog RSS Mastodon LinkedIn], got.inspect)
end

test "LinkedIn sits after an aria-hidden divider, apart from the reading links" do
  r = root(render(hn: "someone"))
  groups = REXML::XPath.match(r, ".//*[contains(@class,'hero-links-group')]")
  expect(groups.size == 2, "expected 2 groups, got #{groups.size}")
  expect(REXML::XPath.match(groups[1], ".//a").map { |a| a.text.to_s.strip } == ["LinkedIn"], groups[1].to_s)
  rule = REXML::XPath.first(r, ".//*[contains(@class,'hero-links-rule')]")
  expect(rule && rule.attributes["aria-hidden"] == "true", rule.to_s)
  kids = REXML::XPath.match(r, "./*/*")
  expect(kids.index(rule) == 1, "divider must sit between the two groups")
end

test "external links open in a new tab with noopener noreferrer; site links do not" do
  html = render(hn: "someone")
  %w[Mastodon Substack HN LinkedIn].each do |l|
    a = link(html, l)
    expect(a.attributes["target"] == "_blank", "#{l}: #{a}")
    expect(a.attributes["rel"].to_s.split.include?("noopener") && a.attributes["rel"].to_s.split.include?("noreferrer"), "#{l}: #{a}")
  end
  %w[Blog RSS].each { |l| expect(link(html, l).attributes["target"].nil?, "#{l}: #{link(html, l)}") }
end

test "LinkedIn keeps its accessible name" do
  a = link(render, "LinkedIn")
  expect(a.attributes["aria-label"] == "Adam Daniel on LinkedIn", a.to_s)
end

puts "#{$failures.empty? ? 'All' : "#{$failures.size} FAILED of"} 7 hero-links tests#{$failures.empty? ? ' passed' : ''}."
exit($failures.empty? ? 0 : 1)
