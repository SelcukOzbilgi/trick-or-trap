# Tasks: Static Detector Fixes

Rules for every task:

- Each top-level task runs in its own separate run. Do not start the next task. Read only the requirement and design sections the task names, the files it names and the files it edits; do not read the whole spec. The "Uses" line names what earlier tasks provide.
- Shell commands: only `npx vitest run <one test file> --maxWorkers=2` (one file per command; only the files the task touched or names as dependent) and `npx tsc --noEmit`; `npm run lint` only in task 9. Everything else is denied: no install, no build, no dev server, no browser, no network, no watch mode, no commit, no chaining, no redirection, no `ls`, `cat` or `grep`. Use the file tools. Never run the full suite; the owner does.
- Write the test first, then the code that makes it pass. Tests are `.ts` files without JSX, use the `@/` alias, open no browser, never import `playwright-core` and make no network call.
- Never read or write `.env` files. Add no dependency. Never edit `package.json`, the lockfile, `lib/capture/`, `tests/capture/`, `lib/types`, `lib/boo-tique`, `components/`, `app/`, `vitest.config.ts`, `.kiro/agents`, `.kiro/hooks`, `.kiro/settings`, `.github`, `.githooks`, `scripts/`, `SECURITY.md`, `.gitleaks.toml`, `tests/detectors/registry.test.ts`, `.kiro/steering` or the old spec before task 9 (and only task 9 edits the table of design section 14). Allowed edits: files under `lib/detectors/`, and the files of `tests/detectors/` and `tests/fixtures/real-world-phrases.json` that the task names; the old rule "never edit another existing test" does not apply to files the task names.
- Detectors are pure functions: no network, no clock except snapshot values, no randomness, no module-level mutable state; they never read test hook attributes, class names or `data-*`. The word "testid" (any case) appears in no file under `lib/detectors`, `lib/capture` or `lib/judge`, comments included (write "test hook attributes"); under `tests/detectors` only `tests/detectors/eval/helpers/no-hooks.ts` may contain it. Finding titles start with "Possible"; the words illegal, scam, fraud and their relatives appear in no text a detector produces (the forbidden-word data and its tests are the only exception).
- Never weaken a test: no deleted cases, loosened expectations or new exemptions. Any test whose expectation a requirement of this spec deliberately changes carries a comment naming that requirement. If a test and the spec contradict each other, stop and say so in the final reply.
- Word lists stay generic and every entry occurs in the corpus. Never add a word to make a Boo-tique entry pass; report a missed target. Never tune a number, a case or a threshold to a result.
- Every task leaves the whole existing suite green: change in the same task the tests that its behaviour breaks, run each dependent test file the task names (one command each) and then `npx tsc --noEmit`. In the final reply list every criterion not met and every test changed on purpose, with requirement numbers.

- [x] 1. Restored phrases, phrase counting, corpus and the new generality rule
  - Uses: `lib/detectors/shared/text.ts`, `data/scarcity-words.ts`, `data/activity-words.ts`, `tests/detectors/helpers/demo-terms.ts`, section B of `docs/research/dark-patterns.md`. Read no Boo-tique text for the corpus (requirement 3.9).
  - Files: creates `tests/fixtures/real-world-phrases.json`, `tests/detectors/helpers/real-world-phrases.ts`, `tests/detectors/real-world-phrases.test.ts`; edits `lib/detectors/shared/text.ts`, `data/scarcity-words.ts`, `data/activity-words.ts`, `tests/detectors/word-lists.test.ts`, `shared/text.test.ts`, `fake-scarcity.test.ts`, `fake-activity.test.ts`, `hostile-input.test.ts`, `helpers/demo-terms.ts`, `eval/boo-tique-eval.test.ts`.
  - Reads: requirements 1, 2, 3; design 2, 3, 4.
  - Dependent tests to run: `tests/detectors/shared/text.test.ts`, `word-lists.test.ts`, `real-world-phrases.test.ts`, `fake-scarcity.test.ts`, `fake-activity.test.ts`, `hostile-input.test.ts`, `eval/boo-tique-eval.test.ts`.
  - [x] 1.1 Tests first. In `shared/text.test.ts` add cases for `countPhraseElements` ("@'dan @ az önce satın aldı" is 6, "# people have this in their" is 6, "" is 0). In `word-lists.test.ts` replace the `tokenise` length test by `countPhraseElements` (1 to `MAX_PHRASE_TOKENS`), keep the compile-size check, delete `GENERIC_CONTROL_LABELS`, `CONTROL_LABEL_MODULES` and the two planted-text tests built on them, and add the coverage test of design 4 (every entry of every "wordlist" list occurs in a corpus text of its language; `FIRST_PERSON_SUFFIXES.tr` by word ending). Move `keyTokens` and `containsSequence` into `helpers/demo-terms.ts`.
  - [x] 1.2 Create `helpers/real-world-phrases.ts` (`RealWorldPhraseSchema` with Zod, `loadRealWorldPhrases()`) and `real-world-phrases.test.ts` (shape, unique ids, at least 100 texts and 40 per language, anti-copy by whole-text equality and `DEMO_TERMS` only, no containment check). Run the three test files; they fail.
  - [x] 1.3 Implement `countPhraseElements` in `text.ts` and use it inside `compilePhrases`. Restore the entries of design 3 (the two scarcity phrases, "# people have this in their", the two Turkish purchase entries). Search the data files and `tests/detectors/` for other renames or shortenings by tasks 8 and 12 of the old spec (requirement 2.6) and restore them by rule 2.7; list them in the final reply.
  - [x] 1.4 Revert the test strings rewritten by old task 12 ("Selling fast", "Almost gone", "have this in their cart") in `fake-scarcity.test.ts`, `fake-activity.test.ts`, `hostile-input.test.ts` and any other hit; keep separate cases for "selling out fast" and "almost sold out". Replace the `tokenise` length check at the end of `fake-activity.test.ts` by `countPhraseElements`.
  - [x] 1.5 Write `tests/fixtures/real-world-phrases.json` (design 4): realistic English and Turkish shop texts from section B and general knowledge, one entry per line, at least 100 texts, each list entry covered. Run `word-lists.test.ts` and `real-world-phrases.test.ts`; add or rewrite corpus texts until both pass (requirement 3.13).
  - [x] 1.6 In `eval/boo-tique-eval.test.ts` assert that `product-selling-fast-badge` and `product-almost-gone-tiny` are hits with a low `fake-scarcity` finding titled "Possible fake scarcity: scarcity wording" (comment: requirement 2.1, 2.2).
  - [x] 1.7 Run the seven test files (one command each), then `npx tsc --noEmit`.
  _Requirements: 1.3, 1.4, 1.8, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.11, 3.12, 3.13, 12.3_

- [ ] 2. Forbidden words by stem, and the wording test
  - Uses: `shared/text.ts` (`quote`, `maskForbidden`), `shared/finding.ts` (`containsForbidden`), `data/forbidden-words.ts`, `shared/constants.ts`, `tests/detectors/eval/helpers/pages.ts` (`PAGE_VARIANTS`, `buildVariantSnapshot`).
  - Files: creates `tests/detectors/wording.test.ts`, `tests/detectors/helpers/row-snapshots.ts`; edits `lib/detectors/data/forbidden-words.ts`, `shared/text.ts`, `shared/finding.ts`, `shared/constants.ts`, `tests/detectors/shared/text.test.ts`, `shared/finding.test.ts`, `shared/constants.test.ts`, `word-lists.test.ts`.
  - Reads: requirements 1, 5; design 5 (forbidden stems), 6, 15.
  - Dependent tests to run: `shared/text.test.ts`, `shared/finding.test.ts`, `shared/constants.test.ts`, `word-lists.test.ts`, `wording.test.ts`, `eval/boo-tique-eval.test.ts`.
  - [ ] 2.1 Tests first: `text.test.ts` quote cases for "scammers", "frauds", "dolandırıcılara", "dolandırıcılık", "illegally", "yasadışı", "aldatıcı", also with a Turkish apostrophe suffix and in capitals; a word that starts with a stem but has more than `FORBIDDEN_STEM_EXTRA_MAX` extra letters is not masked; `finding.test.ts` drop rule for the same words; `constants.test.ts` gains `FORBIDDEN_STEM_EXTRA_MAX: 10`.
  - [ ] 2.2 Create `helpers/row-snapshots.ts` (one small plain-object snapshot per rule row, design 6) and `wording.test.ts` (design 6; the hold-out cases are added by task 8). Run it; the stem cases fail.
  - [ ] 2.3 Add `FORBIDDEN_STEMS` and the constant; add `isForbiddenToken` to `text.ts` and call it from `maskForbidden` and from `containsForbidden`; add `FORBIDDEN_STEMS` to `MODULES` of `word-lists.test.ts` as a "plain" list. No regular expression.
  - [ ] 2.4 Run the six test files (one command each), then `npx tsc --noEmit`.
  _Requirements: 1.5, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9_

- [ ] 3. Report detector exceptions
  - Uses: the six detectors, `shared/elements.ts`, `shared/samples.ts`, `shared/finding.ts`, `lib/detectors/index.ts` (read only; its exports and `registry.test.ts` stay unchanged).
  - Files: creates `tests/detectors/detector-errors.test.ts`; edits the six detector files, `shared/elements.ts`, `shared/samples.ts`, `shared/finding.ts`, `tests/detectors/source-rules.test.ts`, `shared/finding.test.ts`, `hostile-input.test.ts` and any helper test that expects a throwing getter to be swallowed.
  - Reads: requirements 1, 6; design 7.
  - Dependent tests to run: `detector-errors.test.ts`, `source-rules.test.ts`, `shared/finding.test.ts`, `shared/elements.test.ts`, `shared/samples.test.ts`, `hostile-input.test.ts`, `all.test.ts`, `eval/boo-tique-eval.test.ts`.
  - [ ] 3.1 Tests first: `detector-errors.test.ts` as in design 7 (hostile proxy and getter give six `threw` errors in order and no throw; each detector called directly throws; registry with a real and a probe detector; odd values give `[]` and `errors: []`; normal snapshot gives `errors: []`). Add the source rule "no `catch` in `lib/detectors/**` except `index.ts`" to `source-rules.test.ts`. Run both; they fail.
  - [ ] 3.2 Remove every `catch` listed in design 7 and update the doc comments (requirement 6.11). Search `tests/detectors/` for `get ` accessors and `Proxy` cases that expect a swallowed read; change them to expect the exception, with a comment naming 6.4; rename the `hostile-input.test.ts` helper test as design 7 says.
  - [ ] 3.3 Run the eight test files (one command each), then `npx tsc --noEmit`.
  _Requirements: 1.11, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9, 6.10, 6.11, 6.12_

- [ ] 4. Narrow the countdown rules
  - Uses: `shared/countdown.ts` (`readUnits`), `fake-urgency.ts` (`isWorded`, `rowFor`, `bestCountdownRow`), `data/urgency-words.ts`, the corpus from task 1.
  - Files: edits `lib/detectors/shared/countdown.ts`, `fake-urgency.ts`, `data/urgency-words.ts`, `tests/fixtures/real-world-phrases.json`, `tests/detectors/shared/countdown.test.ts`, `fake-urgency.test.ts`, `word-lists.test.ts`, `eval/boo-tique-eval.test.ts`.
  - Reads: requirements 1, 7, 12.3; design 8.
  - Dependent tests to run: `shared/countdown.test.ts`, `fake-urgency.test.ts`, `word-lists.test.ts`, `real-world-phrases.test.ts`, `wording.test.ts`, `hostile-input.test.ts`, `eval/boo-tique-eval.test.ts`.
  - [ ] 4.1 Tests first: every probe of requirements 7.5, 7.6, 7.8, 7.11 and 7.12 in `fake-urgency.test.ts` and the parser cases ("5 m", "1 M", "30 s", "2H 30M" give none; "2h 30m", "30 sec", "2 days" parse) in `countdown.test.ts`; `COUNTDOWN_CUE_WORDS` in `MODULES` of `word-lists.test.ts`. Run them; they fail.
  - [ ] 4.2 Implement the one-letter rule in `readUnits`, add `COUNTDOWN_CUE_WORDS`, make `isWorded` take the countdown and use the cue rule for `units` and `clock2` (design 8). Add corpus texts that hold every cue entry.
  - [ ] 4.3 Change the existing expectations this breaks (offer-word durations, one-letter units) with a comment naming 7.1 to 7.4. In `boo-tique-eval.test.ts` add `ACCEPTED_MISSES` holding `club-timer-session-restart` (comment: requirement 7.7); every miss must be in it; keep the floor of 16 of 19. Do not add a cue to the demo shop.
  - [ ] 4.4 Run the seven test files (one command each), then `npx tsc --noEmit`.
  _Requirements: 1.11, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 7.9, 7.10, 7.11, 7.12, 12.2, 12.3, 12.4_

- [ ] 5. Stock calibration and English sales-pop forms
  - Uses: `fake-scarcity.ts` (`isSupported`), `fake-activity.ts`, `data/activity-words.ts`, the corpus.
  - Files: edits `lib/detectors/fake-scarcity.ts`, `fake-activity.ts`, `data/activity-words.ts`, `shared/constants.ts` (doc comment only), `tests/fixtures/real-world-phrases.json`, `tests/detectors/fake-scarcity.test.ts`, `fake-activity.test.ts`, `word-lists.test.ts`.
  - Reads: requirements 1, 8, 10; design 9, 11.
  - Dependent tests to run: `fake-scarcity.test.ts`, `fake-activity.test.ts`, `word-lists.test.ts`, `real-world-phrases.test.ts`, `wording.test.ts`, `hostile-input.test.ts`, `eval/boo-tique-eval.test.ts`.
  - [ ] 5.1 Tests first: requirements 8.1 to 8.4 and 8.6 in `fake-scarcity.test.ts`; requirements 10.1 to 10.3 in `fake-activity.test.ts` ("Sarah in London purchased a Blue Dress 5 minutes ago" flags, the same without "ago" and "Sarah from London bought this for her mother" do not); add `TIMED_PURCHASE_TEMPLATES` and `PURCHASE_TIME_WORDS` to `MODULES`, with their Turkish arrays in `MAY_BE_EMPTY`.
  - [ ] 5.2 Remove the `LOW_STOCK_MAX` line from `isSupported`; keep the constant and its pinned test, with a doc comment that no rule uses it. Add the two activity lists and the timed-purchase rule (design 11). Add corpus texts for every new entry.
  - [ ] 5.3 Change the existing small-number cases from S3 to S4 with a comment naming 8.1; keep S3 where an exclamation mark, a pressure word or another claim is present.
  - [ ] 5.4 Run the seven test files (one command each), then `npx tsc --noEmit`.
  _Requirements: 1.11, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 10.1, 10.2, 10.3, 10.4_

- [ ] 6. Turkish word forms by stem
  - Uses: `shared/text.ts` (`toElements`, `matchFrom`, `compilePhrases`, `countPhraseElements`), `confirmshaming.ts` and `preselection.ts` (read to see which lists go through a matcher), the data files of design 10, the corpus.
  - Files: edits `lib/detectors/shared/text.ts`, `shared/constants.ts`, the data files named in design 10, `tests/fixtures/real-world-phrases.json`, `tests/detectors/shared/text.test.ts`, `shared/constants.test.ts`, `word-lists.test.ts`, `fake-urgency.test.ts`, `fake-scarcity.test.ts`, `fake-activity.test.ts`, `confirmshaming.test.ts`, `preselection.test.ts`.
  - Reads: requirements 1, 9; design 2, 5 (stem engine), 10.
  - Dependent tests to run: `shared/text.test.ts`, `shared/constants.test.ts`, `word-lists.test.ts`, `real-world-phrases.test.ts`, `fake-urgency.test.ts`, `fake-scarcity.test.ts`, `fake-activity.test.ts`, `confirmshaming.test.ts`, `preselection.test.ts`, `wording.test.ts`, `eval/boo-tique-eval.test.ts`.
  - [ ] 6.1 Tests first in `text.test.ts`: `matchesStem` and `compilePhrases` with stems (positives and negatives of design 10 and requirement 9.3; a stem in an English entry, a stem shorter than 4 characters and a stray `*` are not compiled and `countPhraseElements` gives 0); `constants.test.ts` gains `MAX_STEM_EXTRA_CHARS: 6` and `MIN_STEM_CHARS: 4`. Run them; they fail.
  - [ ] 6.2 Implement the stem element in `text.ts` and the constants. Then change the lists exactly as design 10 says (only the lists named there; exact entries stay where it says so). A list that is not read through a matcher keeps its exact entries.
  - [ ] 6.3 Add the detector cases of requirements 9.6 to 9.8, 9.11 and 9.12, including the false-positive words "paragraf", "iletişim" and "bağışıklık"; add corpus texts for every new stem entry.
  - [ ] 6.4 Run the eleven test files (one command each), then `npx tsc --noEmit`.
  _Requirements: 1.8, 1.11, 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 9.9, 9.10, 9.11, 9.12_

- [ ] 7. Backgrounds behind uncaptured layers
  - Uses: `shared/colour.ts` (`effectiveBackground`, `textContrast`), `visual-interference.ts`, `shared/elements.ts` (`ancestors`, `path`).
  - Files: edits `lib/detectors/shared/colour.ts`, `visual-interference.ts`, `tests/detectors/shared/colour.test.ts`, `visual-interference.test.ts`, `eval/boo-tique-eval.test.ts` (only as 11.7 requires).
  - Reads: requirements 1, 11, 12.3; design 12.
  - Dependent tests to run: `shared/colour.test.ts`, `visual-interference.test.ts`, `wording.test.ts`, `hostile-input.test.ts`, `eval/boo-tique-eval.test.ts`.
  - [ ] 7.1 Tests first: `colour.test.ts` cases for `unseen` (gap between element and opaque ancestor; no opaque ancestor with an uncaptured wrapper; adjacent parent is not unseen; own opaque background is not unseen; null path is not unseen); `visual-interference.test.ts` cases for the dark banner (requirement 11.4), the two-measure pair under a gap (11.5) and a transparent button decline versus a transparent link decline (11.3). Run them; they fail.
  - [ ] 7.2 Implement `unseen` and the null contrast; add the explicit guard in the detector where a measure is computed another way; implement the button rule for "filled versus transparent".
  - [ ] 7.3 Run the five test files. If a Boo-tique entry changes row or becomes a miss, add the entry to `ACCEPTED_MISSES` only if it is a miss, with a comment naming 11.1; if the floor of 16 of 19 then fails, stop and report; tune nothing (requirement 11.7). Then `npx tsc --noEmit`.
  _Requirements: 1.11, 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 11.8, 12.3, 12.4_

- [ ] 8. Hold-out evaluation
  - Uses: `eval/helpers/tree.ts` (`buildSnapshot`, `PageNode`), `eval/helpers/light.ts` (`toLightSample`), `eval/helpers/pages.ts` (`BASE_TIME`, `RELOAD_TIME`), `eval/helpers/no-hooks.ts` (`assertNoTestHooks`), `runAllDetectors`.
  - Files: creates `tests/detectors/eval/helpers/holdout-cases.ts`, `holdout.ts`, `tests/detectors/eval/holdout.test.ts`, `holdout-eval.test.ts`; edits `tests/detectors/wording.test.ts`.
  - Reads: requirements 1, 4; design 13.
  - Dependent tests to run: `eval/holdout.test.ts`, `eval/holdout-eval.test.ts`, `wording.test.ts`.
  - [ ] 8.1 Tests first: `holdout.test.ts` checks the case table (28 flag cases, 20 honest cases, 8 extras; the texts of design 13; unique ids), the scoring with synthetic findings (hit needs pattern and node, false positive by confidence, known misses listed) and `formatHoldoutTable` (names the review baseline). Run it; it fails.
  - [ ] 8.2 Create `holdout-cases.ts`: the 56 cases word for word, completing each ⟦…⟧ element once with plain wording; shapes of design 13; every snapshot checked with `PageSnapshotSchema` and `assertNoTestHooks`. Create `holdout.ts` (`runHoldout`, `scoreHoldout`, `formatHoldoutTable`).
  - [ ] 8.3 Create `holdout-eval.test.ts`: run `runAllDetectors` on every case, print the table with `console.log`, assert only requirement 4.6 (every case ran with `errors: []`, the case counts, recall of the 28 at least 0.5). Add no threshold for false positives. Extend `wording.test.ts` with every hold-out case.
  - [ ] 8.4 Run the three test files (one command each), then `npx tsc --noEmit`. Report the printed table in the final reply; change no case because of it.
  _Requirements: 1.11, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10, 4.11, 5.6, 6.7_

- [ ] 9. Record, steering and amendment notes
  - Uses: the printed output of `eval/boo-tique-eval.test.ts` and `eval/holdout-eval.test.ts`; `.kiro/steering/structure.md`, `tech.md`; the three files of `.kiro/specs/detectors-static/`.
  - Files: edits `.kiro/specs/detectors-static-fixes/design.md` (section 14 table only), `.kiro/steering/structure.md`, `.kiro/steering/tech.md`, `.kiro/specs/detectors-static/requirements.md`, `design.md`, `tasks.md` (append only); edits `tests/detectors/eval/score.test.ts` or `boo-tique-eval.test.ts` only if an expectation is stale.
  - Reads: requirements 12; design 14.
  - Dependent tests to run: `eval/boo-tique-eval.test.ts`, `eval/holdout-eval.test.ts`, `eval/score.test.ts`.
  - [ ] 9.1 Run `eval/boo-tique-eval.test.ts` and `eval/holdout-eval.test.ts`; copy both printed figures into the table of design section 14 with the date, whatever they are. Write in the final reply which Boo-tique entries changed row or confidence since the head of the branch and the requirement behind each (requirement 12.9). Tune nothing.
  - [ ] 9.2 Update `.kiro/steering/structure.md` (directory listing: `tests/fixtures/real-world-phrases.json`, `wording.test.ts`, `detector-errors.test.ts`, `real-world-phrases.test.ts`, `eval/holdout*.ts`, `helpers/real-world-phrases.ts`, `helpers/row-snapshots.ts`) and `.kiro/steering/tech.md` ("Detectors" section: the generality rule, the corpus, no `catch` in detectors with errors reported by `runDetectors`, the stem rule, the Boo-tique eval as a regression test and the hold-out as the generalisation figure). Change nothing else.
  - [ ] 9.3 Append to the end of each old file a section "Amendments (detectors-static-fixes)" with one line per item of design 14 (criteria 2.7, 2.13, 3.12, 3.13, 3.18, 7.14, 8.4, 8.18, 9.3, 9.4, 10.2, 13.6, 13.7, 14.8 replaced, new 14.10, 17.6, new 17.19; design 7, 9.1, 9.2, 9.3, 9.6, 12, 14; task 12.3), each saying what changed and pointing to the requirement of this spec. The 14.8 line quotes the new rule of requirement 3.1. Change no other line of the old files.
  - [ ] 9.4 Run the three test files (one command each), `npx tsc --noEmit`, then `npm run lint` once; fix lint findings only in files this spec created or edited, and report the result.
  _Requirements: 4.5, 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7, 12.8, 12.9, 12.10, 12.11_
