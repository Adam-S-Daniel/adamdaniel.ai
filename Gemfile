source "https://rubygems.org"

gem "jekyll", "~> 4.3"
gem "webrick"

group :jekyll_plugins do
  gem "jekyll-seo-tag"
  gem "jekyll-feed"
  gem "jekyll-sitemap"
  # cms-platform theme (ships layouts/includes/assets/plugins + the Decap
  # render hook + the admin/ UI as of v0.1.4). Kept in lockstep with
  # platform.lock; Dependabot bumps the tag.
  gem "cms-platform-theme", git: "https://github.com/Adam-S-Daniel/cms-platform", glob: "theme/*.gemspec", tag: "v0.1.44"
end
