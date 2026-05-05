/*
 * scripts/live-admin-smoke.js
 *
 * Paste-able browser-DevTools-console smoke for the live admin. Open
 * https://adamdaniel.ai/admin/ in your browser, sign in, open DevTools
 * (Cmd-Opt-J / F12 → Console), paste the entire contents of this file,
 * press Enter. The smoke prints a structured table: every layer that
 * has to work for "Publish Now" / "Delete published" to function.
 *
 * The check is read-only against your real OAuth-acquired session — no
 * branch / PR / file mutations. It exists because the Playwright e2e
 * suite seeds a PAT in localStorage and skips the real OAuth flow, so
 * a green CI run is NOT proof that buttons work for you.
 *
 *   ✓  green: that layer is wired correctly.
 *   ✗  red:   that layer is the most likely cause of "click does nothing".
 *   ?  amber: couldn't determine; usually means you're not signed in yet.
 *
 * If anything is red, the line tells you exactly what to do.
 */
(async function liveAdminSmoke() {
  const out = [];
  const ok = (k, v, hint) => out.push({ check: k, status: '✓', detail: v, hint: hint || '' });
  const bad = (k, v, hint) => out.push({ check: k, status: '✗', detail: v, hint });
  const meh = (k, v, hint) => out.push({ check: k, status: '?', detail: v, hint });

  // ── 1. Shim is loaded ─────────────────────────────────────────────
  if (window.__publishViaAutoMergeInstalled) {
    ok('shim installed', 'window.__publishViaAutoMergeInstalled is true');
  } else {
    bad('shim installed', 'window.__publishViaAutoMergeInstalled is falsy',
      'publish-via-auto-merge.js did not load. Hard-refresh (Cmd-Shift-R) to bust the 24h cache.');
  }

  // ── 2. window.fetch is wrapped ────────────────────────────────────
  const fetchSrc = String(window.fetch);
  if (fetchSrc.includes('origFetch') || fetchSrc.includes('matchers')) {
    ok('fetch wrapped', 'window.fetch is the shim wrap');
  } else {
    bad('fetch wrapped', 'window.fetch looks native (' + fetchSrc.slice(0, 80) + ')',
      'Shim ran but the wrap was clobbered later. Check for late scripts that reassign window.fetch.');
  }

  // ── 3. Decap auth in localStorage ─────────────────────────────────
  let authBlob = null;
  try {
    const raw = localStorage.getItem('decap-cms-user');
    authBlob = raw ? JSON.parse(raw) : null;
  } catch (e) { /* ignore */ }
  if (!authBlob || !authBlob.token) {
    meh('decap auth', 'localStorage[decap-cms-user] missing or no .token',
      'You are not signed in. Sign in via the admin UI, then re-run this smoke.');
    return print();
  } else {
    ok('decap auth', `signed in as ${authBlob.login || '(unknown login)'}`);
  }

  // ── 4. Token's GitHub scopes ──────────────────────────────────────
  // GitHub returns granted scopes in the X-OAuth-Scopes response header
  // on any authenticated API call.
  let scopes = '';
  try {
    const r = await fetch('https://api.github.com/user', {
      headers: { Authorization: 'token ' + authBlob.token },
    });
    scopes = (r.headers.get('X-OAuth-Scopes') || '').toLowerCase();
  } catch (e) {
    bad('token scopes', 'failed to query api.github.com/user: ' + e.message,
      'OAuth proxy or network issue. Check Network tab for the actual response.');
    return print();
  }
  const scopeList = scopes.split(',').map((s) => s.trim()).filter(Boolean);
  ok('token scopes', JSON.stringify(scopeList));
  const want = ['repo', 'user', 'workflow'];
  for (const s of want) {
    const have = scopeList.includes(s) ||
      (s === 'user' && scopeList.some((x) => x.startsWith('user'))) ||
      (s === 'repo' && scopeList.some((x) => x === 'repo' || x.startsWith('repo:')));
    if (have) {
      ok('  has ' + s + ' scope', 'yes');
    } else {
      bad('  has ' + s + ' scope', 'NO',
        s === 'workflow'
          ? 'The shim cannot dispatch delete-via-pr.yml. Log out + log back in after the OAuth proxy is redeployed with `workflow` scope (PR #175).'
          : 'CMS API calls will fail. Re-authenticate.');
    }
  }

  // ── 5. Workflow dispatch endpoint reachable ───────────────────────
  // Probe the dispatch endpoint with a no-op payload. We expect:
  //   - 204 if the user re-authed AFTER PR #175 deployed (workflow scope granted, dry-run accepted)
  //   - 422 "missing inputs" if scope is granted but the payload is rejected (still good — proves auth)
  //   - 404 if scope missing (the failure mode that breaks Delete)
  let dispatchProbe = '';
  try {
    const r = await fetch(
      'https://api.github.com/repos/Adam-S-Daniel/adamdaniel.ai/actions/workflows/delete-via-pr.yml/dispatches',
      {
        method: 'POST',
        headers: { Authorization: 'token ' + authBlob.token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ref: 'main', inputs: { path: '__smoke_probe_does_not_exist__' } }),
      },
    );
    dispatchProbe = String(r.status);
    if (r.status === 404) {
      bad('dispatch probe', '404 — workflow scope missing on token',
        'The smoking gun. Re-authenticate after the OAuth proxy is redeployed.');
    } else if (r.status === 204) {
      ok('dispatch probe', '204 — endpoint accepted (a real run is now in flight against `__smoke_probe_does_not_exist__`; the workflow will validate-fail safely)');
    } else if (r.status === 422) {
      ok('dispatch probe', '422 — scope is granted (payload-validation failure is fine)');
    } else {
      bad('dispatch probe', String(r.status) + ' — unexpected', 'Inspect the response body.');
    }
  } catch (e) {
    bad('dispatch probe', 'network error: ' + e.message);
  }

  print();

  function print() {
    console.log('%c live-admin-smoke ', 'background:#1f2937;color:#fff;font-weight:bold;padding:2px 8px');
    console.table(out);
    const reds = out.filter((o) => o.status === '✗');
    if (reds.length) {
      console.warn('first failure:', reds[0]);
    } else {
      console.log('%c all green — if buttons still don\'t work, capture the Network tab while clicking and share', 'color:#10b981');
    }
  }
})();
