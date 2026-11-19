# Requirements: Static Detector Fixes

This spec answers the independent review `docs/research/detectors-static-review.md` (written by a Claude review agent, not by Kiro) of the static detectors built under `.kiro/specs/detectors-static/` (branch `feat/detectors`, head `c21325f`). It changes `lib/detectors/` and `tests/detectors/`, adds one fixture, and amends the old spec's text where it changes a criterion. "Review Qn" means section Qn of that document. "The system" means the code under `lib/detectors/` and the tests under `tests/detectors/`. Named constants are defined in `design.md`, section 15.

## Guiding principle (decision of the project lead)

Detectors must generalise to real shops. Word lists hold the phrases that are common on real shops, even when the demo shop (the Boo-tique) uses the same phrase. The anti-leak rule forbids demo-specific strings (product names, brand names, invented copy, `DEMO_TERMS`), not common phrases. A reported score must never be bought by weakening a test or by using rare phrasing. The Boo-tique evaluation is a regression and smoke test, not a generalisation figure; generalisation is reported by the separate hold-out evaluation of requirement 4, which is printed and recorded and never tuned.

## Out of scope

- Claims split across elements (`Only <span>3</span> left in stock`, one span per countdown unit). They need capture changes (subtree text, or a representation for text-less containers) and belong to a later spec, together with the capture owner's rework. The hold-out keeps these cases and reports them as misses.
- The background chain behind the dark cookie banner, beyond what the detector can do alone (requirement 11). Emitting each element's computed effective background, or capturing containers with a non-transparent background, needs capture changes and belongs to a later spec.
- Everything in `lib/capture/` and `tests/capture/`, `lib/types`, `lib/boo-tique`, `components/`, `app/`, `package.json`, the lockfile, `vitest.config.ts`.
- Parsing `oklch()`, `oklab()`, `lab()` and `color(srgb ...)` colours (nice to have, later spec).
- Custom checkboxes hidden with `display: none` on the input (nice to have, later spec).
- Building the element index once per `runAllDetectors` call (performance, later spec).
- The live opt-in evaluation against the deployed demo (later spec).
- Languages other than English and Turkish for text rules; a stemming library; any new dependency.
- Any change to the Boo-tique shop, the ground-truth fixtures or `tests/detectors/registry.test.ts`.

## 1. Standing rules

**User story:** As the owner, I want every task of this spec to keep the guardrails of the old spec, so that fixes cannot reintroduce the faults the review found.

**Acceptance criteria:**

1.1. WHEN any file under `lib/detectors/` is changed THE SYSTEM SHALL keep every detector a pure function: no network call, no clock except values in the snapshot, no randomness and no module-level mutable state.
1.2. WHEN a detector decides THE SYSTEM SHALL read no test hook attribute, no class name and no `data-*` attribute.
1.3. WHEN any file under `lib/detectors`, `lib/capture` or `lib/judge` is scanned, comments included, THE SYSTEM SHALL find no occurrence of the word "testid" in any letter case; code comments say "test hook attributes".
1.4. WHEN any file under `tests/detectors` is scanned THE SYSTEM SHALL find that only `tests/detectors/eval/helpers/no-hooks.ts` contains the word "testid" in any letter case.
1.5. WHEN a detector returns a finding THE SYSTEM SHALL start its title with "Possible", and no text a detector produces SHALL contain illegal, scam, fraud or a relative of them (the forbidden-word data and its tests are the only exception).
1.6. WHEN a task of this spec changes a test expectation THE SYSTEM SHALL carry a comment on that test naming the requirement of this spec that demands the change, and SHALL delete no case, loosen no expectation and add no exemption.
1.7. WHEN a test and a requirement of this spec contradict each other THE SYSTEM SHALL stop the task and report the contradiction instead of changing either.
1.8. WHEN a word is added to a word list THE SYSTEM SHALL require it to be common real-world wording that occurs in the corpus of requirement 3, and SHALL NOT add a word only to make a Boo-tique entry pass; a missed target is reported.
1.9. WHEN a task of this spec runs THE SYSTEM SHALL add no dependency, change none of `package.json`, the lockfile, `lib/capture/`, `tests/capture/`, `lib/types`, `lib/boo-tique`, `components/`, `app/`, `vitest.config.ts`, `.kiro/agents`, `.kiro/hooks`, `.kiro/settings`, `.github`, `.githooks`, `scripts/`, `SECURITY.md`, `.gitleaks.toml` or `tests/detectors/registry.test.ts`, and read or write no `.env` file.
1.10. WHEN a task of this spec runs shell commands THE SYSTEM SHALL use only `npx vitest run <one test file> --maxWorkers=2` and `npx tsc --noEmit`, and `npm run lint` only in the last task; there is no dev server, no browser, no network and no commit.
1.11. WHEN a task changes behaviour THE SYSTEM SHALL change, in the same task, every existing test whose expectation that behaviour breaks (with 1.6 applied), and SHALL run each dependent test file the task names, so that the whole existing suite is green at the end of every task.
1.12. WHEN a task runs THE SYSTEM SHALL read only the requirement and design sections it names, the files it names and the files it edits.

## 2. Natural phrases restored, phrase length counted as compiled

**User story:** As the owner, I want the common phrases that task 12 of the old spec renamed or cut back, so that the detectors match what shops actually write (review Q1, Q7 must-fix 1 and 2).

**Acceptance criteria:**

2.1. WHEN a visible element holds "Selling fast" THE SYSTEM SHALL return a low `fake-scarcity` finding (row S5) for it.
2.2. WHEN a visible element holds "Almost gone" or "Almost gone!" THE SYSTEM SHALL return a low `fake-scarcity` finding (row S5) for it.
2.3. WHEN the unquantified list is read THE SYSTEM SHALL hold "selling fast" and "almost gone", and MAY keep "selling out fast" and "almost sold out" as extra entries.
2.4. WHEN an element holds "5 people have this in their cart" or "... in their basket" and the number differs after a reload THE SYSTEM SHALL return a high `fake-activity` finding (row A1); the English count entries "# people have this in their" (6 elements) replace the entries "... in cart" and "... in basket".
2.5. WHEN an element holds "Ankara'dan Ayşe az önce satın aldı" or the "'den" form THE SYSTEM SHALL match the purchase entries "@'dan @ az önce satın aldı" and "@'den @ az önce satın aldı" (6 compiled elements each); the entries without "az önce" are removed.
2.6. WHEN the task runs THE SYSTEM SHALL search the word-list data and `tests/detectors/` for any other natural phrase that task 8 or task 12 of the old spec renamed or shortened, and SHALL restore it by the rule of 2.7 and record the finding in the task report.
2.7. WHEN a list entry would exceed `MAX_PHRASE_TOKENS` elements THE SYSTEM SHALL shorten it only from its start or its end so that it still matches the natural phrase, and never by removing an inner word (new old-spec criterion 14.10).
2.8. WHEN an entry length is checked THE SYSTEM SHALL count elements as `compilePhrases` counts them (`@'dan` is one element, `#` is one, a stem word is one) through the exported function `countPhraseElements`, and SHALL NOT count `tokenise` tokens; `MAX_PHRASE_TOKENS` stays 6 because every restored entry fits in 6 elements when counted this way, so no limit change is needed.
2.9. WHEN a word list is compiled THE SYSTEM SHALL keep every entry: the size of the compiled matcher equals the number of entries of the list, in every list of every data module.
2.10. WHEN the test strings that task 12 rewrote to match the rename are found (the review counts 14) THE SYSTEM SHALL revert them to the natural phrases ("Selling fast", "Almost gone", "have this in their cart") where they apply, and SHALL keep separate cases for the extra entries of 2.3.

## 3. Generality rule and independent real-world corpus

**User story:** As the owner, I want the word-list rule to test generality instead of distance from the demo, so that common phrases are allowed and invented ones are caught (review Q1, "the right rule").

**Acceptance criteria:**

3.1. WHEN the generality test runs THE SYSTEM SHALL find that no list entry holds a word of `DEMO_TERMS`, that no entry is longer than `MAX_PHRASE_TOKENS` elements as counted by `compilePhrases`, and that every entry of a word or phrase list occurs, after `normaliseText`, in at least one text of `tests/fixtures/real-world-phrases.json` (replacement text of old criterion 14.8).
3.2. WHEN a list entry equals or contains a planted Boo-tique text THE SYSTEM SHALL accept it, because the rule asks whether the entry is common, not whether the demo uses it.
3.3. WHEN `tests/detectors/word-lists.test.ts` is changed THE SYSTEM SHALL delete `GENERIC_CONTROL_LABELS`, `CONTROL_LABEL_MODULES`, the test that no entry equals or contains a planted text and the test that keeps the exemption small, and add no exemption of the same kind.
3.4. WHEN the coverage rule of 3.1 is applied THE SYSTEM SHALL cover exactly the lists of kind "wordlist" of that test file and exempt only these lists, each for a stated reason: `FORBIDDEN_WORDS` and `FORBIDDEN_STEMS` (words the product avoids), `MONTHS` and `TIME_ZONE_TOKENS` (calendar facts), `CLOSE_GLYPHS` and `CURRENCY_WORDS` (symbols and codes).
3.5. WHEN an entry of `FIRST_PERSON_SUFFIXES` is checked THE SYSTEM SHALL count it as occurring when a word of a corpus text of that language ends with it.
3.6. WHEN any other entry is checked THE SYSTEM SHALL count it as occurring when a matcher compiled from that entry alone, with its placeholders (`#`, `@`) and stems, matches the tokens of a corpus text of the same language.
3.7. WHEN the corpus is read THE SYSTEM SHALL find an array of entries with `id`, `language` (`en` or `tr`), `text`, `seenAt` (a short note of where that kind of phrase is seen) and `source` (`research-b` or `common`), validated with Zod, with unique ids and non-blank texts of at most 300 characters.
3.8. WHEN the corpus is read THE SYSTEM SHALL find at least 100 texts, at least 40 of them English and at least 40 Turkish.
3.9. WHEN the corpus is written THE SYSTEM SHALL build it from section B of `docs/research/dark-patterns.md` and general knowledge of shop copy only, and SHALL read no text from `docs/research/boo-tique-ground-truth.json`, `tests/fixtures/boo-tique-ground-truth.json`, the ground-truth parts of `dark-patterns.md`, `lib/boo-tique/`, `components/boo-tique/` or `app/boo-tique/`.
3.10. WHEN the anti-copy test runs THE SYSTEM SHALL find that no normalised corpus text equals a normalised text of `plantedTexts()`, and that no corpus text holds a word of `DEMO_TERMS`.
3.11. WHEN the anti-copy test runs THE SYSTEM SHALL NOT use a containment check between a corpus text and a planted text, so that a corpus text that contains "selling fast" is accepted.
3.12. WHEN the corpus holds a text that quotes a forbidden word on purpose (for the wording test) THE SYSTEM SHALL keep it in `tests/detectors/helpers/` and not in the fixture, so that no list entry is justified by it.
3.13. WHEN a corpus text fails the anti-copy test THE SYSTEM SHALL rewrite it in longer, common wording; WHEN a list entry is not covered by the corpus THE SYSTEM SHALL add a realistic text for it, or remove the entry if it is not common wording (1.8), and SHALL NOT loosen either test.

## 4. Hold-out evaluation

**User story:** As the owner, I want a generalisation figure that is separate from the Boo-tique score and is never tuned, so that I can quote it honestly (review Q1 point 3, Q7 must-fix 8).

**Acceptance criteria:**

4.1. WHEN the hold-out cases are defined THE SYSTEM SHALL include, word for word, the 28 flag cases and the 20 honest look-alikes of review Q2 (listed in `design.md`, section 13), including the split-span cases `Only <span>3</span> left in stock` and the three-span countdown, "Only 5 m left", "Only 1 M left" and the Turkish inflected cases.
4.2. WHEN the hold-out cases are defined THE SYSTEM SHALL add the extras of `design.md`, section 13 (the dark cookie banner, the five duration probes of review Q6, "Only 2 days left" and a restart close to the gap), reported apart from the 28 and the 20.
4.3. WHEN a case is built THE SYSTEM SHALL build its snapshot in the markup shape named for it (single node, split span, split countdown, inflected Turkish, reload pair, form control or banner), by the extractor's own-text rule, with no `data-*` attribute.
4.4. WHEN the hold-out runs THE SYSTEM SHALL run `runAllDetectors` on every case and report recall of the flag cases, false positives of the honest cases split by confidence, and the extras, separately from the Boo-tique score.
4.5. WHEN the hold-out runs THE SYSTEM SHALL print the result table to the console, and the last task SHALL record the printed figures in `design.md`, section 14, beside the review's baseline (18 of 28 hits and 3 of 20 false positives at `c21325f`).
4.6. WHEN the hold-out test asserts THE SYSTEM SHALL assert only that every case ran with no detector error, that the case counts are 28, 20 and the extras (so that no case is dropped), and a sanity floor of recall at least 0.5 over the 28 flag cases; there is no assertion about false positives and no threshold tuned to a result (this overrides the review's proposed criterion 17.19).
4.7. WHEN a case is missed or raises a false positive THE SYSTEM SHALL keep the case and report it; a case is never removed, reworded or relabelled because of a result.
4.8. WHEN the cases expected to stay missed (split across elements, restart close to the gap) are scored THE SYSTEM SHALL list them as misses with the reason `knownMiss`.
4.9. WHEN the hold-out helpers are read THE SYSTEM SHALL find that they use `buildSnapshot` and `toLightSample` of the existing harness, make no network call and open no browser.
4.10. WHEN a hold-out snapshot is built THE SYSTEM SHALL validate it with `PageSnapshotSchema` and, for a reload pair, give the reload sample a capture time 9 seconds after the first.
4.11. WHEN a companion element is needed (an accept button next to a decline, a radio group around a checked radio) THE SYSTEM SHALL use plain wording chosen once by the author before the first run, not wording chosen to suit a detector, and SHALL write it in the case table.

## 5. Forbidden words by stem, and the wording test

**User story:** As a shopper, I want banned words masked also in their inflected forms, so that quoted page text never carries them (review Q4, old criteria 3.12, 3.13, 3.18).

**Acceptance criteria:**

5.1. WHEN quoted page text holds a word that starts with a forbidden stem, in English or Turkish, followed by at most `FORBIDDEN_STEM_EXTRA_MAX` letters, THE SYSTEM SHALL replace that word with "[word omitted]".
5.2. WHEN a finding string still holds such a word after 5.1 THE SYSTEM SHALL drop the finding.
5.3. WHEN the stems are read THE SYSTEM SHALL find `scam`, `fraud`, `illegal`, `unlawful`, `deceiv`, `decept`, `dolandırıcı`, `yasadışı` and `aldatıcı`, in addition to the whole words of `FORBIDDEN_WORDS`.
5.4. WHEN "scammers", "frauds", "dolandırıcılara", "dolandırıcılık", "illegally", "yasadışı" and "aldatıcı" (also with a Turkish apostrophe suffix and in capitals) occur in quoted text THE SYSTEM SHALL mask each one.
5.5. WHEN stems are matched THE SYSTEM SHALL use bounded prefix matching on tokens, with no new regular expression and no new `RegExp`.
5.6. WHEN `tests/detectors/wording.test.ts` runs THE SYSTEM SHALL scan every string of every finding returned for one snapshot per rule row (U1 to U7, S1 to S5, A1 to A3, C1, C2, P1 to P5, V1 to V4), for every Boo-tique harness variant, for every hold-out case and for page texts that carry banned words, and find none of the forbidden words or stems.
5.7. WHEN the same test runs THE SYSTEM SHALL find that every title starts with "Possible" and that no string holds a word of `FORBIDDEN_WORDS` or a word that starts with a stem.
5.8. WHEN the findings of the per-detector unit tests cannot be observed from another test file THE SYSTEM SHALL cover old criterion 3.18 through the row snapshots of 5.6 instead, and the amendment note says so.
5.9. WHEN a word starts with a forbidden stem but has more than `FORBIDDEN_STEM_EXTRA_MAX` further letters, or a digit after the stem, THE SYSTEM SHALL NOT mask it.

## 6. Detector exceptions are reported

**User story:** As the scan route author, I want an unexpected exception inside a detector to appear in `errors`, so that a bug never looks like an all-clear (review Q3, "silent all-clear").

**Acceptance criteria:**

6.1. WHEN a detector body, a shared helper or `finaliseFindings` raises an exception THE SYSTEM SHALL let it propagate and SHALL NOT catch it and return an empty result.
6.2. WHEN `runDetectors` runs a detector that throws THE SYSTEM SHALL report one `DetectorError` of kind `threw` with the name the detector was registered under, and SHALL still run the other detectors.
6.3. WHEN a detector receives odd values (a missing array, a number where text is expected, `NaN`, `Infinity`, `null` elements, a non-object snapshot) THE SYSTEM SHALL still return an array without throwing and without an error entry.
6.4. WHEN reading a field itself throws (a getter or a proxy trap that throws) THE SYSTEM SHALL treat that as an unexpected exception under 6.1, not as odd input.
6.5. WHEN `runAllDetectors` receives a snapshot whose `elements` getter throws THE SYSTEM SHALL return `findings: []` and one `threw` error per static detector, in registration order.
6.6. WHEN a registry holds a real detector and a probe detector and the snapshot is hostile THE SYSTEM SHALL report the real detector's error and still return the probe detector's finding.
6.7. WHEN `runAllDetectors` runs on a normal snapshot, on every Boo-tique harness variant and on every hold-out case THE SYSTEM SHALL return `errors: []`.
6.8. WHEN the source under `lib/detectors/` is scanned THE SYSTEM SHALL find no `catch` outside `lib/detectors/index.ts`, and `index.ts` keeps exactly its exports; `tests/detectors/registry.test.ts` stays unchanged and passing.
6.9. WHEN old criteria 2.7 and 2.13 are read THE SYSTEM SHALL read them as amended: a detector does not throw on odd values, but an unexpected exception is visible in `errors`; the amendment note names both criteria.
6.10. WHEN a `DetectorError` message is used THE SYSTEM SHALL treat it as text for server logs only, never for a client.
6.11. WHEN the doc comment of a detector or helper said "never throws" THE SYSTEM SHALL change it to say that odd values give an array and that an unexpected exception propagates.
6.12. WHEN `runAllDetectors` is read after this change THE SYSTEM SHALL still register the six detectors under the same names in the same order (old criteria 4.2 and 4.8).

## 7. Countdown rules narrowed

**User story:** As a shopper, I want ordinary durations and sizes left alone, so that a "5 m" fabric length or "12 hours" of battery life never looks like a deadline (review Q6, probes of Q2).

**Acceptance criteria:**

7.1. WHEN text holds one number-unit pair with a one-letter unit (`d`, `h`, `m`, `s`), for example "5 m" or "1 M", THE SYSTEM SHALL NOT parse it as a countdown.
7.2. WHEN text holds at least two pairs, for example "2h 30m", THE SYSTEM SHALL parse it as a countdown only when each one-letter unit is written in lower case.
7.3. WHEN a countdown has the form `units` or `clock2` THE SYSTEM SHALL call it "worded" only when the same element holds a countdown cue (`COUNTDOWN_CUE_WORDS`: "ends in", "expires in", "closes in", "left", "remaining", "only", "hurry", "bitiyor", "sona eriyor", "kaldı", "kapanıyor").
7.4. WHEN a countdown has the form `clock3` THE SYSTEM SHALL keep the old rule: "worded" when the element or its parent holds an urgency or offer word.
7.5. WHEN "Only 5 m left" or "Only 1 M left" is read THE SYSTEM SHALL return no finding, and WHEN "Only 2 days left" is read THE SYSTEM SHALL still return a low finding (row U5).
7.6. WHEN "Free returns within 30 days" under a "Sale" parent, "Battery life 12 hours" next to "Save 10%", "Video 12:34" under "Sale", "Ready in 15 min" under "Deal of the day" or "Delivery in 2 days · 20% off" is read THE SYSTEM SHALL return no finding.
7.7. WHEN the club timer text "Join in 09:59 for 20% off" has no cue of 7.3 THE SYSTEM SHALL lose its text-only hit (entry `club-timer-session-restart`); no cue is added to the demo shop, nothing special-cases this text, and the Boo-tique result may fall to 18 of 19, which is the honest result (review Q6, option 1).
7.8. WHEN "Order within 2h 15m for next-day delivery" is read THE SYSTEM SHALL still return no finding (shipping cut-off, old criterion 8.17).
7.9. WHEN a restart, an unchanged pair or a consistent pair of a `clock3` countdown is classified THE SYSTEM SHALL return the same rows as before (U2, U3, U4).
7.10. WHEN these rules are tested THE SYSTEM SHALL include the probes of 7.5 and 7.6 as test cases in `tests/detectors/fake-urgency.test.ts` and `tests/detectors/shared/countdown.test.ts`.
7.11. WHEN Turkish unit forms are read ("2 gün", "3 saat", "15 dk", "30 sn") THE SYSTEM SHALL apply the same cue rule: "Sadece 2 gün kaldı" returns a low finding (row U5), and "Kargo 2 gün" under an "İndirim" parent returns none.
7.12. WHEN "2h 30m left" is read with a restart after a reload THE SYSTEM SHALL still return the restart rows, because two lower-case pairs and a cue are present.

## 8. Stock claim calibration

**User story:** As a shopper, I want "Only 3 left in stock" with the same number on every load treated as a weak signal, because that is the honest form most shops use (review Q3, Q7 must-fix 4).

**Acceptance criteria:**

8.1. WHEN a qualified stock claim is judged "supported" THE SYSTEM SHALL count support only from an exclamation mark in the element, a pressure word in the element or its parent, or another scarcity claim on the page, and not from the number being at most 10.
8.2. WHEN "Only 3 left in stock" has the same number after a reload and no other support THE SYSTEM SHALL return at most a low finding (row S4).
8.3. WHEN "Hurry! Only 3 left in stock" is read THE SYSTEM SHALL still return a medium finding (row S3).
8.4. WHEN a qualified claim changes across the reload THE SYSTEM SHALL return the same high finding as before (row S1).
8.5. WHEN planted claims of the Boo-tique have other support (an exclamation mark) THE SYSTEM SHALL keep their expected confidence in the evaluation; `LOW_STOCK_MAX` stays defined and pinned by its constants test but no rule uses it, which the amendment note records for old criterion 9.4.
8.6. WHEN "Sadece 3 adet kaldı" has the same number after a reload and no other support THE SYSTEM SHALL return at most a low finding, and WHEN "Son 3 ürün!" is read THE SYSTEM SHALL return a medium finding, by the same rule as 8.2 and 8.3.

## 9. Turkish word forms

**User story:** As a Turkish shopper, I want inflected forms ("kaçırmayın", "indirimleri", "fırsatları", "şu an") to match the same words as their base forms (review Q7 must-fix 7).

**Acceptance criteria:**

9.1. WHEN a Turkish list entry has a word followed directly by `*`, for example "kaçır*", THE SYSTEM SHALL treat the word as a stem that matches a word token which starts with it and has at most `MAX_STEM_EXTRA_CHARS` further characters, all of them letters.
9.2. WHEN a stem is shorter than `MIN_STEM_CHARS` characters after normalisation, is written in an English list, or a `*` follows anything else than a word THE SYSTEM SHALL not compile the entry, and the size check of 2.9 SHALL fail.
9.3. WHEN a token has more than `MAX_STEM_EXTRA_CHARS` further characters, a digit, an apostrophe or a different start THE SYSTEM SHALL NOT match the stem.
9.4. WHEN stems are used THE SYSTEM SHALL use no regular expression, no stemming library and no new dependency.
9.5. WHEN the stem entries are added THE SYSTEM SHALL add them only to the Turkish lists named in `design.md`, section 10, and SHALL keep exact entries for short or ambiguous words ("para", "ileti", "bağış") so that "paragraf", "iletişim" and "bağışıklık" do not match.
9.6. WHEN "kaçırma", "kaçırmayın", "kaçırmak", "indirimleri" and "fırsatları" are read in their lists THE SYSTEM SHALL match them through one stem each.
9.7. WHEN "şu an", "şu anda", "tükenmek üzere", "stokta son ürünler", "son 3 ürün" and "inceliyor" in the word orders of `design.md`, section 10 are read THE SYSTEM SHALL match them: "23 kişi şu an bakıyor", "Bu ürünü şu anda 15 kişi inceliyor" and "şu anda 15 kişi inceliyor".
9.8. WHEN a changed number is found in the reload sample of these Turkish claims THE SYSTEM SHALL return the same high rows as for the base forms (S1, A1).
9.9. WHEN every stem entry is checked THE SYSTEM SHALL find it in a Turkish corpus text (3.6), and the false-positive tests of 9.3 and 9.5 SHALL pass.
9.10. WHEN stems are compared THE SYSTEM SHALL normalise entry and token with `normaliseText`, so that "ı" and "i" fold the same way on both sides.
9.11. WHEN "Hayır, indirimleri kaçırmak istiyorum" is read in a choice group next to an accept control THE SYSTEM SHALL return a confirmshaming finding, and WHEN "Hayır, teşekkürler" is read THE SYSTEM SHALL return none (plain decline).
9.12. WHEN a Turkish label such as "Kampanyalardan e-posta ile haberdar olmak istiyorum" or "Ürün koruma paketi ekle +49,90 TL" is ticked THE SYSTEM SHALL return a preselection finding through a stem entry or a price, and WHEN "Bültene abone olmak istiyorum" is unticked THE SYSTEM SHALL return none.

## 10. English sales-pop forms

**User story:** As a shopper, I want "Sarah in London purchased a Blue Dress 5 minutes ago" recognised as a purchase message, because that is a common sales-pop wording (review Q2 miss, Q7 must-fix 7).

**Acceptance criteria:**

10.1. WHEN an element holds a name, a place and a bare purchase verb ("@ in @ purchased", "@ from @ purchased", "@ in @ bought", "@ from @ bought") THE SYSTEM SHALL treat it as a purchase claim only when the same element also holds a time word ("ago", "just now", "recently"); the Turkish forms stay as in requirement 2.5.
10.2. WHEN an element holds "someone in @ purchased" or "someone from @ purchased" with a time word THE SYSTEM SHALL treat it as a purchase claim.
10.3. WHEN a review text such as "Sarah from London bought this for her mother" holds no time word THE SYSTEM SHALL return no finding for it.
10.4. WHEN these claims are rated THE SYSTEM SHALL use the old rows A1 to A3 (context, changed text on reload) without change.

## 11. Background behind uncaptured layers

**User story:** As a shopper, I want an honest dark cookie banner left alone, so that two equal buttons on a dark panel are not called unequal (review Q2 extra probe, Q7 must-fix 2).

**Acceptance criteria:**

11.1. WHEN the opaque background used for a text colour comes from an ancestor, or from the assumed page background, and an uncaptured level lies between that background and the element THE SYSTEM SHALL mark the background "unseen" and SHALL count no contrast measure (decline contrast, accept contrast, close contrast, faint close) for that control.
11.2. WHEN no opaque ancestor is found and the element lies deeper than the body with an uncaptured level above it THE SYSTEM SHALL also mark the background "unseen" (11.1).
11.3. WHEN a pair's decline control is a `button`, an `input` of type `button` or `submit`, or has role `button` THE SYSTEM SHALL NOT count the "accept filled and decline transparent" measure, because the border of an outline button is not captured; it counts for a decline that is a link or plain text.
11.4. WHEN a dark container has no own text and two buttons of equal size and font sit inside it, one filled white and one transparent with white text, THE SYSTEM SHALL return no finding.
11.5. WHEN a pair has two passing size or structure measures (for example area ratio above 2 and a link decline next to a `button` accept) and an unseen background THE SYSTEM SHALL still return a finding of medium confidence, and WHEN only one measure passes THE SYSTEM SHALL return no finding (old row V5).
11.6. WHEN the background is not unseen THE SYSTEM SHALL keep old criteria 13.6 and 13.7 and every row V1 to V5 unchanged.
11.7. WHEN the Boo-tique entries lose a colour measure through 11.1 (for example V1 becomes V2) THE SYSTEM SHALL report it and tune nothing; the harness trees and the shop are not changed to win a measure back.
11.8. WHEN a finding is returned for a pair THE SYSTEM SHALL report no contrast value for a control whose background is unseen, and SHALL keep `backgroundAssumed` only for the old case of 13.7.

## 12. Boo-tique evaluation, steering, amendments

**User story:** As the owner, I want the evaluation re-run and recorded honestly, with the steering and the old spec saying what the code now does.

**Acceptance criteria:**

12.1. WHEN the last task runs THE SYSTEM SHALL run `tests/detectors/eval/boo-tique-eval.test.ts` and the hold-out test once, and record both printed figures in `design.md`, section 14, whatever they are.
12.2. WHEN the Boo-tique evaluation is asserted THE SYSTEM SHALL keep the floor of at least 16 of 19 hits (recall 0.8), zero false positives on the 8 look-alikes and no medium or high unplanted finding, unchanged.
12.3. WHEN the Boo-tique evaluation is asserted THE SYSTEM SHALL expect hits (row S5) for `product-selling-fast-badge` and `product-almost-gone-tiny`, and SHALL accept as misses only the entries of `ACCEPTED_MISSES`, each with the requirement that causes it named in a comment; the list starts with `club-timer-session-restart` (7.7), and an entry is added only by the task whose requirement causes the miss (11.7); any other miss fails.
12.4. WHEN an expectation of `score.test.ts` or `boo-tique-eval.test.ts` names a restored phrase, the club timer hit or a row changed by requirements 7, 8 or 11 THE SYSTEM SHALL change it in the same task that changes the behaviour, with the requirement named in a comment.
12.5. WHEN the last task runs THE SYSTEM SHALL update `.kiro/steering/structure.md` and `.kiro/steering/tech.md` with the new rule (list entries are common real-world wording; only demo-specific strings are forbidden), the corpus `tests/fixtures/real-world-phrases.json`, the new test files, the hold-out evaluation, the reporting of detector errors and the stem rule.
12.6. WHEN the last task runs THE SYSTEM SHALL add a short "Amendments (detectors-static-fixes)" note to the end of the old `requirements.md`, `design.md` and `tasks.md`, naming the changed items: criteria 2.7, 2.13, 3.12, 3.13, 3.18, 7.14, 8.4, 8.18 (rows U1, U5), 9.3, 9.4, 10.2, 13.6, 14.8, new 14.10, 17.6, new 17.19; design sections 7 (colour, text), 9.1, 9.2, 9.3, 9.6, 12 and 14; task 12.3.
12.7. WHEN the amendment notes are written THE SYSTEM SHALL change no other line of the old spec files.
12.8. WHEN the last task ends THE SYSTEM SHALL run `npm run lint` once and report its result; the owner runs the full suite, `tsc` and the build.
12.9. WHEN the last task records the results THE SYSTEM SHALL state in its report which Boo-tique entries changed row or confidence compared with the head of the branch (17 of 19 hits, 0 false positives) and why, naming the requirement that caused each change.
12.10. WHEN any task ends THE SYSTEM SHALL report, in its final message, every criterion it could not meet and every test it changed on purpose, each with its requirement number.
12.11. WHEN the hold-out result is quoted anywhere THE SYSTEM SHALL name it as a hand-made hold-out of 48 review probes plus extras, not as a measure of accuracy on real shops.
