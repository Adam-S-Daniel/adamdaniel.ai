source "https://rubygems.org"

gem "jekyll", "~> 4.3"
gem "webrick"
gem "nokogiri", "1.19.4"

group :jekyll_plugins do
  gem "jekyll-seo-tag"
  gem "jekyll-feed"
  gem "jekyll-sitemap"
  # cms-platform theme (ships layouts/includes/assets/plugins + the Decap
  # render hook + the admin/ UI as of v0.1.4). Kept in lockstep with
  # platform.lock; platform-bump.yml bumps the tag (Dependabot is set to
  # ignore this gem — see .github/dependabot.yml, cms-platform#242).
  gem "cms-platform-theme", git: "https://github.com/Adam-S-Daniel/cms-platform", glob: "theme/*.gemspec", ref: "1fd78b6a14f98b8d051ddad6c750f9b20a48c9e5"
end
