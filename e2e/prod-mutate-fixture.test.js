// @lane: local — pure builders for the ephemeral prod-loop posts (#1771 step 4)
const { test, expect } = require("./base");
const { readPublishedFlag, splitFrontMatter } = require("./fixture-baseline");
const {
  EPHEMERAL_DATE,
  PROD_MUTATE_SLUG_PREFIX,
  MEDIA_ROUNDTRIP_SLUG_PREFIX,
  buildProdMutatePost,
  buildMediaRoundtripPost,
  composePost,
} = require("./prod-mutate-fixture");

test.describe("ephemeral prod-loop post builders (#1771 step 4)", () => {
  test("buildProdMutatePost is a pure function of runId (unique path/slug/url)", () => {
    const a = buildProdMutatePost({ runId: 1779999999999 });
    expect(a.slug).toBe(`${PROD_MUTATE_SLUG_PREFIX}-1779999999999`);
    expect(a.filePath).toBe(`_posts/${EPHEMERAL_DATE}-${PROD_MUTATE_SLUG_PREFIX}-1779999999999.md`);
    expect(a.publicPath).toBe(`/blog/${PROD_MUTATE_SLUG_PREFIX}-1779999999999/`);
    expect(a.title).toBe("E2E Prod Mutate 1779999999999");
    expect(a.marker).toBe(`${PROD_MUTATE_SLUG_PREFIX}:1779999999999`);

    // Distinct runIds never collide on a path (no shared mutable cell).
    const b = buildProdMutatePost({ runId: 1779999999998 });
    expect(b.filePath).not.toBe(a.filePath);
  });

  test("buildMediaRoundtripPost mirrors the shape with its own prefix", () => {
    const m = buildMediaRoundtripPost({ runId: 42 });
    expect(m.slug).toBe(`${MEDIA_ROUNDTRIP_SLUG_PREFIX}-42`);
    expect(m.filePath).toBe(`_posts/${EPHEMERAL_DATE}-${MEDIA_ROUNDTRIP_SLUG_PREFIX}-42.md`);
    expect(m.publicPath).toBe(`/blog/${MEDIA_ROUNDTRIP_SLUG_PREFIX}-42/`);
    expect(m.marker).toBe(`${MEDIA_ROUNDTRIP_SLUG_PREFIX}:42`);
  });

  test("the post is BORN published, noindex, sitemap:false, test_fixture", () => {
    for (const built of [
      buildProdMutatePost({ runId: 7 }),
      buildMediaRoundtripPost({ runId: 7 }),
    ]) {
      const { fileText } = built;
      // Born published — the loop CREATES a live post (it never toggles a
      // persistent file). #1771 step 4 inverts the resting state to 404.
      expect(readPublishedFlag(fileText)).toBe(true);
      expect(fileText).toMatch(/^robots: noindex,nofollow$/m);
      expect(fileText).toMatch(/^sitemap: false$/m);
      expect(fileText).toMatch(/^test_fixture: true$/m);
      expect(fileText).toMatch(/^date: 2099-12-31 /m);
    }
  });

  test("the runId marker is in BOTH the slug and the body (survives Slate)", () => {
    const built = buildProdMutatePost({ runId: 123456 });
    expect(built.slug).toContain("123456");
    expect(built.body).toContain(built.marker);
    expect(built.fileText).toContain(built.marker);
  });

  test("fileText round-trips through splitFrontMatter (well-formed front matter)", () => {
    const built = buildProdMutatePost({ runId: 99 });
    const { frontMatter, body } = splitFrontMatter(built.fileText, built.filePath);
    expect(frontMatter.startsWith("---")).toBe(true);
    // body keeps the leading "\n---\n" the helper slices in.
    expect(body.startsWith("\n---\n")).toBe(true);
  });

  test("composePost quotes a featured image path and leaves it empty by default", () => {
    expect(composePost({ title: "T", slug: "s", body: "b\n" })).toContain('featured_image: ""');
    const withImg = composePost({
      title: "T",
      slug: "s",
      body: "b\n",
      featuredImage: "/assets/images/uploads/x.png",
    });
    expect(withImg).toContain('featured_image: "/assets/images/uploads/x.png"');
  });

  test("missing runId throws loudly (no silent shared path)", () => {
    expect(() => buildProdMutatePost({})).toThrow(/requires a runId/);
    expect(() => buildMediaRoundtripPost({})).toThrow(/requires a runId/);
  });
});
