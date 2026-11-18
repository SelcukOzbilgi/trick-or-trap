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
│   │   ├── fake-urgency.ts
│   │   ├── fake-scarcity.ts
│   │   ├── confirmshaming.ts
│   │   ├── preselection.ts
│   │   └── visual-interference.ts
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
│   │   ├── confirmshaming.test.ts
│   │   ├── preselection.test.ts
│   │   └── visual-interference.test.ts
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
│   ├── walker/
│   │   └── walker.test.ts
│   └── fixtures/
│       ├── boo-tique-ground-truth.json  # copy of docs/research file, canonical pattern ids
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
- **Detector files:** one file per detector, named after the pattern (`fake-urgency.ts`). The default export is the detector function.
- **Test files:** the test for `lib/<area>/<name>.ts` is `tests/<area>/<name>.test.ts`. The test for `lib/<area>/index.ts` is `tests/<area>/<topic>.test.ts`, where `<topic>` names what the tests cover. Examples: `tests/types/schemas.test.ts` for `lib/types/index.ts` and `tests/detectors/registry.test.ts` for `lib/detectors/index.ts`.

## Specs

Each feature has its own spec directory under `.kiro/specs/<feature-name>/`, containing three files: `requirements.md`, `design.md` and `tasks.md`. See `specs.md` steering file for the required format. Detectors get individual specs (e.g. `.kiro/specs/detector-fake-urgency/`).
