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
  gem "cms-platform-theme", git: "https://github.com/Adam-S-Daniel/cms-platform", glob: "theme/*.gemspec", ref: "e0d772c22312cc6585d0b4f70de8bc22d0f18368"
end
