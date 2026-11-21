# Tasks: Model Judge

Rules for every task:

- Each top-level task runs in its own run; earlier tasks are done. Read only the requirement and design sections the task names, the files on its "Uses" and "Files" lines, and the note sections it names by number. Requirement 1 applies to every task.
- Allowed commands: `npx vitest run <one test file> --maxWorkers=2` (one file per command, only files the task touches or names), `npx tsc --noEmit`, `npm run lint` in task 14 only, and `npm install --save-exact @anthropic-ai/sdk` in task 13 only. Nothing else: no full suite, build, dev server, browser, watch mode, network, command chaining or redirection. Use the file tools for file work. Kiro makes no commit.
- Write the test first, then the code. A test that imports a `server-only` module starts with `vi.mock("server-only", () => ({}))`. No unit test makes a network call or imports `lib/judge/haiku.ts` or `@anthropic-ai/sdk`; unit tests use the mock. Never run `tests/judge/live/judge-live.test.ts` or any model API.
- Modules under `lib/judge/` are pure where design §7 says so: no clock except `deps.now`, no randomness, no module-level mutable state except `defaultCooldown`. Network and SDK code lives only in `haiku.ts`.
- The word made of "test" followed directly by "id" never appears, in any letter case, in any file under `lib/judge` or `tests/judge`, comments included; comments say "test hook attributes". The judge reads no test hook attribute and no `data-*` attribute.
- Every finding title starts with "Possible". The words illegal, scam, fraud and their relatives appear in no text the judge produces; only the wording test's forbidden-word data may hold them. No key, header, page text, quote, prompt, data block, URL or raw model output in any log, error or result field other than the verified quote in a finding.
- Change no file outside `lib/judge/`, `tests/judge/` and the files a task names. Never touch `package.json` or the lockfile except in task 13. Never touch `lib/capture/`, `tests/capture/`, `lib/detectors/`, `tests/detectors/`, `lib/types`, `lib/boo-tique`, `components/`, `app/`, `vitest.config.ts`, `tests/fixtures/judge-eval/`, `docs/research/`, `.kiro/agents`, `.kiro/hooks`, `.kiro/settings`, `.github`, `.githooks`, `scripts/`, `SECURITY.md` or `.gitleaks.toml`. Read or write no `.env` file. Never write the package names of the DOM test library or of the JPEG decoder under `lib/` (`tests/capture/dependencies.test.ts` scans for them).
- No sealed split: no path, case or figure, except the variable `JUDGE_EVAL_SEALED_PATH`, read only by the live test. Nothing is tuned to a sealed figure.
- Never weaken a test: no deleted case, loosened expectation or new exemption. If a test and the spec contradict each other, stop and say so in the final reply.
- At the end of the task, the touched tests pass, the named existing tests still pass, and `npx tsc --noEmit` is clean.

- [x] 1. Types, schemas, the output JSON Schema and constants
  Uses: `lib/types/index.ts`, `lib/detectors/shared/finding.ts` (read-only). Read: requirements 1, 2, 3; design §7, §8, §9, §13 (first paragraph); note 1.5, 3.2.
  Files: `lib/judge/types.ts`, `lib/judge/schema.ts`, `lib/judge/constants.ts`, `tests/judge/schema.test.ts`, `tests/judge/constants.test.ts`.
  - [x] 1.1 Create `tests/judge/schema.test.ts` first: the 39 reason codes in their families; `FLAG_CODES_BY_PATTERN` covers the six patterns; the 9 statuses; `ReviewResultSchema` accepts a valid result and rejects a bad `source`, a title without "Possible" and a missing `judge` field; `JudgeOutputSchema` accepts a valid answer and rejects extra keys and wrong enum values; every enum of the JSON Schema equals the zod enum (candidate ids, rule ids, patterns, confidences, decisions, finding reasons, verdict reasons); a walk finds `additionalProperties: false` and a full `required` on every object; the constant is deep-frozen.
  - [x] 1.2 Create `tests/judge/constants.test.ts` first: every value of design §9; the cost ceiling of requirement 3.4 is at most `MAX_COST_PER_SCAN_USD`; `estimateCostUsd` on a fixed usage.
  - [x] 1.3 Create `types.ts`, `schema.ts` and `constants.ts`.
  - [x] 1.4 Run both test files, then `npx tsc --noEmit`.
  _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 3.1, 3.2, 3.3, 3.4, 3.5_

- [x] 2. Redaction
  Uses: `lib/judge/constants.ts`. Read: requirement 4; design §10; note 2.4.
  Files: `lib/judge/redact.ts`, `tests/judge/redact.test.ts`.
  - [x] 2.1 Create `tests/judge/redact.test.ts` first: one case per rule of 4.1 to 4.5, including "0532 123 45 67", a card number with spaces, an 11-digit number and an IBAN; the order of 4.6; prices ("2.450,00 TL", "$24.99"), "Only 3 left", "12:45" and "Priya from Cardiff" kept; `isMostlyRedacted` above and below one half; the seeded property test of design §10.
  - [x] 2.2 Create `redact.ts`.
  - [x] 2.3 Run the test file, then `npx tsc --noEmit`.
  _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9_

- [x] 3. Candidate builder I: eligibility, normalisation and structure
  Uses: `lib/judge/redact.ts`, `lib/judge/constants.ts`, `lib/detectors/shared/colour.ts`, `lib/detectors/shared/elements.ts` (`buildIndex`, read-only), `lib/types/index.ts`. Read: requirements 4.7, 5, 6; design §2, §3 (control, labels, groups rows), §11 up to "Facts"; note 2.1 steps 1 to 4.
  Files: `lib/judge/candidates.ts` (`normaliseCandidateText`, `prepareCandidates`), `tests/judge/candidates.test.ts`, `tests/judge/helpers/snapshot.ts`.
  - [x] 3.1 Create `tests/judge/helpers/snapshot.ts` (small builders of elements and snapshots that pass `PageSnapshotSchema`, with no test hook attribute).
  - [x] 3.2 Create `tests/judge/candidates.test.ts` first: only the first sample is read; each visibility rule and the zero-box rule for controls and non-controls; the eligibility rule; `outsideImage` kept; NFKC, each removed character range, whitespace collapse, the 200-character cut with `cut: true` on a surrogate pair; a mostly redacted candidate dropped; a dialog container at 80 % coverage skipped and at 79 % sent, still giving place and group; a `role="status"` toast sent; wrapping and next-sibling labels merged (input id first, label not sent again); radios grouped by `name`, the value absent from the output; buttons and links grouped within 3 levels and not at 4; `g1`, `g2` in document order; place dialog, toast (role, and fixed with 160 and 161 characters), main; facts rounded, `contrast` omitted on an assumed background, `areaRatio` against the largest member.
  - [x] 3.3 Create `candidates.ts` with `normaliseCandidateText` and `prepareCandidates`.
  - [x] 3.4 Run the test file, then `npx tsc --noEmit`.
  _Requirements: 4.7, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9, 6.10, 6.11, 6.12, 6.13_

- [x] 4. Candidate builder II: split text, rule links, ranking, caps and ids
  Uses: `lib/judge/candidates.ts`, `lib/judge/constants.ts`, `lib/detectors/shared/finding.ts` (`TITLES`), `tests/judge/helpers/snapshot.ts`, `tests/fixtures/judge-eval/dev.json` and its `README.md` (read-only). Read: requirements 7, 4.10, 16.1, 16.2; design §3 (connector, parts, byte bound, harness defaults rows), §11, §12 (`encodePageData` only), §18 (`build-case.ts`); note 2.1 steps 4 to 6, 2.2.
  Files: `lib/judge/candidates.ts` (`ruleKind`, `buildCandidates`), `lib/judge/prompt.ts` (`encodePageData` only), `tests/judge/candidates-rank.test.ts`, `tests/judge/prompt.test.ts`, `tests/judge/eval/build-case.ts`, `tests/judge/eval/build-case.test.ts`.
  - [x] 4.1 Create `tests/judge/prompt.test.ts` with the encoding cases first: the escapes of design §12, the result parses back to the input.
  - [x] 4.2 Create `tests/judge/candidates-rank.test.ts` first: each fragment trigger; parts from the listed tags only, cut at 24, ordered by box, at most 8, parent text unchanged, ids parent then parts, a part child not sent again; `ruleKind` of every title in `TITLES` (5 `reload`) and `null` for an unknown title; `r1` to `r20` in document order, the 21st not sent; a rule finding with no mapped candidate not sent; `rules` links; each score of the ranking table and the tie rule; rule-covered candidates kept; caps of 60 candidates, 10,000 characters and `MAX_DATA_BLOCK_BYTES` (with text of `<` only); `c1` to `cN` in document order; `truncated`; the data holds no URL, host, attribute value, colour, box or capture field.
  - [x] 4.3 Create `tests/judge/eval/build-case.test.ts` first: the sha256 of `dev.json` equals design §2; the README defaults on a sample case; every built snapshot passes `PageSnapshotSchema`; `buildCandidates` on every dev case gives at most 60 candidates within both caps and no exception; the number of flag cases whose evidence element maps to no candidate is printed, not asserted.
  - [x] 4.4 Create `tests/judge/eval/build-case.ts`, `encodePageData` in `prompt.ts`, and `ruleKind` and `buildCandidates` in `candidates.ts`.
  - [x] 4.5 Run the three test files and `tests/judge/candidates.test.ts`, then `npx tsc --noEmit`.
  _Requirements: 4.10, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 7.9, 7.10, 7.11, 7.12, 7.13, 7.14, 16.1, 16.2_

- [x] 5. Prompt, data block and request body
  Uses: `lib/judge/prompt.ts`, `lib/judge/candidates.ts`, `lib/judge/schema.ts`, `lib/judge/constants.ts`, `lib/detectors/shared/finding.ts` (`containsForbidden`), `tests/judge/eval/build-case.ts`. Read: requirement 8; design §12; note 3.1, 6.4, 4.1 (settings table), attacks A2 and A6 of 3.4.
  Files: `lib/judge/prompt.ts`, `tests/judge/prompt.test.ts`.
  - [x] 5.1 Extend `tests/judge/prompt.test.ts` first: the prompt holds the parts of 8.1 to 8.3 (checked by stable phrases and every reason code); no dev element text over 12 characters occurs in it; `containsForbidden` is false for it; the user message has one block and the reminder line; with `</page_data>`, `<page_data>`, "[INST]", "### New rules" and `<|im_start|>system` in page text the closing tag occurs once; `scanDate` present and omitted for an unreadable `capturedAt`; rule findings carry no description or quote; the body settings of 8.9 and the absent keys; the body stays under `MAX_REQUEST_BODY_BYTES` for the four pages of 8.10.
  - [x] 5.2 Add `JUDGE_SYSTEM_PROMPT`, `buildUserMessage`, `buildJudgeRequest` and `buildRequestBody` to `prompt.ts`.
  - [x] 5.3 Run the test file, then `npx tsc --noEmit`.
  _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.9, 8.10_

- [x] 6. Output validation
  Uses: `lib/judge/schema.ts`, `lib/judge/types.ts`, `lib/judge/candidates.ts` (the map), `lib/judge/constants.ts`, `tests/judge/helpers/snapshot.ts`. Read: requirement 9; design §3 (anomalous and "8 kept" rows), §13; note 3.2, 3.3.
  Files: `lib/judge/validate.ts`, `tests/judge/validate.test.ts`.
  - [x] 6.1 Create `tests/judge/validate.test.ts` first, on fake responses over a built map: invalid JSON, truncated JSON with `max_tokens`, empty text, extra key and wrong enum each give `invalid`; unknown candidate and rule ids dropped; quote substring of text and of a part kept, NFC and spacing differences accepted, a URL or markup quote dropped, quotes of 2 and 121 characters dropped; structural checks for preselection and visual interference; a flag code of another pattern dropped; verdict families of design §13; repeated rule id, first wins; 20 verdicts at most; 8 kept by the order of design §13; each anomaly code with its threshold (12 and 13 findings, 5 and 6 flagged).
  - [x] 6.2 Create `validate.ts`.
  - [x] 6.3 Run the test file, then `npx tsc --noEmit`.
  _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 9.9, 9.10, 9.11, 9.12_

- [x] 7. Templates, status lines and the wording test
  Uses: `lib/judge/types.ts`, `lib/detectors/shared/text.ts` (`quote`), `lib/detectors/shared/finding.ts` (`containsForbidden`, `EXPLANATIONS`), `lib/detectors/data/forbidden-words.ts` (read-only), `lib/judge/prompt.ts`. Read: requirement 10; design §14; note 1.6, 6.
  Files: `lib/judge/templates.ts`, `lib/judge/summary.ts`, `tests/judge/wording.test.ts`, `tests/judge/summary.test.ts`.
  - [x] 7.1 Create `tests/judge/wording.test.ts` first: every title starts with "Possible"; one sentence per reason code; `containsForbidden` is false for every title, sentence, description built with a neutral quote, status sentence, reason template, the set-aside heading and the system prompt; a description built from a quote holding a forbidden word holds the mask, not the word.
  - [x] 7.2 Create `tests/judge/summary.test.ts` first: each row of the status table; the enumeration of 10.15 over 9 statuses × 2 list states × 2 error states, with no "nothing found" in any letter case; the disclaimer last in every line.
  - [x] 7.3 Create `templates.ts` and `summary.ts`.
  - [x] 7.4 Run both test files, then `npx tsc --noEmit`.
  _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.8, 10.9, 10.10, 10.11, 10.12, 10.13, 10.14, 10.15, 10.16_

- [x] 8. Merge
  Uses: `lib/judge/candidates.ts`, `lib/judge/validate.ts`, `lib/judge/templates.ts`, `lib/judge/types.ts`, `lib/detectors/shared/finding.ts` (`lowerConfidence`, `detectedAtFrom`, `containsForbidden`), `lib/types/index.ts`, `tests/judge/helpers/snapshot.ts`. Read: requirements 10.7, 11; design §3 (reject, half, anomalous, duplicate rows), §15; note 1.1 to 1.4.
  Files: `lib/judge/merge.ts`, `tests/judge/merge.test.ts`.
  - [x] 8.1 Create `tests/judge/merge.test.ts` first: the power table row by row for each kind and level; reject without high is a downgrade; reject on `reload` and `measured` ignored; 3 and 4 applicable rejects, floor(n / 2) with n of 1, 2 and 7, too many rejects ignore all and add `too-many-rejects`; set-aside findings unchanged with their reason; judge-only high and medium become low, low dropped; confirm keeps level; `ruleConfidence`, `judgeReason` and `source`; duplicate by same id, ancestor and descendant id (and `el-0-1` against `el-0-12` not a duplicate); explicit verdict wins over a duplicate; collapse of same pattern and candidate; different patterns kept apart; ordering; assembled findings pass `FindingSchema` with `detectorName: "judge"`; a quote holding a forbidden word gives a finding with the mask and no forbidden word; `assembleJudgeFinding` given a test template that holds a forbidden word returns nothing; an anomalous input ignores every verdict; the seeded by-construction test of design §15.
  - [x] 8.2 Create `merge.ts`.
  - [x] 8.3 Run the test file, then `npx tsc --noEmit`.
  _Requirements: 10.7, 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 11.8, 11.9, 11.10, 11.11, 11.12, 11.13, 11.14, 11.15, 11.16, 11.17, 11.18, 11.19, 11.20_

- [x] 9. Seam, mock and configuration
  Uses: `lib/judge/constants.ts`, `lib/judge/prompt.ts`. Read: requirement 12; design §3 (environment, error mapping rows), §16 (without the real client); note 4.4, 4.5.
  Files: `lib/judge/interface.ts`, `lib/judge/mock.ts`, `lib/judge/config.ts`, `tests/judge/interface.test.ts`, `tests/judge/mock.test.ts`, `tests/judge/config.test.ts`.
  - [x] 9.1 Create the three test files first: `toJudgeHttpError` for each retryable status, 400 to 404, a connection error, an existing `JudgeHttpError` and a non-error value; the mock's canned, error, hang (settles on abort), function and sequence scripts, recorded requests, and `readPageData` round trip; `readJudgeConfig` for unset, empty, unknown, `gateway` and `anthropic` with and without keys, empty and space-only keys, and no key value in any returned string.
  - [x] 9.2 Create `interface.ts`, `mock.ts` and `config.ts` (`import "server-only"` first in `config.ts`).
  - [x] 9.3 Run the three test files, then `npx tsc --noEmit`.
  _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7, 12.8_

- [ ] 10. Orchestrator and the log record
  Uses: every module of tasks 1 to 9, `lib/detectors/index.ts` (types), `tests/judge/helpers/snapshot.ts`. Read: requirements 13, 14; design §3 (timeout, timers, URL hash, missing-key rows), §17; note 4.3, 5.
  Files: `lib/judge/review.ts`, `tests/judge/review.test.ts`, `tests/judge/review-log.test.ts`.
  - [ ] 10.1 Create `tests/judge/review.test.ts` first, with a manual clock and timer: `off` and absent client make no call; cooldown; 2,999 and 3,000 ms left; first timeout values near the deadline; first-attempt timeout aborts and does not retry; each retryable status retries once with the second timeout; 4,999 ms left does not retry; 400 to 404 do not retry; 402 gives `skipped-over-budget` and starts the cooldown, and a second scan within 10 minutes gives `skipped-cooldown` while one after it calls again; a timed-out retry gives `timeout`; a throwing builder or merge gives `error`; every non-`ran` status returns the rule findings unchanged and an empty `setAside`; `ruleErrors`, `candidateCount` and `truncated`; at most two calls; the result passes `ReviewResultSchema`; `reviewFindings` never rejects.
  - [ ] 10.2 Create `tests/judge/review-log.test.ts` first: exactly one record per scan for every status; the field set of design §17; `offReason: "missing-key"`; sentinel page text, quote, URL, key, header and raw response absent from the serialised record and from any error.
  - [ ] 10.3 Create `review.ts` with `reviewFindings`, `createCooldown` and `defaultCooldown`.
  - [ ] 10.4 Run both test files, then `npx tsc --noEmit`.
  _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.7, 13.8, 13.9, 13.10, 13.11, 13.12, 13.13, 13.14, 13.15, 13.16, 13.17, 14.1, 14.2, 14.3, 14.4_

- [ ] 11. Code-layer attack suite
  Uses: `lib/judge/review.ts`, `lib/judge/mock.ts`, `tests/judge/helpers/snapshot.ts`. Read: requirement 17; design §19; note 3.4.
  Files: `tests/judge/injection.test.ts`; a fix in a `lib/judge/` module only if a case finds a defect (named in the final reply).
  - [ ] 11.1 Create `tests/judge/injection.test.ts` first: one `describe` per attack A1 to A11 through `reviewFindings` and the mock, with the hostile page text and the hostile model output, asserting 17.1 to 17.11.
  - [ ] 11.2 Run the test file and any test file of a module it made you fix, then `npx tsc --noEmit`.
  _Requirements: 17.1, 17.2, 17.3, 17.4, 17.5, 17.6, 17.7, 17.8, 17.9, 17.10, 17.11_

- [ ] 12. Evaluation harness and the rules-only regression
  Uses: `tests/judge/eval/build-case.ts`, `lib/judge/review.ts`, `lib/judge/mock.ts`, `lib/detectors/all.ts` (`runAllDetectors`), `tests/fixtures/judge-eval/README.md`, `dev.json`, `judge-eval-dev-baseline.json` (read-only). Read: requirement 16; design §3 (outcome strings, judge-only rows), §18; note 7.2 to 7.4.
  Files: `tests/judge/eval/score.ts`, `tests/judge/eval/fake-judges.ts`, `tests/judge/eval/score.test.ts`, `tests/judge/eval/dev-eval.test.ts`, `tests/judge/eval/replay.test.ts`.
  - [ ] 12.1 Create `tests/judge/eval/score.test.ts` first: hit on the evidence id and on a related id, misplaced hit as a miss, false positive at low and at medium, tolerated low, off-pattern reported, `setAside` ignored, per-language and per-pattern totals, outcome strings.
  - [ ] 12.2 Create `tests/judge/eval/dev-eval.test.ts` first: rules-only over dev, table printed, 18/60 hits, 3/60 and 3/60 false positives, 1 tolerated low, every per-case outcome, off-pattern list and detector error count equal to the baseline file, with a failure message naming each differing case; both fake judges through the mock, tables printed, every case scored, medium-or-high false positives not above rules-only.
  - [ ] 12.3 Create `tests/judge/eval/replay.test.ts`, skipped while `tests/fixtures/judge-dev-responses.json` does not exist.
  - [ ] 12.4 Create `score.ts` and `fake-judges.ts`.
  - [ ] 12.5 Run the three test files, then `npx tsc --noEmit`. If the rules-only figures differ from the baseline, do not change the expectation: stop and report the cases.
  _Requirements: 16.3, 16.4, 16.5, 16.6, 16.7, 16.8, 16.9, 16.10, 16.11, 16.12, 16.13, 16.14, 16.15_

- [ ] 13. Real client, the SDK dependency and the source rules
  Uses: `lib/judge/interface.ts`, `lib/judge/prompt.ts`, `lib/judge/config.ts`, `lib/judge/constants.ts`, `package.json`, `tests/capture/dependencies.test.ts` (read, and edited only if D1 grants it). Read: requirement 15, 1.3, 1.4, 1.16; design §4 item 11, §5, §16, §22; note 4.1, 4.2, 4.5.
  Files: `lib/judge/haiku.ts`, `tests/judge/source-rules.test.ts`, `package.json` and the lockfile (the install only).
  - [ ] 13.1 Check D1 in design §5. Start only if the driver has already updated `tests/capture/dependencies.test.ts` or D1 records that this task may make exactly the proposed edit; otherwise stop and report.
  - [ ] 13.2 Create `tests/judge/source-rules.test.ts` first: `@anthropic-ai/sdk` imported only in `lib/judge/haiku.ts`; `haiku.ts` imported by no file under `tests/` except `tests/judge/live/judge-live.test.ts`; `haiku.ts` starts with `import "server-only"`, uses `await import("@anthropic-ai/sdk")`, `maxRetries: 0`, `buildRequestBody` and `toJudgeHttpError`, and has no `temperature`; the test hook word (built from parts) in no file under `lib/judge` or `tests/judge`; no `Date.now` or `Math.random` and no module-level `let` under `lib/judge`; the package is pinned exactly in `dependencies`.
  - [ ] 13.3 Run `npm install --save-exact @anthropic-ai/sdk` once. If it is denied or fails, stop and report. Check that `package.json` changed only by that one entry.
  - [ ] 13.4 Create `haiku.ts` by design §16; if D1 lets this task do it, make the D1 edit in `tests/capture/dependencies.test.ts`.
  - [ ] 13.5 Run `source-rules.test.ts` and `tests/capture/dependencies.test.ts`, then `npx tsc --noEmit`.
  _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.6, 15.7, 15.8, 15.9, 1.3, 1.4, 1.16_

- [ ] 14. Opt-in live test, attack fixtures, steering, `.env.example` and lint
  Uses: `lib/judge/haiku.ts`, `lib/judge/config.ts`, `lib/judge/review.ts`, `tests/judge/eval/*`, `tests/detectors/eval/helpers/pages.ts` and `score.ts` (read-only), `.kiro/steering/tech.md`, `.kiro/steering/structure.md`, `.env.example`, `tests/capture/lib-text-rules.test.ts` and `tests/capture/config.test.ts` (read-only). Read: requirements 18, 19; design §20, §21; note 7.5, 7.6.
  Files: `tests/judge/live/judge-live.test.ts`, `tests/judge/live/attacks.json`, `.kiro/steering/tech.md`, `.kiro/steering/structure.md`, `.env.example`.
  - [ ] 14.1 Write `tests/judge/live/attacks.json` (about 12 fixtures with clean twins, original wording, no eval case text) and `judge-live.test.ts` by design §20. Do not run it.
  - [ ] 14.2 Edit `tech.md` (the "LLM judge" section; the Gemini fallback removed), `structure.md` (the judge trees) and `.env.example` (design §21). Write no test hook word in either steering file.
  - [ ] 14.3 Run `tests/capture/lib-text-rules.test.ts`, `tests/capture/config.test.ts` and `tests/judge/source-rules.test.ts`, then `npx tsc --noEmit`, then `npm run lint`.
  _Requirements: 18.1, 18.2, 18.3, 18.4, 18.5, 18.6, 18.7, 18.8, 19.1, 19.2, 19.3, 19.4, 19.5_
