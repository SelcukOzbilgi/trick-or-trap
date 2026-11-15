# Requirements: Foundation

## Out of scope

- Browser automation and the `getBrowser()` seam.
- Any detector implementation.
- The Boo-tique companion shop pages.
- The scan API route and Supabase storage.
- The language-model judge.
- Deployment configuration (Vercel, CDN, cron jobs).
- Phase 2 flow walker.
- Authentication or user accounts.

---

## 1. Next.js application scaffold

**User story:** As a developer, I want a Next.js App Router application in TypeScript strict mode with Tailwind CSS living at the repository root, so that every later spec can extend the same codebase without restructuring.

**Acceptance criteria:**

1.1. WHEN the repository already contains `README.md`, `LICENSE`, `.gitignore`, `docs/`, and `.kiro/`, THE SYSTEM SHALL add Next.js project files alongside those files without modifying or deleting them.

1.2. WHEN the project is scaffolded, THE SYSTEM SHALL use npm as the package manager (a `package-lock.json` is present and no other lock file exists).

1.3. WHEN TypeScript is configured, THE SYSTEM SHALL enable strict mode (`"strict": true` in `tsconfig.json`).

1.4. WHEN Tailwind CSS is configured, THE SYSTEM SHALL wire the design token colours, fonts, radii, shadows, and spacing defined in the design steering into `tailwind.config.ts` as named theme extensions so they are available as utility classes throughout the application.

1.5. WHEN the application is built with `npm run build`, THE SYSTEM SHALL complete without type errors or compilation failures.

---

## 2. Vitest configuration

**User story:** As a developer, I want Vitest configured for unit tests with a `test` script that runs once and respects the worker limit, so that the test suite is deterministic and cheap to run.

**Acceptance criteria:**

2.1. WHEN `npm test` is run, THE SYSTEM SHALL execute Vitest in non-watch, non-interactive mode (equivalent to `vitest run`).

2.2. WHEN `npm test` is run, THE SYSTEM SHALL pass `--maxWorkers=2` to Vitest so no more than two workers are spawned.

2.3. WHEN Vitest resolves TypeScript path aliases (e.g. `@/lib/...`), THE SYSTEM SHALL resolve them to the same paths as the Next.js TypeScript configuration.

---

## 3. Shared Zod schemas and TypeScript types

**User story:** As a developer, I want canonical Zod schemas and inferred TypeScript types for the core data shapes, so that every module in the codebase shares a single validated representation.

**Acceptance criteria:**

3.1. WHEN `lib/types/index.ts` is imported, THE SYSTEM SHALL export a `PatternIdSchema` Zod schema whose valid values are exactly the eight pattern identifiers: `fake-urgency`, `fake-scarcity`, `confirmshaming`, `preselection`, `visual-interference`, `sneak-into-basket`, `drip-pricing`, `hard-to-cancel`.

3.2. WHEN `lib/types/index.ts` is imported, THE SYSTEM SHALL export a `ConfidenceSchema` Zod schema whose valid values are exactly `high`, `medium`, and `low`.

3.3. WHEN `lib/types/index.ts` is imported, THE SYSTEM SHALL export a `BoundingBoxSchema` Zod schema with numeric fields `x`, `y`, `width`, and `height` representing page coordinates and dimensions in pixels.

3.4. WHEN `lib/types/index.ts` is imported, THE SYSTEM SHALL export an `ElementSnapshotSchema` Zod schema containing: a string `id`, a string `tag`, an optional string `role`, an optional string `text` (visible text content), a `BoundingBoxSchema` field `boundingBox`, computed style fields `color`, `backgroundColor`, `fontSize`, `opacity`, `display`, `visibility`, and `position` (all strings), and boolean form-state fields `checked` and `selected`.

3.5. WHEN `lib/types/index.ts` is imported, THE SYSTEM SHALL export a `PageSnapshotSchema` Zod schema containing: a string `url`, an ISO-8601 string `capturedAt`, numeric `viewportWidth` and `viewportHeight`, numeric `fullWidth` and `fullHeight`, an array of `ElementSnapshotSchema` named `elements`, optional `secondSample` (another `PageSnapshotSchema`) and `afterReload` (another `PageSnapshotSchema`) for timer and counter comparison, and an optional string `screenshotRef`.

3.6. WHEN `lib/types/index.ts` is imported, THE SYSTEM SHALL export an `EvidenceSchema` Zod schema with a required string `text` and an optional record `measuredValues` mapping string keys to numbers.

3.7. WHEN `lib/types/index.ts` is imported, THE SYSTEM SHALL export a `FindingSchema` Zod schema with: a `PatternIdSchema` field `patternId`, a `ConfidenceSchema` field `confidence`, a string `title` that is validated to start with the prefix `"Possible"`, a string `description`, an `EvidenceSchema` field `evidence`, an array of string `elementIds`, an array of `BoundingBoxSchema` `boundingBoxes`, a string `explanation`, a string `detectorName`, and an ISO-8601 string `detectedAt`.

3.8. WHEN a `FindingSchema` is parsed with a `title` that does not start with `"Possible"`, THE SYSTEM SHALL throw a Zod validation error.

3.9. WHEN `lib/types/index.ts` is imported, THE SYSTEM SHALL export TypeScript types inferred from each schema using `z.infer<>`, named `PatternId`, `Confidence`, `BoundingBox`, `ElementSnapshot`, `PageSnapshot`, `Evidence`, and `Finding` (without a `Schema` suffix).

---

## 4. Detector interface and registry

**User story:** As a developer, I want a typed `Detector` interface and a registry that runs all registered detectors and validates their output, so that adding a new detector is a one-line registration.

**Acceptance criteria:**

4.1. WHEN `lib/detectors/index.ts` is imported, THE SYSTEM SHALL export a `Detector` TypeScript type that is a pure function signature: `(snapshot: PageSnapshot) => Finding[]`.

4.2. WHEN `lib/detectors/index.ts` is imported, THE SYSTEM SHALL export a `registerDetector` function that accepts a `Detector` and adds it to the internal registry.

4.3. WHEN `runDetectors` is called with a `PageSnapshot`, THE SYSTEM SHALL call every registered detector in the order they were registered and collect all returned findings.

4.4. WHEN a registered detector returns a value that does not conform to `FindingSchema`, THE SYSTEM SHALL throw a descriptive error identifying the offending detector and the invalid finding rather than silently returning bad data.

4.5. WHEN `runDetectors` is called with no detectors registered, THE SYSTEM SHALL return an empty array.

---

## 5. Unit tests for schemas and registry

**User story:** As a developer, I want unit tests covering the Zod schemas and the detector registry, so that regressions in the shared contract are caught immediately.

**Acceptance criteria:**

5.1. WHEN `FindingSchema.parse` is called with a valid finding object, THE SYSTEM SHALL return the parsed finding without error.

5.2. WHEN `FindingSchema.parse` is called with a `title` that does not start with `"Possible"`, THE SYSTEM SHALL throw a Zod validation error.

5.3. WHEN `PageSnapshotSchema.parse` is called with a valid snapshot object, THE SYSTEM SHALL return the parsed snapshot without error.

5.4. WHEN `PageSnapshotSchema.parse` is called with a missing required field, THE SYSTEM SHALL throw a Zod validation error.

5.5. WHEN `runDetectors` is called with a snapshot and a registered fake detector that returns a valid finding, THE SYSTEM SHALL return an array containing that finding.

5.6. WHEN `runDetectors` is called with a snapshot and a registered fake detector that returns an object with a `title` not starting with `"Possible"`, THE SYSTEM SHALL throw an error.

5.7. WHEN `runDetectors` is called with no detectors registered, THE SYSTEM SHALL return an empty array.

---

## 6. Minimal landing page

**User story:** As a developer, I want a minimal landing page that renders the product name and one sentence using the dark theme tokens, so that the UI stack is proven end-to-end before heavier features are added.

**Acceptance criteria:**

6.1. WHEN a browser navigates to `/`, THE SYSTEM SHALL render the text "Trick or Trap" as the page heading.

6.2. WHEN a browser navigates to `/`, THE SYSTEM SHALL render one descriptive sentence about the product beneath the heading.

6.3. WHEN the landing page is rendered, THE SYSTEM SHALL apply the dark background colour (`#13101E`) to the page and the primary text colour (`#F4F0FF`) to the body text, using Tailwind utilities derived from the theme tokens.

---

## 7. Environment variable template

**User story:** As a developer, I want a `.env.example` file that lists every variable name the project will eventually need, so that contributors know what to configure without secrets being committed.

**Acceptance criteria:**

7.1. WHEN `.env.example` is read, THE SYSTEM SHALL list at minimum the following variable names with no values: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `BROWSER_CDP_ENDPOINT`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `NEXT_PUBLIC_APP_URL`.

7.2. WHEN `.env.example` is read, THE SYSTEM SHALL contain a brief inline comment for each variable explaining what it configures.

7.3. WHEN the repository is checked, THE SYSTEM SHALL contain no `.env` file (only `.env.example`).

---

## 8. npm scripts

**User story:** As a developer, I want a consistent set of npm scripts, so that every contributor uses the same commands regardless of local tooling.

**Acceptance criteria:**

8.1. WHEN `npm run dev` is run, THE SYSTEM SHALL start the Next.js development server.

8.2. WHEN `npm run build` is run, THE SYSTEM SHALL produce a production Next.js build.

8.3. WHEN `npm run start` is run, THE SYSTEM SHALL start the production Next.js server.

8.4. WHEN `npm run lint` is run, THE SYSTEM SHALL run ESLint across the project.

8.5. WHEN `npm run typecheck` is run, THE SYSTEM SHALL run `tsc --noEmit` and report any type errors.

8.6. WHEN `npm test` is run, THE SYSTEM SHALL run the Vitest suite once with `--maxWorkers=2` and exit with a non-zero code if any test fails.
