# Tasks: Static Detectors

Rules for every task:

- Each top-level task is executed in its own separate run. Do not start the next task in the same run. At the start, read `requirements.md` and `design.md` of this spec; the "Uses" line of a task names what earlier tasks provide.
- The only shell commands available are `npx vitest run <file> --maxWorkers=2` (one test file per command), `npx tsc --noEmit`, and `npm run lint` only in task 16. Everything else is denied: no install, no build, no dev server, no watch mode, no `@latest`, no network, no command chaining, no redirection, no `echo`, `ls`, `cat` or `grep`. Use the file tools for file work.
- During a task, run only the test files the task touched, then `npx tsc --noEmit`. Do not run the full suite; the owner runs it once at the end.
- Write the test first, then the code that makes it pass. Tests are `.ts` files with no JSX, import with the `@/` alias, open no browser, never import `playwright-core` and make no network call.
- Never read or write `.env` files. Add no dependency (no `jsdom`, no HTML parser). If one seems needed, stop and report.
- Allowed edits: new files under `lib/detectors/` and `tests/detectors/`. Only task 16 edits `.kiro/steering/structure.md`, `.kiro/steering/tech.md` and the `defaultRegistry` doc comment in `lib/detectors/index.ts`. Never edit `lib/capture`, `lib/types`, `lib/boo-tique`, `app/`, `components/`, `vitest.config.ts`, `package.json`, `tests/detectors/registry.test.ts`, any other existing test, any other spec, or anything in `.kiro/agents`, `.kiro/hooks` or `.kiro/settings`.
- Never write the word "testid" (any case) in any file under `lib/detectors/`, including comments, doc comments and data; in code comments say "test hook attributes". Under `tests/detectors/`, only `tests/detectors/eval/helpers/no-hooks.ts` may contain that word (also inside names such as `testIds`); other tests import what they need from it, including the markup lookup by hook that the sync test uses.
- Detectors never read `data-*` attributes, class names, `Date.now()`, `new Date()` without an argument, `Math.random()` or `toLocaleLowerCase`. Regular expressions live only in `lib/detectors/shared/patterns.ts`.
- Word lists stay generic (research section B or common shop wording). Never add a word to make a Boo-tique entry pass; if a target is missed, report it.
- Use the file, type and function names of `design.md` exactly.

- [x] 1. Preconditions, stubs and wiring
  - Uses: nothing from earlier tasks; `createRegistry`, `defaultRegistry`, `Detector`, `Registry`, `DetectorRunResult` from `@/lib/detectors`, `Finding`, `PageSnapshot` from `@/lib/types`.
  - Files: creates `tests/detectors/all.test.ts`, `tests/detectors/parsed-copies.test.ts`, `lib/detectors/all.ts` and the six detector stubs.
  - [x] 1.1 With the file tools only, check that these exist: `tests/fixtures/boo-tique-ground-truth.json` (read it; every entry has `detectionSignals` and `detectionNote`), `lib/boo-tique/styles.ts`, `countdown.ts`, `per-load.ts`, `content.ts`, `cart.ts`, `components/boo-tique/product-page.tsx`, `app/boo-tique/page.tsx`, `tests/boo-tique/helpers/render-route.ts`, `fixture.ts`, `markup.ts`, `route-table.ts`, `tests/boo-tique/safety.test.ts`, `lib/capture/extractor.ts`, and `lib/detectors/index.ts` exporting `createRegistry`. If any is missing, write no file, stop and report the missing paths.
  - [x] 1.2 Create `tests/detectors/all.test.ts` first, part one: `STATIC_DETECTOR_NAMES` equals the six names in the order of requirement 4.2 and is frozen; `runAllDetectors` on an empty snapshot returns `{ findings: [], errors: [] }`; two calls of `createStaticRegistry()` return different registries.
  - [x] 1.3 In the same file, part two: after `import("@/lib/detectors/all")`, `vi.resetModules()` and a second dynamic import, both module instances' `runAllDetectors` succeed without throwing and return deep-equal results for the same snapshot.
  - [x] 1.4 In the same file, part three: importing `all.ts` adds no detector to `defaultRegistry` (its run gives no finding whose `detectorName` is a static name); each of the six detector modules has no `default` export; `Object.keys` of `@/lib/detectors` is still the four names; `lib/detectors/index.ts`, read with `readFileSync`, imports no detector module.
  - [x] 1.5 Create `tests/detectors/parsed-copies.test.ts`: register a detector on `createRegistry()` that returns a valid finding with an extra key `extra: 1`; the returned finding lacks `extra`, is not the same reference, and its `evidence` is not the same reference. Do not edit `tests/detectors/registry.test.ts`.
  - [x] 1.6 Create the six stubs `lib/detectors/fake-urgency.ts` (`detectFakeUrgency`), `fake-scarcity.ts` (`detectFakeScarcity`), `fake-activity.ts` (`detectFakeActivity`), `confirmshaming.ts` (`detectConfirmshaming`), `preselection.ts` (`detectPreselection`), `visual-interference.ts` (`detectVisualInterference`); each is `(snapshot: PageSnapshot) => Finding[]` returning `[]`, named export only. Later tasks replace the bodies.
  - [x] 1.7 Create `lib/detectors/all.ts` with `STATIC_DETECTOR_NAMES`, `STATIC_DETECTORS`, `createStaticRegistry()` and `runAllDetectors(snapshot)` as in design section 6; no registry at module level. Define `StaticPatternId` locally for now; task 4 moves it to `shared/finding.ts`.
  - [x] 1.8 Run `npx vitest run tests/detectors/all.test.ts --maxWorkers=2`, `npx vitest run tests/detectors/parsed-copies.test.ts --maxWorkers=2`, `npx vitest run tests/detectors/registry.test.ts --maxWorkers=2`, then `npx tsc --noEmit`.
  _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 2.1, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 5.1, 5.2, 5.3, 5.4_

- [x] 2. Constants, safe patterns and text helpers
  - Uses: nothing from earlier tasks.
  - Files: creates `lib/detectors/shared/constants.ts`, `shared/patterns.ts`, `shared/text.ts`, `data/forbidden-words.ts` and `tests/detectors/shared/constants.test.ts`, `patterns.test.ts`, `text.test.ts`.
  - [x] 2.1 Create `tests/detectors/shared/constants.test.ts` first: every constant of design section 4 has its value.
  - [x] 2.2 Create `tests/detectors/shared/patterns.test.ts`: for each `SAFE_PATTERNS` entry, `.source` has no `+`, no `*`, no `{n,}`, no quantifier other than `?` after `)`, no quantified group whose body has a quantifier, and every `{m,n}` bound ≤ 300; `isoUtc` accepts `2026-12-01T12:00:00.000Z` and rejects `2026-12-01T12:00:00+02:00` and `2026-12-01`.
  - [x] 2.3 Create `tests/detectors/shared/text.test.ts`, normalising: `normaliseText` gives `"i"` for each of "İ", "I", "ı", "i"; "İSTANBUL" and "istanbul" normalise equal; NFKC (fullwidth digits, "ﬁ"); zero-width characters and the soft hyphen removed; curly apostrophes and dashes unified; whitespace collapsed; non-strings give ""; the cap is applied before any other work.
  - [x] 2.4 In the same file, tokens and phrases: `tokenise` splits "2h 30m", keeps "04:59:59", "4,99" and "1.299,90" as one number token each, keeps `surface` casing and stops at `MAX_TOKENS_PER_TEXT`; `compilePhrases` and `findPhrases` handle `#` and `@` placeholders, English and Turkish entries, give no match across a missing token, and stay bounded on 5,000 repeated near-matches.
  - [x] 2.5 In the same file, quoting: `quote` adds double quotes, swaps inner `"` for `'`, strips control characters, cuts to 120 characters plus "…", and masks a forbidden word as "[word omitted]"; `maskDigits("Only 4 left")` equals `maskDigits("Only 7 left")`.
  - [x] 2.6 Create `lib/detectors/shared/constants.ts`, `lib/detectors/shared/patterns.ts`, `lib/detectors/data/forbidden-words.ts` (`FORBIDDEN_WORDS` of design section 7) and `lib/detectors/shared/text.ts` (`Language`, `WordList`, `Token`, `normaliseText`, `tokenise`, `PhraseMatcher`, `compilePhrases`, `PhraseHit`, `findPhrases`, `hasAny`, `quote`, `maskDigits`). No regex outside `patterns.ts`; whitespace collapse and tokenising use character loops.
  - [x] 2.7 Run the three test files (one command each), then `npx tsc --noEmit`.
  _Requirements: 3.3, 3.12, 14.2, 14.3, 15.4, 15.6, 15.7_

- [x] 3. Element index, reload pairs and labels
  - Uses: `normaliseText`, `tokenise`, constants and `SAFE_PATTERNS` from task 2.
  - Files: creates `lib/detectors/shared/elements.ts`, `shared/samples.ts`, `shared/labels.ts` and `tests/detectors/shared/elements.test.ts`, `samples.test.ts`, `labels.test.ts`.
  - [x] 3.1 Create `tests/detectors/shared/elements.test.ts` first, structure: ids `el-1-1` and `el-1-10` are not ancestor-related; `el-` is the root; ids with letters, over 256 characters or over 64 segments give `path: null`; elements given out of order come back in path order; `subtree` and `ancestors` work on a ten-element tree; `commonPath` of two cousins is their grandparent's path.
  - [x] 3.2 In the same file, fields: hidden by `display: none`, `visibility: hidden`, `collapse`, opacity "0.01", a zero box for a `span` but not for an `input`, and by a hidden ancestor; `NaN`, `Infinity` and negative boxes give a zero box and area 0; `attr()` returns only `AttrKey` values and never reads `data-*` (use an attributes object whose other keys have throwing getters); text, role, tag and style fields are cut to their caps; more than 1,500 elements sets `budgetHit`; `capture.elementsTruncated` sets `captureTruncated`.
  - [x] 3.3 Create `tests/detectors/shared/samples.test.ts`: gap 9 s from valid times; `null` gap below 3 s, above 120 s, negative, or with an invalid time; `findCounterpart` by same id and template, then by same masked shape in the same parent, then by the unique shape in the sample, else `null`; a 300-character first text compared on its first 120 characters only; no `afterReload` gives `reload: null`; `secondSample` is never read.
  - [x] 3.4 Create `tests/detectors/shared/labels.test.ts`: label ancestor; own text; `aria-label`; "sole" container (a `span` and a `role="switch"` button under one parent, as on a shop cart row); "nearby" when the container holds two controls; `null` when nothing is found.
  - [x] 3.5 Create `lib/detectors/shared/elements.ts` (`IndexedElement`, `AttrKey`, `ElementIndex`, `buildIndex`) first, run `elements.test.ts`, then create `lib/detectors/shared/samples.ts` (`SamplePair`, `buildSamplePair`, `findCounterpart`) and `lib/detectors/shared/labels.ts` (`LabelMatch`, `findLabel`) as in design section 7.
  - [x] 3.6 Run the three test files (one command each), then `npx tsc --noEmit`.
  _Requirements: 2.9, 2.10, 2.13, 2.14, 6.1, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 7.9, 7.10, 7.11, 7.12, 7.16, 15.1, 15.2, 15.3_

- [x] 4. Finding builder
  - Uses: `quote`, `FORBIDDEN_WORDS` (task 2), `IndexedElement`, `ElementIndex` (task 3).
  - Files: creates `lib/detectors/shared/finding.ts` and `tests/detectors/shared/finding.test.ts`; edits `lib/detectors/all.ts`.
  - [x] 4.1 Create `tests/detectors/shared/finding.test.ts` first, time and shape: `detectedAtFrom` keeps a valid `Z` time and returns the epoch with `ms: null` for `""`, `"2026-12-01"`, an offset time and a non-string; drafts become findings that pass `FindingSchema`, with `detectorName` equal to `patternId`, a title from `TITLES` starting with "Possible", `explanation` from `EXPLANATIONS`, ids and boxes in draft order, a zero box for an invalid box; `captureTimeUnknown: 1` is set for the epoch case.
  - [x] 4.2 In the same file, notes and caps: outside-screenshot and truncation sentences are added; a draft with a forbidden word in its template text is dropped; 25 drafts give 20 findings sorted by element order then `ruleOrder`, and the last says "5 more similar findings were not listed." with `omittedFindings: 5`; `lowerConfidence` maps medium to low and low to low; every title and explanation in `TITLES` and `EXPLANATIONS` has no forbidden word.
  - [x] 4.3 Create `lib/detectors/shared/finding.ts` (`StaticPatternId`, `FindingDraft`, `FindingContext`, `detectedAtFrom`, `finaliseFindings`, `lowerConfidence`, `containsForbidden`, `TITLES`, `EXPLANATIONS`) with the titles and explanations of design section 7. Change `lib/detectors/all.ts` to import `StaticPatternId` from it.
  - [x] 4.4 Run `npx vitest run tests/detectors/shared/finding.test.ts --maxWorkers=2`, `npx vitest run tests/detectors/all.test.ts --maxWorkers=2`, then `npx tsc --noEmit`.
  _Requirements: 2.8, 2.11, 2.12, 2.13, 3.1, 3.2, 3.7, 3.9, 3.10, 3.11, 3.13, 3.15, 3.16, 3.17_

- [x] 5. Countdown and calendar-date parsers
  - Uses: `tokenise`, `Token`, `compilePhrases` (task 2).
  - Files: creates `lib/detectors/data/months.ts`, `shared/countdown.ts`, `shared/calendar-date.ts` and `tests/detectors/shared/countdown.test.ts`, `calendar-date.test.ts`.
  - [x] 5.1 Create `tests/detectors/shared/countdown.test.ts` first: `04:59:59` gives 17,999 s unit 1; `9:59` and `09:59`; `04:61:00` is rejected (minutes over 59 in the three-part form) and `75:00` parses as 4,500 s; "2h 30m", "1 day 3 hours", "3 days" (unit 86,400), "2 gün 4 saat", "15 dk 30 sn"; "23:59 UTC", "at 23:59", "saat 23:59", "8:30 pm" and "28 Feb 2027, 23:59" are times of day, not countdowns.
  - [x] 5.2 Create `tests/detectors/shared/calendar-date.test.ts`: "28 Feb 2027", "February 28, 2027", "28 Şubat 2027", "28 şubat", "2027-02-28", "28.02.2027" parse as full or no-year; "29 Feb 2027" and "31 Nisan 2027" are invalid; "03/04/2027" is ambiguous and "13/04/2027" is not; `endMs` uses the stated time when present, else 23:59:59 UTC; no `Date.parse` is used (source read).
  - [x] 5.3 Create `lib/detectors/data/months.ts` (`MONTHS`, `TIME_ZONE_TOKENS`), `lib/detectors/shared/countdown.ts` (`Countdown`, `parseCountdowns`) and `lib/detectors/shared/calendar-date.ts` (`CalendarDate`, `parseCalendarDates`).
  - [x] 5.4 Run both test files (one command each), then `npx tsc --noEmit`.
  _Requirements: 8.1, 8.2, 8.3, 8.12, 8.13_

- [x] 6. fake-urgency detector
  - Uses: `buildSamplePair`, `findCounterpart`, `buildIndex` (task 3), `finaliseFindings`, `detectedAtFrom` (task 4), `parseCountdowns`, `parseCalendarDates` (task 5), text helpers (task 2).
  - Files: creates `lib/detectors/data/urgency-words.ts` and `tests/detectors/fake-urgency.test.ts`; edits `lib/detectors/fake-urgency.ts`.
  - [x] 6.1 Create `tests/detectors/fake-urgency.test.ts` first with small hand-built snapshots (generic shop wording, no Boo-tique strings), reload rows: each class of the countdown table in design section 9.1 with a 9 s gap; rows U2, U3 and U5 in English and Turkish; restart without wording gives U4 for `HH:MM:SS` and nothing for `MM:SS`; a countdown with a calendar date in the same element gives U1; no reload gives only low findings; a 2 s, a 200 s and a negative gap behave as no usable gap; evidence states both values and the gap and sets `firstValue`, `reloadValue`, `gapSeconds`.
  - [x] 6.2 In the same file, text rows and look-alikes: U6 for "ends at midnight" and "sadece bugün" without a date; future, yearless and ambiguous dates with "ends" give no finding; a date 2 days before `capturedAt` with "ends" gives U7; an unusable `capturedAt` never gives U7; "Order within 2h for next-day delivery" and "aynı gün kargo" give no text finding; a time of day next to a date is not a countdown.
  - [x] 6.3 In the same file, shared contract: the same claim in a parent and a child is reported once on the child; an empty snapshot gives `[]`; `null`, a string and an object without `elements` give `[]`; two calls give deep-equal results; findings are in document order.
  - [x] 6.4 Create `lib/detectors/data/urgency-words.ts` with the lists of design section 9.1 and the review rule comment at the top.
  - [x] 6.5 Replace the stub in `lib/detectors/fake-urgency.ts` with `detectFakeUrgency` as in design section 9.1, wrapped in `try`/`catch` returning `[]`.
  - [x] 6.6 Run `npx vitest run tests/detectors/fake-urgency.test.ts --maxWorkers=2`, then `npx tsc --noEmit`.
  _Requirements: 2.1, 2.5, 2.6, 2.7, 3.4, 3.5, 3.8, 7.16, 8.4, 8.5, 8.6, 8.7, 8.8, 8.9, 8.10, 8.11, 8.14, 8.15, 8.16, 8.17, 8.18, 8.19, 14.5_

- [x] 7. fake-scarcity detector
  - Uses: tasks 2 to 4 helpers (`tokenise`, `findPhrases`, `buildSamplePair`, `findCounterpart`, `finaliseFindings`).
  - Files: creates `lib/detectors/data/scarcity-words.ts` and `tests/detectors/fake-scarcity.test.ts`; edits `lib/detectors/fake-scarcity.ts`.
  - [x] 7.1 Create `tests/detectors/fake-scarcity.test.ts` first, reload rows: a differing qualified pair gives S1 high; a coinciding pair gives S3 medium; no reload never gives S1 or S2; a bare "3 left" equal in both samples gives nothing; a bare count that changes gives S2; evidence holds both numbers and the gap; English and Turkish for each.
  - [x] 7.2 In the same file, text rows and look-alikes: "supported" by number ≤ 10, "!", an urgency word or a second claim (S3), else S4; look-alikes ("2 items in your cart", "120 reviews", "$5 left for free shipping", "sepetinizde 2 ürün") give nothing; unquantified wording ("Selling fast", "Tükenmek üzere") gives S5 low; Spanish "¡Solo quedan 2!" gives nothing; empty and non-object inputs give `[]`.
  - [x] 7.3 Create `lib/detectors/data/scarcity-words.ts` with the lists of design section 9.2.
  - [x] 7.4 Replace the stub in `lib/detectors/fake-scarcity.ts` with `detectFakeScarcity`, wrapped in `try`/`catch` returning `[]`.
  - [x] 7.5 Run `npx vitest run tests/detectors/fake-scarcity.test.ts --maxWorkers=2`, then `npx tsc --noEmit`.
  _Requirements: 3.4, 3.5, 3.8, 7.15, 7.16, 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 9.9, 9.10, 14.5_

- [x] 8. fake-activity detector
  - Uses: tasks 2 to 4 helpers; `@` placeholder of `findPhrases`.
  - Files: creates `lib/detectors/data/activity-words.ts` and `tests/detectors/fake-activity.test.ts`; edits `lib/detectors/fake-activity.ts`.
  - [x] 8.1 Create `tests/detectors/fake-activity.test.ts` first, reload rows: a count claim that changes gives A1; a purchase toast (`role="status"`) whose text changes under the same id gives A1; the same toast text in both samples gives A2; no reload never gives A1; English and Turkish for each.
  - [x] 8.2 In the same file, context and look-alikes: a plain paragraph count gives A3; `aria-live="polite"`, position `fixed` and "right now" each give context (A2); lower-case names do not match the purchase template; look-alikes ("1,204 reviews", "3 items in your cart", "sepetinizde 3 ürün") give nothing; empty and non-object inputs give `[]`.
  - [x] 8.3 Create `lib/detectors/data/activity-words.ts` with the lists of design section 9.3.
  - [x] 8.4 Replace the stub in `lib/detectors/fake-activity.ts` with `detectFakeActivity`, wrapped in `try`/`catch` returning `[]`.
  - [x] 8.5 Run `npx vitest run tests/detectors/fake-activity.test.ts --maxWorkers=2`, then `npx tsc --noEmit`.
  _Requirements: 3.4, 3.5, 3.8, 7.15, 7.16, 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 14.5_

- [x] 9. Choice groups and confirmshaming detector
  - Uses: `buildIndex`, `ElementIndex` (task 3), `finaliseFindings` (task 4), text helpers (task 2).
  - Files: creates `lib/detectors/shared/choice-groups.ts`, `data/choice-words.ts`, `data/confirmshaming-words.ts`, `tests/detectors/shared/choice-groups.test.ts`, `tests/detectors/confirmshaming.test.ts`; edits `lib/detectors/confirmshaming.ts`.
  - [x] 9.1 Create `tests/detectors/shared/choice-groups.test.ts` first: controls under one parent and up to three levels share a group; four levels apart do not; at most 50 groups and 8 controls per group; `classifyControl` for accept, reject, lesser, close glyphs and `aria-label="Close"`, and exact plain declines ("No thanks", "Hayır, teşekkürler").
  - [x] 9.2 Create `tests/detectors/confirmshaming.test.ts`: C1 for a phrase-list decline next to an accept control (English and Turkish); C2 for first-person negative wording with a benefit term; "No thanks", "Not now", "Maybe later", "Şimdi değil" never flag, also with equal style; "I don't need a bag" does not flag; a phrase-list hit outside a group gives C2; `measuredValues` has `judgeCandidate: 1` and the right `phraseListMatch`; `elementIds` lists decline then accept.
  - [x] 9.3 Create `lib/detectors/data/choice-words.ts` (lists of design section 9.6 plus the plain declines and accept words of section 9.4) and `lib/detectors/shared/choice-groups.ts` (`ControlKind`, `ChoiceGroup`, `findChoiceGroups`, `classifyControl`); run `choice-groups.test.ts`.
  - [x] 9.4 Create `lib/detectors/data/confirmshaming-words.ts` (lists of design section 9.4) and replace the stub in `lib/detectors/confirmshaming.ts` with `detectConfirmshaming`, wrapped in `try`/`catch` returning `[]`.
  - [x] 9.5 Run both test files (one command each), then `npx tsc --noEmit`.
  _Requirements: 3.8, 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 11.8, 11.9, 11.10, 14.5, 15.5_

- [x] 10. Price parser and preselection detector
  - Uses: `findLabel` (task 3), `finaliseFindings`, `lowerConfidence` (task 4), text helpers (task 2).
  - Files: creates `lib/detectors/shared/price.ts`, `data/preselection-words.ts`, `tests/detectors/shared/price.test.ts`, `tests/detectors/preselection.test.ts`; edits `lib/detectors/preselection.ts`.
  - [x] 10.1 Create `tests/detectors/shared/price.test.ts` first: "+$4.99" (499, plus), "$1,299.90", "4,99 TL", "₺1.299,90", "€4,99", "4.99 €", "USD 12", "Free" and "Ücretsiz" handled by the detector as 0, no price in "Size 42"; amounts over the limit ignored.
  - [x] 10.2 Create `tests/detectors/preselection.test.ts`, checkboxes and switches: rows P1 to P3 and P6 in English and Turkish; a checked checkbox in a `label` with "+$4.99" gives P1 medium; a checked consent checkbox gives P2; a `role="switch"` with `aria-checked="true"` labelled by a sibling span (sole) gives P1; "nearby" lowers to low; an unchecked option, a disabled one and a "Remember me" box give nothing; a German "+4,99 €" checked box gives P1; no high confidence ever.
  - [x] 10.3 In the same file, radio groups: a group with a checked +$9.00 option above a $0.00 one gives P4; the cheapest checked shipping radio gives nothing; a pricier checked shipping radio gives P5 low; an unpriced radio without a "none" word skips the group; a checked radio never uses P1 to P3; evidence quotes the label and the cheapest option; empty and non-object inputs give `[]`.
  - [x] 10.4 Create `lib/detectors/shared/price.ts` (`Price`, `parsePrices`) and run `price.test.ts`; then create `lib/detectors/data/preselection-words.ts` (lists of design section 9.5) and replace the stub in `lib/detectors/preselection.ts` with `detectPreselection`, wrapped in `try`/`catch` returning `[]`.
  - [x] 10.5 Run both test files (one command each), then `npx tsc --noEmit`.
  _Requirements: 3.8, 7.5, 7.6, 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7, 12.8, 12.9, 12.10, 12.11, 12.12, 12.13, 12.14, 12.15, 12.16, 12.17, 14.5_

- [x] 11. Colour helpers and visual-interference detector
  - Uses: `findChoiceGroups`, `classifyControl`, `CONSENT_CONTEXT_WORDS` (task 9), `buildIndex` (task 3), `finaliseFindings` (task 4).
  - Files: creates `lib/detectors/shared/colour.ts`, `tests/detectors/shared/colour.test.ts`, `tests/detectors/visual-interference.test.ts`; edits `lib/detectors/visual-interference.ts`.
  - [x] 11.1 Create `tests/detectors/shared/colour.test.ts` first: `rgb(154, 154, 154)`, `rgba(0, 0, 0, 0)`, `rgb(154 154 154 / 0.5)`, `#fff9ee`, `transparent`, and junk or a 1,000,000-character string giving `null`; contrast of black on white is 21 and of `#9a9a9a` on `#fff9ee` about 2.7; opacity 0.6 lowers the contrast of `#b3b3b3`; the effective background comes from an ancestor in `elements`, else white with `assumed: true`.
  - [x] 11.2 Create `tests/detectors/visual-interference.test.ts`, pairs: V1 for a large filled accept button next to a small grey link in a cookie region; V1 for a faded ghost reject in a consent area; V2 for exactly two measures; equal style never flags, also with different wording; a pair outside any context never flags; an assumed background cannot give high; measured values use the keys of design section 9.6; a Turkish cookie banner works.
  - [x] 11.3 In the same file, close controls: V3 for a 3 × 8 px faint "x" in a `role="dialog"` with a large accept; V4 for two close measures; a toast dismiss "×" in `role="status"` is not a close control; a German dialog with a tiny faint "×" gives V4; empty and non-object inputs give `[]`.
  - [x] 11.4 Create `lib/detectors/shared/colour.ts` (`Rgba`, `parseColour`, `composite`, `contrastRatio`, `effectiveBackground`, `textContrast`), run `colour.test.ts`, then replace the stub in `lib/detectors/visual-interference.ts` with `detectVisualInterference`, wrapped in `try`/`catch` returning `[]`.
  - [x] 11.5 Run both test files (one command each), then `npx tsc --noEmit`.
  _Requirements: 3.6, 3.8, 7.13, 7.14, 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.7, 13.8, 13.9, 13.10, 13.11, 13.12, 13.13, 13.14, 14.5_

- [x] 12. Cross-detector rules, word lists and hostile input
  - Uses: the six detectors and `runAllDetectors` (tasks 1, 6 to 11), every data module.
  - Files: creates `tests/detectors/eval/helpers/no-hooks.ts`, `tests/detectors/helpers/demo-terms.ts`, `tests/detectors/source-rules.test.ts`, `word-lists.test.ts`, `hostile-input.test.ts`; may fix files under `lib/detectors/`.
  - [x] 12.1 Create `tests/detectors/eval/helpers/no-hooks.ts`: export the hook attribute name, `assertNoTestHooks(snapshot)` (throws when any element of either sample has a `data-*` attribute), `sourceMentionsHookWord(text)` (case-insensitive) and `tagForEntry(html, entryId)`, which returns the opening tag (and `textOf`) of the element that carries the entry id as its hook value, built on the `markup` helpers of `tests/boo-tique/helpers/markup.ts` (read that file first). Create `tests/detectors/helpers/demo-terms.ts`: `DEMO_TERMS` of design section 14 and `plantedTexts()`, which returns `FIXED_SALE_TEXT`, `ROLLING_MIDNIGHT_TEXT`, `HERO_COUNTDOWN_LABEL` (from `@/lib/boo-tique/content`), `SOLD_TOAST_MESSAGES` (from `@/lib/boo-tique/countdown`), the club accept and decline texts copied from `components/boo-tique/club-offers.tsx`, and the single-quoted strings inside the `element` fields of `tests/fixtures/boo-tique-ground-truth.json`.
  - [x] 12.2 Create `tests/detectors/source-rules.test.ts` first: for every file under `lib/detectors/` read with `readFileSync`: `sourceMentionsHookWord` is false; no `Date.now(`, `new Date()`, `Math.random(`, `performance.now(`, `toLocaleLowerCase`, `toLocaleUpperCase`, `Date.parse(`, `new RegExp`, `RegExp(` and no `console.`; regex literals and regex methods only in `shared/patterns.ts`; no detector file imports another detector file; no file imports `lib/capture`, `lib/boo-tique` or `tests/`; no word of `DEMO_TERMS` appears as a whole word.
  - [x] 12.3 Create `tests/detectors/word-lists.test.ts`: every data module exports `en` and `tr` arrays where design says so, each frozen and non-empty; no entry is longer than `MAX_PHRASE_TOKENS` tokens; no entry contains a `DEMO_TERMS` word; no normalised entry equals or contains a normalised text of `plantedTexts()`; every data file starts with the review-rule comment; Spanish and German snapshots give no text-pattern finding while U4, P1, P4 and V4 cases in those languages still flag.
  - [x] 12.4 Create `tests/detectors/hostile-input.test.ts`, bounds: every case of the hostile table in design section 11, per detector, within `HOSTILE_TIME_BUDGET_MS`; at most 20 findings, all passing `FindingSchema`; quoted page text at most 120 characters plus the ellipsis; spies on `globalThis.fetch` and `console` are never called.
  - [x] 12.5 In the same file, invariance and wording: adding `data-*` attributes (the hook name from `no-hooks.ts` with ground-truth ids as values) leaves every detector's output unchanged; changing each detector's "Ignores" fields of design section 9 leaves its output unchanged; injected instruction text does not change outcomes; every string of every finding produced in this file has no `FORBIDDEN_WORDS`; two runs give deep-equal output.
  - [x] 12.6 Fix only detector or helper code if a test fails; never weaken a test or add a word to pass it.
  - [x] 12.7 Run the three test files (one command each), `npx vitest run tests/boo-tique/safety.test.ts --maxWorkers=2`, then `npx tsc --noEmit`.
  _Requirements: 2.2, 2.3, 2.4, 2.5, 2.7, 2.15, 3.11, 3.14, 3.18, 6.2, 6.3, 6.4, 6.5, 6.6, 14.1, 14.4, 14.6, 14.7, 14.8, 14.9, 15.6, 15.8_

- [x] 13. Harness snapshot builder and light sample
  - Uses: `PageSnapshotSchema` from `@/lib/types`, `assertNoTestHooks` (task 12).
  - Files: creates `tests/detectors/eval/helpers/tree.ts`, `tests/detectors/eval/helpers/light.ts`, `tests/detectors/eval/tree.test.ts`.
  - [x] 13.1 Read `lib/capture/extractor.ts` again for the eligibility, text and attribute rules the builder mirrors.
  - [x] 13.2 Create `tests/detectors/eval/tree.test.ts` first, builder: `buildSnapshot` gives `el-1` for `<body>` and child-index ids below it; a `div` without own text and role is left out but its children keep their ids; a zero-size `span` is left out and a zero-size `input` kept; a `label`'s text includes its descendants' text; `#9a9a9a` becomes `rgb(154, 154, 154)` and `20px` stays `20px`; a missing style gets the defaults of design section 13; `keyToId` maps node keys to ids and is not part of the snapshot; the result passes `PageSnapshotSchema`.
  - [x] 13.3 In the same file, light sample and hooks: `toLightSample` cuts text to 120, keeps only `type`, `name`, `disabled`, drops `outsideImage` and `capture.images`, sets `capture.light`, caps elements at 750; `assertNoTestHooks` passes on every built snapshot and throws on a tree node with a `data-*` attribute.
  - [x] 13.4 Create `tests/detectors/eval/helpers/tree.ts` (`PageNode`, `buildSnapshot`, style conversion, box estimate) and `tests/detectors/eval/helpers/light.ts` (`toLightSample`).
  - [x] 13.5 Run `npx vitest run tests/detectors/eval/tree.test.ts --maxWorkers=2`, then `npx tsc --noEmit`.
  _Requirements: 16.1, 16.5, 16.10_

- [x] 14. Boo-tique page trees and structural sync
  - Uses: `buildSnapshot`, `PageNode` (task 13), `toLightSample` (task 13), `assertNoTestHooks` (task 12), `renderRoute`, `loadFixture` and the `markup` helpers on `main`, `createProductPage` and `perLoadValues`.
  - Files: creates `tests/detectors/eval/helpers/pages.ts`, `tests/detectors/eval/helpers/entry-map.ts`, `tests/detectors/eval/snapshot-sync.test.ts`.
  - [x] 14.1 Read `tests/boo-tique/helpers/render-route.ts`, `markup.ts`, `fixture.ts`, `route-table.ts`, every component used by the seven Boo-tique pages (including the layout shell, `overlay-dialog.tsx`, `product-grid.tsx`, `club-timer.tsx`, `order-summary.tsx`, `summary-list.tsx`) and the Boo-tique stylesheet.
  - [x] 14.2 Create `tests/detectors/eval/snapshot-sync.test.ts` first: for each variant render with `renderRoute(route, { shell: true })` (product variants: `createProductPage(random)` with the injected random functions, rendered the way `render-route.ts` renders); assert, finding planted elements in the markup with `tagForEntry` from `no-hooks.ts`, that planted texts, checked states, `aria-checked`, `name` attributes, roles and inline style values match, planted nodes are in markup order, every visible text run of the markup appears in the tree, the product numbers equal `perLoadValues(random)`, `entry-map.ts` covers every scored fixture entry, and `assertNoTestHooks` passes on every snapshot. Run it; it fails.
  - [x] 14.3 Create `tests/detectors/eval/helpers/pages.ts`: one tree factory per variant of design section 13 with the shell included, styles from `lib/boo-tique/styles.ts` and `PALETTE`, class-based styles taken from the stylesheet, the reload trees of requirements 16.6 to 16.9, and `PAGE_VARIANTS`.
  - [x] 14.4 Create `tests/detectors/eval/helpers/entry-map.ts`: entry id to variant and node keys as in design section 13; a node key for every one of the 27 scored entries (19 flag, 8 look-alike).
  - [x] 14.5 Run `npx vitest run tests/detectors/eval/snapshot-sync.test.ts --maxWorkers=2`, then `npx tsc --noEmit`.
  _Requirements: 16.1, 16.2, 16.3, 16.4, 16.6, 16.7, 16.8, 16.9, 16.10, 16.11, 16.12_

- [ ] 15. Scoring and the Boo-tique evaluation
  - Uses: `PAGE_VARIANTS` (task 14), entry map (task 14), `loadFixture`, `runAllDetectors` (task 1), `FORBIDDEN_WORDS` (task 2).
  - Files: creates `tests/detectors/eval/helpers/score.ts`, `tests/detectors/eval/score.test.ts`, `tests/detectors/eval/boo-tique-eval.test.ts`.
  - [ ] 15.1 Create `tests/detectors/eval/score.test.ts` first with synthetic findings: a row-level hit; a wrong pattern is a miss; a finding on a look-alike node is a false positive; any finding on a whole-page look-alike is a false positive; flow-pattern findings are ignored; an unmatched finding is "unplanted"; `formatTable` output lists every entry; `recallOf` counts hits over the 19.
  - [ ] 15.2 Create `tests/detectors/eval/helpers/score.ts` (`score`, `formatTable`, `recallOf`, unplanted list).
  - [ ] 15.3 Create `tests/detectors/eval/boo-tique-eval.test.ts`, sets: derive the 19 scorable ids, the 3 excluded ids and the 8 look-alike ids from the fixture with `loadFixture()` and assert they equal the lists of requirement 17; assert the 17-entry list of requirement 17.4.
  - [ ] 15.4 In the same file, targets: run `runAllDetectors` on every variant of `PAGE_VARIANTS`; print the table; assert recall ≥ 0.8 with the primary pairs, zero false positives, no medium or high unplanted finding, no flow-pattern finding, the expected rows of design section 13 for the primary and secondary pairs (S1, A1, U3; S3, A3, U2), and no `FORBIDDEN_WORDS` in any finding string; each failing assertion message contains the table.
  - [ ] 15.5 If a target is missed, report the table and the cause; do not change word lists or thresholds to fit a Boo-tique string.
  - [ ] 15.6 Run `npx vitest run tests/detectors/eval/score.test.ts --maxWorkers=2`, `npx vitest run tests/detectors/eval/boo-tique-eval.test.ts --maxWorkers=2`, then `npx tsc --noEmit`.
  _Requirements: 3.18, 17.1, 17.2, 17.3, 17.4, 17.5, 17.6, 17.7, 17.8, 17.9, 17.10, 17.11, 17.12, 17.13, 17.14, 17.15, 17.16, 17.17, 17.18_

- [ ] 16. Steering, doc comment and lint
  - Uses: the files of tasks 1 to 15.
  - Files: edits `.kiro/steering/structure.md`, `.kiro/steering/tech.md` and the `defaultRegistry` doc comment in `lib/detectors/index.ts`; nothing else.
  - [ ] 16.1 In `.kiro/steering/structure.md`, replace "The default export is the detector function." with: each static detector file exports one named pure function (`detectFakeUrgency` and so on) and has no default export and no import side effects; `lib/detectors/all.ts` registers them in a fixed order on a fresh registry per call and exposes `runAllDetectors`.
  - [ ] 16.2 In the same file, replace "Detectors get individual specs (e.g. `.kiro/specs/detector-fake-urgency/`)." with a sentence that `.kiro/specs/detectors-static/` covers all six static detectors; update the directory listing so `lib/detectors/` shows `index.ts`, `all.ts`, the six detector files (with `fake-activity.ts`), `shared/` and `data/`, and `tests/detectors/` shows the detector tests, `shared/`, `helpers/`, `eval/` and the new cross-detector tests. Change nothing else.
  - [ ] 16.3 In `.kiro/steering/tech.md`, "Detectors" section, add that `runAllDetectors` in `lib/detectors/all.ts` is the entry point, builds a fresh registry per call, and that word lists live in `lib/detectors/data/` (English and Turkish). Change nothing else.
  - [ ] 16.4 In `lib/detectors/index.ts`, replace only the doc comment above `defaultRegistry` with: nothing registers into it; the static detectors run through `runAllDetectors` in `lib/detectors/all.ts`. Change no code and no export.
  - [ ] 16.5 Run `npx vitest run tests/detectors/registry.test.ts --maxWorkers=2`, `npx vitest run tests/detectors/all.test.ts --maxWorkers=2`, `npx vitest run tests/detectors/source-rules.test.ts --maxWorkers=2`, `npx tsc --noEmit`, then `npm run lint` once; fix lint findings only in files this spec created, and report the result.
  _Requirements: 4.9, 18.1, 18.2, 18.3, 18.4, 18.5, 18.6_
