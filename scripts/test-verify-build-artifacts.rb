#!/usr/bin/env ruby
# frozen_string_literal: true

# Regression matrix for scripts/verify-build-artifacts.rb.
#
#   bundle exec ruby scripts/test-verify-build-artifacts.rb [name-substring]
#
# Needs the site's gems (it runs `bundle exec jekyll build`); no network, no
# wall clock (dates are far in the past or far in the future), nothing written
# outside a temp directory. There is no CI lane for it: the repo vendors no
# Ruby test runner and `site-verify` itself runs only the verifier, so run this
# whenever the verifier changes (it takes about a minute).
#
# Two kinds of case, each applied one at a time to a scratch copy of the site:
#
# * LEGITIMATE edits (`ok`): ordinary things an author, the CMS or a bot does.
#   The required check must stay GREEN on every one. A failure here means the
#   verifier is brittle.
# * NEGATIVE controls (`bad`): real defects. The verifier must exit non-zero
#   with the expected plain-English message and never with a Ruby backtrace.
#
# Exit 0 only when every case behaves as declared.

require "fileutils"
require "open3"
require "tmpdir"

ROOT = File.expand_path("..", __dir__)
# VERIFY_SCRIPT points the matrix at another copy of the verifier (e.g. the previous version).
VERIFIER = ENV.fetch("VERIFY_SCRIPT", File.join(ROOT, "scripts", "verify-build-artifacts.rb"))
COPY = %w[_config.yml _data _includes _layouts _posts _tags _tools _e2e admin assets blog pages
          projects tags tools index.html 404.html robots.txt feed.xml preview.md Gemfile
          Gemfile.lock platform.lock].freeze
BUNDLE_ENV = { "BUNDLE_GEMFILE" => File.join(ROOT, "Gemfile"), "JEKYLL_ENV" => "production" }.freeze

CASES = []

def write(dir, path, content)
  full = File.join(dir, path)
  FileUtils.mkdir_p(File.dirname(full))
  File.write(full, content)
end

def post(dir, name, front, body = "Body text.\n")
  front = { "title" => "A post" }.merge(front)
  yaml = front.map { |k, v| "#{k}: #{v}" }.join("\n")
  write(dir, "_posts/#{name}", "---\n#{yaml}\n---\n#{body}")
end

def page(dir, name, front, body = "Page body.\n")
  yaml = { "layout" => "page", "title" => "A page" }.merge(front).map { |k, v| "#{k}: #{v}" }.join("\n")
  write(dir, "pages/#{name}", "---\n#{yaml}\n---\n#{body}")
end

def tool(dir, name, front, body = "Tool body.\n")
  yaml = { "title" => "A tool" }.merge(front).map { |k, v| "#{k}: #{v}" }.join("\n")
  write(dir, "_tools/#{name}", "---\n#{yaml}\n---\n#{body}")
end

def ok(name, env: {}, site: nil, &edit)
  CASES << { name: name, kind: :ok, edit: edit, env: env, site: site }
end

# `expect` is a Regexp (or Array of them) every one of which must match the output.
def bad(name, expect, site: nil, &edit)
  CASES << { name: name, kind: :bad, edit: edit, expect: Array(expect), site: site }
end

# --------------------------------------------------------------------------
# LEGITIMATE edits — every one must pass.
ok("baseline: the real tree, untouched") { |_d| }
ok("a post with no tags") { |d| post(d, "2026-10-05-no-tags.md", {}) }
ok("a future-dated published post (future: true)") do |d|
  post(d, "2099-01-01-from-the-future.md", { "title" => "Future" })
end
ok("a future-dated post when _config.yml has future: false") do |d|
  write(d, "_config.yml", File.read(File.join(d, "_config.yml")).sub(/^future: true$/, "future: false"))
  post(d, "2099-01-01-from-the-future.md", { "title" => "Future" })
end
ok("published: false post") { |d| post(d, "2026-10-05-hidden.md", { "published" => "false" }) }
ok("a _drafts draft") do |d|
  write(d, "_drafts/a-draft.md", "---\ntitle: Draft\n---\nNot yet.\n")
end
ok("title with quotes, colon, emoji and non-ASCII") do |d|
  post(d, "2026-10-05-weird-title.md",
       { "title" => %q("He said: \"Café ☕ 日本語 — it's fine\"") })
end
ok("non-ASCII slug in the file name") do |d|
  post(d, "2026-10-05-café-日本語.md", { "title" => "Café" }, "See [home](/).\n")
end
ok("non-ASCII slug, C locale", env: { "LC_ALL" => "C", "LANG" => "C" }) do |d|
  post(d, "2026-10-05-café-日本語.md", { "title" => "Café" })
end
ok("an explicit non-ASCII slug: in front matter") do |d|
  post(d, "2026-10-05-plain.md", { "slug" => "Ünïcode Slug" })
end
ok("tag Café (post tag + _tags entry)") do |d|
  post(d, "2026-10-05-tagged.md", { "tags" => "[Café]" })
  write(d, "_tags/café.md", "---\nname: Café\ndescription: Coffee things\n---\n")
end
ok("new tag with spaces and capitals") do |d|
  post(d, "2026-10-05-tagged.md", { "tags" => "[Big Data Things, GitHub Actions]" })
end
ok("page with a custom permalink and trailing slash") do |d|
  page(d, "custom.md", { "permalink" => "/custom/path/" })
end
ok("page with a custom permalink WITHOUT trailing slash") do |d|
  page(d, "custom.md", { "permalink" => "/custom/nodir" })
end
ok("page with permalink /custom/path.html") do |d|
  page(d, "custom.md", { "permalink" => "/custom/path.html" })
end
ok("pages/*.md with no permalink") { |d| page(d, "nolink.md", {}) }
ok("post with a custom permalink (with slash, and .html)") do |d|
  post(d, "2026-10-05-p1.md", { "permalink" => "/blog/custom-one/" })
  post(d, "2026-10-05-p2.md", { "permalink" => "/blog/custom-two.html" })
end
ok("_posts file with no date prefix (Jekyll ignores it)") do |d|
  write(d, "_posts/undated.md", "---\ntitle: Undated\n---\nIgnored by Jekyll.\n")
end
ok("a post whose slug is E2E-Upper (gem rule is case-sensitive: NOT a fixture)") do |d|
  post(d, "2026-10-06-E2E-Upper.md", { "title" => "Upper" })
end
ok("inline {% raw %}{{ x }}{% endraw %} in prose") do |d|
  post(d, "2026-10-05-raw.md", {}, "Use {% raw %}${{ secrets.GITHUB_TOKEN }}{% endraw %} in a step.\n")
end
ok("inline raw Liquid in a table cell") do |d|
  post(d, "2026-10-05-table.md", {},
       "| a | b |\n|---|---|\n| {% raw %}{{ github.sha }}{% endraw %} | x |\n")
end
ok("a fenced ${{ }} block as the first content (leaks into the description)") do |d|
  post(d, "2026-10-05-fenced.md", {},
       "```yaml\nenv:\n  TOKEN: ${{ secrets.GITHUB_TOKEN }}\n```\n\nAfter.\n")
end
ok("a title containing {{") do |d|
  post(d, "2026-10-05-braces.md", { "title" => %q("Why {{ matrix.os }} matters") })
end
ok("an excerpt containing {{") do |d|
  post(d, "2026-10-05-excerpt.md", { "excerpt" => %q("Use ${{ env.X }} wisely") })
end
ok("relative link to a static asset") do |d|
  write(d, "assets/files/note.txt", "hello\n")
  post(d, "2026-10-05-asset.md", {}, "[note](../../assets/files/note.txt) and [abs](/assets/files/note.txt)\n")
end
ok("anchor-only, mailto:, query-string, external links and an external iframe") do |d|
  post(d, "2026-10-05-links.md", {},
       "[a](#top) [m](mailto:a@example.com) [q](/blog/?page=2) [e](https://example.com/x)\n\n" \
       "<iframe src=\"https://example.com/embed\"></iframe>\n")
end
ok("a post with `sitemap: false`") { |d| post(d, "2026-10-05-nosm.md", { "sitemap" => "false" }) }
ok("a post with a noindex robots value (any case)") do |d|
  post(d, "2026-10-05-noidx.md", { "robots" => "NoIndex,nofollow" })
end
ok("a page with a noindex robots value") { |d| page(d, "noidx.md", { "robots" => "noindex" }) }
ok("an HTML comment holding a broken link, and an unquoted-attribute link") do |d|
  post(d, "2026-10-05-comment.md", {},
       "<!-- [gone](/nowhere/) -->\n\n<a href=/blog/>unquoted</a>\n")
end
ok("a standalone page (layout: null) with its own markup") do |d|
  write(d, "standalone.html", "---\nlayout: null\ntitle: Raw\n---\n<!doctype html><html><body>" \
                              "<a href=\"/blog/\">raw</a></body></html>\n")
end
ok("new tool, featured: true") { |d| tool(d, "t-true.md", { "featured" => "true" }) }
ok("new tool, featured: false") { |d| tool(d, "t-false.md", { "featured" => "false" }) }
ok("new tool, no featured: key (must be LISTED on /tools/)") { |d| tool(d, "t-absent.md", {}) }
ok("tool with an embedded vendored app (iframe)") do |d|
  write(d, "assets/tools/demo/index.html", "<!doctype html><title>Demo</title><p>demo</p>\n")
  tool(d, "demo.md", { "embed_src" => "/assets/tools/demo/" })
end
ok("tool with an external embed") do |d|
  tool(d, "ext.md", { "embed_src" => "https://example.com/app/" })
end
ok("image-only post") do |d|
  post(d, "2026-10-05-image.md", {}, "![logo](/assets/images/logo.svg)\n")
end
ok("the last public post is unpublished") do |d|
  Dir.glob(File.join(d, "_posts", "*.md")).each do |f|
    File.write(f, File.read(f).sub(/\A---\n/, "---\npublished: false\n"))
  end
end
ok("the last public post is deleted") do |d|
  Dir.glob(File.join(d, "_posts", "*.md")).each { |f| File.delete(f) }
end
# Review round 3.
ok("_posts emptied entirely (directory removed)") { |d| FileUtils.rm_rf(File.join(d, "_posts")) }
ok("every post future-dated while _config.yml has future: false") do |d|
  write(d, "_config.yml", File.read(File.join(d, "_config.yml")).sub(/^future: true$/, "future: false"))
  Dir.glob(File.join(d, "_posts", "*.md")).each { |f| File.delete(f) }
  post(d, "2099-01-01-later-one.md", { "title" => "Later one" })
  post(d, "2099-02-01-later-two.md", { "title" => "Later two" })
end
ok("front matter with a Ruby object tag (Jekyll's loader rejects it, the build still succeeds)") do |d|
  post(d, "2026-10-05-a.md", { "x" => "!ruby/object:OpenStruct {}" })
end
ok("front matter with a !!binary value") { |d| post(d, "2026-10-05-bin.md", { "blob" => "!!binary aGVsbG8=" }) }
ok("front matter with an anchor and alias") do |d|
  write(d, "_posts/2026-10-05-alias.md", "---\ntitle: &t Aliased\nog_title: *t\n---\nBody.\n")
end
ok("front matter with a date-typed key") do |d|
  write(d, "_posts/2026-10-05-datekey.md", "---\ntitle: Date key\n2026-01-01: new year\n---\nBody.\n")
end
ok("front matter with a very large integer") do |d|
  post(d, "2026-10-05-bigint.md", { "big" => "123456789012345678901234567890123456789" })
end
ok("front matter with duplicate keys") do |d|
  write(d, "_posts/2026-10-05-dup.md", "---\ntitle: First\ntitle: Second\n---\nBody.\n")
end
ok("a relative canonical_url: /elsewhere/") do |d|
  post(d, "2026-10-05-relcanon.md", { "canonical_url" => "/elsewhere/" })
end
# Review round 2: each of these turned the round-1 verifier red.
ok("Liquid shown in prose with a pipe (kramdown turns it into a table)") do |d|
  post(d, "2026-10-05-pipe.md", {},
       "Use the filter {% raw %}{{ page.title | escape }}{% endraw %} to escape output.\n")
end
ok("Liquid shown in prose with underscore emphasis inside") do |d|
  post(d, "2026-10-05-emph.md", {}, "Write {% raw %}{{ _foo_ }}{% endraw %} for that.\n")
end
ok("entity-escaped braces in prose") do |d|
  post(d, "2026-10-05-entity.md", {}, "Type &#123;&#123; page.title }} to print the title.\n")
end
ok("a lone {{{ shown in prose") do |d|
  post(d, "2026-10-05-triple.md", {}, "Type {% raw %}{{{% endraw %} to open a tag.\n")
end
ok("a published post with test_fixture: true (not a fixture to the gem: filename rule only)") do |d|
  post(d, "2026-10-05-flagged.md", { "test_fixture" => "true" })
end
ok("a published post with slug: e2e-thing (not a fixture to the gem: filename rule only)") do |d|
  post(d, "2026-10-05-slugged.md", { "slug" => "e2e-thing" })
end
ok("root pages whose names start with an excluded entry (docs2.md, docs2/index.html)") do |d|
  write(d, "docs2.md", "---\nlayout: page\ntitle: Docs two\n---\nExcluded by Jekyll's prefix match.\n")
  write(d, "docs2/index.html", "---\nlayout: page\ntitle: Docs two index\n---\n<p>Also excluded.</p>\n")
end
ok("canonical_url: in front matter (post and page)") do |d|
  post(d, "2026-10-05-canon.md", { "canonical_url" => "https://example.com/original/" })
  page(d, "canon.md", { "canonical_url" => "https://example.net/elsewhere/" })
end
ok("a post with title: ''") { |d| post(d, "2026-10-05-untitled.md", { "title" => "''" }) }
ok("a post whose file name is only an emoji after the date") do |d|
  post(d, "2026-10-05-🎉.md", { "title" => "Party" })
end
ok("a post with an empty body") { |d| post(d, "2026-10-05-empty.md", {}, "") }
ok("a root page with no layout key") do |d|
  write(d, "nolayout.html", "---\ntitle: No layout\n---\n<!doctype html><html><body><p>bare</p></body></html>\n")
end
ok("tool embed_src without a leading slash (relative_url adds it)") do |d|
  write(d, "assets/tools/rel/index.html", "<!doctype html><title>Rel</title><p>rel</p>\n")
  tool(d, "rel.md", { "embed_src" => "assets/tools/rel/" })
end
ok("front matter closed with `...` (Jekyll accepts it) on a post with an empty body") do |d|
  write(d, "_posts/2026-10-05-dots.md", "---\ntitle: Dots\nlayout: post\n...\n")
end
ok("invalid UTF-8 bytes in a built page do not crash the scan",
   site: ->(d) { File.open(File.join(d, "_site/blog/index.html"), "ab") { |f| f.write("\xFF\xFE".b) } }) do |d|
  post(d, "2026-10-05-bytes.md", {})
end

# --------------------------------------------------------------------------
# NEGATIVE controls — every one must fail loudly, in plain words, no backtrace.
bad("_site/sitemap.xml deleted", /MISSING FILE: _site\/sitemap\.xml was not built/,
    site: ->(d) { File.delete(File.join(d, "_site/sitemap.xml")) }) { |_d| }
bad("a nav target is gone", /NAV LINK: \/tools\/ in the main navigation is not built/,
    site: ->(d) { File.delete(File.join(d, "_site/tools/index.html")) }) { |_d| }
bad("an e2e- fixture post hand-added to feed.xml",
    /FIXTURE LEAK: test fixture _posts\/2026-10-05-e2e-fx\.md is listed in feed\.xml/,
    site: lambda { |d|
      feed = File.join(d, "_site/feed.xml")
      entry = '<entry><title>fx</title><id>https://adamdaniel.ai/blog/e2e-fx/</id>' \
              '<link rel="alternate" href="https://adamdaniel.ai/blog/e2e-fx/"/></entry>'
      File.write(feed, File.read(feed).sub("</feed>", "#{entry}</feed>"))
    }) { |d| post(d, "2026-10-05-e2e-fx.md", {}) }
bad("an empty _site/admin/config.yml", /ADMIN CONFIG: _site\/admin\/config\.yml is missing, empty/,
    site: ->(d) { File.write(File.join(d, "_site/admin/config.yml"), "") }) { |_d| }
bad("the Tools slug field loses its pattern (#4083)",
    /ADMIN CONFIG: the `slug` field of the Tools collection in admin\/collections\.site\.yml has no `pattern`/) do |d|
  seam = File.join(d, "admin/collections.site.yml")
  File.write(seam, File.read(seam).sub(/, pattern: \[.*?\] \}/, " }"))
end
bad("a link to a missing page",
    %r{BROKEN LINK: /nowhere/ is not built \(linked from /blog/lnk/ \(source: _posts/2026-10-05-lnk\.md\)}) do |d|
  post(d, "2026-10-05-lnk.md", {}, "[x](/nowhere/)\n")
end
bad("a literal unresolved {{ }} injected through a layout/include",
    /UNRESOLVED LIQUID: _site\/blog\/plain-words\/index\.html contains "\{\{ site\.nonexistent_thing \}\}"/) do |d|
  post(d, "2026-10-05-plain-words.md", {}, "Nothing but plain words here.\n")
  path = File.join(d, "_includes/header.html")
  File.write(path, "{% raw %}{{ site.nonexistent_thing }}{% endraw %}\n#{File.read(path)}")
end
bad("a literal unresolved {% %} injected through a tool layout",
    /UNRESOLVED LIQUID: _site\/tools\/plain-tool\/index\.html contains "\{% oops %\}"/) do |d|
  tool(d, "plain-tool.md", {}, "A plain tool description.\n")
  path = File.join(d, "_layouts/tool.html")
  File.write(path, File.read(path).sub(/^---\n.*?\n---\n/m) { |fm| "#{fm}{% raw %}{% oops %}{% endraw %}\n" })
end
bad("the post layout drops the post body",
    %r{POST BODY: _posts/2026-10-05-body-case\.md has text but the post-content block of /blog/body-case/ is empty}) do |d|
  post(d, "2026-10-05-body-case.md", {}, "A paragraph of ordinary words.\n")
  gem_layout = File.join(Gem.loaded_specs.fetch("cms-platform-theme").full_gem_path, "_layouts", "post.html")
  write(d, "_layouts/post.html", File.read(gem_layout).sub("{{ content }}", ""))
end
bad("/blog/ drops its post list",
    %r{BLOG LIST: /blog/ links to none of the \d+ published posts}) do |d|
  f = File.join(d, "blog/index.html")
  File.write(f, File.read(f).sub("{% for post in published_posts %}", "{% for post in published_posts limit: 0 %}"))
end
bad("<title> stripped from built HTML",
    %r{TITLE: _site/tools/index\.html has no <title> element},
    site: lambda { |d|
      f = File.join(d, "_site/tools/index.html")
      File.write(f, File.read(f).sub(%r{<title>.*?</title>}m, ""))
    }) { |_d| }
bad("corrupt XML in the feed is a FAIL line, not a backtrace",
    /FEED: _site\/feed\.xml is not a valid Atom feed.*_site\/feed\.xml is not well-formed XML/,
    site: ->(d) { f = File.join(d, "_site/feed.xml"); File.write(f, File.read(f).sub("</feed>", "")) }) { |_d| }
bad("corrupt YAML in the admin config",
    /ADMIN CONFIG: .*_site\/admin\/config\.yml is not valid YAML/,
    site: ->(d) { File.write(File.join(d, "_site/admin/config.yml"), "backend: [unclosed\n  x: : :\n") }) { |_d| }
bad("a wrong canonical",
    %r{canonical: expected https://adamdaniel\.ai/blog/, found \["https://adamdaniel\.ai/elsewhere/"\] in _site/blog/index\.html \(source: blog/index\.html\)},
    site: lambda { |d|
      f = File.join(d, "_site/blog/index.html")
      File.write(f, File.read(f).gsub(%r{(<link rel="canonical" href=")[^"]*}, '\1https://adamdaniel.ai/elsewhere/'))
    }) { |_d| }
bad("a public post missing from sitemap.xml",
    /SITEMAP: public post \/blog\/p\/ is missing from sitemap\.xml \(check its front matter for sitemap: false or a noindex robots value/,
    site: lambda { |d|
      f = File.join(d, "_site/sitemap.xml")
      File.write(f, File.read(f).gsub(%r{<url>\s*<loc>[^<]*/blog/p/</loc>.*?</url>}m, ""))
    }) { |d| post(d, "2026-10-05-p.md", {}) }
bad("front matter that is not valid YAML is a FAIL line naming the file",
    %r{BAD FRONT MATTER: _posts/2026-10-05-badyaml\.md is not valid YAML}) do |d|
  write(d, "_posts/2026-10-05-badyaml.md", "---\ntitle: Why: this breaks\ntags: [a\n---\nBody\n")
end
ok("collection permalink with :year/:month placeholders (site-wide `permalink:` edited)") do |d|
  write(d, "_config.yml", File.read(File.join(d, "_config.yml")).sub("permalink: /blog/:slug/", "permalink: /blog/:year/:slug/"))
end
bad("exclude: [_posts] in _config.yml makes every post vanish",
    /POSTS NOT READ: _posts\/ holds \d+ post file\(s\) but Jekyll read none of them.*`exclude`.*`include`.*`collections`/) do |d|
  write(d, "_config.yml", File.read(File.join(d, "_config.yml")).sub(/^exclude:\n/, "exclude:\n  - _posts\n"))
end
# The home page excerpts (and links) every recent post, so it is exempt while
# one of them has a brace in it; drop the one real post that does.
bad("unresolved Liquid leaking into the home page (no linked post has braces)",
    /UNRESOLVED LIQUID: _site\/index\.html contains "\{\{ home_leak \}\}"/) do |d|
  Dir.glob(File.join(d, "_posts", "*gha-bench*")).each { |f| File.delete(f) }
  write(d, "_includes/home-leak.html", "{% raw %}{{ home_leak }}{% endraw %}\n")
  f = File.join(d, "index.html")
  File.write(f, File.read(f).sub("</main>", "{% include home-leak.html %}\n</main>"))
end
bad("unresolved Liquid leaking into feed.xml chrome",
    /UNRESOLVED LIQUID: feed\.xml contains "\{\{ feed_leak \}\}"/) do |d|
  f = File.join(d, "feed.xml")
  File.write(f, File.read(f).sub(%r{<title[^>]*>}) { |t| "#{t}{% raw %}{{ feed_leak }}{% endraw %}" })
end
bad("a tool whose embedded app is missing is reported once",
    /TOOL EMBED: _tools\/gone\.md embeds \/assets\/tools\/gone\/ but that app is not built/) do |d|
  tool(d, "gone.md", { "embed_src" => "/assets/tools/gone/" })
end

# --------------------------------------------------------------------------
def run(cmd, env: {}, chdir: ROOT)
  out, status = Open3.capture2e(BUNDLE_ENV.merge(env), *cmd, chdir: chdir)
  [out, status]
end

def build_and_verify(scratch, base, env, site_hook)
  FileUtils.rm_rf(scratch)
  FileUtils.cp_r(base, scratch)
  yield scratch
  out, status = run(["bundle", "exec", "jekyll", "build", "--source", scratch, "--destination",
                     File.join(scratch, "_site"), "-q"])
  raise "jekyll build failed in the scratch copy:\n#{out}" unless status.success?

  site_hook&.call(scratch)
  run(["ruby", File.join(scratch, "scripts", "verify-build-artifacts.rb")], env: env, chdir: scratch)
end

filter = ARGV.first
results = []
Dir.mktmpdir("verify-matrix-") do |tmp|
  base = File.join(tmp, "base")
  FileUtils.mkdir_p(base)
  COPY.each { |p| FileUtils.cp_r(File.join(ROOT, p), File.join(base, p)) }
  FileUtils.mkdir_p(File.join(base, "scripts"))
  FileUtils.cp(VERIFIER, File.join(base, "scripts", "verify-build-artifacts.rb"))

  CASES.each_with_index do |c, i|
    next if filter && !c[:name].include?(filter)

    scratch = File.join(tmp, "case")
    out, status = build_and_verify(scratch, base, c[:env] || {}, c[:site]) { |d| c[:edit]&.call(d) }
    backtrace = out.match?(/\.rb:\d+:in [`']/) || out.include?("(RuntimeError)")
    fail_lines = out.lines.grep(/^  FAIL /)
    good =
      if c[:kind] == :ok
        status.success? && !backtrace && out.include?("build-artifact assertions passed")
      else
        !status.success? && !backtrace && !fail_lines.empty? &&
          c[:expect].all? { |re| out.match?(re) }
      end
    count = out[/All (\d+) build-artifact/, 1] || out[/(\d+) of (\d+) assertion/, 2]
    puts format("%-4s %-3d %s%s", good ? "PASS" : "FAIL", i + 1, c[:name],
                count ? " [#{count} assertions]" : "")
    unless good
      puts out.lines.grep(/FAIL|raised|\.rb:|passed/).first(8).map { |l| "       #{l}" }.join
    end
    results << good
  end
end

puts
passed = results.count(true)
puts "#{passed}/#{results.size} regression cases behaved as declared " \
     "(#{CASES.count { |c| c[:kind] == :ok }} legitimate edits must pass, " \
     "#{CASES.count { |c| c[:kind] == :bad }} negative controls must fail)."
exit(passed == results.size && !results.empty? ? 0 : 1)
