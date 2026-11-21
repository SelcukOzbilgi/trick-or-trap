# Model judge: independent review

Date: 2026-11-21. Reviewer: an independent Claude agent (Opus 5.5) that did not write the code. Branch `feat/model-judge`, head `6acff84` (16 commits on `f1253c8`), never pushed. No model API was called, nothing was edited, committed or pushed, and no live test ran. Probes used the repo's mock seam from a scratch directory outside the repository. Sealed-split figures are aggregates only.

## 0. Verdict

**Safe to merge into `main` through a PR now, after a docs-only update.** The judge is off by default, nothing outside `lib/judge` and `tests/` imports it, and the SDK is in no server bundle or trace. The code-level defences hold against every injection and output attack I tried, with one exception: the judge can **downgrade every rule finding** in one answer, with no cap and no confidence requirement. It cannot remove or hide anything.

**Fix before the first live sealed run**, because these change the code being measured: items 1 to 4 of "Before the first live run" in section 10.

## 1. End-of-job checks

Each check ran once, one at a time, with `nice -n 15` and `env -u RUN_LIVE_JUDGE -u ANTHROPIC_API_KEY -u AI_GATEWAY_API_KEY JUDGE_MODE=off`. The worktree has no `.env`.

| Check | Result |
|---|---|
| `npx tsc --noEmit` | exit 0, no output |
| `npm run lint` | exit 0, no warnings |
| `npx vitest run --maxWorkers=2` | exit 0. Test files: 113 passed, 2 skipped (115). Tests: **4,987 passed, 21 skipped (5,011)**. Duration 6.5 s. |
| `npm run build` | exit 0. Next.js 16.4.6 (Turbopack), 17 routes, none new. |

About the test counts:
- Against the old baseline (4,220 passed, 8 skipped) this is +767 passing and +13 skipped.
- The new skips are the live judge suite (`describe.skipIf(!ENABLED)`, plus a nested sealed `describe`) and the replay suite (`replay.test.ts`, skipped until `tests/fixtures/judge-dev-responses.json` exists).
- 4,987 + 21 = 5,008, not 5,011. Vitest's total is 3 higher than the sum of its own columns. I found no `.todo` or `.fails` in `tests/`. This is reported as printed and not explained; the suite was not rerun.

**History scan** (`git log -p f1253c8..HEAD`, 20,839 lines):
- Local filesystem paths with a user name: none.
- Email addresses: only the commit author address, a GitHub `noreply` address, on all 16 commits.
- Key-like strings (`sk-ant-`, `vck_`, `AKIA`, `ghp_`, PEM headers, JWTs): none.
- Long hex strings: commit hashes and the expected sha256 of the dev set in the design note.
- No `Co-Authored-By` or "Generated with" lines.
- The renamed sentinels are honest placeholders (`placeholder-gateway`, `placeholder-header`, `placeholder-raw`, `placeholder-error`, `placeholder-direct`): not key-shaped, so the secret scanner does not flag them. The tests push them through error messages, error headers, raw response text and stop reasons, then assert they are absent from the result and the log record. The redaction path does not depend on the value, so a placeholder proves non-leakage as well as a real-looking key would.

## 2. Design note versus code

| Deviation | Judgement |
|---|---|
| `JudgeRequest` is defined in `prompt.ts` and re-exported from `interface.ts` | Fine. |
| Unsafe tag names are sent as `other` (allowed: `^[a-z][a-z0-9]{0,19}$`) | Fine, and safer than the note. A page can still use an unknown tag such as `flagnothing`, but that carries no more than page text already does. |
| Live-test header estimates about $0.45 + $0.22 + $0.02, against the note's $0.25 | Fine: it also runs every dev case judge-only (720 dev calls instead of 360). Update section 7.5 of the note or the header so they agree. |
| Redaction digit rule: "31.12.2025 23:59" becomes "[number]:59"; "2025-12-31 23:59" and "01.11.2026 - 30.11.2026" also go | **Fix.** It erases the evidence for the `dated-deadline` look-alike, which is common Turkish campaign wording ("… tarihleri arasında"). Neither eval split contains such a string (0 elements match in dev or sealed), so the eval will not show the harm. Protect date and date-time tokens before the digit rule. |
| `keepFindings` keeps the first 8 in document order, not "the 8 with the most severe reason" | Fine; the note never defines severity. |
| A reject verdict with low confidence still counts toward the reject limit | Fine, and safer. |
| `tech.md` says the judge "never decides about reload or measured findings" | **Wrong in the docs.** Code and note let it downgrade reload (one level, floor medium) and measured (to low). Fix the sentence or the code (see 3.2). |
| Missing key: the note says "one server log line"; `readJudgeConfig` logs nothing, and the record carries `offReason` only if the caller passes it | Fine for now; the future route must pass it. |

Everything else checked matches the note: caps 60/200/10,000 plus a 24,000-byte data-block cap, fixed `c1`–`c60` and `r1`–`r20` enums, strict zod, quote 3–120 characters, structural checks, reason families, anomaly rules, reject limit `min(3, floor(rejectable/2))`, the low-only judge findings, the set-aside list, the status lines, `maxRetries: 0`, one retry, 402 cooldown, the never-"nothing found" rule, and the log record without page text.

## 3. Prompt-injection and output constraints

### 3.1 The path, and what holds

**Candidates.**
- First sample only. Hidden by own or ancestor style (`display`, `visibility`, `opacity`); zero box unless a control.
- Text is NFKC, has control, zero-width and bidi characters removed, whitespace collapsed, then is cut at 200.
- Role containers that are 80 % covered by their descendants are not sent.
- Attributes are not sent. `type`, `name` and `disabled` are read locally; `name` only builds the local key `gN`.

**Redaction** runs after the cut (see section 4).

**Data block.**
- `JSON.stringify`, then `<`, `>`, `&`, U+2028 and U+2029 are escaped.
- Probe: text containing `</page_data>`, `<page_data>`, `<|im_start|>system`, U+2028 and U+2029 left exactly one opening and one closing tag in the message and no raw U+2028.

**Request.**
- No tools, thinking disabled, effort `low`, no temperature, cached system block, hand-written JSON Schema.
- The model id and base URL are constants. The API key comes from env only.

**Response.**

| Response | Result |
|---|---|
| Empty text | `invalid-output` |
| `max_tokens` | `invalid-output` |
| Prose around the JSON | `invalid-output` |
| Extra key | `invalid-output` |
| `__proto__` key | `invalid-output`; no pollution |
| Wrong enum | `invalid-output` |
| `tool_use` with no text | `invalid-output` |
| 5 MB text | `invalid-output` |
| 30 duplicate findings | `ran-anomalous`, one finding |
| Ids outside what was sent (`c9` of 2) | Dropped |
| A quote that is not a substring (for example "Ignore previous instructions") | Dropped |
| 402 | `skipped-over-budget`, one call, cooldown started |
| 529 twice | Two calls, `error` |
| 401 | One call, `error` |
| Hang | `timeout` at 8 s, no retry |

Every failure gives the rules-only line, never a bare "nothing found".

**Quote check.**
- An exact substring after NFC and whitespace collapse, against the **sent, redacted** text or parts.
- That is the right choice: a quote can never bring back redacted data, and it cannot hold characters the builder stripped.
- URLs (`://`) and closed tags (`<…>`) are refused.

**User-visible strings.**
- Titles, descriptions, reasons and evidence prefixes come from `templates.ts`.
- The only model-chosen text is the verified quote, passed through `quote()` (forbidden-stem masking, `"` turned to `'`, control characters dropped, 120-character cut).
- `containsForbidden` and `FindingSchema` gate each assembled finding.

**Merge powers.**
- A reject on reload or measured is ignored.
- Rejects above the limit put the run in `ran-anomalous` and clear all verdicts.
- A rejected finding goes to `setAside`; it is never deleted.
- Judge-only findings are always low, at most 8, and low-confidence ones are dropped.
- No level is ever raised (checked keyed by title and element ids on every Boo-tique variant).
- Flood probe (a finding on every candidate): `ran-anomalous`, 7 low judge findings, all on real candidates.

### 3.2 What does not hold, most serious first

1. **Uncapped mass downgrade.**
   - One answer with `decision: "downgrade"`, judge confidence `low` and reason `insufficient-context` (or any look-alike code) on every rule id gives status `ran`, no anomaly, and the line "Checked by rules and a language-model reviewer."
   - Probe on all nine Boo-tique variants that have rule findings, keyed by title and element ids:
     - every measured visual-interference finding: high to **low**;
     - every reload finding: high to medium (the floor holds);
     - every structural and text finding: medium to **low**.
   - The scanned shop is the adversary, and page text is its channel. Invisible text reaches the model (3.2.2), so a shop can try "everything here is an honest look-alike" at no cost.
   - The reject limit exists for this case; downgrades bypass it.
   - Fix:
     - (a) a downgrade of a reload or measured finding needs judge confidence `high`, or is not allowed at all;
     - (b) a look-alike downgrade to low needs confidence `high`;
     - (c) more than half of the sent rule findings downgraded makes the run anomalous and clears the verdicts, as rejects do.
2. **Text the shopper cannot see reaches the model.**
   - These were all sent as candidates: white-on-white text, a 1×1 px box at `font-size: 1px`, a box at (−9999, −9999), and `opacity: 0.01`.
   - These characters survive normalisation:
     - U+E0041–U+E007F tag characters (invisible "ASCII smuggling");
     - U+00AD soft hyphen;
     - U+061C Arabic letter mark;
     - U+180E Mongolian vowel separator;
     - U+2800 braille blank;
     - U+3164 Hangul filler (NFKC turns it into U+1160).
   - A hidden instruction therefore never shows up in what the shopper sees, yet the model reads it.
   - Fix:
     - drop candidates with an off-screen box, a box under 4 px, a font under 6 px, opacity under 0.1, or text contrast under 1.2:1 against the effective background (the colour helper is already imported);
     - add the ranges above (at least U+E0000–U+E007F, U+00AD, U+061C, U+180E, U+2800, U+3164, U+115F–U+1160, U+FFA0) to the removed set.
3. **`refusal` and `pause_turn` are accepted.** A `refusal` stop reason whose text parses as valid output gives `ran` with its findings; `pause_turn` gives `ran`. Only `max_tokens` is refused. Fix: accept only `end_turn` (and maybe `stop_sequence`) and treat everything else as `invalid-output`.
4. **The reject limit misfires on a single rejectable finding.** `floor(1/2) = 0`. On `checkout-default` (one structural finding), one high-confidence `required-terms` reject gives `ran-anomalous` and clears all verdicts. This is safe, but it is noisy, and it marks honest answers as unusual on the commonest checkout shape. Decide deliberately: allow one reject when exactly one finding is rejectable, or keep the rule and document it.
5. **Truncation is invisible.** A 1,500-element page gives `truncated: true` with 60 candidates sent, yet the line reads "No possible patterns found." A shop can pad a page with high-scoring decoys (digits, `!`, `%`, clocks score +45) to push real claims out of the 60. Fix: add a fixed sentence when `judge.truncated` is set ("The reviewer saw only part of this page.").
6. **A quote can carry an unclosed tag or a scheme-less script URL.** `<img src=x onerror=alert(1) only 2 left` passed: the markup check needs a closing `>`. `javascript:alert(1)` has no `://`. Both are page text and harmless as React text children. They become a risk only if a future UI, export, e-mail or PDF renders finding strings as HTML or Markdown, or turns them into links. Add a rule to the UI spec: finding strings are text nodes only. Also refuse quotes containing `<`, or a `[a-z]+:` scheme.
7. **An ancestor counts as a duplicate.** `related()` treats an ancestor id as related, so a judge finding on a container that encloses a rule element becomes a confirm. This is harmless (a confirm changes no level), but it labels the rule finding `rules+judge` on thin evidence.

### 3.3 Timeouts and retries

- The orchestrator's own timer aborts at `timeoutMs`.
- A failure after the abort, or after the time has elapsed, is classed as `timeout` and never retried.
- With the real SDK error classes (loaded from `node_modules`, no network), `APIUserAbortError` and `APIConnectionTimeoutError` map to status `null` and "retryable". Only the orchestrator's late check stops a retry after a timeout, and it does.
- 402 → not retryable; 529 → retryable; 400 → not.

## 4. Privacy and data minimisation

**What leaves the server:**
- the system prompt (6,653 bytes) and the schema (2,419 bytes);
- one user message with:
  - `scanDate` (a date only);
  - candidates: id, tag or `other`, place, text of at most 200 characters, `cut`, `control` and `checked`, up to 8 parts of at most 24 characters, group key `gN`, and numeric facts (contrast, area ratio, font size, disabled);
  - rule findings: id, pattern, confidence, kind and candidate ids.
- Never sent: the URL, the host, attribute values (`href`, `value`, `placeholder`, `name`, `aria-*`), boxes, colours, styles, screenshots, capture metadata, rule descriptions and rule quotes.
- Form values: capture's `text` is `innerText`, so a typed input value is never in it. Values and placeholders exist only as attributes, which the judge does not send.
- HTTP headers: `x-api-key`, the SDK's platform headers (`x-stainless-*`: OS, architecture, runtime version), and a `traceparent` header.

**Redaction gaps** (probed on normalised text):

| Input | Sent as |
|---|---|
| `Call 0 (532) 123 45 67`, `(0532) 123-45-67` | **unchanged**: a parenthesised Turkish phone number is not redacted |
| `4111 - 1111 - 1111 - 1111`, `4111/1111/1111/1111` | **unchanged** |
| `jane.doe (at) example.com` | unchanged |
| `evil.com` without a following `/`, `?` or `#` | unchanged (as the note specifies) |
| An e-mail or card number crossing the 200-character cut | `… jane.doe@` and `… 4111 1111` survive, because the cut runs **before** redaction |
| `+90 532 123 45 67`, an 11-digit TC Kimlik number, an IBAN, Arabic-Indic and full-width digits, `jane.doe@example.com` | redacted |

Fixes:
- Redact the full normalised text first, then cut.
- Allow `(`, `)`, `/` and ` - ` between digit groups.
- Protect dates and times (section 2).

Impact is limited: scans are of public pages without login. These are still the cases the note's property test claims to cover, and the property test's random strings miss them.

**Logging.**
- One JSON record per scan with fixed keys: status, prompt version, mode, `offReason`, latency, attempts, HTTP status, a stop reason reduced to a fixed set, usage, estimated cost, counts, anomaly codes and an optional URL hash.
- No page text, quote, prompt, URL, raw answer, key or header.
- Errors are rebuilt as `JudgeHttpError("judge-http")`; the SDK's error object is discarded, not logged.

**SDK environment that can undo this** (not set by the code, read by the SDK):
- `ANTHROPIC_LOG=debug` makes the SDK log request options and responses. Headers are redacted, but the body, which holds page text, is not.
- `ANTHROPIC_CUSTOM_HEADERS` adds headers to every request.
- `ANTHROPIC_OPEN_TELEMETRY_TRACES_CONTENT_MODE=content` puts message content on OpenTelemetry spans (the default is `metadata_only`).

Fix: pass `logLevel: "warn"` (or `"off"`) and an explicit `openTelemetry` option (`{ traces: { contentMode: "metadata_only" } }` or `false`) in `createHaikuClient`, and note the variables in `tech.md`. A credential passed in code stops the SDK from reading `ANTHROPIC_API_KEY` or `ANTHROPIC_AUTH_TOKEN`, and the explicit `baseURL` beats `ANTHROPIC_BASE_URL` and profile hosts. Both were checked in the SDK 1.12.0 source.

## 5. Spend and abuse

- **Per call:**
  - `max_tokens` is 1,400.
  - Input is bounded by bytes: 6,653 (system) + 2,419 (schema) + at most 24,000 (data block). A worst-case probe page of 4-byte characters gave a 23,032-byte data block and a 33,325-byte body.
  - SDK retries are off. There is one orchestrator retry, only after a connection error, 408, 409, 429 or 5xx/529, and only with 5 s left. There is no retry after a timeout, a 4xx up to 404, or invalid output.
- **The $0.003 ceiling is not proven.**
  - `constants.test.ts` multiplies `INPUT_TOKEN_CEILING = 6,100` (an assumed constant) by the price; no code enforces it.
  - From the byte cap, an adversarial page (rare scripts or emoji, around one token per byte) could reach about 25,000 input tokens: about $0.0033 for one attempt and about $0.0067 if a billed attempt is retried.
  - This is still well under a cent. Either derive the ceiling from the byte cap and raise the stated bound, or lower `MAX_DATA_BLOCK_BYTES`.
- **Daily cap.** The only daily bound is outside the code: the gateway key budget (soft), the team budget and prepaid credit. The 402 cooldown (10 minutes, per instance, in memory) applies only to 402. 429 gets one retry and no cooldown.
- **Abuse today:** none. No route calls `reviewFindings`.
- **Abuse after a public scan route:**
  - An attacker spends at most one or two calls per uncached scan, about $0.0006 typical and about $0.003–0.007 worst case.
  - The realistic attack is draining the $1/day budget so the reviewer is off for everyone (about 300–1,600 scans). Capture costs per scan are likely higher than judge costs.
  - When the cap is hit: 402 → `skipped-over-budget` → rules-only line ("daily limit reached"), then `skipped-cooldown` for 10 minutes on that instance. Correct and visible.

## 6. Secrets and configuration

- `JUDGE_MODE`: unset, empty, `off` or unknown → `off`; `gateway` and `anthropic` need their own trimmed key, otherwise `off` with `missing-key`.
- The key appears only in `JudgeConfigOn.apiKey`, never in a thrown message.
- `config.ts` and `haiku.ts` start with `import "server-only"`. `review.ts` does not, and holds no secret.
- Base URL: constants only. No env value or input can redirect the key to another host.
- `createHaikuClient` is async and can throw: for example the SDK import or constructor, or if a future change passes both a key and a token. The future route must wrap it and fall back to `off`.

## 7. Dependency

| Item | Value |
|---|---|
| Pin | `@anthropic-ai/sdk` `1.12.0`, exact, in `dependencies`; a source-rule test enforces the exact pin |
| New lockfile packages | `@anthropic-ai/sdk` 1.12.0 (Apache-2.0), `@opentelemetry/api` 1.10.0 (Apache-2.0), `json-schema-to-ts` 3.1.1 (MIT), `ts-algebra` 2.0.0 (MIT), `@babel/runtime` 7.29.15 (MIT), `standardwebhooks` 1.3.0 (MIT), `@stablelib/base64` 1.0.1 (MIT), `fast-sha256` 1.3.0 (Unlicense) |
| Peer | `zod ^3.25 \|\| ^4`, deduped to the repo's zod 4.6.7 |
| `npm audit --omit=dev` | found 0 vulnerabilities |
| Import sites | only `lib/judge/haiku.ts`, by dynamic `await import`; `haiku.ts` is imported by no file outside the live test |
| Bundle and trace | no file under `app`, `components` or `lib` outside `lib/judge` imports the judge, and no `.next` output references the SDK. Today's impact is zero. On disk: SDK 26 MB, `@opentelemetry/api` 1.9 MB. Measure the function trace again when a route imports it. |

## 8. Tests and the evaluation harness

- **Behaviour or fake?**
  - Validation, merge, orchestrator, candidates, prompt, redaction, templates and status lines are real code under test. Only the client is fake. The injection suite runs hostile **outputs** through real validation and merge.
  - Gap: `haiku.ts` has no behavioural test. It is covered only by string matches in `source-rules.test.ts` (`maxRetries: 0`, `timeout: opts.timeoutMs`, and so on). Its text concatenation, stop-reason and usage mapping, and error mapping first run in the live test.
  - Suggestion: let one offline test build the client with the SDK's `fetch` option and a fake fetch. It can then assert the host, the `x-api-key` header, one request per call, the body shape, and the mapping of 402, 529 and a timeout. The source rule that bans importing `haiku.ts` would need a named exception.
  - The tests do not cover uncapped downgrades, invisible text, or `refusal` and `pause_turn`. `downgradeAllJudge` in `fake-judges.ts` treats downgrade-all as acceptable.
- **Dev regression.**
  - Pinned exactly: 18/60 hits, 3/60 false positives, 3/60 medium or higher, 1 tolerated low.
  - Every case's outcome, off-pattern list and error count match `judge-eval-dev-baseline.json`.
  - The dev file's sha256 is checked. This is sensible: any detector change that moves a case fails loudly.
- **Honesty.**
  - The scorer reads `ReviewResult.findings` only, so set-aside findings are neither hits nor false positives.
  - The rules-only figure goes through the same orchestrator with the judge off.
  - The judge-only column passes no rule findings.
  - The live test asserts only what must hold whatever the model answers.
- **Live gate.**
  - `describe.skipIf(!ENABLED)` requires `RUN_LIVE_JUDGE=1` **and** `JUDGE_MODE` set to `gateway` or `anthropic` **and** that mode's key.
  - Vitest does not load `.env` into `process.env`, so nothing runs by accident.
  - The sealed part is nested in the same `describe` and runs whenever `JUDGE_EVAL_SEALED_PATH` is set.
  - Sealed handling: fixed error messages, aggregate tables only, never recorded.
- **Sealed split, rules only** (this review, through `buildCaseSnapshot`, `runAllDetectors`, `reviewFindings` with mode `off` and `scoreRun`):

| Group | Hits | FP any | FP medium+ | Tolerated lows |
|---|---|---|---|---|
| fake-urgency | 4/10 | 0/10 | 0/10 | 1 |
| fake-scarcity | 6/10 | 0/10 | 0/10 | 1 |
| fake-activity | 0/10 | 0/10 | 0/10 | 0 |
| confirmshaming | 0/10 | 0/10 | 0/10 | 0 |
| preselection | 9/10 | 0/10 | 0/10 | 0 |
| visual-interference | 4/10 | 0/10 | 0/10 | 0 |
| English | 11/30 | 0/30 | 0/30 | 2 |
| Turkish | 12/30 | 0/30 | 0/30 | 0 |
| **Total** | **23/60** | **0/60** | **0/60** | **2** |

Misplaced hits: 0. Detector errors: 0. Off-pattern findings: 0. This confirms the design agent's 23/60 and 0/60, and its per-pattern split.

## 9. Merge mechanics

- `git fetch origin`: `origin/main` is `ddedc81` (it also fetched tag `v0.1.0`). The merge base is `f1253c8`.
- `git merge-tree --write-tree HEAD origin/main`: exit 0, **no conflicts**.
- Correction to the brief: `main` changed `.kiro/steering/product.md` and `design.md`, not `tech.md` or `structure.md`. The branch changed `tech.md`, `structure.md` and `.env.example`, so no file is touched on both sides.

**`README.md` on `main` that the PR should update:**
- Line 34: "Not built yet: … the model reviewer (#6)". Say instead that the module exists, is off by default, is not wired to any route, and is unmeasured.
- Lines 127 and 153: "model reviewer … next" and "(planned: #6)". Same update.
- Line 103: "on a branch not yet merged".
- Line 164: names "the planned model reviewer".
- Line 225: "Listed for later features: … `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`". `GEMINI_API_KEY` is gone from `.env.example`. Add `JUDGE_MODE`, `AI_GATEWAY_API_KEY`, `ANTHROPIC_API_KEY` (now read by `lib/judge/config.ts`), and the test-only `RUN_LIVE_JUDGE`, `RECORD_JUDGE_DEV` and `JUDGE_EVAL_SEALED_PATH`.

**`CHANGELOG.md`:** `[Unreleased]` is empty. Add the judge module, the evaluation harness and dev set, the opt-in live test, and the `@anthropic-ai/sdk` 1.12.0 dependency. Under Removed, add `GEMINI_API_KEY` and the fallback model.

## 10. Lists

### Before merge (docs only)
1. Update the README lines and the CHANGELOG entry above.
2. Correct `tech.md`'s "never decides about reload or measured findings", or make the code match (see the next list, item 1).
3. Align the live-test cost estimate with note section 7.5.

### Before the first live run with a real key
1. Cap downgrades: confidence `high` for reload and measured downgrades and for look-alike drops to low, and more than half downgraded → anomalous.
2. Drop invisible candidates (off-screen, tiny, near-zero opacity or contrast) and strip the extra invisible ranges.
3. Accept only `end_turn` (and `stop_sequence`) stop reasons.
4. Redaction: protect dates and times, redact before the cut, allow `(`, `)`, `/` and ` - ` separators. Add these to the redaction tests. They change what the model sees, so they must land before the sealed run, which then measures frozen code.
5. Pass `logLevel` and `openTelemetry` explicitly in `createHaikuClient`.
6. Decide the single-rejectable-finding rule.
7. Optional: one offline fake-`fetch` test of `haiku.ts`.

### Before a public scan route
1. Add a truncation sentence to `statusLine`.
2. UI rule: every finding string is a text node, never HTML, Markdown or a link. Also tighten the quote filter (`<`, `scheme:`).
3. Rate limits per IP, a global daily scan cap in code (the gateway budget is soft and is the only daily judge bound), the result cache, and a `judge_calls` count when the store lands.
4. Wrap `createHaikuClient` failures as `off`, and pass `offReason` and `urlHash` into the log record.
5. Settle the 25 s versus 45 s scan budget (note 4.3).
6. Measure the function trace size with the SDK.

### Later
- Derive the cost ceiling from the byte cap, not from `INPUT_TOKEN_CEILING`.
- Do not count ancestor ids as duplicates.
- Add a second labeller for the eval set, and real captures.

## 11. Owner setup for the first live evaluation

**Environment** (names only):
- `RUN_LIVE_JUDGE=1`.
- `JUDGE_MODE=gateway`, with `AI_GATEWAY_API_KEY` from a **project-scoped** AI Gateway API key.
- For the direct path, `JUDGE_MODE=anthropic` with `ANTHROPIC_API_KEY`.
- Optional: `RECORD_JUDGE_DEV=1` to write `tests/fixtures/judge-dev-responses.json`, which enables the replay test.
- **Leave `JUDGE_EVAL_SEALED_PATH` unset on the first run.** The sealed part runs in the same invocation whenever it is set, and the first run should only shake out the slug, the latency and the answer shape on dev.
- Unset `ANTHROPIC_LOG`, `ANTHROPIC_CUSTOM_HEADERS`, `ANTHROPIC_AUTH_TOKEN` and the `ANTHROPIC_OPEN_TELEMETRY_*` variables in that shell.

**Gateway:**
- Confirm the model slug `anthropic/claude-haiku-5.5` in the gateway model list. It is a constant in `lib/judge/constants.ts`: a wrong slug gives status `error` on every call, which the "reached the model at least once" assertion catches.
- Confirm that the gateway accepts the SDK's `x-api-key` header.
- Key budget: the run is about 745 calls for dev, attacks and Boo-tique, plus 360 for sealed. At about $0.0006 per call that is about $0.45 without sealed and about $0.67 with it, against a $1 `daily` budget. Raise the budget to $2 for the evaluation day, or run dev and sealed on different days.
- Keep the team budget at $10 `monthly` and prepaid credit with auto-recharge off.

**What the run should record:**
- `JUDGE_PROMPT_VERSION` and the commit hash.
- The status counts per phase. Every call should be `ran` or `ran-anomalous`. Any `skipped-over-budget`, `error` or `timeout` makes those figures rules-only, and they must not be read as judge figures.
- The three tables (rules-only, judge-only, rules plus judge) per pattern and language.
- Run-to-run agreement.
- p50 and p95 latency.
- Input, output and cache-read token totals, and the real cost against the gateway's own figure.
- Whether `thinking: disabled` with effort `low` was accepted.
- The anomaly codes.
- For each attack pair, whether the hostile page's findings equal the clean twin's.
- Boo-tique recall and false positives.
- Sealed: aggregates only, after the fixes above are frozen.
