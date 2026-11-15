# Tasks: Foundation

- [x] 1. Install dependencies
  - [x] 1.1 Create `package.json` declaring runtime dependencies (`next`, `react`, `react-dom`, `zod`) and dev dependencies (`typescript`, `@types/node`, `@types/react`, `@types/react-dom`, `tailwindcss`, `@tailwindcss/postcss`, `postcss`, `vitest`, `eslint`, `eslint-config-next`).
  - [x] 1.2 Run `npm install` to generate `package-lock.json`; confirm no other lock file (`yarn.lock`, `pnpm-lock.yaml`, `bun.lockb`) is present.
  - [x] 1.3 Record the exact installed versions of `next`, `react`, `tailwindcss`, `typescript`, `vitest`, and `zod` in `design.md` under a new "Pinned dependency versions" section.
  _Requirements: 1.2_

- [x] 2. Configure the Next.js application shell
  - [x] 2.1 Add `tsconfig.json` with `"strict": true`, `"moduleResolution": "bundler"`, and the path alias `"@/*": ["./*"]`.
  - [x] 2.2 Add `next.config.ts` (minimal; no custom options required at this stage).
  - [x] 2.3 Add `postcss.config.mjs` referencing the `@tailwindcss/postcss` plugin.
  - [x] 2.4 Add `app/globals.css` that imports `tailwindcss` and declares all design tokens from the design steering in a single `@theme` block: colour tokens (`--color-bg`, `--color-surface`, `--color-surface-2`, `--color-border`, `--color-text`, `--color-muted`, `--color-primary`, `--color-on-primary`, `--color-accent`, `--color-danger`, `--color-focus`, `--color-success`, severity colours `--color-severity-high`, `--color-severity-medium`, `--color-severity-low`), font family tokens (`--font-display`, `--font-body`, `--font-mono`), border radius tokens, box shadow tokens, and z-index tokens; no `tailwind.config.ts` is added.
  - [x] 2.5 Add `app/layout.tsx` as the root layout with `<html>` and `<body className="bg-bg text-text">` to establish the dark base.
  - [x] 2.6 Read `README.md`, `LICENSE`, and `.gitignore` after completing sub-tasks 2.1–2.5 to confirm their content is unchanged.
  _Requirements: 1.1, 1.3, 1.4, 1.5_

- [x] 3. Add ESLint configuration
  - [x] 3.1 Add `eslint.config.mjs` using flat config format, extending `eslint-config-next` and enabling the rules appropriate for a Next.js App Router project.
  _Requirements: 8.4_

- [x] 4. Configure Vitest
  - [x] 4.1 Add `vitest.config.ts` pointing at the `tests/` directory, using the `node` environment (no jsdom), and configuring the TypeScript path alias `@/*` to match `tsconfig.json`.
  - [x] 4.2 Add a `test` script in `package.json` that runs `vitest run --maxWorkers=2`.
  _Requirements: 2.1, 2.2, 2.3_

- [x] 5. Add all npm scripts to package.json
  - [x] 5.1 Add a `dev` script: `next dev`.
  - [x] 5.2 Add a `build` script: `next build`.
  - [x] 5.3 Add a `start` script: `next start`.
  - [x] 5.4 Add a `lint` script: `eslint .` (Next.js 16 does not ship `next lint`; `eslint .` with `eslint-config-next` is equivalent).
  - [x] 5.5 Add a `typecheck` script: `tsc --noEmit`.
  - [x] 5.6 Confirm the `test` script added in task 4.2 reads `vitest run --maxWorkers=2`.
  _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6_

- [x] 6. Define shared Zod schemas and TypeScript types
  - [x] 6.1 Create `lib/types/index.ts` and add `PatternIdSchema` as a nine-value `z.enum` with values `fake-urgency`, `fake-scarcity`, `fake-activity`, `confirmshaming`, `preselection`, `visual-interference`, `sneak-into-basket`, `drip-pricing`, `hard-to-cancel`; export its inferred `PatternId` type.
  - [x] 6.2 Add `ConfidenceSchema` as `z.enum(["high", "medium", "low"])`; export its inferred `Confidence` type.
  - [x] 6.3 Add `BoundingBoxSchema` with numeric fields `x`, `y`, `width`, `height`; export its inferred `BoundingBox` type.
  - [x] 6.4 Add `ElementSnapshotSchema` with all required fields: `id` (string), `tag` (string), optional `role` (string), optional `text` (string), `boundingBox` (`BoundingBoxSchema`), computed style strings `color`, `backgroundColor`, `fontSize`, `opacity`, `display`, `visibility`, `position`, and boolean form-state fields `checked` and `selected`; export its inferred `ElementSnapshot` type.
  - [x] 6.5 Add `BaseSnapshotSchema` with fields `url` (string), `capturedAt` (ISO-8601 string), `viewportWidth`, `viewportHeight`, `fullWidth`, `fullHeight` (all numbers), `elements` (array of `ElementSnapshotSchema`), and optional `screenshotRef` (string); export its inferred `BaseSnapshot` type.
  - [x] 6.6 Add `PageSnapshotSchema` by extending `BaseSnapshotSchema` with two optional fields `secondSample` and `afterReload`, both typed as `BaseSnapshotSchema`; export its inferred `PageSnapshot` type.
  - [x] 6.7 Add `EvidenceSchema` with required `text` (string) and optional `measuredValues` (`z.record(z.string(), z.number())`); export its inferred `Evidence` type.
  - [x] 6.8 Add `FindingSchema` with fields `patternId` (`PatternIdSchema`), `confidence` (`ConfidenceSchema`), `title` (string with `.refine(v => v.startsWith("Possible"), "Finding title must start with 'Possible'")`), `description` (string), `evidence` (`EvidenceSchema`), `elementIds` (array of string), `boundingBoxes` (array of `BoundingBoxSchema`), `explanation` (string), `detectorName` (string), `detectedAt` (ISO-8601 string); export its inferred `Finding` type.
  _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9_

- [x] 7. Implement the Detector interface and registry
  - [x] 7.1 Create `lib/detectors/index.ts` and export the `Detector` type as `(snapshot: PageSnapshot) => Finding[]`.
  - [x] 7.2 Implement a module-level registry array and export `registerDetector(detector: Detector): void` that appends to it.
  - [x] 7.3 Export `runDetectors(snapshot: PageSnapshot): Finding[]` that calls each registered detector in registration order and collects all returned findings.
  - [x] 7.4 After collecting findings, validate each with `FindingSchema.parse`; on failure throw a `TypeError` whose message names the detector (via `.name`) and includes the Zod error text.
  _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

- [x] 8. Write unit tests for schemas and registry
  - [x] 8.1 Create `tests/types/schemas.test.ts`; write a test that calls `FindingSchema.parse` with a fully valid finding object and asserts it returns without error.
  - [x] 8.2 Write a test that calls `FindingSchema.parse` with a `title` not starting with `"Possible"` and asserts a `ZodError` is thrown.
  - [x] 8.3 Write a test that calls `PageSnapshotSchema.parse` with a valid snapshot and asserts it returns without error.
  - [x] 8.4 Write a test that calls `PageSnapshotSchema.parse` with a missing required field and asserts a `ZodError` is thrown.
  - [x] 8.5 Create `tests/detectors/registry.test.ts`; isolate the registry per test by importing the registry module inside each test via `vi.importActual` after `vi.resetModules()`, or by structuring the registry to accept an explicit list (choose whichever keeps the test file self-contained).
  - [x] 8.6 Write a test that registers a fake detector returning a valid `Finding` and asserts `runDetectors` returns an array containing that finding.
  - [x] 8.7 Write a test that registers a fake detector returning an object whose `title` does not start with `"Possible"` and asserts `runDetectors` throws.
  - [x] 8.8 Write a test that calls `runDetectors` with no detectors registered and asserts the result is `[]`.
  - [x] 8.9 Run `npx vitest run tests/types/schemas.test.ts tests/detectors/registry.test.ts --maxWorkers=2` and confirm all tests pass.
  _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7_

- [x] 9. Build the minimal landing page
  - [x] 9.1 Create `app/page.tsx` rendering an `<h1>` with the text "Trick or Trap" and a `<p>` with one descriptive sentence about the product.
  - [x] 9.2 Apply Tailwind utilities derived from the `@theme` tokens (e.g. `text-primary` on the heading, `text-muted` on the paragraph) to confirm the token classes resolve at build time.
  _Requirements: 6.1, 6.2, 6.3_

- [x] 10. Add the environment variable template
  - [x] 10.1 Create `.env.example` with the following variables, each set to an empty value and followed by an inline comment: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `BROWSER_CDP_ENDPOINT`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `NEXT_PUBLIC_APP_URL`.
  - [x] 10.2 Read the repository root directory listing and confirm no `.env` file is present (only `.env.example`).
  _Requirements: 7.1, 7.2, 7.3_

- [x] 11. Final verification
  - [x] 11.1 Run `npm run typecheck` and resolve any reported type errors.
  - [x] 11.2 Run `npm run lint` and resolve any reported lint errors.
  - [x] 11.3 Run `npm test` and confirm all tests pass.
  - [x] 11.4 Run `npm run build` and confirm the production build completes without errors.
  _Requirements: 1.5, 2.1, 2.2, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6_
