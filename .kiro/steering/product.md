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

**Phase 1 — single-page patterns (five detector types)**

| Pattern | Monster |
|---|---|
| Fake urgency | Skeleton |
| Fake scarcity or fake activity | Ghost |
| Confirmshaming | Witch |
| Preselected paid or consent options | Spider |
| Visual interference | Mummy |

**Phase 2 — flow patterns (walked only on The Boo-tique)**

| Pattern | Monster |
|---|---|
| Sneak into basket | Werewolf |
| Drip pricing | Vampire |
| Hard to cancel | Zombie |

Phase 2 patterns are detected by the flow walker, which navigates the Boo-tique step by step and diffs cart lines and totals. Phase 2 is never run on third-party sites.

## Non-goals

- No browser extension.
- No user accounts or login.
- No payment processing.
- No scanning of login-walled pages.
- No shop rankings or league tables.
- Result pages are not indexable by search engines.
