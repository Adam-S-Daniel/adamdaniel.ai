source "https://rubygems.org"

gem "jekyll", "~> 4.3"
gem "webrick"

group :jekyll_plugins do
  gem "jekyll-seo-tag"
  gem "jekyll-feed"
  gem "jekyll-sitemap"
end

# Lint-only tooling for the Ruby in _plugins/ and _plugins_test/. In the
# development group so it never ships to the runtime/build bundle.
group :development do
  gem "rubocop", "~> 1.86"
  gem "rubocop-performance", "~> 1.26"
end
