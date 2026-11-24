source "https://rubygems.org"

gem "jekyll", "~> 4.3"
gem "webrick"

group :jekyll_plugins do
  gem "jekyll-seo-tag"
  gem "jekyll-feed"
  gem "jekyll-sitemap"
  # cms-platform theme (ships layouts/includes/assets/plugins + the Decap
  # render hook + the admin/ UI as of v0.1.4). Kept in lockstep with
  # platform.lock; platform-bump.yml bumps the tag (Dependabot is set to
  # ignore this gem — see .github/dependabot.yml, cms-platform#242).
  gem "cms-platform-theme", git: "https://github.com/Adam-S-Daniel/cms-platform", glob: "theme/*.gemspec", ref: "c120db5cdd40181b50a2f029874546cc50e90733"
end
