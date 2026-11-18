# Page capture: second review (fix round)

- **Scope.** Worktree `scratchpad/tot-capture`, branch `feat/page-capture`, head `35fcdfa`. Fix round `c35403a..35fcdfa` (14 commits), spec `.kiro/specs/page-capture-fixes/`. Answers the first review, [[page-capture-review]].
- **Date and access.** 2026-11-18. Read-only for the repo: no file in the worktree was edited. `git status --short` was empty before and after. Probes ran from a scratch Vitest config that aliases `@/` to the worktree and `server-only` to an empty module.
- **Evidence.** Everything below sits in session scratch, which can be cleared: the reviewer's scratch directory, written here as `$R2/`. Probes are in `$R2/probes/` and outputs in `$R2/live/`.
- **Live budget.** 12 Browser Use sessions out of 12:
  - 8 from my probes. One was wasted: the page `neverssl.com` redirects with JavaScript and the navigation timed out.
  - 4 from the repo's live test.

  Every session was created with a 1-minute timeout and no proxy, and every session read back `stopped`. Afterwards `GET /api/v4/browsers?filterBy=active` returned `totalItems: 0`. The account holds 12 sessions tagged `trick-or-trap`, all stopped, and all of them mine.
- **Secrets.** The key was loaded only through `node --env-file`. All console output went through a redaction filter. Every saved JSON passed a leak check against the key, each session id, `cdpUrl` and `liveUrl`, and `browser-use.com` / `wss://`. The check found 0 hits. For `capturePage` itself, the full result JSON of the Wikipedia run was checked: clean.

## Verdict

**Fix first, then merge.** No critical finding, and most of the first review is fixed.

Confirmed live:
- the redirect hop guard: `navigation-blocked` within 5 s, through the repo's own live test;
- the isolated-world collector: it was unaffected by main-world overrides of `getBoundingClientRect`, `substring`, `replace`, `devicePixelRatio` and `getComputedStyle`;
- box alignment: pixel-exact on synthetic pages, in single and tiled mode.

Confirmed offline: the size caps.

But the child-target part of the request guard does not work with the real Playwright, and the result is worse than unguarded:
- A Playwright `CDPSession` ignores the third `send` argument and drops events from child sessions.
- So every cross-site iframe and every dedicated worker that the page session auto-attaches stays paused forever.
- A page that embeds a cross-site iframe before `load` never fires `load`, and the capture ends in `navigation-timeout`. Without the guard the same page loaded in 0.4 s. Most real shops embed such iframes (payment, video, chat and ad widgets); that impact is inferred, not tested on a real shop.
- A blob worker that ran without the guard did not run with it.
- The unit tests pass only because the fake `CDPSession` honours the argument.

This is criterion 2.x / task 9 marked done, it breaks the module's main use, and the design itself said to verify it live first. It should gate the merge even though nothing in `main` calls `lib/capture` yet.

The other new findings gate the public scan route, not the merge:
- DOM clobbering defeats the isolated-world collector;
- SharedWorker, popup and WebSocket requests bypass the guard;
- the session sweep and reclaim query a filter the vendor ignores.

## Findings of the first review

| ID | Finding | Status | Evidence |
|---|---|---|---|
| H1 | Redirect hops unguarded | **Fixed (live)** | CDP `Fetch` at request stage (`request-guard.ts:31,185`). The repo live test "refuses a public redirect to a blocked port" passed: `navigation-blocked` plus `request-blocked` in ≤ 5 s. |
| H2 | Sub-resources, frames, WebSockets, SW not checked | **Partly fixed** | Live, on the page session:<br>- paused and refused: XHR, beacon (`Ping`) and CORS preflight (`OPTIONS`) to a blocked port (P1c); a same-site iframe (`portquiz.net` to `:8080`, P1c); a cross-site iframe to `http://example.com:8080/` (P5, `url-port-blocked`, error page loads);<br>- paused and continued: allowed images and the example.org iframe's document.<br>Not covered, live: SharedWorker fetch, popup navigation and WebSocket (N3). Cross-site iframe content and dedicated workers are not guarded either: they hang (N1). |
| H3 | Snapshot size unbounded | **Fixed (offline probe)** | Caps in the page (`extractor.ts:45-193`, run in an isolated world) and again in `buildSample`. `MAX_SNAPSHOT_BYTES` 1.5 MB is checked before validation (`capture.ts:435-439`). Probe `u2-caps`: 5,000 hostile raw elements (1 MB role, text and style strings, 2,000 attributes, 256-deep paths of 99,999) became 1,500 elements with `tag`/`role`/style ≤ 64, text ≤ 300, ≤ 32 attributes and id ≤ 1,538 characters. The total of 16.6 MB was then refused as `snapshot-too-large`. |
| H4 | Single-mode boxes misaligned (scrollbar) | **Fixed (live)** | `Emulation.setScrollbarsHidden` before any read (`remote-browser.ts:261`); `layoutWidth` 1280 in every live run. P1a: a 5,895 px page with a `100vh` hero, wrapping paragraphs and a marker at (300, 2500). The image is 1280×5895, and the marker sits at exactly (300, 2500)–(499, 2539) in pixels. At x = 640 the red `100vh` band runs to y 542 and green starts at 545: a 2 px JPEG transition around `innerHeight` 544. So the full-page screenshot did not re-lay out viewport units. P3 (tiled, 30,217 px, DPR 2): markers in tiles 0, 4 and 9 land at the document y of their boxes to the pixel. The real re-wrapping Wikipedia check could not be repeated: Wikimedia answered 429 (see N6). |
| M1 | Collector in the main world | **Fixed (live), but bypassable** | `Page.createIsolatedWorld` plus `Runtime.callFunctionOn` (`cdp.ts:59-86`); metrics from `Page.getLayoutMetrics` (`cdp.ts:93-106`). P5 overrode, in the main world, `Element.prototype.getBoundingClientRect`, `String.prototype.substring` and `replace`, `devicePixelRatio` (0) and `getComputedStyle` (throws). `collect` still returned real rects, text ≤ 300, real colours and DPR 1.25. DOM clobbering still breaks it (N2). |
| M2 | Orphan sessions | **Partly fixed** | An id without `cdpUrl` is now stopped (`browser-use-api.ts:162-171`). The vendor accepts `metadata` (live: `{app, captureId}` read back). Reclaim and sweep query `?status=active`, which the vendor ignores (N4). |
| M3 | Tests prove the fake | **Partly fixed** | jsdom DOM tests now cover `collectInPage`. New fakes again prove themselves (see Weak tests). |
| M4 | Session id and `liveUrl` reach `detail` via `installGuards` | **Fixed** | `installGuards` wraps errors with the full secret list (`remote-browser.ts:139-146`); `finalise` redacts with `handle.secrets()` (`capture.ts:147-161`). |
| L1 | Stop budget shorter than the stop chain | **Fixed** | `PATCH` first, then the disconnect gets the rest of the 10 s (`remote-browser.ts:269-288`). Live stops took 0.6–0.85 s. |
| L2 | Late stop fire-and-forget | **Fixed** | `deps.waitUntil` (`capture.ts:72,112-118,291-294,478`). Live P2 called it once. |
| L3 | 2-minute default timeout | **Fixed** | Default 1 minute (`constants.ts:109`). |
| L4 | `isOutsideImages` edge cases | **Fixed** | `overlapsAxis` (`geometry.ts:144-156`). |
| L5 | Mode depends on DPR | **Fixed** | Threshold in CSS px (`geometry.ts:104-106`). DPR still varies by session (seen live: 1, 1.25, 2), which changes tile time and bytes but not boxes (`scale: "css"`). |
| L6 | No reason code on `request-blocked` | **Fixed** | `reason` and `count` on the warning (`capture.ts:151-154`). |
| L7 | Allow entry adds no value / misconfig risk | **Fixed** | `allowOrigin` is parsed but used nowhere; a config whose origin is a blocked name or address is rejected (`config.ts:45-48,62-67`). |
| L8 | `detail` carries page-controlled text | **Documented** | Doc comment `capture.ts:454-457`. The route spec must enforce it. |
| L9 | `localhost..`, final URL > 2,048 | **Fixed** | Every trailing dot stripped (`url-check.ts:36`), hop limit 8,192 (`constants.ts:69`). Probe `u1`: `localhost..`, `foo.localhost.` and `metadata.google.internal.` are blocked. |

Also noted in the first review: HTTP 4xx/5xx is captured without a warning. Still true, now seen live (N6).

URL forms through the real guard decision path (probe `u1`, `$R2/live/u1-guard-urls.txt`):
- **Blocked:** decimal, octal, hex and short IPv4; IPv4-mapped and NAT64 IPv6; ULA; `169.254.169.254.`; userinfo; port 8080; `filesystem:`, `chrome:`, `ftp:`, `ws:`; a name resolving to 10.x.
- **Allowed:** `:443` on `http` (by spec); `data:`, `blob:` and `about:` (pass-through, no network).

## New findings

### N1. High. Child targets (cross-site iframes, dedicated workers) are attached paused and never resumed, so pages with a cross-site iframe time out, and child requests are not guarded

- **Where.**
  - `request-guard.ts:139-166` sends `Fetch.enable`, `Target.setAutoAttach` and `Runtime.runIfWaitingForDebugger` with a child `sessionId` as the third argument.
  - `remote-browser.ts:85` forwards it.
  - `remote-browser.ts:88` never passes a `targetSessionId` to events.
- **Why it fails.** playwright-core 1.64.1:
  - The client `CDPSession.send(method, params)` takes two arguments (`node_modules/playwright-core/lib/coreBundle.js:59026-59029`), so all three commands go to the page session and succeed there as no-ops.
  - The server routes messages by `sessionId` and drops those for sessions it did not create (`coreBundle.js:36306-36308`), so a child's `Fetch.requestPaused` never reaches the guard.
  - Our auto-attach uses `waitForDebuggerOnStart: true`, so Chromium keeps each child paused until our session resumes it, which never happens.
- **Confirmed live, with a control.**
  - P1a: a `data:` page with `<iframe src="https://example.org/">` and the guard installed ended in `navigation-timeout` at 12 s. Playwright saw only the main frame. The CDP log shows `Target.attachedToTarget {type: iframe, waitingForDebugger: true}` followed by the three "child" commands, each `ok` on the page session.
  - P1b control, same session before `installGuards`: the same page loaded in 392 ms, with the example.org frame present.
  - P1b with the guard: a dynamically added cross-site iframe never fired `onload`.
  - A blob dedicated worker never ran: no reply in 5 s after `attachedToTarget {type: worker, waiting: true}`.
  - P5 control: the same worker answered `RAN` before `installGuards` and `NO-REPLY` after, in one session.
- **Impact.**
  - Functional: any shop that embeds a cross-site iframe before `load` cannot be captured. That covers Stripe, PayPal, YouTube, chat widgets and many tag managers. Pages that need workers render incompletely.
  - Security: fail-closed for these children, but only by accident. The design's claim that children get `Fetch` is false.
- **Fix.** Child sessions cannot be used through a Playwright `CDPSession` in flatten mode. None of the options below was tested.
  - **The design's fallbacks** (`design.md:263`):
    - `browser.newBrowserCDPSession()` builds the same `CDPSession` class on the root session (`coreBundle.js:36322-36325`), so flatten child messages hit the same drop at `:36306`. It does not help.
    - `context.newCDPSession(frame)` per out-of-process frame can address one frame. But Playwright resumes the frame on its own, so the frame's first requests can go out before our `Fetch.enable`. It also does not cover workers or popups.
  - **Better options:**
    1. Run the guard on its own raw CDP WebSocket connection to `cdpUrl`, where we own session routing, with browser-level `Target.setAutoAttach` (flatten) for `page`, `iframe`, `worker`, `shared_worker` and `service_worker`. This also fixes N3's SharedWorker and popup gaps. It needs the vendor to accept a second CDP client.
    2. Use `Target.setAutoAttach({ flatten: false })` and drive children with `Target.sendMessageToTarget` / `receivedMessageFromTarget`. This mode is deprecated; check that the vendor's Chromium still supports it.

  Whichever is chosen, verify it live with the P1a, P1b and P5 pages. As a stopgap, a page-level auto-attach without a working resume must not ship.

### N2. High (product integrity). DOM clobbering defeats the isolated-world collector

- **Where.** The collector reads DOM properties directly: `el.tagName.toLowerCase()` (`extractor.ts:67`), `el.children` (`:71`), `el.childNodes` (`:102`), and also `getAttribute`, `hasAttribute`, `attributes` and `getBoundingClientRect`. `<form>` named properties (`[LegacyOverrideBuiltIns]`) shadow these in every world, the isolated one included.
- **Probed live:** `tagName`, `children` and `attributes`.
- **From reading only:** `childNodes`, `getAttribute`, `hasAttribute` and `getBoundingClientRect` are exposed the same way.
- **Confirmed live** (P1a, P4).
  - `<form><input name="tagName"></form>` anywhere on the page makes `collect` throw (`TypeError: el.tagName.toLowerCase is not a function`), so the capture fails with `page-read-failed`. One line of HTML, and the shop cannot be scanned.
  - `<input name="children">` in a form makes the collector skip the form's whole subtree, silently.
    - P1a: the same added form gave 17 collected elements with `name="attributes"` and 15 with `name="children"`. The form's input and its text span were dropped.
    - P4: a "Hurry, 3 people are viewing this" paragraph inside such a form was absent from the read; the screenshot would still show it.
  - `name="attributes"` had no visible effect.
  - Clobbering `documentElement` on `document` with `<img name=documentElement>` had no effect (checked live).
- **Fix.** In the collector, read through the prototype getters and methods of the isolated world, for example:
  - `Object.getOwnPropertyDescriptor(Element.prototype, "tagName").get.call(el)`;
  - the same pattern for `children` and `attributes`, `Node.prototype.childNodes` and `HTMLElement.prototype.innerText`;
  - `Element.prototype.getAttribute.call(el, ...)`, `hasAttribute` and `getBoundingClientRect` the same way.

  Add jsdom tests with clobbering forms (`tagName`, `children`, `childNodes`, `attributes`, `getAttribute`, `getBoundingClientRect`) and a live assertion.

### N3. Medium (security). SharedWorker, popup and WebSocket traffic bypasses the guard; blind SSRF remains

- **SharedWorker, live** (P1c and P1b). A blob SharedWorker did `fetch("http://portquiz.net:8080/", {mode: "no-cors"})`. It resolved (`LOADED`) and no `Fetch.requestPaused` was logged. The same fetch from the page was refused (`url-port-blocked`). The design's residual-risk list does not mention shared workers.
- **Popup, live** (P1b). `window.open("http://portquiz.net:8080/?popup")` opened. `popup-closed` was reported, but no paused request appeared for the popup's navigation. This is a regression from the old `context.route`, which covered pop-up main frames. The design lists it as unverified.
- **WebSocket, live** (P1c). `new WebSocket("ws://portquiz.net:8080/")` ended `close 1006` with no paused request: the guard never sees WebSocket handshakes. The design's residual-risk statement ("WebSocket … which the Fetch domain does not report") is **accurate**. WebRTC, preconnect and DNS rebinding are stated too; rebinding is accurate because our resolver and the browser's resolver are independent.
- **Service worker.** Not tested live: it needs a same-origin script. A SW's own fetches (for example in `install`) run in a browser-level target that page-level auto-attach does not reach. The design's sentence "service-worker-handled requests are covered because they are bypassed" is true only for the page's requests, not for the worker's own.
- **Impact.** Any public page can make the vendor's browser send GET and simple POST requests to blocked ports and addresses. A response is readable only where the target allows CORS. This is the same exposure class as the first review's H2: the vendor's network and our account's reputation.
- **Fix.**
  - Browser-level auto-attach on a raw connection (N1 option 1), covering `shared_worker`, `service_worker` and `page` (popups).
  - For WebSocket, WebRTC and rebinding, the real control remains an egress-filtering proxy (`customProxy`).
  - Add SharedWorker and popup to the residual-risk list until then.

### N4. Medium. Reclaim and sweep list with `?status=active`, which the vendor ignores

- **Where.** `browser-use-api.ts:16`, used by `reclaimSession` (`:256-268`) and `sweepStaleSessions` (`:290-306`).
- **Confirmed live**, counts only:
  - `?status=active` returned `totalItems: 30`, all `stopped`, page size 10.
  - `?filterBy=active` returned 0, the correct number.
  - `?filterBy=stopped` returned 30.
  - The response keys are `items`, `pageNumber`, `pageSize` and `totalItems`; items carry `metadata` (`app`, `captureId`) and `startedAt`, so the parser and the age field are right.
- **Impact.** Both functions see only the first page: 10 sessions of any status. The ordering was not checked; the only evidence is that the session just created was on page 1.
  - Reclaim misses an orphan when 10 newer sessions exist, which is likely under concurrency.
  - The sweep sends `PATCH stop` to already-stopped tagged sessions older than 2 minutes and never sees active orphans past page 1.
  - Both "never reject", so this fails silently.
- **Fix.** Use `?filterBy=active` and page through `pageNumber` (or a larger `pageSize`). Add a test that pins the query string, and a live assertion in the opt-in test.

### N5. Low. The opt-in live test cannot run as written, and two of its checks are weak

- The whole file is skipped unless `NEXT_PUBLIC_APP_URL` is set (`remote-capture.test.ts:43-47`), although three of its cases do not need Boo-tique. It is not set in the local `.env`.
- Task 13.3 told the driver not to run it, so the fix round's live claims were never checked.
- I ran it once with `NEXT_PUBLIC_APP_URL=https://example.com`: **4 passed, 1 skipped** (the iframe case; 36.9 s).
- The iframe case needs an owner-hosted page and is skipped by default. It was the one check that would have caught N1.
- The example.com alignment assertion (`:168-184`) compares the box centre with half the *planned* image width. Both come from the same layout width, so for centred content it passes even with the old scrollbar bug.
- **Fix.**
  - Gate each case on its own variable.
  - Self-host the iframe fixture as part of the Boo-tique app, or use a `data:`-driven adapter-level live test like P1a.
  - Check alignment against decoded pixels, as P1a and P3 do.

### N6. Low. Error pages are captured as success, and the reload sample can be a different page

- **Live** (P2, Wikipedia "Jack-o'-lantern"). The first load was Wikimedia's HTTP 429 page: 11 elements, image 1280×611. The reload got the article: 750 elements in `afterReload`.
- The result was `ok: true` with **no warnings**, so a detector would compare an error page with an article.
- **Fix.** Record the main-document status (Playwright `response.status()`) and warn or fail at 400 and above. Warn when the reload's URL or element count differs sharply.

### N7. Low. Document requests skip the host limit, so DNS lookups per capture are unbounded

- `request-guard.ts:95` exempts `Document` requests from `MAX_REQUEST_HOSTS`. Every new document origin triggers a DNS lookup from our function (`capture.ts:248-260`), and the verdict map has no size cap.
- A page that creates thousands of iframes to random sub-domains turns our function into a DNS query generator for the whole capture budget.
- **Confirmed by:** reading.
- **Fix.** Count document hosts too, with a separate higher cap, for example 300.

### N8. Low. Tiled mode is slow and covers less than single mode

- **Confirmed by:** live probe P3.
- P3 (DPR 2): 10 tiles took 18.0 s and covered 5,880 of 30,217 px, against 8,000 px in single mode for any page up to 20,000 px.
- With create, connect and `goto` added, tall pages will usually get `reload-skipped`.
- The design accepts the coverage (risk 9). It should also state the time cost, or force DPR 1 for tiles (`Emulation.setDeviceMetricsOverride`).

### N9. Low. Content the collector cannot see

- The collector does not enter shadow roots (open or closed) or same-origin iframes. Text there is in the screenshot but not in the snapshot, which is a quiet evasion route alongside N2.
- A page can also push the snapshot over 1.5 MB with ordinary `aria-*` attributes: 32 × 200 characters per element.
- **Confirmed by:** reading; the size half by the offline probe `u2`.

**Route requirement.** The route must report every capture failure as "could not scan", never as "clean".

## Checked, no finding

- **Test hooks (`data-testid`).** Not collected. The collector keeps only the fixed allowlist (`disabled`, `type`, `name`, `href`, `for`, `placeholder`, `value`) plus `aria-*` (`extractor.ts:48-50,140`). `buildSample` applies the allowlist again and drops names holding the forbidden fragments (`extractor.ts:271-296`). The repo's live assertion on this ran against example.com, which has no such attribute, so it proves nothing by itself.
- **Layout drift re-read** (`capture.ts:414-428`).
  - What it does: after the screenshots, it re-reads with the light options under a 3,000 ms cap (`TILE_MIN_REMAINING_MS`) and compares boxes by element id (`maxBoxDrift`). Above 4 px it adds `layout-shifted`. It skips silently on failure or when time is short.
  - What it cannot catch: a re-layout that exists only during the screenshot. P1a showed none for `100vh` content.
  - It never fired in any live run.
- **Session stopped on every path.**
  - Live: success and `navigation-blocked` paths. All 12 sessions read back `stopped`.
  - From reading and unit tests only: the timeout and abort paths. `capturePage` stops in `finally` with its own 10 s budget and hands the promise to `waitUntil`. A late `connect` disconnects itself (`remote-browser.ts:254`). An aborted create triggers one reclaim, but see N4.
- **Secrets.** No key, session id, `cdpUrl` or `liveUrl` appeared in any result, `detail`, warning or probe output. All stage errors go through `toDetail` with the session's secret list, and `finalise` redacts once more (`capture.ts:147-161`).
- **URL forms** (probe `u1`). See the list under the table.

## Weak tests

- **`tests/capture/remote-browser.test.ts:116-124`.** The fake Playwright `CDPSession.send` forwards a third `targetSessionId` argument that the real one ignores. Every child-target behaviour is therefore proven only against the fake:
  - `tests/capture/request-guard.test.ts:339-411`: "enables Fetch and auto-attach on the child, then resumes it", "covers a nested target", "answers a paused request of a child session on that session".
  - `tests/capture/request-guard.test.ts:208`: "document request on a child session".

  This is the same pattern the first review named (M3).
- **`tests/capture/remote-capture.test.ts:168-184`.** The alignment check is tautological for centred content (N5).
- **`tests/capture/remote-capture.test.ts:186-198`.** The iframe case is skipped unless the owner hosts a fixture, so it has never run.
- **`tests/capture/collector-dom.test.ts:321-365`.**
  - It overrides `String.prototype.slice` and `getComputedStyle` in jsdom's main world. That says nothing about the isolated world. The isolated world, not the use of `substring`, is what protects the collector, because `substring` can be overridden just as easily.
  - No test covers DOM clobbering (N2).
- **`tests/capture/browser-use-api.test.ts:29` and `tests/capture/remote-browser.test.ts:1100`.** Both pin `?status=active` as the expected query, so the tests encode the vendor mistake (N4).

## Merge gating

- **Before merge:**
  - **N1.** It marks a criterion done that breaks capture of ordinary shops, and the fix needs a design choice and a live check.
  - **N5, its "never run" part.** Run the live test, at least the redirect, alignment and iframe cases, against a self-hosted fixture.
- **Before a public route uses the module:**
  - N2: a cheap fix; doing it in the same round is recommended.
  - N3: child and popup coverage through N1's fix, plus the egress proxy for WebSocket, WebRTC and rebinding.
  - N4: a one-parameter fix plus pagination.
  - From the first review: L8, so `detail` is never shown to users.
  - From N9: failures shown as "could not scan".
- **Nice to have:** N6, N7, N8, the rest of N9, and tightening the weak tests above.

## Not checked, and why

- **Service-worker own fetches, live.** They need a same-origin script, and I had no public test page that can serve one. Reasoned from target types only.
- **Whether the WebSocket handshake reached the blocked port.** Only that the guard never saw it; portquiz does not log.
- **Private or vendor-internal addresses, live.** Not touched, on purpose; only policy-blocked public endpoints were used (`portquiz.net:8080`, `example.com:8080` through httpbingo).
- **A real re-wrapping page for alignment.** Wikimedia returned 429 from the vendor's IP. Alignment was shown on synthetic `data:` pages through the real adapter instead.
- **Real shops.** Not loaded, per the brief. N1's real-world impact is inferred from the controlled iframe test.
- **CPU and memory under a huge DOM in the remote browser.** The collector walks the whole tree; this is bounded only by the 45 s budget.
- **`BROWSER_USE_PROXY=on`, `tsc`, lint, the full suite and `next build`.** These were driver-reported on this head: 1,672 passed, 5 skipped. I ran no repo test file other than `remote-capture.test.ts`.
- **Merge with current `main`.** Not re-run in this round.

## Sessions used

- **12 of 12:**
  - P1a: iframe load, alignment, clobbering;
  - P1b: control, workers, popup;
  - P1c: a wasted run, then the http page;
  - P2: Wikipedia;
  - P3: tiled;
  - P4: clobbering;
  - P5: worker control, cross-site blocked iframe, main-world overrides;
  - 4 from the repo's live test.
- **Status.** All `stopped`; 0 active at the end (`filterBy=active`).
