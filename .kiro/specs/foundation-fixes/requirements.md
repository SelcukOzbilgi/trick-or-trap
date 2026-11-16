# Requirements: Foundation Fixes

This spec fixes the findings of an independent review of the foundation implementation (`.kiro/specs/foundation/`). It does not edit the foundation spec files.

## Out of scope

- `.kiro/agents/builder.json` (the agent cannot write it).
- The shadcn/ui token mapping (a later UI spec).
- Any new npm dependency. Versions are never `@latest`. If a task seems to need a new dependency, stop and report it instead of installing it.
- Detector implementations, browser automation, the scan API, the database, the LLM judge and deployment.
- Changes to the foundation spec files (`.kiro/specs/foundation/*`).
- Running `npm run build`. The owner runs it.
- Any change to `.gitignore`.
- Changes to `package-lock.json`.
- Surfacing `DetectorError` values in the UI or in an API response. The scan API spec decides that.
- Making `FindingSchema` require that `detectorName` equals the name the detector was registered under.
- Guarding detectors against mutating the snapshot they receive.
- Automated tests for CSS, fonts and the landing page. Those are checked by reading the files and by the owner's build.

## Supersession of foundation requirements

This spec supersedes or refines these foundation requirements. Where the two specs differ, this spec wins.

| Foundation criterion | Status | What changes |
|---|---|---|
| 3.3 `BoundingBoxSchema` | Refined | `width` and `height` must be non-negative. See 5.6 to 5.9. |
| 3.5 `capturedAt` | Refined | "ISO-8601 string" is now enforced with `z.iso.datetime()`. See 5.1, 5.3. |
| 3.7 `detectedAt` | Refined | Same as above. See 5.2, 5.4. The `title` rule and the absence of a `description` rule are kept. See 6.1, 6.2. |
| 4.2 `registerDetector(detector)` | **Superseded** | The signature is now `registerDetector(name: string, fn: Detector)`. See requirement 2. |
| 4.3 `runDetectors` returns findings | **Superseded** | `runDetectors` returns `{ findings, errors }`, not `Finding[]`. See requirement 3. |
| 4.4 throw a descriptive error | **Refined** | `runDetectors` no longer throws for detector failures. It records one `DetectorError` per failure and keeps running. Each error names the detector, and for invalid findings it also gives the finding index and the finding as JSON. See requirement 4. |
| 4.5 empty registry returns `[]` | **Superseded** | An empty registry returns `{ findings: [], errors: [] }`. See 3.3. |
| 5.5, 5.6, 5.7 registry tests | **Superseded** | They are replaced by the tests this spec requires, written against `createRegistry()` and the new return shape. |
| 6.3 body text colour | Clarified | The landing page paragraph uses `text-text`. See requirement 10. |
| 1.4 design tokens in `@theme` | Refined | The type scale uses the `--text-*` namespace. See requirement 8. |

All other foundation criteria stay in force.

---

## 1. Registry factory and exports

**User story:** As a developer, I want a `createRegistry()` factory and a default instance, so that tests get isolated registries and production code has no test-only exports.

**Acceptance criteria:**

1.1. WHEN `createRegistry()` is called THE SYSTEM SHALL return an object whose only members are `registerDetector` and `runDetectors`.

1.2. WHEN `createRegistry()` is called twice THE SYSTEM SHALL return two registries whose registered detectors are independent of each other.

1.3. WHEN `registerDetector` and `runDetectors` are taken from a registry object and called without that object as receiver THE SYSTEM SHALL behave the same as when called as methods.

1.4. WHEN `lib/detectors/index.ts` is imported THE SYSTEM SHALL export `createRegistry`.

1.5. WHEN `lib/detectors/index.ts` is imported THE SYSTEM SHALL export `defaultRegistry`, an instance built with `createRegistry()`.

1.6. WHEN `lib/detectors/index.ts` is imported THE SYSTEM SHALL export module-level `registerDetector` and `runDetectors` that operate on `defaultRegistry`.

1.7. WHEN `lib/detectors/index.ts` is imported THE SYSTEM SHALL export exactly four runtime values: `createRegistry`, `defaultRegistry`, `registerDetector` and `runDetectors`.

1.8. WHEN `lib/detectors/index.ts` is imported THE SYSTEM SHALL NOT export `_resetRegistryForTests` or any other function that exists only for tests.

1.9. WHEN `lib/detectors/index.ts` is imported THE SYSTEM SHALL export the types `Detector`, `Registry`, `DetectorError`, `DetectorErrorKind` and `DetectorRunResult`.

---

## 2. Named detector registration

**User story:** As a developer, I want every detector registered under an explicit name, so that every error names the detector regardless of how the function was written or exported.

**Acceptance criteria:**

2.1. WHEN `registerDetector(name, fn)` is called with a name that is not already registered in that registry THE SYSTEM SHALL add `fn` to the registry under `name`.

2.2. WHEN `registerDetector` is called with a name that is already registered in the same registry THE SYSTEM SHALL throw an `Error` whose message contains that name.

2.3. WHEN `registerDetector` throws because of a duplicate name THE SYSTEM SHALL leave the registry unchanged, so the first detector still runs exactly once.

2.4. WHEN `registerDetector` is called with an empty string or a whitespace-only string as the name THE SYSTEM SHALL throw a `TypeError`.

2.5. WHEN `registerDetector` throws because of an empty name THE SYSTEM SHALL leave the registry unchanged.

2.6. WHEN the same name is registered once in each of two different registries THE SYSTEM SHALL accept both registrations.

2.7. WHEN a name is compared with registered names THE SYSTEM SHALL compare exactly, case-sensitively and without trimming.

---

## 3. Running detectors

**User story:** As a developer, I want `runDetectors` to run every detector and return both the valid findings and the errors, so that one faulty detector does not blank the whole scan and no failure is hidden.

**Acceptance criteria:**

3.1. WHEN `runDetectors(snapshot)` is called THE SYSTEM SHALL call every registered detector once with that snapshot, in registration order.

3.2. WHEN `runDetectors` is called THE SYSTEM SHALL return an object `{ findings, errors }`, where `findings` is an array of `Finding` and `errors` is an array of `DetectorError`.

3.3. WHEN `runDetectors` is called on a registry with no detectors THE SYSTEM SHALL return `{ findings: [], errors: [] }`.

3.4. WHEN every detector returns only valid findings THE SYSTEM SHALL return those findings in `findings`, ordered by detector registration order and then by the order each detector returned them.

3.5. WHEN every detector returns only valid findings THE SYSTEM SHALL return an empty `errors` array.

3.6. WHEN a finding is valid THE SYSTEM SHALL include the result of `FindingSchema.safeParse` for it, not the detector's original object.

3.7. WHEN a detector throws, returns a non-array, or returns an invalid finding THE SYSTEM SHALL still run all detectors registered after it.

3.8. WHEN a detector throws, returns a non-array, or returns an invalid finding THE SYSTEM SHALL NOT make `runDetectors` throw.

3.9. WHEN `runDetectors` is called twice on the same registry THE SYSTEM SHALL call each detector once per call and SHALL NOT return findings from the first call in the second result.

---

## 4. Error isolation and reporting

**User story:** As a developer, I want each detector failure reported with the detector name and the offending data, so that I can find a bad detector quickly.

**Acceptance criteria:**

4.1. WHEN a detector throws THE SYSTEM SHALL add exactly one `DetectorError` with `kind` `"threw"` and `detectorName` equal to the registered name.

4.2. WHEN a detector throws an `Error` THE SYSTEM SHALL include the error's message in the `message` of that `DetectorError`.

4.3. WHEN a detector throws a value that is not an `Error` THE SYSTEM SHALL include a text form of that value in the `message` without throwing while building it.

4.4. WHEN a detector returns a value that is not an array, including `undefined`, `null`, an object or a `Promise`, THE SYSTEM SHALL add exactly one `DetectorError` with `kind` `"non-array"` and `detectorName` equal to the registered name.

4.5. WHEN a detector returns a non-array THE SYSTEM SHALL state in the `message` that the detector did not return an array.

4.6. WHEN a detector returns an array that contains an item that fails `FindingSchema` THE SYSTEM SHALL add one `DetectorError` with `kind` `"invalid-finding"` for each such item.

4.7. WHEN a `DetectorError` has `kind` `"invalid-finding"` THE SYSTEM SHALL set `findingIndex` to the zero-based index of the item in the array the detector returned.

4.8. WHEN a `DetectorError` has `kind` `"invalid-finding"` THE SYSTEM SHALL set `finding` to `JSON.stringify` of the offending item.

4.9. WHEN `JSON.stringify` of the offending item throws THE SYSTEM SHALL set `finding` to `"[unserializable finding]"`.

4.10. WHEN `JSON.stringify` of the offending item returns `undefined` THE SYSTEM SHALL set `finding` to `String(item)`.

4.11. WHEN a `DetectorError` has `kind` `"invalid-finding"` THE SYSTEM SHALL build a `message` that contains the detector name, the finding index, the `finding` text and a readable summary of the Zod issues with their paths.

4.12. WHEN a detector returns an array with both valid and invalid items THE SYSTEM SHALL keep the valid items in `findings` and report each invalid item as an error.

4.13. WHEN any `DetectorError` is created THE SYSTEM SHALL include the registered detector name in its `message`.

4.14. WHEN a detector was registered as an inline anonymous arrow function, or as a function whose own `name` is `"default"` or `""`, THE SYSTEM SHALL still use the registered name in `detectorName` and in `message`.

4.15. WHEN a `DetectorError` has a `kind` other than `"invalid-finding"` THE SYSTEM SHALL leave `findingIndex` and `finding` undefined.

4.16. WHEN `runDetectors` returns THE SYSTEM SHALL return each `DetectorError` as a plain object, not an `Error` instance, so it can be serialised with `JSON.stringify`.

---

## 5. Timestamp and bounding-box validation

**User story:** As a developer, I want timestamps and box sizes validated strictly, so that malformed data is rejected at the schema boundary.

**Acceptance criteria:**

5.1. WHEN `BaseSnapshotSchema` or `PageSnapshotSchema` is parsed with a `capturedAt` that is a valid ISO-8601 datetime accepted by `z.iso.datetime()` THE SYSTEM SHALL accept it.

5.2. WHEN `FindingSchema` is parsed with a `detectedAt` that is a valid ISO-8601 datetime accepted by `z.iso.datetime()` THE SYSTEM SHALL accept it.

5.3. WHEN `BaseSnapshotSchema` or `PageSnapshotSchema` is parsed with a `capturedAt` that `z.iso.datetime()` rejects, such as `"not a date"` or the date-only `"2025-01-01"`, THE SYSTEM SHALL throw a `ZodError`.

5.4. WHEN `FindingSchema` is parsed with a `detectedAt` that `z.iso.datetime()` rejects, such as `"not a date"` or the date-only `"2025-01-01"`, THE SYSTEM SHALL throw a `ZodError`.

5.5. WHEN `capturedAt` is invalid inside `secondSample` or `afterReload` THE SYSTEM SHALL throw a `ZodError` whose first issue path begins with `secondSample` or `afterReload` respectively.

5.6. WHEN `BoundingBoxSchema` is parsed with a negative `width` THE SYSTEM SHALL throw a `ZodError`.

5.7. WHEN `BoundingBoxSchema` is parsed with a negative `height` THE SYSTEM SHALL throw a `ZodError`.

5.8. WHEN `BoundingBoxSchema` is parsed with `width` and `height` equal to `0` THE SYSTEM SHALL accept it.

5.9. WHEN `BoundingBoxSchema` is parsed with negative `x` or `y` THE SYSTEM SHALL accept it.

---

## 6. "Possible" rule and nested snapshot validation

**User story:** As a developer, I want the schema and the steering to agree on the "Possible" rule, and I want nested snapshot validation covered by tests, so that regressions are caught.

**Acceptance criteria:**

6.1. WHEN `FindingSchema` is parsed with a `title` that does not start with `"Possible"` THE SYSTEM SHALL throw a `ZodError`.

6.2. WHEN `FindingSchema` is parsed with a valid `title` and a `description` that does not start with `"Possible"` THE SYSTEM SHALL accept it.

6.3. WHEN `PageSnapshotSchema` is parsed with an invalid element inside `secondSample` (for example a missing `tag`) THE SYSTEM SHALL throw a `ZodError` whose first issue path is `["secondSample", "elements", 0, "tag"]`.

6.4. WHEN `PageSnapshotSchema` is parsed with an invalid element inside `afterReload` THE SYSTEM SHALL throw a `ZodError` whose first issue path begins with `["afterReload", "elements", 0]`.

6.5. WHEN `PageSnapshotSchema` is parsed with a `secondSample` that is missing a required field THE SYSTEM SHALL throw a `ZodError` whose first issue path begins with `secondSample`.

---

## 7. Test coverage of the registry failure paths

**User story:** As a developer, I want a test for every registry failure path, so that the isolation behaviour cannot regress unnoticed.

**Acceptance criteria:**

7.1. WHEN `npx vitest run tests/detectors/registry.test.ts --maxWorkers=2` is run THE SYSTEM SHALL pass tests that cover each of: duplicate name, empty name, same name in two registries, empty registry, registration order, a throwing detector, a non-array return, an invalid finding with index and JSON, valid and invalid findings mixed in one array, an anonymous arrow detector, a detector whose function name is `"default"`, continued execution after a failing detector, and the exact runtime export surface.

7.2. WHEN the registry tests need a clean registry THE SYSTEM SHALL create it with `createRegistry()` and SHALL NOT reset or reload modules.

7.3. WHEN the registry tests exercise `defaultRegistry` and the module-level functions THE SYSTEM SHALL use a detector name unique to that test.

---

## 8. Type-scale design tokens

**User story:** As a developer, I want the type scale declared in the namespace Tailwind v4 reads, so that `text-*` utilities produce the sizes from the design.

**Acceptance criteria:**

8.1. WHEN `app/globals.css` is read THE SYSTEM SHALL declare in its `@theme` block these font sizes: `--text-xs: 0.75rem`, `--text-sm: 0.875rem`, `--text-base: 1rem`, `--text-lg: 1.125rem`, `--text-xl: 1.375rem`, `--text-2xl: 1.875rem`, `--text-3xl: 2.5rem`, `--text-4xl: 3.5rem`.

8.2. WHEN `app/globals.css` is read THE SYSTEM SHALL declare these line heights: `--text-xs--line-height: 1rem`, `--text-sm--line-height: 1.25rem`, `--text-base--line-height: 1.5rem`, `--text-lg--line-height: 1.75rem`, `--text-xl--line-height: 1.875rem`, `--text-2xl--line-height: 2.25rem`, `--text-3xl--line-height: 2.75rem`, `--text-4xl--line-height: 3.75rem`.

8.3. WHEN `app/globals.css` is read THE SYSTEM SHALL declare `--text-4xl--letter-spacing: -0.02em`.

8.4. WHEN `app/globals.css` is read THE SYSTEM SHALL contain no `--font-size-*` declarations.

8.5. WHEN the production CSS is built THE SYSTEM SHALL generate `.text-4xl` with font size `3.5rem`, line height `3.75rem` and letter spacing `-0.02em`.

8.6. WHEN `app/globals.css` is changed THE SYSTEM SHALL leave the colour, radius, shadow and z-index declarations unchanged.

---

## 9. Fonts

**User story:** As a user, I want the display, body and mono fonts from the design to load, so that the page does not fall back to generic fonts.

**Acceptance criteria:**

9.1. WHEN `app/layout.tsx` is read THE SYSTEM SHALL load Fraunces, Space Grotesk and JetBrains Mono with `next/font/google`.

9.2. WHEN each font is loaded THE SYSTEM SHALL request the `latin` subset, `display: "swap"` and a CSS variable named `--font-fraunces`, `--font-space-grotesk` and `--font-jetbrains-mono` respectively.

9.3. WHEN the root layout renders THE SYSTEM SHALL put the three font variable class names on the `<html>` element.

9.4. WHEN `app/globals.css` is read THE SYSTEM SHALL define `--font-display`, `--font-body` and `--font-mono` in an `@theme inline` block as `var(--font-fraunces), serif`, `var(--font-space-grotesk), system-ui, sans-serif` and `var(--font-jetbrains-mono), ui-monospace, monospace`.

9.5. WHEN `app/globals.css` is read THE SYSTEM SHALL declare each of `--font-display`, `--font-body` and `--font-mono` exactly once.

9.6. WHEN the root layout renders THE SYSTEM SHALL apply `font-body` to the `<body>` element in addition to `bg-bg text-text`.

9.7. WHEN fonts are added THE SYSTEM SHALL add no npm dependency, no font file to the repository and no external stylesheet link.

---

## 10. Landing page text colour

**User story:** As a user, I want the landing page body text in the primary text colour, so that it meets foundation requirement 6.3.

**Acceptance criteria:**

10.1. WHEN `app/page.tsx` is read THE SYSTEM SHALL style the descriptive paragraph with `text-text` and not with `text-muted`.

10.2. WHEN `/` is rendered THE SYSTEM SHALL keep the heading text "Trick or Trap" and the paragraph wording unchanged.

---

## 11. Steering corrections

**User story:** As a developer, I want the steering files to agree with each other and with the code, so that agents and contributors get one consistent set of rules.

**Acceptance criteria:**

11.1. WHEN `.kiro/steering/structure.md` is read THE SYSTEM SHALL say that a spec folder contains three files: `requirements.md`, `design.md` and `tasks.md`.

11.2. WHEN `.kiro/steering/structure.md` is read THE SYSTEM SHALL state the test-file naming rule as: the test for `lib/<area>/<name>.ts` is `tests/<area>/<name>.test.ts`.

11.3. WHEN `.kiro/steering/structure.md` is read THE SYSTEM SHALL state that the test for a source file `lib/<area>/index.ts` is `tests/<area>/<topic>.test.ts`, where `<topic>` names what the tests cover.

11.4. WHEN `.kiro/steering/structure.md` is read THE SYSTEM SHALL give `tests/types/schemas.test.ts` and `tests/detectors/registry.test.ts` as the examples of the `index.ts` rule.

11.5. WHEN `.kiro/steering/tech.md` is read THE SYSTEM SHALL say that `.env.example` lists variable names with empty values and a comment, and no placeholder values.

11.6. WHEN `.kiro/steering/findings-wording.md` is read THE SYSTEM SHALL say that only the finding `title` must start with "Possible".

11.7. WHEN `.kiro/steering/findings-wording.md` is read THE SYSTEM SHALL say that the `description` has no prefix rule and must still describe what is on the screen, without asserting intent.

11.8. WHEN the steering files are changed THE SYSTEM SHALL leave all other rules in them unchanged.

---

## 12. Run-locally documentation and Node engine

**User story:** As a contributor, I want the Node version and the commands documented and declared, so that I can run the project without guessing.

**Acceptance criteria:**

12.1. WHEN `README.md` is read THE SYSTEM SHALL contain a "Run locally" section.

12.2. WHEN the "Run locally" section is read THE SYSTEM SHALL state that Node 20.9 or newer is required.

12.3. WHEN the "Run locally" section is read THE SYSTEM SHALL list `npm install`, `npm run dev`, `npm test`, `npm run typecheck`, `npm run lint` and `npm run build`, each with a one-line description.

12.4. WHEN the "Run locally" section is read THE SYSTEM SHALL say that `npm run build` downloads Google Fonts at build time and so needs network access.

12.5. WHEN `package.json` is read THE SYSTEM SHALL contain `"engines": { "node": ">=20.9.0" }`.

12.6. WHEN `package.json` is changed THE SYSTEM SHALL leave scripts, dependencies and devDependencies unchanged.

---

## Review-finding traceability

| Review finding | Requirements | Task and sub-tasks |
|---|---|---|
| 2. Type-scale tokens do nothing | 8.1 to 8.6 | Task 3: 3.1, 3.5 |
| 3. "Possible" rule mismatch | 6.1, 6.2, 11.6, 11.7 | Task 2: 2.4, 2.5. Task 4: 4.3 |
| 4. Detector names in errors | 2.1, 4.13, 4.14 | Task 1: 1.4, 1.5 |
| 5. Weak registry error handling and duplicate registration | 2.2 to 2.7, 3.1 to 3.9, 4.1 to 4.12, 7.1 | Task 1: 1.2, 1.3, 1.4, 1.5 |
| 6. `_resetRegistryForTests` exported | 1.1 to 1.9, 7.2, 7.3 | Task 1: 1.1, 1.5, 1.6 |
| 7. ISO-8601 and bounding boxes | 5.1 to 5.9 | Task 2: 2.1, 2.3, 2.5 |
| 8a. Landing page text colour | 10.1, 10.2 | Task 3: 3.4 |
| 8b. Fonts never loaded | 9.1 to 9.7 | Task 3: 3.2, 3.3, 3.5 |
| 9a. Spec folder file count | 11.1 | Task 4: 4.1 |
| 9b. Test-file naming rule | 11.2 to 11.4 | Task 4: 4.1 |
| 9c. `.env.example` placeholder values | 11.5 | Task 4: 4.2 |
| Missing test: invalid nested `secondSample` data | 6.3 to 6.5, 5.5 | Task 2: 2.2 |
| Missing test: throwing and non-array detectors | 4.1 to 4.5, 7.1 | Task 1: 1.4 |
| Missing test: anonymous detector names | 4.14, 7.1 | Task 1: 1.4 |
| Missing test: invalid dates | 5.3 to 5.5 | Task 2: 2.1, 2.2 |
| README and `engines` (fixed decision) | 12.1 to 12.6 | Task 4: 4.4, 4.5 |
