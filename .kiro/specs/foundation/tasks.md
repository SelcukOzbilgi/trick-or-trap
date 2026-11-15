# Tasks: Foundation

- [ ] 1. Scaffold the Next.js application
  - [ ] 1.1 Add `package.json` with Next.js, React, TypeScript, Tailwind CSS, and their peer dependencies; use npm (no other lock file).
  - [ ] 1.2 Add `tsconfig.json` with `"strict": true`, App Router path aliases (`@/*` → `./*`), and `"moduleResolution": "bundler"`.
  - [ ] 1.3 Add `next.config.ts` (minimal, no custom options required at this stage).
  - [ ] 1.4 Add `postcss.config.mjs` with the Tailwind CSS plugin.
  - [ ] 1.5 Add `tailwind.config.ts` extending the default theme with every token from the design steering: colours (`bg`, `surface`, `surface-2`, `border`, `text`, `muted`, `primary`, `on-primary`, `accent`, `danger`, `focus`, `success`, severity colours), font families (`display`, `body`, `mono`), font size / line-height pairs, border radii (`sm`, `md`, `lg`, `full`), box shadows (`card`, `marker`, `glow`), and z-index values.
  - [ ] 1.6 Add `app/globals.css` importing Tailwind's base, components, and utilities layers.
  - [ ] 1.7 Add `app/layout.tsx` as the root layout with `<html>` and `<body className="bg-bg text-text">` to wire the dark theme.
  - [ ] 1.8 Verify that none of `README.md`, `LICENSE`, `.gitignore`, `docs/`, or `.kiro/` are modified.
  _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

- [ ] 2. Configure Vitest
  - [ ] 2.1 Add `vitest.config.ts` pointing at the `tests/` directory, enabling the `jsdom` environment, and configuring TypeScript path aliases to match `tsconfig.json`.
  - [ ] 2.2 Add a `test` script in `package.json` that runs `vitest run --maxWorkers=2`.
  - [ ] 2.3 Add `@vitejs/plugin-react` (or the Vitest equivalent) so TSX files compile in tests.
  _Requirements: 2.1, 2.2, 2.3_

- [ ] 3. Define shared Zod schemas and TypeScript types
  - [ ] 3.1 Create `lib/types/index.ts` and add `PatternIdSchema` (eight-value string enum) and its inferred `PatternId` type.
  - [ ] 3.2 Add `ConfidenceSchema` (`high` | `medium` | `low`) and its inferred `Confidence` type.
  - [ ] 3.3 Add `BoundingBoxSchema` with numeric `x`, `y`, `width`, `height` and its inferred `BoundingBox` type.
  - [ ] 3.4 Add `ElementSnapshotSchema` with all required fields (id, tag, optional role, optional text, boundingBox, computed style strings, boolean form-state fields) and its inferred `ElementSnapshot` type.
  - [ ] 3.5 Add `PageSnapshotSchema` using `z.lazy` for the recursive `secondSample` and `afterReload` fields; add its inferred `PageSnapshot` type.
  - [ ] 3.6 Add `EvidenceSchema` with required `text` and optional `measuredValues`; add its inferred `Evidence` type.
  - [ ] 3.7 Add `FindingSchema` with a `.refine()` check that `title.startsWith("Possible")` and error message `"Finding title must start with 'Possible'"`; add its inferred `Finding` type.
  _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9_

- [ ] 4. Implement the Detector interface and registry
  - [ ] 4.1 Create `lib/detectors/index.ts` and export the `Detector` type (`(snapshot: PageSnapshot) => Finding[]`).
  - [ ] 4.2 Implement `registerDetector(detector: Detector): void` that appends to a module-level registry array.
  - [ ] 4.3 Implement `runDetectors(snapshot: PageSnapshot): Finding[]` that iterates the registry, calls each detector, and collects findings.
  - [ ] 4.4 After collecting findings, validate each with `FindingSchema.parse`; on failure, throw a `TypeError` naming the detector (via its `.name` property) and including the Zod error message.
  _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

- [ ] 5. Write unit tests for schemas and registry
  - [ ] 5.1 Create `tests/types/schemas.test.ts`; write a valid `FindingSchema.parse` case and a case where `title` does not start with `"Possible"` that asserts a `ZodError` is thrown.
  - [ ] 5.2 Add a valid `PageSnapshotSchema.parse` case and an invalid case (missing required field) that asserts a `ZodError` is thrown.
  - [ ] 5.3 Create `tests/detectors/registry.test.ts`; use `vi.resetModules()` between tests or structure imports so the registry is fresh per test.
  - [ ] 5.4 Write a test that registers a fake detector returning a valid finding and asserts `runDetectors` returns it.
  - [ ] 5.5 Write a test that registers a fake detector returning a finding with an invalid `title` and asserts `runDetectors` throws.
  - [ ] 5.6 Write a test that calls `runDetectors` with no detectors registered and asserts the result is an empty array.
  - [ ] 5.7 Run `npx vitest run tests/types/schemas.test.ts tests/detectors/registry.test.ts --maxWorkers=2` and confirm all tests pass before proceeding.
  _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7_

- [ ] 6. Build the minimal landing page
  - [ ] 6.1 Create `app/page.tsx` rendering an `<h1>` with the text "Trick or Trap" and a `<p>` with one descriptive sentence about the product.
  - [ ] 6.2 Apply Tailwind utilities from the extended theme (e.g. `text-primary` for the heading, `text-muted` for the paragraph) to confirm the token classes resolve correctly.
  _Requirements: 6.1, 6.2, 6.3_

- [ ] 7. Add the environment variable template
  - [ ] 7.1 Create `.env.example` listing `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `BROWSER_CDP_ENDPOINT`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, and `NEXT_PUBLIC_APP_URL`, each with an empty value and a brief inline comment.
  - [ ] 7.2 Confirm that no `.env` file exists in the repository.
  _Requirements: 7.1, 7.2, 7.3_

- [ ] 8. Finalise npm scripts
  - [ ] 8.1 Confirm `package.json` contains `dev`, `build`, `start`, `lint`, `typecheck` (`tsc --noEmit`), and `test` (`vitest run --maxWorkers=2`) scripts.
  - [ ] 8.2 Run `npx tsc --noEmit` and resolve any type errors before marking this task done.
  _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6_
