---
inclusion: always
---

# Project structure and naming conventions

## Directory layout

```
trick-or-trap/
├── app/
│   ├── layout.tsx                 # root layout (dark theme)
│   ├── page.tsx                   # landing / scan form
│   ├── r/[id]/
│   │   └── page.tsx               # result page (noindex)
│   ├── api/
│   │   └── scan/
│   │       └── route.ts           # POST /api/scan
│   ├── boo-tique/                 # real segment – Boo-tique fake shop (a route group would put its page at /)
│   │   ├── layout.tsx             # light theme override
│   │   ├── page.tsx               # home with hero, cookie banner, countdown
│   │   ├── product/[slug]/
│   │   │   └── page.tsx           # product page (stock, activity, upsell)
│   │   ├── cart/
│   │   │   └── page.tsx           # cart (preselection patterns)
│   │   ├── checkout/
│   │   │   └── page.tsx           # checkout (drip pricing, newsletter)
│   │   ├── club/
│   │   │   └── page.tsx           # club (confirmshaming, timer)
│   │   └── account/
│   │       └── subscription/
│   │           └── page.tsx       # subscription cancel maze
│   └── capture-fixture/           # test-only routes, 404 unless CAPTURE_FIXTURE_ROUTES is exactly "on"; thin handlers over lib/capture-fixture
│       ├── route.ts               # main fixture page: every request source, result list
│       ├── frame/route.ts         # frame page (same-site and cross-site variants)
│       ├── popup/route.ts         # popup page
│       ├── redirect/route.ts      # 302 to a forbidden tag URL
│       ├── alignment/route.ts     # tall page with a red marker for the pixel check
│       ├── clobber/route.ts       # form with input names that shadow DOM members
│       └── worker.js/, shared.js/, sw.js/   # script routes (each a route.ts): dedicated, shared and service worker
├── components/
│   ├── ui/                        # shadcn/ui primitives
│   ├── scanner/                   # scan form, progress scene, result overlay
│   ├── findings/                  # finding card, monster badge, minimap
│   └── boo-tique/                 # shop-specific components
├── lib/
│   ├── types/
│   │   └── index.ts               # PageSnapshot, Finding, Scan – all zod-validated
│   ├── boo-tique/                 # palette, styles, variants, timers, content, ground-truth schema
│   ├── capture/
│   │   ├── browser.ts             # getBrowser() with three modes (only `remote` implemented)
│   │   ├── extractor.ts           # collectInPage (collector run in a CDP isolated world, DOM-clobbering safe) and buildSample (outside pass) → PageSnapshot
│   │   ├── capture.ts             # capturePage() orchestrator; fails closed on guard-lost
│   │   ├── types.ts               # error and warning codes, GuardReasonCode, CaptureResult, ScanOutcome, CaptureFailure, raw page types
│   │   ├── outcome.ts             # toScanOutcome: public "could not scan" outcome, never carries detail
│   │   ├── constants.ts           # named deadlines and limits
│   │   ├── redact.ts              # redactText, toDetail
│   │   ├── clock.ts               # Clock, Deadline, withTimeout
│   │   ├── config.ts              # env parsing (server-only)
│   │   ├── ip-ranges.ts           # IP parsing and blocked ranges
│   │   ├── url-check.ts           # checkUrlSyntax, checkUrl, Resolver
│   │   ├── resolver.ts            # default DNS Resolver
│   │   ├── seam.ts                # browser seam interfaces, no Playwright types
│   │   ├── browser-use-api.ts     # Browser Use create, stop, reclaim and sweep calls (active-session listing with paging)
│   │   ├── remote-browser.ts      # BrowserProvider over CDP; the only file importing playwright-core
│   │   ├── cdp.ts                 # CdpSession interface (send only), isolated-world calls, page metrics, scrollbars
│   │   ├── guard-types.ts         # guard types: GuardVerdict, RequestGuardEvent, RequestPolicy, GuardSession, GuardBrowser, GuardLossCause
│   │   ├── browser-guard.ts       # installBrowserGuard: browser-level Fetch interception, service-worker refusal, loss detection, heartbeat, host limits; header lists residual risks
│   │   ├── guard-policy.ts        # createGuardPolicy: URL syntax, DNS and the capped verdict cache
│   │   ├── response-hardening.ts  # response-stage rewrite that blocks WebSocket connections
│   │   ├── geometry.ts            # pure maths: boxes, mode choice, tiles, sizes
│   │   └── screenshots.ts         # captureImages: single or tiled screenshots
│   ├── capture-fixture/
│   │   └── pages.ts               # pure builders of the test-only fixture pages and scripts, FIXTURE_TAGS; imports nothing from lib/capture
│   ├── detectors/
│   │   ├── index.ts               # registry: createRegistry, defaultRegistry, runDetectors
│   │   ├── all.ts                 # STATIC_DETECTOR_NAMES, createStaticRegistry(), runAllDetectors()
│   │   ├── fake-urgency.ts        # detectFakeUrgency
│   │   ├── fake-scarcity.ts       # detectFakeScarcity
│   │   ├── fake-activity.ts       # detectFakeActivity
│   │   ├── confirmshaming.ts      # detectConfirmshaming
│   │   ├── preselection.ts        # detectPreselection
│   │   ├── visual-interference.ts # detectVisualInterference
│   │   ├── shared/                # text, patterns, elements, samples, labels, parsers, colour, finding builder
│   │   └── data/                  # English and Turkish word lists, one file per detector family
│   ├── judge/                     # model judge (spec model-judge); pure except haiku.ts and config.ts
│   │   ├── types.ts               # reason codes, statuses, ReviewResult and its zod schemas, JudgeLogRecord
│   │   ├── schema.ts              # JudgeOutputSchema (zod) and the frozen JUDGE_OUTPUT_JSON_SCHEMA
│   │   ├── constants.ts           # every limit, price, id, timing and score; estimateCostUsd
│   │   ├── redact.ts              # redactText, isMostlyRedacted
│   │   ├── candidates.ts          # normaliseCandidateText, prepareCandidates, ruleKind, buildCandidates
│   │   ├── prompt.ts              # JUDGE_SYSTEM_PROMPT, encodePageData, buildUserMessage, buildJudgeRequest, buildRequestBody
│   │   ├── validate.ts            # validateOutput: ids, quote check, structure checks, reason families, anomalies
│   │   ├── templates.ts           # titles, reason sentences, description builders, set-aside heading
│   │   ├── summary.ts             # statusLine and its fixed sentences
│   │   ├── merge.ts               # mergeReview, assembleJudgeFinding: verdict powers, dedup, set-aside, ordering
│   │   ├── interface.ts           # JudgeClient seam, JudgeHttpError, toJudgeHttpError
│   │   ├── mock.ts                # createMockJudge, readPageData: deterministic client for tests
│   │   ├── config.ts              # readJudgeConfig(env), server-only
│   │   ├── review.ts              # reviewFindings, createCooldown, defaultCooldown, the log record
│   │   └── haiku.ts               # createHaikuClient: the only network and SDK code, server-only
│   ├── walker/
│   │   ├── walker.ts              # flow walker orchestrator
│   │   ├── decider.ts             # Decider interface
│   │   ├── model-decider.ts       # LLM Decider implementation
│   │   └── fallback-decider.ts    # scripted fallback
│   └── storage/
│       └── supabase.ts            # scan persistence and screenshot upload
├── tests/
│   ├── boo-tique/                 # page, safety and coverage tests, plus helpers/
│   ├── detectors/
│   │   ├── fake-urgency.test.ts
│   │   ├── fake-scarcity.test.ts
│   │   ├── fake-activity.test.ts
│   │   ├── confirmshaming.test.ts
│   │   ├── preselection.test.ts
│   │   ├── visual-interference.test.ts
│   │   ├── registry.test.ts       # createRegistry and runDetectors
│   │   ├── all.test.ts            # runAllDetectors wiring, fresh registry per call
│   │   ├── parsed-copies.test.ts  # runDetectors returns parsed copies of findings
│   │   ├── source-rules.test.ts   # no clock, random, locale case, stray regex, hook word or demo terms
│   │   ├── word-lists.test.ts     # list shape, generality, other languages
│   │   ├── hostile-input.test.ts  # bounds, invariance and wording on hostile snapshots
│   │   ├── wording.test.ts        # forbidden words by stem in every finding string, on the Boo-tique and hold-out snapshots
│   │   ├── detector-errors.test.ts # a throwing detector is reported in `errors`, never swallowed
│   │   ├── real-world-phrases.test.ts # every list entry occurs in the corpus; corpus texts are found
│   │   ├── shared/                # one test file per lib/detectors/shared file
│   │   ├── helpers/               # demo-terms.ts, real-world-phrases.ts, row-snapshots.ts
│   │   └── eval/                  # Boo-tique harness: helpers/, tree, snapshot-sync, score and boo-tique-eval tests; holdout.test.ts, holdout-eval.test.ts and helpers/holdout*.ts (hold-out evaluation)
│   ├── capture/
│   │   ├── extractor.test.ts
│   │   ├── collector-dom.test.ts  # collectInPage on real DOM (jsdom), including DOM clobbering
│   │   ├── browser-guard.test.ts  # real guard against the fake guard browser: order, verdicts, main-frame flag, service worker, limits, loss, heartbeat
│   │   ├── response-hardening.test.ts # response-stage rewrite against the fake guard browser
│   │   ├── guard-policy.test.ts   # policy and capped verdict cache with a fake resolver
│   │   ├── fake-guard-browser.test.ts # tests of the fake guard browser itself
│   │   ├── fake-cdp.test.ts       # tests of the fake page CDP session itself
│   │   ├── cdp.test.ts            # isolated world, page metrics, scrollbars
│   │   ├── capture-guards.test.ts # orchestrator: refused requests, warnings, host cache
│   │   ├── capture-guard-lost.test.ts # orchestrator fails closed on guard-lost
│   │   ├── outcome.test.ts        # toScanOutcome covers every error code, never leaks detail
│   │   ├── lib-text-rules.test.ts # no forbidden attribute word under lib/capture, lib/capture-fixture, app/capture-fixture, tests and specs
│   │   ├── helpers/               # fake-browser.ts, fake-guard-browser.ts, manual-clock.ts, fake-cdp.ts, forbidden-attribute.ts
│   │   ├── remote-capture.test.ts # opt-in live test, owner only, per-case gates (RUN_REMOTE_CAPTURE=1), skipped by default
│   │   └── ...                    # one test file per lib/capture file, plus capture-stop, capture-deadlines, capture-reload, dependencies, tracing-config
│   ├── capture-fixture/
│   │   ├── pages.test.ts          # fixture page builders
│   │   └── routes.test.ts         # fixture routes and their switch
│   ├── types/
│   │   ├── schemas.test.ts        # lib/types schemas
│   │   └── capture-meta.test.ts   # CaptureMeta, including httpStatus
│   ├── judge/
│   │   ├── schema.test.ts         # reason codes, statuses, result and output schemas, JSON Schema agreement
│   │   ├── constants.test.ts      # every constant, the cost ceiling, estimateCostUsd
│   │   ├── redact.test.ts         # redaction rules and the seeded property test
│   │   ├── candidates.test.ts     # eligibility, normalisation, labels, groups, places, facts
│   │   ├── candidates-rank.test.ts # parts, rule links, ranking, caps, ids
│   │   ├── prompt.test.ts         # encoding, prompt parts, user message, request body and its size
│   │   ├── validate.test.ts       # output validation, quote check, anomalies
│   │   ├── wording.test.ts        # titles start with "Possible", no forbidden word in any judge text
│   │   ├── summary.test.ts        # status lines for every status and list state
│   │   ├── merge.test.ts          # verdict powers, dedup, set-aside, by-construction test
│   │   ├── interface.test.ts      # toJudgeHttpError
│   │   ├── mock.test.ts           # the mock's scripts and readPageData
│   │   ├── config.test.ts         # readJudgeConfig
│   │   ├── review.test.ts         # orchestrator with a manual clock and timer
│   │   ├── review-log.test.ts     # one log record per scan, nothing sensitive in it
│   │   ├── injection.test.ts      # code-layer attacks A1 to A11 through reviewFindings and the mock
│   │   ├── source-rules.test.ts   # SDK only in haiku.ts, hook word absent, no clock or random, pinned dependency
│   │   ├── helpers/               # snapshot.ts (snapshot builders), harness.ts (manual clock and timer)
│   │   ├── eval/                  # build-case.ts, score.ts, fake-judges.ts and their tests, dev-eval.test.ts (rules-only regression, fake judges), replay.test.ts (recorded responses)
│   │   └── live/                  # judge-live.test.ts (opt-in, owner only, RUN_LIVE_JUDGE=1) and attacks.json (model-layer attack fixtures)
│   ├── walker/
│   │   └── walker.test.ts
│   └── fixtures/
│       ├── boo-tique-ground-truth.json  # copy of docs/research file, canonical pattern ids
│       ├── real-world-phrases.json      # corpus of real-world wording; every word-list entry must occur in it
│       ├── judge-eval/                  # dev split of the judge evaluation, its README and rules-only baseline (the sealed split is not in the repository)
│       ├── judge-dev-responses.json     # raw dev answers recorded by the owner's live run (RECORD_JUDGE_DEV=1); the replay test is skipped while it is absent
│       └── snapshots/                   # PageSnapshot fixtures per Boo-tique page
├── .kiro/
│   ├── steering/                  # these files
│   └── specs/                     # one sub-directory per feature spec
├── docs/
│   └── research/                  # pre-implementation notes (read-only)
├── .env.example
└── ...config files
```

## Naming conventions

- **Files:** kebab-case for all source files (`fake-urgency.ts`, `monster-badge.tsx`).
- **Components:** PascalCase exports (`MonsterBadge`, `FindingCard`).
- **Functions and variables:** camelCase.
- **Zod schemas:** PascalCase with a `Schema` suffix (`FindingSchema`, `PageSnapshotSchema`).
- **Types inferred from Zod:** PascalCase without suffix (`Finding`, `PageSnapshot`).
- **Detector files:** one file per detector, named after the pattern (`fake-urgency.ts`). Each static detector file exports one named pure function (`detectFakeUrgency` and so on) and has no default export and no import side effects; `lib/detectors/all.ts` registers them in a fixed order on a fresh registry per call and exposes `runAllDetectors`.
- **Test files:** the test for `lib/<area>/<name>.ts` is `tests/<area>/<name>.test.ts`. The test for `lib/<area>/index.ts` is `tests/<area>/<topic>.test.ts`, where `<topic>` names what the tests cover. Examples: `tests/types/schemas.test.ts` for `lib/types/index.ts` and `tests/detectors/registry.test.ts` for `lib/detectors/index.ts`.

## Specs

Each feature has its own spec directory under `.kiro/specs/<feature-name>/`, containing three files: `requirements.md`, `design.md` and `tasks.md`. See `specs.md` steering file for the required format. The spec `.kiro/specs/detectors-static/` covers all six static detectors.
