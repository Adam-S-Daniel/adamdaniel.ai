source "https://rubygems.org"

gem "jekyll", "~> 4.3"
gem "webrick"

group :jekyll_plugins do
  gem "jekyll-seo-tag"
  gem "jekyll-feed"
  gem "jekyll-sitemap"
  # cms-platform theme. Pinned at the dogfood SHA (kept in lockstep with
  # platform.lock); a later step repins to the v0.1.0 release tag.
  gem "cms-platform-theme", git: "https://github.com/Adam-S-Daniel/cms-platform", glob: "theme/*.gemspec", ref: "ccedd3c26a5f9c61e6da1cac2327f32f43c4d9f7"
end
