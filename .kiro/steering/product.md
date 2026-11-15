---
inclusion: always
---

# Product: Trick or Trap

## What it is

Trick or Trap is a web tool for detecting manipulative design patterns on online shops. The user pastes a shop URL; the app opens that URL in a real browser, runs a set of detectors, and returns a full-page screenshot with a monster badge pinned on each finding. Each badge links to a card that names the pattern, shows the on-page evidence, and states a confidence level.

The app has no accounts, no payments, and no rankings of shops. It does not run as a browser extension. It cannot scan login-walled pages. Results pages are not publicly indexable.

## The Boo-tique

The Boo-tique (`/boo-tique` route group) is a companion fake shop built into the same Next.js app. It is the primary demo target for the hackathon video and the ground-truth fixture for detector tests. Every planted dark pattern and every honest look-alike is recorded in `docs/research/boo-tique-ground-truth.json` with a stable `id`, route, pattern name, difficulty, and expected verdict (`flag` or `no-flag`). The Boo-tique uses a visibly distinct light theme (cream and blood-red) so viewers immediately know they are looking at the demo target.

## Phases

**Phase 1 — single-page patterns (five detector types, six pattern ids)**

| Pattern id | Monster |
|---|---|
| `fake-urgency` | Skeleton |
| `fake-scarcity` | Ghost |
| `fake-activity` | Ghost |
| `confirmshaming` | Witch |
| `preselection` | Spider |
| `visual-interference` | Mummy |

`fake-scarcity` and `fake-activity` share the Ghost monster because both exploit perceived shortage; they are separate pattern ids so detectors can be precise about which claim they observed.

**Phase 2 — flow patterns (walked only on The Boo-tique)**

| Pattern id | Monster |
|---|---|
| `sneak-into-basket` | Werewolf |
| `drip-pricing` | Vampire |
| `hard-to-cancel` | Zombie |

Phase 2 patterns are detected by the flow walker, which navigates the Boo-tique step by step and diffs cart lines and totals. Phase 2 is never run on third-party sites.

## Ground-truth fixture note

`docs/research/boo-tique-ground-truth.json` is a research draft that uses older short names (`urgency`, `scarcity`, `activity`). The test fixture created in the Boo-tique spec must use the canonical ids listed above. The value `none` is reserved for honest look-alike entries in the fixture only; it is not a valid `PatternId`.

## Non-goals

- No browser extension.
- No user accounts or login.
- No payment processing.
- No scanning of login-walled pages.
- No shop rankings or league tables.
- Result pages are not indexable by search engines.
