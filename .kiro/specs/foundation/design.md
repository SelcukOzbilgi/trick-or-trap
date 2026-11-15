# Design: Foundation

## Architecture and module boundaries

The foundation establishes three independent layers that every later spec extends:

1. **Application shell** — Next.js App Router with Tailwind CSS. All routing, rendering, and static assets live under `app/`. No business logic goes here; the shell only wires up the theme and proves the UI stack compiles.

2. **Shared types** — `lib/types/index.ts`. A single file of Zod schemas and their inferred TypeScript types. No imports from anywhere else in `lib/`; it is the base of the dependency graph. All other modules import from here, never the reverse.

3. **Detector interface and registry** — `lib/detectors/index.ts`. Exports the `Detector` function type, `registerDetector`, and `runDetectors`. It imports only from `lib/types`. Detector implementations will live in sibling files (`lib/detectors/fake-urgency.ts`, etc.) and self-register by calling `registerDetector` on import; the registry file never hard-codes their names.

```
lib/
  types/
    index.ts          ← Zod schemas + inferred types (no deps inside lib/)
  detectors/
    index.ts          ← Detector type, registerDetector, runDetectors
```

Tests mirror `lib/` under `tests/`:

```
tests/
  types/
    schemas.test.ts   ← Zod schema valid/invalid cases
  detectors/
    registry.test.ts  ← registry with a fake detector
```

---

## Key data types and interfaces

### `PatternId`

A string union of the eight pattern identifiers used as a discriminating key across the whole codebase. Defined once in `lib/types`; imported everywhere else.

### `PageSnapshot`

The input contract for every detector. It captures everything a detector might need from a single page load: the URL, the capture timestamp, viewport and full-page dimensions, a flat list of `ElementSnapshot` objects (one per DOM element the extractor decided was relevant), and optional second-sample and after-reload snapshots for change-detection logic. An optional `screenshotRef` holds a Storage path; detectors never read it.

`PageSnapshot` is intentionally recursive for `secondSample` and `afterReload` (both are `PageSnapshot`). Zod handles this with `z.lazy`.

### `ElementSnapshot`

A flattened, serialisable snapshot of one DOM element. Computed style fields are always strings (as returned by `getComputedStyle`). The `checked` and `selected` booleans cover `<input type="checkbox">`, `<input type="radio">`, and `<option>` elements. The `id` field is a stable synthetic identifier assigned by the extractor (not the HTML `id` attribute) so detectors can refer back to elements in their findings.

### `Finding`

The output contract for every detector. The `title` invariant (`startsWith("Possible")`) is enforced at the Zod layer so it cannot be violated at runtime even if a detector author forgets. The `elementIds` and `boundingBoxes` arrays allow the UI to pin monster markers at the right coordinates without re-querying the DOM.

### `Detector`

```ts
type Detector = (snapshot: PageSnapshot) => Finding[];
```

A pure function. No async, no side effects, no imports from outside `lib/types` and `lib/detectors`. Detectors are synchronous by design; if a future detector needs async (e.g. the LLM judge), the registry signature will be extended in a later spec rather than breaking the current contract.

### `Evidence`

Carries the human-readable `text` that appears on the finding card and an optional `measuredValues` map for numeric evidence (contrast ratios, reload deltas, pixel counts). This keeps finding cards honest: every number displayed in the UI must have been computed by the detector, not invented by copy.

---

## Error handling

**Schema validation failures in `runDetectors`**: if a detector returns a value that fails `FindingSchema.parse`, `runDetectors` throws a `TypeError` with a message that includes the detector function's `.name` property and the Zod error message. It does not swallow or warn; a bad detector crashes the scan so the problem is caught in tests.

**Missing required fields on `PageSnapshot`**: Zod's default behaviour — throws `ZodError` with a path-annotated message. No custom handling needed at this layer.

**`title` not starting with "Possible"**: handled by a Zod `.refine()` call on `FindingSchema`. The error message is `"Finding title must start with 'Possible'"`.

**Registry called before any detectors are registered**: returns `[]`. Not an error; the app starts without built-in detectors and they are registered by importing their files.

---

## Tailwind and design tokens

The design steering defines a full token sheet (colours, fonts, radii, shadows, spacing, z-index, motion). These are added to `tailwind.config.ts` under `theme.extend` so Tailwind's defaults remain available. Each token maps to a named utility class:

- Colours → `theme.extend.colors` (e.g. `bg-bg`, `text-text`, `text-primary`).
- Font families → `theme.extend.fontFamily` (`display`, `body`, `mono`).
- Font size / line-height pairs → `theme.extend.fontSize`.
- Border radii → `theme.extend.borderRadius` (`sm`, `md`, `lg`, `full`).
- Box shadows → `theme.extend.boxShadow` (`card`, `marker`, `glow`).
- Spacing → Tailwind's default 4 px base already covers the specified scale; no extension needed.
- Z-index → `theme.extend.zIndex`.

The root `app/layout.tsx` applies `bg-bg text-text` to the `<body>` element to establish the dark base.

---

## Test strategy

### Unit-tested (Vitest, no browser)

- **`tests/types/schemas.test.ts`**: exercises every Zod schema with at least one valid fixture and at least one invalid fixture per required field. Specifically tests the `title` refinement with both a passing and a failing case.
- **`tests/detectors/registry.test.ts`**: creates a fresh registry (or resets the module between tests using `vi.resetModules()`), registers a fake detector, calls `runDetectors`, and asserts on the return value. Tests the error path with a detector that returns a bad finding.

### Requires a fixture or mock

None in this spec. The schemas are pure data-shape validators; no external dependencies.

### Out of scope for automated testing

- Visual correctness of the landing page (colour rendering, font loading). Verified manually or in a later Playwright spec.
- Production build success (`npm run build`). Run once manually or as a final CI check; not part of the iterative Vitest suite.
- ESLint rule violations. `npm run lint` is a separate script; not run from Vitest.
