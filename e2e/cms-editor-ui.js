/*
 * Shared Decap entry-editor UI interactions.
 *
 * Why this module exists (#1723 / PR #407):
 * The Published toggle and the Save → Ready → Publish flow were copy-
 * pasted into every CMS loop spec (cms-publish-loop-prod-mutate,
 * cms-unpublish-republish, cms-media-roundtrip, and the -preview
 * variants). Copies drift: one spec's cleanup leg still looked for the
 * Published widget as `getByRole("checkbox")` while the rest had moved to
 * `getByRole("switch")` (Decap renders it as a switch). That drift sat
 * latent until #1723's future-date fix let the prod-mutate cleanup run
 * for the first time — then it failed on the stale selector. Centralising
 * these interactions here (and lint-locking that specs don't hand-roll
 * them — see cms-editor-ui.test.js) keeps every caller in sync.
 *
 * Pure helpers over the caller's Playwright `page`; `expect` comes from
 * ./base so messages match the rest of the suite.
 */
const { expect } = require("./base");

// Decap's boolean Published widget is a SWITCH (role="switch"), NOT a
// checkbox; its state is exposed via aria-checked, not :checked. The
// accessible name is the field label "Published". `.first()` guards the
// rare double-mount during editor hydration.
function publishedSwitch(page) {
  return page.getByRole("switch", { name: /^Published$/i }).first();
}

// Toggle the Published switch to `on` (true ⇒ published, false ⇒ draft),
// idempotently — read aria-checked and only click when it must change,
// then assert the resulting state. Mirrors the proven pattern every
// publish/unpublish leg used by hand.
async function setPublished(page, on, { visibleTimeout = 30_000, settleTimeout = 5_000 } = {}) {
  const toggle = publishedSwitch(page);
  await expect(toggle, "Published switch should be visible").toBeVisible({
    timeout: visibleTimeout,
  });
  const want = on ? "true" : "false";
  if ((await toggle.getAttribute("aria-checked")) !== want) {
    await toggle.click();
  }
  await expect(toggle, `Published switch should be aria-checked=${want}`).toHaveAttribute(
    "aria-checked",
    want,
    { timeout: settleTimeout },
  );
}

// Assert (without toggling) the Published switch reflects `on`.
async function expectPublished(page, on, { timeout = 5_000 } = {}) {
  await expect(
    publishedSwitch(page),
    `Published switch should reflect ${on ? "published" : "draft"} (aria-checked=${on})`,
  ).toHaveAttribute("aria-checked", on ? "true" : "false", { timeout });
}

// Click Save and wait for Decap's "Changes saved" confirmation. In
// editorial_workflow mode Save stays disabled afterwards (the toolbar
// swaps to a status control), so we gate on the text, not toBeEnabled.
async function saveEntry(page, { timeout = 60_000 } = {}) {
  await page.getByRole("button", { name: /^Save$/i }).click();
  await expect(page.getByText(/Changes saved/i).first()).toBeVisible({ timeout });
}

// Publish the entry's pending changes through the editor — STATE-ROBUST
// across the two editorial-workflow shapes:
//
//   - A fresh / not-yet-published entry sits in the Draft → In review →
//     Ready column and shows a `Status: Draft|In review` chip that must
//     be advanced to "Ready" before "Publish" is enabled.
//   - A re-edited ALREADY-PUBLISHED entry (e.g. a cleanup leg unpublishing
//     after the forward leg published) has no such chip — it exposes the
//     `Publish ▾` control directly.
//
// Gate the Ready step on the Draft chip's presence — and do NOT hard-
// assert a `Status: Ready` chip afterwards. In the published-re-edit
// state, advancing to Ready surfaces the `Publish ▾` control directly
// (no `Status: Ready` chip), so the old unconditional
// `expect(Status: Ready)` timed out there (#1723). `Publish.click()`
// already auto-waits for the control to be actionable, which is the
// real gate. Callers must Save first (use saveEntry) so the toolbar has
// settled before we read the chip.
async function publishViaUi(page) {
  const draftChip = page.getByRole("button", { name: /^Status:\s*(Draft|In review)$/i }).first();
  if (await draftChip.isVisible().catch(() => false)) {
    await draftChip.click();
    await page.getByRole("menuitem", { name: /^Ready$/i }).click();
  }
  await page.getByRole("button", { name: /^Publish$/i }).click();
  await page
    .getByRole("menuitem", { name: /publish now/i })
    .first()
    .click();
}

module.exports = {
  publishedSwitch,
  setPublished,
  expectPublished,
  saveEntry,
  publishViaUi,
};
