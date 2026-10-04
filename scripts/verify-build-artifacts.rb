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
# reader can act on. When sensitivity and "never red on a legitimate edit"
# conflict, the narrower rule wins.
#
# * Which pages, posts and documents exist, at which URL and output file, is
#   READ FROM JEKYLL, never predicted: the script loads the site's own bundle,
#   lets Jekyll read the source tree in-process (no render, no write) and asks
#   each page/document for its `url` and `destination`. Jekyll's `exclude:`
#   prefix/glob matching, slugification, permalink styles, front matter
#   defaults, `published:`/`future:` filtering and the theme gem's hooks
#   therefore cannot disagree with what this script expects.
# * URLs are compared in one normal form: percent-decoded, NFC. The CMS keeps
#   Unicode in slugs ("Café" -> `café`) while built hrefs, canonicals and
#   sitemap entries are percent-encoded.
# * Structured formats go through a real parser: YAML for front matter and
#   the admin config, REXML for the Atom feeds and the sitemap. A file that
#   does not parse is a normal FAIL line naming the file and the parser's
#   message, never a backtrace. Built HTML is scanned lexically (tag +
#   attribute tokens, comments and script/style bodies removed) because
#   Ruby's stdlib has no HTML5 parser.
# * No assertion compares rendered text with source text: Markdown rewrites
#   text (pipes become tables, underscores become <em>, entities decode), so
#   any such comparison misfires on some legitimate post. See the Liquid
#   section for how unresolved Liquid is detected without one.
#
# THEME-GEM COUPLINGS — what a cms-platform bump can trip. Each is a property
# the gem (or a Jekyll plugin it pulls in) provides and these assertions rely
# on; a bump that changes one should change the matching assertion in the same
# PR, and that is the ONLY kind of bump this script is meant to fail:
#   1. `<title>`, `<link rel="canonical">`, `og:title` and `og:url` on every
#      rendered page come from jekyll-seo-tag via the gem's default layout
#      (`{% seo %}`); `canonical_url:` front matter replaces the canonical.
#   2. Test fixtures: mirrored from the gem's
#      `theme/lib/cms-platform-theme/exclude_e2e_posts.rb` (in
#      Adam-S-Daniel/cms-platform). Its `:posts, :post_init` hook runs BEFORE
#      Jekyll reads a post's front matter, so in practice only the FILE NAME
#      (minus the date) starting with `e2e-` (case-sensitive) — or a
#      `_config.yml` default — makes a fixture; `test_fixture: true` or
#      `slug: e2e-…` in front matter does not. Keep `fixture_post?` in step
#      with that file.
#   3. Atom feeds: `/feed.xml` (site template, rel=self link,
#      `feed.posts_limit`), per-tag `/tags/<slug>/feed.xml` from the gem's
#      tag_feeds.rb.
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
#   9. The gem's `post` layout wraps the post body in `<div class="post-content">`
#      (asserted non-empty only for posts on that layout whose body is plain
#      prose, see "post bodies").
#
# Output: one `ok`/`FAIL` line per assertion, then a count. Exit 1 on any
# FAIL. `scripts/` is excluded from the Jekyll build, so this is never
# published.

require "yaml"
require "date"
require "time"
require "open3"
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

# Jekyll's own front matter pattern (Document::YAML_FRONT_MATTER_REGEXP).
FRONT_MATTER = /\A---\s*\n(.*?\n?)^(?:---|\.\.\.)\s*$\n?/m.freeze

# [front matter text, body] of a source file ("" front matter when none).
def split_front_matter(text)
  m = text.to_s.match(FRONT_MATTER)
  m ? [m[1], m.post_match] : ["", text.to_s]
end

# Jekyll silently ignores a front matter it cannot parse (the page loses its
# title and settings), so a source file whose `---` block is not valid YAML is
# reported once as a normal FAIL.
def check_front_matter(path)
  front, = split_front_matter(read(path))
  return if front.empty?

  YAML.safe_load(front, permitted_classes: [Date, Time, Symbol], aliases: true)
rescue Psych::SyntaxError => e
  # Only a syntax error is reported: Jekyll's YAML loader is more permissive
  # than safe_load about tags and classes, so anything else may build fine.
  check("BAD FRONT MATTER: #{rel_path(path)} is not valid YAML: " \
        "#{e.message.lines.first.to_s.strip} — fix the `---` block at the top of the file " \
        "(Jekyll ignores a front matter it cannot read, so the page loses its title and settings)") { false }
end

def noindex_value?(value)
  value.to_s.downcase.include?("noindex")
end

# The gem's exclude_e2e_posts.rb strips exactly this prefix before applying
# its case-sensitive `e2e-` rule.
GEM_DATE_PREFIX = /\A\d{4}-\d{2}-\d{2}-/.freeze

# Mirrors cms-platform's theme/lib/cms-platform-theme/exclude_e2e_posts.rb as
# it actually behaves: its hook fires on `:posts, :post_init`, before the
# post's front matter is read, so `data` there holds only `_config.yml`
# defaults. A post is a fixture when a default sets `test_fixture: true`, or
# the default `slug:` (else the file name minus its date) starts with `e2e-`.
def fixture_post?(doc)
  default = ->(key) { doc.site.frontmatter_defaults.find(doc.relative_path, :posts, key) }
  return true if default.call("test_fixture") == true

  explicit = default.call("slug")
  raw = if explicit.is_a?(String) && !explicit.strip.empty?
          explicit.strip
        else
          File.basename(doc.relative_path, File.extname(doc.relative_path)).sub(GEM_DATE_PREFIX, "")
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
                 "nbsp" => " " }.freeze

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

# The inner HTML of the first `<div>` whose class list contains `klass`
# (nested divs balanced), or nil when there is no such div.
def div_inner(html, klass)
  open = html.match(/<div\b[^>]*\bclass\s*=\s*["'](?:[^"']*\s)?#{Regexp.escape(klass)}(?:\s[^"']*)?["'][^>]*>/i)
  return nil unless open

  depth = 1
  pos = open.end(0)
  while (m = html.match(%r{<(/?)div\b[^>]*>}i, pos))
    depth += m[1].empty? ? 1 : -1
    return html[open.end(0)...m.begin(0)] if depth.zero?

    pos = m.end(0)
  end
  nil
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

# Any brace, in any spelling an author could use to show one: a literal brace,
# or its HTML entity.
BRACE_MARKER = /[{}]|&#0*12[35];|&#x0*7[bd];|&[lr]brace;|&[lr]cub;/i.freeze
BRACE_ENTITY = /&#0*12[35];|&#x0*7[bd];|&[lr]brace;|&[lr]cub;/i.freeze

# Does a Liquid TEMPLATE source contain a brace that can survive rendering?
# Liquid consumes its own `{{ … }}`/`{% … %}` tags, so those alone do not
# count; anything else that could put a brace in the output does: braces in
# front matter (titles etc. are printed), a `{% raw %}` block, a brace entity,
# a tag whose inner text holds a brace (`{{ '{{' }}`), or a stray brace left
# once the tags are removed. A source that opts out of Liquid counts any brace.
def template_brace?(front, body, data)
  return true if front.match?(BRACE_MARKER)
  return body.match?(BRACE_MARKER) if data["render_with_liquid"] == false
  return true if body.match?(BRACE_ENTITY) || body.match?(/\{%-?\s*raw\b/)

  rest = body.gsub(/\{\{.*?\}\}|\{%.*?%\}/m) { |tag| tag[2..-3].match?(/[{}]/) ? "{" : "" }
  rest.match?(/[{}]/)
end

def liquid_template?(body)
  body.match?(/\{\{|\{%/)
end

# [front matter text, body] of a model entry, the body being the `content`
# Jekyll itself split off (it accepts `...` as a closing line, among others).
# When the body is not a suffix of the file, the whole file counts as front
# matter, which only ever widens what is treated as authored braces.
def entry_parts(entry)
  text = read(entry[:file]).to_s
  body = entry[:body].to_s
  [text.end_with?(body) ? text.delete_suffix(body) : text, body]
end

# --------------------------------------------------------------------------
# Jekyll's own model of the site, read in-process from the same bundle the
# build used. Nothing is rendered or written; `read` runs the reader and the
# theme gem's read-time hooks, which is all that decides what exists where.
module SiteModel
  module_function

  def load(root, dest)
    ENV["JEKYLL_ENV"] ||= "production"
    gemfile = ENV["BUNDLE_GEMFILE"].to_s.empty? ? File.join(root, "Gemfile") : ENV["BUNDLE_GEMFILE"]
    if File.file?(gemfile)
      ENV["BUNDLE_GEMFILE"] = gemfile
      require "bundler/setup"
    end
    require "jekyll"
    Jekyll.logger.log_level = :error
    Jekyll::PluginManager.require_from_bundler
    base = Jekyll.configuration("source" => root, "destination" => dest, "quiet" => true)
    [read_site(base), read_site(base.merge("unpublished" => true))]
  end

  def read_site(config)
    site = Jekyll::Site.new(config)
    site.reset
    site.read
    site
  end

  # Every page and written collection document as a plain Hash.
  def entries(site, dest)
    pages = site.pages.map do |p|
      { kind: :page, src: u8(p.relative_path), data: p.data, url: u8(p.url),
        dest: u8(p.destination(dest)), file: File.join(site.source, p.relative_path), doc: nil,
        body: u8(p.content) }
    end
    docs = site.collections.values.select(&:write?).flat_map do |c|
      c.docs.map do |d|
        { kind: c.label.to_sym, src: u8(d.relative_path), data: d.data, url: u8(d.url),
          dest: u8(d.destination(dest)), file: d.path, doc: d, body: u8(d.content) }
      end
    end
    pages + docs
  end
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

glob(File.join(ROOT, "{_posts,_tools,_tags,_e2e,_projects,pages}", "**", "*.{md,markdown,html}"))
  .each { |f| check_front_matter(f) }

model = published_site = all_site = nil
check("Jekyll's model of the source tree loads from this site's bundle",
      "VERIFIER ENVIRONMENT: could not load Jekyll in-process from this site's Gemfile — run the " \
      "verifier from the repository root after `bundle install` (this is an environment " \
      "problem, not a content problem)") do
  published_site, all_site = SiteModel.load(ROOT, SITE)
  model = SiteModel.entries(published_site, SITE)
  true
end
model ||= []
now = Time.now
# A document Jekyll only builds when `future: true` and whose date is in (or
# within a day of) the future is not asserted either way: the build and this
# read ran at different moments.
deferred = lambda do |entry|
  doc = entry[:doc]
  !FUTURE_POSTS && doc && doc.data["date"] && doc.date > now - 86_400
end

# Built file -> every source entry Jekyll writes there. More than one claimant
# is a URL conflict Jekyll resolves by writing twice; such a file keeps only
# its existence check, since which source "won" is not ours to predict.
CLAIMS = Hash.new { |h, k| h[k] = [] }
model.each { |e| CLAIMS[e[:dest]] << e }
def claimants(file)
  CLAIMS.fetch(u8(file), [])
end

def source_note(file)
  list = claimants(file)
  list.empty? ? "" : " (source: #{list.map { |e| e[:src] }.join(', ')})"
end

static_dests = published_site ? published_site.static_files.map { |s| u8(s.destination(SITE)) } : []

# Pages this site renders itself. `admin/` is gem-delivered Decap machinery,
# `assets/` holds vendored standalone apps (their own <head>), and a static
# file Jekyll copied verbatim was never rendered; none of those carry the site
# chrome these assertions are about.
site_pages = glob(File.join(SITE, "**", "*.html")).reject do |f|
  rel = f.delete_prefix("#{SITE}/")
  rel.start_with?("admin/", "assets/") || static_dests.include?(f)
end
check("the build rendered site pages to check (#{site_pages.size} found)",
      "MISSING PAGES: _site has no rendered HTML pages — the build produced nothing to verify") do
  !site_pages.empty?
end

# --------------------------------------------------------------------------
section "every page and document Jekyll reads is built; unpublished ones are not"
check("Jekyll reads a home page at /",
      "MISSING SOURCE: Jekyll reads no page at / — index.html (the home page) is missing or excluded") do
  model.any? { |e| e[:kind] == :page && e[:url] == "/" }
end
model.each do |entry|
  next if deferred.call(entry)

  noun = entry[:kind] == :page ? "PAGE" : entry[:kind].to_s.upcase.sub(/S\z/, "")
  check("#{entry[:src]} is built at #{entry[:url]}",
        "MISSING #{noun}: #{entry[:src]} is published but its output #{rel_path(entry[:dest])} " \
        "(#{entry[:url]}) is not in _site — check the build log") { File.file?(entry[:dest]) }
end
if all_site
  published_srcs = model.map { |e| e[:src] }
  owned = CLAIMS.keys + static_dests
  SiteModel.entries(all_site, SITE).each do |entry|
    next if published_srcs.include?(entry[:src]) || deferred.call(entry)
    next if owned.include?(entry[:dest]) # another source (or a static file) writes this file
    # Generator output Jekyll never "reads": an unpublished document pointed at
    # one of these URLs is not something this script can attribute.
    next if rel_path(entry[:dest]).match?(%r{\A_site/(admin|tags)/|\A_site/(feed|sitemap)\.xml\z|\A_site/robots\.txt\z})

    check("#{entry[:src]} is `published: false` and is NOT built at #{entry[:url]}",
          "UNPUBLISHED BUT BUILT: #{entry[:src]} is `published: false` yet #{rel_path(entry[:dest])} " \
          "exists — something other than this file is producing it") { !File.exist?(entry[:dest]) }
  end
end

posts = model.select { |e| e[:kind] == :posts }
fixture_posts = posts.select { |p| fixture_post?(p[:doc]) }
public_posts = posts.reject { |p| fixture_posts.include?(p) || deferred.call(p) }
puts "  (#{posts.size} published posts: #{public_posts.size} public, #{fixture_posts.size} test fixtures)"

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
section "tools: every tool is listed and embeds a vendored app that exists"
tools_index = read(File.join(SITE, "tools", "index.html")).to_s
tools_index_links = tags(tools_index, "a").map { |a| norm(site_path(a["href"].to_s)) }
# Targets already reported by a more specific assertion; the generic link scan
# below does not repeat them.
reported_missing = []
model.select { |e| e[:kind] == :tools }.each do |tool|
  url = tool[:url]
  rel = tool[:src]
  check("/tools/ lists #{url}",
        "TOOLS LIST: /tools/ does not link to #{url} (#{rel}) — check tools/index.html and " \
        "the tool's front matter") { tools_index_links.include?(norm(url)) }
  embed = tool[:data]["embed_src"].to_s.strip
  # The tool layout prints it through `relative_url`, which roots a relative path.
  embed = "/#{embed}" unless embed.empty? || embed.start_with?("/") || embed.match?(%r{\A([a-z][a-z0-9+.-]*:|//)}i)
  next if embed.empty? || !File.file?(tool[:dest]) || claimants(tool[:dest]).size > 1

  iframes = tags(read(tool[:dest]), "iframe").map { |i| norm(site_path(i["src"].to_s)) }
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
section "SEO: every site page has a <title>, its own canonical URL and Open Graph tags"
# A page whose effective layout (front matter or `_config.yml` default, as
# Jekyll resolved it) is none is standalone HTML the author owns; it is not
# held to the layout's <head> contract. So is a generated page whose source
# this script cannot see only when it is one of the gem's admin pages, which
# `site_pages` already skips.
def standalone?(entry)
  layout = entry[:data]["layout"]
  layout.nil? || layout == false || %w[none null].include?(layout.to_s.strip.downcase)
end

site_pages.each do |file|
  owners = claimants(file)
  next if owners.size > 1 || owners.any? { |e| standalone?(e) }

  owner = owners.first
  html = read(file)
  built = rel_path(file)
  check("#{built}: has a <title> element",
        "TITLE: #{built} has no <title> element#{source_note(file)} — the layout's {% seo %} " \
        "tag (or <title>) did not render") { html.match?(/<title\b[^>]*>/i) }

  canonicals = tags(html, "link").select { |l| l["rel"].to_s.downcase.split.include?("canonical") }
                                 .map { |l| norm(l["href"].to_s) }
  og = tags(html, "meta").to_h { |m| [m["property"].to_s, m["content"].to_s] }
  custom = owner && owner[:data]["canonical_url"].to_s.strip
  expected =
    if custom && !custom.empty?
      # jekyll-seo-tag prints `canonical_url:` as given; nothing to predict.
      [norm(custom), norm("#{SITE_URL}#{custom}")]
    else
      [owner && owner[:url], url_path_of(file)].compact
                                               .map { |p| norm("#{SITE_URL}#{p.sub(%r{/index\.html\z}, '/')}") }
    end
  check("#{built}: exactly one canonical link, pointing at #{expected.first}",
        -> { "canonical: expected #{expected.first}, found #{canonicals.inspect} in #{built}#{source_note(file)}" }) do
    canonicals.size == 1 && expected.include?(canonicals.first)
  end
  check("#{built}: og:title is set and og:url matches the canonical URL",
        -> { "og: expected og:title to be set and og:url to equal the canonical link " \
             "#{canonicals.first.inspect}, found og:title=#{og['og:title'].to_s.inspect} " \
             "og:url=#{og['og:url'].to_s.inspect} in #{built}#{source_note(file)}" }) do
    !og["og:title"].to_s.strip.empty? && canonicals.size == 1 && norm(og["og:url"].to_s) == canonicals.first
  end
end

# --------------------------------------------------------------------------
section "post bodies: a post with prose renders it"
# Narrow on purpose. Only a post on the gem's `post` layout whose body has a
# line starting with a letter, and nothing that can make text vanish (Liquid,
# braces/kramdown extensions, HTML comments, script/style/template/textarea),
# is asserted — kramdown always renders such a line as visible text. Empty
# bodies, image-only posts and custom layouts are not asserted.
public_posts.each do |post|
  next unless post[:data]["layout"] == "post" && File.file?(post[:dest]) && claimants(post[:dest]).size == 1

  body = post[:body].to_s
  next unless body.match?(/^[ \t]*[A-Za-z]/)
  next if body.match?(/[{}]|<!--|<\s*(script|style|template|textarea)\b/i)

  inner = div_inner(read(post[:dest]), "post-content")
  next if inner.nil? # a layout without the gem's post-content block: nothing to measure

  check("#{post[:url]} renders its body (#{post[:src]})",
        "POST BODY: #{post[:src]} has text but the post-content block of #{post[:url]} is empty — " \
        "the post layout dropped `{{ content }}`") { clean_html(inner).match?(/\S/) }
end

blog = model.find { |e| e[:kind] == :page && e[:url] == "/blog/" }
if blog && File.file?(blog[:dest]) && claimants(blog[:dest]).size == 1
  # Posts any /blog/ template keeps: explicitly `published: true` and not
  # feed-excluded (a subset of what blog/index.html's filters admit).
  listed = public_posts.select { |p| p[:data]["published"] == true && p[:data]["feed_exclude"] != true }
  unless listed.empty?
    hrefs = tags(read(blog[:dest]), "a").map { |a| norm(site_path(a["href"].to_s)) }
    check("/blog/ links to at least one of the #{listed.size} published posts",
          "BLOG LIST: /blog/ links to none of the #{listed.size} published posts — the post list " \
          "in blog/index.html did not render") { listed.any? { |p| hrefs.include?(norm(p[:url])) } }
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
page_links = Hash.new { |h, k| h[k] = [] }
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
      next unless resolved

      link_refs[resolved] << file
      page_links[file] << norm(resolved)
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
# The rule never compares rendered text with source text (Markdown rewrites
# text: a pipe becomes a table, `_x_` becomes <em>, `&#123;` decodes). A
# built page is flagged when it contains `{{` or `{%` outside <pre>/<code>/
# <textarea> AND no authored text it could have printed contains a brace in
# any spelling:
#   * site data (`_data/**`, `_config.yml`) — rendered everywhere;
#   * its own source: any brace at all for a plain source; for a source that
#     is itself a Liquid template, a brace that can survive rendering;
#   * for a plain source (no Liquid of its own), every collection document it
#     links to; for a template page, a generated page (no source) or a URL
#     conflict, EVERY collection document and page front matter, since a
#     template can print any of them.
# A layout or include that leaks Liquid leaks it into every page that uses it,
# and plain posts and tool pages almost always qualify, so the leak is caught.
#
# RESIDUAL BLIND SPOT: a leak is missed on every page that is exempt — every
# template/listing/feed/sitemap page while ANY post, tool, tag or page front
# matter contains a brace, and every page at all while site data does — so a
# leak confined to such pages (e.g. a listing-only include) goes unreported.
authored_files = (published_site ? published_site.collections.values.flat_map { |c| glob(File.join(c.directory, "**", "*")) } : [])
                 .select { |f| File.file?(f) }
data_brace = (glob(File.join(ROOT, "_data", "**", "*")) + [File.join(ROOT, "_config.yml")])
             .any? { |f| File.file?(f) && read(f).to_s.match?(BRACE_MARKER) }
doc_brace_by_url = {}
model.reject { |e| e[:kind] == :page }.each do |e|
  doc_brace_by_url[norm(e[:url])] = true if read(e[:file]).to_s.match?(BRACE_MARKER)
end
any_authored_brace = authored_files.any? { |f| read(f).to_s.match?(BRACE_MARKER) } ||
                     model.any? { |e| e[:kind] == :page && entry_parts(e)[0].match?(BRACE_MARKER) }

liquid_exempt = lambda do |file|
  next true if data_brace

  owners = claimants(file)
  parts = owners.map { |e| [e, *entry_parts(e)] }
  template = owners.size != 1 || parts.any? { |_, _, body| liquid_template?(body) }
  next true if parts.any? do |e, front, body|
    liquid_template?(body) ? template_brace?(front, body, e[:data]) : "#{front}#{body}".match?(BRACE_MARKER)
  end
  next any_authored_brace if template

  page_links[file].any? { |url| doc_brace_by_url[url] }
end
LIQUID_TOKEN = /\{\{.{0,60}?\}\}|\{%.{0,60}?%\}|\{[{%].{0,40}/m.freeze
site_pages.each do |file|
  next if liquid_exempt.call(file)

  scrubbed = clean_html(read(file)).gsub(%r{<(pre|code|textarea)\b.*?</\1>}mi, "")
  found = scrubbed[LIQUID_TOKEN]
  built = rel_path(file)
  check("#{built} has no unresolved Liquid",
        -> { "UNRESOLVED LIQUID: #{built} contains #{found.to_s.lines.first.to_s.strip.inspect}" \
             "#{source_note(file)}, which no authored text on that page contains — a layout or " \
             "include emitted it without rendering; fix the template that produces it" }) { found.nil? }
end
# robots.txt prints only site data; the sitemap and the feed print every
# post's URL/title, so they follow the template rule.
robots_entry = model.find { |e| e[:url] == "/robots.txt" }
robots_exempt = data_brace || (robots_entry && template_brace?(*entry_parts(robots_entry), robots_entry[:data]))
{ "robots.txt" => robots_exempt, "sitemap.xml" => data_brace || any_authored_brace }.each do |name, exempt|
  next if exempt

  found = read(File.join(SITE, name)).to_s[LIQUID_TOKEN]
  check("#{name} has no unresolved Liquid",
        "UNRESOLVED LIQUID: _site/#{name} contains #{found.to_s.lines.first.to_s.strip.inspect} — " \
        "its template did not render") { found.nil? }
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
# An entry's title is the post's own `title:`, which may legitimately be
# empty; only the id (the post URL) is required.
entries.each_with_index do |e, i|
  id = REXML::XPath.first(e, "a:id", "a" => ATOM)&.text.to_s
  check("feed entry #{i + 1} has an id (#{id.inspect})",
        "FEED ENTRY: feed.xml entry #{i + 1} has no <id> — the feed template did not render it") do
    !id.strip.empty?
  end
end
if feed_root && !(data_brace || any_authored_brace)
  found = feed_chrome_strings(feed_root).join("\n")[LIQUID_TOKEN]
  check("feed.xml has no unresolved Liquid outside post bodies",
        "UNRESOLVED LIQUID: feed.xml contains #{found.to_s.lines.first.to_s.strip.inspect} outside " \
        "post bodies — the feed template did not render") { found.nil? }
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
        "`feed_exclude: true` (the platform gem stamps it on `e2e-` post files)") do
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
# Front matter (as Jekyll resolved it) decides what a post's sitemap entry
# must be: public posts are listed; `sitemap: false` posts must be ABSENT; a
# noindex `robots` value alone changes neither (jekyll-sitemap does not read
# `robots`), so it is not asserted.
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
    next if claimants(file).include?(post) # the fixture IS this page (a URL conflict)

    hrefs = tags(read(file), "a").map { |a| norm(a["href"].to_s) }
    check("fixture #{post[:src]} is not linked from #{url_path_of(file)}",
          "FIXTURE LEAK: test fixture #{post[:src]} is linked from #{url_path_of(file)} — " \
          "listing templates must skip `feed_exclude` posts") do
      !hrefs.include?(relative) && !hrefs.include?(absolute)
    end
  end
end
model.select { |e| e[:kind] == :e2e }.each do |canary|
  next unless File.file?(canary[:dest]) && claimants(canary[:dest]).size == 1

  check("#{canary[:src]} canary page is noindex",
        "CANARY: #{canary[:url]} (#{canary[:src]}) is not noindex — e2e canaries must carry a " \
        "robots noindex meta") { noindex?(read(canary[:dest])) }
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
      out, status = Open3.capture2e("git", "-C", ROOT, "remote", "get-url", "origin")
      status.success? ? out.strip : ""
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
