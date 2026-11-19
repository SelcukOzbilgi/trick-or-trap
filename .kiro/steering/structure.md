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
│   └── boo-tique/                 # real segment – Boo-tique fake shop (a route group would put its page at /)
│       ├── layout.tsx             # light theme override
│       ├── page.tsx               # home with hero, cookie banner, countdown
│       ├── product/[slug]/
│       │   └── page.tsx           # product page (stock, activity, upsell)
│       ├── cart/
│       │   └── page.tsx           # cart (preselection patterns)
│       ├── checkout/
│       │   └── page.tsx           # checkout (drip pricing, newsletter)
│       ├── club/
│       │   └── page.tsx           # club (confirmshaming, timer)
│       └── account/
│           └── subscription/
│               └── page.tsx       # subscription cancel maze
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
│   │   ├── extractor.ts           # page.evaluate script → PageSnapshot
│   │   ├── capture.ts             # capturePage() orchestrator
│   │   ├── types.ts               # error and warning codes, CaptureResult, CaptureFailure, raw page types
│   │   ├── constants.ts           # named deadlines and limits
│   │   ├── redact.ts              # redactText, toDetail
│   │   ├── clock.ts               # Clock, Deadline, withTimeout
│   │   ├── config.ts              # env parsing (server-only)
│   │   ├── ip-ranges.ts           # IP parsing and blocked ranges
│   │   ├── url-check.ts           # checkUrlSyntax, checkUrl, Resolver
│   │   ├── resolver.ts            # default DNS Resolver
│   │   ├── seam.ts                # browser seam interfaces, no Playwright types
│   │   ├── browser-use-api.ts     # Browser Use create and stop calls
│   │   ├── remote-browser.ts      # BrowserProvider over CDP; the only file importing playwright-core
│   │   ├── cdp.ts                 # CdpSession interface, isolated-world calls, page metrics, scrollbars
│   │   ├── guard-types.ts         # request guard types: GuardVerdict, RequestGuardEvent, RequestPolicy
│   │   ├── request-guard.ts       # installRequestGuard: CDP Fetch interception, child targets, host limit
│   │   ├── geometry.ts            # pure maths: boxes, mode choice, tiles, sizes
│   │   └── screenshots.ts         # captureImages: single or tiled screenshots
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
│   ├── judge/
│   │   ├── interface.ts           # Judge interface
│   │   ├── haiku.ts               # Claude Haiku 5.5 implementation
│   │   └── mock.ts                # deterministic mock for tests
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
│   │   ├── collector-dom.test.ts  # collectInPage on real DOM (jsdom)
│   │   ├── request-guard.test.ts  # real guard against a fake CDP session
│   │   ├── cdp.test.ts            # isolated world, page metrics, scrollbars
│   │   ├── capture-guards.test.ts # orchestrator: refused requests, warnings, host cache
│   │   ├── lib-text-rules.test.ts # no forbidden attribute word under lib/capture, tests and specs
│   │   ├── helpers/               # fake-browser.ts, manual-clock.ts, fake-cdp.ts, forbidden-attribute.ts
│   │   ├── remote-capture.test.ts # opt-in live test (RUN_REMOTE_CAPTURE=1), skipped by default
│   │   └── ...                    # one test file per lib/capture file, plus capture-stop, capture-deadlines, capture-reload
│   ├── walker/
│   │   └── walker.test.ts
│   └── fixtures/
│       ├── boo-tique-ground-truth.json  # copy of docs/research file, canonical pattern ids
│       ├── real-world-phrases.json      # corpus of real-world wording; every word-list entry must occur in it
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
