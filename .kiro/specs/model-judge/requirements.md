# Requirements: Model Judge

This spec turns the design note `docs/research/model-judge-design.md` (written by an independent Claude agent, not by Kiro) into requirements. "Note n.m" means section n.m of that note. The note holds the decisions; this spec implements them and does not re-decide them. "The system" means the code under `lib/judge/` and the tests under `tests/judge/`. Named constants and fixed strings are defined in `design.md`; "design §n" means its section n.

The judge is one language model, Claude Haiku 5.5, reached with `@anthropic-ai/sdk` through the Vercel AI Gateway (or directly). It reviews a bounded list of page elements after the rules have run, adds low-confidence findings the rules missed, and confirms, lowers or sets aside text-based rule findings. Rules keep every measured and reload signal. Any failure gives the rules-only result with a visible "the reviewer did not run" status.

## Out of scope

- The scan route and the UI. The judge exposes `ReviewResult` and `statusLine`; nothing renders them in this spec.
- Any change to `lib/capture/` or `tests/capture/`. Split text in the capture stays issue #3.
- Any change to `lib/detectors/**` or `tests/detectors/**`. The judge imports `quote`, `containsForbidden`, `lowerConfidence`, `EXPLANATIONS`, `TITLES`, the colour helpers and `buildIndex` read-only (design §5 lists one case that needs an owner decision).
- Any change to `lib/types`. `FindingSchema` and the other schemas stay; the judge defines its own wrapper types.
- Word-list additions (the generality rule; issue #17 item 6 is a separate spec).
- A persistent judge-call counter (no store exists yet).
- Settling the 25 s against 45 s scan-budget conflict (note 4.3). The judge takes an absolute deadline.
- Gateway budgets, API keys and prepaid credits (owner setup, design §6).
- Running the live test or any model call, and any sealed-split figure as a target.
- A fallback model or a second provider.

## 1. Standing rules

**User story:** As the owner, I want every task of this spec to keep the project's guardrails, so that the judge cannot leak data, weaken tests or change the rules.

**Acceptance criteria:**

1.1. WHEN a module under `lib/judge/` other than `haiku.ts` runs THE SYSTEM SHALL read no clock except `deps.now`, use no randomness and keep no module-level mutable state except the default cooldown of 13.16.
1.2. WHEN the judge reads an element THE SYSTEM SHALL read no test hook attribute and no `data-*` attribute; of the attributes it reads only `type`, `name` and `disabled`.
1.3. WHEN any file under `lib/detectors`, `lib/capture` or `lib/judge` is scanned, comments included, THE SYSTEM SHALL find no occurrence of the word made of "test" followed directly by "id", in any letter case; comments say "test hook attributes".
1.4. WHEN any file under `tests/judge` is scanned THE SYSTEM SHALL find no occurrence of that word in any letter case; a test that looks for it builds it from parts.
1.5. WHEN the judge produces a finding THE SYSTEM SHALL start its title with "Possible".
1.6. WHEN the judge produces any text THE SYSTEM SHALL include none of the words illegal, scam or fraud or their relatives (the forbidden-word data used by the wording test is the only exception).
1.7. WHEN the judge logs, throws or returns THE SYSTEM SHALL include no API key, header, page text, quote, prompt, data block, URL or raw model output.
1.8. WHEN a unit test runs THE SYSTEM SHALL make no network call and import neither `lib/judge/haiku.ts` nor `@anthropic-ai/sdk`; unit tests use the mock of 12.3.
1.9. WHEN a task of this spec runs THE SYSTEM SHALL run no model API, no live test, no dev server and no browser.
1.10. WHEN a task runs THE SYSTEM SHALL add no dependency except `@anthropic-ai/sdk` in the task named for it, and SHALL change none of `package.json` and the lockfile in any other task.
1.11. WHEN a task runs THE SYSTEM SHALL change none of `lib/capture/`, `tests/capture/`, `lib/detectors/`, `tests/detectors/`, `lib/types`, `lib/boo-tique`, `components/`, `app/`, `vitest.config.ts`, `tests/fixtures/judge-eval/`, `docs/research/`, `.kiro/agents`, `.kiro/hooks`, `.kiro/settings`, `.github`, `.githooks`, `scripts/`, `SECURITY.md` or `.gitleaks.toml`, and read or write no `.env` file.
1.12. WHEN a task runs shell commands THE SYSTEM SHALL use only `npx vitest run <one test file> --maxWorkers=2` (one file per command, only files the task touches or names), `npx tsc --noEmit`, `npm run lint` in the last task and `npm install --save-exact @anthropic-ai/sdk` in the dependency task; Kiro makes no commit.
1.13. WHEN a test fails THE SYSTEM SHALL NOT delete a case, loosen an expectation or add an exemption; WHEN a test and this spec contradict each other the task SHALL stop and report it.
1.14. WHEN a task ends THE SYSTEM SHALL have its tests written before its code, its touched tests passing, the existing suite unaffected and `npx tsc --noEmit` clean.
1.15. WHEN any file of this feature names a sealed split THE SYSTEM SHALL do so only through `JUDGE_EVAL_SEALED_PATH`, read only by the live test and never committed with a value; no test asserts a sealed-split number and nothing is tuned to one.
1.16. WHEN code under `lib/judge/` touches the network or the SDK THE SYSTEM SHALL keep that code in `lib/judge/haiku.ts` only; every other module runs without a key.

## 2. Types, schemas and the output JSON Schema

**User story:** As the scan route author, I want typed, validated results, so that a stored result always has the same shape (note 1.5, 3.2).

**Acceptance criteria:**

2.1. WHEN `ReasonCode` is read THE SYSTEM SHALL hold exactly the codes of design §8, each in one family (flag codes per pattern, look-alike codes, `insufficient-context`).
2.2. WHEN `JudgeStatus` is read THE SYSTEM SHALL hold exactly `ran`, `ran-anomalous`, `off`, `skipped-no-time`, `skipped-over-budget`, `skipped-cooldown`, `timeout`, `error` and `invalid-output`.
2.3. WHEN a `ReviewedFinding` is built THE SYSTEM SHALL hold a `finding` that passes `FindingSchema`, a `source` of `rules`, `judge` or `rules+judge`, `ruleConfidence` only when the level changed, and `judgeReason` only when the judge gave one.
2.4. WHEN a `SetAsideFinding` is built THE SYSTEM SHALL hold the unchanged rule `finding` and its `judgeReason`.
2.5. WHEN `reviewFindings` returns THE SYSTEM SHALL return a value that passes `ReviewResultSchema`: `findings`, `setAside`, `judge` (`status`, `candidateCount`, `truncated`) and `ruleErrors`.
2.6. WHEN the model output is parsed THE SYSTEM SHALL accept only an object with `findings` and `verdicts`, finding items with exactly `candidate`, `pattern`, `quote`, `confidence` and `reason`, and verdict items with exactly `rule`, `decision`, `confidence` and `reason`; any extra key fails.
2.7. WHEN the JSON Schema constant is read THE SYSTEM SHALL find a hand-written object with `additionalProperties: false` and a full `required` list on every object, deep-frozen, identical on every call.
2.8. WHEN the agreement test runs THE SYSTEM SHALL find that the JSON Schema and the zod schema hold the same values in every enum: candidate ids `c1` to `c60`, rule ids `r1` to `r20`, the six pattern ids, the three confidences, the three decisions, the flag codes for findings and all codes for verdicts.

## 3. Constants and the spend ceiling

**User story:** As the owner, I want every limit in one place and a test that bounds the cost of one scan (note 2.3, 4.1, 5).

**Acceptance criteria:**

3.1. WHEN `lib/judge/constants.ts` is read THE SYSTEM SHALL export every constant of design §9 with its value, and `tests/judge/constants.test.ts` SHALL pin each value.
3.2. WHEN the model is named THE SYSTEM SHALL use the constants `JUDGE_MODEL_DIRECT` (`claude-haiku-5-5`) and `JUDGE_MODEL_GATEWAY` (`anthropic/claude-haiku-5.5`), not an environment variable.
3.3. WHEN the prompt is versioned THE SYSTEM SHALL export `JUDGE_PROMPT_VERSION` as a non-empty string.
3.4. WHEN the cost-ceiling test runs THE SYSTEM SHALL compute two attempts of `INPUT_TOKEN_CEILING` input tokens priced at the higher of the input and cache-write prices plus `MAX_OUTPUT_TOKENS` output tokens, and find the total at most `MAX_COST_PER_SCAN_USD` ($0.003).
3.5. WHEN `estimateCostUsd(usage)` is called THE SYSTEM SHALL price input, output, cache-read and cache-write tokens with the four price constants.

## 4. Redaction

**User story:** As a shopper whose details appear on a page, I want personal data removed before page text leaves the server (note 2.4).

**Acceptance criteria:**

4.1. WHEN candidate text holds an email address THE SYSTEM SHALL replace it with `[email]`.
4.2. WHEN candidate text holds `://`, `www.` or a dotted host followed by `/`, `?` or `#` THE SYSTEM SHALL replace that URL with `[link]`.
4.3. WHEN candidate text holds a run of 9 or more digits, with spaces, dots or dashes allowed between them, THE SYSTEM SHALL replace it with `[number]` (Turkish phones such as "0532 123 45 67", spaced card numbers, an 11-digit TC Kimlik).
4.4. WHEN candidate text holds an IBAN-shaped string THE SYSTEM SHALL replace it with `[number]`.
4.5. WHEN candidate text holds an `@handle` token THE SYSTEM SHALL replace it with `[handle]`.
4.6. WHEN redaction runs THE SYSTEM SHALL apply 4.1 to 4.5 in that order, before ranking.
4.7. WHEN more than half of a candidate's characters are placeholders after redaction THE SYSTEM SHALL drop the candidate.
4.8. WHEN candidate text holds a price, a short count, a clock time or a name THE SYSTEM SHALL keep it.
4.9. WHEN the property test runs over random strings THE SYSTEM SHALL find no sent text that holds `://`, `@` followed by a domain, or 9 or more consecutive digits.
4.10. WHEN a data block is built THE SYSTEM SHALL include no snapshot URL or host name, no attribute value, no box, colour or style string, no `screenshotRef` and no capture metadata.

## 5. Candidate eligibility and normalisation

**User story:** As the owner, I want the model to see only visible, meaningful text in a clean form (note 2.1 steps 1 and 2).

**Acceptance criteria:**

5.1. WHEN candidates are built THE SYSTEM SHALL read `snapshot.elements` only and ignore `afterReload` and `secondSample`.
5.2. WHEN an element has `visibility: hidden`, `display: none`, opacity 0, or a zero-size box while not a control THE SYSTEM SHALL not make it a candidate.
5.3. WHEN a visible element has trimmed text of at least 2 characters, is an `input` of type `checkbox` or `radio`, or is a selected `option` THE SYSTEM SHALL make it eligible.
5.4. WHEN an eligible element has `outsideImage: true` THE SYSTEM SHALL keep it eligible.
5.5. WHEN text is normalised THE SYSTEM SHALL apply NFKC, remove the characters U+0000–U+001F, U+007F–U+009F, U+200B–U+200F, U+202A–U+202E, U+2060–U+2069 and U+FEFF, and collapse whitespace.
5.6. WHEN normalised text is longer than 200 characters THE SYSTEM SHALL cut it at a character boundary and mark the candidate `cut: true`.

## 6. Candidate structure

**User story:** As the owner, I want findings to land on the leaf control and the model to see the layout facts the rules use (note 2.1 step 4).

**Acceptance criteria:**

6.1. WHEN an element with a `role` has captured descendants (by id path) whose texts cover at least 80 % of its text characters THE SYSTEM SHALL not send it as a candidate.
6.2. WHEN such a container is skipped THE SYSTEM SHALL still use it for the `place` and `group` of its descendants.
6.3. WHEN an element with a `role` has no captured descendants THE SYSTEM SHALL treat it as any other element.
6.4. WHEN a checkbox or radio input has a wrapping `label` ancestor, or else a next sibling `label`, THE SYSTEM SHALL build one candidate from the input's state and the label's text, mapped to the input id first and the label id second, and SHALL not send the label again.
6.5. WHEN radios share a `name` value THE SYSTEM SHALL put them in one group and SHALL never send the `name` value.
6.6. WHEN buttons or links share a container ancestor within 3 levels of id path THE SYSTEM SHALL put them in one group.
6.7. WHEN groups are numbered THE SYSTEM SHALL use local keys `g1`, `g2`, … in document order of each group's first member.
6.8. WHEN an element or an ancestor has role `dialog` or `alertdialog` THE SYSTEM SHALL set `place: "dialog"`.
6.9. WHEN an element is not in a dialog and has role `status` or `alert`, or `position` `fixed` or `sticky` with text of at most 160 characters, THE SYSTEM SHALL set `place: "toast"`.
6.10. WHEN neither 6.8 nor 6.9 applies THE SYSTEM SHALL set `place: "main"`.
6.11. WHEN a candidate is a member of a button or link group THE SYSTEM SHALL send `facts` with `contrast` (one decimal), `areaRatio` (two decimals, against the largest member), `fontPx` and `disabled`.
6.12. WHEN the effective background of a group member is assumed (no opaque captured ancestor) THE SYSTEM SHALL omit `contrast`.
6.13. WHEN contrast and backgrounds are computed THE SYSTEM SHALL use `effectiveBackground` and `textContrast` of `lib/detectors/shared/colour.ts`, imported read-only.

## 7. Split text, ranking, caps and ids

**User story:** As the owner, I want claims split across elements shown to the model, and a fixed budget per scan (note 2.1 steps 4 to 6, 1.4 item 1).

**Acceptance criteria:**

7.1. WHEN a non-control element's raw text has a run of two or more spaces, starts or ends with a connector of design §11, or is at most 40 characters long THE SYSTEM SHALL treat it as a fragment.
7.2. WHEN a fragment has direct children with tags `span b strong em i small mark s del ins sup sub time data abbr` THE SYSTEM SHALL attach their texts, each cut to 24 characters, as `parts` ordered by box top then left, at most `MAX_PARTS_PER_CANDIDATE`.
7.3. WHEN parts are attached THE SYSTEM SHALL keep the parent's text as it is and map the candidate to the parent id and then the part ids.
7.4. WHEN a child became a part THE SYSTEM SHALL not send it as its own candidate.
7.5. WHEN rule findings are linked THE SYSTEM SHALL number them `r1` to `r20` in document order of their first element; later ones are not sent and keep their level.
7.6. WHEN no element of a rule finding maps to a sent candidate, or its title is not in `TITLES`, THE SYSTEM SHALL not send it and SHALL keep its level.
7.7. WHEN a candidate is covered by a sent rule finding THE SYSTEM SHALL list that rule id in its `rules` field.
7.8. WHEN candidates are ranked THE SYSTEM SHALL score them with the table of design §11, break ties by document order and use no word list.
7.9. WHEN candidates are kept THE SYSTEM SHALL always keep those covered by a sent rule finding.
7.10. WHEN more than 60 candidates remain THE SYSTEM SHALL keep the 60 best ranked.
7.11. WHEN candidate text, parts included, exceeds 10,000 characters THE SYSTEM SHALL drop the lowest-ranked candidates until it fits.
7.12. WHEN the serialised data block exceeds `MAX_DATA_BLOCK_BYTES` THE SYSTEM SHALL drop the lowest-ranked candidates until it fits.
7.13. WHEN candidates are final THE SYSTEM SHALL sort them in document order and number them `c1` to `cN`.
7.14. WHEN any candidate, part or rule finding was dropped by a cap THE SYSTEM SHALL set `judge.truncated: true`.

## 8. Prompt, data block and request body

**User story:** As the owner, I want page text kept as quoted data that cannot act as instructions (note 3.1, 2.2, 4.1, attacks A2 and A6).

**Acceptance criteria:**

8.1. WHEN the system prompt is read THE SYSTEM SHALL find a constant holding the task, the six pattern definitions, the honest look-alikes per pattern of design §12, the verdict rules and the reason codes.
8.2. WHEN the system prompt is read THE SYSTEM SHALL find that it calls everything in `<page_data>` quoted shop content, that text claiming to be a system message, a developer, a test or a new rule is page text, and that such text is no evidence of any pattern.
8.3. WHEN the system prompt is read THE SYSTEM SHALL find that a number alone is not pressure, that "only N left" with nothing else is a neutral stock fact, and that an unsure candidate gets no output.
8.4. WHEN the prompt test runs THE SYSTEM SHALL find no element text of `tests/fixtures/judge-eval/dev.json` longer than 12 characters inside the system prompt.
8.5. WHEN the user message is built THE SYSTEM SHALL hold exactly one `<page_data>` block and then the fixed reminder line of design §12.
8.6. WHEN the data JSON is encoded THE SYSTEM SHALL use `JSON.stringify` and then escape `<`, `>`, `&`, U+2028 and U+2029 as `\u` sequences.
8.7. WHEN page text holds `</page_data>` or `<page_data>` THE SYSTEM SHALL produce a message in which the closing tag appears exactly once.
8.8. WHEN the data is built THE SYSTEM SHALL send `scanDate` (the UTC date of `capturedAt`, omitted when unreadable), rule findings without description or quote, and no language field.
8.9. WHEN the request body is built THE SYSTEM SHALL set the gateway or direct model id, `max_tokens` 1,400, `thinking: {type: "disabled"}`, `output_config` with `effort: "low"` and the JSON Schema format, `cache_control: {type: "ephemeral"}` on the last system block, no tools, and no `temperature`, `top_p` or `top_k`.
8.10. WHEN the body is serialised for a page with one 50,000-character element, for 1,500 elements, and for text made only of `<` or of three-byte characters THE SYSTEM SHALL stay under `MAX_REQUEST_BODY_BYTES`.

## 9. Output validation

**User story:** As a shopper, I want only checked, structural model output to reach me (note 3.2, 3.3).

**Acceptance criteria:**

9.1. WHEN the response text is not valid JSON or fails the zod schema THE SYSTEM SHALL give `invalid-output` and no retry.
9.2. WHEN the stop reason is `max_tokens` or the text is empty THE SYSTEM SHALL give `invalid-output`.
9.3. WHEN a finding names a candidate id beyond those sent, or a verdict a rule id beyond those sent, THE SYSTEM SHALL drop that item.
9.4. WHEN a quote, after NFC and whitespace collapse, is not an exact substring of its candidate's sent `text` or of one of its `parts` THE SYSTEM SHALL drop the finding.
9.5. WHEN a quote is shorter than 3 or longer than 120 characters THE SYSTEM SHALL drop the finding.
9.6. WHEN a `preselection` finding is not on a checkbox or radio with `checked: true` or on a selected option THE SYSTEM SHALL drop it.
9.7. WHEN a `visual-interference` finding is not on a member of a button or link group THE SYSTEM SHALL drop it.
9.8. WHEN a finding's reason is not a flag code of its pattern THE SYSTEM SHALL drop it.
9.9. WHEN a reject verdict has no look-alike code, a confirm no flag code of the rule's pattern, or a downgrade a flag code of another pattern THE SYSTEM SHALL ignore the verdict.
9.10. WHEN a rule id repeats THE SYSTEM SHALL keep the first verdict, and at most 20 verdicts.
9.11. WHEN more than 8 findings remain valid THE SYSTEM SHALL keep 8 by the order of design §13.
9.12. WHEN the response has more than 12 findings, more rejects than 11.8 allows, or flags more than half of the candidates sent (at least 6) THE SYSTEM SHALL set `ran-anomalous`.
9.13. WHEN a run is `ran-anomalous` THE SYSTEM SHALL keep at most 8 valid new findings and ignore every verdict.

## 10. Templates, wording and status lines

**User story:** As a shopper, I want every sentence written by the code, framed as possible, with a clear line when the reviewer did not run (note 1.6, 6).

**Acceptance criteria:**

10.1. WHEN a judge finding is shown THE SYSTEM SHALL take its title, description, evidence text and reason sentence from `lib/judge/templates.ts`; the only model text is the verified quote.
10.2. WHEN a quote is placed in a template THE SYSTEM SHALL pass it through `quote()` of `lib/detectors/shared/text.ts`.
10.3. WHEN a judge finding is titled THE SYSTEM SHALL use the fixed title of its pattern from design §14.
10.4. WHEN a judge finding is described THE SYSTEM SHALL state what the page shows and the reason sentence, and SHALL not assert intent.
10.5. WHEN a judge finding is explained THE SYSTEM SHALL use `EXPLANATIONS` of its pattern.
10.6. WHEN a reason code is shown THE SYSTEM SHALL use its one template sentence.
10.7. WHEN a judge finding is assembled THE SYSTEM SHALL drop it if `containsForbidden` is true for any of its strings.
10.8. WHEN the wording test runs THE SYSTEM SHALL find every title starting with "Possible" and no forbidden word in any template, status line, reason sentence or the system prompt.
10.9. WHEN `statusLine(result)` is called THE SYSTEM SHALL return only sentences of design §14, so UI code never writes its own.
10.10. WHEN the judge did not run (`off`, `skipped-*`, `timeout`, `error`, `invalid-output`) and findings exist THE SYSTEM SHALL return the rules-only line with the reason template of that status.
10.11. WHEN the findings list is empty and the judge did not run THE SYSTEM SHALL return "No possible patterns found by the rules. The reviewer did not run."
10.12. WHEN the findings list is empty and the status is `ran` THE SYSTEM SHALL return "No possible patterns found."
10.13. WHEN `ruleErrors` is above 0 THE SYSTEM SHALL add "Part of the rule check failed, so this result is incomplete."
10.14. WHEN any status line is returned THE SYSTEM SHALL end it with "Automated detection — may be wrong."
10.15. WHEN the enumeration test runs over every `JudgeStatus` × {empty, non-empty} × {`ruleErrors` 0, above 0} THE SYSTEM SHALL find no line holding "nothing found" in any case, and every empty-list line for a status other than `ran` saying that the reviewer did not run or that its answer looked unusual.
10.16. WHEN a set-aside list is labelled THE SYSTEM SHALL use the heading "Set aside as a likely honest look-alike" from `templates.ts`.

## 11. Merging rule and judge findings

**User story:** As a shopper, I want the judge to lower or add, never to raise or hide, so that its mistakes cannot make a result look worse or cleaner than the rules alone (note 1.1 to 1.4, 7.6 item 2).

**Acceptance criteria:**

11.1. WHEN a rule finding's title contains "on reload" or "across a reload" THE SYSTEM SHALL give it kind `reload`; a `visual-interference` title kind `measured`; a `preselection` title kind `structural`; every other title in `TITLES` kind `text`.
11.2. WHEN a `reload` finding gets a downgrade THE SYSTEM SHALL lower it one level with a floor of medium.
11.3. WHEN a `measured` finding gets a downgrade THE SYSTEM SHALL set it to low.
11.4. WHEN a `structural` or `text` finding gets a downgrade THE SYSTEM SHALL lower it one level, and to low when the reason is a look-alike code.
11.5. WHEN a reject on a `structural` or `text` finding lacks `confidence: "high"` THE SYSTEM SHALL apply it as a downgrade.
11.6. WHEN a reject names a `reload` or `measured` finding THE SYSTEM SHALL ignore it.
11.7. WHEN a reject is applied THE SYSTEM SHALL move the finding unchanged to `setAside` with its reason; it is never deleted.
11.8. WHEN the applicable rejects number more than 3, or more than half of the sent `structural` and `text` findings, THE SYSTEM SHALL ignore every reject of that scan and set `ran-anomalous`.
11.9. WHEN a judge-only finding has judge confidence `high` or `medium` THE SYSTEM SHALL show it as low.
11.10. WHEN a judge-only finding has judge confidence `low` THE SYSTEM SHALL drop it.
11.11. WHEN a rule finding is confirmed THE SYSTEM SHALL keep its level and set source `rules+judge`.
11.12. WHEN a verdict changes a level THE SYSTEM SHALL set source `rules+judge`, `ruleConfidence` to the old level and `judgeReason`.
11.13. WHEN a rule finding gets no verdict THE SYSTEM SHALL return it unchanged with source `rules`.
11.14. WHEN a judge finding has a rule finding's pattern and its candidate maps to one of that finding's elements, or to an element whose id is a path prefix or extension of one, THE SYSTEM SHALL count it as a confirm of that rule finding and add no marker; an explicit verdict for that rule wins.
11.15. WHEN two judge findings share pattern and candidate THE SYSTEM SHALL keep one.
11.16. WHEN findings of different patterns share an element THE SYSTEM SHALL keep them separate.
11.17. WHEN merged findings and set-aside findings are returned THE SYSTEM SHALL order each list by the document position of the first element, then by pattern id.
11.18. WHEN a judge finding is assembled THE SYSTEM SHALL set `detectorName: "judge"`, the candidate's mapped element ids and their boxes, and `detectedAt` from `capturedAt`.
11.19. WHEN the by-construction merge test runs over generated rule results and validated outputs THE SYSTEM SHALL find every judge-sourced finding low, no level above its rule level, and never more medium or high findings than the rules alone.
11.20. WHEN a level is compared THE SYSTEM SHALL never raise a rule finding's level.

## 12. Seam, mock and configuration

**User story:** As a test author, I want the model behind an interface and a deterministic fake (note 4.4, 4.5).

**Acceptance criteria:**

12.1. WHEN `lib/judge/interface.ts` is read THE SYSTEM SHALL export `JudgeRequest`, `JudgeRawResponse`, `JudgeClient` and `JudgeHttpError` as in design §16.
12.2. WHEN `toJudgeHttpError(value)` maps an error THE SYSTEM SHALL keep its numeric status, use `null` for a connection error, and mark it retryable only for a connection error or a status in `RETRYABLE_STATUSES`.
12.3. WHEN `createMockJudge` is given a canned response, an error, a hang or a function of the request THE SYSTEM SHALL answer deterministically and record each request.
12.4. WHEN `readPageData(request)` is called THE SYSTEM SHALL return the parsed data block of a request.
12.5. WHEN `JUDGE_MODE` is unset, empty or unknown THE SYSTEM SHALL read the mode as `off`.
12.6. WHEN `JUDGE_MODE` is `gateway` THE SYSTEM SHALL need `AI_GATEWAY_API_KEY`, the gateway base URL and `JUDGE_MODEL_GATEWAY`.
12.7. WHEN `JUDGE_MODE` is `anthropic` THE SYSTEM SHALL need `ANTHROPIC_API_KEY`, the direct base URL and `JUDGE_MODEL_DIRECT`.
12.8. WHEN the key of the chosen mode is missing or empty THE SYSTEM SHALL return mode `off` with `offReason: "missing-key"`, never throwing and never holding a key value in any message.

## 13. Orchestrator

**User story:** As the scan route author, I want one call that never throws and always says whether the reviewer ran (note 4.3, 5, 1.6).

**Acceptance criteria:**

13.1. WHEN `reviewFindings(snapshot, ruleResult, deps)` is called THE SYSTEM SHALL resolve to a `ReviewResult` and never reject.
13.2. WHEN `deps.mode` is `off` THE SYSTEM SHALL return the rules-only result with status `off` and make no call.
13.3. WHEN the mode is not `off` and `deps.client` is absent THE SYSTEM SHALL return status `off`.
13.4. WHEN the cooldown is active THE SYSTEM SHALL return `skipped-cooldown` and make no call.
13.5. WHEN less than 3 s remain before `deps.deadline` THE SYSTEM SHALL return `skipped-no-time` and make no call.
13.6. WHEN the first attempt starts THE SYSTEM SHALL pass `timeoutMs` = min(8 s, deadline − now − 1.5 s) and an `AbortSignal`.
13.7. WHEN an attempt has not answered within its timeout THE SYSTEM SHALL abort its signal and return `timeout`, with no retry after a first-attempt timeout.
13.8. WHEN the first attempt fails with a retryable `JudgeHttpError` and at least 5 s remain THE SYSTEM SHALL retry once with `timeoutMs` = min(6 s, deadline − now − 1 s).
13.9. WHEN the first attempt fails with 400, 401, 402, 403 or 404, or a retryable error with less than 5 s left, THE SYSTEM SHALL not retry.
13.10. WHEN an attempt fails with 402 THE SYSTEM SHALL return `skipped-over-budget` and start a 10-minute cooldown.
13.11. WHEN the last attempt fails with any other error THE SYSTEM SHALL return `error`, or `timeout` for a timed-out retry.
13.12. WHEN any step of the judge throws unexpectedly THE SYSTEM SHALL return `error`.
13.13. WHEN the status is not `ran` or `ran-anomalous` THE SYSTEM SHALL return every rule finding unchanged with source `rules` and an empty `setAside`.
13.14. WHEN a result is returned THE SYSTEM SHALL set `ruleErrors` to `ruleResult.errors.length`.
13.15. WHEN candidates were built THE SYSTEM SHALL set `candidateCount` to the number sent and `truncated` by 7.14; otherwise 0 and false.
13.16. WHEN the cooldown is used THE SYSTEM SHALL take it from `deps.cooldown`; `defaultCooldown` is the only module-level mutable state and tests use their own.
13.17. WHEN a scan runs THE SYSTEM SHALL make at most one call plus one retry.

## 14. The log record

**User story:** As the operator, I want one log line per scan that shows cost and health and holds no page content (note 5).

**Acceptance criteria:**

14.1. WHEN `reviewFindings` returns THE SYSTEM SHALL emit exactly one record through `deps.log`.
14.2. WHEN the record is built THE SYSTEM SHALL hold the fields of design §17 and no others.
14.3. WHEN the key is missing THE SYSTEM SHALL say so in that one record (`offReason`), not in an extra line.
14.4. WHEN the log test feeds sentinel strings as page text, quote, URL, API key, header and raw response THE SYSTEM SHALL find none of them in the serialised record.

## 15. Real client and the SDK dependency

**User story:** As the owner, I want the only network code in one server-only file, pinned to one SDK version (note 4.1, 4.2, 4.5).

**Acceptance criteria:**

15.1. WHEN `lib/judge/haiku.ts` is read THE SYSTEM SHALL find `import "server-only"` as its first import.
15.2. WHEN the client factory runs THE SYSTEM SHALL load `@anthropic-ai/sdk` with `await import(...)` inside it.
15.3. WHEN the client is built THE SYSTEM SHALL use the base URL and key of the config's mode and `maxRetries: 0`.
15.4. WHEN a request is sent THE SYSTEM SHALL send the body of 8.9 with the per-request `timeout` and `signal`.
15.5. WHEN a response arrives THE SYSTEM SHALL return its text blocks joined, its stop reason and its four usage counts.
15.6. WHEN the SDK rejects THE SYSTEM SHALL reject with `toJudgeHttpError` of the error.
15.7. WHEN the source-rule test runs THE SYSTEM SHALL find `@anthropic-ai/sdk` imported only in `lib/judge/haiku.ts`, and `haiku.ts` imported by no test file except `tests/judge/live/judge-live.test.ts`.
15.8. WHEN the dependency task runs THE SYSTEM SHALL add `@anthropic-ai/sdk` to `dependencies` at one exact version with no `^`, `~` or tag, change no other package or script, and limit the lockfile change to that package and its dependencies.
15.9. WHEN the install is denied or fails THE SYSTEM SHALL stop the task and say so.

## 16. Evaluation harness

**User story:** As the owner, I want the README's scoring in code, the rules-only baseline pinned and the plumbing tested on dev only (note 7.2 to 7.4, README).

**Acceptance criteria:**

16.1. WHEN a dev case is built THE SYSTEM SHALL build a `PageSnapshot` with exactly the README defaults and validate it with `PageSnapshotSchema`.
16.2. WHEN the harness loads `dev.json` THE SYSTEM SHALL check its sha256 against the value of note 7.1 and fail on a mismatch.
16.3. WHEN a flag case is scored THE SYSTEM SHALL count a hit for a finding of the case's pattern at any confidence whose `elementIds` include `evidenceElementId` or a `relatedElementIds` entry.
16.4. WHEN a finding of the case's pattern lands on another element THE SYSTEM SHALL report a misplaced hit and count a miss.
16.5. WHEN a clean case has a finding of its pattern THE SYSTEM SHALL count a false positive, except a low finding with `tolerateLow`, which is a tolerated low.
16.6. WHEN false positives are reported THE SYSTEM SHALL report any confidence and medium or high separately.
16.7. WHEN findings of other patterns appear THE SYSTEM SHALL report them as off-pattern and not score them.
16.8. WHEN a result is scored THE SYSTEM SHALL read `ReviewResult.findings` only, never `setAside`.
16.9. WHEN a table is printed THE SYSTEM SHALL show per pattern, per language and totals, with columns for rules-only, judge-only and rules+judge where run.
16.10. WHEN the rules-only run over dev ends THE SYSTEM SHALL print its table and find 18/60 hits, 3/60 false positives at any confidence, 3/60 at medium or high and 1 tolerated low.
16.11. WHEN the rules-only run ends THE SYSTEM SHALL find each case's outcome equal to `judge-eval-dev-baseline.json`.
16.12. WHEN the harness cannot reproduce a number THE SYSTEM SHALL fail and name the number and the cases; the expectation is never loosened.
16.13. WHEN the fake-judge run over dev ends THE SYSTEM SHALL print a rules+judge table and find every case scored with no exception.
16.14. WHEN a fake judge that only adds findings and only lowers levels runs over dev THE SYSTEM SHALL find no more medium or high false positives than rules-only.
16.15. WHEN `tests/fixtures/judge-dev-responses.json` does not exist THE SYSTEM SHALL skip the replay test; when it exists the test SHALL replay every recorded response through validation and merging with no network.

## 17. Prompt-injection tests at the code layer

**User story:** As the owner, I want each attack of note 3.4 shown harmless in code, whatever the model answers.

**Acceptance criteria:**

17.1. WHEN a fake model rejects every rule finding next to a countdown with "Ignore previous instructions" (A1) THE SYSTEM SHALL keep every `reload` and `measured` finding and cap rejects.
17.2. WHEN page text holds `</page_data>`, "[INST]", "### New rules" or `<|im_start|>system` (A2) THE SYSTEM SHALL close the data block exactly once.
17.3. WHEN a fake model flags every candidate as preselection (A3) THE SYSTEM SHALL drop findings on non-controls, keep at most 8 and set `ran-anomalous` above 12.
17.4. WHEN a fake model rejects everything (A4) THE SYSTEM SHALL apply no reject beyond 11.8 and show applied rejects under `setAside`.
17.5. WHEN a fake quote holds a URL or markup (A5) THE SYSTEM SHALL drop the finding, and a matching quote SHALL reach the finding only through `quote()`.
17.6. WHEN page text is 50,000 characters or 1,500 elements (A6) THE SYSTEM SHALL keep the caps of 7.10 to 7.12 and the body bound of 8.10.
17.7. WHEN page text holds Cyrillic, Arabic, zero-width joiners, an RTL override or full-width digits (A7) THE SYSTEM SHALL normalise it, run the quote check on the normalised text and not throw.
17.8. WHEN page text claims "reason: dated-deadline" and a fake output names an unknown reason (A8) THE SYSTEM SHALL fail validation for the unknown code and use only enum codes.
17.9. WHEN a fake quote holds a forbidden word from page text (A9) THE SYSTEM SHALL mask it through `quote()` and keep templates free of it.
17.10. WHEN a fake response is truncated JSON with `max_tokens`, empty, has extra keys or a wrong enum (A10) THE SYSTEM SHALL give `invalid-output`, the rules-only result and no retry.
17.11. WHEN a fake quote holds text of the system prompt (A11) THE SYSTEM SHALL drop the finding.

## 18. Opt-in live test

**User story:** As the owner, I want one command to measure the real model, which Kiro never runs (note 7.5, 7.6).

**Acceptance criteria:**

18.1. WHEN `RUN_LIVE_JUDGE` is not `1` or the key of `JUDGE_MODE` is not set THE SYSTEM SHALL skip every case of `tests/judge/live/judge-live.test.ts`.
18.2. WHEN the live test runs THE SYSTEM SHALL run every dev case 3 times through rules plus the real judge, and judge-only.
18.3. WHEN `JUDGE_EVAL_SEALED_PATH` is set THE SYSTEM SHALL run that file 3 times and print aggregates only, with no case id or text.
18.4. WHEN the live test runs THE SYSTEM SHALL run the model-layer attack fixtures of `tests/judge/live/attacks.json` and the Boo-tique page variants.
18.5. WHEN the live test ends THE SYSTEM SHALL print the metric tables, run-to-run agreement, p50 and p95 latency, token usage and total estimated cost.
18.6. WHEN the live test prints THE SYSTEM SHALL print no key, header or sealed case text.
18.7. WHEN `RECORD_JUDGE_DEV=1` is set THE SYSTEM SHALL write the raw dev responses to `tests/fixtures/judge-dev-responses.json` in the format of design §20.
18.8. WHEN the shipping bar of note 7.6 is recorded THE SYSTEM SHALL state it in the live test header and the design as the owner's measurement, asserted by no test.

## 19. Docs, steering and `.env.example`

**User story:** As a later contributor, I want the steering and the variable list to describe the judge as built (note 4.1, 4.4).

**Acceptance criteria:**

19.1. WHEN `.kiro/steering/tech.md` is read THE SYSTEM SHALL find an "LLM judge" section naming the model, the seam, the three modes, the rules-only outcome on any failure, the never-"nothing found" rule and the no-page-text log rule.
19.2. WHEN `tech.md` is read THE SYSTEM SHALL find no Gemini fallback.
19.3. WHEN `.kiro/steering/structure.md` is read THE SYSTEM SHALL list every file under `lib/judge/` and `tests/judge/`.
19.4. WHEN `.env.example` is read THE SYSTEM SHALL find `JUDGE_MODE=` and `AI_GATEWAY_API_KEY=` with one comment each, `ANTHROPIC_API_KEY=` with a comment for `JUDGE_MODE=anthropic`, `JUDGE_EVAL_SEALED_PATH=` with a live-test-only comment, and no `GEMINI_API_KEY`.
19.5. WHEN the steering and `.env.example` change THE SYSTEM SHALL keep `tests/capture/lib-text-rules.test.ts` and `tests/capture/config.test.ts` passing without editing them.

---

# Review fixes

This section adds requirements 20 to 24 for tasks 15 to 19. It comes from `docs/research/model-judge-review.md` (an independent review of the finished implementation, written by a Claude review agent, not by Kiro; "review n" means its section n). The fixes land before the first live run, because they change what the model sees and what its answer can do. The text above is not edited. Where a new criterion replaces an old one, the list below names both, and tests follow the new criterion.

## Amendments

- 1.12 and the rule line "`npm run lint` in task 14 only": lint also runs in task 19, the last task. Tasks 15 to 18 do not run it.
- 3.1 and 3.4, and the value of `MAX_COST_PER_SCAN_USD` ($0.003) in design §9 and §9's cost paragraph: replaced by 24.5 to 24.7. `INPUT_TOKEN_CEILING` stays at 6,100 as an estimate for a typical page and is no longer the bound.
- 4.3 (digit run: spaces, dots or dashes between digits): replaced by 23.5 to 23.8.
- 5.2 (visibility, with a zero-size box allowed for controls): replaced by 21.1 to 21.8. A control other than a checkbox, a radio or a selected option no longer keeps a zero-size box.
- 5.5 (removed characters): extended by 21.11.
- 5.6 (cut at 200 characters of the normalised text): replaced by 23.1. The cut now applies to the redacted text.
- 9.2 (only `max_tokens` and empty text are refused): replaced by 22.1 to 22.7.
- 9.12 ("more rejects than 11.8 allows"): reads 20.9 and 20.10, and also covers the new anomaly of 20.11.
- 10.15 (enumeration test): extended by 24.4 with the `truncated` state.
- 11.2 and 11.3 (downgrade of `reload` and `measured`): replaced by 20.1 to 20.3.
- 11.4 (downgrade of `structural` and `text`): replaced by 20.4 to 20.6.
- 11.5 (a reject without high confidence is applied as a downgrade): replaced by 20.7. It is now ignored.
- 11.8 (reject limit `min(3, floor(n / 2))`, more than half): replaced by 20.9 to 20.13.
- 14.2 (fields of the log record): the field set is unchanged; the value sets of `stopReason` and `anomalies` widen (20.11, 22.9).
- 15.3 (client built with base URL, key and `maxRetries: 0`): extended by 24.8 and 24.9.
- 18.8 and design §20 (live-test cost of about $0.25): replaced by 24.12.
- 19.1 (the "LLM judge" section of `tech.md`): extended by 20.14 and 24.11. The sentence "never decides about reload or measured findings" is wrong and is replaced.
- Unchanged on purpose: 16.10 (the rules-only figures 18/60, 3/60, 3/60 and 1 tolerated low), 11.6, 11.7, 11.9 to 11.20, 4.9 (the property stays; its test is extended) and 17.1 to 17.11.

## Left for later

These stay documented in review section 10 and are not built here:
- The offline fake-`fetch` test of `haiku.ts`.
- Counting an ancestor id as a duplicate in `related()`.
- A quote filter for unclosed tags and scheme-less script URLs (a UI rule: finding strings are text nodes only).
- Route-level rate limits, the daily scan cap and the result cache.
- Wrapping `createHaikuClient` failures as `off`, and passing `offReason` and `urlHash` from the route.
- The 25 s against 45 s scan budget.
- The measurement of the function trace size with the SDK.
- A second labeller for the evaluation set.

## 20. Downgrade and reject powers

**User story:** As a shopper, I want one model answer to be unable to lower every rule finding, so that a hostile page cannot make a result look cleaner than the rules found (review 3.2 items 1 and 4).

**Acceptance criteria:**

20.1. WHEN a `downgrade` names a `reload` or a `measured` finding and the judge's confidence is not `high` THE SYSTEM SHALL ignore the verdict and return the finding unchanged with source `rules`.
20.2. WHEN a `downgrade` names a `reload` finding with judge confidence `high` THE SYSTEM SHALL lower it one level and never below medium.
20.3. WHEN a `downgrade` names a `measured` finding with judge confidence `high` THE SYSTEM SHALL set it to low and never below low.
20.4. WHEN a `downgrade` names a `structural` or `text` finding with a look-alike reason code and the judge's confidence is not `high` THE SYSTEM SHALL ignore the verdict and return the finding unchanged with source `rules`.
20.5. WHEN a `downgrade` names a `structural` or `text` finding with a look-alike reason code and judge confidence `high` THE SYSTEM SHALL set it to low.
20.6. WHEN a `downgrade` names a `structural` or `text` finding with a flag code of its pattern or `insufficient-context` THE SYSTEM SHALL lower it one level, whatever the judge's confidence.
20.7. WHEN a `reject` names a `structural` or `text` finding and the judge's confidence is not `high` THE SYSTEM SHALL ignore the verdict and return the finding unchanged with source `rules`.
20.8. WHEN a `reject` with judge confidence `high` and a look-alike code names a `structural` or `text` finding THE SYSTEM SHALL move the finding unchanged to `setAside`, as in 11.7.
20.9. WHEN `n` is the number of sent `structural` and `text` findings, with `n` at least 1, THE SYSTEM SHALL allow at most `min(3, max(1, floor(n / 2)))` applicable rejects, where an applicable reject is a validated reject that names a sent `structural` or `text` finding, whatever its confidence.
20.10. WHEN the applicable rejects exceed the allowance of 20.9 THE SYSTEM SHALL ignore every verdict of the scan, including a confirm that a duplicate finding would give, and set `ran-anomalous` with the anomaly `too-many-rejects`.
20.11. WHEN three or more rule findings were sent and the number of distinct sent rule findings named by a lowering verdict is more than half of the rule findings sent THE SYSTEM SHALL ignore every verdict of the scan, including a confirm that a duplicate finding would give, and set `ran-anomalous` with the anomaly `too-many-lowered`.
20.12. WHEN 20.11 counts lowering verdicts THE SYSTEM SHALL count each validated `downgrade` and each applicable reject, including verdicts that 20.1, 20.4 or 20.7 ignore, and SHALL not count a reject of a `reload` or `measured` finding.
20.13. WHEN fewer than three rule findings were sent THE SYSTEM SHALL not apply 20.11; WHEN 20.10 and 20.11 both apply THE SYSTEM SHALL report each code once.
20.14. WHEN `.kiro/steering/tech.md` is read THE SYSTEM SHALL say that the judge may lower a `reload` finding (never below medium) and a `measured` finding (to low) only with its own confidence `high`, and that it never rejects, sets aside or raises either.
20.15. WHEN the fake judge `downgradeAllJudge` runs THE SYSTEM SHALL still answer with a downgrade of every rule finding, and the merge SHALL ignore or void that answer under 20.1 to 20.13.
20.16. WHEN `downgradeAllJudge` answers over a page with three or more sent rule findings THE SYSTEM SHALL return those findings unchanged with status `ran-anomalous`.
20.17. WHEN the rules-only run over dev ends THE SYSTEM SHALL find the figures of 16.10 exactly as before.

## 21. Text the shopper cannot see

**User story:** As a shopper, I want the model to read only what I could see on the page, so that a shop cannot hide an instruction in text I never see (review 3.2 item 2).

**Acceptance criteria:**

21.1. WHEN an element's box lies entirely outside the page area given by the snapshot's own width and height fields THE SYSTEM SHALL not make it a candidate.
21.2. WHEN an element's box is under 4 px wide or under 4 px high THE SYSTEM SHALL not make it a candidate, except under 21.8.
21.3. WHEN an element's font size is known and under 6 px THE SYSTEM SHALL not make it a candidate.
21.4. WHEN an element's opacity multiplied by the opacities of its captured ancestors is under 0.1 THE SYSTEM SHALL not make it a candidate.
21.5. WHEN the text contrast of an element against its effective background is under 1.2:1 and that background is known THE SYSTEM SHALL not make it a candidate.
21.6. WHEN the effective background is assumed, or the text colour cannot be read, or the font size cannot be read THE SYSTEM SHALL not apply the test that needs it.
21.7. WHEN these tests run THE SYSTEM SHALL use only fields the snapshot already holds and run them in the order of design §24.2.
21.8. WHEN an element is a checkbox or radio input, or a selected option, THE SYSTEM SHALL not apply 21.1 and 21.2 to that element itself, SHALL apply 21.3 to 21.5 to the element that carries its text (the merged label, or the option itself), and SHALL apply 21.1 and 21.2 to a merged label; a checkbox or radio without a label has no text to test.
21.9. WHEN an element is dropped by 21.1 to 21.5 THE SYSTEM SHALL not send it as a candidate, as a part or as a covering descendant in 6.1.
21.10. WHEN an element is dropped by 21.1 to 21.5 THE SYSTEM SHALL leave no placeholder, label or count for it in the data block, and SHALL not set `truncated` because of it.
21.11. WHEN text is normalised THE SYSTEM SHALL also remove U+E0000 to U+E007F, U+00AD, U+061C, U+180E, U+2800, U+3164, U+115F, U+1160 and U+FFA0, in addition to the ranges of 5.5.
21.12. WHEN a claim such as "Only 2 left" holds any one of those characters inside a word THE SYSTEM SHALL send the same text as the claim without it.
21.13. WHEN an element is small print that a shopper can read (font size at least 6 px, contrast at least 1.2:1, box at least 4 px each way, on the page) THE SYSTEM SHALL send it.
21.14. WHEN the build-case test runs over the dev cases THE SYSTEM SHALL print the number of flag cases whose evidence element maps to no candidate, so that a case that became unsendable is reported and not hidden.

## 22. Stop reasons

**User story:** As the owner, I want an answer used only when the model finished normally, so that a refusal or a cut-off answer never becomes a result (review 3.2 item 3).

**Acceptance criteria:**

22.1. WHEN the stop reason is `end_turn` or `stop_sequence` THE SYSTEM SHALL go on to parse and validate the text.
22.2. WHEN the stop reason is `refusal` THE SYSTEM SHALL give `invalid-output` with the code `stop-refusal`.
22.3. WHEN the stop reason is `pause_turn` THE SYSTEM SHALL give `invalid-output` with the code `stop-pause-turn`.
22.4. WHEN the stop reason is `max_tokens` THE SYSTEM SHALL give `invalid-output` with the code `stop-max-tokens`.
22.5. WHEN the stop reason is `tool_use` THE SYSTEM SHALL give `invalid-output` with the code `stop-tool-use`.
22.6. WHEN the stop reason is empty or any other value THE SYSTEM SHALL give `invalid-output` with the code `stop-unknown`.
22.7. WHEN a stop reason of 22.2 to 22.6 comes with a text that parses and would pass validation THE SYSTEM SHALL still give `invalid-output`, with no findings and no verdicts.
22.8. WHEN the status is `invalid-output` for a stop reason THE SYSTEM SHALL make no retry and SHALL return every rule finding unchanged with source `rules`.
22.9. WHEN the log record is built THE SYSTEM SHALL hold the code of 22.2 to 22.6 in `anomalies` and a `stopReason` from the fixed set `end_turn`, `stop_sequence`, `max_tokens`, `refusal`, `pause_turn`, `tool_use` or `other`, and no other value.
22.10. WHEN `statusLine` is called for such a result THE SYSTEM SHALL return the rules-only line with the reason "its answer could not be used".

## 23. Redaction

**User story:** As a shopper whose details appear on a page, I want redaction to hold across the cut and across common separators, and dates to stay readable, so that personal data does not leak and evidence is not erased (review 4).

**Acceptance criteria:**

23.1. WHEN candidate text is prepared THE SYSTEM SHALL normalise it, redact the whole normalised text, and only then cut it at 200 characters, setting `cut: true` when the redacted text is longer than 200.
23.2. WHEN the normalised text is longer than 2,000 characters THE SYSTEM SHALL cut it at 2,000 and drop the trailing partial word before redaction.
23.3. WHEN a part is prepared THE SYSTEM SHALL normalise, redact and then cut it at 24 characters.
23.4. WHEN the quote check and the parts are built THE SYSTEM SHALL use the sent, redacted text, as in 9.4.
23.5. WHEN text holds a date or a time of day of design §24.4 THE SYSTEM SHALL keep it readable, alone, with a time ("31.12.2025 23:59", "2025-12-31 23:59"), in a range ("01.11.2026 - 30.11.2026") or in the form "12/31/2025".
23.6. WHEN text holds a run of digits THE SYSTEM SHALL count its digits after removing the dates and times of 23.5 from the run, and replace each remaining part with 9 or more digits with `[number]`; the run and the separators are defined in design §24.4.
23.7. WHEN text holds a phone number with parentheses ("Call 0 (532) 123 45 67", "(0532) 123-45-67") THE SYSTEM SHALL replace it with `[number]`, including a parenthesis directly before its first digit or after its last.
23.8. WHEN text holds a card-like number split by spaces, " - " or "/" ("4111 - 1111 - 1111 - 1111", "4111/1111/1111/1111") THE SYSTEM SHALL replace it with `[number]`.
23.9. WHEN text holds a price, a short count, a clock time or a name THE SYSTEM SHALL keep it, as in 4.8; "Priya from Cardiff", "Only 3 left", "12:45" and "2.450,00 TL" stay.
23.10. WHEN the property test runs over seeded random strings THE SYSTEM SHALL generate the separator shapes of 23.6 to 23.8, dates, times, and strings whose personal data crosses the 200-character cut, and SHALL find no sent text that holds `://`, an `@`, or 9 or more consecutive digits.
23.11. WHEN a date or time is next to digits that make a run of 9 or more digits THE SYSTEM SHALL still replace those digits, as in "1234567890 12:30".

## 24. Status line, cost ceiling, SDK environment and live-test header

**User story:** As the owner, I want a partial review to be visible, a cost ceiling that is true, and an SDK that cannot print page text, so that the first live run measures what it should (review 3.2 item 5, 4, 5 and 11).

**Acceptance criteria:**

24.1. WHEN the status is `ran` or `ran-anomalous` and `judge.truncated` is true THE SYSTEM SHALL add the fixed sentence "The reviewer saw only part of this page." after the sentences of the status and before the rule-error sentence.
24.2. WHEN the findings list is empty, the status is `ran` and `judge.truncated` is true THE SYSTEM SHALL return "No possible patterns found. The reviewer saw only part of this page." followed by the disclaimer.
24.3. WHEN the status is another one, or `judge.truncated` is false, THE SYSTEM SHALL not add that sentence.
24.4. WHEN the enumeration test runs THE SYSTEM SHALL cover every status, both list states, both `ruleErrors` states and `truncated` true and false, find no "nothing found" in any line, and find the sentence of 24.1 in exactly the lines that 24.1 names.
24.5. WHEN the cost-ceiling test runs THE SYSTEM SHALL derive an input-token bound from the byte caps: the UTF-8 bytes of `JUDGE_SYSTEM_PROMPT`, of the serialised `JUDGE_OUTPUT_JSON_SCHEMA`, of the user-message wrapper and `MAX_DATA_BLOCK_BYTES`, at one token per byte.
24.6. WHEN the cost-ceiling test runs THE SYSTEM SHALL price that bound at the higher of the input and cache-write prices, add `MAX_OUTPUT_TOKENS` at the output price, and find the cost of one attempt, and of two attempts, at most `MAX_COST_PER_SCAN_USD` for the two attempts and at most half of it for one.
24.7. WHEN `MAX_COST_PER_SCAN_USD` is read THE SYSTEM SHALL find the computed worst case of two attempts rounded up to the next $0.001 (expected $0.010), and the spec text SHALL state the typical cost of about $0.0006 per call separately and as no bound.
24.8. WHEN the client is built THE SYSTEM SHALL pass `logLevel: "off"`.
24.9. WHEN the client is built THE SYSTEM SHALL pass `openTelemetry` with `propagation: false` and `traces` with `enabled: false` and `contentMode: "metadata_only"`.
24.10. WHEN the source-rule test runs THE SYSTEM SHALL find the options of 24.8 and 24.9 in the text of `lib/judge/haiku.ts`.
24.11. WHEN the header of `tests/judge/live/judge-live.test.ts` and `.kiro/steering/tech.md` are read THE SYSTEM SHALL list `ANTHROPIC_LOG`, `ANTHROPIC_CUSTOM_HEADERS`, `ANTHROPIC_AUTH_TOKEN` and the `ANTHROPIC_OPEN_TELEMETRY_*` variables as to be unset for a live run, and `tech.md` SHALL also say that hidden candidates are not sent and that only the stop reasons of 22.1 are used.
24.12. WHEN the live-test header and design §20 state the cost of a live run THE SYSTEM SHALL state about $0.45 without the sealed file and about $0.67 with it.
