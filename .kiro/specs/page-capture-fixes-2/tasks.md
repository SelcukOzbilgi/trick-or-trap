# Tasks: Page Capture Fixes 2

Rules for every task:

- Each top-level task runs in its own run. Read `requirements.md` and `design.md` of this spec first, then the files the task names. Earlier tasks are done.
- Allowed commands: `npx vitest run <one test file> --maxWorkers=2`, `npx tsc --noEmit`, `npm run lint` (task 18 only) and, in task 16 only, `npm install --save-dev --save-exact jpeg-js@0.4.4`. No build, dev server, watch mode, full suite, command chaining or redirection. Use the file tools for file work.
- Run only the test files the task touches, then `npx tsc --noEmit`. The tree must compile and the touched tests must pass when the task ends. Never run `tests/capture/remote-capture.test.ts`.
- Write the test first, then the code. No JSX in tests, no real network. A test that imports a `server-only` module starts with `vi.mock("server-only", () => ({}))`. Never edit `vitest.config.ts`.
- `playwright-core` stays imported only in `lib/capture/remote-browser.ts`, with `await import(...)` in the connect function. No test imports it.
- Never write the name of the test-id attribute; build it with `tests/capture/helpers/forbidden-attribute.ts`. Never read or write `.env` files. Touch no path listed as out of scope.
- Do not weaken a test. A test that pins a now-wrong behaviour may change only where the task names it.

- [x] 1. Faithful fake of the guard session and its browser
  - [x] 1.1 Add `GuardSession`, `GuardBrowser` and `GuardLossCause` to `lib/capture/guard-types.ts` (types only, as in `design.md`).
  - [x] 1.2 Create `tests/capture/fake-guard-browser.test.ts` first: `send` with three arguments throws and records a violation; `params.sessionId` throws; `Network.setBlockedURLs`, `Page.getFrameTree`, `Runtime.evaluate` and `Emulation.setScrollbarsHidden` reject with `'<method>' wasn't found`; `Browser.getVersion` and `Fetch.*` answer; paused events of every source arrive on the one session with `frameId`, `resourceType`, headers and `redirectedRequestId`; an unanswered request stays pending; an unknown or second answer rejects with `Invalid InterceptionId`; `detach()` and `dropConnection()` record pending requests as gone out and emit `close` (and `disconnected` for the drop); a deliberately wrong guard that passes a third argument makes `assertNoViolations()` throw.
  - [x] 1.3 Create `tests/capture/helpers/fake-guard-browser.ts` implementing `GuardBrowser` with that behaviour, scripted answers per method (value, `Error`, `"hang"`), and `assertNoViolations()`.
  - [x] 1.4 Run `npx vitest run tests/capture/fake-guard-browser.test.ts --maxWorkers=2`, then `npx tsc --noEmit`.
  _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 11.8, 11.9_

- [x] 2. Guard reason codes and the `guard-lost` error
  - [x] 2.1 Extend `tests/capture/types.test.ts` first: 25 error codes with `guard-lost` and its fixed message (different from `connect-failed`); `GuardReasonCode` values; `CaptureWarning.reason` accepts `service-worker-blocked`.
  - [x] 2.2 Edit `lib/capture/types.ts` (`GuardReasonCode`, `guard-lost`, the internal-only comment on `CaptureError.detail`), `lib/capture/guard-types.ts` (reasons become `GuardReasonCode`) and `lib/capture/capture.ts` (type of the first refused reason).
  - [x] 2.3 Run `types.test.ts`, `capture-guards.test.ts`, then `npx tsc --noEmit`.
  _Requirements: 4.11, 14.6_

- [x] 3. Public "could not scan" outcome
  - [x] 3.1 Create `tests/capture/outcome.test.ts` first: a hard-coded list of all 25 error codes equals `Object.keys(ERROR_MESSAGES)` sorted; each maps to `could-not-scan` with its reason and fixed message; a failure whose `detail` holds a sentinel gives JSON without it and no `detail`, `snapshot`, `images` or `findings` key; success maps to `captured`; `expectTypeOf` shows the failure arm has no `detail`.
  - [x] 3.2 Add `ScanOutcome` and `CouldNotScanReason` to `lib/capture/types.ts`; create `lib/capture/outcome.ts`.
  - [x] 3.3 Run `outcome.test.ts`, then `npx tsc --noEmit`.
  _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 14.7, 14.8_

- [x] 4. Browser-level guard module (beside the old guard)
  - [x] 4.1 Create `tests/capture/browser-guard.test.ts` first, with the fake guard browser, the manual clock and an `afterEach` calling `assertNoViolations()`: handlers before the first send; exactly one `Fetch.enable` with the request-stage pattern; a hanging `Fetch.enable` keeps the install pending; a rejecting open or enable rejects; the old cases moved from `request-guard.test.ts` (continue, refuse, redirect hop, pass-through schemes, `ftp:`, host cache, 101st non-document host refused with `url-host-blocked`, timeout and throw refused); main-frame flag for `Document` with the main frame id, `false` for another frame id and for a worker `Fetch` carrying the main frame id; fallback `failRequest` after a rejected answer; `Service-Worker: script` in any header case refused with `service-worker-blocked` and no policy call, another value decided normally; `onLost` once for `close`, `disconnected` and a heartbeat that rejects or misses `GUARD_HEARTBEAT_TIMEOUT_MS`; one heartbeat in flight; nothing after `stopWatching()`; no `Target.*`, `Runtime.*` or `Network.*` call.
  - [x] 4.2 Create `lib/capture/browser-guard.ts` (`installBrowserGuard`, verdict logic ported from `request-guard.ts`, heartbeat on `clock.setTimer`); add the two heartbeat constants to `lib/capture/constants.ts` and `tests/capture/constants.test.ts`. Do not edit `request-guard.ts` or `remote-browser.ts`.
  - [x] 4.3 Run `browser-guard.test.ts`, `constants.test.ts`, then `npx tsc --noEmit`.
  _Requirements: 1.3, 1.4, 1.7, 1.8, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 2.11, 3.1, 3.2, 3.4, 5.1, 5.2, 5.3, 5.4, 5.5, 11.10_

- [x] 5. Orchestrator fails closed on `guard-lost`
  - [x] 5.1 Create `tests/capture/capture-guard-lost.test.ts` first, with the fake browser and manual clock: `guard-lost` emitted during `goto` (hanging), `collect`, screenshots, the drift re-read and the reload sample each gives `ok: false`, `guard-lost`, no snapshot or images, without waiting for the hanging stage; the stop starts before the stage settles and is called once; a loss after the last stage still gives `guard-lost`; earlier warning codes are kept; `guard-lost` is not a warning code.
  - [x] 5.2 Edit `lib/capture/seam.ts` (`guard-lost` in `GuardEvent`), `tests/capture/helpers/fake-browser.ts` and `lib/capture/capture.ts` (lost promise raced in `step`, immediate shared stop, rethrow in `takeReloadSample` and `checkLayoutDrift`, final flag check).
  - [x] 5.3 Run `capture-guard-lost.test.ts`, `capture-stop.test.ts`, `capture-reload.test.ts`, `fake-browser.test.ts`, then `npx tsc --noEmit`.
  _Requirements: 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.12_

- [x] 6. Remote adapter on the browser-level guard; child code removed
  - [x] 6.1 Create `tests/capture/fake-cdp.test.ts` first (three arguments and `params.sessionId` throw and record a violation). Edit `tests/capture/helpers/fake-cdp.ts`: two-argument `send`, `violations`, `assertNoViolations()`, no `targetSessionId`.
  - [x] 6.2 Rewrite the guard cases of `tests/capture/remote-browser.test.ts` first: the Playwright fake gains `newBrowserCDPSession()` (the fake guard browser) and `on("disconnected")`; `installGuards` reads `Page.getFrameTree` on the page session, then opens the guard session, then `Fetch.enable`; `page.goto` is not called while `Fetch.enable` hangs; a failing frame-tree read, open or enable gives `connect-failed` without any secret; guard `close` or `disconnected` reports `guard-lost`; neither does after `stop()` started; stop sends the `PATCH` then `browser.close()` and never `detach`; downloads and popups still report. Remove the cases that pin `Network.setBypassServiceWorker`, `Target.setAutoAttach` or a third `send` argument (named here as removed).
  - [x] 6.3 Edit `lib/capture/cdp.ts` (`CdpSession` with `send` only) and `lib/capture/remote-browser.ts` (`GuardBrowser` view of the browser, `installBrowserGuard`, loss to `guard-lost`, `stopWatching` in `stop`). Delete `lib/capture/request-guard.ts` and `tests/capture/request-guard.test.ts`. Update `tests/capture/cdp.test.ts` where it used `onEvent` or a third argument.
  - [x] 6.4 Run `fake-cdp.test.ts`, `remote-browser.test.ts`, `cdp.test.ts`, `browser-guard.test.ts`, `capture-guards.test.ts`, then `npx tsc --noEmit`.
  _Requirements: 1.1, 1.2, 1.5, 1.6, 1.7, 1.8, 1.9, 1.10, 1.11, 4.1, 4.2, 4.9, 4.10, 11.1, 11.2, 11.11_

- [x] 7. Response-stage WebSocket hardening in the guard
  - [x] 7.1 Extend the fake guard browser and its test first: response-stage events, `Fetch.getResponseBody`, `Fetch.fulfillRequest`, and `Fetch.continueResponse` that rejects headers without `responseCode`.
  - [x] 7.2 Create `tests/capture/response-hardening.test.ts` first: every branch of "WebSocket hardening" in `design.md` (3xx, error reason, `Document`, `Other` with `javascript` and `ecmascript`, other types, `Content-Length` and decoded size over the cap, non-base64 body, timeout, rejected read or fulfil, header removal in any case, repeated `Set-Cookie` kept, no `continueResponse`). Extend `browser-guard.test.ts`: three patterns with hardening, one without; a refused main-frame document reports `mainFrame: true`; every response refusal reports `request-blocked` and sends `failRequest`.
  - [x] 7.3 Create `lib/capture/response-hardening.ts`; edit `browser-guard.ts` (option `hardening`, response hand-off, the residual-risk header of requirement 18) and `constants.ts` (`MAX_REWRITE_BODY_BYTES`, `HARDENING_CSP`) with `constants.test.ts`.
  - [x] 7.4 Run `fake-guard-browser.test.ts`, `response-hardening.test.ts`, `browser-guard.test.ts`, `constants.test.ts`, then `npx tsc --noEmit`.
  _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9, 6.10, 6.11, 6.12, 6.13, 6.14, 6.15, 18.1, 18.2, 18.3, 18.4, 18.5, 18.6_

- [ ] 8. Hardening switch in configuration and adapter
  - [ ] 8.1 Extend `tests/capture/config.test.ts` first (unset and empty give `on`; `on` and `off` accepted; `yes` gives `config-invalid` naming only the variable; `.env.example` has the line and a comment stating `on`) and `remote-browser.test.ts` (patterns follow the setting; absent setting means on).
  - [ ] 8.2 Edit `lib/capture/config.ts` (optional `websocketHardening`), `lib/capture/remote-browser.ts` and `.env.example` (add only the new line and its comment).
  - [ ] 8.3 Run `config.test.ts`, `remote-browser.test.ts`, then `npx tsc --noEmit`.
  _Requirements: 3.3, 7.1, 7.2, 7.3, 7.4, 7.5_

- [ ] 9. Host and DNS budget, capped verdict cache
  - [ ] 9.1 Create `tests/capture/guard-policy.test.ts` first (cache reuse; at `MAX_VERDICT_CACHE_ENTRIES` a new origin is refused with `host-limit-reached` and no resolver call; the input URL check uses the same cache). Extend `browser-guard.test.ts`: documents refused at 300 distinct hosts and non-documents at 100, both with `host-limit-reached`, one `request-host-limit` report; change the case that pins `url-host-blocked` for the limit (named here).
  - [ ] 9.2 Create `lib/capture/guard-policy.ts` from the policy code in `capture.ts`; edit `capture.ts` to use it, `browser-guard.ts` for the limits, `constants.ts` and `constants.test.ts`.
  - [ ] 9.3 Run `guard-policy.test.ts`, `browser-guard.test.ts`, `capture-guards.test.ts`, `capture.test.ts`, `constants.test.ts`, then `npx tsc --noEmit`.
  _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7_

- [ ] 10. Collector against DOM clobbering
  - [ ] 10.1 Extend `tests/capture/collector-dom.test.ts` first: for each name of 9.3 a form with such an input and a text span; assert first that the member is shadowed (else shadow it with `Object.defineProperty` on the form, as `design.md` says); the collector does not throw, collects the form's eligible elements and the span text; the `String(collectInPage)` source check still holds.
  - [ ] 10.2 Edit `lib/capture/extractor.ts`: capture every getter and method of the table in `design.md` at the start of `collectInPage` and use them with `.call`; no named inner function.
  - [ ] 10.3 Run `collector-dom.test.ts`, `extractor.test.ts`, `cdp.test.ts`, then `npx tsc --noEmit`.
  _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7_

- [ ] 11. Session listing with `filterBy=active` and paging
  - [ ] 11.1 Edit `tests/capture/browser-use-api.test.ts` first: replace the pinned `?status=active` URL (now wrong, named here) with the exact URLs of 10.1 and 10.2; paging stops on empty `items`, on `n × 100 >= totalItems`, on a missing `totalItems` and at `SESSION_LIST_MAX_PAGES`; no stop before the last page; a failing page keeps earlier selections; the counts cover all pages and hold no id; the existing never-reject and untagged cases stay.
  - [ ] 11.2 In `tests/capture/remote-browser.test.ts`, change the reclaim expectation from `?status=active` to the 10.1 URL (named here).
  - [ ] 11.3 Edit `lib/capture/browser-use-api.ts` (`activeSessionsUrl`, paging) and `constants.ts` with `constants.test.ts`.
  - [ ] 11.4 Run `browser-use-api.test.ts`, `remote-browser.test.ts`, `constants.test.ts`, then `npx tsc --noEmit`.
  _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 10.8, 10.9, 10.10, 10.11_

- [ ] 12. HTTP status through the seam
  - [ ] 12.1 Extend `remote-browser.test.ts` first: `goto` and `reload` fakes returning `{ status: () => 404 }`, `null`, `600` and a throwing `status` give `status` 404 or none.
  - [ ] 12.2 Edit `lib/capture/seam.ts` (optional `status`), `lib/capture/remote-browser.ts` and `tests/capture/helpers/fake-browser.ts` (script option for the status) with `fake-browser.test.ts`.
  - [ ] 12.3 Run `remote-browser.test.ts`, `fake-browser.test.ts`, then `npx tsc --noEmit`.
  _Requirements: 12.1, 12.2, 12.3_

- [ ] 13. Status warning, `httpStatus` and the reload check
  - [ ] 13.1 Extend first: `tests/types/capture-meta.test.ts` (`httpStatus` absent, 100, 599 accepted; 99, 600, 200.5 rejected), `tests/capture/types.test.ts` (14 warning codes), `capture.test.ts` (404 gives `http-error-status` and `capture.httpStatus` 404; 200 and absent give none) and `capture-reload.test.ts` (URL change, reload 500, 11 against 750 give `reload-differs` with `afterReload` kept; 40 against 10 and 100 against 300 give none).
  - [ ] 13.2 Edit `lib/types/index.ts`, `lib/capture/types.ts`, `lib/capture/capture.ts`, `constants.ts` with `constants.test.ts`.
  - [ ] 13.3 Run the four test files, `constants.test.ts`, `npx vitest run tests/types/schemas.test.ts --maxWorkers=2`, then `npx tsc --noEmit`.
  _Requirements: 12.4, 12.5, 12.6, 12.7, 12.8, 13.1, 13.2, 13.3, 13.4, 13.5_

- [ ] 14. Fixture page builders
  - [ ] 14.1 Create `tests/capture-fixture/pages.test.ts` first: each builder's HTML has the robots meta tag and the result list; the main page holds every source of the fixture table with its own tag from `FIXTURE_TAGS`; the cross-site frame appears only for an `https` alt origin; the frame posts `loaded`; scripts fetch their tag first; no output holds the test-id attribute or any `data-` attribute; the source of `pages.ts` imports nothing from `lib/capture`.
  - [ ] 14.2 Create `lib/capture-fixture/pages.ts` (`FIXTURE_FORBIDDEN_ORIGIN`, `FIXTURE_TAGS`, `readFixtureEnv`, builders, `fixtureResponse`).
  - [ ] 14.3 Run `npx vitest run tests/capture-fixture/pages.test.ts --maxWorkers=2`, then `npx tsc --noEmit`.
  _Requirements: 15.4, 15.7, 15.8, 15.9, 15.10, 15.11, 15.13, 15.14_

- [ ] 15. Fixture routes behind their switch
  - [ ] 15.1 Create `tests/capture-fixture/routes.test.ts` first: each route's `GET` with the switch unset, `off` and `On` gives 404 and an empty body; with `on` gives 200 (302 for the redirect), `X-Robots-Tag` and `Cache-Control` as required; `dynamic` is `"force-dynamic"`.
  - [ ] 15.2 Create the route files of `design.md` under `app/capture-fixture/`. Add `CAPTURE_FIXTURE_ROUTES=` and `CAPTURE_FIXTURE_ALT_ORIGIN=` with one comment each to `.env.example`. Add `lib/capture-fixture`, `app/capture-fixture` and `.kiro/specs/page-capture-fixes-2` to `DIRECTORIES` in `tests/capture/lib-text-rules.test.ts`.
  - [ ] 15.3 Run `routes.test.ts`, `lib-text-rules.test.ts`, then `npx tsc --noEmit`.
  _Requirements: 15.1, 15.2, 15.3, 15.5, 15.6, 15.12, 19.8_

- [ ] 16. Live-test support: gesture control and pixel decoder
  - [ ] 16.1 Extend `tests/capture/dependencies.test.ts` first (`jpeg-js` exactly `0.4.4` in `devDependencies`; runtime dependencies unchanged; no file under `lib/` or `app/` mentions `jpeg-js`). Run it, then run the one allowed install. If the install fails, stop and report.
  - [ ] 16.2 Extend `remote-browser.test.ts` first: `onPageReady` is called once with a control whose `callWithGesture("openFixturePopups")` sends `Runtime.evaluate` with `userGesture: true` on the page session; `"a.b"`, `"x()"` and a 65-character name reject with no CDP call; a failing call rejects without secrets; without `onPageReady` no `Runtime.evaluate` is sent. Extend `tests/capture/browser.test.ts`: `getBrowser` passes no `onPageReady`.
  - [ ] 16.3 Edit `lib/capture/remote-browser.ts` and `constants.ts` (`GESTURE_FUNCTION_NAME`) with `constants.test.ts`.
  - [ ] 16.4 Run `dependencies.test.ts`, `remote-browser.test.ts`, `browser.test.ts`, `constants.test.ts`, then `npx tsc --noEmit`.
  _Requirements: 16.1, 16.2, 16.3, 16.4, 16.5, 16.6, 16.7, 16.8_

- [ ] 17. Opt-in live test rewrite (written, never run)
  - [ ] 17.1 Edit `tests/capture/remote-capture.test.ts`: per-case gates of `design.md` instead of the whole-file skip; header comment with every variable and the owner's run command; keep the Boo-tique assertions and the redirect case; drop the half-width alignment case and the `LIVE_IFRAME_TEST_URL` case.
  - [ ] 17.2 Add the fixture cases of the live-test table: adapter-level guard coverage with a recording wrapper around `createGuardPolicy`, `callWithGesture` for popups, results read from snapshot text; cross-site case; fixture redirect; alignment with `jpeg-js` red-pixel bounds; clobbering; stopped-and-not-listed with a known capture id. Stop every session in a `finally`; print no secret.
  - [ ] 17.3 Do not run the file. Run `npx tsc --noEmit`.
  _Requirements: 17.1, 17.2, 17.3, 17.4, 17.5, 17.6, 17.7, 17.8, 17.9, 17.10, 17.11, 17.12, 17.13, 17.14, 17.15, 17.16, 17.17, 17.18, 17.19, 17.20_

- [ ] 18. Steering notes, `.env.example` and lint
  - [ ] 18.1 In `.env.example`, fix the `NEXT_PUBLIC_APP_URL` comment (public origin, bypasses no capture check) and add `LIVE_FIXTURE_BASE_URL=` and `LIVE_FIXTURE_ALT_BASE_URL=` with one comment each; change no other line.
  - [ ] 18.2 In `.kiro/steering/structure.md`, fix the `extractor.ts` line, replace `request-guard.ts` with `browser-guard.ts`, add `guard-policy.ts`, `response-hardening.ts`, `outcome.ts`, `lib/capture-fixture/`, `app/capture-fixture/` and the new test files and helpers.
  - [ ] 18.3 In `.kiro/steering/tech.md`, replace the request-guard paragraph with the browser-level guard, fail-closed loss, heartbeat, service-worker refusal and hardening switch; replace the residual-risk sentence with the list of requirement 18 and the egress-proxy recommendation; add the live-test variables and the fixture routes with their switch. Delete only statements this spec made wrong.
  - [ ] 18.4 Run `lib-text-rules.test.ts`, `config.test.ts`, then `npm run lint` (fix findings only in files this spec touched), then `npx tsc --noEmit`.
  _Requirements: 19.1, 19.2, 19.3, 19.4, 19.5, 19.6, 19.7, 19.9_
