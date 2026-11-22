# Changelog

All notable changes to this project are recorded here. The format is based on Keep a Changelog 1.1.0. The project is pre-1.0 and is not published to a package registry (`"private": true` in `package.json`).

## [Unreleased]

### Added

- Add the model judge in `lib/judge`: a small language model (Claude Haiku 5.5) reviews the page elements and the rule findings of a scan. It is behind the switch `JUDGE_MODE` (`off`, `gateway` or `anthropic`), off by default, and no route calls it yet. Spec `model-judge`.
- Add a mock judge client, fake judges and an evaluation harness over the independent dev set (`tests/fixtures/judge-eval/dev.json`). The judge has not been run against a real model.

### Security

- Do not send candidates a shopper cannot see (off-screen, tiny, faint or hidden by an ancestor), and keep hidden text out of the text of visible elements.
- Cap the judge's downgrades of rule findings.
- Accept only the stop reasons `end_turn` and `stop_sequence`. Any other stop reason gives an unusable answer and the rule findings stand.
- Redact candidate text (emails, links, long numbers and handles) before it is cut to length, so that a cut cannot leave part of a redacted item.

## [0.1.0] - 2026-11-21

Work before pull request #11 was committed directly to `main`. Pull request #13 holds two specs (`page-capture` and `page-capture-fixes`); #12 was closed unmerged in its favour.

### Added

- Add the Next.js App Router project in TypeScript strict mode with Tailwind CSS and Vitest.
- Add shared types validated with zod (`PageSnapshot`, `Finding`).
- Add the detector interface and registry.
- Add the static pages of the demo shop under `/boo-tique`: home, product, cart, checkout, club and subscription.
- Add the ground-truth fixture of planted dark patterns and honest look-alikes, with tests that prove each entry is planted on its page.
- Add page capture through a remote browser: URL, port and address checks, a DNS check, an element snapshot with boxes and styles, screenshots and a second sample after a reload (#13).
- Add the browser-level request guard, which sees the requests of every target and checks each redirect hop (#14).
- Add optional WebSocket hardening to the request guard (#14).
- Add test-only fixture routes under `/capture-fixture` and extend the opt-in remote-browser test (#14).
- Run the collector in an isolated world (#13).
- Read DOM properties through prototypes so that DOM clobbering cannot change what the collector reads (#14).
- Add six rule-based detectors: fake urgency, fake scarcity, fake activity, confirmshaming, preselection and visual interference, with English and Turkish word lists (#16).
- Add an evaluation of the detectors against the demo shop's ground truth (#16).
- Add a corpus of real-world phrases that every word-list entry must occur in, and a hold-out evaluation (#16).
- Add a test of the wording of every finding, with forbidden words matched by stem (#16).
- Add `SECURITY.md` with private vulnerability reporting (2026-11-17).
- Add a CI workflow that runs lint, type check, tests and a production build, and scans the full history for secrets with a pinned, checksum-verified gitleaks (2026-11-17).
- Add an opt-in pre-commit secret scan, enabled with `npm run hooks:enable` (2026-11-17).
- Add the workflow steering file: one spec, one branch, one pull request, merged with a merge commit (#11).
- Add issue and pull request templates (#11).
- Add the save hook that runs only the tests related to a saved source file (#11).
- Add woodcut monster plates and stamps, the landing hero, two spot illustrations and the Boo-tique product images (committed directly on 2026-11-17).
- Add the README artwork and five redrawn monster plates: werewolf, vampire, zombie, spider and mummy (#18).
- Rewrite the README and add this changelog.

### Changed

- Round `foundation-fixes` (2026-11-16): add a registry factory, named detector registration, and a failing detector reported as an error instead of hiding the others.
- Round `boo-tique-polish` (2026-11-17): answer the 16 problems found by an independent review (15 fixed, one left by an owner decision), such as an expired date on an honest sale, cookie banners that clipped on narrow screens, and prices and totals taken from one source so that summary rows add up to the total.
- Mark the demo shop as non-indexable.
- First fixes round for capture: redirect hops and sub-resources go through a request guard, and refused requests are reported as one warning (#13).
- Restore common real-world phrases to the word lists, and report a detector that throws as an error instead of as "no finding" (#16).
- Make the builder agent profile deny Kiro writes to infrastructure paths (2026-11-17).
- Refresh the steering files: the monster for each pattern (Bats for fake activity, nine monsters), the path of the ground-truth fixture, and the artwork licensing.

### Security

- Fail closed when the guard is lost: the session is stopped and no snapshot or image is returned (#14).
- Refuse service-worker scripts (#14).
- Add a gitleaks rule for Browser Use Cloud keys (#11).

[Unreleased]: https://github.com/SelcukOzbilgi/trick-or-trap/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/SelcukOzbilgi/trick-or-trap/releases/tag/v0.1.0
