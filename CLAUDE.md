See [AGENTS.md](./AGENTS.md) for instructions.

## Standing rules

- **Visual showcase required.** After any change that could affect visual output (CSS, layouts, templates, images), regenerate the visual regression showcase before committing:
  ```bash
  cp -r e2e/visual-regression.spec.js-snapshots{,-before}
  npx playwright test e2e/visual-regression.spec.js --update-snapshots
  node scripts/generate-showcase.js
  ```
  Commit the updated snapshots and `recordings/visual-regression-showcase.webm` alongside the code change. The showcase shows before/after side-by-side for each visual check.

- **Red-green TDD.** Write a failing test first, then make it pass, then refactor. Always follow this cycle.
