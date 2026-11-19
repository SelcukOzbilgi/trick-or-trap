This review was written by a Claude review agent before the follow-up spec, not by Kiro. Items are checked claims from probe runs; the probe scripts were not committed.

# Review: static detectors (`feat/detectors`, head `c21325f`)

Date: 2026-11-18. Independent review of `d156612..c21325f` (16 Kiro commits, spec `.kiro/specs/detectors-static/`). The `feat/page-capture` merge that the branch carries was not reviewed, except where the detectors depend on what `lib/capture/extractor.ts` emits. Nothing in the repository was edited. Probe scripts are in the session scratchpad (`review-det/*.probe.ts`), run through a separate vitest config with the repo's `@` alias.

What was run: `tests/detectors/` once (28 files, 1,168 tests, all pass, 1.9 s), plus five probe files. The full suite, the build, lint and tsc were not re-run; the driver's "3,017 passed, 5 skipped" figure is not verified here.

## Verdict

The code is careful, bounded, deterministic and free of Boo-tique keys. **The 17/19 evaluation is honest in its mechanics but does not measure generalisation.** The two misses were caused on purpose: a test task renamed two production phrases to satisfy an ill-posed anti-leak rule. On 28 hand-made real-world cases the detectors find 18 (64 %) and miss 10. On 20 honest look-alikes they raise 3 false positives (one medium), plus a medium false positive on an honest dark cookie banner and low-confidence urgency findings on ordinary durations. Recommendation: **not ready to merge as is.** Fix the word-list rule and restore the natural phrases first (small change). The false-positive sources and the capture-shape gaps listed under Q7 must be fixed before the public scan route.

## Driver's claims, checked

| Claim | Result |
|---|---|
| Eval: recall 17/19, 0 false positives on the 8 look-alikes | Confirmed (primary and secondary pairs; 0 unplanted findings). |
| Misses: `product-selling-fast-badge`, `product-almost-gone-tiny` | Confirmed. |
| Kiro renamed "selling fast" and "almost gone" | Confirmed, in commit `811ada5` (task 12, a *test* task that edited `lib/detectors/data/scarcity-words.ts` and rewrote 14 test strings to match). Before that commit both entries were present and recall would have been 19/19. |
| Words dropped from four over-long phrases | Confirmed, but in `bdcadaf` (task 8), not task 12: `# people have this in their cart` became `# people have this in cart`, the same for "basket", and `@'dan @ az önce satın aldı` and `@'den …` lost "az önce". Words were removed from the middle, so the English entries no longer match the natural phrase (probe EN6 misses). Cause: the length test counts `@'dan` as three tokens, the compiler as one element. |
| Exemption of 10 planted texts | **The code has 8**, not 10: `accept all, reject, options, subscribe, no thanks, not now, partners, insurance` (`tests/detectors/word-lists.test.ts:283`). |
| Turkish benefit and negation words match whole tokens only | Confirmed. "kaçırmak", "indirimleri" and "fırsatları" do not match "kaçır", "indirim" and "fırsat" (probe TR11 misses). |
| "Only 5 m left" parses as a 5-minute countdown | Confirmed, and the cause is broader (Q6). |
| `design.md` §14 lists a `wording.test.ts` that no task creates | Confirmed. Criterion 3.18 is covered only in part: by `hostile-input.test.ts` (its own findings) and the eval (harness findings). Findings from the per-detector unit tests are never scanned. |

## Q1. Is the evaluation honest?

### What is clean

- **No keys on the demo.** The detectors read no URL, route, class, id attribute, `href` or `data-*` attribute. Attribute reads are limited to `type`, `name`, `disabled`, `aria-checked`, `aria-label`, `aria-modal` and `aria-live` (grep of `attr(` calls). There is no "testid" anywhere under `lib/detectors/`, no demo term, and no import of `lib/capture` or `lib/boo-tique`.
- **No threshold tuning.** All 33 constants in `shared/constants.ts` equal the design table, which was written before implementation from research section B.5.
- **The harness builder follows the extractor.** `tests/detectors/eval/helpers/tree.ts` matches `collectInPage`/`buildSample` in eligibility, `innerText` for controls, labels, links, summaries and role elements, own text for everything else, the attribute allow-list, the cut lengths, pre-order ids, the drop of zero-size non-controls, and non-inherited background and opacity. `light.ts` applies the light rules (text 120, 750 elements, `type`/`name`/`disabled`, no `outsideImage`). The two deliberate differences are documented: `data-*` is passed through so `assertNoTestHooks` can catch it, and boxes are estimated. A small undocumented difference: the harness joins child text with spaces, whereas real `innerText` does not insert spaces between inline children. The tokeniser absorbs this.
- **Mapping and scoring are kept apart.** Entry ids meet node keys only in `entry-map.ts`. Detectors see only the snapshot. No test asserts on a mock of itself: the eval runs the real `runAllDetectors` on built snapshots, and the sync test renders the real routes.

### Where the score is inflated or skewed

1. **The plants have the easiest possible shape.** Every planted claim is one template literal in one element (`<p>{`Only ${n} left!`}</p>`, `<p>{label + " " + time}</p>`). Real shops often split them: `Only <span>3</span> left in stock`, or countdown widgets with one span per unit. The real extractor then emits "Only left in stock" and "3" as separate elements, and the detectors never join them (probes EN4 and EN8 both miss). This comes from the extractor's own-text rule meeting real markup. The harness is faithful to that rule, so it cannot reveal the gap.
2. **The plants use canonical wording.** Each claim is the phrase the list was written for. The look-alikes were also phrased in the form the rules ignore: the honest stock text is the bare "3 left", while the most common honest form, "Only 3 left in stock", gets S3 **medium** (probe H2). Planted and honest stock differ only by the word "only". This is the clearest sign that the 0-false-positive figure says little about real pages.
3. **Two of the 17 hits do not observe the planted mechanism.** `product-sold-toast` (A2, role `status`) and `club-timer-session-restart` (U5: a *consistent* countdown flagged only because it sits next to "20% off"). Spec 17.5 and 17.6 allow both. Recall on entries whose planted signal one page plus one reload can show is **15/17**. No look-alike tests an honest ticking timer, so U5's precision is never measured (it is poor; see Q6).
4. **The visual-interference "high" results rest on authored geometry.** The upsell close box (3 × 8 px) and the add button (432 × 57) are explicit boxes. The cookie buttons' sizes are estimates (characters × font × 0.55), and the banner background is a guess from a class (`CLASS_STYLE_PROPS`). Design §13 says this. It means these three hits prove the rule logic, not the measurement.

### The opposite distortion: the rename

The rename lowers real-world recall to satisfy a test, and it breaks the spec's own sources:

- Requirement **9.3** names "selling fast" and "almost gone" as its examples. The code now fails its own requirement.
- Design §9.2 lists both. Design §13 expects S5 for both entries.
- `findings-wording.md` uses "a 'Selling fast' badge" as *the* example of a low finding.
- Research section B (`docs/research/dark-patterns.md:49`), which the review rule of 14.9 names as the source for list entries, lists `selling fast|almost gone|low stock|high demand|…` and `have this in (their )?cart`.

The 14.8 rule is ill-posed. The test bans an entry that *contains* a planted text (`word-lists.test.ts:321-341`), but allows an entry that is contained *in* one. So "i hate saving" and "i'll pay full price", both substrings of planted declines, pass, while "selling fast" fails because the planted badge is exactly those two words. The rule keys on how short a planted text is, not on whether it is specific to the demo. The 8-label exemption is the correct behaviour applied to only two modules.

### The right rule

I agree with your view, with two additions:

1. **List entries must be common real-world shop wording, whether or not the demo uses them.** The anti-leak rule should forbid what is demo-specific: `DEMO_TERMS` words (already enforced), and any entry that keeps a planted text's demo-specific tokens. For example, "of the dead ends at midnight" is forbidden, "ends at midnight" is fine.
2. **Provenance has to be testable, not only a comment.** Add an independent corpus, `tests/fixtures/real-world-phrases.json`: short EN and TR texts from research section B and common shop wording, never copied from Boo-tique files. Require every list entry to occur in some corpus text.
3. **The corpus also serves as a hold-out evaluation.** Build snapshots from it in several markup shapes (single node, split number, inflected Turkish), score them separately, and do not tune against them. Treat the Boo-tique eval as a regression and smoke test, not as a generalisation figure. Otherwise "plant the canonical phrase, list the canonical phrase" becomes a tautology in the other direction.

Proposed wording:

- **Requirement 14.8 (replace):** "WHEN the generality test runs THE SYSTEM SHALL find that no list entry holds a word of `DEMO_TERMS`, that no entry is longer than `MAX_PHRASE_TOKENS` elements as counted by `compilePhrases`, and that every entry of a word or phrase list occurs, after `normaliseText`, in at least one text of `tests/fixtures/real-world-phrases.json`. That corpus SHALL hold no text copied from Boo-tique files. A list entry MAY equal a planted Boo-tique text."
- **New 14.10:** "WHEN a list entry would exceed `MAX_PHRASE_TOKENS` THE SYSTEM SHALL shorten it only from the start or the end, so that it still matches the natural phrase, and never by removing an inner word."
- **New 17.19:** "WHEN the hold-out evaluation runs on snapshots built from the real-world corpus THE SYSTEM SHALL report recall and false positives separately from the Boo-tique score and SHALL require recall ≥ X and no medium or high false positive." The owner sets X.
- **Design 9.2:** restore "selling fast" and "almost gone" (the new entries may stay). Note that the planted badge texts are canonical on purpose.
- **Design 9.3:** replace the 7-element entries with `# people have this in their` (6 elements, matches "… in their cart" and "… in their basket"). Keep `@'dan @ az önce satın aldı`, which is 6 compiled elements.
- **Task 12.3:** replace "no normalised entry equals or contains a normalised text of `plantedTexts()`" with the corpus check above. Delete `GENERIC_CONTROL_LABELS` and its exemption. Count phrase length with the compiler's element count. Keep the `DEMO_TERMS` check.

## Q2. Generalisation probe

48 hand-made snapshots (`review-det/general.probe.ts`, plain objects shaped like the extractor output, with light reload samples where noted). Not fitted to the detectors.

**Flag cases: 18 hits, 10 misses of 28. Honest cases: 17 clean, 3 false positives of 20 (1 medium, 2 low).**

| Result | Case |
|---|---|
| hit | EN "Hurry! Only 3 left in stock" (S3 medium); "12 people are looking at this right now" (A2); "Sale ends tonight!", "Deal ends today" (U6); "Offer ends in 02:14:33" → 02:14:59 (U2 high); "No thanks, I don't like free stuff", "No, I prefer paying full price" (C2); ticked "Add shipping insurance for $2.99" (P1); ticked "email me offers and promotions" (P2) |
| hit | TR "Tükenmek üzere!" (S5); "Son 3 ürün!", "Stokta son 2 adet" (S3); "İstanbul'dan Ayşe az önce satın aldı" (A2, matched by the third template); "Kampanya gece yarısı bitiyor, kaçırmayın!" (U6); "Fırsatı kaçırma! … 01:59:59", equal reload (U3); "Hayır, indirim istemiyorum" (C1); ticked "Kampanyalardan e-posta ile haberdar olmak istiyorum" (P2); ticked "Ürün koruma paketi ekle +49,90 TL" (P1) |
| MISS | EN "Selling fast"; "Almost gone!" (rename) |
| MISS | EN "5 people have this in their cart", 5 → 9 (shortened template) |
| MISS | EN `<p>Only <span>3</span> left in stock</p>`; countdown split into three spans (capture shape) |
| MISS | EN sales pop "Sarah in London purchased a Blue Dress 5 minutes ago" (no "purchased … ago" template) |
| MISS | TR "Stokta son ürünler" (no number, not listed); "23 kişi şu an bakıyor" (list has "şu anda"); "Bu ürünü şu anda 15 kişi inceliyor", 15 → 27 (word order) |
| MISS | TR "Hayır, indirimleri kaçırmak istiyorum" (whole-token match; "istiyorum" is not a first-person suffix in the list) |
| FP medium | Honest "Only 3 left in stock", same number on reload: S3 by spec (calibration, not a bug) |
| FP low | "Only 5 m left" (fabric), "Only 1 M left" (size M): unit-countdown parser (Q6) |
| clean | future dated sale; "3 in stock" and "Stokta 3 adet" equal; equal-style cookie buttons; "No thanks" / "Hayır, teşekkürler" declines; unticked newsletter (EN and TR); ticked "I agree to the Terms" and "Mesafeli satış sözleşmesini … kabul ediyorum"; "Order within 2h 15m for next-day delivery"; "4.8 (1,203 reviews)"; "Kış indirimi 28 Şubat 2027'de sona eriyor"; "Sepetinizde 2 ürün var"; "Saat 14:00'e kadar … aynı gün kargoda"; cheapest shipping radio default; "Free returns within 30 days" with no offer word nearby |

Extra probes, outside the 48:

- **Restart that looks like ticking.** "Offer ends in 02:14:33" → 02:14:40 with a 9 s gap gives no finding: it is classed "counting up" (8.6). A real restart where the time from first paint to read is close to the gap is invisible. Reported as the first result. I then changed the case to → 02:14:59, which is the U2 hit in the table.
- **Units next to an offer word.** "Free returns within 30 days" under a "Sale" parent, "Battery life 12 hours" next to "Save 10%", "Video 12:34" under "Sale", "Ready in 15 min" under "Deal of the day", "Delivery in 2 days · 20% off": **all give a low "Possible fake urgency: countdown timer"** (U5).
- **Honest dark cookie banner.** The dark container has no own text, so it is not captured. Accept is filled white, Reject is an outline button with white text, both the same size. Result: **visual-interference medium**. The contrast is measured against the `<body>` white because the dark wrapper is missing, and `backgroundAssumed` is not set because an opaque ancestor *was* found. "Filled versus transparent" then adds a second colour measure, because borders are not captured. With the dark container captured, there is no finding.
- **Tailwind v4 colours.** `oklch(...)` computed colours are not parsed (`colour.ts` accepts rgb, rgba, hex and `transparent`). No false positive results, but colour measures silently disappear on Tailwind v4 shops. This project's own stack is Tailwind 4.

## Q3. Correctness and robustness

Timings are from `review-det/hostile.probe.ts` on this Mac, under `nice`.

| Input | Result |
|---|---|
| 50,000 elements (all claims, dialogs, checked inputs) plus a 20,000-element reload | All six detectors 143 ms in total (`runAllDetectors` 96 ms), 20 findings each, all valid |
| 1,500 controls in one dialog; 1,500 controls under one parent | 19 ms; 60 ms |
| 1,500 elements with ids 64 levels deep | 554 ms (slowest case; about 85 ms per detector) |
| 1,500 × 160 capitalised words around "from" (the `@` placeholder) | 248 ms |
| 5 MB text, 2 MB colour string, `NaN`/`Infinity` boxes, 100,000 attributes, `__proto__`/`constructor` keys and ids, `null`/number/array elements, a `toString` that throws, a 10,000-segment id | 1 ms, no throw, valid findings, longest evidence 152 characters (quote cut at 120 plus "…") |
| Proxy snapshot or elements array that throws on every access; a getter that throws | No throw from `runAllDetectors`, 0 findings, **0 errors** |
| Determinism | The same snapshot twice, with another run in between: identical. Reversed or permuted arrays of ≤ 1,500 elements: identical. At 3,000 elements the output differs because the element budget is applied before sorting. That is a choice of which elements to read, not non-determinism; the real capture emits document order anyway. |
| Finding boxes | 60 findings with unique boxes per element: `boundingBoxes[i]` always belongs to `elementIds[i]`; decline/close first and accept second; control first and label second. |
| Regular expressions | Only three, in `shared/patterns.ts`, all bounded with no nested quantifiers. Everything else uses tokens and set lookups, so there is no backtracking risk. |

Problems:

- **Silent all-clear.** Every detector body is `try { … } catch { return []; }`. A real bug on some page, or the proxy and getter cases above, becomes "no findings" with no `DetectorError`, even though `runDetectors` already has an error channel. Before the public route, report caught exceptions (for example, let the detector throw only in tests, or return a marker that `runAllDetectors` turns into an error).
- **Confidence values** follow the spec tables (verified for U2–U7, S1–S5, A1–A3, C1, C2, P1, P2, P4, P5, V1–V3) and the tables are documented in `requirements.md`. Calibration concerns: S3 gives medium to every honest "Only N left" with N ≤ 10, because the number is counted as its own support (9.4). U5 is very broad. Change: count support only from an exclamation mark, a pressure word or another claim, not from N ≤ 10.

## Q4. Wording rules

- All 17 titles start with "Possible". They live in `shared/finding.ts`, and every detector takes its title from `TITLES`.
- There is no banned word in any template, explanation, description or evidence string (grep of `lib/detectors/` for illegal, unlawful, scam, fraud, decept-, deceiv-, dishonest, cheat, yasadışı, dolandır-, aldatıcı and manipulat-). All templates are English; Turkish appears only inside quoted page text.
- **Gap:** forbidden words are masked only as exact whole tokens. Quoted page text "Beware of scammers and frauds, dolandırıcılara dikkat" reaches the evidence string unmasked, and 3.13 does not drop it. Change: match stems (`scam*`, `fraud*`, `illegal*`, `unlawful*`, `deceiv*`, `decept*`, `dolandırıcı*`, `yasadışı*`, `aldatıcı*`).

## Q5. Spec conformance (sample of 52 criteria)

**Met:**

- **Contract (2):** 2.1, 2.2, 2.4, 2.5, 2.7 (through the catch-all, see Q3), 2.8, 2.9, 2.10, 2.11, 2.12, 2.13 (no throw), 2.15.
- **Findings (3):** 3.1, 3.3, 3.10, 3.16, 3.17.
- **Wiring (4):** 4.2, 4.3, 4.4, 4.6, 4.9 (`registry.test.ts` unchanged since `d156612`).
- **No hooks (6):** 6.1, 6.3, 6.4.
- **Snapshot rules (7):** 7.3, 7.5.
- **Urgency (8):** 8.3, 8.13, 8.14, 8.15, 8.17.
- **Scarcity and activity (9, 10):** 9.4, 9.10, 10.3.
- **Confirmshaming (11):** 11.3, 11.6.
- **Preselection (12):** 12.3, 12.4, 12.13.
- **Visual interference (13):** 13.5, 13.7.
- **Languages (14):** 14.4, 14.6 (Spanish), 14.7 (German U4 medium), 14.9.
- **Hostile input (15):** 15.6, 15.8 (far under 2,000 ms).
- **Harness and eval (16, 17):** 16.5, 16.10, 17.12, 17.13, 17.16–17.18.
- **Steering (18):** 18.1–18.5.

**Unmet or only nominal:**

| Criterion | Finding |
|---|---|
| 9.3 | **Unmet.** Its own examples "selling fast" and "almost gone" do not match. |
| 10.1 and 10.2 against design 9.3 | Design templates shortened by removing inner words. "… have this in their cart" no longer matches. The TR purchase entries lost "az önce" (still covered by the third template). No note in the spec files. |
| 3.12 and 3.13 | Met literally, weak in practice: inflected forbidden words pass unmasked (Q4). |
| 3.18 | Nominal and partial: no `wording.test.ts`, and unit-test findings are not scanned. |
| 8.6 | Met, but hides restarts whose jump is close to the gap. |
| 8.18 U5 | Met as written, but the spec row is too broad: any duration next to an offer word (Q6). |
| 14.8 | Met literally, but the rule forces the 9.3 violation and needed the exemption. |
| 14.5 | Met per text rule; Turkish cases do not cover inflected forms. |

### The two spec conflicts and the exemption

- **9.3 / design 9.2 versus 14.8.** Kiro resolved it by breaking 9.3 without recording the deviation. 9.3 should win; 14.8 should change as proposed in Q1.
- **Design 7-element entries versus the 6-token cap.** Kiro resolved it by deleting inner words, which kills the match. It should cut from the end (or count elements the way the compiler does) and record the change.
- **The 8-label exemption** is not harmful in itself: control labels must be matchable, and claim lists stay covered. But it is the symptom of the bad rule. Remove it together with the rule rather than widening it.

## Q6. The two misses and the "5 m" false positive

**Misses.** Root cause: the task-12 rename in `811ada5`. Smallest fix: add "selling fast" and "almost gone" back to `UNQUANTIFIED_SCARCITY.en` (the new entries may stay), revert the 14 test strings, and change 14.8 and task 12.3 as in Q1. Expected result: 19/19 on the harness.

**"5 m" and related false positives.** Two causes in `fake-urgency.ts` and `shared/countdown.ts`:

1. `readUnits` accepts one number with a one-letter unit ("5 m", "1 M") as a countdown. The unit is matched after case folding, so size "M" becomes minutes.
2. `isWorded` counts *any* urgency **or offer** word in the element **or its parent container**. Every duration ("30 days", "12 hours", "15 min") and every two-part clock ("12:34") near "Sale", "Save" or "% off" becomes U5.

Smallest correct fix:

- In `readUnits`, a pair with a one-letter unit counts only when at least two pairs are read ("2h 30m"), and the unit's surface must be lower case.
- For `form === "units"` and `"clock2"`, "worded" requires a countdown cue in the **same element**: one of "ends in", "expires in", "closes in", "left", "remaining", "only", "hurry", "bitiyor", "sona eriyor", "kaldı", or "kapanıyor". Offer words and parent text would count only for `clock3` (HH:MM:SS), which remains the strong form.

Afterwards "Only 5 m left" becomes no finding, "Only 2 days left" stays a low U5, and "Battery life 12 hours" next to "Save 10%" becomes no finding. The club timer ("Join in 09:59 for 20% off") has no cue under this rule, so its text-only U5 hit would be lost. **Decide explicitly:** either accept that (18/19 after restoring the two phrases, and arguably more honest, since the restart is not observable), or add "in" directly before a clock as a cue.

## Q7. Merge readiness

The review covers the detectors diff only. `feat/page-capture` is being reworked separately. No file outside the spec's scope changed since `d156612`.

### Must fix before merge

1. Restore "selling fast" and "almost gone". Rewrite 14.8, design 9.2 and task 12.3 as in Q1, and delete the control-label exemption.
2. Restore natural long templates: `# people have this in their` and `@'dan @ az önce satın aldı` (cut from the end, or count compiled elements). Record both deviations in the spec.
3. Correct the record: the exemption has 8 entries, and `wording.test.ts` / 3.18 is partial. Either add the cross-test forbidden-word scan or amend design §14.

### Must fix before the public scan route

1. **Narrow the unit-countdown and "worded" rules** (Q6). Today low urgency findings appear on ordinary product pages.
2. **Fix the background chain.** When the element and the ancestor whose background is used are separated by uncaptured levels, mark the background assumed (no high and no contrast measure), and do not let "filled versus transparent" count without a captured border. Better, a capture change for the rework: emit each element's effective background computed in the page, or capture containers that have a non-transparent background.
3. **Join split text.** Give claims a subtree text for containers whose own text is a fragment ("Only left in stock" plus child "3"; countdown digits in separate spans). This also needs the capture rework to decide how text-less containers are represented. Pass this to the capture owner.
4. **Calibrate S3.** "Only N left" with N ≤ 10 and no other support should be low, not medium. This is the honest form shops use most.
5. **Report swallowed exceptions** as `DetectorError` instead of a silent `[]`.
6. **Match forbidden words by stem** (Q4).
7. **Turkish morphology.** Allow suffix matching for benefit, negation, offer and look-alike words ("kaçır*", "indirim*", "fırsat*", "yorum*"). Add "şu an", "inceliyor" in other word orders, and "stokta son". For English, add "purchased … ago" and "someone in @ purchased" sales pops.
8. **Hold-out corpus evaluation** (Q1), and the opt-in live evaluation that design §13 promises, before quoting any recall figure publicly.

### Nice to have

- Parse `oklch()`, `oklab()`, `lab()` and `color(srgb …)`, or convert them in the page; otherwise visual interference loses colour measures on Tailwind v4 sites.
- Custom checkboxes hidden with `display: none` on the input and a styled label are never flagged (12.3 by design). Consider reading the label's `aria-checked` or `role="checkbox"` siblings.
- Treat a reload increase near the gap with care (8.6). Very short restarts are misread as ticking.
- Build the element index once per `runAllDetectors` call instead of six times (deep-id case: 85 ms per detector).
- Move `outsideImage` and truncation notes out of `description` into structured fields when the UI is built.
