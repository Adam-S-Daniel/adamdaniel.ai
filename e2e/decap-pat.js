/*
 * Helpers that let Playwright drive Decap CMS as an authenticated user
 * without going through the OAuth-proxy popup dance.
 *
 * Decap's GitHub backend persists its auth in localStorage under
 * `netlify-cms-user` (the project's GitHub fork-history reason — Decap is
 * the maintained fork of Netlify CMS, but the storage key was kept stable
 * for migration). Pre-seeding the same record makes the editor mount
 * already-logged-in, which is what we want for unattended e2e runs:
 *
 *   { backendName: "github", token: "<PAT>", login: "<user>", name: "..." }
 *
 * The PAT is read from CMS_E2E_PAT and must be a fine-grained token
 * scoped to the host repo with `Contents: read/write` and
 * `Pull requests: read/write` (see AGENTS.md → "CMS publish-loop test").
 *
 * Used by `e2e/cms-publish-loop.spec.js` (host repo, target main) and
 * `e2e/cms-publish-loop-preview.spec.js` (preview env, target PR head).
 */
const NETLIFY_CMS_USER_KEY = "netlify-cms-user";

const HOST_REPO = "Adam-S-Daniel/adamdaniel.ai";

function getPat() {
  return process.env.CMS_E2E_PAT || "";
}

function getLogin() {
  return process.env.CMS_E2E_USER || "Adam-S-Daniel";
}

function buildAuthRecord(token, login) {
  return {
    backendName: "github",
    token,
    login,
    name: "E2E Test Harness",
  };
}

/**
 * Seed `localStorage[netlify-cms-user]` so Decap sees an existing GitHub
 * session and skips the OAuth popup. Run before `page.goto("/admin/")`.
 *
 * Throws synchronously if CMS_E2E_PAT isn't set — the publish-loop tests
 * are gated to the host repo, so a missing token is a setup error, not
 * a soft skip.
 */
async function seedDecapAuth(page, { token = getPat(), login = getLogin() } = {}) {
  if (!token) {
    throw new Error(
      "CMS_E2E_PAT env var is empty. The CMS publish-loop test needs a fine-grained PAT in repo secrets. See AGENTS.md.",
    );
  }
  const record = buildAuthRecord(token, login);
  await page.addInitScript(({ key, value }) => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (_) {
      /* private mode etc — let Decap surface the resulting error */
    }
  }, { key: NETLIFY_CMS_USER_KEY, value: record });
}

module.exports = {
  HOST_REPO,
  NETLIFY_CMS_USER_KEY,
  buildAuthRecord,
  getLogin,
  getPat,
  seedDecapAuth,
};
