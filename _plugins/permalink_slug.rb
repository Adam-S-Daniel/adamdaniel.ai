# Maps a `permalink_slug:` front matter key to Jekyll's built-in `slug:` so the
# global `permalink: /blog/:slug/` template still works. The field is named
# `permalink_slug` (not `slug`) to avoid a Sveltia/Decap CMS name collision
# where `{{fields.slug}}` is shadowed by the built-in slug template tag and
# silently falls back to the title.
module Jekyll
  Hooks.register :posts, :post_init do |post|
    if post.data["permalink_slug"] && !post.data.key?("slug")
      post.data["slug"] = post.data["permalink_slug"]
    end
  end
end
