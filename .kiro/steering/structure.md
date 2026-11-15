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
│   └── (boo-tique)/               # route group – Boo-tique fake shop
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
│   ├── capture/
│   │   ├── browser.ts             # getBrowser() with three modes
│   │   └── extractor.ts           # page.evaluate script → PageSnapshot
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
│   ├── detectors/
│   │   ├── fake-urgency.test.ts
│   │   ├── fake-scarcity.test.ts
│   │   ├── confirmshaming.test.ts
│   │   ├── preselection.test.ts
│   │   └── visual-interference.test.ts
│   ├── capture/
│   │   └── extractor.test.ts
│   ├── walker/
│   │   └── walker.test.ts
│   └── fixtures/
│       ├── boo-tique-ground-truth.json  # copy of docs/research file
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
- **Test files:** mirror the `lib/` path under `tests/`, with a `.test.ts` suffix.

## Specs

Each feature has its own spec directory under `.kiro/specs/<feature-name>/`, containing `requirements.md` and `tasks.md`. See `specs.md` steering file for the required format. Detectors get individual specs (e.g. `.kiro/specs/detector-fake-urgency/`).
