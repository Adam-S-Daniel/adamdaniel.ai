#!/usr/bin/env ruby
# frozen_string_literal: true

# Post-build verifier for adamdaniel.ai: asserts properties of the BUILT
# `_site/` that this site promises and that a broken build, layout, plugin or
# platform bump could silently take away.
#
#   bundle exec jekyll build
#   ruby scripts/verify-build-artifacts.rb
#
# The required `site-verify / site-verify` check runs exactly this, through
# cms-platform's reusable `site-verify.yml`: it builds the site under
# JEKYLL_ENV=production and runs this file when it exists (issue #3970 — until
# this file existed the required check printed a notice and passed without
# building anything).
#
# Ground rules, so a CMS edit never turns this red for no reason:
#
# * Every expectation is DERIVED from the source tree (front matter, the
#   `_config.yml`, the admin seam) or from the build itself — never a
#   hardcoded post title, count or slug. Adding, editing, unpublishing or
#   deleting a post changes what is expected, not whether the check passes.
# * Pure Ruby stdlib (`yaml`, `rexml`, `date`): no network, no clock, no gem
#   beyond what Jekyll already needs. REXML ships with Ruby and is already in
#   Gemfile.lock through kramdown.
# * Structured formats go through a real parser: YAML for front matter and
#   the admin config, REXML for the Atom feeds and the sitemap. Built HTML is
#   scanned lexically (tag + attribute tokens) because Ruby's stdlib has no
#   HTML5 parser; nothing here reasons about HTML nesting beyond stripping
#   `<pre>`/`<code>` blocks before the Liquid-leak scan.
#
# Output: one `ok`/`FAIL` line per assertion, then a count. Exit 1 on any
# FAIL. `scripts/` is excluded from the Jekyll build, so this is never
# published.

require "yaml"
require "date"
require "rexml/document"

ROOT = File.expand_path("..", __dir__)
SITE = File.join(ROOT, "_site")

$failures = []
$checks = 0

def check(desc)
  $checks += 1
  ok = begin
    yield
  rescue StandardError => e
    desc = "#{desc} (raised #{e.class}: #{e.message.lines.first.to_s.strip})"
    false
  end
  puts(ok ? "  ok   #{desc}" : "  FAIL #{desc}")
  $failures << desc unless ok
  ok
end

def section(title)
  puts
  puts "== #{title} =="
end

# Pin reads to UTF-8 so the ambient locale (often unset/"C" in CI shells,
# which Ruby reads as US-ASCII) cannot break decoding on the first em dash.
def read(path)
  File.file?(path) ? File.read(path, encoding: "utf-8") : nil
end

def yaml_load(text)
  YAML.safe_load(text, permitted_classes: [Date, Time], aliases: true)
end

# Front matter of a Jekyll source file, parsed with the yaml stdlib.
# Returns {} when the file has none.
def front_matter(path)
  text = read(path).to_s
  match = text.match(/\A---\s*\n(.*?)\n---\s*(\n|\z)/m)
  return {} unless match

  data = yaml_load(match[1])
  data.is_a?(Hash) ? data : {}
end

def published?(data)
  data["published"] != false
end

# Jekyll's default-mode `Utils.slugify`, which `permalink: /blog/:slug/`
# applies to a post's slug: every run of characters that are not letters,
# marks or digits becomes one hyphen, leading/trailing hyphens are trimmed,
# and the result is downcased.
def slugify(text)
  text.to_s.gsub(/[^\p{M}\p{L}\p{Nd}]+/u, "-").gsub(/\A-|-\z/, "").downcase
end

DATE_PREFIX = /\A\d{4}-\d{2}-\d{2}-/

# The slug Jekyll serves a post at: an explicit non-blank `slug:` wins,
# otherwise the filename minus its date prefix (cms-platform's
# normalize_empty_slug hook turns a blank `slug:` into the same thing).
def post_slug(data, path)
  explicit = data["slug"]
  raw = explicit.is_a?(String) && !explicit.strip.empty? ? explicit.strip : nil
  raw ||= File.basename(path, File.extname(path)).sub(DATE_PREFIX, "")
  slugify(raw)
end

# Mirrors cms-platform's exclude_e2e_posts.rb: a post is a test fixture when
# it sets `test_fixture: true` or its slug starts with `e2e-`. The gem stamps
# those `sitemap: false` + `feed_exclude: true`, and every public listing
# filters on that.
def fixture_post?(data, slug)
  data["test_fixture"] == true || slug.start_with?("e2e-")
end

def ensure_trailing_slash(url_path)
  url_path.end_with?("/") ? url_path : "#{url_path}/"
end

def percent_decode(text)
  text.gsub(/%\h\h/) { |m| m[1..].hex.chr }.force_encoding("utf-8")
end

# Map a root-relative URL path to the file in `_site` that serves it, or nil.
# `/x/` serves `x/index.html`; `/x` serves the file `x`, or `x/index.html`.
def built_file(url_path)
  path = percent_decode(url_path.sub(/[?#].*\z/m, ""))
  return nil unless path.start_with?("/")

  local = File.join(SITE, path)
  index = File.join(local, "index.html")
  return index if path.end_with?("/") && File.file?(index)
  return local if File.file?(local)
  return index if File.file?(index)

  nil
end

# The URL path a built HTML file is served at (inverse of built_file).
def url_path_of(file)
  rel = file.delete_prefix(SITE)
  File.basename(rel) == "index.html" ? rel.delete_suffix("index.html") : rel
end

# Lexical tag scan: every start tag named `name`, as an attribute Hash.
def tags(html, name)
  html.to_s.scan(/<#{name}\b([^>]*)>/im).map do |(attrs)|
    pairs = attrs.scan(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/)
    pairs.to_h { |k, v1, v2| [k.downcase, v1 || v2] }
  end
end

def noindex?(html)
  tags(html, "meta").any? do |m|
    m["name"].to_s.downcase == "robots" && m["content"].to_s.include?("noindex")
  end
end

def element_names(list)
  list.is_a?(Array) ? list.map { |c| c.is_a?(Hash) ? c["name"] : nil }.compact : []
end

def parse_xml(path)
  text = read(path)
  return nil if text.nil?

  REXML::Document.new(text)
end

# --------------------------------------------------------------------------
config = yaml_load(read(File.join(ROOT, "_config.yml")).to_s) || {}
SITE_URL = "#{config['url']}#{config['baseurl']}".chomp("/")

section "the build exists"
unless check("_site/ exists (run `bundle exec jekyll build` first)") { File.directory?(SITE) }
  puts
  puts "1 assertion(s) FAILED — there is no _site/ to verify."
  exit 1
end
check("_config.yml has a site url to build canonical links from (#{SITE_URL.inspect})") do
  SITE_URL.start_with?("https://")
end
%w[index.html 404.html robots.txt feed.xml sitemap.xml].each do |name|
  check("_site/#{name} was built") { File.file?(File.join(SITE, name)) }
end

# Pages this site renders itself. `admin/` is gem-delivered Decap machinery
# and `assets/` holds vendored standalone apps (their own <head>); neither
# carries the site chrome these assertions are about.
site_pages = Dir.glob(File.join(SITE, "**", "*.html")).reject do |f|
  rel = f.delete_prefix("#{SITE}/")
  rel.start_with?("admin/", "assets/")
end.sort
check("the build rendered site pages to check (#{site_pages.size} found)") { site_pages.size >= 5 }

# --------------------------------------------------------------------------
section "every source page builds, and every unpublished one does not"
# Root pages, section index pages and pages/*.md — skipping anything Jekyll
# does not read (dot/underscore paths and `_config.yml`'s `exclude:` list)
# and files without front matter (which Jekyll copies, not renders).
excluded = Array(config["exclude"]).map { |e| e.to_s.chomp("/") }
page_sources = (Dir.glob(File.join(ROOT, "*.{html,md}")) +
                Dir.glob(File.join(ROOT, "*", "index.html")) +
                Dir.glob(File.join(ROOT, "pages", "*.md"))).reject do |f|
  rel = f.delete_prefix("#{ROOT}/")
  rel.start_with?("_", ".") ||
    excluded.any? { |e| File.fnmatch?(e, rel) || rel.start_with?("#{e}/") } ||
    !read(f).to_s.start_with?("---")
end.sort
check("found source pages with front matter to check (#{page_sources.size})") do
  page_sources.size >= 3
end
page_sources.each do |src|
  data = front_matter(src)
  rel = src.delete_prefix("#{ROOT}/")
  url = data["permalink"].to_s
  if url.empty?
    url = if rel.end_with?("index.html")
            "/#{rel.delete_suffix('index.html')}"
          else
            "/#{rel.sub(/\.md\z/, '.html')}"
          end
  end
  if published?(data)
    check("#{rel} is published and builds at #{url}") { !built_file(url).nil? }
  else
    check("#{rel} is `published: false` and is NOT built at #{url}") { built_file(url).nil? }
  end
end

# --------------------------------------------------------------------------
section "posts: published ones build, drafts do not, fixtures are classified"
posts = Dir.glob(File.join(ROOT, "_posts", "**", "*.{md,markdown,html}")).sort.map do |src|
  data = front_matter(src)
  slug = post_slug(data, src)
  permalink = data["permalink"].to_s
  url = permalink.empty? ? "/blog/#{slug}/" : ensure_trailing_slash(permalink)
  { src: src.delete_prefix("#{ROOT}/"), data: data, slug: slug, url: url,
    published: published?(data), fixture: fixture_post?(data, slug) }
end
public_posts = posts.select { |p| p[:published] && !p[:fixture] }
fixture_posts = posts.select { |p| p[:fixture] }
puts "  (#{posts.size} posts: #{public_posts.size} public, #{fixture_posts.size} test fixtures, " \
     "#{posts.count { |p| !p[:published] }} unpublished)"
check("_posts/ has public posts to check") { !public_posts.empty? }
posts.each do |post|
  if post[:published]
    check("#{post[:src]} is published and builds at #{post[:url]}") { !built_file(post[:url]).nil? }
  else
    check("#{post[:src]} is `published: false` and is NOT built at #{post[:url]}") do
      built_file(post[:url]).nil?
    end
  end
end

# --------------------------------------------------------------------------
section "navigation: every main-nav link leads to a built, indexable page"
home_html = read(File.join(SITE, "index.html")).to_s
nav_html = home_html[%r{<nav\b[^>]*aria-label="Main navigation"[^>]*>.*?</nav>}m]
check("home page has the main navigation") { !nav_html.nil? }
nav_links = tags(nav_html, "a").map { |a| a["href"].to_s }.reject(&:empty?)
check("main navigation has links (#{nav_links.size})") { !nav_links.empty? }
nav_links.each do |href|
  path = href.delete_prefix(SITE_URL)
  next unless path.start_with?("/")

  target = built_file(path)
  check("nav link #{href} resolves to a built page") { !target.nil? }
  check("nav link #{href} is not a noindex page") { target && !noindex?(read(target)) }
end

# --------------------------------------------------------------------------
section "SEO: every site page names its own canonical URL and Open Graph tags"
site_pages.each do |file|
  html = read(file)
  expected = "#{SITE_URL}#{url_path_of(file)}"
  canonicals = tags(html, "link").select { |l| l["rel"].to_s.downcase == "canonical" }
  og = tags(html, "meta").to_h { |m| [m["property"].to_s, m["content"].to_s] }
  rel = file.delete_prefix("#{SITE}/")
  check("#{rel}: exactly one canonical link, pointing at #{expected}") do
    canonicals.size == 1 && canonicals.first["href"] == expected
  end
  check("#{rel}: og:title is set and og:url matches the canonical URL") do
    !og["og:title"].to_s.strip.empty? && og["og:url"] == expected
  end
end

# --------------------------------------------------------------------------
section "internal links: every same-site href/src on a site page resolves"
link_refs = Hash.new { |h, k| h[k] = [] }
site_pages.each do |file|
  html = read(file)
  page = url_path_of(file)
  { "a" => "href", "link" => "href", "script" => "src", "img" => "src",
    "iframe" => "src", "source" => "src" }.each do |tag, attr|
    tags(html, tag).each do |t|
      ref = t[attr].to_s.strip
      next if ref.empty? || ref.start_with?("#", "//")

      ref = ref.delete_prefix(SITE_URL) if ref.start_with?("#{SITE_URL}/")
      next if ref.match?(/\A[a-z][a-z0-9+.-]*:/i) # external or mailto:/tel:/data:

      unless ref.start_with?("/")
        ref = File.join(page.end_with?("/") ? page : File.dirname(page), ref)
      end
      link_refs[ref.sub(/[?#].*\z/m, "")] << page
    end
  end
end
check("site pages carry internal links to check (#{link_refs.size} distinct targets)") do
  link_refs.size >= 5
end
link_refs.keys.sort.each do |ref|
  pages = link_refs[ref].uniq
  where = pages.first(3).join(", ")
  where += " and #{pages.size - 3} more" if pages.size > 3
  check("link target #{ref} exists in _site (linked from #{where})") { !built_file(ref).nil? }
end

# --------------------------------------------------------------------------
section "no unresolved Liquid in the built output"
# Only the OPENING delimiters: every unresolved Liquid tag or output has one,
# while a bare `}}` is ordinary in inline CSS/JS.
liquid = /\{\{|\{%/
site_pages.each do |file|
  # Strip <pre>/<code>/<textarea> first: a post may legitimately show Liquid
  # or `${{ }}` syntax inside a code sample.
  scrubbed = read(file).to_s.gsub(%r{<(pre|code|textarea)\b.*?</\1>}mi, "")
  hits = scrubbed.scan(/.{0,30}(?:\{\{|\{%).{0,30}/).first(2)
  found = hits.empty? ? "" : " (found #{hits.inspect})"
  check("#{file.delete_prefix("#{SITE}/")} has no unresolved Liquid tags#{found}") { hits.empty? }
end
%w[robots.txt sitemap.xml].each do |name|
  check("#{name} has no unresolved Liquid tags") do
    !read(File.join(SITE, name)).to_s.match?(liquid)
  end
end

# --------------------------------------------------------------------------
section "Atom feeds: parse, link to built posts, and carry no test fixtures"
ATOM = "http://www.w3.org/2005/Atom"
# Text and attribute values of every element outside <content>/<summary>
# (post bodies, which may legitimately quote Liquid in a code sample).
def feed_chrome_strings(node, out = [])
  return out if %w[content summary].include?(node.name)

  node.attributes.each_value { |a| out << a.value }
  node.texts.each { |t| out << t.value }
  node.elements.each { |child| feed_chrome_strings(child, out) }
  out
end

feed_doc = parse_xml(File.join(SITE, "feed.xml"))
feed_root = feed_doc&.root
check("feed.xml parses as XML with an Atom <feed> root") do
  feed_root&.name == "feed" && feed_root.namespace == ATOM
end
self_link = feed_root && REXML::XPath.first(feed_root, "a:link[@rel='self']", "a" => ATOM)
check("feed.xml's self link is #{SITE_URL}/feed.xml") do
  self_link && self_link.attributes["href"] == "#{SITE_URL}/feed.xml"
end
entries = feed_root ? REXML::XPath.match(feed_root, "a:entry", "a" => ATOM) : []
limit = (config.dig("feed", "posts_limit") || 10).to_i
expected_entries = [public_posts.size, limit].min
check("feed.xml has #{expected_entries} entries (min of #{public_posts.size} public posts " \
      "and the #{limit}-post limit); found #{entries.size}") { entries.size == expected_entries }
feed_links = entries.map do |e|
  link = REXML::XPath.first(e, "a:link[@rel='alternate']", "a" => ATOM)
  link&.attributes&.[]("href").to_s
end
feed_links.each do |href|
  check("feed entry #{href} is a built post on this site") do
    href.start_with?("#{SITE_URL}/") && !built_file(href.delete_prefix(SITE_URL)).nil?
  end
end
entries.each do |e|
  id = REXML::XPath.first(e, "a:id", "a" => ATOM)&.text.to_s
  title = REXML::XPath.first(e, "a:title", "a" => ATOM)&.text.to_s
  check("feed entry #{id.inspect} has a title and an id") do
    !id.strip.empty? && !title.strip.empty?
  end
end
check("feed.xml has no unresolved Liquid outside post bodies") do
  feed_root && feed_chrome_strings(feed_root).none? { |s| s.match?(liquid) }
end

tag_feeds = Dir.glob(File.join(SITE, "tags", "*", "feed.xml")).sort
tag_feeds.each do |path|
  rel = path.delete_prefix("#{SITE}/")
  root = parse_xml(path)&.root
  check("#{rel} parses as XML with an Atom <feed> root") do
    root&.name == "feed" && root.namespace == ATOM
  end
  href_xpath = "a:entry/a:link[@rel='alternate']/@href"
  hrefs = root ? REXML::XPath.match(root, href_xpath, "a" => ATOM).map(&:value) : []
  check("#{rel} lists no test-fixture post") do
    hrefs.none? { |h| fixture_posts.any? { |p| h == "#{SITE_URL}#{p[:url]}" } }
  end
end

# --------------------------------------------------------------------------
section "sitemap: parses, lists only built and indexable pages, lists every public post"
SITEMAP_NS = "http://www.sitemaps.org/schemas/sitemap/0.9"
sitemap_root = parse_xml(File.join(SITE, "sitemap.xml"))&.root
check("sitemap.xml parses as XML with a <urlset> root") do
  sitemap_root&.name == "urlset" && sitemap_root.namespace == SITEMAP_NS
end
loc_nodes = sitemap_root ? REXML::XPath.match(sitemap_root, "s:url/s:loc", "s" => SITEMAP_NS) : []
locs = loc_nodes.map { |l| l.text.to_s.strip }
check("sitemap.xml lists URLs (#{locs.size})") { !locs.empty? }
locs.each do |loc|
  path = loc.delete_prefix(SITE_URL)
  target = loc.start_with?("#{SITE_URL}/") ? built_file(path) : nil
  check("sitemap URL #{loc} is on this site and built") { !target.nil? }
  next unless target&.end_with?(".html")

  check("sitemap URL #{loc} is not a noindex page") { !noindex?(read(target)) }
end
check("sitemap.xml lists no /admin/ or /e2e/ URL") do
  locs.none? { |l| l.start_with?("#{SITE_URL}/admin/", "#{SITE_URL}/e2e/") }
end
public_posts.each do |post|
  check("sitemap.xml lists public post #{post[:url]}") { locs.include?("#{SITE_URL}#{post[:url]}") }
end
robots = read(File.join(SITE, "robots.txt")).to_s
check("robots.txt points crawlers at #{SITE_URL}/sitemap.xml") do
  robots.lines.map(&:strip).include?("Sitemap: #{SITE_URL}/sitemap.xml")
end

# --------------------------------------------------------------------------
section "test fixtures stay out of every public listing"
listing_pages = [File.join(SITE, "index.html"), File.join(SITE, "blog", "index.html")] +
                Dir.glob(File.join(SITE, "tags", "**", "index.html"))
listing_pages = listing_pages.select { |f| File.file?(f) }.sort
fixture_posts.each do |post|
  absolute = "#{SITE_URL}#{post[:url]}"
  check("fixture #{post[:src]} is not in sitemap.xml") { !locs.include?(absolute) }
  check("fixture #{post[:src]} is not in feed.xml") { !feed_links.include?(absolute) }
  listing_pages.each do |file|
    hrefs = tags(read(file), "a").map { |a| a["href"].to_s }
    check("fixture #{post[:src]} is not linked from #{url_path_of(file)}") do
      !hrefs.include?(post[:url]) && !hrefs.include?(absolute)
    end
  end
end
e2e_sources = Dir.glob(File.join(ROOT, "_e2e", "*.md")).sort
e2e_sources.each do |src|
  data = front_matter(src)
  url = data["permalink"].to_s
  url = "/e2e/#{File.basename(src, '.md')}/" if url.empty?
  rel = src.delete_prefix("#{ROOT}/")
  target = built_file(url)
  check("#{rel} canary builds at #{url} (the publish loops drive it)") { !target.nil? }
  check("#{rel} canary page is noindex") { target && noindex?(read(target)) }
end

# --------------------------------------------------------------------------
section "tools: every tool page builds and embeds a vendored app that exists"
tool_sources = Dir.glob(File.join(ROOT, "_tools", "*.md")).sort
tools_index = read(File.join(SITE, "tools", "index.html")).to_s
tools_index_links = tags(tools_index, "a").map { |a| a["href"].to_s }
check("_tools/ has tools to check (#{tool_sources.size})") { !tool_sources.empty? }
tool_sources.each do |src|
  data = front_matter(src)
  next unless published?(data)

  slug = slugify(data["slug"].to_s.strip.empty? ? File.basename(src, ".md") : data["slug"])
  url = "/tools/#{slug}/"
  rel = src.delete_prefix("#{ROOT}/")
  page = built_file(url)
  check("#{rel} builds at #{url}") { !page.nil? }
  check("/tools/ lists #{url}") do
    tools_index_links.include?(url) || tools_index_links.include?("#{SITE_URL}#{url}")
  end
  embed = data["embed_src"].to_s
  next if embed.empty?

  iframes = tags(read(page), "iframe").map { |i| i["src"].to_s }
  check("#{url} embeds #{embed} in an iframe") { iframes.include?(embed) }
  check("#{rel}'s embedded app #{embed} is in _site") { !built_file(embed).nil? }
end
Dir.glob(File.join(ROOT, "_data", "tool_sources", "*.yml")).sort.each do |src|
  slug = File.basename(src, ".yml")
  rel = src.delete_prefix("#{ROOT}/")
  check("vendored tool #{slug} (#{rel}) is built at /assets/tools/#{slug}/") do
    !built_file("/assets/tools/#{slug}/").nil?
  end
end

# --------------------------------------------------------------------------
section "admin: the rendered Decap config parses and points at this site"
check("_site/admin/index.html was built") { File.file?(File.join(SITE, "admin", "index.html")) }
admin_text = read(File.join(SITE, "admin", "config.yml"))
admin = admin_text && yaml_load(admin_text)
check("_site/admin/config.yml exists and parses as a YAML mapping") { admin.is_a?(Hash) }
admin = {} unless admin.is_a?(Hash)
backend = admin["backend"].is_a?(Hash) ? admin["backend"] : {}
check("admin backend repo is _config.yml's cms.repository (#{config.dig('cms', 'repository')})") do
  !backend["repo"].to_s.empty? && backend["repo"] == config.dig("cms", "repository")
end
check("admin backend base_url is _config.yml's cms.oauth_base_url") do
  !backend["base_url"].to_s.empty? && backend["base_url"] == config.dig("cms", "oauth_base_url")
end
check("admin site_url is #{SITE_URL}") { admin["site_url"].to_s.chomp("/") == SITE_URL }
admin_collections = element_names(admin["collections"])
check("admin config has a posts collection") { admin_collections.include?("posts") }
seam_names = element_names(yaml_load(read(File.join(ROOT, "admin", "collections.site.yml")).to_s))
check("admin/collections.site.yml parses and declares collections (#{seam_names.join(', ')})") do
  !seam_names.empty?
end
seam_names.each do |name|
  check("site-owned collection #{name.inspect} is in the rendered admin config") do
    admin_collections.include?(name)
  end
end

# --------------------------------------------------------------------------
puts
if $failures.empty?
  puts "All #{$checks} build-artifact assertions passed."
  exit 0
else
  puts "#{$failures.size} of #{$checks} assertion(s) FAILED:"
  $failures.each { |f| puts "  - #{f}" }
  exit 1
end
