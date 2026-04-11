See [AGENTS.md](./AGENTS.md) for instructions.

## Standing rules

- **Visual showcase required.** After any change that could affect visual output (CSS, layouts, templates, images), regenerate the visual regression showcase before committing:
  ```bash
  npx playwright test e2e/visual-regression.spec.js --update-snapshots
  PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/generate-showcase.js
  ```
  Commit the updated snapshots and `recordings/visual-regression-showcase.webm` alongside the code change.

- **Red-green TDD.** Write a failing test first, then make it pass, then refactor. Always follow this cycle.
