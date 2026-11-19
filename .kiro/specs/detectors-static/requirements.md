# Requirements: Static Detectors

This spec adds the six static detectors for single-page patterns (`fake-urgency`, `fake-scarcity`, `fake-activity`, `confirmshaming`, `preselection`, `visual-interference`), the module that registers them, their English and Turkish word lists, and a test-only harness that scores them against the Boo-tique ground truth. "The system" below means the code under `lib/detectors/` and the tests under `tests/detectors/` that this spec adds. Named constants (in capitals) are defined with their values in `design.md`, section "Constants".

It closes two open notes of the foundation-fixes review: detector registration was undefined (requirement 4) and criterion 3.6 of `foundation-fixes` (parsed copies) had no test (requirement 5).

## Out of scope

- The flow patterns `sneak-into-basket`, `drip-pricing` and `hard-to-cancel`. No static detector emits them, and the evaluation scores none of them.
- The LLM judge, its prompts and any network call. Confirmshaming produces candidates for a later judge; this spec does not build it.
- Any UI, route, API, storage, result page or marker placement.
- Any change to `lib/capture`, `lib/types`, `app/`, `components/`, `lib/boo-tique`, `vitest.config.ts`, `package.json`, existing tests or other specs.
- New dependencies, including `jsdom` and any HTML parser.
- `secondSample`: capture never fills it, and the detectors ignore it.
- `<option>` and `<select>` preselection: the snapshot keeps only the selected option and not its siblings, so a price order cannot be checked.
- Languages other than English and Turkish for text rules.
- A live evaluation through the real capture against the deployed demo. A later opt-in spec owns it.
- Removing the test hook attribute from the capture allow-list. The detectors work in either state.

## 1. Preconditions

**User story:** As the owner, I want the first task to stop when the branch lacks the demo shop work, so that no task builds on files that are missing.

**Acceptance criteria:**

1.1. WHEN task 1 starts THE SYSTEM SHALL confirm that `tests/fixtures/boo-tique-ground-truth.json` exists and that every entry has `detectionSignals` and `detectionNote`.
1.2. WHEN task 1 starts THE SYSTEM SHALL confirm that `lib/boo-tique/styles.ts`, `lib/boo-tique/countdown.ts`, `lib/boo-tique/per-load.ts`, `lib/boo-tique/content.ts`, `lib/boo-tique/cart.ts`, `components/boo-tique/product-page.tsx` and `app/boo-tique/page.tsx` exist.
1.3. WHEN task 1 starts THE SYSTEM SHALL confirm that `tests/boo-tique/helpers/render-route.ts`, `fixture.ts`, `markup.ts` and `route-table.ts` exist, and that `tests/boo-tique/safety.test.ts` exists.
1.4. WHEN task 1 starts THE SYSTEM SHALL confirm that `lib/capture/extractor.ts` and `lib/detectors/index.ts` exist and that `lib/detectors/index.ts` exports `createRegistry`.
1.5. WHEN any file of 1.1 to 1.4 is missing THE SYSTEM SHALL stop task 1 before writing any file and report the missing paths.
1.6. WHEN any task of this spec runs THE SYSTEM SHALL use no `jsdom`, no HTML parser package and no other new dependency.

## 2. Shared detector contract

**User story:** As the scan route author, I want every detector to be a pure, bounded function, so that a hostile or odd page can never crash or slow a scan.

**Acceptance criteria:**

2.1. WHEN any of the six detectors is called with a `PageSnapshot` THE SYSTEM SHALL return an array of findings synchronously.
2.2. WHEN a detector runs THE SYSTEM SHALL make no network call, read no file, write no log and call no `console` method.
2.3. WHEN a detector needs a time THE SYSTEM SHALL use only the `capturedAt` values of the snapshot and its `afterReload` sample.
2.4. WHEN the source files under `lib/detectors/` are scanned THE SYSTEM SHALL find no `Date.now(`, no `new Date()` without an argument, no `Math.random(` and no `performance.now(`.
2.5. WHEN a detector is called twice with the same snapshot, also with other snapshots in between, THE SYSTEM SHALL return deep-equal results.
2.6. WHEN a detector receives a snapshot with an empty `elements` array THE SYSTEM SHALL return an empty array.
2.7. WHEN a detector receives any value, including one that fails `PageSnapshotSchema` (missing arrays, `NaN` or `Infinity` numbers, non-string style fields, `null` elements) THE SYSTEM SHALL return an array and SHALL NOT throw.
2.8. WHEN a detector returns more than one finding THE SYSTEM SHALL order them by the document position of each finding's first element, and by rule order for equal positions.
2.9. WHEN an element has `display` `none`, `visibility` `hidden` or `collapse`, an `opacity` of 0.01 or less, or a zero-size box while it is not a form control THE SYSTEM SHALL treat it as hidden and not use it as evidence.
2.10. WHEN an ancestor of an element (by synthetic id) is in `elements` and is hidden by 2.9 THE SYSTEM SHALL treat the element as hidden.
2.11. WHEN an element used as evidence has `outsideImage` true THE SYSTEM SHALL still use it and SHALL add the sentence "The element lies outside the screenshot." to the description.
2.12. WHEN `capture.elementsTruncated` is true THE SYSTEM SHALL still return findings and SHALL add the sentence "The capture stopped at its element limit, so later parts of the page were not checked." to each description.
2.13. WHEN an element's box holds a non-finite or negative number THE SYSTEM SHALL treat the element as zero-size for measurements and SHALL report the box `{ x: 0, y: 0, width: 0, height: 0 }` if the element is used as evidence.
2.14. WHEN `secondSample` is present THE SYSTEM SHALL ignore it.
2.15. WHEN the import graph of `lib/detectors/` is scanned THE SYSTEM SHALL find that no detector module imports another detector module.

## 3. Finding content and wording

**User story:** As a shopper reading a result, I want each finding to show what was on the screen in calm words, so that I can judge it myself.

**Acceptance criteria:**

3.1. WHEN a detector returns a finding THE SYSTEM SHALL set `title` to the fixed title of the detector's rule as listed in `design.md`, and every title starts with "Possible".
3.2. WHEN a detector returns a finding THE SYSTEM SHALL set `patternId` and `detectorName` to the detector's pattern id.
3.3. WHEN a finding quotes page text THE SYSTEM SHALL wrap it in double quotes, replace any double quote inside it with a single quote, remove control characters and cut it to `MAX_QUOTE_CHARS` characters followed by "…" when longer.
3.4. WHEN a finding rests on a reload difference THE SYSTEM SHALL state both observed values and the gap in whole seconds in `evidence.text`.
3.5. WHEN a finding rests on a reload difference THE SYSTEM SHALL set `evidence.measuredValues.gapSeconds`, and SHALL set `firstValue` and `reloadValue` when the values are numbers.
3.6. WHEN a finding rests on measured style values THE SYSTEM SHALL put each measured number in `evidence.measuredValues` under the key named in `design.md`.
3.7. WHEN a detector returns a finding THE SYSTEM SHALL list the synthetic ids of the evidence elements in `elementIds` and one box per id, in the same order, in `boundingBoxes`, taken from the first sample.
3.8. WHEN a detector returns a finding THE SYSTEM SHALL set `confidence` by the confidence table of that detector in this document.
3.9. WHEN `capturedAt` matches `YYYY-MM-DDTHH:MM:SS(.fraction)Z` and is a real date THE SYSTEM SHALL set `detectedAt` to `new Date(capturedAt).toISOString()`.
3.10. WHEN `capturedAt` is missing or does not match 3.9 THE SYSTEM SHALL set `detectedAt` to `1970-01-01T00:00:00.000Z`, set `evidence.measuredValues.captureTimeUnknown` to 1, and treat the reload gap and the calendar-date comparison as unavailable.
3.11. WHEN any finding string (title, description, explanation, evidence text) is built THE SYSTEM SHALL build it only from the fixed templates in `design.md` plus quoted page text and numbers.
3.12. WHEN quoted page text contains a word of `FORBIDDEN_WORDS` THE SYSTEM SHALL replace that word with "[word omitted]".
3.13. WHEN a finding string still contains a word of `FORBIDDEN_WORDS` after 3.12 THE SYSTEM SHALL drop that finding instead of returning it.
3.14. WHEN page text contains instructions (for example "ignore previous instructions") THE SYSTEM SHALL only quote it and SHALL NOT change any rule outcome because of it.
3.15. WHEN a detector returns a finding THE SYSTEM SHALL produce an object that passes `FindingSchema`.
3.16. WHEN a detector has more than `MAX_FINDINGS_PER_DETECTOR` findings THE SYSTEM SHALL keep the first `MAX_FINDINGS_PER_DETECTOR` in the order of 2.8.
3.17. WHEN findings were dropped by 3.16 THE SYSTEM SHALL append "N more similar findings were not listed." to the last kept finding's description and set its `evidence.measuredValues.omittedFindings` to N.
3.18. WHEN the forbidden-word test runs THE SYSTEM SHALL scan every string of every finding produced by every unit test snapshot and harness snapshot and find none of `FORBIDDEN_WORDS`.

## 4. Registration wiring

**User story:** As the scan route author, I want one explicit entry point that runs all static detectors, so that registration never depends on import side effects (open note "how detectors get registered is still undefined").

**Acceptance criteria:**

4.1. WHEN later code needs the static detectors THE SYSTEM SHALL provide `runAllDetectors(snapshot)` in `lib/detectors/all.ts`, returning a `DetectorRunResult`.
4.2. WHEN `runAllDetectors` runs THE SYSTEM SHALL register the six detectors under their pattern ids in this order: `fake-urgency`, `fake-scarcity`, `fake-activity`, `confirmshaming`, `preselection`, `visual-interference`.
4.3. WHEN `runAllDetectors` or `createStaticRegistry()` is called THE SYSTEM SHALL register into a new registry from `createRegistry()` created by that call.
4.4. WHEN `lib/detectors/all.ts` or any detector module is imported THE SYSTEM SHALL register nothing into any registry, including `defaultRegistry`.
4.5. WHEN `lib/detectors/all.ts` is imported, `vi.resetModules()` is called and it is imported again THE SYSTEM SHALL NOT throw, and both module instances SHALL return deep-equal results for the same snapshot.
4.6. WHEN `lib/detectors/index.ts` is read THE SYSTEM SHALL find that it imports no detector module and still exports exactly `createRegistry`, `defaultRegistry`, `registerDetector` and `runDetectors`.
4.7. WHEN a detector module is imported THE SYSTEM SHALL expose its detector as a named export and SHALL have no default export.
4.8. WHEN `STATIC_DETECTOR_NAMES` is read THE SYSTEM SHALL return the frozen list of 4.2.
4.9. WHEN this spec is complete THE SYSTEM SHALL leave `tests/detectors/registry.test.ts` unchanged and passing.

## 5. Parsed copies

**User story:** As the owner, I want proof that `runDetectors` returns the parsed copies of findings, so that criterion 3.6 of `foundation-fixes` is covered (open note on mutation probe M5).

**Acceptance criteria:**

5.1. WHEN a registered detector returns a valid finding with an extra key THE SYSTEM SHALL return a finding without that key in `findings`.
5.2. WHEN a registered detector returns a valid finding THE SYSTEM SHALL return an object in `findings` that is not the same reference as the returned one.
5.3. WHEN a registered detector returns a valid finding THE SYSTEM SHALL return an `evidence` object that is not the same reference as the original `evidence`.
5.4. WHEN the parsed-copies tests are added THE SYSTEM SHALL put them in the new file `tests/detectors/parsed-copies.test.ts`.

## 6. No test hooks and nothing demo-specific

**User story:** As the owner, I want detectors that work from what a visitor sees, so that verdict words in test hooks or demo tuning can never produce a finding.

**Acceptance criteria:**

6.1. WHEN a detector reads element attributes THE SYSTEM SHALL read only the keys `type`, `name`, `disabled`, `aria-checked`, `aria-label`, `aria-modal` and `aria-live`, each by direct key lookup.
6.2. WHEN snapshot elements carry `data-testid` or any other `data-*` attribute, including ones whose value is a ground-truth id, THE SYSTEM SHALL return the same findings as without them.
6.3. WHEN the files under `lib/detectors/` are scanned, in code, comments, doc comments and data, THE SYSTEM SHALL find no occurrence of the text "testid" in any case (the guard `tests/boo-tique/safety.test.ts` on `main` enforces the same).
6.4. WHEN the files under `lib/detectors/` are scanned THE SYSTEM SHALL find none of the demo terms of `DEMO_TERMS` in `design.md` (shop name, route segments, product, brand and theme words).
6.5. WHEN a field listed under "Ignores" for a detector in `design.md` is changed in a snapshot THE SYSTEM SHALL return the same findings from that detector.
6.6. WHEN detectors decide THE SYSTEM SHALL use only visible text, tag, role, input state, the attributes of 6.1, computed style fields, boxes, synthetic ids and differences to `afterReload`.

## 7. Snapshot reading rules

**User story:** As a detector author, I want one rule set for structure, labels and reload pairs, so that every detector reads the snapshot the same way.

**Acceptance criteria:**

7.1. WHEN a synthetic id is `el-` followed by zero to `MAX_ID_DEPTH` non-negative integers joined by `-`, with at most `MAX_ID_CHARS` characters, THE SYSTEM SHALL treat element A as an ancestor of B when A's integers are a proper prefix of B's integers.
7.2. WHEN a synthetic id does not have the form of 7.1 THE SYSTEM SHALL treat the element as having no ancestors and no descendants.
7.3. WHEN the same claim matches in an element and in one or more of its ancestors THE SYSTEM SHALL report it once, on the deepest matching element.
7.4. WHEN a checkbox, radio or switch needs a label THE SYSTEM SHALL use, in this order: a `label` ancestor at most `LABEL_MAX_LEVELS` levels up; the control's own text; its `aria-label`; the text elements of its parent container when that container holds no other form control ("sole control"); the nearest text element in the parent container or one level above ("nearby").
7.5. WHEN the label was found by the "nearby" step of 7.4 THE SYSTEM SHALL lower the finding's confidence by one level (medium to low; low stays low).
7.6. WHEN no label is found by 7.4 THE SYSTEM SHALL not flag the control.
7.7. WHEN a detector looks for the reload counterpart of a first-sample element THE SYSTEM SHALL take, in this order: the element with the same synthetic id whose text matches the same rule template; the element with the same digit-masked text shape and the same parent id; the only element in the sample with that shape.
7.8. WHEN 7.7 finds no counterpart THE SYSTEM SHALL not apply the reload rule to that element.
7.9. WHEN both `capturedAt` values are valid THE SYSTEM SHALL compute the gap as the reload time minus the first time, in seconds.
7.10. WHEN the gap is below `MIN_GAP_SECONDS`, above `MAX_GAP_SECONDS`, negative or not computable THE SYSTEM SHALL treat the gap as unusable.
7.11. WHEN a first-sample text is longer than the reload text cap THE SYSTEM SHALL compare only claims that lie fully inside the first `RELOAD_TEXT_CAP` characters of both texts.
7.12. WHEN samples are compared THE SYSTEM SHALL compare text and state only, never positions or sizes.
7.13. WHEN an element's background is transparent or translucent THE SYSTEM SHALL resolve the effective background from the nearest ancestors in `elements`, compositing translucent layers.
7.14. WHEN no opaque ancestor background is found THE SYSTEM SHALL use white as the background and set `evidence.measuredValues.backgroundAssumed` to 1 on any finding that uses the contrast.
7.15. WHEN a stock or activity number differs between the first sample and `afterReload` THE SYSTEM SHALL count it as "the number changes across two independent loads" for the medium cap of `findings-wording.md` (decision and reasoning in `design.md`).
7.16. WHEN a detector is given a snapshot without `afterReload` THE SYSTEM SHALL give every reload-dependent rule at most low confidence.

## 8. fake-urgency

**User story:** As a shopper, I want countdowns that restart and rolling deadlines pointed out, while real dated sales stay quiet.

**Acceptance criteria:**

8.1. WHEN text holds `HH:MM:SS`, `H:MM:SS`, `MM:SS` or `M:SS` with valid minute and second fields THE SYSTEM SHALL parse it as a countdown in seconds with a display unit of 1 s.
8.2. WHEN text holds up to four number-unit pairs in English (`d`, `day(s)`, `h`, `hr(s)`, `hour(s)`, `m`, `min(s)`, `minute(s)`, `s`, `sec(s)`, `second(s)`) or Turkish (`gün`, `saat`, `dk`, `dakika`, `sn`, `saniye`) THE SYSTEM SHALL parse it as a countdown whose display unit is its smallest unit.
8.3. WHEN a clock token is preceded within two tokens by a calendar date or by "at" or "saat", or is followed by `am`, `pm` or a time-zone token of `TIME_ZONE_TOKENS` THE SYSTEM SHALL treat it as a time of day and not as a countdown.
8.4. WHEN the countdown's element or its parent container holds a word of the urgency or offer lists THE SYSTEM SHALL mark the countdown "worded".
8.5. WHEN the gap is usable and the reload value exceeds the first value, and differs from first value plus gap by more than the tolerance THE SYSTEM SHALL classify the pair "restarted".
8.6. WHEN the gap is usable and the reload value exceeds the first value by the gap within the tolerance THE SYSTEM SHALL classify the countdown "counting up" and apply no countdown rule to it.
8.7. WHEN the gap is usable and the first value minus the reload value is less than the gap minus the tolerance and not negative THE SYSTEM SHALL classify the pair "unchanged" (this covers a paused display and a restart that already ticked).
8.8. WHEN the gap is usable and the first value minus the reload value equals the gap within the tolerance THE SYSTEM SHALL classify the pair "consistent".
8.9. WHEN the first value minus the reload value exceeds the gap plus the tolerance THE SYSTEM SHALL classify the pair "faster" and apply only the text rule.
8.10. WHEN the tolerance is needed THE SYSTEM SHALL use `TOLERANCE_BASE_SECONDS` plus the countdown's display unit.
8.11. WHEN text holds a rolling-deadline phrase of the urgency list (for example "ends at midnight", "ends tonight", "today only", "gece yarısı", "sadece bugün") and no calendar date in the same element THE SYSTEM SHALL return a rolling-deadline finding.
8.12. WHEN text holds a calendar date (day, month name from the English or Turkish month table, optional year; ISO `YYYY-MM-DD`; `DD.MM.YYYY`; month-first English) THE SYSTEM SHALL parse it without `Date.parse`.
8.13. WHEN a slash date `NN/NN/YYYY` reads as two different valid dates THE SYSTEM SHALL mark it ambiguous.
8.14. WHEN an element's only urgency signal is deadline wording next to a calendar date that is not more than `DATE_ZONE_SLACK_HOURS` before `capturedAt`, ambiguous, or without year THE SYSTEM SHALL return no finding for that element.
8.15. WHEN a calendar date with future deadline wording ("ends", "sona eriyor", "bitiyor") lies more than `DATE_ZONE_SLACK_HOURS` before `capturedAt` THE SYSTEM SHALL return a passed-deadline finding.
8.16. WHEN `capturedAt` is unusable THE SYSTEM SHALL treat every calendar date as "no year" for 8.14 and never apply 8.15.
8.17. WHEN text holds a shipping cut-off phrase of the look-alike list (for example "order within 2h for next-day delivery", "aynı gün kargo") THE SYSTEM SHALL return no text-only finding for that element.
8.18. WHEN fake-urgency assigns a confidence THE SYSTEM SHALL use the first matching row:

| Row | Observed in one element | Confidence |
|---|---|---|
| U1 | Countdown with a look-alike match (calendar date or shipping cut-off) and "restarted" or "unchanged" | low |
| U2 | Worded countdown, "restarted" | high |
| U3 | Worded countdown, "unchanged" | medium |
| U4 | Unworded `HH:MM:SS` countdown, "restarted" | medium |
| U5 | Worded countdown, "consistent", "faster", no counterpart, no reload or unusable gap | low |
| U6 | Rolling-deadline phrase (8.11) | low |
| U7 | Passed deadline (8.15) | low |
| U8 | Anything else, including an unworded countdown that is not U4 | no finding |

8.19. WHEN no `afterReload` sample exists THE SYSTEM SHALL return at most low-confidence fake-urgency findings.

## 9. fake-scarcity

**User story:** As a shopper, I want low-stock claims that change on reload or follow a stock template pointed out, while plain inventory counts stay quiet.

**Acceptance criteria:**

9.1. WHEN text matches a qualified stock template of the scarcity list (a qualifier such as "only", "just", "sadece", "son" plus a number plus a stock word) THE SYSTEM SHALL mark a qualified stock claim with that number.
9.2. WHEN text matches a bare stock template ("# left", "# in stock", "# adet kaldı") without a qualifier THE SYSTEM SHALL mark a bare stock claim, used only by the reload rule.
9.3. WHEN text matches an unquantified scarcity phrase (for example "selling fast", "almost gone", "low stock", "tükenmek üzere") THE SYSTEM SHALL mark an unquantified claim.
9.4. WHEN a qualified claim has a number of at most `LOW_STOCK_MAX`, an exclamation mark, an urgency word, or another scarcity claim on the same page THE SYSTEM SHALL mark it "supported".
9.5. WHEN text matches a scarcity look-alike phrase (items in cart, review counts, "left for free shipping", "ücretsiz kargo") THE SYSTEM SHALL return no finding for that claim.
9.6. WHEN a stock claim's counterpart (7.7) holds the same template with a different number THE SYSTEM SHALL mark the claim "changed".
9.7. WHEN a stock claim's counterpart holds the same number THE SYSTEM SHALL apply the rows without "changed", as if no reload existed.
9.8. WHEN fake-scarcity assigns a confidence THE SYSTEM SHALL use the first matching row:

| Row | Observed | Confidence |
|---|---|---|
| S1 | Qualified claim, "changed" across the reload | high |
| S2 | Bare claim, "changed" across the reload | medium |
| S3 | Qualified claim, "supported", not changed | medium |
| S4 | Qualified claim, not supported, not changed | low |
| S5 | Unquantified claim | low |
| S6 | Bare claim with equal numbers or no counterpart | no finding |

9.9. WHEN no `afterReload` sample exists THE SYSTEM SHALL produce no S1 or S2 finding.
9.10. WHEN an honest fixed number appears as a bare claim with the same number in both samples THE SYSTEM SHALL return no finding.

## 10. fake-activity

**User story:** As a shopper, I want viewer counts and purchase toasts that change on reload pointed out.

**Acceptance criteria:**

10.1. WHEN text matches a viewer or cart-count template of the activity list (for example "# people are viewing this", "# kişi bu ürünü inceliyor") THE SYSTEM SHALL mark a count claim with that number.
10.2. WHEN text matches a purchase template ("Name from Place just bought", "Place'dan Name az önce satın aldı") with capitalised name and place words in the original text THE SYSTEM SHALL mark a purchase claim.
10.3. WHEN the claim's element or an ancestor in `elements` has role `status`, `alert`, `log` or `marquee`, `aria-live` other than `off`, or position `fixed` or `sticky`, or the text holds "right now" or "şu anda" THE SYSTEM SHALL mark the claim "in context".
10.4. WHEN a count claim's counterpart holds the same template with a different number, or a purchase claim's counterpart (same id) holds the purchase template with different text THE SYSTEM SHALL mark the claim "changed".
10.5. WHEN text matches an activity look-alike (review counts, "# items in your cart", "sepetinizde # ürün") THE SYSTEM SHALL return no finding for that claim.
10.6. WHEN fake-activity assigns a confidence THE SYSTEM SHALL use the first matching row:

| Row | Observed | Confidence |
|---|---|---|
| A1 | Count or purchase claim, "changed" across the reload | high |
| A2 | Claim "in context", not changed | medium |
| A3 | Claim not in context, not changed | low |

10.7. WHEN no `afterReload` sample exists THE SYSTEM SHALL produce no A1 finding.

## 11. confirmshaming

**User story:** As a later LLM judge, I want shaming decline options sent to me as clearly marked candidates, so that I classify only plausible cases.

**Acceptance criteria:**

11.1. WHEN buttons, links or `role="button"` elements share a nearest common ancestor at most `GROUP_MAX_LEVELS` levels above each THE SYSTEM SHALL treat them as one choice group.
11.2. WHEN a choice group holds an accept-like control and another control THE SYSTEM SHALL treat the other control as a decline control.
11.3. WHEN a decline control's normalised text, without punctuation, equals an entry of the plain-decline list ("no thanks", "not now", "maybe later", "hayır teşekkürler", "şimdi değil") THE SYSTEM SHALL never make it a candidate.
11.4. WHEN a decline control's text matches an entry of the shaming phrase list THE SYSTEM SHALL return a phrase-list finding.
11.5. WHEN a decline control's text holds a first-person token, a negation or emotional token, and a benefit or loss token of the lists, and 11.4 does not match THE SYSTEM SHALL return a candidate finding.
11.6. WHEN a phrase-list match occurs outside any choice group THE SYSTEM SHALL return a candidate finding.
11.7. WHEN a confirmshaming finding is returned THE SYSTEM SHALL set `evidence.measuredValues.judgeCandidate` to 1 and `phraseListMatch` to 1 for a phrase-list finding and 0 for a candidate.
11.8. WHEN a confirmshaming finding is returned THE SYSTEM SHALL list the decline control first in `elementIds` and the accept control second when one exists.
11.9. WHEN confirmshaming assigns a confidence THE SYSTEM SHALL use the first matching row:

| Row | Observed | Confidence |
|---|---|---|
| C1 | Phrase-list match on a decline control in a choice group | medium |
| C2 | Candidate (11.5 or 11.6) | low |

11.10. WHEN the decline and accept controls have equal style THE SYSTEM SHALL still apply 11.4 and 11.5 (style is visual-interference's business).

## 12. preselection

**User story:** As a shopper, I want options that were ticked for me and cost money or give consent pointed out, while required defaults and the cheapest choice stay quiet.

**Acceptance criteria:**

12.1. WHEN an element is an `input` with `type` `checkbox` or `radio` and `checked` true THE SYSTEM SHALL consider it preselected.
12.2. WHEN an element has role `switch` or `checkbox` and `aria-checked` `"true"` THE SYSTEM SHALL consider it preselected.
12.3. WHEN a control is not checked, or is disabled, or has `display` `none` or `visibility` `hidden` THE SYSTEM SHALL not flag it.
12.4. WHEN a checked input is hidden only by opacity or a zero-size box and its label is visible THE SYSTEM SHALL still consider it.
12.5. WHEN a label holds a price (currency symbol or code next to a number, optional "+"; for example "+$4.99", "4,99 TL", "₺1.299,90", "€4,99", "$1,299.90") THE SYSTEM SHALL parse it into integer minor units.
12.6. WHEN a label holds "free" or "ücretsiz" and no price THE SYSTEM SHALL use a price of 0.
12.7. WHEN a label holds words of the lists THE SYSTEM SHALL class it as "consent", "paid add-on", "neutral" or "unclassed", where "neutral" applies when a neutral term is present and no consent term is present.
12.8. WHEN radios share the same `name` and a nearest common ancestor at most `GROUP_MAX_LEVELS` levels up THE SYSTEM SHALL treat them as one radio group.
12.9. WHEN a radio group's checked radio has a positive price above the group's lowest price THE SYSTEM SHALL return a radio-group finding.
12.10. WHEN a radio group's checked radio is the cheapest or free THE SYSTEM SHALL return no finding for that group.
12.11. WHEN a radio in a group has no price and its label holds a "none" word ("no", "none", "without", "yok", "istemiyorum") THE SYSTEM SHALL use a price of 0 for it.
12.12. WHEN a radio in a group has no price and no "none" word THE SYSTEM SHALL skip the group's price rule.
12.13. WHEN a radio group's container text or legend holds a required-choice word (shipping, delivery, size, colour, kargo, teslimat, beden, renk) THE SYSTEM SHALL mark the group "required".
12.14. WHEN preselection assigns a confidence THE SYSTEM SHALL use the first matching row, then apply 7.5:

| Row | Observed | Confidence |
|---|---|---|
| P1 | Checkbox or switch with a positive price | medium |
| P2 | Checkbox or switch classed "consent" | medium |
| P3 | Checkbox or switch classed "paid add-on" without a price | low |
| P4 | Radio group finding (12.9), group not "required" | medium |
| P5 | Radio group finding (12.9), group "required" | low |
| P6 | Neutral, unclassed without price, price 0, or cheapest radio | no finding |

12.15. WHEN preselection runs THE SYSTEM SHALL ignore `afterReload` and never return high confidence.
12.16. WHEN a radio is checked THE SYSTEM SHALL judge it only by the radio-group rule (12.8 to 12.13), never by rows P1 to P3.
12.17. WHEN a finding is returned THE SYSTEM SHALL quote the label, state the parsed price when there is one, and list the control first and the label element second in `elementIds` when they differ.

## 13. visual-interference

**User story:** As a shopper, I want accept and reject choices of very unequal weight pointed out with the measured numbers, while equal choices stay quiet.

**Acceptance criteria:**

13.1. WHEN a choice group (11.1) holds an accept-like control and a reject-like or lesser control (options, settings, manage) THE SYSTEM SHALL treat them as a pair.
13.2. WHEN the pair's container or an ancestor in `elements` has role `dialog` or `alertdialog`, `aria-modal` `"true"`, position `fixed` or `sticky`, or the container's subtree holds a consent word THE SYSTEM SHALL mark the pair "in context".
13.3. WHEN a pair is not in context THE SYSTEM SHALL return no finding for it.
13.4. WHEN a pair is measured THE SYSTEM SHALL compute area ratio (accept over decline), font-size ratio, decline contrast, accept contrast (text colour with alpha and opacity composited on the effective background), decline opacity, filled versus transparent background, and tag (`a` versus `button`).
13.5. WHEN the accept and decline controls have equal normalised `color`, `backgroundColor`, `fontSize` and `opacity` and an area ratio of at most `EQUAL_AREA_RATIO_MAX` in either direction THE SYSTEM SHALL return no finding for the pair.
13.6. WHEN a measure meets its threshold (area ratio > `AREA_RATIO_MIN`, font ratio > `FONT_RATIO_MIN`, decline font < `SMALL_FONT_PX`, decline contrast < `DECLINE_CONTRAST_MAX` while accept contrast ≥ `ACCEPT_CONTRAST_MIN`, decline opacity < `DECLINE_OPACITY_MAX`, accept filled and decline transparent, accept `button` and decline `a` or plain text, no reject-like control in a consent context) THE SYSTEM SHALL count it as one passing measure of its class (size, colour or structure).
13.7. WHEN the contrast measure used an assumed background (7.14) THE SYSTEM SHALL count it toward medium but not toward high.
13.8. WHEN a dialog context holds a close control (text "x", "×", "✕", "✖" or an `aria-label` of the close list) THE SYSTEM SHALL measure it as a close control.
13.9. WHEN a close control has width and height below `CLOSE_MIN_PX` THE SYSTEM SHALL count "tiny close".
13.10. WHEN a close control's contrast is below `CLOSE_CONTRAST_MIN` THE SYSTEM SHALL count "faint close".
13.11. WHEN the same dialog holds an accept-like control with an area at least `AREA_RATIO_MIN` times the close control's area THE SYSTEM SHALL count "dominant action".
13.12. WHEN visual-interference assigns a confidence THE SYSTEM SHALL use the first matching row:

| Row | Observed | Confidence |
|---|---|---|
| V1 | Pair with 3 or more passing measures in at least 2 classes, one of them size or colour (13.7 applied) | high |
| V2 | Pair with exactly 2 passing measures | medium |
| V3 | Close control with "tiny close", "faint close" (background not assumed) and "dominant action" | high |
| V4 | Close control with two of the three close measures | medium |
| V5 | Pair or close control with fewer than 2 measures, or equal style (13.5) | no finding |

13.13. WHEN only wording differs between accept and decline THE SYSTEM SHALL return no visual-interference finding.
13.14. WHEN a finding is returned THE SYSTEM SHALL list the decline or close control first and the accept control second, with the measured numbers in `evidence.measuredValues`.

## 14. Word lists and languages

**User story:** As the owner, I want English and Turkish word lists kept apart from the logic, with one text normaliser, so that adding words never touches rules.

**Acceptance criteria:**

14.1. WHEN a detector uses words or phrases THE SYSTEM SHALL read them from TypeScript data modules under `lib/detectors/data/` that export readonly records keyed by `en` and `tr`.
14.2. WHEN text is compared with a list THE SYSTEM SHALL first pass both through `normaliseText`: Unicode NFKC, removal of zero-width characters and soft hyphens, apostrophe and dash unification, explicit mapping of "İ", "I" and "ı" to "i", then `toLowerCase()` without locale, removal of U+0307, and whitespace collapse.
14.3. WHEN `normaliseText` receives "İ", "I", "ı" or "i" THE SYSTEM SHALL return "i" for each.
14.4. WHEN the source under `lib/detectors/` is scanned THE SYSTEM SHALL find no `toLocaleLowerCase` and no `toLocaleUpperCase`.
14.5. WHEN each detector's tests run THE SYSTEM SHALL include at least one flagged and one look-alike case in English and in Turkish for every text rule of that detector.
14.6. WHEN a page is in another language (for example Spanish "¡Solo quedan 2!" or German "Nur noch 2 auf Lager") THE SYSTEM SHALL return no text-pattern finding.
14.7. WHEN a page is in another language THE SYSTEM SHALL still apply the language-independent rules: the restart rule for unworded `HH:MM:SS` countdowns (U4), checked checkboxes and switches with a "+" price (P1), the radio-group price order (P4, P5), and a tiny and faint glyph close control in a dialog (V4).
14.8. WHEN the generality test runs THE SYSTEM SHALL find that no list entry holds a word of `DEMO_TERMS`, no entry equals or contains a full planted text of the Boo-tique (its content constants, toast messages, club offer texts and the quoted strings of the fixture's `element` fields), and no entry is longer than `MAX_PHRASE_TOKENS` tokens.
14.9. WHEN a list entry is added THE SYSTEM SHALL require it to come from section B of `docs/research/dark-patterns.md` or common shop wording, as a review rule stated at the top of each data file.

## 15. Safety against hostile input

**User story:** As the operator, I want detectors whose work is bounded on any page, so that a hostile shop cannot stall a scan.

**Acceptance criteria:**

15.1. WHEN a detector reads text, role, tag, a style field, an attribute value or an id THE SYSTEM SHALL cut it to its cap (`MAX_TEXT_READ`, `MAX_ROLE_TAG_READ`, `MAX_STYLE_READ`, `MAX_ATTR_READ`, `MAX_ID_CHARS`) before any other work.
15.2. WHEN a detector reads attributes THE SYSTEM SHALL never iterate the attribute record.
15.3. WHEN a sample has more than `MAX_ELEMENTS_CONSIDERED` elements (reload: `MAX_RELOAD_ELEMENTS_CONSIDERED`) THE SYSTEM SHALL ignore the rest and add the sentence of 2.12 to each description.
15.4. WHEN text is tokenised THE SYSTEM SHALL keep at most `MAX_TOKENS_PER_TEXT` tokens.
15.5. WHEN choice groups are built THE SYSTEM SHALL consider at most `MAX_CHOICE_GROUPS` groups and `MAX_CONTROLS_PER_GROUP` controls per group.
15.6. WHEN the source under `lib/detectors/` is scanned THE SYSTEM SHALL find regular expressions only in `lib/detectors/shared/patterns.ts`, and no `new RegExp` or `RegExp(` anywhere.
15.7. WHEN the patterns test reads each entry of `SAFE_PATTERNS` THE SYSTEM SHALL find no `+`, no `*`, no `{n,}`, no quantifier other than `?` after a closing parenthesis, no quantifier inside a group that is followed by a quantifier, and every bound at most 300.
15.8. WHEN the hostile-input test feeds a 1,000,000-character text, 10,000 elements, 5,000 repeated near-matches, a 10,000-segment id, a 1,000,000-character style string and an element with 10,000 attributes THE SYSTEM SHALL finish each detector within `HOSTILE_TIME_BUDGET_MS`, return at most `MAX_FINDINGS_PER_DETECTOR` findings that pass `FindingSchema`, and quote no text longer than `MAX_QUOTE_CHARS` plus the ellipsis.

## 16. Evaluation harness

**User story:** As the owner, I want snapshots of the demo pages that cannot drift from the shop and carry no verdict hints, so that the scores mean something.

**Acceptance criteria:**

16.1. WHEN harness snapshots are built THE SYSTEM SHALL build them from hand-authored page trees in `tests/detectors/eval/helpers/`, whose texts, input states and roles mirror the rendered pages, whose styles come from `lib/boo-tique/styles.ts` and the palette, and whose synthetic ids come from tree position.
16.2. WHEN the structural sync test runs THE SYSTEM SHALL render each harness route with `renderRoute` and assert that every planted text, checked state, `aria-checked` value, `name` attribute and role of the page tree appears in the markup, in the same relative order.
16.3. WHEN the structural sync test runs THE SYSTEM SHALL assert that every inline style value used for a planted element (font size, colour, background, opacity) appears in that element's opening tag in the markup.
16.4. WHEN a product reload pair is built THE SYSTEM SHALL take the stock and viewer numbers from `perLoadValues(random)` with injected random functions, and the sync test SHALL render `createProductPage(random)` with the same functions and find those numbers.
16.5. WHEN any reload sample is built THE SYSTEM SHALL apply the light rules of the capture: text cap 120, element cap 750, attributes `type`, `name` and `disabled` only, no `outsideImage`, `capture.light` true.
16.6. WHEN the club timer pair is built THE SYSTEM SHALL show a reload value equal to the first value minus the gap (same-session storage keeps counting).
16.7. WHEN the sold toast pair is built THE SYSTEM SHALL show the first toast message in both samples.
16.8. WHEN the hero countdown pairs are built THE SYSTEM SHALL provide an "equal" pair (04:59:59 both) and an "increase" pair (04:59:58 then 04:59:59), both with a 9 s gap.
16.9. WHEN the randomised product claims are evaluated THE SYSTEM SHALL provide a differing pair and a coinciding pair (same stock and same viewer number).
16.10. WHEN any harness snapshot is built THE SYSTEM SHALL assert that no element has a `data-testid` attribute or any `data-*` attribute.
16.11. WHEN findings are mapped to ground-truth entries THE SYSTEM SHALL do so only inside `tests/detectors/eval/helpers/`, by a side table from entry id to page-tree node keys.
16.12. WHEN the harness is documented THE SYSTEM SHALL state in `design.md` that it cannot prove true layout geometry, computed styles of class-based CSS, real client ticking, the content of the real light reload sample or real viewport effects, and that a later opt-in live evaluation covers them.

## 17. Evaluation targets and scoring

**User story:** As the owner, I want a readable score per entry and hard targets, so that a regression in recall or precision fails a test.

**Acceptance criteria:**

17.1. WHEN the scorable flag set is built THE SYSTEM SHALL take every `flag` entry of the fixture whose `detectionSignals` is not `["not-static"]`: 19 entries (the owner expected about 17; the fixture gives 19): `home-hero-countdown-restart`, `home-rolling-midnight-text`, `home-cookie-accept-dominant`, `home-cookie-ghost-reject`, `product-low-stock-random`, `product-viewers-random`, `product-selling-fast-badge`, `product-almost-gone-tiny`, `product-sold-toast`, `product-upsell-modal-tiny-close`, `cart-protection-prechecked`, `cart-warranty-radio-preselected`, `cart-packaging-switch-on`, `checkout-newsletter-prechecked`, `club-modal-hate-saving`, `club-modal-full-price-mortal`, `club-modal-no-need-protection`, `club-timer-session-restart`, `newsletter-partners-prechecked`.
17.2. WHEN the scorable set is built THE SYSTEM SHALL exclude the three `not-static` entries `cart-insurance-sneaked`, `checkout-handling-fees-drip` and `account-cancel-five-screens`.
17.3. WHEN the look-alike set is built THE SYSTEM SHALL take all 8 `no-flag` entries: `home-fixed-date-sale`, `home-cookie-equal-buttons`, `product-real-inventory-3-left`, `cart-gift-wrap-unchecked`, `cart-cheapest-shipping-default`, `checkout-consistent-shipping-tax`, `club-plain-no-thanks`, `account-one-click-cancel-plan`.
17.4. WHEN the report is printed THE SYSTEM SHALL name the 17 entries whose planted signal one page plus one same-session reload can show: the 19 of 17.1 without `product-sold-toast` (rotation needs 6 s; both reads show the first message) and `club-timer-session-restart` (the restart needs 10 minutes or a fresh context).
17.5. WHEN `product-sold-toast` is scored THE SYSTEM SHALL expect a text-only A2 finding (role `status`) and count it for recall.
17.6. WHEN `club-timer-session-restart` is scored THE SYSTEM SHALL expect a text-only U5 finding and count it for recall.
17.7. WHEN a finding is matched to a flag entry THE SYSTEM SHALL count a hit only when its `patternId` equals the entry's pattern and its `elementIds` include a node of that entry (row level).
17.8. WHEN a static finding's `elementIds` include a node of a look-alike entry THE SYSTEM SHALL count a false positive.
17.9. WHEN any static finding is returned on the honest checkout (`?flow=honest`) or honest account (`?plan=honest`) page THE SYSTEM SHALL count a false positive for that page's look-alike entry.
17.10. WHEN a finding has pattern `sneak-into-basket`, `drip-pricing` or `hard-to-cancel` THE SYSTEM SHALL not score it, and a separate assertion SHALL find that `runAllDetectors` returns none on any harness snapshot.
17.11. WHEN a static finding matches no entry THE SYSTEM SHALL list it as "unplanted" in the report and fail the eval if its confidence is medium or high.
17.12. WHEN the eval runs THE SYSTEM SHALL require recall of at least 0.8 on the 19 entries (at least 16 hits) with the primary pairs (differing product pair, "equal" hero pair).
17.13. WHEN the eval runs THE SYSTEM SHALL require zero false positives on the 8 look-alike entries.
17.14. WHEN the eval runs THE SYSTEM SHALL print a table per detector with found, missed and false positives, and one row per entry with its expected verdict, the returned confidences and the result.
17.15. WHEN a target of 17.12, 17.13 or 17.11 is missed THE SYSTEM SHALL fail with an assertion message that contains the table.
17.16. WHEN the differing product pair is evaluated THE SYSTEM SHALL expect S1 (high) for `product-low-stock-random` and A1 (high) for `product-viewers-random`.
17.17. WHEN the coinciding product pair is evaluated THE SYSTEM SHALL expect S3 (medium) for `product-low-stock-random` and A3 (low) for `product-viewers-random`, and no finding for `product-real-inventory-3-left`.
17.18. WHEN the hero pairs are evaluated THE SYSTEM SHALL expect U3 (medium) for the "equal" pair and U2 (high) for the "increase" pair.

## 18. Steering and doc corrections

**User story:** As a future contributor, I want the steering files and doc comments to describe the wiring that exists, so that I do not add self-registering detectors.

**Acceptance criteria:**

18.1. WHEN the final task runs THE SYSTEM SHALL replace the `structure.md` line "The default export is the detector function" with the named-export and `all.ts` wiring rule.
18.2. WHEN the final task runs THE SYSTEM SHALL replace the `structure.md` sentence "Detectors get individual specs (e.g. `.kiro/specs/detector-fake-urgency/`)" with one that names `.kiro/specs/detectors-static/` as the spec for all six static detectors.
18.3. WHEN the final task runs THE SYSTEM SHALL update the `structure.md` directory listing to show the six detector files, `all.ts`, `shared/` and `data/` under `lib/detectors/`, and the new test files under `tests/detectors/`.
18.4. WHEN the final task runs THE SYSTEM SHALL add to the "Detectors" section of `tech.md` that `runAllDetectors` in `lib/detectors/all.ts` is the entry point, that it builds a fresh registry per call, and where the word lists live.
18.5. WHEN the final task runs THE SYSTEM SHALL replace the doc comment of `defaultRegistry` in `lib/detectors/index.ts` with one that says nothing registers into it and points to `lib/detectors/all.ts`, changing no export.
18.6. WHEN the final task runs THE SYSTEM SHALL run `npm run lint` once and report its result.

## Amendments (detectors-static-fixes)

The spec `.kiro/specs/detectors-static-fixes/` amends the items below. Each line says what changed and names the requirement of that spec. No other line of this file changed. Task 7 of that spec (backgrounds behind uncaptured layers, its requirement 11) was not run, so old criteria 13.6 and 13.7 carry no amendment.

- 2.7: a detector still returns an array for odd values and does not throw on them, but an unexpected exception is no longer caught inside the detector. It propagates, and `runDetectors` reports it in `errors` (requirement 6.1, 6.3, 6.9).
- 2.13: same change as 2.7. A non-finite or negative box number is odd input and gives an array; an exception raised while reading a field is reported in `errors` (requirement 6.3, 6.4, 6.9).
- 3.12: a word is masked as "[word omitted]" when it is a word of `FORBIDDEN_WORDS` or starts with a forbidden stem plus at most `FORBIDDEN_STEM_EXTRA_MAX` letters, in English and Turkish (requirement 5.1, 5.3, 5.4, 5.9).
- 3.13: a finding is dropped when a string still holds a whole forbidden word or a word that starts with a forbidden stem (requirement 5.2, 5.7).
- 3.18: the forbidden-word scan no longer reads the findings of the per-detector unit tests, which cannot be observed from another test file. It reads the findings of one row snapshot per rule row, every Boo-tique variant, every hold-out case and page texts that carry banned words, in `tests/detectors/wording.test.ts` (requirement 5.6, 5.7, 5.8).
- 7.14: task 7 not run; the criterion is unchanged so far (requirement 11 is open).
- 8.4: a countdown of the form `units` or `clock2` is "worded" only when the same element holds a countdown cue word; `clock3` keeps the old rule (requirement 7.3, 7.4).
- 8.18 (rows U1 and U5): the two rows apply to a `units` or `clock2` countdown only with a cue word, and a lone one-letter unit ("5 m", "1 M") or an upper-case unit among several pairs is no countdown (requirement 7.1, 7.2, 7.3, 7.5, 7.11).
- 9.3: the unquantified scarcity phrases "selling fast" and "almost gone", and the Turkish forms by stem, are in the lists again (requirement 2.1, 2.2, 9.7).
- 9.4: a qualified stock claim is "supported" by an exclamation mark, a pressure word in the element or its parent, or another scarcity claim on the page. A number of at most `LOW_STOCK_MAX` no longer counts; the constant stays defined and pinned but no rule uses it (requirement 8.1, 8.2, 8.5).
- 10.2: the purchase entries with "az önce" ("@'dan @ az önce satın aldı", "@'den @ az önce satın aldı") and the timed English purchase templates ("@ in @ purchased" and the like, with a time word in the same element) are restored (requirement 2.4, 2.5, 10.1, 10.2).
- 14.8: replaced. New rule, quoted from requirement 3.1 of the fixes spec: "WHEN the generality test runs THE SYSTEM SHALL find that no list entry holds a word of `DEMO_TERMS`, that no entry is longer than `MAX_PHRASE_TOKENS` elements as counted by `compilePhrases`, and that every entry of a word or phrase list occurs, after `normaliseText`, in at least one text of `tests/fixtures/real-world-phrases.json`." An entry may equal or contain a planted Boo-tique text (requirement 3.1, 3.2, 3.3).
- New 14.10: WHEN a list entry would exceed `MAX_PHRASE_TOKENS` elements it is shortened only from its start or its end, never by removing an inner word (requirement 2.7, 2.8).
- 17.6: the club timer entry `club-timer-session-restart` is an accepted miss. "Join in 09:59 for 20% off" holds no countdown cue, so its text-only U5 hit is gone and the Boo-tique result is 18 of 19 (requirement 7.7, 12.3).
- New 17.19: the hold-out evaluation (`tests/detectors/eval/holdout-eval.test.ts`) runs the 28 flag cases, the 20 honest cases and the extras, prints a table and asserts only that every case ran without a detector error, the case counts, and a sanity floor of recall at least 0.5 over the 28 flag cases; there is no assertion about false positives (requirement 4.5, 4.6, 12.11).
