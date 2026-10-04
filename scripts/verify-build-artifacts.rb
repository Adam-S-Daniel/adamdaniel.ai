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
# building anything). The regression matrix in
# `scripts/test-verify-build-artifacts.rb` proves that ordinary content edits
# keep this green and that real defects turn it red.
#
# DESIGN RULE. An assertion may fail only on a genuinely broken build, never on
# a legitimate authoring choice. This check gates every PR — including the PRs
# the Decap CMS opens when the owner writes a post in the browser and the
# auto-merging platform-bump PRs — so a red result must always be one the
# reader can act on. When in doubt an assertion is made narrower, not cleverer.
#
# * Every expectation is DERIVED from the source tree (front matter, the
#   `_config.yml`, the admin seam) or from the build itself — never a
#   hardcoded post title, count or slug. Adding, editing, unpublishing or
#   deleting a post (even the last one) changes what is expected, not whether
#   the check passes.
# * URLs are compared in one normal form: percent-decoded, NFC. The CMS keeps
#   Unicode in slugs ("Café" -> `café`) while built hrefs, canonicals and
#   sitemap entries are percent-encoded.
# * Pure Ruby stdlib (`yaml`, `rexml`, `date`, `time`): no network, no gem
#   beyond what Jekyll already needs. REXML ships with Ruby and is already in
#   Gemfile.lock through kramdown.
# * Structured formats go through a real parser: YAML for front matter and
#   the admin config, REXML for the Atom feeds and the sitemap. A file that
#   does not parse is a normal FAIL line naming the file and the parser's
#   message, never a backtrace. Built HTML is scanned lexically (tag +
#   attribute tokens, comments and script/style bodies removed) because
#   Ruby's stdlib has no HTML5 parser.
# * "No unresolved Liquid" never judges authored text: `{{`/`{%` in a built
#   page is reported only when the same text is NOT in the page's own source
#   or in the site's authored content, i.e. only when a layout/include
#   emitted it.
#
# THEME-GEM COUPLINGS — what a cms-platform bump can trip. Each is a property
# the gem (or a Jekyll plugin it pulls in) provides and these assertions rely
# on; a bump that changes one should change the matching assertion in the same
# PR, and that is the ONLY kind of bump this script is meant to fail:
#   1. `<link rel="canonical">`, `og:title` and `og:url` on every rendered page
#      come from jekyll-seo-tag via the gem's default layout (`{% seo %}`).
#   2. Test fixtures: `test_fixture: true` or an `e2e-` slug (case-sensitive)
#      is mirrored from the gem's exclude_e2e_posts.rb, which stamps
#      `sitemap: false` + `feed_exclude: true`.
#   3. Atom feeds: `/feed.xml` from jekyll-feed (Atom namespace, rel=self
#      link, `feed.posts_limit`), per-tag `/tags/<slug>/feed.xml` from the
#      gem's tag_feeds.rb.
#   4. `/sitemap.xml` from jekyll-sitemap (urlset namespace, `sitemap: false`
#      exclusion; it does NOT exclude noindex pages and nothing here expects
#      it to).
#   5. The Decap admin: `_site/admin/index.html` and `_site/admin/config.yml`
#      are rendered by the gem's post_write hook. Only a `backend` mapping
#      that mentions THIS repository (and the OAuth base URL, when
#      `_config.yml` sets one), `site_url` when present, and a collection that
#      edits `_posts` are asserted; key names inside `backend` are not.
#   6. `/tags/<slug>/` archives and the `/tags/` index come from the gem's
#      auto_tag_pages.rb; only their canonical/link/Liquid checks apply.
#   7. A `<nav>` landmark on the home page (this site's own
#      `_includes/header.html` overrides the gem's; the check accepts any
#      `<nav>` and any attribute quoting).
#   8. The `canary` layout + `_config.yml` defaults make `/e2e/*` pages
#      noindex (site-owned config, gem-owned layout).
#
# Output: one `ok`/`FAIL` line per assertion, then a count. Exit 1 on any
# FAIL. `scripts/` is excluded from the Jekyll build, so this is never
# published.

require "yaml"
require "date"
require "time"
require "pathname"
require "rexml/document"

Encoding.default_external = Encoding::UTF_8
# Flush every line as it is printed: a crash must never leave the last visible
# line a section header.
$stdout.sync = true
$stderr.sync = true

ROOT = File.expand_path("..", __dir__).dup.force_encoding(Encoding::UTF_8)
SITE = File.join(ROOT, "_site")

$failures = []
$checks = 0

# Run one assertion. `fail_msg` (a String, or a Proc evaluated only on failure
# so it can describe what the block found) says what is wrong, where, and what
# to do; it defaults to the description. A parser error or any other exception
# in the block is a normal FAIL naming the cause — never a backtrace.
def check(desc, fail_msg = nil)
  $checks += 1
  cause = nil
  ok = begin
    yield
  rescue StandardError => e
    cause = e.message.lines.first.to_s.strip
    cause = "#{e.class}: #{cause}" unless e.is_a?(CheckError)
    false
  end
  if ok
    puts "  ok   #{desc}"
  else
    msg = begin
      fail_msg.respond_to?(:call) ? fail_msg.call : (fail_msg || desc)
    rescue StandardError
      desc
    end
    msg = "#{msg} [#{cause}]" if cause
    puts "  FAIL #{msg}"
    $failures << msg
  end
  ok
end

# Raised for conditions whose message is already plain English.
class CheckError < StandardError; end

def section(title)
  puts
  puts "== #{title} =="
end

def u8(str)
  str.to_s.dup.force_encoding(Encoding::UTF_8).scrub
end

def rel_path(path)
  u8(path).delete_prefix("#{ROOT}/")
end

def glob(pattern)
  Dir.glob(pattern).map { |f| u8(f) }.sort
end

# Pin reads to UTF-8 so the ambient locale (often unset/"C" in CI shells,
# which Ruby reads as US-ASCII) cannot break decoding on the first em dash,
# drop a BOM, and scrub invalid bytes so a stray one cannot crash a regex scan.
def read(path)
  return nil unless File.file?(path)

  File.binread(path).force_encoding(Encoding::UTF_8).scrub.delete_prefix("﻿")
end

def yaml_load(text, file = "YAML")
  YAML.safe_load(text, permitted_classes: [Date, Time, Symbol], aliases: true)
rescue Psych::Exception => e
  raise CheckError, "#{file} is not valid YAML: #{e.message.lines.first.to_s.strip}"
end

$front_matter_cache = {}
# Front matter of a Jekyll source file, parsed with the yaml stdlib.
# Returns {} when the file has none. A front matter that is not valid YAML is
# reported once as a normal FAIL (Jekyll would silently ignore it and render
# the page with no title) and read as {}.
def front_matter(path)
  $front_matter_cache[path] ||= begin
    text = read(path).to_s
    match = text.match(/\A---\s*\n(.*?)\n---\s*(\n|\z)/m)
    if match
      data = begin
        yaml_load(match[1], rel_path(path))
      rescue CheckError => e
        msg = "BAD FRONT MATTER: #{e.message} — fix the `---` block at the top of the file " \
              "(Jekyll ignores a front matter it cannot read, so the page loses its title and settings)"
        check(msg) { false }
        nil
      end
      data.is_a?(Hash) ? data : {}
    else
      {}
    end
  end
end

def published?(data)
  data["published"] != false
end

def noindex_value?(value)
  value.to_s.downcase.include?("noindex")
end

# Jekyll's default-mode `Utils.slugify`, which `permalink: /blog/:slug/`
# applies to a post's slug: every run of characters that are not letters,
# marks or digits becomes one hyphen, leading/trailing hyphens are trimmed,
# and the result is downcased.
def slugify(text)
  u8(text).gsub(/[^\p{M}\p{L}\p{Nd}]+/u, "-").gsub(/\A-|-\z/, "").downcase
end

# What Jekyll's PostReader treats as a post filename. A `_posts` file without
# a date prefix is NOT a post: Jekyll skips it, and so does this verifier.
POST_FILENAME = /\A(\d{2,4})-(\d{1,2})-(\d{1,2})-(.*)\z/
# The gem's exclude_e2e_posts.rb strips exactly this prefix before applying
# its case-sensitive `e2e-` rule.
GEM_DATE_PREFIX = /\A\d{4}-\d{2}-\d{2}-/

# Mirrors cms-platform's exclude_e2e_posts.rb exactly: a post is a test
# fixture when it sets `test_fixture: true` or its (un-slugified, case
# preserved) effective slug starts with `e2e-`.
def fixture_post?(data, path)
  return true if data["test_fixture"] == true

  explicit = data["slug"]
  raw = if explicit.is_a?(String) && !explicit.strip.empty?
          explicit.strip
        else
          File.basename(path, File.extname(path)).sub(GEM_DATE_PREFIX, "")
        end
  raw.start_with?("e2e-")
end

# Percent-decode (UTF-8) and NFC-normalize. Every URL comparison goes through
# this so `/blog/café/` and `/blog/caf%C3%A9/` are the same URL.
def percent_decode(text)
  bytes = text.to_s.b.gsub(/%\h\h/n) { |m| m[1, 2].hex.chr }
  bytes.force_encoding(Encoding::UTF_8).scrub
end

def norm(url)
  percent_decode(url).unicode_normalize(:nfc)
end

ENTITY_NAMES = { "amp" => "&", "lt" => "<", "gt" => ">", "quot" => '"', "apos" => "'",
                 "nbsp" => " " }.freeze

def html_unescape(text)
  text.to_s.gsub(/&(?:#(\d+)|#[xX](\h+)|(\w+));/) do |whole|
    if Regexp.last_match(1) || Regexp.last_match(2)
      code = Regexp.last_match(1)&.to_i || Regexp.last_match(2).hex
      begin
        [code].pack("U")
      rescue RangeError
        whole
      end
    else
      ENTITY_NAMES.fetch(Regexp.last_match(3), whole)
    end
  end
end

# Map a root-relative URL path to the file in `_site` that serves it, or nil.
# `/x/` serves `x/index.html`; `/x` serves the file `x`, `x/index.html`, or
# (Jekyll writes extension-less permalinks that way) `x.html`. Both NFC and NFD
# spellings of the path are tried because the file system keeps whatever the
# source file name used.
def built_file(url_path)
  decoded = norm(url_path.to_s.sub(/[?#].*\z/m, ""))
  return nil unless decoded.start_with?("/")

  [decoded, decoded.unicode_normalize(:nfd)].uniq.each do |path|
    local = File.expand_path(File.join(SITE, path))
    next unless local == SITE || local.start_with?("#{SITE}/")

    index = File.join(local, "index.html")
    candidates = if path.end_with?("/")
                   [index]
                 else
                   [local, index] + (File.extname(local).empty? ? ["#{local}.html"] : [])
                 end
    found = candidates.find { |c| File.file?(c) }
    return found if found
  end
  nil
end

# The URL path a built HTML file is served at (inverse of built_file).
def url_path_of(file)
  rel = u8(file).delete_prefix(SITE)
  File.basename(rel) == "index.html" ? rel.delete_suffix("index.html") : rel
end

# Built HTML with the parts that must never be mistaken for markup removed:
# comments, and the bodies of <script>/<style>.
def clean_html(html)
  html.to_s.gsub(/<!--.*?-->/m, "")
      .gsub(%r{(<(script|style)\b[^>]*>).*?(</\2\s*>)}mi, '\1\3')
end

TAG_ATTRS = /((?:[^>"']|"[^"]*"|'[^']*')*)/.freeze
ATTR_PAIR = /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/.freeze

# Lexical tag scan: every start tag named `name`, as an attribute Hash with
# entity-decoded values. Handles double-quoted, single-quoted and unquoted
# attribute values and `>` inside a quoted value.
def tags(html, name)
  clean_html(html).scan(/<#{name}\b#{TAG_ATTRS}>/im).map do |(attrs)|
    attrs.scan(ATTR_PAIR).to_h do |k, v1, v2, v3|
      [k.downcase, html_unescape(v1 || v2 || v3 || "")]
    end
  end
end

def noindex?(html)
  tags(html, "meta").any? do |m|
    m["name"].to_s.downcase == "robots" && noindex_value?(m["content"])
  end
end

def element_names(list)
  list.is_a?(Array) ? list.map { |c| c.is_a?(Hash) ? c["name"] : nil }.compact : []
end

def parse_xml(path)
  text = read(path)
  raise CheckError, "#{rel_path(path)} was not built" if text.nil?

  REXML::Document.new(text)
rescue REXML::ParseException => e
  raise CheckError, "#{rel_path(path)} is not well-formed XML: #{e.message.lines.first.to_s.strip}"
end

# Whitespace-free text, so the same Liquid token compares equal however the
# author spaced it.
def squash(text)
  text.to_s.gsub(/\s+/, "")
end

# The leading token of every `{{` / `{%` in `text` (opener + the identifier
# after it), tags and entities removed. Short on purpose: it must survive
# Markdown rendering, HTML escaping and description truncation.
def liquid_keys(text)
  keys = []
  pos = 0
  while (i = text.index(/\{[{%]/, pos))
    tail = html_unescape(text[i + 2, 80].to_s.gsub(/<[^>]*>/, "")).gsub(/\s+/, "")
    keys << (text[i, 2] + tail[/\A[\w.\-]{0,30}/].to_s)
    pos = i + 2
  end
  keys.uniq
end

# The URL Jekyll gives a page with no `permalink:`: an `index` page serves its
# directory; any other page is `/<path>/<name>` plus the suffix the site-wide
# `permalink:` style implies (Jekyll's Utils.add_permalink_suffix): `/` when the
# style ends in a slash (this site's `/blog/:slug/`), `.html` for the built-in
# date/ordinal/none styles, `/` for pretty.
def default_page_url(rel, style)
  base = rel.sub(/\.[^.\/]+\z/, "")
  return "/#{File.dirname(rel)}/".sub(%r{\A/\./}, "/") if File.basename(base) == "index"

  suffix = case style.to_s
           when "pretty" then "/"
           when "", "date", "ordinal", "none" then ".html"
           else style.to_s.end_with?("/") ? "/" : ""
           end
  "/#{base}#{suffix}"
end

# --------------------------------------------------------------------------
begin
config = begin
  yaml_load(read(File.join(ROOT, "_config.yml")).to_s, "_config.yml") || {}
rescue CheckError => e
  puts "  FAIL #{e.message}"
  puts
  puts "1 assertion(s) FAILED — _config.yml must parse before anything else can be verified."
  exit 1
end
config = {} unless config.is_a?(Hash)
SITE_URL = "#{config['url']}#{config['baseurl']}".chomp("/")
FUTURE_POSTS = config["future"] == true

# Absolute same-site URL -> root-relative path; anything else unchanged.
def site_path(ref)
  return "/" if ref == SITE_URL
  return ref.delete_prefix(SITE_URL) if ref.start_with?("#{SITE_URL}/")

  ref
end

section "the build exists"
unless check("_site/ exists",
             "MISSING BUILD: there is no _site/ to verify — run `bundle exec jekyll build` first") do
  File.directory?(SITE)
end
  puts
  puts "1 assertion(s) FAILED — there is no _site/ to verify."
  exit 1
end
check("_config.yml has a site url to build canonical links from (#{SITE_URL.inspect})",
      "CONFIG: _config.yml `url:` is #{config['url'].inspect}; canonical links need an absolute " \
      "http(s) URL (e.g. https://adamdaniel.ai)") { SITE_URL.match?(%r{\Ahttps?://}) }
%w[index.html 404.html robots.txt feed.xml sitemap.xml].each do |name|
  check("_site/#{name} was built",
        "MISSING FILE: _site/#{name} was not built — check the Jekyll build log and that the " \
        "plugin/layout that produces it is still enabled") { File.file?(File.join(SITE, name)) }
end

# Authored source of every page; filled below and used for messages, the
# canonical expectation and the Liquid rule. Key: built file path.
PAGE_SOURCES = {}
def source_note(file)
  info = PAGE_SOURCES[file]
  info ? " (source: #{info[:src]})" : ""
end

# Pages this site renders itself. `admin/` is gem-delivered Decap machinery,
# `assets/` holds vendored standalone apps (their own <head>), and an .html file
# that exists verbatim in the source tree without front matter is a static copy
# Jekyll never rendered; none of those carry the site chrome these assertions
# are about.
site_pages = glob(File.join(SITE, "**", "*.html")).reject do |f|
  rel = f.delete_prefix("#{SITE}/")
  src = File.join(ROOT, rel)
  rel.start_with?("admin/", "assets/") || (File.file?(src) && !read(src).to_s.start_with?("---"))
end
check("the build rendered site pages to check (#{site_pages.size} found)",
      "MISSING PAGES: _site has no rendered HTML pages — the build produced nothing to verify") do
  !site_pages.empty?
end

# --------------------------------------------------------------------------
section "every source page builds, and every unpublished one does not"
# Root pages, section index pages and pages/*.md — skipping anything Jekyll
# does not read (dot/underscore paths and `_config.yml`'s `exclude:` list)
# and files without front matter (which Jekyll copies, not renders).
excluded = Array(config["exclude"]).map { |e| e.to_s.chomp("/") }
page_sources = (glob(File.join(ROOT, "*.{html,md}")) +
                glob(File.join(ROOT, "*", "index.html")) +
                glob(File.join(ROOT, "pages", "*.md"))).uniq.reject do |f|
  rel = rel_path(f)
  rel.start_with?("_", ".") ||
    excluded.any? { |e| File.fnmatch?(e, rel) || rel.start_with?("#{e}/") } ||
    !read(f).to_s.start_with?("---")
end.sort
check("the home page source index.html was found",
      "MISSING SOURCE: index.html (the home page) is not in the repository root with front matter") do
  page_sources.any? { |f| rel_path(f) == "index.html" }
end
claimed_urls = []
page_infos = page_sources.map do |src|
  data = front_matter(src)
  rel = rel_path(src)
  url = data["permalink"].to_s
  url = default_page_url(rel, config["permalink"]) if url.empty?
  { src: rel, data: data, url: url, published: published?(data) }
end
page_infos.select { |p| p[:published] }.each { |p| claimed_urls << norm(p[:url]) }
page_infos.each do |info|
  rel = info[:src]
  url = info[:url]
  if info[:published]
    file = built_file(url)
    PAGE_SOURCES[file] = info if file
    check("#{rel} is published and builds at #{url}",
          "MISSING PAGE: #{rel} should be built at #{url} but _site has no such file " \
          "(check its `permalink:` and `published:` front matter, and the build log)") { !file.nil? }
  else
    next if claimed_urls.include?(norm(url)) # another published source owns this URL

    check("#{rel} is `published: false` and is NOT built at #{url}",
          "UNPUBLISHED BUT BUILT: #{rel} is `published: false` yet #{url} exists in _site — " \
          "something other than this file is producing it") { built_file(url).nil? }
  end
end

# --------------------------------------------------------------------------
section "posts: published ones build, drafts do not, fixtures are classified"
# A collection URL template with the placeholders Jekyll fills from a post.
def expand_permalink(template, slug, time)
  expanded = template.gsub(":slug", slug).gsub(":title", slug)
                     .gsub(":year", time.strftime("%Y")).gsub(":month", time.strftime("%m"))
                     .gsub(":day", time.strftime("%d"))
  expanded.include?(":") ? nil : expanded
end

def post_time(data, name_date)
  value = data["date"]
  case value
  when Time then value
  when Date then Time.utc(value.year, value.month, value.day)
  when String then (Time.parse(value) rescue name_date)
  else name_date
  end
end

now = Time.now
post_template = config["permalink"].to_s.empty? ? "/:categories/:year/:month/:day/:title.html" : config["permalink"].to_s
posts = glob(File.join(ROOT, "_posts", "**", "*.{md,markdown,html}")).filter_map do |src|
  base = File.basename(src, File.extname(src))
  match = base.match(POST_FILENAME)
  next unless match # Jekyll ignores a _posts file with no date prefix; so do we

  data = front_matter(src)
  name_slug = match[4]
  name_date = begin
    Time.utc(match[1].to_i, match[2].to_i, match[3].to_i)
  rescue ArgumentError
    nil
  end
  next unless name_date

  explicit = data["slug"]
  slug_raw = explicit.is_a?(String) && !explicit.strip.empty? ? explicit.strip : name_slug
  slug = slugify(slug_raw)
  permalink = data["permalink"].to_s
  time = post_time(data, name_date)
  url = permalink.empty? ? expand_permalink(post_template, slug, time) : permalink
  # A post Jekyll only builds when `future: true` and whose date is in (or
  # within a day of) the future is not asserted either way.
  deferred = !FUTURE_POSTS && time > now - 86_400
  { src: rel_path(src), data: data, slug: slug, url: url, published: published?(data),
    deferred: deferred, fixture: fixture_post?(data, src) }
end
checkable = posts.reject { |p| p[:url].nil? }
public_posts = checkable.select { |p| p[:published] && !p[:fixture] && !p[:deferred] }
fixture_posts = checkable.select { |p| p[:fixture] }
puts "  (#{posts.size} posts: #{public_posts.size} public, #{fixture_posts.size} test fixtures, " \
     "#{posts.count { |p| !p[:published] }} unpublished, " \
     "#{posts.count { |p| p[:url].nil? }} with a URL template this script cannot expand)"
checkable.select { |p| p[:published] }.each { |p| claimed_urls << norm(p[:url]) }
checkable.each do |post|
  next if post[:deferred]

  if post[:published]
    file = built_file(post[:url])
    PAGE_SOURCES[file] = post if file
    check("#{post[:src]} is published and builds at #{post[:url]}",
          "MISSING POST: #{post[:src]} is published but #{post[:url]} is not in _site " \
          "(check its `permalink:`/`slug:` front matter and the build log)") { !file.nil? }
  else
    next if claimed_urls.include?(norm(post[:url]))

    check("#{post[:src]} is `published: false` and is NOT built at #{post[:url]}",
          "UNPUBLISHED BUT BUILT: #{post[:src]} is `published: false` yet #{post[:url]} exists in " \
          "_site — something other than this file is producing it") { built_file(post[:url]).nil? }
  end
end

# Tag entries only feed the source-file hint in messages.
glob(File.join(ROOT, "_tags", "*.md")).each do |src|
  data = front_matter(src)
  url = data["permalink"].to_s
  url = "/tags/#{slugify(data['slug'].to_s.strip.empty? ? File.basename(src, '.md') : data['slug'])}/" if url.empty?
  file = built_file(url)
  PAGE_SOURCES[file] = { src: rel_path(src), data: data, url: url } if file
end

# --------------------------------------------------------------------------
section "navigation: every main-nav link leads to a built page"
home_html = read(File.join(SITE, "index.html")).to_s
nav_blocks = clean_html(home_html).scan(%r{<nav\b[^>]*>.*?</nav>}mi)
check("home page has a navigation landmark (<nav>)",
      "NAV: the home page has no <nav> element — the site header/navigation did not render " \
      "(check _includes/header.html and the layout)") { !nav_blocks.empty? }
nav_links = nav_blocks.flat_map { |b| tags(b, "a").map { |a| a["href"].to_s.strip } }.reject(&:empty?).uniq
check("the navigation has links (#{nav_links.size})",
      "NAV: the home page <nav> has no links") { !nav_links.empty? }
nav_links.each do |href|
  next if href.start_with?("#", "?") || href.match?(/\A[a-z][a-z0-9+.-]*:/i) && !href.start_with?("#{SITE_URL}/")

  path = site_path(href)
  next unless path.start_with?("/")

  check("nav link #{href} resolves to a built page",
        "NAV LINK: #{href} in the main navigation is not built — fix the link in " \
        "_includes/header.html or restore/publish the page it points to") { !built_file(path).nil? }
end

# --------------------------------------------------------------------------
section "tools: every tool page builds and embeds a vendored app that exists"
tool_sources = glob(File.join(ROOT, "_tools", "*.md"))
tools_index = read(File.join(SITE, "tools", "index.html")).to_s
tools_index_links = tags(tools_index, "a").map { |a| norm(site_path(a["href"].to_s)) }
# Targets already reported by a more specific assertion; the generic link scan
# below does not repeat them.
reported_missing = []
tool_sources.each do |src|
  data = front_matter(src)
  next unless published?(data)

  slug = slugify(data["slug"].to_s.strip.empty? ? File.basename(src, ".md") : data["slug"])
  url = data["permalink"].to_s.empty? ? "/tools/#{slug}/" : data["permalink"].to_s
  rel = rel_path(src)
  claimed_urls << norm(url)
  page = built_file(url)
  PAGE_SOURCES[page] = { src: rel, data: data, url: url } if page
  check("#{rel} builds at #{url}",
        "MISSING TOOL PAGE: #{rel} should be built at #{url} but _site has no such file " \
        "(check its `slug:`/`permalink:` and `published:` front matter)") { !page.nil? }
  check("/tools/ lists #{url}",
        "TOOLS LIST: /tools/ does not link to #{url} (#{rel}) — check tools/index.html and " \
        "the tool's front matter") { tools_index_links.include?(norm(url)) }
  embed = data["embed_src"].to_s.strip
  next if embed.empty? || page.nil?

  iframes = tags(read(page), "iframe").map { |i| norm(site_path(i["src"].to_s)) }
  check("#{url} embeds #{embed} in an iframe",
        "TOOL EMBED: #{url} (#{rel}) does not render an <iframe> for embed_src #{embed} — " \
        "check _layouts/tool.html") { iframes.include?(norm(site_path(embed))) }
  next if embed.match?(%r{\A([a-z][a-z0-9+.-]*:|//)}i) # external app: nothing to look up

  unless check("#{rel}'s embedded app #{embed} is in _site",
               "TOOL EMBED: #{rel} embeds #{embed} but that app is not built — add the app under " \
               "assets/tools/ (or fix embed_src)") { !built_file(embed).nil? }
    reported_missing << norm(embed.sub(/[?#].*\z/m, ""))
  end
end
glob(File.join(ROOT, "_data", "tool_sources", "*.yml")).each do |src|
  slug = File.basename(src, ".yml")
  rel = rel_path(src)
  app = "/assets/tools/#{slug}/"
  next if reported_missing.include?(norm(app))

  check("vendored tool #{slug} (#{rel}) is built at #{app}",
        "VENDORED TOOL: #{rel} declares a vendored app but #{app} is not in _site — " \
        "re-vendor it or remove the source file") { !built_file(app).nil? }
end

# --------------------------------------------------------------------------
section "SEO: every site page names its own canonical URL and Open Graph tags"
# A page that opts out of every layout (`layout: null`/none, or a root page with
# no layout) is standalone HTML the author owns; it is not held to the layout's
# <head> contract.
def standalone?(info)
  return false unless info

  data = info[:data] || {}
  if data.key?("layout")
    data["layout"].nil? || data["layout"] == false || %w[none null].include?(data["layout"].to_s.downcase)
  else
    # Posts, tools, tags and canaries get a layout from `_config.yml` defaults, as
    # do `pages/*`; a root page or section index with no `layout:` renders bare.
    !info[:src].to_s.start_with?("pages/", "_")
  end
end
site_pages.each do |file|
  info = PAGE_SOURCES[file]
  next if standalone?(info)

  html = read(file)
  expected_path = info ? info[:url] : url_path_of(file)
  expected = norm("#{SITE_URL}#{expected_path}")
  canonicals = tags(html, "link").select { |l| l["rel"].to_s.downcase.split.include?("canonical") }
                                 .map { |l| norm(l["href"].to_s) }
  og = tags(html, "meta").to_h { |m| [m["property"].to_s, m["content"].to_s] }
  built = rel_path(file)
  check("#{built}: exactly one canonical link, pointing at #{expected}",
        -> { "canonical: expected #{expected}, found #{canonicals.inspect} in #{built}#{source_note(file)}" }) do
    canonicals == [expected]
  end
  check("#{built}: og:title is set and og:url matches the canonical URL",
        -> { "og: expected og:title to be set and og:url to be #{expected}, found og:title=" \
             "#{og['og:title'].to_s.inspect} og:url=#{og['og:url'].to_s.inspect} in #{built}#{source_note(file)}" }) do
    !og["og:title"].to_s.strip.empty? && norm(og["og:url"].to_s) == expected
  end
end

# --------------------------------------------------------------------------
section "internal links: every same-site href/src on a site page resolves"
# Resolve a link found on `page` to a root-relative path (no query/fragment).
def resolve_ref(page, ref)
  path = ref.sub(/[?#].*\z/m, "")
  return nil if path.empty? # same-page query/fragment

  unless path.start_with?("/")
    base = page.end_with?("/") ? page : File.dirname(page) + "/"
    path = base + path
  end
  clean = Pathname.new(path).cleanpath.to_s
  path.end_with?("/") && clean != "/" ? "#{clean}/" : clean
end

link_refs = Hash.new { |h, k| h[k] = [] }
site_pages.each do |file|
  html = read(file)
  page = url_path_of(file)
  { "a" => "href", "link" => "href", "script" => "src", "img" => "src",
    "iframe" => "src", "source" => "src" }.each do |tag, attr|
    tags(html, tag).each do |t|
      ref = t[attr].to_s.strip
      next if ref.empty? || ref.start_with?("#", "//")

      ref = site_path(ref)
      next if ref.match?(/\A[a-z][a-z0-9+.-]*:/i) # external or mailto:/tel:/data:

      resolved = resolve_ref(page, ref)
      link_refs[resolved] << file if resolved
    end
  end
end
check("the home page carries internal links to check (#{link_refs.size} distinct targets in total)",
      "LINKS: no internal link was found on any page — the layout/navigation did not render") do
  !link_refs.empty?
end
link_refs.keys.sort.each do |ref|
  next if reported_missing.include?(norm(ref))

  files = link_refs[ref].uniq
  where = files.first(3).map { |f| "#{url_path_of(f)}#{source_note(f)}" }.join(", ")
  where += " and #{files.size - 3} more" if files.size > 3
  check("link target #{ref} exists in _site (linked from #{where})",
        "BROKEN LINK: #{ref} is not built (linked from #{where} — fix the link in the post " \
        "that renders at that URL, or publish the target)") { !built_file(ref).nil? }
end

# --------------------------------------------------------------------------
section "no unresolved Liquid in the built output"
# Authored text may legitimately contain `{{`/`{%` (a post about GitHub
# Actions is full of `${{ … }}`), including OUTSIDE <pre>/<code>: inline
# `{% raw %}`, a title, an excerpt that leaks into <meta description>. So the
# rule is not "the page has no `{{`" but "the page has no `{{` that its own
# source (or other authored content that listing pages quote) does not also
# contain" — i.e. only text a layout or include failed to render.
content_files = glob(File.join(ROOT, "_{posts,tools,tags,e2e}", "**", "*")) +
                glob(File.join(ROOT, "pages", "*")) + glob(File.join(ROOT, "_data", "**", "*")) +
                [File.join(ROOT, "_config.yml"), File.join(ROOT, "admin", "collections.site.yml")]
content_corpus = squash(content_files.select { |f| File.file?(f) }.map { |f| read(f).to_s }.join("\n"))
corpus_for = lambda do |file|
  own = PAGE_SOURCES[file]
  own_text = own ? squash(read(File.join(ROOT, own[:src])).to_s) : ""
  own_text + content_corpus
end
site_pages.each do |file|
  scrubbed = clean_html(read(file)).gsub(%r{<(pre|code|textarea)\b.*?</\1>}mi, "")
  corpus = corpus_for.call(file)
  leaked = liquid_keys(scrubbed).reject { |k| corpus.include?(k) }
  built = rel_path(file)
  check("#{built} has no unresolved Liquid tags",
        "UNRESOLVED LIQUID: #{built} contains #{leaked.first(3).inspect} that is not in its " \
        "source#{source_note(file)} — a layout or include emitted it without rendering; fix the " \
        "template that produces it") { leaked.empty? }
end
%w[robots.txt sitemap.xml].each do |name|
  leaked = liquid_keys(read(File.join(SITE, name)).to_s).reject { |k| content_corpus.include?(k) }
  check("#{name} has no unresolved Liquid tags",
        "UNRESOLVED LIQUID: _site/#{name} contains #{leaked.first(3).inspect} — its template " \
        "did not render") { leaked.empty? }
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

feed_root = nil
check("feed.xml parses as XML with an Atom <feed> root",
      "FEED: _site/feed.xml is not a valid Atom feed (expected a <feed> element in #{ATOM})") do
  feed_root = parse_xml(File.join(SITE, "feed.xml")).root
  feed_root&.name == "feed" && feed_root.namespace == ATOM
end
self_link = feed_root && REXML::XPath.first(feed_root, "a:link[@rel='self']", "a" => ATOM)
check("feed.xml's self link is #{SITE_URL}/feed.xml",
      "FEED: feed.xml's rel=self link is #{self_link&.attributes&.[]('href').inspect}, " \
      "expected #{SITE_URL}/feed.xml") do
  self_link && norm(self_link.attributes["href"].to_s) == "#{SITE_URL}/feed.xml"
end
entries = feed_root ? REXML::XPath.match(feed_root, "a:entry", "a" => ATOM) : []
limit = (config.dig("feed", "posts_limit") || 10).to_i
feed_posts = public_posts.reject { |p| p[:data]["feed_exclude"] == true }
lower = [feed_posts.size, limit].min
check("feed.xml has between #{lower} and #{limit} entries; found #{entries.size}",
      "FEED: feed.xml has #{entries.size} entries but should have between #{lower} " \
      "(public posts, capped by the feed limit) and #{limit} — a post is missing from the " \
      "feed, or the feed is not limited") { entries.size >= lower && entries.size <= limit }
feed_links = entries.map do |e|
  link = REXML::XPath.first(e, "a:link[@rel='alternate']", "a" => ATOM)
  norm(link&.attributes&.[]("href").to_s)
end
feed_links.each do |href|
  check("feed entry #{href} is a built post on this site",
        "FEED ENTRY: feed.xml links to #{href}, which is not a built page on this site — an " \
        "unpublished or deleted post is still in the feed") do
    href.start_with?("#{SITE_URL}/") && !built_file(href.delete_prefix(SITE_URL)).nil?
  end
end
entries.each do |e|
  id = REXML::XPath.first(e, "a:id", "a" => ATOM)&.text.to_s
  title = REXML::XPath.first(e, "a:title", "a" => ATOM)&.text.to_s
  check("feed entry #{id.inspect} has a title and an id",
        "FEED ENTRY: feed.xml has an entry with id #{id.inspect} and title #{title.inspect}; " \
        "both must be non-empty") do
    !id.strip.empty? && !title.strip.empty?
  end
end
if feed_root
  leaked = liquid_keys(feed_chrome_strings(feed_root).join("\n")).reject { |k| content_corpus.include?(k) }
  check("feed.xml has no unresolved Liquid outside post bodies",
        "UNRESOLVED LIQUID: feed.xml contains #{leaked.first(3).inspect} outside post bodies that " \
        "no post source contains — the feed template did not render") { leaked.empty? }
end

fixture_urls = fixture_posts.map { |p| norm("#{SITE_URL}#{p[:url]}") }
glob(File.join(SITE, "tags", "*", "feed.xml")).each do |path|
  rel = path.delete_prefix("#{SITE}/")
  root = nil
  check("#{rel} parses as XML with an Atom <feed> root",
        "TAG FEED: _site/#{rel} is not a valid Atom feed") do
    root = parse_xml(path).root
    root&.name == "feed" && root.namespace == ATOM
  end
  hrefs = root ? REXML::XPath.match(root, "a:entry/a:link[@rel='alternate']/@href", "a" => ATOM)
                           .map { |a| norm(a.value) } : []
  check("#{rel} lists no test-fixture post",
        "FIXTURE LEAK: _site/#{rel} lists a test-fixture post — fixtures must carry " \
        "`feed_exclude: true` (the platform gem stamps it from `test_fixture: true` or an `e2e-` slug)") do
    (hrefs & fixture_urls).empty?
  end
end

# --------------------------------------------------------------------------
section "sitemap: parses, lists only built pages, lists every public post"
SITEMAP_NS = "http://www.sitemaps.org/schemas/sitemap/0.9"
sitemap_root = nil
check("sitemap.xml parses as XML with a <urlset> root",
      "SITEMAP: _site/sitemap.xml is not a valid sitemap (expected a <urlset> element in #{SITEMAP_NS})") do
  sitemap_root = parse_xml(File.join(SITE, "sitemap.xml")).root
  sitemap_root&.name == "urlset" && sitemap_root.namespace == SITEMAP_NS
end
loc_nodes = sitemap_root ? REXML::XPath.match(sitemap_root, "s:url/s:loc", "s" => SITEMAP_NS) : []
locs = loc_nodes.map { |l| norm(l.text.to_s.strip) }
check("sitemap.xml lists URLs (#{locs.size})",
      "SITEMAP: sitemap.xml lists no URLs") { !locs.empty? }
locs.each do |loc|
  check("sitemap URL #{loc} is on this site and built",
        "SITEMAP: sitemap.xml lists #{loc} but it is not a built page on this site " \
        "(an unpublished or deleted page is still listed)") do
    loc.start_with?("#{SITE_URL}/") && !built_file(loc.delete_prefix(SITE_URL)).nil?
  end
end
check("sitemap.xml lists no /admin/ or /e2e/ URL",
      "SITEMAP: sitemap.xml lists an /admin/ or /e2e/ URL — those must carry `sitemap: false`") do
  locs.none? { |l| l.start_with?("#{SITE_URL}/admin/", "#{SITE_URL}/e2e/") }
end
# Source front matter decides what a post's sitemap entry must be: public
# posts are listed; `sitemap: false` posts must be ABSENT; a noindex `robots`
# value alone changes neither (jekyll-sitemap does not read `robots`), so it is
# not asserted.
public_posts.each do |post|
  url = norm("#{SITE_URL}#{post[:url]}")
  if post[:data]["sitemap"] == false
    check("sitemap.xml omits #{post[:url]} (`sitemap: false`)",
          "SITEMAP: post #{post[:url]} (#{post[:src]}) has `sitemap: false` but is listed in " \
          "sitemap.xml") { !locs.include?(url) }
  elsif !noindex_value?(post[:data]["robots"])
    check("sitemap.xml lists public post #{post[:url]}",
          "SITEMAP: public post #{post[:url]} is missing from sitemap.xml (check its front " \
          "matter for sitemap: false or a noindex robots value; source: #{post[:src]})") do
      locs.include?(url)
    end
  end
end
robots = read(File.join(SITE, "robots.txt")).to_s
check("robots.txt points crawlers at #{SITE_URL}/sitemap.xml",
      "ROBOTS: _site/robots.txt has no `Sitemap: #{SITE_URL}/sitemap.xml` line") do
  robots.lines.map(&:strip).include?("Sitemap: #{SITE_URL}/sitemap.xml")
end

# --------------------------------------------------------------------------
section "test fixtures stay out of every public listing"
listing_pages = [File.join(SITE, "index.html"), File.join(SITE, "blog", "index.html")] +
                glob(File.join(SITE, "tags", "**", "index.html"))
listing_pages = listing_pages.select { |f| File.file?(f) }.sort
fixture_posts.each do |post|
  absolute = norm("#{SITE_URL}#{post[:url]}")
  relative = norm(post[:url])
  check("fixture #{post[:src]} is not in sitemap.xml",
        "FIXTURE LEAK: test fixture #{post[:src]} is listed in sitemap.xml — fixtures must " \
        "carry `sitemap: false`") { !locs.include?(absolute) }
  check("fixture #{post[:src]} is not in feed.xml",
        "FIXTURE LEAK: test fixture #{post[:src]} is listed in feed.xml — fixtures must carry " \
        "`feed_exclude: true`") { !feed_links.include?(absolute) }
  listing_pages.each do |file|
    hrefs = tags(read(file), "a").map { |a| norm(a["href"].to_s) }
    check("fixture #{post[:src]} is not linked from #{url_path_of(file)}",
          "FIXTURE LEAK: test fixture #{post[:src]} is linked from #{url_path_of(file)} — " \
          "listing templates must skip `feed_exclude` posts") do
      !hrefs.include?(relative) && !hrefs.include?(absolute)
    end
  end
end
glob(File.join(ROOT, "_e2e", "*.md")).each do |src|
  data = front_matter(src)
  next unless published?(data)

  url = data["permalink"].to_s
  url = "/e2e/#{File.basename(src, '.md')}/" if url.empty?
  rel = rel_path(src)
  target = built_file(url)
  PAGE_SOURCES[target] = { src: rel, data: data, url: url } if target
  check("#{rel} canary builds at #{url} (the publish loops drive it)",
        "MISSING CANARY: #{rel} should be built at #{url} but _site has no such file — the " \
        "CMS publish-loop tests drive it") { !target.nil? }
  check("#{rel} canary page is noindex",
        "CANARY: #{url} (#{rel}) is not noindex — e2e canaries must carry a robots noindex meta") do
    target && noindex?(read(target))
  end
end

# --------------------------------------------------------------------------
section "admin: the rendered Decap config parses and points at this site"
check("_site/admin/index.html was built",
      "MISSING FILE: _site/admin/index.html was not built — the CMS admin page is gone") do
  File.file?(File.join(SITE, "admin", "index.html"))
end
admin = nil
check("_site/admin/config.yml exists and parses as a YAML mapping",
      "ADMIN CONFIG: _site/admin/config.yml is missing, empty, or not a YAML mapping — the " \
      "Decap CMS cannot load") do
  text = read(File.join(SITE, "admin", "config.yml"))
  raise CheckError, "_site/admin/config.yml was not built" if text.nil?

  admin = yaml_load(text, "_site/admin/config.yml")
  admin.is_a?(Hash)
end
admin = {} unless admin.is_a?(Hash)

# This site's own repository: _config.yml `cms.repository`, else the CI
# environment, else the git remote.
def expected_repo(config)
  repo = config.dig("cms", "repository").to_s.strip
  repo = ENV["GITHUB_REPOSITORY"].to_s.strip if repo.empty?
  if repo.empty?
    remote = begin
      `git -C #{ROOT} remote get-url origin 2>/dev/null`.strip
    rescue StandardError
      ""
    end
    repo = remote[%r{github\.com[:/]([^/]+/[^/]+?)(?:\.git)?\z}, 1].to_s
  end
  repo
end

def deep_values(node)
  case node
  when Hash then node.values.flat_map { |v| deep_values(v) }
  when Array then node.flat_map { |v| deep_values(v) }
  else [node.to_s]
  end
end

backend = admin["backend"]
backend_values = backend.is_a?(Hash) ? deep_values(backend).map { |v| v.sub(%r{/\z}, "") } : []
repo = expected_repo(config)
if repo.empty?
  puts "  note admin backend repo not asserted: no cms.repository in _config.yml, no GITHUB_REPOSITORY, no git remote"
else
  check("admin backend points at this repository (#{repo})",
        "ADMIN CONFIG: the admin backend does not mention #{repo} — the CMS would commit to " \
        "the wrong repository (check `cms.repository` in _config.yml and the platform's admin renderer)") do
    backend_values.include?(repo)
  end
end
oauth = config.dig("cms", "oauth_base_url").to_s.sub(%r{/\z}, "")
unless oauth.empty?
  check("admin backend carries the OAuth base URL from _config.yml (#{oauth})",
        "ADMIN CONFIG: the admin backend does not mention the OAuth base URL #{oauth} from " \
        "_config.yml `cms.oauth_base_url` — CMS sign-in would fail") { backend_values.include?(oauth) }
end
if admin.key?("site_url")
  check("admin site_url is #{SITE_URL}",
        "ADMIN CONFIG: admin site_url is #{admin['site_url'].inspect}, expected #{SITE_URL}") do
    admin["site_url"].to_s.chomp("/") == SITE_URL
  end
end
admin_collections = element_names(admin["collections"])
check("admin config has a collection that edits _posts",
      "ADMIN CONFIG: no collection in the admin config edits `_posts` — the CMS could not " \
      "write posts") do
  Array(admin["collections"]).any? do |c|
    c.is_a?(Hash) && (c["folder"].to_s.chomp("/") == "_posts" || c["name"] == "posts")
  end
end
seam = read(File.join(ROOT, "admin", "collections.site.yml"))
seam_names = seam ? element_names(yaml_load(seam, "admin/collections.site.yml")) : []
seam_names.each do |name|
  check("site-owned collection #{name.inspect} is in the rendered admin config",
        "ADMIN CONFIG: admin/collections.site.yml declares collection #{name.inspect} but the " \
        "rendered admin config does not have it — the platform's admin renderer did not splice it in") do
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
rescue StandardError => e
  puts
  puts "FAIL the verifier itself crashed (#{e.class}: #{e.message.lines.first.to_s.strip}) " \
       "at #{e.backtrace&.first} — this is a bug in scripts/verify-build-artifacts.rb, not in the content"
  exit 1
end
