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

A string union of the nine canonical pattern identifiers used as a discriminating key across the whole codebase. Defined once in `lib/types`; imported everywhere else. The value `none` is not a `PatternId`; it is reserved for honest look-alike entries in the Boo-tique ground-truth fixture only.

### `BaseSnapshot` and `PageSnapshot`

`BaseSnapshot` is the flat, non-recursive record of a single page capture: URL, timestamp, dimensions, elements, and an optional screenshot reference. It contains everything a detector needs from one load.

`PageSnapshot` extends `BaseSnapshot` with two optional fields — `secondSample` and `afterReload` — both typed as `BaseSnapshot`. This two-level structure avoids recursive Zod schemas while still letting detectors compare two captures (e.g. to detect countdown resets or stock-count changes). Detectors that do not need a second load simply receive a `PageSnapshot` where those fields are absent.

No `z.lazy` is needed.

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

Tailwind uses its CSS-first configuration. `app/globals.css` imports `tailwindcss` and declares all design tokens in a single `@theme` block. `postcss.config.mjs` references `@tailwindcss/postcss`. There is no `tailwind.config.ts`.

Token mapping inside the `@theme` block:

- Colours — `--color-bg: #13101E`, `--color-surface: #1D1830`, `--color-surface-2: #28213F`, `--color-border: #3A3158`, `--color-text: #F4F0FF`, `--color-muted: #B9B0D1`, `--color-primary: #FF9A3C`, `--color-on-primary: #1A0F05`, `--color-accent: #B99BFF`, `--color-danger: #FF6B8A`, `--color-focus: #FFD84D`, `--color-success: #7BE0A4`, `--color-severity-high: #FF9A3C`, `--color-severity-medium: #B99BFF`, `--color-severity-low: #8C84A8`.
- Font families — `--font-display`, `--font-body`, `--font-mono`.
- Border radii — `--radius-sm: 6px`, `--radius-md: 12px`, `--radius-lg: 20px`, `--radius-full: 999px`.
- Box shadows — `--shadow-card`, `--shadow-marker`, `--shadow-glow`.
- Z-index — `--z-screenshot: 1`, `--z-marker-cluster: 10`, `--z-marker: 20`, `--z-marker-selected: 30`, `--z-popover: 40`, `--z-sticky-header: 50`, `--z-sheet: 60`, `--z-modal: 70`, `--z-toast: 80`.

Tailwind's CSS-variable-based approach makes these available as utility classes: `bg-bg`, `text-text`, `text-primary`, `font-display`, `shadow-card`, etc.

The root `app/layout.tsx` applies `bg-bg text-text` to the `<body>` element to establish the dark base.

---

## Test strategy

### Unit-tested (Vitest, `node` environment)

- **`tests/types/schemas.test.ts`**: exercises every Zod schema with at least one valid fixture and at least one invalid fixture per required field. Specifically tests the `title` refinement with both a passing and a failing case.
- **`tests/detectors/registry.test.ts`**: isolates the registry per test (via `vi.resetModules()` or equivalent), registers a fake detector, calls `runDetectors`, and asserts on the return value. Tests the error path with a detector that returns a bad finding.

No jsdom, no React component rendering, and no `@vitejs/plugin-react` are needed in this spec. All tested code is pure TypeScript with no DOM dependency.

### Requires a fixture or mock

None in this spec. The schemas are pure data-shape validators; no external dependencies.

### Out of scope for automated testing

- Visual correctness of the landing page (colour rendering, font loading). Verified manually or in a later Playwright spec.
- Production build success. Run once as the final verification step (task 11.4), not during iterative development.
- ESLint rule violations. `npm run lint` is a separate script invoked in task 11.2; not run from Vitest.

---

## Pinned dependency versions

Record the exact installed versions here after running `npm install` in task 1.2:

| Package | Installed version |
|---|---|
| `next` | 16.4.6 |
| `react` | 19.3.1 |
| `tailwindcss` | 4.3.5 |
| `typescript` | 5.9.3 (downgraded from 7.0.2 — typescript-eslint in eslint-config-next@16 requires TypeScript ≤6) |
| `vitest` | 5.1.0 |
| `zod` | 4.6.7 |
