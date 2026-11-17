# Requirements: Page Capture

## Out of scope

- An HTTP route, `maxDuration`, and the `/api/scan` handler.
- Rate limiting, global caps and spend caps.
- Storage: Supabase, `screenshotRef`, screenshot upload.
- Overlay and cookie-banner dismissal.
- Flows across several pages (the phase-2 walker).
- Detectors and the LLM judge.
- UI of any kind.
- Local Chromium and `@sparticuz/chromium-min` implementations (the seam is ready for them; they return a typed error for now).
- Stealth or residential-proxy tuning beyond the on/off switch.
- Retries of a whole capture, and caching of results.
- The independent second load (`secondSample` stays unset).
- Screenshot coverage of documents taller than about ten viewports (tiled mode stops at 10 tiles).

## 1. URL syntax checks

**User story:** As the app owner, I want a URL rejected before any browser exists when its form is unsafe, so that the remote browser is never pointed at an odd target.

**Acceptance criteria:**

1.1. WHEN the input URL is longer than 2,048 characters THE SYSTEM SHALL return the error `url-too-long`.
1.2. WHEN the input contains whitespace or ASCII control characters, or cannot be parsed as an absolute URL, THE SYSTEM SHALL return the error `url-invalid`.
1.3. WHEN the URL scheme is not `http:` or `https:` THE SYSTEM SHALL return the error `url-scheme-blocked`.
1.4. WHEN the URL contains a username or a password THE SYSTEM SHALL return the error `url-credentials-blocked`.
1.5. WHEN the URL port is not 80, not 443 and not the default port of the scheme THE SYSTEM SHALL return the error `url-port-blocked`.
1.6. WHEN every URL check passes THE SYSTEM SHALL return the normalised URL with the fragment removed for use in navigation.
1.7. WHEN any URL check fails THE SYSTEM SHALL return the error without calling `getBrowser` and without creating a browser session.

## 2. Host names and IP literals

**User story:** As the app owner, I want hosts that point at private or special addresses refused, so that a scan cannot be turned against internal services.

**Acceptance criteria:**

2.1. WHEN the host is `localhost` (with or without a trailing dot) or ends with `.localhost`, `.local` or `.internal` THE SYSTEM SHALL return the error `url-host-blocked`.
2.2. WHEN the host is an IPv4 literal in 0.0.0.0/8, 10.0.0.0/8, 100.64.0.0/10, 127.0.0.0/8, 169.254.0.0/16, 172.16.0.0/12, 192.0.0.0/24, 192.0.2.0/24, 192.88.99.0/24, 192.168.0.0/16, 198.18.0.0/15, 198.51.100.0/24, 203.0.113.0/24, 224.0.0.0/4 or 240.0.0.0/4 THE SYSTEM SHALL return the error `url-address-blocked`.
2.3. WHEN the host is the cloud-metadata address 169.254.169.254 or 168.63.129.16 THE SYSTEM SHALL return the error `url-address-blocked`.
2.4. WHEN the host is written as a decimal, octal or hexadecimal IPv4 number THE SYSTEM SHALL classify the address it denotes in the same way as the dotted form.
2.5. WHEN the host is an IPv6 literal outside 2000::/3, or inside 2001::/23, 2001:db8::/32, 2002::/16 or 3fff::/20, THE SYSTEM SHALL return the error `url-address-blocked`.
2.6. WHEN the host is an IPv4-mapped IPv6 literal in any spelling THE SYSTEM SHALL apply the IPv4 rules to the embedded IPv4 address.
2.7. WHEN the host is a public IPv4 or IPv6 literal THE SYSTEM SHALL accept it without a DNS lookup.

## 3. DNS resolution check

**User story:** As the app owner, I want every address a host name resolves to checked, so that a public-looking name cannot hide a private address.

**Acceptance criteria:**

3.1. WHEN the host is a name THE SYSTEM SHALL resolve it through the injected `Resolver` before any browser session is created.
3.2. WHEN any resolved address, IPv4 or IPv6, is in a blocked range THE SYSTEM SHALL return the error `url-address-blocked`, even if the other addresses are public.
3.3. WHEN the resolver fails or returns no address THE SYSTEM SHALL return the error `dns-failed`.
3.4. WHEN the resolver returns a string that is not a valid IP address THE SYSTEM SHALL return the error `url-address-blocked`.
3.5. WHEN every resolved address is public THE SYSTEM SHALL accept the URL.
3.6. WHEN the default resolver is used THE SYSTEM SHALL request both the IPv4 and the IPv6 addresses of the host from the operating system.

## 4. Allow entry for the demo origin

**User story:** As the app owner, I want the app to scan its own Boo-tique origin, so that the demo target can be captured.

**Acceptance criteria:**

4.1. WHEN `NEXT_PUBLIC_APP_URL` is set to a valid http or https URL THE SYSTEM SHALL parse it once, when the configuration is loaded, into an exact origin.
4.2. WHEN the scheme, host and port of a URL equal the allowed origin exactly THE SYSTEM SHALL skip the host-name and address-range checks for that URL.
4.3. WHEN a URL differs from the allowed origin in scheme, host or port, including a subdomain or a parent domain, THE SYSTEM SHALL apply every check.
4.4. WHEN a URL matches the allowed origin THE SYSTEM SHALL still apply the scheme, credential, port and length checks and still require the host to resolve.
4.5. WHEN `NEXT_PUBLIC_APP_URL` is unset or empty THE SYSTEM SHALL have no allow entry.

## 5. Guards inside the browser

**User story:** As the app owner, I want every navigation the browser makes checked, so that a redirect cannot lead to a blocked target.

**Acceptance criteria:**

5.1. WHEN the browser issues a main-frame navigation request, including each redirect hop, THE SYSTEM SHALL check its URL with the rules of requirements 1 to 4 before the request proceeds.
5.2. WHEN that check fails THE SYSTEM SHALL abort the request.
5.3. WHEN the first navigation is aborted by a guard THE SYSTEM SHALL return the error `navigation-blocked`.
5.4. WHEN navigation finishes THE SYSTEM SHALL check the final page URL again and return the error `navigation-blocked` if the check fails.
5.5. WHEN a download starts THE SYSTEM SHALL cancel it and add the warning `download-refused`.
5.6. WHEN a pop-up page opens THE SYSTEM SHALL close it and add the warning `popup-closed`.
5.7. WHEN a request is blocked THE SYSTEM SHALL add the warning `request-blocked`, which carries a closed reason code and no URL.

## 6. Browser seam

**User story:** As a developer, I want one `getBrowser()` seam with narrow interfaces, so that tests use a fake and later specs can add other implementations.

**Acceptance criteria:**

6.1. WHEN the capture needs a browser THE SYSTEM SHALL obtain it only through `getBrowser`.
6.2. WHEN the mode is `remote` THE SYSTEM SHALL return the Browser Use Cloud implementation.
6.3. WHEN the mode is any other value, including `local`, `bundled` and unknown values, THE SYSTEM SHALL return the error `browser-mode-unsupported` and open nothing.
6.4. WHEN the seam interfaces are declared THE SYSTEM SHALL expose no Playwright type in any signature.
6.5. WHEN a `lib/capture` module is loaded THE SYSTEM SHALL not load `playwright-core`; the remote implementation imports it lazily on the first connect.
6.6. WHEN a module that reads the environment, holds the API key or opens a session is imported by client code THE SYSTEM SHALL fail the build through `server-only`.

## 7. Remote implementation (Browser Use Cloud)

**User story:** As the app owner, I want the capture to run on a remote browser over CDP, so that no Chromium runs in the function.

**Acceptance criteria:**

7.1. WHEN a session is created THE SYSTEM SHALL send `POST https://api.browser-use.com/api/v4/browsers` with the header `X-Browser-Use-API-Key` and a JSON body holding `timeout` in minutes, `browserScreenWidth` 1280 and `browserScreenHeight` 800.
7.2. WHEN the proxy setting is `off` THE SYSTEM SHALL add `proxyCountryCode: null` to the create body, and WHEN it is `on` THE SYSTEM SHALL omit that field.
7.3. WHEN the create call returns a non-2xx status or a body without `id` or `cdpUrl` THE SYSTEM SHALL fail with the error `session-create-failed`.
7.4. WHEN the session connects THE SYSTEM SHALL call `connectOverCDP(cdpUrl, { timeout })` and use `contexts()[0]` and its first page, creating a page if there is none.
7.5. WHEN the connection has no browser context THE SYSTEM SHALL fail with the error `connect-failed`.
7.6. WHEN a session is stopped THE SYSTEM SHALL first close the CDP connection on a best-effort basis and then send `PATCH /api/v4/browsers/{id}` with the body `{"action":"stop"}`.
7.7. WHEN the stop call fails or returns a non-2xx status THE SYSTEM SHALL report the failure to the caller.
7.8. WHEN the proxy setting is turned into create-body fields THE SYSTEM SHALL do it in one exported function.

## 8. Session lifecycle

**User story:** As the app owner, I want every session stopped, so that billing never runs on after a capture.

**Acceptance criteria:**

8.1. WHEN a session has been created THE SYSTEM SHALL call stop exactly once in a `finally` block on every path, success and each failure.
8.2. WHEN the stop call fails or exceeds its deadline THE SYSTEM SHALL swallow the failure, keep the capture result and add the warning `session-stop-failed`.
8.3. WHEN the whole-capture deadline expires while session creation is pending and the creation later completes THE SYSTEM SHALL stop that session on a best-effort basis.
8.4. WHEN session creation fails THE SYSTEM SHALL not call stop.
8.5. WHEN a session is created THE SYSTEM SHALL pass the session timeout in minutes from the configuration.

## 9. Deadlines

**User story:** As the app owner, I want hard time limits, so that a capture always finishes inside a 60 s function.

**Acceptance criteria:**

9.1. WHEN a Browser Use API call takes longer than 10 s THE SYSTEM SHALL abort it and return the error `session-create-timeout` for creation or the warning `session-stop-failed` for stop.
9.2. WHEN the CDP connection takes longer than 15 s THE SYSTEM SHALL return the error `connect-timeout`.
9.3. WHEN a navigation takes longer than 15 s THE SYSTEM SHALL return the error `navigation-timeout`.
9.4. WHEN the whole capture, counted from the start of `capturePage` and including the DNS check, takes longer than 45 s THE SYSTEM SHALL return the error `capture-timeout`.
9.5. WHEN less time remains in the whole-capture budget than a stage allows THE SYSTEM SHALL limit the stage to the remaining time and report `capture-timeout` if it expires.
9.6. WHEN the capture has ended THE SYSTEM SHALL give the stop call its own 10 s deadline, so the total stays under 60 s.
9.7. WHEN a deadline expires THE SYSTEM SHALL return without waiting for the pending operation to settle.
9.8. WHEN a deadline or limit is used THE SYSTEM SHALL take it from a named exported constant.

## 10. Settling and element collection

**User story:** As a detector author, I want a deterministic list of the elements that matter, so that detectors get the same view on every load.

**Acceptance criteria:**

10.1. WHEN navigation finishes with the `load` event THE SYSTEM SHALL wait the settle delay of 500 ms before reading the page.
10.2. WHEN a sample is read THE SYSTEM SHALL collect all element data and page metrics with one in-page evaluation.
10.3. WHEN the page is read THE SYSTEM SHALL collect elements that have their own visible text, `input`, `select`, `textarea` and `button` elements, the selected `option` of each `select`, `a` elements with `href`, `label` and `summary` elements, and elements with a `role` attribute.
10.4. WHEN an element is not a form control and has a rendered box of zero width or zero height THE SYSTEM SHALL skip it.
10.5. WHEN an element is `script`, `style`, `noscript`, `template` or `head`, or is inside `head`, THE SYSTEM SHALL skip it.
10.6. WHEN more eligible elements exist than the cap THE SYSTEM SHALL keep the first ones in document order, record `elementsTruncated` and the eligible count in the capture metadata, and add the warning `elements-truncated`.
10.7. WHEN a full sample is read THE SYSTEM SHALL cap the elements at 1,500 and the text at 300 characters per element.
10.8. WHEN the text of an element exceeds the text cap THE SYSTEM SHALL cut it at the cap and set `textTruncated` on that element.
10.9. WHEN the text of an element is read THE SYSTEM SHALL collapse whitespace and use the own text nodes for plain text elements and the visible text of the subtree for controls, links, labels, summaries and role elements.
10.10. WHEN an element is collected THE SYSTEM SHALL give it the id `el-` followed by its element-child indices from `<html>` joined by `-`, so the same element has the same id in the first and the reload sample while the DOM is unchanged.
10.11. WHEN an element is collected THE SYSTEM SHALL record `attributes` limited to `disabled`, every `aria-*`, `data-testid`, `type`, `name`, `href`, `for`, `placeholder` and `value`, each cut at 200 characters.
10.12. WHEN an element is not a checkbox, radio, submit, button or reset input, a `button` or an `option` THE SYSTEM SHALL omit its `value`.
10.13. WHEN an element is collected THE SYSTEM SHALL record the seven computed-style strings named by `ElementSnapshotSchema`, `checked` and `selected`.

## 11. Geometry and page metrics

**User story:** As a detector author, I want boxes in one coordinate system, so that they line up with the screenshot.

**Acceptance criteria:**

11.1. WHEN a box is recorded THE SYSTEM SHALL store `getBoundingClientRect()` plus `scrollX` and `scrollY` as document CSS pixels.
11.2. WHEN boxes are read THE SYSTEM SHALL read them inside the same evaluation as the other element data and not with per-element Playwright calls.
11.3. WHEN a sample is stored THE SYSTEM SHALL record the viewport size from `innerWidth` and `innerHeight`, the document size from `scrollWidth` and `scrollHeight`, and in the capture metadata `devicePixelRatio`, `scrollX` and `scrollY`.
11.4. WHEN page geometry is needed THE SYSTEM SHALL read it from the page and not depend on `viewportSize()`.
11.5. WHEN a number from the page is not finite THE SYSTEM SHALL replace it with 0, and a negative width or height with 0.
11.6. WHEN a number is stored THE SYSTEM SHALL round it to two decimals.

## 12. Screenshot

**User story:** As a user of the later results page, I want screenshots from the same load as the boxes, so that markers sit on the right elements.

**Acceptance criteria:**

12.1. WHEN a screenshot is taken THE SYSTEM SHALL request JPEG at quality 70 with `scale: "css"`.
12.2. WHEN the capture uses single mode and the document is at most 8,000 CSS px tall THE SYSTEM SHALL capture the whole document as one image using a clip of the document size.
12.3. WHEN the capture uses single mode and the document is taller than 8,000 CSS px THE SYSTEM SHALL capture the top 8,000 px as one image with a clip, set `truncated` in the capture metadata and keep the real height in `fullHeight`.
12.4. WHEN the clip is planned THE SYSTEM SHALL use the viewport width, rounded up, as the image width.
12.5. WHEN no image covers any part of the box of an element THE SYSTEM SHALL keep the element and set `outsideImage` on it.
12.6. WHEN the first sample has been read THE SYSTEM SHALL take the screenshots from the same load before any reload.
12.7. WHEN the sum of the base64 lengths of all images would exceed 4,194,304 characters THE SYSTEM SHALL return the error `screenshot-too-large`.
12.8. WHEN the first screenshot call fails THE SYSTEM SHALL return the error `screenshot-failed`.
12.9. WHEN the images do not cover the whole document THE SYSTEM SHALL add the warning `screenshot-truncated`.
12.10. WHEN the capture succeeds THE SYSTEM SHALL return `images`, an ordered array of JPEG images, each with `offsetY` (the document Y of its top edge), `width`, `height`, `bytes` and `base64Length`, sizes in CSS px, so a single-image capture has `images.length === 1`.
12.11. WHEN the base64 size of an image is computed THE SYSTEM SHALL use `4 × ceil(byteLength / 3)` and not encode the image.
12.12. WHEN the capture succeeds THE SYSTEM SHALL record the mode, the `truncated` flag and the `offsetY`, `width` and `height` of every image in `capture.images` of the snapshot.

## 13. Second sample after a reload

**User story:** As a detector author, I want a second read after a reload, so that countdowns and counters can be compared.

**Acceptance criteria:**

13.1. WHEN the first sample and the screenshots are done and at least 12 s of the whole-capture budget remain THE SYSTEM SHALL reload the page in the same session.
13.2. WHEN fewer than 12 s remain THE SYSTEM SHALL skip the reload and add the warning `reload-skipped`.
13.3. WHEN the reload finishes THE SYSTEM SHALL wait the settle delay before reading.
13.4. WHEN the reload sample is read THE SYSTEM SHALL use a cap of 750 elements, a text cap of 120 characters and only the attributes `type`, `name`, `disabled` and `data-testid`, and every field required by the schema SHALL still be present.
13.5. WHEN the reload sample is read THE SYSTEM SHALL not take a screenshot.
13.6. WHEN the reload sample is stored THE SYSTEM SHALL put it in `afterReload` and leave `secondSample` unset.
13.7. WHEN the reload navigates THE SYSTEM SHALL limit it to the smaller of 15 s and the remaining budget.
13.8. WHEN the reload fails for any reason, including a block, a timeout, an expired whole-capture deadline, a read failure or an invalid sample, THE SYSTEM SHALL return the snapshot without `afterReload` and add the warning `reload-failed`.
13.9. WHEN the reload fails THE SYSTEM SHALL still return `ok: true` for the first capture.

## 14. Backward-compatible schema extension

**User story:** As a developer, I want the snapshot schema to hold the new capture data without breaking existing code, so that detectors and fixtures keep working.

**Acceptance criteria:**

14.1. WHEN an element snapshot carries `attributes`, `textTruncated` or `outsideImage` THE SYSTEM SHALL accept them as optional fields of `ElementSnapshotSchema`.
14.2. WHEN a base snapshot carries `capture` THE SYSTEM SHALL accept it as an optional `CaptureMetaSchema` object with `devicePixelRatio`, `scrollX`, `scrollY`, `eligibleElementCount`, `elementsTruncated`, `light` and an optional `images` object with `mode`, `truncated` and a list of `offsetY`, `width` and `height` items.
14.3. WHEN a snapshot of the old shape, without any new field, is parsed THE SYSTEM SHALL accept it unchanged.
14.4. WHEN a new field has the wrong type or an out-of-range value THE SYSTEM SHALL reject the snapshot.
14.5. WHEN the extension is in place THE SYSTEM SHALL keep every test in `tests/types/schemas.test.ts` and every existing snapshot fixture passing.
14.6. WHEN the extension is in place THE SYSTEM SHALL leave the name, type and requiredness of every existing field unchanged.

## 15. Validation, result shape, errors and warnings

**User story:** As the author of the later scan route, I want one typed result that never throws for expected failures, so that the route can map outcomes without try/catch.

**Acceptance criteria:**

15.1. WHEN a capture completes THE SYSTEM SHALL validate the snapshot with `PageSnapshotSchema` before returning it.
15.2. WHEN validation fails THE SYSTEM SHALL return the error `snapshot-invalid`.
15.3. WHEN the capture succeeds THE SYSTEM SHALL return `ok: true` with the snapshot, the images and the warnings.
15.4. WHEN the capture fails THE SYSTEM SHALL return `ok: false` with an error holding a code and a safe message, and the warnings collected so far.
15.5. WHEN an expected failure occurs THE SYSTEM SHALL return it as a result and not throw.
15.6. WHEN an unexpected exception occurs THE SYSTEM SHALL return the error `internal-error`.
15.7. WHEN an error is returned THE SYSTEM SHALL use a code from the closed union and a fixed message for that code, never text from the page.
15.8. WHEN a browser or network failure is returned THE SYSTEM SHALL add an optional `detail` that is redacted, whitespace-collapsed and at most 200 characters.
15.9. WHEN a warning is returned THE SYSTEM SHALL use a code from the closed union and a fixed message for that code.
15.10. WHEN a snapshot is built THE SYSTEM SHALL set `url` to the final page URL and `capturedAt` to the ISO time from the injected clock.
15.11. WHEN the final URL differs from the requested URL, ignoring the fragment, THE SYSTEM SHALL add the warning `redirected`.
15.12. WHEN `capturePage` is called THE SYSTEM SHALL take `getBrowser`, `Resolver`, the clock and the configuration from injected dependencies and use real defaults only for dependencies not supplied.

## 16. Secrets and redaction

**User story:** As the app owner, I want the API key and session addresses kept out of every output, so that nothing sensitive leaks to users or logs.

**Acceptance criteria:**

16.1. WHEN a result is serialised to JSON THE SYSTEM SHALL contain no API key, `cdpUrl`, `liveUrl` or session id.
16.2. WHEN the library runs THE SYSTEM SHALL write nothing to the console or any log.
16.3. WHEN text is redacted THE SYSTEM SHALL remove every `ws://` and `wss://` URL.
16.4. WHEN text is redacted THE SYSTEM SHALL remove every `*.cdp.browser-use.com` host string.
16.5. WHEN text is redacted THE SYSTEM SHALL replace every exact occurrence of the known secrets: the API key, session id, `cdpUrl` and `liveUrl`.
16.6. WHEN error text is used for `detail` THE SYSTEM SHALL redact it first.
16.7. WHEN a browser or network failure becomes an error THE SYSTEM SHALL not copy the raw exception message into `message`.

## 17. Untrusted page content

**User story:** As a downstream author, I want it stated that snapshot text is untrusted, so that nothing acts on page content as an instruction.

**Acceptance criteria:**

17.1. WHEN page text or attributes are collected THE SYSTEM SHALL treat them as data only: length-capped, never evaluated and never used to build selectors, URLs or shell input.
17.2. WHEN the snapshot type and `capturePage` are documented THE SYSTEM SHALL state that every consumer, in particular the LLM judge, must treat snapshot text as untrusted input.
17.3. WHEN the in-page result is received THE SYSTEM SHALL re-apply the caps and the attribute allowlist outside the page and drop malformed elements.

## 18. Environment configuration

**User story:** As the app owner, I want the environment validated once, so that a bad setting fails clearly and early.

**Acceptance criteria:**

18.1. WHEN the configuration is parsed THE SYSTEM SHALL validate an injected environment object with zod and not read `process.env` itself.
18.2. WHEN `CAPTURE_BROWSER_MODE` is `remote` and `BROWSER_USE_API_KEY` is missing THE SYSTEM SHALL return the error `config-invalid`.
18.3. WHEN `BROWSER_USE_PROXY` is `on` or `off` THE SYSTEM SHALL accept it, WHEN it is unset THE SYSTEM SHALL use `off`, and WHEN it has another value THE SYSTEM SHALL return `config-invalid`.
18.4. WHEN `BROWSER_USE_SESSION_TIMEOUT_MINUTES` is an integer from 1 to 5 THE SYSTEM SHALL accept it, WHEN it is unset THE SYSTEM SHALL use 2, and WHEN it has another value THE SYSTEM SHALL return `config-invalid`.
18.5. WHEN `CAPTURE_BROWSER_MODE` is unset THE SYSTEM SHALL use `remote`.
18.6. WHEN a variable is an empty or whitespace-only string THE SYSTEM SHALL treat it as unset.
18.7. WHEN `NEXT_PUBLIC_APP_URL` is set to something other than a valid http or https URL THE SYSTEM SHALL return `config-invalid`.
18.8. WHEN a configuration error is returned THE SYSTEM SHALL name the variables at fault and never their values.
18.9. WHEN the configuration is requested from the real environment THE SYSTEM SHALL validate it once and reuse the result.
18.10. WHEN the configuration module is imported THE SYSTEM SHALL import `server-only`.
18.11. WHEN `.env.example` is updated THE SYSTEM SHALL remove `BROWSER_CDP_ENDPOINT`, list the four new names with empty values and one comment line each that states the default, and contain no placeholder value.

## 19. Dependencies and Vercel file tracing

**User story:** As the app owner, I want exactly two pinned packages and a working Vercel bundle, so that the build is reproducible and the function starts.

**Acceptance criteria:**

19.1. WHEN `package.json` is read THE SYSTEM SHALL list `playwright-core` at exactly `1.64.1` and `server-only` at exactly `0.0.1` under `dependencies`, with no range prefix.
19.2. WHEN packages are installed THE SYSTEM SHALL use `--save-exact` and never `@latest`.
19.3. WHEN this spec is finished THE SYSTEM SHALL have added no dependency other than those two, no vendor SDK, no `@sparticuz/chromium-min` and no local Chromium download.
19.4. WHEN `next.config.ts` is loaded THE SYSTEM SHALL set `outputFileTracingIncludes` for the route `/api/scan` to `["./node_modules/playwright-core/**/*"]`.
19.5. WHEN `next.config.ts` is loaded THE SYSTEM SHALL keep every other existing setting unchanged.
19.6. WHEN `next.config.ts` lists the tracing key THE SYSTEM SHALL carry a comment naming `lib/capture` and saying that every route importing it must be listed there.

## 20. Tests

**User story:** As a developer, I want fast offline tests with an opt-in live check, so that CI never touches a network.

**Acceptance criteria:**

20.1. WHEN the unit tests run THE SYSTEM SHALL use only fakes and open no network connection, no real browser and no import of `playwright-core`.
20.2. WHEN URL safety is tested THE SYSTEM SHALL cover at least 40 allowed and blocked cases, including DNS results injected through `Resolver` (IPv4, IPv6, mapped IPv6), decimal, octal and hex spellings, userinfo, odd ports, long URLs, `.local`, `.internal` and `localhost` names, metadata addresses, public hosts and the allow entry.
20.3. WHEN redaction is tested THE SYSTEM SHALL cover `ws://`, `wss://`, `*.cdp.browser-use.com`, the API key and the other known secrets.
20.4. WHEN geometry is tested THE SYSTEM SHALL cover document-pixel conversion, the single-image height cap, the mode choice at 29,999, 30,000 and 30,001 with device pixel ratios 1 and 2, tile planning (count, cap of 10, overlap of the last tile, truncated or not), the base64 sum at its boundary and the outside-image flag against several images.
20.5. WHEN deadlines are tested THE SYSTEM SHALL cover each of the four deadlines with a controlled clock.
20.6. WHEN session stopping is tested THE SYSTEM SHALL assert exactly one stop call after create-then-connect failure, navigation failure, navigation timeout, read failure, screenshot failure, validation failure, whole-capture deadline, success and a failing stop.
20.7. WHEN validation is tested THE SYSTEM SHALL parse a fake capture with `PageSnapshotSchema` and cover an invalid one.
20.8. WHEN configuration is tested THE SYSTEM SHALL cover every rule of requirement 18 with injected environment objects.
20.9. WHEN a test imports a module that imports `server-only` THE SYSTEM SHALL neutralise it with `vi.mock("server-only", () => ({}))` and leave `vitest.config.ts` unchanged.
20.10. WHEN the live integration test file is loaded THE SYSTEM SHALL skip it unless `RUN_REMOTE_CAPTURE=1`, the API key and `NEXT_PUBLIC_APP_URL` are all set, and it SHALL print no key, `cdpUrl`, `liveUrl` or session id.
20.11. WHEN a test file is written THE SYSTEM SHALL contain no JSX and be written before the code it covers.
20.12. WHEN tiled mode is tested with the fake browser THE SYSTEM SHALL assert that no full-page or clipped screenshot call is made and that the page is scrolled back to the top.

## 21. Steering notes and lint

**User story:** As a future contributor, I want the steering files to describe `lib/capture`, so that later specs build on the same rules.

**Acceptance criteria:**

21.1. WHEN the last task runs THE SYSTEM SHALL add notes to `tech.md` and `structure.md` on the contents of `lib/capture`, the implemented mode, the environment names, the rule that `playwright-core` is imported only in `lib/capture`, and that page text is untrusted.
21.2. WHEN the notes are added THE SYSTEM SHALL delete no other steering content.
21.3. WHEN the last task ends THE SYSTEM SHALL pass `npm run lint`.

## 22. Tiled screenshots for tall pages

**User story:** As a user of the later results page, I want tall pages captured as viewport tiles, so that the capture does not stall on documents that a single image cannot handle.

**Acceptance criteria:**

22.1. WHEN `fullHeight × devicePixelRatio` is at most 30,000 THE SYSTEM SHALL use single mode.
22.2. WHEN `fullHeight × devicePixelRatio` is above 30,000 THE SYSTEM SHALL use tiled mode.
22.3. WHEN the capture uses tiled mode THE SYSTEM SHALL make no full-page screenshot call and no clipped screenshot call that reaches beyond the viewport.
22.4. WHEN the capture uses tiled mode THE SYSTEM SHALL read the elements of the first sample before the first scroll.
22.5. WHEN the capture uses tiled mode THE SYSTEM SHALL scroll to the top and take viewport-only JPEG screenshots at quality 70 with `scale: "css"`, scrolling by the viewport height between tiles.
22.6. WHEN the capture uses tiled mode THE SYSTEM SHALL take at most 10 tiles, counted from the top.
22.7. WHEN a tile is taken THE SYSTEM SHALL record the `scrollY` read back from the page after scrolling as the `offsetY` of that tile.
22.8. WHEN the browser clamps the final scroll THE SYSTEM SHALL record the clamped offset, so the last tile may overlap the previous one.
22.9. WHEN the last tile has been taken THE SYSTEM SHALL scroll back to the top.
22.10. WHEN the capture uses tiled mode THE SYSTEM SHALL add the warning `tall-page-tiled`.
22.11. WHEN the tiles do not reach the bottom of the document THE SYSTEM SHALL set `truncated`.
22.12. WHEN the tiles reach the bottom of the document THE SYSTEM SHALL not set `truncated`.
22.13. WHEN at least one tile covers part of the box of an element THE SYSTEM SHALL not set `outsideImage` on that element.
22.14. WHEN scroll steps and tile screenshots run THE SYSTEM SHALL count them against the 45 s whole-capture deadline.
22.15. WHEN fewer than 3 s of the whole-capture budget remain before a further tile THE SYSTEM SHALL stop, keep the tiles taken so far, set `truncated` and add the warning `screenshot-truncated`.
22.16. WHEN a tile after the first fails THE SYSTEM SHALL keep the tiles taken so far, set `truncated` and add the warning `screenshot-truncated`.
22.17. WHEN the first tile fails THE SYSTEM SHALL return the error `screenshot-failed`.
22.18. WHEN the seam is declared THE SYSTEM SHALL offer a `scrollTo(y)` method that returns the real `scrollY` and a viewport-only screenshot request, without any Playwright type, and the fake browser SHALL implement both.
