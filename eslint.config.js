/*
 * Flat ESLint config for the repository's JavaScript (CommonJS only).
 *
 * Three distinct JS environments live in this repo, each with its own
 * globals; this config scopes `languageOptions.globals` per directory so a
 * single `eslint` invocation can lint all of them without false `no-undef`:
 *
 *   - admin/**         -> BROWSER scripts loaded inside the Decap CMS admin
 *                         UI. They do heavy DOM work, so eslint-plugin-no-
 *                         unsanitized runs here to catch XSS-via-innerHTML.
 *   - scripts/*.js     -> Node CLI scripts / node:test suites.
 *   - e2e/**           -> Playwright + node:test files. The spec files run in
 *                         Node, but contain `page.evaluate(() => { ... })`
 *                         bodies whose code executes in the browser and
 *                         references `document` / `window`. We give e2e files
 *                         BOTH node and browser globals so those inline blocks
 *                         don't trip `no-undef`, plus the playwright-style
 *                         `test`/`expect` re-exported from e2e/base.js.
 *
 * Order matters: eslint-config-prettier is applied LAST so it can turn off
 * every stylistic rule that would conflict with Prettier (formatting is owned
 * by Prettier, correctness by ESLint).
 */
const js = require("@eslint/js");
const globals = require("globals");
const securityPlugin = require("eslint-plugin-security");
const noUnsanitizedPlugin = require("eslint-plugin-no-unsanitized");
const prettierConfig = require("eslint-config-prettier");

module.exports = [
  // Global ignores. Must be a config object with ONLY `ignores` so it
  // applies repo-wide rather than to a single file group.
  {
    ignores: [
      "node_modules/**",
      "_site/**",
      "_site_demo/**",
      "vendor/**",
      "screenshots/**",
      "playwright-report/**",
      "test-results/**",
      "coverage/**",
    ],
  },

  // Base recommended ruleset + security rules for every JS file we own.
  js.configs.recommended,
  securityPlugin.configs.recommended,

  // Project-wide correctness rules layered on top of `recommended`.
  {
    files: ["e2e/**/*.js", "admin/**/*.js", "scripts/*.js", "*.config.js"],
    rules: {
      // Dynamic code evaluation. Two e2e specs legitimately materialise a
      // CloudFront function out of template YAML via `new Function(...)`;
      // both carry an inline `// eslint-disable-next-line no-new-func` with a
      // justification. Enabling the rule here makes those directives load-
      // bearing (and catches any NEW unjustified dynamic-eval).
      "no-new-func": "error",

      // Honour the codebase's established "intentionally unused → prefix
      // with `_`" convention for args, locals, and caught errors (e.g.
      // `catch (_err)`, `({ page: _ })`). `args: "after-used"` only flags a
      // param when a LATER param is used, matching positional-callback
      // ergonomics. This turns dozens of deliberate ignores from errors into
      // self-documenting no-ops while still catching genuinely dead bindings
      // that lack the underscore marker.
      "no-unused-vars": [
        "error",
        {
          args: "after-used",
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrors: "all",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
        },
      ],

      // eslint-plugin-security tuning. This is a static Jekyll site's build
      // tooling + Playwright e2e + Decap-admin browser glue — NOT a server
      // processing untrusted requests. Two of the plugin's rules are pure
      // heuristic noise in that context and were drowning the genuinely
      // useful signal (>320 of ~350 findings):
      //
      //   detect-object-injection      — fires on EVERY computed member
      //       access (`arr[i]`, `map[key]`), overwhelmingly loop indices and
      //       known string keys. No prototype-pollution surface here.
      //   detect-non-literal-fs-filename — fires on every `fs.*(pathVar)`.
      //       These scripts/tests read repo-relative paths the build itself
      //       computes; there is no attacker-controlled filename.
      //
      // The regex-safety rules (detect-non-literal-regexp /
      // detect-unsafe-regex) stay ON as warnings — they catch real ReDoS /
      // injection risks worth a human glance, and they're left non-blocking
      // because the current hits are reviewed false positives over trusted,
      // bounded input.
      "security/detect-object-injection": "off",
      "security/detect-non-literal-fs-filename": "off",
    },
  },

  // Shared language options: this repo is CommonJS (require/module.exports),
  // so `sourceType` is "commonjs" and we expose Node + common runtime globals
  // everywhere. Per-directory blocks below layer on browser / test globals.
  {
    files: ["e2e/**/*.js", "admin/**/*.js", "scripts/*.js", "*.config.js"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "commonjs",
      globals: {
        ...globals.node,
      },
    },
  },

  // admin/** — browser-loaded Decap CMS scripts. Browser globals, plus the
  // Decap-injected `CMS` global. no-unsanitized guards DOM XSS sinks.
  {
    files: ["admin/**/*.js"],
    plugins: {
      "no-unsanitized": noUnsanitizedPlugin,
    },
    languageOptions: {
      sourceType: "script",
      globals: {
        ...globals.browser,
        CMS: "readonly",
      },
    },
    rules: {
      ...noUnsanitizedPlugin.configs.recommended.rules,
    },
  },

  // scripts/live-admin-smoke.js — despite living under scripts/, this is a
  // paste-into-the-browser-DevTools-console diagnostic (see its docblock). It
  // runs in the browser against a live admin session, so it needs BROWSER
  // globals (window, localStorage, fetch, console.table), not Node's.
  {
    files: ["scripts/live-admin-smoke.js"],
    languageOptions: {
      sourceType: "script",
      globals: {
        ...globals.browser,
      },
    },
  },

  // e2e/** — Playwright specs + node:test files. They run in Node but contain
  // `page.evaluate(() => { ...browser code... })` blocks referencing browser
  // globals, so we union node + browser globals and add the playwright-style
  // `test`/`expect`/`page` symbols re-exported from e2e/base.js.
  {
    files: ["e2e/**/*.js"],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.browser,
        test: "readonly",
        expect: "readonly",
      },
    },
  },

  // Prettier LAST — disables all formatting-related rules so Prettier owns
  // style and ESLint owns correctness.
  prettierConfig,
];
