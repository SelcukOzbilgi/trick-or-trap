# Design: Foundation Fixes

## Architecture and module boundaries

The fixes touch four areas. Each area is a separate task and changes a separate set of files, so the tasks do not depend on each other and can be run in any order. The order in `tasks.md` is the recommended order.

| Area | Files changed | Depends on |
|---|---|---|
| Detector registry | `lib/detectors/index.ts`, `tests/detectors/registry.test.ts` | `lib/types` (read only) |
| Schema validation | `lib/types/index.ts`, `tests/types/schemas.test.ts` | none |
| Tokens, fonts, landing page | `app/globals.css`, `app/layout.tsx`, `app/page.tsx` | none |
| Steering and docs | `.kiro/steering/structure.md`, `.kiro/steering/tech.md`, `.kiro/steering/findings-wording.md`, `README.md`, `package.json` | none |

Module boundaries stay as in the foundation design: `lib/types` imports nothing from `lib/`, and `lib/detectors/index.ts` imports only from `lib/types`. This spec adds no new files under `lib/` or `app/`.

No new npm dependency is added. `next/font/google` ships with the installed `next`, `z.iso.datetime()` ships with the installed `zod` 4.6.7, and Tailwind v4 is already installed.

---

## Key data types and interfaces

### Detector registry (`lib/detectors/index.ts`)

```ts
export type Detector = (snapshot: PageSnapshot) => Finding[]; // unchanged

export type DetectorErrorKind = "threw" | "non-array" | "invalid-finding";

/** Plain serialisable data. Not an Error instance. */
export type DetectorError = {
  detectorName: string;      // the registered name, never fn.name
  kind: DetectorErrorKind;
  message: string;           // always contains detectorName
  findingIndex?: number;     // only for "invalid-finding"; zero-based index in the returned array
  finding?: string;          // only for "invalid-finding"; JSON text of the offending item
};

export type DetectorRunResult = {
  findings: Finding[];       // validated, zod-parsed findings only
  errors: DetectorError[];   // one entry per failure, in the order the failures happened
};

export type Registry = {
  registerDetector(name: string, fn: Detector): void;
  runDetectors(snapshot: PageSnapshot): DetectorRunResult;
};

export function createRegistry(): Registry;
export const defaultRegistry: Registry;
export const registerDetector: Registry["registerDetector"]; // taken from defaultRegistry
export const runDetectors: Registry["runDetectors"];         // taken from defaultRegistry
```

The runtime export surface is exactly `createRegistry`, `defaultRegistry`, `registerDetector` and `runDetectors`. Everything else is a type.

`createRegistry()` keeps its detector list in a closure (an array of `{ name, fn }` entries, or a `Map<string, Detector>`, which keeps insertion order). The two methods do not use `this`, so `const { registerDetector, runDetectors } = defaultRegistry` is safe. That is how the module-level exports are produced, and it satisfies criterion 1.3.

### Decision: `runDetectors` collects errors and returns them

The choice is between returning errors next to findings and throwing an aggregate error after all detectors have run. This spec chooses to return them.

| | Return `{ findings, errors }` (chosen) | Throw an aggregate error after the loop |
|---|---|---|
| Valid findings of healthy detectors | Kept. The scan can still show them. | Lost, because the caller only gets the exception. |
| Failure visibility | Each error is data with the detector name. Nothing is thrown, so the caller must read `errors`. | Impossible to miss. |
| Fit with foundation 4.3 and 4.5 | Return type changes. | Return type stays `Finding[]`. |
| Fit with the review finding "one bad detector aborts the whole scan" | Resolved. | Resolved only in the sense that all detectors run. The result is still discarded. |

A detector that fails therefore never disappears silently: its failure is an entry in `errors`, and the entry always contains the detector name. The later scan API spec must decide what to do with `errors` (log, show a notice, fail the scan). Tests of detectors that must be strict can assert `errors` is empty.

### Run algorithm

For each registered `{ name, fn }`, in registration order:

1. Call `fn(snapshot)` inside `try`. If it throws, push a `"threw"` error and continue with the next detector.
2. If the result is not `Array.isArray`, push a `"non-array"` error and continue. This covers `undefined`, `null`, plain objects and `Promise` values returned by async detectors.
3. For each item at index `i`, call `FindingSchema.safeParse(item)`. On success push `parsed.data` to `findings`. On failure push an `"invalid-finding"` error with `findingIndex: i` and `finding` set as described below.

### Message formats

| Kind | Message |
|---|---|
| `threw` | `Detector "<name>" threw: <reason>` where `<reason>` is the `Error` message, or a text form of the thrown value. Building the text must not throw. If it would, use `"[unprintable value]"`. |
| `non-array` | `Detector "<name>" did not return an array (received <null, undefined or typeof value>)` |
| `invalid-finding` | `Detector "<name>" returned an invalid finding at index <i>: <issues>. Finding: <json>` where `<issues>` is each Zod issue as `<path or "(root)">: <message>`, joined with `"; "`. |

Tests match on the detector name, the index, the JSON text and the phrase "did not return an array". They do not match on the full message string, so wording can be adjusted without breaking tests.

### JSON text of the offending finding

- `JSON.stringify(item)` when it returns a string.
- `"[unserializable finding]"` when it throws (for example a circular object or a `BigInt`).
- `String(item)` when it returns `undefined` (the item is `undefined`, a function or a symbol).

### Registration rules

- `name` is used exactly as given. Empty and whitespace-only names throw `TypeError`.
- A duplicate name in the same registry throws `Error` with the name in the message. The registry is not modified.
- Two registries are independent, so tests and module reloads (HMR) of a different registry never collide.
- A detector module that is imported twice in one registry (a re-import or HMR with module state kept) now fails loudly at the second `registerDetector` call. It does not run twice.

### Schemas (`lib/types/index.ts`)

```ts
BoundingBoxSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().nonnegative(),
  height: z.number().nonnegative(),
});

BaseSnapshotSchema.capturedAt = z.iso.datetime();
FindingSchema.detectedAt      = z.iso.datetime();
```

`z.iso.datetime()` is used with default options. That accepts `2025-01-01T00:00:00Z` and `2025-01-01T00:00:00.000Z` and rejects date-only strings, free text and, by default, non-`Z` offsets. The capture code writes `new Date().toISOString()`, which always matches.

The `title` refine stays as it is. The doc comment on `title` says only the title is prefix-checked, and the `description` field gets a comment saying it has no prefix rule. The `FindingSchema` itself does not change for `description`.

### Design tokens (`app/globals.css`)

Tailwind v4 reads font sizes from the `--text-*` namespace. `--font-size-*` is not a font-size namespace there, so the old declarations produced no utilities. The type scale is replaced with:

```css
--text-xs:   0.75rem;   --text-xs--line-height:   1rem;
--text-sm:   0.875rem;  --text-sm--line-height:   1.25rem;
--text-base: 1rem;      --text-base--line-height: 1.5rem;
--text-lg:   1.125rem;  --text-lg--line-height:   1.75rem;
--text-xl:   1.375rem;  --text-xl--line-height:   1.875rem;
--text-2xl:  1.875rem;  --text-2xl--line-height:  2.25rem;
--text-3xl:  2.5rem;    --text-3xl--line-height:  2.75rem;
--text-4xl:  3.5rem;    --text-4xl--line-height:  3.75rem;
--text-4xl--letter-spacing: -0.02em;
```

These match the design steering: 12/16, 14/20, 16/24, 18/28, 22/30, 30/36, 40/44, 56/60. Colours, radii, shadows and the `--z-index-*` declarations are not touched.

### Fonts

`app/layout.tsx` loads three fonts with `next/font/google`:

| Font | Export | `variable` |
|---|---|---|
| Fraunces | `Fraunces` | `--font-fraunces` |
| Space Grotesk | `Space_Grotesk` | `--font-space-grotesk` |
| JetBrains Mono | `JetBrains_Mono` | `--font-jetbrains-mono` |

Each call uses `subsets: ["latin"]` and `display: "swap"`. No `weight` is given, because all three are variable fonts and `next/font` then loads the full weight range, which covers the `font-bold` already used on the landing page. The three `.variable` class names go on `<html>`, so the variables are defined on `:root`.

The existing theme tokens keep their names and point at those variables. They move into a separate `@theme inline` block, because the values refer to other CSS variables. With `inline`, Tailwind writes the `var()` reference into each utility, so `font-display`, `font-body` and `font-mono` resolve correctly whichever element carries the class.

```css
@theme inline {
  --font-display: var(--font-fraunces), serif;
  --font-body:    var(--font-space-grotesk), system-ui, sans-serif;
  --font-mono:    var(--font-jetbrains-mono), ui-monospace, monospace;
}
```

The three font declarations are removed from the first `@theme` block so each token is declared once. The `<body>` gets `font-body` so body text uses Space Grotesk.

`next/font/google` downloads the font files at build time and serves them from the app's own origin. It needs network access during `npm run build` (documented in the README). It adds no dependency.

The font licences are as listed in the design steering (SIL OFL, to be confirmed by the owner before shipping). This spec does not change that.

### Landing page

`app/page.tsx`: the paragraph class `text-muted` becomes `text-text`. Nothing else on the page changes.

---

## Error handling

| Situation | Behaviour |
|---|---|
| Detector throws | `"threw"` error, other detectors still run, `runDetectors` does not throw. |
| Detector returns a non-array | `"non-array"` error, other detectors still run. |
| Detector returns an invalid item | One `"invalid-finding"` error per item. Valid items of the same detector are kept. |
| Duplicate or empty name | `registerDetector` throws at registration time. The registry is unchanged. |
| Invalid date or negative size in a snapshot or finding | `ZodError` from `parse`, with the Zod path. For nested samples the path starts with `secondSample` or `afterReload`. |

`runDetectors` itself has no failure mode for detector behaviour. If `snapshot` is not a `PageSnapshot`, that is a programming error at the call site and is not handled here.

---

## Test strategy

### Unit tested

**`tests/detectors/registry.test.ts`** is rewritten. It imports `createRegistry` and creates a fresh registry in each test. It uses no `beforeEach` reset and no module reloading. It uses no fake timers and no network. The cases, in the order they are written:

1. Factory: two registries are independent. Methods work when destructured. `Object.keys(await import("@/lib/detectors"))`, sorted, equals `["createRegistry", "defaultRegistry", "registerDetector", "runDetectors"]`, and `_resetRegistryForTests` is not among them.
2. Default registry: a detector registered with a name unique to the test through the module-level `registerDetector` appears in the result of the module-level `runDetectors`.
3. Registration: duplicate name throws and names the duplicate, the first detector then runs once. Empty and whitespace-only names throw `TypeError`. The same name in two registries is accepted. Names differing only in case are both accepted.
4. Running: empty registry gives `{ findings: [], errors: [] }`. Registration order is kept across detectors and within one detector's array. Valid findings give empty `errors`. Calling twice does not accumulate findings.
5. Failures:
   - a detector that throws an `Error`, and one that throws a string;
   - a detector that returns `undefined`, `null`, a plain object and a `Promise` (one case each, using `it.each`);
   - an invalid finding in the middle of an array, checking `findingIndex`, the `finding` JSON and the detector name in `message`;
   - a mixed array where valid items are kept and the invalid item is an error;
   - an item that is `undefined` (`finding` is `"undefined"`) and a circular object (`finding` is `"[unserializable finding]"`);
   - an inline anonymous arrow detector and a function whose `name` is `"default"` (made with `Object.defineProperty(fn, "name", { value: "default" })`) registered under explicit names, checking those names in `detectorName` and `message`;
   - a failing detector registered first, followed by a healthy one: the healthy one's finding is still returned;
   - `JSON.parse(JSON.stringify(errors))` equals `errors`.

**`tests/types/schemas.test.ts`** is extended, existing tests unchanged:

1. Dates: `capturedAt` and `detectedAt` each rejected with `"not a date"` and with `"2025-01-01"`. The existing valid date is still accepted.
2. Nested samples: invalid `capturedAt` in `secondSample` and in `afterReload` (path starts with the key). Missing `tag` in a `secondSample` element (path `["secondSample", "elements", 0, "tag"]`). Invalid element in `afterReload`. Missing `url` in `secondSample`.
3. Bounding box: negative `width`, negative `height`, `0` for both accepted, negative `x` and `y` accepted. One case through `BoundingBoxSchema` directly and one through `FindingSchema.boundingBoxes`.
4. `description` without the "Possible" prefix is accepted. A `title` without it is still rejected.

### Needs a fixture or mock

Only plain in-test fixtures (`PageSnapshot` and `Finding` objects, fake detector functions). No mocks of external services. The `tests/fixtures/boo-tique-ground-truth.json` requirement applies to detectors and is not relevant here, because no detector is added.

### Not automated

- Type scale, fonts and landing page colour. The foundation design already puts visual and font checks outside Vitest, and jsdom and React rendering are not set up. Each of these is checked by reading the changed file back, `npx tsc --noEmit` for `layout.tsx`, and the owner's final checks below.
- Steering and README edits. Checked by reading the files back.

### Owner's final checks (run once, after all four tasks)

1. `npm test`
2. `npm run typecheck`
3. `npm run lint`
4. `npm run build` (needs network access for the Google Fonts download), then open the built CSS and confirm that `.text-4xl` has font size `3.5rem`, line height `3.75rem` and letter spacing `-0.02em`, and that `.font-display`, `.font-body` and `.font-mono` use the `--font-fraunces`, `--font-space-grotesk` and `--font-jetbrains-mono` variables.
5. If `npm ci` is used later and complains about `package-lock.json`, run `npm install` once to refresh the lock file. The `engines` field is not expected to break `npm ci`, but the lock file's root entry was not regenerated by this spec.

---

## Command rules

These apply to every task in this spec. Each task is executed in its own separate run.

The only shell commands available are:

- `npm run typecheck`
- `npm run lint`
- `npm test`
- `npx vitest run <file> --maxWorkers=2` (a single test file)
- `npx tsc --noEmit`

Everything else is denied. That means no `npm install`, no `npm run build`, no `npm run dev`, no watch mode, no command chaining, no redirection, and no `echo`, `ls`, `cat` or `grep`. Use the file read, directory listing, search and write tools for all file work.

During a task, run only the test file the task touched, with `npx vitest run <file> --maxWorkers=2`, and run `npx tsc --noEmit` when types changed. The full `npm test`, `npm run typecheck` and `npm run lint` are run once each by the owner at the end, and a task does not run them.

Tests are written before the implementation they cover (test-first rule). Tasks 3 and 4 have no automated test, so their checks are the read-back and `npx tsc --noEmit` steps listed in the task.

## Risks and notes

- `runDetectors` changes its return shape. The only caller today is the registry test, which this spec rewrites. Future callers (the scan API spec) must read `errors`.
- The foundation tasks (`.kiro/specs/foundation/tasks.md`) stay ticked and are not edited. This spec's requirement table records what replaced what.
- `next/font/google` types come from the installed `next` package. If `npx tsc --noEmit` does not find `Space_Grotesk` or `JetBrains_Mono` in `next/font/google`, stop and report it instead of adding a package.
- The `@theme inline` behaviour described above follows the Tailwind v4 documentation for theme variables that reference other variables. The owner's built-CSS check in step 4 is the confirmation.
