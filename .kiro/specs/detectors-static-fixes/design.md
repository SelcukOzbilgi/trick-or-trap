# Design: Static Detector Fixes

## 1. Overview and decisions

The review found the detectors careful and bounded, but its 17/19 figure does not measure generalisation: two misses were created on purpose by a test task, and 48 hand-made probes show 18 of 28 hits and 3 false positives among 20 look-alikes. This spec fixes the causes in small steps and adds a hold-out that is never tuned. Requirement numbers in brackets point to `requirements.md`.

| Point | Decision | Main files |
|---|---|---|
| Restore phrases, rule 14.8 [2, 3] | Entries may equal planted texts; the test checks DEMO_TERMS, element count and presence in a corpus | `data/*.ts`, `shared/text.ts`, `word-lists.test.ts`, `tests/fixtures/real-world-phrases.json` |
| Hold-out [4] | 28 + 20 review probes word for word, plus extras; printed and recorded, sanity floor only | `tests/detectors/eval/helpers/holdout*.ts` |
| Stem masking, wording test [5] | One `isForbiddenToken` in `text.ts`, bounded prefix match; one row snapshot per rule row | `data/forbidden-words.ts`, `shared/text.ts`, `shared/finding.ts` |
| Errors [6] | No `catch` in detectors and helpers; `runDetectors` already converts a throw to `DetectorError` | six detectors, `shared/elements.ts`, `samples.ts`, `finding.ts` |
| Countdown [7] | One-letter units need two pairs and lower case; cue words in the same element for `units` and `clock2` | `shared/countdown.ts`, `fake-urgency.ts`, `data/urgency-words.ts` |
| Stock [8] | Drop "N at most 10" as support | `fake-scarcity.ts` |
| Turkish forms, sales-pop [9, 10] | Stem entries with a fixed bound, in named Turkish lists only; timed English purchase templates | `shared/text.ts`, `data/*.ts`, `fake-activity.ts` |
| Dark banner [11] | Unseen layers: no contrast measure; no "filled versus transparent" for buttons | `shared/colour.ts`, `visual-interference.ts` |
| Record [12] | Re-run, record, update steering and old spec notes | tests, `.kiro/steering/*`, old spec |

## 2. Facts verified in the code (head of the branch)

- `compilePhrases` (`shared/text.ts`) counts elements: `#` is one, `@` is one, `@'dan` is one. It silently skips an entry with 0 or more than `MAX_PHRASE_TOKENS` (6) elements and reports only `size`. `tests/detectors/word-lists.test.ts` and `tests/detectors/fake-activity.test.ts` (line 589) count `tokenise` tokens instead, where `@'dan` is three. That mismatch made task 8 cut "az önce" (and "their") out of the middle of four entries.
- Task 12 (`811ada5`) renamed "selling fast" to "selling out fast" and "almost gone" to "almost sold out" in `scarcity-words.ts` and rewrote test strings (in `fake-scarcity.test.ts`, `hostile-input.test.ts` and others) to match. `word-lists.test.ts` still bans an entry that contains a planted text and exempts 8 control labels in two modules (`GENERIC_CONTROL_LABELS`).
- `readUnits` in `shared/countdown.ts` accepts one pair with a one-letter unit after case folding. `isWorded` in `fake-urgency.ts` accepts any urgency or offer word in the element or its parent, for every form.
- `isSupported` in `fake-scarcity.ts` returns true for `value <= LOW_STOCK_MAX`, so every honest "Only N left" is S3 medium.
- `catch` sites: the six detector bodies (`fake-urgency.ts`, `fake-scarcity.ts`, `fake-activity.ts`, `confirmshaming.ts`, `preselection.ts`, `visual-interference.ts`), `readProp`, `attr()` and the `list[i]` read in `shared/elements.ts`, `readProp` in `shared/samples.ts`, `detectedAtFrom` and the per-draft loop of `finaliseFindings` in `shared/finding.ts`. `lib/detectors/index.ts` keeps its own, which are the error channel.
- Forbidden words are matched as whole tokens in two copies: `isForbiddenWord` in `shared/text.ts` (masking) and `runIsForbidden` in `shared/finding.ts` (drop rule).
- The harness cookie banner (`pages.ts`) has an uncaptured wrapper `div` between the captured `region` and its buttons. `tree.ts` follows the extractor, which leaves out containers without own text or role.
- `tests/detectors/shared/constants.test.ts` pins every constant value; `LOW_STOCK_MAX: 10` is in it.

## 3. Phrase counting, restoration and shortening [2]

New exports in `shared/text.ts`: `countPhraseElements(entry: string): number` returns the number of elements `compilePhrases` would compile (0 for an empty entry or an invalid one: a stray `*`, a stem in an English entry, a stem shorter than `MIN_STEM_CHARS`). `compilePhrases` uses it, so the test and the compiler count one way. `tests/detectors/shared/text.test.ts` gains tests for it. `word-lists.test.ts` and `fake-activity.test.ts` replace their `tokenise` length checks with `countPhraseElements` (1 to `MAX_PHRASE_TOKENS`) and keep the `compile size equals entry count` check.

Restored entries (all counted as compiled):

| List | Entry | Elements | Replaces |
|---|---|---|---|
| `UNQUANTIFIED_SCARCITY.en` | "selling fast", "almost gone" (keeps "selling out fast", "almost sold out") | 2 | the two renames |
| `COUNT_TEMPLATES.en` | "# people have this in their" (matches "... cart" and "... basket") | 6 | "... in cart", "... in basket" |
| `PURCHASE_TEMPLATES.tr` | "@'dan @ az önce satın aldı", "@'den @ az önce satın aldı" | 6 | "@'dan @ satın aldı", "@'den @ satın aldı" |

Rule 14.10: if any entry still exceeds 6 elements, cut it from the start or the end ("# people have this in their cart" loses "cart", the last word, not "their"). The limit stays 6. The task also searches `lib/detectors/data/` and `tests/detectors/` for other renames or shortenings of task 8 and 12 (compare with old design 9.2, 9.3 and section B of `docs/research/dark-patterns.md`) and restores them by the same rule.

Tests rewritten by task 12 are found by searching for "Selling out fast", "Almost sold out", "in cart" and "in basket" in `tests/detectors/`; they go back to "Selling fast", "Almost gone" and "their cart" where the case is about the phrase. Cases for "selling out fast" and "almost sold out" stay as separate cases.

## 4. Corpus fixture and generality tests [3]

`tests/fixtures/real-world-phrases.json` is an array, one entry per line for a short file:

```json
{ "id": "en-017", "language": "en", "text": "Selling fast: 40 sold in the last 24 hours", "seenAt": "product page badge", "source": "common" }
```

`source` is `research-b` (taken from section B of `docs/research/dark-patterns.md`) or `common` (general knowledge of shop copy). Texts are realistic sentences or button groups, not bare list entries, so that most carry two or three list entries. The fixture holds at least 100 texts, at least 40 per language, and covers the claim lists (urgency, scarcity, activity, shaming) and the control and consent lists. The author reads no Boo-tique text [3.9]; a plain "Selling fast" or "No thanks" alone as a text would equal a planted text, so texts embed them in longer wording.

Test helper `tests/detectors/helpers/real-world-phrases.ts` holds `RealWorldPhraseSchema` (Zod) and `loadRealWorldPhrases()` (reads the JSON with `readFileSync`, parses, returns a frozen array). New test `tests/detectors/real-world-phrases.test.ts` checks shape, unique ids, counts [3.7, 3.8], and the anti-copy rule: for each text, `normaliseText(text)` must differ from `normaliseText` of every `plantedTexts()` item, and `keyTokens(text)` must not contain `keyTokens(term)` for any `DEMO_TERMS` term (the `keyTokens` and `containsSequence` helpers move to `tests/detectors/helpers/demo-terms.ts` and are imported by both tests). There is no containment check between a corpus text and a planted text [3.11].

Coverage test in `word-lists.test.ts` [3.1, 3.4 to 3.6]: for every entry of every list of kind "wordlist", build `compilePhrases({ en: [entry], tr: [] })` (or the `tr` form for a Turkish entry) and require `findPhrases(tokenise(text), matcher).length > 0` for at least one corpus text of that language. `FIRST_PERSON_SUFFIXES.tr` entries are checked by `endsWith` on the normalised word tokens. The failure message names the list and the entry. Exempt lists are fixed by [3.4]: `FORBIDDEN_WORDS`, `FORBIDDEN_STEMS`, `MONTHS`, `TIME_ZONE_TOKENS`, `CLOSE_GLYPHS`, `CURRENCY_WORDS`, because they are of kind "plain" or "months" in that test, not word or phrase lists. Other changes to that file: delete `GENERIC_CONTROL_LABELS`, `CONTROL_LABEL_MODULES` and the two tests built on them [3.3]; keep the `DEMO_TERMS` test, the `plantedTexts()` sanity test (the anti-copy test needs it) and the review-rule comment test; add the new export names to `MODULES` (section 5, 10 and 11 lists). `MAY_BE_EMPTY` gains `TIMED_PURCHASE_TEMPLATES.tr` and `PURCHASE_TIME_WORDS.tr`, like the existing `FIRST_PERSON_SUFFIXES.en`: a data-shape fact, not a content exemption.

## 5. Stem engine and forbidden stems [5, 9]

In `shared/text.ts`:

```ts
export function matchesStem(norm: string, stem: string, maxExtra: number): boolean; // starts with stem, extra length <= maxExtra, extra holds only letters
export function countPhraseElements(entry: string): number;
export function isForbiddenToken(norm: string): boolean; // whole word, or stem + up to FORBIDDEN_STEM_EXTRA_MAX letters; also the part before an apostrophe
```

Entry syntax: a word directly followed by `*` in a `tr` entry is a stem element `{ kind: "stem", stem }`. `toElements` returns null (entry not compiled) for a `*` that does not follow a word, for a stem in an `en` entry and for a stem shorter than `MIN_STEM_CHARS` after `normaliseText`. In `matchFrom` a stem element matches a `word` token that satisfies `matchesStem(token.norm, stem, MAX_STEM_EXTRA_CHARS)`. An entry whose first element is a stem is filed with the placeholder-first entries and tried at every start; there are only a few of them, so work stays at tokens × entries × 6. "Letters only" means no digit, apostrophe, hyphen or symbol in the extra characters.

Forbidden stems: `data/forbidden-words.ts` gains `FORBIDDEN_STEMS` (`scam`, `fraud`, `illegal`, `unlawful`, `deceiv`, `decept`, `dolandırıcı`, `yasadışı`, `aldatıcı`), normalised at load; `FORBIDDEN_WORDS` stays. The bound is `FORBIDDEN_STEM_EXTRA_MAX = 10` because "dolandırıcılarından" carries 8 extra letters and over-masking costs less than under-masking (a quoted "scampi" is also masked; accepted and noted in a comment). `maskForbidden` (`text.ts`) and `containsForbidden` (`finding.ts`) both call `isForbiddenToken`, so masking and the drop rule share one rule [5.1, 5.2]. No regular expression is added [5.5].

## 6. Wording test [5.6 to 5.8]

`tests/detectors/helpers/row-snapshots.ts` exports `ROW_SNAPSHOTS: ReadonlyArray<{ row: string; snapshot: PageSnapshot }>`: one small plain-object snapshot per rule row of old criteria 8.18, 9.8, 10.6, 11.9, 12.14 and 13.12, built like the `raw()` helpers of `word-lists.test.ts`. `tests/detectors/wording.test.ts` runs `runAllDetectors` on these, on every `PAGE_VARIANTS` entry, on every hold-out case and on page texts that quote banned words in each place a detector quotes text (claim, decline, label, close control). It asserts: no string of any finding (title, description, explanation, evidence text, detector name) holds a word of `FORBIDDEN_WORDS` or a word starting with a stem; every title starts with "Possible"; the masked quote reads "[word omitted]" for "scammers", "frauds", "dolandırıcılara", "dolandırıcılık", "illegally", "yasadışı", "aldatıcı" and for the same words after an apostrophe or in capitals; and `isForbiddenToken` matches every entry of `FORBIDDEN_WORDS`. Old criterion 3.18 named "every unit test snapshot", which another test file cannot observe; the row snapshots replace that and the amendment says so.

## 7. Error channel [6]

Mechanism: remove the exception swallowing, keep the registry as the one place that turns a throw into data. `runDetectors` already returns `{ detectorName, kind: "threw", message }` and continues with the next detector.

| Site | Change |
|---|---|
| Six detector bodies | Delete `try { ... } catch { return []; }`; the body stays, the doc comment says "does not throw on odd values; an unexpected exception propagates" |
| `readProp` (`elements.ts`, `samples.ts`), `attr()`, the `list[i]` read | Plain property access behind the existing `isRecord` / `typeof` guards, no `try` |
| `detectedAtFrom`, per-draft loop of `finaliseFindings` | No `try`; a non-object snapshot still gives the epoch, a broken draft now throws |

Reconciliation with old 2.7 and 2.13: "odd values" are values that can be read: wrong types, missing arrays, `NaN`, `Infinity`, `null` elements, non-object snapshots, hostile sizes. They still give an array and no error. A read that itself throws, or a bug in the code, is not odd input. In production the snapshot is validated data from `lib/capture`, so a throwing getter cannot occur; its only effect is that a bug is visible. Amendment text: "2.7: ... SHALL return an array and SHALL NOT throw for any value whose reading does not itself throw; an exception raised while reading, or inside a detector, is reported by `runDetectors` as a `threw` error." `FindingSchema.safeParse` in `finaliseFindings` stays as a last guard and is out of this change (it is not an exception).

Tests (new `tests/detectors/detector-errors.test.ts`): `runAllDetectors` on `new Proxy({}, { get() { throw ... } })` and on `{ get elements() { throw ... } }` returns no findings and six `threw` errors named in registration order, and does not throw; each detector function called directly throws; a `createRegistry()` with the real `detectFakeUrgency` and a probe detector returning a valid finding reports one error and returns the probe's finding; odd values (`undefined`, `null`, `42`, `{}`, `{ elements: "x" }`, `{ elements: [null, 7, []] }`) give `[]` from each detector with `errors: []`; normal snapshots and every harness variant give `errors: []`. `tests/detectors/source-rules.test.ts` gains: no `catch` in any `lib/detectors/**` file except `index.ts`. Existing tests that feed throwing getters and expect no throw (for example "does not throw when reading capturedAt throws" in `shared/finding.test.ts`) change to expect the exception, with a comment naming requirement 6.4; the task finds them by searching `tests/detectors/` for `get ` accessors and `Proxy`. The `hostile-input.test.ts` test "keeps the shared helpers from throwing" stays and is renamed to say the detectors need no guard. Errors are for server logs only [6.10].

## 8. Countdown rules [7]

`shared/countdown.ts`, `readUnits`: a unit word of one letter (`d`, `h`, `m`, `s`) counts only when `token.surface === token.norm` (lower case); an upper-case one ends the read before that pair. After the loop, a result with one pair whose unit is one letter returns `null`. "2h 30m" (two pairs, lower case) still parses; "5 m", "1 M", "30 s" do not; "30 sec", "2 days", "15 min" do.

`fake-urgency.ts`: `isWorded(ctx, el)` becomes `isWorded(ctx, el, countdown)`. For `clock3` it is the old function. For `units` and `clock2` it is `hasAny(el.tokens, COUNTDOWN_CUE)`, where `COUNTDOWN_CUE = compilePhrases(COUNTDOWN_CUE_WORDS)` and the new list in `data/urgency-words.ts` is en: "ends in", "expires in", "closes in", "left", "remaining", "only", "hurry"; tr: "bitiyor", "sona eriyor", "kaldı", "kapanıyor". `bestCountdownRow` computes `worded` per countdown, and `rowFor` is unchanged otherwise: U1 (look-alike moved), U2 and U3 (worded restart, unchanged), U5 (worded, nothing observed) follow the new `worded`; U4 (unworded `clock3` restart) is untouched.

| Text | Result after the change |
|---|---|
| "Only 5 m left", "Only 1 M left" | none (one-letter unit) |
| "Only 2 days left" | U5 low |
| "Sale ends in 09:59" | U5 low (cue "ends in") |
| "Join in 09:59 for 20% off" | none (no cue) |
| "Free returns within 30 days" under a "Sale" parent; "Battery life 12 hours" next to "Save 10%"; "Video 12:34" under "Sale"; "Ready in 15 min" under "Deal of the day"; "Delivery in 2 days · 20% off" | none |
| "Offer ends in 02:14:33" then "02:14:59" after 9 s | U2 high (unchanged) |

The club timer entry is therefore expected to be missed [7.7]. Nothing in `lib/boo-tique` or the harness gets a cue.

## 9. Stock calibration [8]

`isSupported` in `fake-scarcity.ts` drops its first line (`value <= LOW_STOCK_MAX`). Support remains: an exclamation mark or pressure word in the element, a pressure word in its parent, or another claim elsewhere on the page. Rows S1, S2, S4, S5 and S6 are untouched. `LOW_STOCK_MAX` is no longer imported by the detector; the constant and its pinned test value stay, with a doc comment saying so. Tests: honest "Only 3 left in stock" with the same number on reload gives S4 low; "Hurry! Only 3 left in stock" gives S3 medium; "Only 3 left!" gives S3; "Only 3 left" next to a pressure word gives S3; a changed number gives S1 high. Existing tests that expected S3 for a small number without other support change to S4 with a comment naming requirement 8.1.

## 10. Turkish lists with stems [9]

Stem entries are added only here (Turkish lists; every stem is at least 4 characters; every new entry must occur in the corpus):

| List | Turkish entries after the change |
|---|---|
| `OFFER_WORDS` | "indirim*", "fırsat*", "kampanya*", "kupon*" replace the exact entries; "kazan" stays exact |
| `SCARCITY_SUPPORT_WORDS` | "kaçırma*" replaces "kaçırmayın" |
| `UNQUANTIFIED_SCARCITY` | "tüken* üzere", "hızla tüken*", "stokta son ürün*" replace "tükenmek üzere", "hızla tükeniyor" |
| `COUNT_TEMPLATES` | "# kişi bu ürünü inceli*", "# kişi şu an bakıyor*", "# kişi şu anda bakıyor*", "# kişi şu an inceli*", "# kişi şu anda inceli*", "şu an # kişi inceli*", "şu anda # kişi inceli*", "şu an # kişi bakıyor*", "şu anda # kişi bakıyor*", "# kişi görüntüle*" replace the three exact viewer entries; "# kişi sepetine ekledi" stays |
| `ACTIVITY_CONTEXT_WORDS` | "şu an" added beside "şu anda" |
| `SHAMING_PHRASES` | "indirim* istemiyorum", "fırsat* kaçır* istiyorum", "indirim* kaçır* istiyorum" replace "indirim istemiyorum" and "fırsatları kaçırmak istiyorum" |
| `BENEFIT_LOSS_TERMS` | "indirim*", "tasarruf*", "fırsat*", "kaçır*", "koruma*"; "para" stays exact |
| `NEGATION_EMOTION_TOKENS` | "nefret*", "tercih*", "istemiyor*" |
| `CONSENT_WORDS` (preselection) | "kampanya*", "bülten*", "pazarlama*"; "ileti", "sms", "e-posta" stay exact |
| `PAID_ADDON_WORDS` | "koruma*", "sigorta*", "garanti*"; "bağış" stays exact |

`FIRST_PERSON_SUFFIXES` is read by detector code, not by a matcher, and gets no stems. The task reads `confirmshaming.ts` to confirm which lists go through `findPhrases` or `hasAny` before changing them; a list read another way keeps its exact entries.

False-positive tests (`tests/detectors/shared/text.test.ts`, and each detector test): "paragraf" does not match the exact entry "para"; "iletişim" does not match "ileti"; "bağışıklık" does not match "bağış"; "indirimlerinizdekilerden" (more than 6 extra letters), "indirim2024", "indirim'e" and "indi" do not match "indirim*"; "kampanyalarımızdan" (10 extra letters) does not match "kampanya*"; positives: "kaçırma", "kaçırmayın", "kaçırmak", "indirimleri", "fırsatları" (6 extra), "bültenimiz". The hold-out has "23 kişi şu an bakıyor", "Bu ürünü şu anda 15 kişi inceliyor" (15 then 27), "Stokta son ürünler", "Tükenmek üzere!" and "Hayır, indirimleri kaçırmak istiyorum" for a check on whole pages.

## 11. English sales-pop forms [10]

`data/activity-words.ts` adds `TIMED_PURCHASE_TEMPLATES` (en: "@ in @ purchased", "@ from @ purchased", "@ in @ bought", "@ from @ bought", "someone in @ purchased", "someone from @ purchased", "someone in @ bought", "someone from @ bought"; tr: empty) and `PURCHASE_TIME_WORDS` (en: "ago", "just now", "recently"; tr: empty). `fake-activity.ts` collects purchase claims from `PURCHASE_TEMPLATES` as before and from `TIMED_PURCHASE_TEMPLATES` only when `hasAny(tokens, PURCHASE_TIME)` holds for the same element. A review sentence without a time word gives no claim. The "changed" and "context" rules are untouched. Corpus texts: "Sarah in London purchased a Blue Dress 5 minutes ago", "Someone in Leeds purchased this 2 hours ago", and a review "Sarah from London bought this for her mother" (a look-alike used only in the detector test, not a list entry).

## 12. Unseen layers [11]

`shared/colour.ts`: `effectiveBackground(index, el)` returns `{ colour, assumed, unseen }`. Let `e` be the path length of `el`, `a` the path length of the ancestor whose opaque background is used (`a = 1`, the body, when none is found and the page background is assumed), and `k` the number of captured ancestors with a path length strictly between `a` and `e`. `unseen` is `e - a - 1 > k`. An element with an own opaque background, an element of path length 2 or less and an element with a null path are never `unseen`. `textContrast` returns `null` when `unseen`, so every contrast measure of `visual-interference.ts` (decline, accept, close, faint close) falls out through the existing `null` path; the task confirms that by reading the detector and adds an explicit guard where a measure is computed another way. `backgroundAssumed` handling is unchanged for the other case (old 7.14, 13.7).

`visual-interference.ts`: the measure "accept filled and decline transparent" counts only when the decline control is not a `button`, an `input` of type `button` or `submit`, or a role `button` control. Reason: the snapshot has no border, so a transparent button is normally an outline button.

Dark-banner unit test (`visual-interference.test.ts`): a `region` without own text (not captured), two `button` elements of 160 × 40 px and 16 px font inside a captured wrapper chain with a gap, "Accept all" with `rgb(255, 255, 255)` background and dark text, "Reject all" with transparent background and white text, a captured white body: no finding. A second test keeps a finding when a size measure and a structure measure pass under the same gap (large accept `button`, small `a`). Expected Boo-tique effect: the cookie banner buttons sit under an uncaptured wrapper, so their colour measures drop and V1 may become V2; the entries stay hits if two measures remain. The result is reported, not tuned [11.7].

## 13. Hold-out evaluation [4]

Files: `tests/detectors/eval/helpers/holdout-cases.ts` (cases), `holdout.ts` (`runHoldout`, `scoreHoldout`, `formatHoldoutTable`), `tests/detectors/eval/holdout.test.ts` (unit tests of scoring with synthetic findings and of the case table), `holdout-eval.test.ts` (runs the cases, prints, asserts the sanity floor). A case is `{ id, group, language, shape, pattern?, first: PageNode, reload?: PageNode, node: key, knownMiss?: string }`. Snapshots come from `buildSnapshot` (capture time `BASE_TIME`), the reload sample from `buildSnapshot` plus `toLightSample` (`RELOAD_TIME`, 9 s later). A text is written as the extractor would deliver it: the own text of an element only, so `Only <span>3</span> left in stock` is `p` "Only left in stock" with a child `span` "3", and the three-span countdown is `p` "Offer ends in : :" with three `span` children "02", "14" and "33". Scoring: a flag case is a hit when a finding has the case's pattern and its `elementIds` include the case node or its children; an honest case is a false positive when any finding touches its nodes, recorded with its confidence. Texts marked ⟦…⟧ complete an ellipsis or an unnamed element of the review; the author fixes them once, before the first run, and never changes them afterwards.

Flag cases (28; shapes in brackets; `→` marks a reload pair with a 9 s gap):

```
scarcity   Hurry! Only 3 left in stock | Tükenmek üzere! | Son 3 ürün! | Stokta son 2 adet | Selling fast | Almost gone! | Stokta son ürünler
           Only <span>3</span> left in stock [split-span, knownMiss]
activity   12 people are looking at this right now | İstanbul'dan Ayşe az önce satın aldı | 5 people have this in their cart (5 → 9)
           Sarah in London purchased a Blue Dress 5 minutes ago | 23 kişi şu an bakıyor | Bu ürünü şu anda 15 kişi inceliyor (15 → 27)
urgency    Sale ends tonight! | Deal ends today | Offer ends in 02:14:33 (→ 02:14:59) | Kampanya gece yarısı bitiyor, kaçırmayın!
           Fırsatı kaçırma! ⟦Kampanya bitimine⟧ 01:59:59 (equal after reload)
           Offer ends in <span>02</span>:<span>14</span>:<span>33</span> [split-countdown, knownMiss]
confirm.   No thanks, I don't like free stuff | No, I prefer paying full price | Hayır, indirim istemiyorum | Hayır, indirimleri kaçırmak istiyorum
           (each a decline button next to ⟦an accept button chosen by the author, not fitted to a detector⟧)
presel.    ticked: Add shipping insurance for $2.99 | email me offers and promotions | Kampanyalardan e-posta ile haberdar olmak istiyorum | Ürün koruma paketi ekle +49,90 TL
```

Honest cases (20): "Only 3 left in stock" (same number after reload); "Only 5 m left"; "Only 1 M left"; ⟦Winter sale ends 28 February 2027⟧ (capture time December 2026); "3 in stock" and "Stokta 3 adet" (equal after reload); a banner with ⟦"Accept all"/"Reject all"⟧ in equal style; "No thanks" and "Hayır, teşekkürler" declines next to an accept control; unticked ⟦newsletter⟧ checkboxes in English and Turkish; ticked "I agree to the Terms" and ⟦"Mesafeli satış sözleşmesini okudum ve kabul ediyorum"⟧; "Order within 2h 15m for next-day delivery"; "4.8 (1,203 reviews)"; "Kış indirimi 28 Şubat 2027'de sona eriyor"; "Sepetinizde 2 ürün var"; ⟦"Saat 14:00'e kadar verilen siparişler aynı gün kargoda"⟧; a shipping radio group with the cheapest option checked; "Free returns within 30 days".

Extras (8, reported apart): honest "Free returns within 30 days" under a "Sale" parent; "Battery life 12 hours" next to "Save 10%"; "Video 12:34" under "Sale"; "Ready in 15 min" under "Deal of the day"; "Delivery in 2 days · 20% off"; the honest dark cookie banner of section 12 [banner]; flag "Only 2 days left" (urgency, low); flag "Offer ends in 02:14:33" then "02:14:40" (knownMiss: classed counting up by old 8.6).

Markup shapes used by the cases (the `shape` field):

| Shape | Tree |
|---|---|
| `single` | `body` > `p` with the whole text |
| `split-span` | `p` with the own text around the gap, child `span` with the number |
| `split-countdown` | `p` with the label, three `span` children, one per unit |
| `inflected-tr` | `single`, Turkish text with the suffixed forms of requirement 9 |
| `reload-pair` | `single` plus a light reload tree with the changed or equal text |
| `form-control` | `label` with own text and a child `input` (`checkbox` or `radio`, `checked` set), under a `div` with the companion controls |
| `banner` | a fixed-position container (captured only when the case says so) with an accept and a decline `button` |

Boxes are estimated by the builder, as in the Boo-tique trees; the dark-banner case sets explicit equal boxes. Report: `formatHoldoutTable` prints one block per group: flag hits and misses with the confidences returned, honest cases with false positives split into low, medium and high, extras, and the line "Review baseline (c21325f): 18/28 hits, 3/20 false positives". Assertions: all 56 cases ran with `errors: []`; the sets have 28, 20 and 8 cases; recall of the 28 is at least 0.5. Nothing else is asserted.

## 14. Boo-tique evaluation, steering, amendments, record [12]

`boo-tique-eval.test.ts`: the floor stays (at least 16 of 19, recall 0.8, zero false positives, no medium or high unplanted finding). The assertions for the two restored entries (hit, low `fake-scarcity`, title "Possible fake scarcity: scarcity wording") are added by task 1, which restores them. The `ACCEPTED_MISSES` list (every miss must be in it, each entry with a comment naming its requirement) is added by task 4 with `club-timer-session-restart` (7.7), because that task causes the miss; if task 7 turns a cookie entry into a miss it adds that entry with a comment naming 11.1, and if the floor then fails the task stops and reports. `score.test.ts` changes only if an expectation names these entries. Expected table: 18 of 19 if nothing else moves; a different number is reported as it is.

Steering (`structure.md`, `tech.md`): the detectors section says list entries are common real-world wording and only demo-specific strings are forbidden; names `tests/fixtures/real-world-phrases.json`, `tests/detectors/wording.test.ts`, `detector-errors.test.ts`, `real-world-phrases.test.ts`, `eval/holdout*.ts`; says detectors do not catch exceptions and `runDetectors` reports them; says the Boo-tique eval is a regression test and the hold-out is the generalisation figure; describes the stem rule in one sentence.

Amendment notes (end of each old file, heading "Amendments (detectors-static-fixes)", one line per item, no other line touched): `requirements.md`: 2.7, 2.13 (error visibility, req 6), 3.12 and 3.13 (stems, req 5), 3.18 (row snapshots, req 5.8), 7.14 and 13.6, 13.7 (unseen layers, req 11), 8.4 and 8.18 rows U1 and U5 (cue rule, req 7), 9.3 (restored, req 2), 9.4 (support, req 8), 10.2 (restored templates, req 2.5), 14.8 (replaced by req 3.1), new 14.10 (req 2.7), 17.6 (club timer expected miss, req 7.7), new 17.19 (hold-out, req 4, with the sanity floor instead of the review's X). `design.md`: 7 (colour, text, stems), 9.1 (worded), 9.2 and 9.3 (restored lists, section 3), 9.6, 12 (errors), 14. `tasks.md`: 12.3 (rule replaced by the corpus check; `GENERIC_CONTROL_LABELS` removed).

Recorded results (the last task fills this table; do not edit afterwards):

| Evaluation | Printed result | Date |
|---|---|---|
| Boo-tique, primary pairs | Recall 18/19 = 0.95; unplanted findings 0; flow-pattern findings ignored 0; false positives on look-alikes 0. By detector (flag / found / missed / false pos.): fake-urgency 3/2/1/0, fake-scarcity 3/3/0/0, fake-activity 2/2/0/0, confirmshaming 3/3/0/0, preselection 5/5/0/0, visual-interference 3/3/0/0. Only miss: club-timer-session-restart (7.7) | 17:25 local time, calendar date not available to the run |
| Boo-tique, secondary pairs | Recall 18/19 = 0.95; unplanted findings 0; flow-pattern findings ignored 0; false positives on look-alikes 0. Same per-detector counts as the primary pairs. Only miss: club-timer-session-restart (7.7) | 17:25 local time, calendar date not available to the run |
| Hold-out, 28 flag cases | Flag cases: 26/28 hits (recall 0.93), 2 of the misses are known misses (scarcity-only-3-split-span, urgency-offer-split-countdown). Review baseline (c21325f): 18/28. Hand-made hold-out of 48 review probes plus extras, not a measure of accuracy on real shops | 17:25 local time, calendar date not available to the run |
| Hold-out, 20 honest cases | Honest cases: 1/20 false positives (low 1, medium 0, high 0): honest-only-3-same-after-reload [fake-scarcity] low. Review baseline: 3/20 | 17:25 local time, calendar date not available to the run |
| Hold-out, 8 extras | Extras: flag 1/2 hits (extra-only-2-days-left hit, low; extra-offer-counting-up missed, known miss); honest 0/6 false positives (low 0, medium 0, high 0). Detector errors: 0 | 17:25 local time, calendar date not available to the run |

Task 7 (unseen layers, requirement 11) was not run for this record: the figures above do not include it, and the cookie-banner entries are unchanged by it.

## 15. Constants

New in `shared/constants.ts` (and in `EXPECTED` of `shared/constants.test.ts`): `MAX_STEM_EXTRA_CHARS = 6`, `MIN_STEM_CHARS = 4`, `FORBIDDEN_STEM_EXTRA_MAX = 10`. Unchanged: `MAX_PHRASE_TOKENS = 6`, `LOW_STOCK_MAX = 10` (unused by rules).

## 16. Test strategy

| Area | How | Files |
|---|---|---|
| Phrase counting, stems, forbidden stems | Unit | `shared/text.test.ts` |
| Restored entries, rule 14.8, coverage | Word-list data, corpus fixture | `word-lists.test.ts`, `real-world-phrases.test.ts` |
| Wording | Row snapshots, harness, hold-out cases | `wording.test.ts`, `helpers/row-snapshots.ts` |
| Errors | Hostile proxy, registry, source scan | `detector-errors.test.ts`, `source-rules.test.ts`, existing helper tests |
| Countdown, stock, activity, colour | Unit with small snapshots | `shared/countdown.test.ts`, `fake-urgency.test.ts`, `fake-scarcity.test.ts`, `fake-activity.test.ts`, `shared/colour.test.ts`, `visual-interference.test.ts`, `confirmshaming.test.ts`, `preselection.test.ts` |
| Hold-out | Harness, printed | `eval/holdout.test.ts`, `eval/holdout-eval.test.ts` |
| Boo-tique | Harness | `eval/boo-tique-eval.test.ts`, `eval/score.test.ts` |
| Split-element claims, capture-time backgrounds, live evaluation | Out of scope | later specs |

## 17. Error handling

Odd values give fewer findings, never an error entry. An exception inside a detector gives one `threw` entry for that detector and the others run. A broken corpus file or list fails its test with the list and entry named. Tests never swallow a detector error: the evaluations assert `errors: []`.

## 18. Requirement coverage

| Requirements | Design | Main tests |
|---|---|---|
| 1 | all | every task's rules block, `source-rules.test.ts` |
| 2 | 3 | `word-lists.test.ts`, detector tests |
| 3 | 4 | `real-world-phrases.test.ts`, `word-lists.test.ts` |
| 4 | 13 | `holdout.test.ts`, `holdout-eval.test.ts` |
| 5 | 5, 6 | `text.test.ts`, `wording.test.ts` |
| 6 | 7 | `detector-errors.test.ts` |
| 7, 8 | 8, 9 | `countdown.test.ts`, `fake-urgency.test.ts`, `fake-scarcity.test.ts` |
| 9, 10 | 5, 10, 11 | `text.test.ts`, `fake-activity.test.ts`, `fake-scarcity.test.ts`, `confirmshaming.test.ts` |
| 11 | 12 | `colour.test.ts`, `visual-interference.test.ts` |
| 12 | 14 | `boo-tique-eval.test.ts`, steering diff |

## 19. Order of work and tests that change on purpose

Each task leaves the suite green by changing, in the same task, the tests its behaviour breaks (requirement 1.11). Expected changes, so that a task run does not have to discover them blind:

| Task | Behaviour | Existing tests expected to change (with the requirement in a comment) |
|---|---|---|
| 1 Phrases, corpus, rule | Restored entries; `countPhraseElements`; new generality rule | `word-lists.test.ts` (length test, planted rules), `fake-activity.test.ts` (length test, "in cart" strings), `fake-scarcity.test.ts` and `hostile-input.test.ts` (renamed strings), `shared/text.test.ts` (new cases), `boo-tique-eval.test.ts` (hits for the two restored entries) |
| 2 Stems, wording | `isForbiddenToken`, `FORBIDDEN_STEMS`, `FORBIDDEN_STEM_EXTRA_MAX` | `shared/text.test.ts` (quote cases), `shared/finding.test.ts` (drop rule), `shared/constants.test.ts`, `word-lists.test.ts` (`MODULES` gains `FORBIDDEN_STEMS`) |
| 3 Errors | No `catch` in detectors and helpers | `shared/finding.test.ts` ("does not throw when reading capturedAt throws"), any helper test with a throwing getter, `hostile-input.test.ts` (title only), `source-rules.test.ts` (new rule) |
| 4 Countdown | One-letter units, cue rule | `shared/countdown.test.ts`, `fake-urgency.test.ts` (cases with "5 m", "30 s", offer-word durations), `word-lists.test.ts` (`COUNTDOWN_CUE_WORDS`), `boo-tique-eval.test.ts` (`ACCEPTED_MISSES`), corpus texts for the cue words |
| 5 Stock, sales-pop | S3 support, timed purchase templates | `fake-scarcity.test.ts` (small-number cases move from S3 to S4), `fake-activity.test.ts`, `word-lists.test.ts` (new lists, `MAY_BE_EMPTY`), corpus texts |
| 6 Turkish stems | Stem engine and entries | `shared/text.test.ts`, `shared/constants.test.ts`, `word-lists.test.ts`, the detector tests whose lists change (`fake-urgency`, `fake-scarcity`, `fake-activity`, `confirmshaming`, `preselection`), corpus texts |
| 7 Unseen layers | `unseen`, button rule | `shared/colour.test.ts`, `visual-interference.test.ts`, possibly `boo-tique-eval.test.ts` (`ACCEPTED_MISSES`, only by 11.1) |
| 8 Hold-out | New helpers and tests | `wording.test.ts` (adds the hold-out cases) |
| 9 Record | Documents only | `boo-tique-eval.test.ts` only if task 7 left a stale comment |

## 20. Accepted limits and decisions recorded

- Claims split across elements stay missed (`Only <span>3</span> left`, one span per countdown unit). The hold-out reports them as `knownMiss`; the fix needs capture output that this spec may not touch.
- The hold-out is hand-made by the review and by this spec's author. It is more independent than the Boo-tique eval but it is not a sample of real shops; no figure from it is a precision claim [12.11]. Its cases are fixed before the first run and never edited after a result.
- The corpus guarantees that list entries are phrases seen in shop copy or written in research section B. It cannot guarantee coverage of what real shops write; a phrase missing from the lists is a missed detection, not a test failure.
- The countdown cue rule drops the club timer's text-only hit and any `clock2` or `units` countdown without a cue word. This costs recall on purpose: durations next to offers are everywhere on shop pages and the review measured them as false positives.
- The unseen-layers rule is conservative: a banner whose wrapper is not captured loses its colour measures even when the wrapper is plain. It still flags on size and structure measures. A capture that emits effective backgrounds would restore the colour measures (later spec).
- Stems over-match related words ("indirimsiz", "garantili") and under-match words with more than 6 suffix letters. The first is harmless for list words (they are all about the same topic); the second is bounded on purpose.
- Forbidden stems over-mask a few innocent words ("scampi"). Under-masking would put a forbidden word in a finding, which is the worse error.
- `LOW_STOCK_MAX` stays as an unused pinned constant to avoid editing its constants test for no behavioural gain; a later cleanup may remove both.
- The reload gap rule 8.6 of the old spec (a restart whose jump equals the gap reads as counting up) is unchanged; the hold-out keeps one such case as a known miss.
