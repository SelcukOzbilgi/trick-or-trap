# Requirements: Page Capture Fixes

## Out of scope

- The HTTP route, `maxDuration`, rate limits, global and spend caps, and storage (the later scan-route spec). Requirements for that spec are recorded in `design.md`.
- `routeWebSocket` and any control over WebSocket, WebRTC or preconnect traffic. These are stated residual risks; whether to add them is a follow-up to evaluate with the live test.
- Egress control through the Browser Use `customProxy` (follow-up only).
- Defence against DNS rebinding and against names the remote browser resolves differently from this function.
- Verifying Chrome's Local Network Access behaviour.
- The CSS fallback `html { scrollbar-width: none }` for hidden scrollbars (documented in `design.md`, not implemented).
- Review notes on `waitUntil: "load"` (pages that never fire `load`), on HTTP 4xx and 5xx final responses captured without a warning, and on JavaScript navigations after load that leave `snapshot.url` unchanged.
- Calling `sweepStaleSessions` from `capturePage`, a cron job or a route.
- Detectors, the LLM judge, UI, local Chromium and bundled Chromium modes.
- Changing the existing element, text and image caps, the 45 s capture deadline or the 4 MiB image limit.

## 1. Interception of every browser request

**User story:** As the app owner, I want every request the browser makes checked before it is sent, so that a redirect hop cannot reach a blocked target.

**Acceptance criteria:**

1.1. WHEN the page session is set up THE SYSTEM SHALL enable CDP `Fetch` with the pattern `*` at the request stage on the page's CDP session before the first navigation.
1.2. WHEN the browser pauses a request THE SYSTEM SHALL decide to continue or fail it before the request is sent, for main-frame navigations, each redirect hop, sub-frame navigations and sub-resources alike.
1.3. WHEN a request is refused THE SYSTEM SHALL call `Fetch.failRequest` with the error reason `BlockedByClient` in the same event turn as the verdict, without waiting for a timer.
1.4. WHEN a request is allowed THE SYSTEM SHALL call `Fetch.continueRequest` without changing the request.
1.5. WHEN the verdict for a paused request takes longer than `GUARD_DECISION_TIMEOUT_MS` THE SYSTEM SHALL fail the request.
1.6. WHEN the code that makes the verdict throws THE SYSTEM SHALL fail the request.
1.7. WHEN `Fetch.enable` fails THE SYSTEM SHALL return the error `connect-failed` and not navigate.
1.8. WHEN the guards are installed THE SYSTEM SHALL not call `route`, `routeWebSocket` or `route.fetch()` on the context or the page.

## 2. Checks applied to each request

**User story:** As the app owner, I want one rule set for every request type, so that iframes and sub-resources cannot read from internal networks.

**Acceptance criteria:**

2.1. WHEN a request is paused THE SYSTEM SHALL first apply the URL syntax rules (scheme, port, credentials, host name, IP literal) without DNS and synchronously.
2.2. WHEN the URL scheme is `data:`, `blob:` or `about:` THE SYSTEM SHALL continue the request without further checks.
2.3. WHEN the URL scheme is neither `http:` nor `https:` and not one of the schemes of 2.2 THE SYSTEM SHALL refuse the request with the reason `url-scheme-blocked`.
2.4. WHEN the paused request is a document request, in the main frame or in any other frame, THE SYSTEM SHALL also run the DNS check on its host before continuing it.
2.5. WHEN the paused request is not a document request and its host has not been seen in this capture THE SYSTEM SHALL run the DNS check on that host before continuing it.
2.6. WHEN a host has already been checked in this capture THE SYSTEM SHALL reuse the earlier verdict without a new lookup.
2.7. WHEN a non-document request names a new host and `MAX_REQUEST_HOSTS` distinct hosts have been seen THE SYSTEM SHALL refuse the request.
2.8. WHEN at least one request was refused because of the host limit THE SYSTEM SHALL add the warning `request-host-limit` once.
2.9. WHEN a request URL is longer than `MAX_HOP_URL_LENGTH` THE SYSTEM SHALL refuse it with the reason `url-too-long`.
2.10. WHEN a document request in a sub-frame is refused THE SYSTEM SHALL continue the capture and return `ok: true` if nothing else fails.

## 3. Child targets and service workers

**User story:** As the app owner, I want cross-site iframes and service-worker traffic covered by the same checks, so that moving content to another browser process does not skip the guard.

**Acceptance criteria:**

3.1. WHEN the page session is set up THE SYSTEM SHALL call `Network.setBypassServiceWorker` with `bypass: true` before the first navigation.
3.2. WHEN the page session is set up THE SYSTEM SHALL call `Target.setAutoAttach` with `autoAttach: true`, `waitForDebuggerOnStart: true` and `flatten: true`.
3.3. WHEN a child target attaches THE SYSTEM SHALL enable `Fetch` at the request stage on it before it resumes it with `Runtime.runIfWaitingForDebugger`.
3.4. WHEN a child target attaches THE SYSTEM SHALL set auto-attach on it with the same parameters, so that nested targets are covered.
3.5. WHEN enabling `Fetch` on a child target fails THE SYSTEM SHALL close that target on a best-effort basis and count it as a refused request.
3.6. WHEN a request is paused on a child target THE SYSTEM SHALL decide it with the same verdict code, host cache and host limit as a request of the page.
3.7. WHEN `Network.setBypassServiceWorker` or `Target.setAutoAttach` fails THE SYSTEM SHALL return the error `connect-failed` and not navigate.

## 4. Reporting refused requests

**User story:** As a user of the later results page, I want one clear note that requests were blocked, so that I know the scan was limited without seeing target addresses.

**Acceptance criteria:**

4.1. WHEN a request is refused THE SYSTEM SHALL report an event with the reason code and a flag that says whether it was a main-frame document request.
4.2. WHEN one or more requests were refused THE SYSTEM SHALL add exactly one `request-blocked` warning to the result.
4.3. WHEN the `request-blocked` warning is added THE SYSTEM SHALL set its `count` to the number of refused requests.
4.4. WHEN the `request-blocked` warning is added THE SYSTEM SHALL set its `reason` to the reason code of the first refused request.
4.5. WHEN the `request-blocked` warning is returned THE SYSTEM SHALL carry no URL, host name or path in any of its fields.
4.6. WHEN a main-frame document request is refused and `goto` then fails THE SYSTEM SHALL return the error `navigation-blocked`.
4.7. WHEN only sub-frame or sub-resource requests were refused and `goto` fails for another reason THE SYSTEM SHALL return the error code of that reason.
4.8. WHEN `CaptureWarning` is declared THE SYSTEM SHALL offer an optional `reason` of type `UrlErrorCode` and an optional `count`.

## 5. Size bounds on every field

**User story:** As the app owner, I want every field of the snapshot bounded outside the page, so that a hostile page cannot exhaust memory in this function.

**Acceptance criteria:**

5.1. WHEN an element is processed outside the page THE SYSTEM SHALL cut `tag` at `MAX_TAG_CHARS`.
5.2. WHEN an element is processed outside the page THE SYSTEM SHALL cut `role` at `MAX_ROLE_CHARS`.
5.3. WHEN an element is processed outside the page THE SYSTEM SHALL cut each of its seven style strings at `MAX_STYLE_CHARS`.
5.4. WHEN an element has more attributes than `MAX_ATTRS_PER_ELEMENT` THE SYSTEM SHALL keep the first allowed ones up to that number.
5.5. WHEN an attribute name is longer than `MAX_ATTR_NAME_CHARS` THE SYSTEM SHALL drop that attribute.
5.6. WHEN an attribute value is longer than `MAX_ATTR_CHARS` THE SYSTEM SHALL cut it.
5.7. WHEN the path of an element is deeper than `MAX_PATH_DEPTH` or holds an index above `MAX_PATH_INDEX` THE SYSTEM SHALL drop the element and still count it as eligible.
5.8. WHEN the id built from a path is longer than `MAX_ELEMENT_ID_CHARS` THE SYSTEM SHALL drop the element and still count it as eligible.
5.9. WHEN the raw list holds more entries than the element cap THE SYSTEM SHALL examine at most `RAW_SCAN_FACTOR` times the cap of raw entries and keep at most the cap.
5.10. WHEN the raw read is not an object or its `elements` is not an array THE SYSTEM SHALL return the error `page-read-failed`.
5.11. WHEN the collector runs in the page THE SYSTEM SHALL apply the same caps to tag, role, depth, attribute count, attribute name length and style strings, so the data that crosses CDP is bounded as well.
5.12. WHEN 20 hostile raw elements (a tag of 10,000 characters, a role of 1,000,000, an id of 10,002, a colour of 1,000,000 and 2,000 attributes each) are processed THE SYSTEM SHALL produce a snapshot whose JSON size is below `MAX_SNAPSHOT_BYTES` and whose fields are within their caps.
5.13. WHEN a limit is applied THE SYSTEM SHALL take it from a named exported constant.

## 6. Snapshot size cap and schema limits

**User story:** As the app owner, I want an oversized snapshot to fail with its own error, so that storage and the judge never receive it.

**Acceptance criteria:**

6.1. WHEN the snapshot is assembled THE SYSTEM SHALL measure the size of its JSON text in UTF-8 bytes before schema validation.
6.2. WHEN the size is above `MAX_SNAPSHOT_BYTES` and `afterReload` is present THE SYSTEM SHALL drop `afterReload`, add the warning `reload-failed` and measure again.
6.3. WHEN the size is still above `MAX_SNAPSHOT_BYTES` THE SYSTEM SHALL return the error `snapshot-too-large`.
6.4. WHEN `snapshot-too-large` is returned THE SYSTEM SHALL stop the session exactly once.
6.5. WHEN the error codes are declared THE SYSTEM SHALL include `snapshot-too-large` with a fixed message, separate from `snapshot-invalid`.
6.6. WHEN `ElementSnapshotSchema` parses an element THE SYSTEM SHALL reject an `id` over 2,048 characters, a `tag` or `role` over 64, a `text` over 1,000 and a style string over 64.
6.7. WHEN `attributes` has more than 32 entries, a name over 64 characters or a value over 200 characters THE SYSTEM SHALL reject the element.
6.8. WHEN `CaptureMetaSchema` parses THE SYSTEM SHALL reject a `devicePixelRatio` above 16, a `layoutWidth` that is not positive or is above 100,000, and more than 10 `images.items`.
6.9. WHEN a snapshot of the old shape or any existing snapshot fixture is parsed THE SYSTEM SHALL accept it unchanged.

## 7. Alignment of boxes and screenshot

**User story:** As a user of the later results page, I want markers on the right elements, so that the read and the image share one layout width.

**Acceptance criteria:**

7.1. WHEN the page session is set up THE SYSTEM SHALL call `Emulation.setScrollbarsHidden` with `hidden: true` on a CDP session before the first element read.
7.2. WHEN that call fails THE SYSTEM SHALL return the error `connect-failed` and not navigate.
7.3. WHEN a sample is read THE SYSTEM SHALL take the layout width from `cssLayoutViewport.clientWidth` of `Page.getLayoutMetrics`.
7.4. WHEN a sample is built THE SYSTEM SHALL record the layout width in `capture.layoutWidth`, in the first sample and in the reload sample.
7.5. WHEN the single image is planned THE SYSTEM SHALL use the layout width, rounded up and clamped to `BROWSER_VIEWPORT.width`, as the image width.
7.6. WHEN a screenshot is taken THE SYSTEM SHALL pass `animations: "disabled"`.

## 8. Layout drift check

**User story:** As a user of the later results page, I want a note when the layout moved between the read and the screenshot, so that I know markers may be off.

**Acceptance criteria:**

8.1. WHEN the screenshots are done (after the final `scrollTo(0)` in tiled mode) and at least `TILE_MIN_REMAINING_MS` of the whole-capture budget remain THE SYSTEM SHALL read the page again with the light options.
8.2. WHEN both reads exist THE SYSTEM SHALL compute the largest absolute difference in `x`, `y`, `width` and `height` over the elements with the same id.
8.3. WHEN that difference is above `LAYOUT_DRIFT_PX` (4) THE SYSTEM SHALL add the warning `layout-shifted`.
8.4. WHEN that difference is at most `LAYOUT_DRIFT_PX` THE SYSTEM SHALL add no such warning.
8.5. WHEN the second read fails or too little time remains THE SYSTEM SHALL skip it without an error and without a warning.
8.6. WHEN the second read is done THE SYSTEM SHALL leave the snapshot unchanged.

## 9. Isolated world and trusted page metrics

**User story:** As the app owner, I want the collector protected from page scripts, so that a hostile shop cannot make it lie or fail.

**Acceptance criteria:**

9.1. WHEN the collector runs THE SYSTEM SHALL create an isolated world for the main frame with `Page.createIsolatedWorld` and call the collector with `Runtime.callFunctionOn` on that execution context with `returnByValue: true`.
9.2. WHEN the page has navigated or reloaded since the last read THE SYSTEM SHALL create a new isolated world before the next read.
9.3. WHEN `scrollTo` runs THE SYSTEM SHALL run the scroll in an isolated world.
9.4. WHEN page metrics are read THE SYSTEM SHALL take viewport size, scroll position and content size from `Page.getLayoutMetrics`.
9.5. WHEN the device pixel ratio is read THE SYSTEM SHALL read it in the isolated world and not in the main world.
9.6. WHEN the device pixel ratio is not finite, not positive or above `MAX_PLAUSIBLE_DPR` THE SYSTEM SHALL use 1.
9.7. WHEN a viewport or content size is not finite, not positive or above `MAX_PLAUSIBLE_PX` THE SYSTEM SHALL replace it with the `BROWSER_VIEWPORT` value or a clamped value.
9.8. WHEN screenshots are planned THE SYSTEM SHALL clamp the inner width and height to `BROWSER_VIEWPORT`.
9.9. WHEN a metric is implausible THE SYSTEM SHALL not return `snapshot-invalid` because of it.
9.10. WHEN the remote adapter reads the page or scrolls THE SYSTEM SHALL not call `page.evaluate`.

## 10. Orphan sessions

**User story:** As the app owner, I want a billed session that nothing stops to be rare and recoverable, so that failed creates do not cost a full session each.

**Acceptance criteria:**

10.1. WHEN a session is created THE SYSTEM SHALL send `metadata` with `app` equal to `trick-or-trap` and a `captureId`.
10.2. WHEN a capture starts THE SYSTEM SHALL generate a random `captureId` that is not derived from the URL, the API key or the clock.
10.3. WHEN the create response holds a non-empty `id` but no usable `cdpUrl` THE SYSTEM SHALL send the stop call for that id before it returns `session-create-failed`.
10.4. WHEN that stop call fails THE SYSTEM SHALL ignore the failure and still return `session-create-failed`.
10.5. WHEN a create call is aborted at its deadline or fails without an HTTP response THE SYSTEM SHALL make one cleanup attempt that lists `GET /api/v4/browsers?status=active`.
10.6. WHEN the cleanup has the list THE SYSTEM SHALL stop only sessions whose `metadata.captureId` equals the `captureId` of this capture.
10.7. WHEN the list response cannot be parsed THE SYSTEM SHALL stop nothing and raise no error.
10.8. WHEN the cleanup runs THE SYSTEM SHALL bound it by `STOP_TIMEOUT_MS` and ignore its failure.
10.9. WHEN a create call returns an HTTP error status THE SYSTEM SHALL make no cleanup attempt.
10.10. WHEN a capture ends THE SYSTEM SHALL have made at most one cleanup attempt.

## 11. Stale-session sweep helper

**User story:** As the author of the later route spec, I want a helper that stops forgotten sessions, so that orphans from crashed functions are reclaimed.

**Acceptance criteria:**

11.1. WHEN `sweepStaleSessions` runs THE SYSTEM SHALL list active sessions and stop those whose `metadata.app` is `trick-or-trap` and whose age is above `STALE_SESSION_AGE_MS` (2 minutes).
11.2. WHEN a listed session has no such tag or an unknown age THE SYSTEM SHALL not stop it.
11.3. WHEN the sweep ends THE SYSTEM SHALL return the counts `listed`, `stopped` and `failed` and no session id.
11.4. WHEN `capturePage` runs THE SYSTEM SHALL not call the sweep helper.

## 12. Redaction on every path

**User story:** As the app owner, I want no secret in any output, so that a live view or an API key never leaks.

**Acceptance criteria:**

12.1. WHEN a session handle exists THE SYSTEM SHALL expose `secrets()` with the API key, session id, `cdpUrl` and `liveUrl`.
12.2. WHEN the result is built THE SYSTEM SHALL pass every `error.detail` through `redactText` with the full secret list of the capture, in one single place.
12.3. WHEN the result is built THE SYSTEM SHALL pass every text field of every warning through the same function.
12.4. WHEN installing the guards fails THE SYSTEM SHALL return `connect-failed` with a redacted `detail`.
12.5. WHEN an error text contains the API key, the session id, the `cdpUrl` or the `liveUrl` at create, connect, guard installation, goto, collect, screenshot, scroll, reload or stop THE SYSTEM SHALL return a result whose JSON contains none of them.
12.6. WHEN the create response was received in part THE SYSTEM SHALL redact the id, `cdpUrl` and `liveUrl` seen in it from every error it raises.

## 13. Tests that prove behaviour

**User story:** As a developer, I want tests that run the real collector and the real guard, so that a green run means the behaviour works and not only the fake.

**Acceptance criteria:**

13.1. WHEN the collector is tested THE SYSTEM SHALL run `collectInPage` against DOM built in jsdom and not against hand-made raw data.
13.2. WHEN a document holds `script`, `style`, `noscript`, `template` and `head` content THE SYSTEM SHALL skip those elements in the DOM test.
13.3. WHEN rectangles are stubbed THE SYSTEM SHALL show in the DOM test that a non-control with a zero-size box is skipped and a control without a box is kept.
13.4. WHEN a parent and its child both hold text THE SYSTEM SHALL show in the DOM test that a plain element reports own text and a control, link, label or role element reports the text of its subtree.
13.5. WHEN text is longer than the cap THE SYSTEM SHALL show in the DOM test the cut text and `textTruncated`.
13.6. WHEN elements carry allowed and other attributes THE SYSTEM SHALL show in the DOM test that only allowed ones are read and `value` only for the permitted elements.
13.7. WHEN checkboxes and options are present THE SYSTEM SHALL show in the DOM test their `checked` and `selected` state.
13.8. WHEN elements are nested THE SYSTEM SHALL show in the DOM test the id paths, and the same ids for the same DOM in two reads.
13.9. WHEN the DOM is deeper than `MAX_PATH_DEPTH` THE SYSTEM SHALL show in the DOM test that deeper elements are not collected and are counted as eligible.
13.10. WHEN `String.prototype.slice` and `getComputedStyle` are overridden by the test THE SYSTEM SHALL show that the output of the collector after the outside pass stays within the caps.
13.11. WHEN an element has a role of 1,000,000 characters and 2,000 `aria-*` attributes THE SYSTEM SHALL show in the DOM test that the collector output is within the caps.
13.12. WHEN a test file uses jsdom THE SYSTEM SHALL start it with the directive `// @vitest-environment jsdom` and leave every other test file in the node environment.
13.13. WHEN redirect hops, sub-frames and sub-resources are tested THE SYSTEM SHALL drive the real guard with a fake CDP session that emits paused-request events, including a redirect hop, and not a fake of the old route.
13.14. WHEN `snapshot-invalid` is tested THE SYSTEM SHALL force it with a spy on `PageSnapshotSchema.safeParse`, because an implausible metric no longer causes it.
13.15. WHEN a page reports a device pixel ratio of 0 THE SYSTEM SHALL show in a test that the capture succeeds with a ratio of 1.

## 14. Attribute allowlist and the test-id attribute

**User story:** As the app owner, I want snapshots free of any attribute that names a verdict, so that detectors and the judge never see ground truth.

**Acceptance criteria:**

14.1. WHEN a full sample is built THE SYSTEM SHALL record only the attributes `disabled`, every `aria-*`, `type`, `name`, `href`, `for`, `placeholder` and `value`.
14.2. WHEN a light sample is built THE SYSTEM SHALL record only `type`, `name` and `disabled`.
14.3. WHEN an element carries the test-id attribute THE SYSTEM SHALL leave it out of the snapshot in both modes, in the page and outside it.
14.4. WHEN an attribute name, including an `aria-*` name, contains a fragment of `FORBIDDEN_ATTRIBUTE_FRAGMENTS` THE SYSTEM SHALL drop that attribute.
14.5. WHEN the files under `lib/capture` are scanned THE SYSTEM SHALL find in none of them the word that the test-id attribute name ends with, written in any case.
14.6. WHEN a test needs the name of the test-id attribute THE SYSTEM SHALL build it from parts in `tests/capture/helpers/forbidden-attribute.ts` and not write it out.
14.7. WHEN snapshot elements must be mapped to the Boo-tique ground truth THE SYSTEM SHALL do it in test helpers only.
14.8. WHEN the live test runs THE SYSTEM SHALL assert that no element of the snapshot carries the test-id attribute.

## 15. Supersession notes in the page-capture spec

**User story:** As a future reader, I want the old spec to point at the fixes, so that I do not implement a criterion that was replaced.

**Acceptance criteria:**

15.1. WHEN the old `requirements.md` and `design.md` of `page-capture` are read THE SYSTEM SHALL show at the top a note that `page-capture-fixes` supersedes the criteria and statements listed in its `design.md`.
15.2. WHEN criteria 10.11 and 13.4 and the attribute lists of the old design are read THE SYSTEM SHALL not name the test-id attribute.
15.3. WHEN the old `tasks.md` and the steering files are read THE SYSTEM SHALL not name the test-id attribute.
15.4. WHEN the supersession edits are made THE SYSTEM SHALL change no other line of the old spec.

## 16. Stop order and budget

**User story:** As the app owner, I want the billing stop sent first, so that a slow disconnect cannot leave a session running.

**Acceptance criteria:**

16.1. WHEN a session is stopped THE SYSTEM SHALL send the stop `PATCH` first.
16.2. WHEN the `PATCH` has finished THE SYSTEM SHALL close the CDP connection on a best-effort basis, within the smaller of `DISCONNECT_TIMEOUT_MS` and what remains of `STOP_TIMEOUT_MS`.
16.3. WHEN a session is stopped THE SYSTEM SHALL bound the whole chain by `STOP_TIMEOUT_MS` (10 s).
16.4. WHEN the `PATCH` fails THE SYSTEM SHALL still try the disconnect and then reject.
16.5. WHEN the `PATCH` succeeds and the disconnect fails or hangs THE SYSTEM SHALL resolve without a warning.
16.6. WHEN the stop chain exceeds `STOP_TIMEOUT_MS` THE SYSTEM SHALL keep the result and add the warning `session-stop-failed`.

## 17. Cleanup that outlives the response

**User story:** As the author of the later route spec, I want to hand pending cleanup to the platform, so that a frozen function still stops its session.

**Acceptance criteria:**

17.1. WHEN `CaptureDeps` is declared THE SYSTEM SHALL offer an optional `waitUntil(promise)`.
17.2. WHEN a session that arrives after the whole-capture deadline is stopped THE SYSTEM SHALL pass that stop promise to `waitUntil`.
17.3. WHEN the stop call or the create cleanup runs THE SYSTEM SHALL pass its promise to `waitUntil`.
17.4. WHEN `waitUntil` is not given THE SYSTEM SHALL behave as before.
17.5. WHEN `waitUntil` throws THE SYSTEM SHALL ignore the exception.

## 18. Session timeout default

**User story:** As the app owner, I want the shortest session timeout by default, so that a failed stop costs one minute.

**Acceptance criteria:**

18.1. WHEN `BROWSER_USE_SESSION_TIMEOUT_MINUTES` is unset THE SYSTEM SHALL use 1.
18.2. WHEN the value is an integer from 1 to 5 THE SYSTEM SHALL accept it and for any other value return `config-invalid`.
18.3. WHEN `.env.example` is read THE SYSTEM SHALL state the default 1 in the comment of that variable.

## 19. Outside-image test

**User story:** As a user of the later results page, I want exact flags for elements outside the images, so that no marker is pinned in empty space.

**Acceptance criteria:**

19.1. WHEN a box has a size above 0 on an axis THE SYSTEM SHALL count it as inside an image on that axis only if `start + size > low` and `start < high`.
19.2. WHEN a box lies entirely left of x = 0 THE SYSTEM SHALL flag it as outside.
19.3. WHEN a box only touches the top edge of an image from above THE SYSTEM SHALL flag it as outside.
19.4. WHEN a box has a size of 0 on an axis THE SYSTEM SHALL count it as inside on that axis if `start >= low` and `start < high`.
19.5. WHEN a zero-size box lies outside the image on an axis THE SYSTEM SHALL flag it as outside.

## 20. Screenshot mode threshold

**User story:** As the app owner, I want the mode chosen from the measured limit, so that pages that capture fine are not tiled.

**Acceptance criteria:**

20.1. WHEN `fullHeight` is at most `TILE_MODE_THRESHOLD_CSS_PX` (20,000) THE SYSTEM SHALL use single mode, whatever the device pixel ratio.
20.2. WHEN `fullHeight` is above `TILE_MODE_THRESHOLD_CSS_PX` THE SYSTEM SHALL use tiled mode.
20.3. WHEN tiles are planned THE SYSTEM SHALL use the real viewport height, clamped to `BROWSER_VIEWPORT.height`, as the tile height and the scroll step.
20.4. WHEN the threshold constant is declared THE SYSTEM SHALL name it `TILE_MODE_THRESHOLD_CSS_PX` and no longer export `TILE_MODE_THRESHOLD_PX`.

## 21. Allowed origin

**User story:** As the app owner, I want the allowed origin to bypass nothing, so that a misconfigured address cannot make a private host scannable.

**Acceptance criteria:**

21.1. WHEN a URL has the allowed origin THE SYSTEM SHALL apply every URL check, including the host-name and address checks.
21.2. WHEN `NEXT_PUBLIC_APP_URL` holds an IP literal THE SYSTEM SHALL return `config-invalid`.
21.3. WHEN `NEXT_PUBLIC_APP_URL` holds a blocked host name THE SYSTEM SHALL return `config-invalid`.
21.4. WHEN `NEXT_PUBLIC_APP_URL` holds a public host name, with or without a non-default port, THE SYSTEM SHALL accept it.
21.5. WHEN the configuration error is returned THE SYSTEM SHALL name `NEXT_PUBLIC_APP_URL` and not its value.

## 22. URL edge cases

**User story:** As the app owner, I want odd host spellings refused and long redirect URLs accepted, so that checks neither miss a target nor fail a real shop.

**Acceptance criteria:**

22.1. WHEN a host name ends in one or more dots THE SYSTEM SHALL strip every trailing dot before the host-name rules apply.
22.2. WHEN the host is `localhost..` or ends in `.local..` or `.internal..` THE SYSTEM SHALL return `url-host-blocked`.
22.3. WHEN the user-supplied URL is longer than 2,048 characters THE SYSTEM SHALL return `url-too-long`.
22.4. WHEN a redirect hop or a final URL has 2,049 to 8,192 characters and passes the other checks THE SYSTEM SHALL accept it.
22.5. WHEN a redirect hop or a final URL is longer than `MAX_HOP_URL_LENGTH` THE SYSTEM SHALL return `url-too-long`.
22.6. WHEN the final URL is checked after the navigation and after the reload THE SYSTEM SHALL use `MAX_HOP_URL_LENGTH`.

## 23. Untrusted error detail

**User story:** As the author of the later route spec, I want the type to say that `detail` is not safe for users, so that nobody shows it by accident.

**Acceptance criteria:**

23.1. WHEN `CaptureError.detail` is declared THE SYSTEM SHALL carry a comment that says it may contain text controlled by the page or by target URLs and is for server logs only.
23.2. WHEN `capturePage` is documented THE SYSTEM SHALL carry the same statement in its comment.

## 24. Dependency

**User story:** As a developer, I want the one new dev dependency pinned, so that the DOM tests are reproducible.

**Acceptance criteria:**

24.1. WHEN `package.json` is read THE SYSTEM SHALL list `jsdom` at exactly `31.0.1` under `devDependencies`, without a range prefix.
24.2. WHEN `package.json` is read THE SYSTEM SHALL keep `dependencies` unchanged.
24.3. WHEN `package.json` is read THE SYSTEM SHALL have no new script.
24.4. WHEN `vitest.config.ts` is read THE SYSTEM SHALL be unchanged.
24.5. WHEN the code under `lib/` is read THE SYSTEM SHALL not import `jsdom`.

## 25. Opt-in live test

**User story:** As the app owner, I want a live check of what unit tests cannot prove, so that I can verify the guard, the alignment and the stop against the real vendor.

**Acceptance criteria:**

25.1. WHEN the live test file is loaded THE SYSTEM SHALL skip it unless `RUN_REMOTE_CAPTURE=1`, the API key and `NEXT_PUBLIC_APP_URL` are set.
25.2. WHEN a public page redirects to a URL on a blocked port THE SYSTEM SHALL return `navigation-blocked` and a `request-blocked` warning within `LIVE_BLOCK_MAX_MS` (5 s) for the whole call.
25.3. WHEN example.com is captured THE SYSTEM SHALL place the centre of the box of its `<a>` element within 2 px of half the image width.
25.4. WHEN a public page embeds a cross-site iframe to a blocked address and its URL is given in the optional variable `LIVE_IFRAME_TEST_URL` THE SYSTEM SHALL return `ok: true` and a `request-blocked` warning with a count of at least 1.
25.5. WHEN a capture has ended THE SYSTEM SHALL show through the Browser Use API that the session of that capture has the status `stopped`.
25.6. WHEN the live test runs THE SYSTEM SHALL print no API key, `cdpUrl`, `liveUrl` or session id and put none in an assertion message.
25.7. WHEN the live test is written THE SYSTEM SHALL keep the existing Boo-tique assertions except the one for the test-id attribute.
25.8. WHEN the live test is finished THE SYSTEM SHALL not be run by the implementing agent.

## 26. Steering notes and lint

**User story:** As a future contributor, I want the steering files to describe the new guard, so that later specs build on the same rules.

**Acceptance criteria:**

26.1. WHEN the last task runs THE SYSTEM SHALL update `tech.md` for the CDP request guard, the isolated world, the allowed origin that bypasses nothing and the default timeout of 1 minute.
26.2. WHEN the last task runs THE SYSTEM SHALL list the new files of `lib/capture` and `tests/capture` in `structure.md`.
26.3. WHEN the notes are changed THE SYSTEM SHALL delete only statements that these fixes made wrong.
26.4. WHEN the last task ends THE SYSTEM SHALL pass `npm run lint`.
26.5. WHEN the last task ends THE SYSTEM SHALL pass `npm run typecheck`.
