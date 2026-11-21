# Changelog

All notable changes to this project are recorded here. The format follows Keep a Changelog 1.1.0. The project is pre-1.0 and is not published to a package registry (`"private": true` in `package.json`).

## [Unreleased]

- Rewrite the README and add this changelog.

## [0.1.0] - 2026-11-21

Work before pull request #11 was committed directly to `main`. The pull request flow starts at #11. Pull requests #13 and #14 also contain earlier branch history.

### Foundation and types

- Add the Next.js App Router project in TypeScript strict mode with Tailwind CSS and Vitest.
- Add shared types validated with zod (`PageSnapshot`, `Finding`).
- Add the detector registry, which runs every detector and reports a failing detector as an error instead of hiding it.
- Add the `foundation-fixes` round (2026-11-16): a registry factory and named detector registration.

### The Boo-tique demo shop

- Add the static pages of the demo shop under `/boo-tique`: home, product, cart, checkout, club and subscription.
- Add the ground-truth fixture of planted dark patterns and honest look-alikes, with tests that prove each entry is planted on its page.
- Add the `boo-tique-polish` round (2026-11-16 and 2026-11-17): fix 16 problems found by an independent review, such as an expired date on an honest sale, cookie banners that clipped on narrow screens, and prices and totals now taken from one source so that summary rows add up to the total.
- Mark the demo shop as non-indexable.

### Repository security and CI (2026-11-17)

- Add `SECURITY.md` with private vulnerability reporting.
- Add a CI workflow that runs lint, type check, tests and a production build, and scans the full history for secrets with a pinned, checksum-verified gitleaks.
- Add an opt-in pre-commit secret scan, enabled with `npm run hooks:enable`.
- Make the builder agent profile deny Kiro writes to infrastructure paths.

### Page capture and its two review rounds

- Add page capture through a remote browser: URL, port and address checks, a DNS check, an element snapshot with boxes and styles, screenshots and a second sample after a reload (#13).
- Add the first fixes round for capture: every browser request is checked, and refused requests are reported as one warning (#13).
- Add the browser-level request guard, which sees the requests of every target and checks each redirect hop (#14).
- Fail closed when the guard is lost: the session is stopped and no snapshot or image is returned (#14).
- Refuse service-worker scripts and add optional WebSocket hardening (#14).
- Run the collector in an isolated world so that page scripts and DOM clobbering cannot change what it reads (#14).
- Add test-only fixture routes under `/capture-fixture` and extend the opt-in remote-browser test (#14).

### Static detectors and their fix round

- Add six rule-based detectors: fake urgency, fake scarcity, fake activity, confirmshaming, preselection and visual interference, with English and Turkish word lists (#16).
- Add an evaluation of the detectors against the demo shop's ground truth (#16).
- Restore common real-world phrases, add a corpus that every word-list entry must occur in, and add a hold-out evaluation (#16).
- Match forbidden words by stem and add a test of the wording of every finding (#16).
- Report a detector that throws as an error instead of as "no finding" (#16).

### Pull request flow, templates and hook

- Add the workflow steering file: one spec, one branch, one pull request, merged with a merge commit (#11).
- Add issue and pull request templates (#11).
- Add the save hook that runs only the tests related to a saved source file (#11).

### Artwork

- Add woodcut monster plates and stamps, the landing hero, two spot illustrations and the Boo-tique product images (committed directly on 2026-11-17).
- Add the README artwork and five redrawn monster plates: werewolf, vampire, zombie, spider and mummy (#18).

[Unreleased]: https://github.com/SelcukOzbilgi/trick-or-trap/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/SelcukOzbilgi/trick-or-trap/releases/tag/v0.1.0
