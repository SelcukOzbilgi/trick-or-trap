---
inclusion: always
---

# Testing and commands

## Test-first rule

Tests are written before or alongside the implementation they cover — never after. A detector is not considered done until its spec file passes.

## Ground-truth coverage

Every detector must be tested against the Boo-tique ground-truth fixture at `tests/fixtures/boo-tique-ground-truth.json`. Each test suite must cover:

- All entries with `expectedVerdict: "flag"` for that detector — the detector must return at least one finding.
- All entries with `expectedVerdict: "no-flag"` for that detector — the detector must return zero findings (the honest look-alikes). Precision matters as much as recall.

## Machine load limits

These limits apply to every command run during development or in CI. Never exceed them.

| Constraint | Limit |
|---|---|
| Heavy commands running at once | 1 |
| Vitest max workers | `--maxWorkers=2` |
| Playwright max workers | `--workers=1` |
| Production builds per task | At most 1 |
| Full test suite runs per task | At most 1 |

**While iterating on a single file:** run only the relevant test file, not the full suite.

```sh
# Run one test file
npx vitest run tests/detectors/fake-urgency.test.ts --maxWorkers=2

# Run one Playwright spec
npx playwright test tests/e2e/boo-tique.spec.ts --workers=1

# Full unit suite (at most once per task)
npx vitest run --maxWorkers=2

# Full e2e suite (at most once per task)
npx playwright test --workers=1

# Type-check
npx tsc --noEmit

# Production build (at most once per task)
npx next build
```

## Other command rules

- Never start a dev server and leave it running. Start it only when needed; stop it when done.
- Never start Vitest or Playwright in watch mode (`--watch`, `--ui`).
- Never run `next dev` in the background as a background process during automated tasks.
- Run the full suite and a production build only as a final check at the end of a task, not during iterative development.
