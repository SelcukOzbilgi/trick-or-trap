# Requirements: Page Capture Fixes 2

This spec fixes the findings N1 to N9 of the second review (`docs/research/page-capture-review-2.md`) with the guard design of the spike (`docs/research/page-capture-guard-spike.md`). The branch `feat/page-capture` can be merged once requirements 1 to 5 and 11 are met. The scan route can use `lib/capture` once every requirement is met.

## Out of scope

- The scan route itself (`/api/scan`), its rate limits, caps, storage and UI. What it must do is recorded in `design.md`.
- Detectors and the LLM judge.
- The egress proxy (`customProxy`). It is recommended, not built.
- A second raw CDP WebSocket connection for the guard.
- Non-flattened `Target.sendMessageToTarget`.
- Playwright `route()`, `routeWebSocket` or any second request interceptor.
- The vendor network policy (`networkPolicyId`).
- Controls for WebTransport, WebRTC, preconnect, DNS prefetch and DNS rebinding.
- A configuration switch that allows service-worker scripts.
- Collector coverage of shadow roots and same-origin iframes, the `aria-*` size path to `snapshot-too-large`, and the tiled-mode time cost (N8, rest of N9). These are documented limitations only.
- Running the live test, a dev server or a browser.
- Changing the Boo-tique ground truth.
- Any change under `.github`, `.githooks`, `.kiro/agents`, `.kiro/hooks`, `.kiro/settings`, `scripts`, `SECURITY.md` or `.gitleaks.toml`.

## 1. Browser-level request guard

**User story:** As the app owner, I want one interceptor that sees the requests of every target, so that cross-site iframes and workers load and are still checked.

**Acceptance criteria:**

1.1. WHEN the guards are installed THE SYSTEM SHALL read the main frame id with `Page.getFrameTree` on the page CDP session before it opens the guard session.
1.2. WHEN the guards are installed THE SYSTEM SHALL open exactly one guard session with `browser.newBrowserCDPSession()`.
1.3. WHEN the guard session is open THE SYSTEM SHALL register its `Fetch.requestPaused` handler, its `close` handler and the browser's `disconnected` handler before it sends the first command on that session.
1.4. WHEN the guard session is set up THE SYSTEM SHALL call `Fetch.enable` exactly once on it, with the pattern `*` at the request stage plus the response-stage patterns of 6.1 when hardening is on.
1.5. WHEN `Fetch.enable` has not resolved THE SYSTEM SHALL not start the first navigation.
1.6. WHEN reading the main frame id, opening the guard session or `Fetch.enable` fails THE SYSTEM SHALL return `connect-failed` with a redacted `detail` and not navigate.
1.7. WHEN any CDP command is sent THE SYSTEM SHALL pass at most two arguments to `send` and no `sessionId` field in the parameters.
1.8. WHEN the guards are installed THE SYSTEM SHALL not send `Target.setAutoAttach`, `Runtime.runIfWaitingForDebugger`, `Target.closeTarget` or `Network.setBypassServiceWorker`.
1.9. WHEN the guards are installed THE SYSTEM SHALL not call `route`, `routeWebSocket` or `Fetch.enable` on a page session.
1.10. WHEN the code under `lib/capture` is read THE SYSTEM SHALL contain no child-session code: no `targetSessionId` parameter, no `Target.attachedToTarget` handler and no `waitForDebuggerOnStart`.
1.11. WHEN the guards are installed THE SYSTEM SHALL keep cancelling downloads with `download-refused` and closing popups with `popup-closed`.

## 2. Verdict for each paused request

**User story:** As the app owner, I want every paused request answered once by the existing rules, so that nothing stays paused and nothing goes out unchecked.

**Acceptance criteria:**

2.1. WHEN a request is paused at the request stage THE SYSTEM SHALL decide it with the existing rules: syntax first, then DNS for documents and new hosts, with the per-capture verdict cache and the host limits of requirement 8.
2.2. WHEN the request URL scheme is `data:`, `blob:` or `about:` THE SYSTEM SHALL continue it without calling the policy.
2.3. WHEN the verdict allows the request THE SYSTEM SHALL send `Fetch.continueRequest` with the request id on the guard session.
2.4. WHEN the verdict refuses the request THE SYSTEM SHALL report `request-blocked` with the reason and then send `Fetch.failRequest` with `errorReason: "BlockedByClient"`.
2.5. WHEN the verdict is not ready within `GUARD_DECISION_TIMEOUT_MS` THE SYSTEM SHALL refuse the request.
2.6. WHEN the verdict code throws THE SYSTEM SHALL refuse the request.
2.7. WHEN `Fetch.continueRequest` or `Fetch.failRequest` rejects THE SYSTEM SHALL send `Fetch.failRequest` with `BlockedByClient` once more and ignore a failure of that call.
2.8. WHEN a refused request has `resourceType` `Document` and a `frameId` equal to the main frame id THE SYSTEM SHALL report it with `mainFrame: true`.
2.9. WHEN a refused request has another `resourceType` or another `frameId` THE SYSTEM SHALL report it with `mainFrame: false`.
2.10. WHEN a paused event carries `redirectedRequestId` THE SYSTEM SHALL decide it like any other request.
2.11. WHEN a paused event has no usable request id or URL THE SYSTEM SHALL not throw out of the event handler.

## 3. Service-worker scripts

**User story:** As the app owner, I want pages unable to install a service worker, so that no worker can synthesise a document the guard never sees.

**Acceptance criteria:**

3.1. WHEN a paused request carries a header named `Service-Worker` in any case with the value `script` THE SYSTEM SHALL refuse it with the reason `service-worker-blocked` without calling the policy.
3.2. WHEN a service-worker script is refused THE SYSTEM SHALL report `request-blocked` with the reason `service-worker-blocked`.
3.3. WHEN the configuration is parsed THE SYSTEM SHALL offer no setting that allows service-worker scripts.
3.4. WHEN a paused request carries a `Service-Worker` header with another value THE SYSTEM SHALL decide it with the rules of requirement 2.

## 4. Fail closed on guard loss

**User story:** As the app owner, I want a lost guard to end the capture at once, so that unguarded requests run for the shortest possible time and no data from that time is used.

**Acceptance criteria:**

4.1. WHEN the guard session emits `close` while the capture runs THE SYSTEM SHALL fail the capture with the error `guard-lost`.
4.2. WHEN the browser emits `disconnected` while the capture runs THE SYSTEM SHALL fail the capture with the error `guard-lost`.
4.3. WHEN the guard is lost THE SYSTEM SHALL start the session stop at once, without waiting for the running stage.
4.4. WHEN the guard is lost THE SYSTEM SHALL reject the running stage at once and not wait for it to settle.
4.5. WHEN the capture fails with `guard-lost` THE SYSTEM SHALL return no snapshot and no images.
4.6. WHEN the guard is lost during the layout drift re-read or the reload sample THE SYSTEM SHALL return `guard-lost` and not `reload-failed` or a success.
4.7. WHEN the guard is lost after the last stage and before the result is built THE SYSTEM SHALL return `guard-lost`.
4.8. WHEN the guard is lost THE SYSTEM SHALL call the session stop exactly once for the whole capture.
4.9. WHEN `stop()` of the session has started THE SYSTEM SHALL not treat a later `close`, `disconnected` or heartbeat failure as guard loss.
4.10. WHEN the page is alive THE SYSTEM SHALL never detach the guard session; teardown sends the stop `PATCH` first and then closes the browser connection.
4.11. WHEN the error codes are declared THE SYSTEM SHALL include `guard-lost` with a fixed message distinct from `connect-failed`.
4.12. WHEN the capture fails with `guard-lost` THE SYSTEM SHALL keep the warning codes collected so far in the result.

## 5. Guard heartbeat

**User story:** As the app owner, I want a silent connection drop noticed within seconds, so that the unguarded window does not last for the rest of the capture.

**Acceptance criteria:**

5.1. WHEN the guard is installed THE SYSTEM SHALL send `Browser.getVersion` on the guard session every `GUARD_HEARTBEAT_INTERVAL_MS` (2,000).
5.2. WHEN a heartbeat has no answer after `GUARD_HEARTBEAT_TIMEOUT_MS` (5,000) THE SYSTEM SHALL treat the guard as lost.
5.3. WHEN a heartbeat rejects THE SYSTEM SHALL treat the guard as lost.
5.4. WHEN a heartbeat is still pending at the next interval THE SYSTEM SHALL not send another one.
5.5. WHEN the guard has stopped watching THE SYSTEM SHALL send no further heartbeat and cancel its timers.

## 6. WebSocket hardening

**User story:** As the app owner, I want WebSocket connections blocked in every context the spike covered, so that the browser cannot open a socket to a target the guard never sees.

**Acceptance criteria:**

6.1. WHEN hardening is on THE SYSTEM SHALL add the response-stage patterns `{ urlPattern: "*", resourceType: "Document" }` and `{ urlPattern: "*", resourceType: "Other" }` to `Fetch.enable`.
6.2. WHEN hardening is off THE SYSTEM SHALL enable only the request-stage pattern.
6.3. WHEN a response is paused with a status from 300 to 399 THE SYSTEM SHALL continue it unchanged.
6.4. WHEN a response is paused with `responseErrorReason` THE SYSTEM SHALL continue it unchanged.
6.5. WHEN a `Document` response is paused THE SYSTEM SHALL read its body with `Fetch.getResponseBody` and answer it with `Fetch.fulfillRequest`.
6.6. WHEN an `Other` response whose `Content-Type` contains `javascript` or `ecmascript` is paused THE SYSTEM SHALL read its body and answer it with `Fetch.fulfillRequest`.
6.7. WHEN any other response is paused THE SYSTEM SHALL continue it unchanged.
6.8. WHEN a response is fulfilled THE SYSTEM SHALL send the original status and headers without `Content-Encoding` and `Content-Length` (any case), plus `Content-Security-Policy: connect-src http: https: data: blob:`.
6.9. WHEN the body read is not base64-encoded THE SYSTEM SHALL encode its UTF-8 bytes as base64 before fulfilling.
6.10. WHEN `Content-Length` or the decoded body is larger than `MAX_REWRITE_BODY_BYTES` THE SYSTEM SHALL refuse the response with the reason `response-too-large` and never pass it on unrewritten.
6.11. WHEN the response-stage answer is not ready within `GUARD_DECISION_TIMEOUT_MS` THE SYSTEM SHALL refuse the response with the reason `response-rewrite-failed`.
6.12. WHEN `Fetch.getResponseBody` or `Fetch.fulfillRequest` rejects THE SYSTEM SHALL refuse the response with the reason `response-rewrite-failed`.
6.13. WHEN a response is rewritten THE SYSTEM SHALL never call `Fetch.continueResponse`.
6.14. WHEN a refused response is a main-frame document THE SYSTEM SHALL report it with `mainFrame: true`.
6.15. WHEN a response is refused THE SYSTEM SHALL report `request-blocked` with its reason and send `Fetch.failRequest` with `BlockedByClient`.

## 7. Hardening switch

**User story:** As the app owner, I want the hardening on unless I turn it off, so that a missing setting never weakens the guard.

**Acceptance criteria:**

7.1. WHEN `CAPTURE_WEBSOCKET_HARDENING` is unset or empty THE SYSTEM SHALL turn hardening on.
7.2. WHEN `CAPTURE_WEBSOCKET_HARDENING` is `on` or `off` THE SYSTEM SHALL accept it.
7.3. WHEN `CAPTURE_WEBSOCKET_HARDENING` has another value THE SYSTEM SHALL return `config-invalid` naming the variable and not its value.
7.4. WHEN the remote adapter installs the guards THE SYSTEM SHALL pass hardening with `MAX_REWRITE_BODY_BYTES` unless the configuration says `off`.
7.5. WHEN `.env.example` is read THE SYSTEM SHALL list `CAPTURE_WEBSOCKET_HARDENING=` with one comment line that states the default `on`.

## 8. Host and DNS budget

**User story:** As the app owner, I want the DNS work of one capture bounded, so that a hostile page cannot turn the function into a query generator.

**Acceptance criteria:**

8.1. WHEN a document request names a new host and `MAX_LOOKUP_HOSTS` (300) distinct hosts have been seen THE SYSTEM SHALL refuse it with the reason `host-limit-reached`.
8.2. WHEN a non-document request names a new host and `MAX_REQUEST_HOSTS` (100) distinct hosts have been seen THE SYSTEM SHALL refuse it with the reason `host-limit-reached`.
8.3. WHEN a request is refused for a host limit THE SYSTEM SHALL report `request-host-limit` once per capture and count the request in `request-blocked`.
8.4. WHEN the verdict cache holds `MAX_VERDICT_CACHE_ENTRIES` (1,200) origins and a new origin is checked THE SYSTEM SHALL refuse it with `host-limit-reached` without a DNS lookup.
8.5. WHEN an origin in the cache is checked again THE SYSTEM SHALL reuse its verdict without a lookup.
8.6. WHEN `capturePage` checks the input URL and the final URLs THE SYSTEM SHALL use the same policy object and cache as the guard.
8.7. WHEN a host or cache limit is applied THE SYSTEM SHALL take it from a named exported constant.

## 9. Collector against DOM clobbering

**User story:** As a detector author, I want a form with odd input names unable to hide content or break the read, so that every shop can be scanned completely.

**Acceptance criteria:**

9.1. WHEN the collector starts THE SYSTEM SHALL take the getters and methods it needs from `Document.prototype`, `Node.prototype`, `Element.prototype`, `HTMLElement.prototype`, `HTMLInputElement.prototype`, `HTMLOptionElement.prototype`, `NamedNodeMap.prototype`, `Attr.prototype`, `HTMLCollection.prototype` and `NodeList.prototype` before it reads any element.
9.2. WHEN the collector reads a property or calls a method of a DOM object THE SYSTEM SHALL do it through the captured getter or method with `.call`, for every property and method listed in `design.md`.
9.3. WHEN a form holds inputs named `tagName`, `children`, `childNodes`, `attributes`, `getAttribute`, `hasAttribute`, `getBoundingClientRect`, `textContent`, `innerText`, `nodeType` or `parentElement` THE SYSTEM SHALL not throw.
9.4. WHEN such a form is on the page THE SYSTEM SHALL collect the eligible elements inside it.
9.5. WHEN such a form holds text THE SYSTEM SHALL collect that text.
9.6. WHEN the isolated world has no `innerText` getter THE SYSTEM SHALL fall back to the captured `textContent` getter.
9.7. WHEN the collector is serialised with `String(fn)` THE SYSTEM SHALL stay self-contained and contain none of `__name`, `import(`, `require(`.

## 10. Listing active sessions

**User story:** As the app owner, I want reclaim and sweep to see every active session, so that orphans are stopped and stopped sessions are left alone.

**Acceptance criteria:**

10.1. WHEN reclaim lists sessions THE SYSTEM SHALL send `GET /api/v4/browsers?filterBy=active&metadata=app%3Dtrick-or-trap&metadata=captureId%3D<encoded id>&pageSize=100&pageNumber=1` and read one page.
10.2. WHEN the sweep lists sessions THE SYSTEM SHALL send `GET /api/v4/browsers?filterBy=active&metadata=app%3Dtrick-or-trap&pageSize=100&pageNumber=<n>` with `n` starting at 1.
10.3. WHEN a list URL is built THE SYSTEM SHALL never use the parameter `status`.
10.4. WHEN a sweep page has an empty `items` list or `n × pageSize` is at least `totalItems` THE SYSTEM SHALL stop paging.
10.5. WHEN a sweep page has no numeric `totalItems` THE SYSTEM SHALL stop paging after that page.
10.6. WHEN the sweep has read `SESSION_LIST_MAX_PAGES` pages THE SYSTEM SHALL stop paging.
10.7. WHEN the sweep has selected sessions to stop THE SYSTEM SHALL send the first stop only after the last page was read.
10.8. WHEN reclaim has the list THE SYSTEM SHALL stop only sessions whose `metadata.captureId` equals the capture id.
10.9. WHEN the sweep has the list THE SYSTEM SHALL stop only sessions whose `metadata.app` is `trick-or-trap` and whose age is above `STALE_SESSION_AGE_MS`.
10.10. WHEN a list call fails, times out or returns a body that cannot be read THE SYSTEM SHALL stop nothing it has not already selected and not reject.
10.11. WHEN the sweep ends THE SYSTEM SHALL return the counts `listed`, `stopped` and `failed` over all pages and no session id.

## 11. Faithful fakes

**User story:** As a developer, I want fakes that fail where the real Playwright client fails, so that a green test means the guard works with the real client.

**Acceptance criteria:**

11.1. WHEN a fake CDP session receives more than two arguments to `send` THE SYSTEM SHALL throw and record a protocol violation.
11.2. WHEN a fake CDP session receives parameters with a `sessionId` field THE SYSTEM SHALL throw and record a protocol violation.
11.3. WHEN the fake guard session receives a `Network.*`, `Page.*`, `Runtime.*` or `Emulation.*` command THE SYSTEM SHALL reject it with `'<method>' wasn't found`.
11.4. WHEN the fake browser emits paused requests of any source THE SYSTEM SHALL deliver all of them on the one guard session.
11.5. WHEN a paused request of the fake is not answered THE SYSTEM SHALL keep it pending and never continue it by itself.
11.6. WHEN the fake receives an answer for an unknown request id or a second answer THE SYSTEM SHALL reject it with `Invalid InterceptionId`.
11.7. WHEN the fake guard session is detached or its connection drops THE SYSTEM SHALL record every pending request as gone out and emit `close`, plus `disconnected` on the browser for a drop.
11.8. WHEN the test of the fake calls `send` with a third argument THE SYSTEM SHALL show that the call throws.
11.9. WHEN a test drives the fake with a deliberately wrong guard that passes a third argument THE SYSTEM SHALL show that the shared violation check fails.
11.10. WHEN the guard is tested THE SYSTEM SHALL cover the main-frame flag, the fallback refusal, the install order, fail-closed on loss and the service-worker refusal.
11.11. WHEN the child-attach code is removed THE SYSTEM SHALL remove in the same change the tests that only prove it.

## 12. HTTP status of the main document

**User story:** As a detector author, I want to know when the page was an error page, so that I do not compare an error page with an article.

**Acceptance criteria:**

12.1. WHEN `goto` or `reload` finishes with a main-document response THE SYSTEM SHALL return its status in `NavigationOutcome.status`.
12.2. WHEN there is no response or the status is not an integer from 100 to 599 THE SYSTEM SHALL leave `status` absent.
12.3. WHEN the seam is declared THE SYSTEM SHALL carry the status as a plain number and no Playwright type.
12.4. WHEN the first sample is built and a status is known THE SYSTEM SHALL record it in `capture.httpStatus`.
12.5. WHEN the reload sample is built and a status is known THE SYSTEM SHALL record it in its `capture.httpStatus`.
12.6. WHEN the first status is 400 or above THE SYSTEM SHALL add the warning `http-error-status`.
12.7. WHEN the first status is below 400 or absent THE SYSTEM SHALL add no `http-error-status` warning.
12.8. WHEN `CaptureMetaSchema` parses THE SYSTEM SHALL accept an absent `httpStatus` and reject one that is not an integer from 100 to 599.

## 13. Reload sample that differs

**User story:** As a detector author, I want a note when the reload shows another page, so that reload comparisons are not trusted blindly.

**Acceptance criteria:**

13.1. WHEN the reload's final URL differs from the first final URL THE SYSTEM SHALL add the warning `reload-differs`.
13.2. WHEN the reload status is 400 or above THE SYSTEM SHALL add the warning `reload-differs`.
13.3. WHEN the larger of the two eligible element counts is at least `RELOAD_ELEMENT_MIN_COUNT` (50) and more than `RELOAD_ELEMENT_RATIO_MAX` (3) times the smaller THE SYSTEM SHALL add the warning `reload-differs`.
13.4. WHEN none of 13.1 to 13.3 holds THE SYSTEM SHALL add no `reload-differs` warning.
13.5. WHEN `reload-differs` is added THE SYSTEM SHALL keep `afterReload` in the snapshot.

## 14. "Could not scan" outcome

**User story:** As the author of the scan route, I want a public outcome type that cannot be read as clean, so that every capture failure is shown as "could not scan".

**Acceptance criteria:**

14.1. WHEN `toScanOutcome` receives a failed result THE SYSTEM SHALL return `status: "could-not-scan"` with a closed `reason`, the fixed message of the code and the warnings.
14.2. WHEN `toScanOutcome` receives a successful result THE SYSTEM SHALL return `status: "captured"` with the snapshot, the images and the warnings.
14.3. WHEN the `could-not-scan` arm is declared THE SYSTEM SHALL have no `snapshot`, `images`, `findings` or `detail` field.
14.4. WHEN the reason mapping is declared THE SYSTEM SHALL hold it in a `Record` keyed by every `CaptureErrorCode`, so a missing code fails the type check.
14.5. WHEN the mapping is tested THE SYSTEM SHALL list every error code in the test and fail when a code is added or removed without a test change.
14.6. WHEN `CaptureError.detail` is declared THE SYSTEM SHALL mark it as internal, for server logs only, in its doc comment.
14.7. WHEN `toScanOutcome` serialises a failure whose `detail` holds text THE SYSTEM SHALL produce JSON without that text.
14.8. WHEN `toScanOutcome` runs THE SYSTEM SHALL perform no I/O and return equal outcomes for equal results.

## 15. Test-only fixture routes

**User story:** As the app owner, I want a page I host that exercises every request source, so that the live test checks the production path and production does not expose it by default.

**Acceptance criteria:**

15.1. WHEN `CAPTURE_FIXTURE_ROUTES` is not exactly `on` THE SYSTEM SHALL answer every fixture route with status 404 and an empty body.
15.2. WHEN `CAPTURE_FIXTURE_ROUTES` is `on` THE SYSTEM SHALL serve the fixture routes listed in `design.md`.
15.3. WHEN a fixture route answers THE SYSTEM SHALL send `X-Robots-Tag: noindex, nofollow` and `Cache-Control: no-store`.
15.4. WHEN a fixture HTML page is served THE SYSTEM SHALL contain `<meta name="robots" content="noindex, nofollow">`.
15.5. WHEN a fixture route is requested THE SYSTEM SHALL read the switch at request time and not at build time.
15.6. WHEN the app has a sitemap or robots file THE SYSTEM SHALL not list the fixture routes in the sitemap and disallow them in robots.
15.7. WHEN the main fixture page is served THE SYSTEM SHALL contain every request source of the fixture table in `design.md`, each aimed at its own forbidden tag URL.
15.8. WHEN `CAPTURE_FIXTURE_ALT_ORIGIN` holds an `https` origin THE SYSTEM SHALL embed the cross-site frame from that origin.
15.9. WHEN `CAPTURE_FIXTURE_ALT_ORIGIN` is unset or not an `https` origin THE SYSTEM SHALL embed no cross-site frame.
15.10. WHEN the cross-site frame has loaded THE SYSTEM SHALL post the message `loaded` to its parent.
15.11. WHEN a fixture script has an outcome THE SYSTEM SHALL write it as a list item into the page's result list in the DOM.
15.12. WHEN the fixture redirect route is requested THE SYSTEM SHALL answer 302 to a forbidden tag URL.
15.13. WHEN fixture code is read THE SYSTEM SHALL contain no test-id attribute and no attribute that capture or detector code reads as a hook.
15.14. WHEN fixture code is read THE SYSTEM SHALL import nothing from `lib/capture`.

## 16. Live-test support

**User story:** As the app owner, I want the live test to open popups and check pixels, so that two claims of the notes can be checked without driving Playwright from a test.

**Acceptance criteria:**

16.1. WHEN `RemoteBrowserDeps.onPageReady` is given THE SYSTEM SHALL call it once per connected page with a control that offers only `callWithGesture(globalFunctionName)`.
16.2. WHEN `callWithGesture` runs THE SYSTEM SHALL send `Runtime.evaluate` with `userGesture: true` on the page session and an expression that only calls the named global function.
16.3. WHEN the name does not match `GESTURE_FUNCTION_NAME` THE SYSTEM SHALL reject without a CDP call.
16.4. WHEN `callWithGesture` fails THE SYSTEM SHALL reject with a redacted message.
16.5. WHEN `getBrowser` or `capturePage` creates the remote adapter THE SYSTEM SHALL not pass `onPageReady`.
16.6. WHEN `package.json` is read THE SYSTEM SHALL list `jpeg-js` at exactly `0.4.4` under `devDependencies` and keep `dependencies` unchanged.
16.7. WHEN the code under `lib/` or `app/` is read THE SYSTEM SHALL not import `jpeg-js`.
16.8. WHEN `onPageReady` is not given THE SYSTEM SHALL send no `Runtime.evaluate`.

## 17. Opt-in live test

**User story:** As the app owner, I want each live case to run when its own variables are set, so that I can check the guard against my fixture without a Boo-tique deployment.

**Acceptance criteria:**

17.1. WHEN `RUN_REMOTE_CAPTURE=1` and `BROWSER_USE_API_KEY` are set THE SYSTEM SHALL run the public cases, whether or not `NEXT_PUBLIC_APP_URL` is set.
17.2. WHEN `NEXT_PUBLIC_APP_URL` is unset THE SYSTEM SHALL skip only the Boo-tique cases.
17.3. WHEN `LIVE_FIXTURE_BASE_URL` is unset THE SYSTEM SHALL skip only the fixture cases.
17.4. WHEN `LIVE_FIXTURE_ALT_BASE_URL` is unset THE SYSTEM SHALL skip only the cross-site cases.
17.5. WHEN the fixture page is opened THE SYSTEM SHALL show that `goto` with `waitUntil: "load"` finished within `NAVIGATION_TIMEOUT_MS`.
17.6. WHEN the fixture page has settled THE SYSTEM SHALL show that the distinct forbidden tags seen and refused by the guard equal the expected set.
17.7. WHEN the fixture page has settled THE SYSTEM SHALL show that the `request-blocked` events number at least the expected tags.
17.8. WHEN the fixture page has settled THE SYSTEM SHALL show that both dedicated workers and the shared worker ran.
17.9. WHEN the cross-site case runs THE SYSTEM SHALL show that the cross-site frame posted `loaded` and its tags were refused.
17.10. WHEN the fixture registers its service worker THE SYSTEM SHALL show that the registration was rejected and a `service-worker-blocked` event was reported.
17.11. WHEN the test calls the popup opener with a gesture THE SYSTEM SHALL show that `popup-closed` was reported and the popup navigation tag was refused.
17.12. WHEN hardening is on THE SYSTEM SHALL show that the fixture WebSocket failed and a `connect-src` violation was recorded.
17.13. WHEN the fixture redirect route is captured THE SYSTEM SHALL return `navigation-blocked`.
17.14. WHEN the alignment page is captured THE SYSTEM SHALL show that the marker box matches the marker's pixels in the decoded first image within 2 px on each edge.
17.15. WHEN the clobbering page is captured THE SYSTEM SHALL return `ok: true` with the text inside the clobbering form in the snapshot.
17.16. WHEN a capture with a known capture id has ended THE SYSTEM SHALL show that listing with `filterBy=active` and that capture id returns no session.
17.17. WHEN the live test is rewritten THE SYSTEM SHALL drop the centre-against-half-width assertion and the `LIVE_IFRAME_TEST_URL` case.
17.18. WHEN the live test runs THE SYSTEM SHALL print no API key, `cdpUrl`, `liveUrl` or session id and put none in an assertion message.
17.19. WHEN the live test is finished THE SYSTEM SHALL not be run by the implementing agent, and no task requires running it.
17.20. WHEN a live case has created a session THE SYSTEM SHALL stop it in a `finally` block.

## 18. Stated residual risks

**User story:** As a future reader, I want the guard's limits written next to the code, so that nobody relies on coverage that was not shown.

**Acceptance criteria:**

18.1. WHEN `lib/capture/browser-guard.ts` is read THE SYSTEM SHALL state in its header what the guard covers, with the verification state of each item as in the coverage table of `design.md`.
18.2. WHEN that header is read THE SYSTEM SHALL list as not covered WebTransport, WebRTC, preconnect and DNS prefetch, and DNS rebinding.
18.3. WHEN that header is read THE SYSTEM SHALL state the fail-open window on connection loss and that only an egress proxy closes it.
18.4. WHEN that header is read THE SYSTEM SHALL state that WebSocket coverage exists only while hardening is on and only for the contexts the spike checked on Chrome 156.
18.5. WHEN that header is read THE SYSTEM SHALL list as unverified nested out-of-process iframes, downloads, keepalive requests after unload, module workers, `importScripts`, worklets and the vendor proxy turned on.
18.6. WHEN that header is read THE SYSTEM SHALL recommend `customProxy` egress filtering as the control for what CDP cannot see.

## 19. Steering notes and housekeeping

**User story:** As a future contributor, I want the notes to match the code, so that later specs build on what is true.

**Acceptance criteria:**

19.1. WHEN `.env.example` is read THE SYSTEM SHALL describe `NEXT_PUBLIC_APP_URL` as the app's public origin that bypasses no capture check.
19.2. WHEN `.env.example` is read THE SYSTEM SHALL list the fixture and live-test variables of `design.md`, each with an empty value and one comment line.
19.3. WHEN `structure.md` is read THE SYSTEM SHALL describe `extractor.ts` as the collector run in an isolated world plus the outside pass, and list the files of `lib/capture`, `lib/capture-fixture`, `app/capture-fixture` and `tests/capture` as they are.
19.4. WHEN `tech.md` is read THE SYSTEM SHALL describe the browser-level guard, fail-closed loss, the heartbeat, the service-worker refusal and the hardening switch.
19.5. WHEN `tech.md` is read THE SYSTEM SHALL list the residual risks of requirement 18 and the egress-proxy recommendation.
19.6. WHEN `tech.md` is read THE SYSTEM SHALL name the live-test variables and the fixture routes with their switch.
19.7. WHEN the notes are changed THE SYSTEM SHALL delete only statements that this spec made wrong.
19.8. WHEN the text-rules test runs THE SYSTEM SHALL scan `lib/capture-fixture`, `app/capture-fixture` and `.kiro/specs/page-capture-fixes-2` as well.
19.9. WHEN the last task ends THE SYSTEM SHALL pass `npm run lint` and `npx tsc --noEmit`.
