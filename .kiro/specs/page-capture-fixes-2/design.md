# Design: Page Capture Fixes 2

This spec answers the second review (`docs/research/page-capture-review-2.md`, findings N1 to N9) with the request-guard design of the spike (`docs/research/page-capture-guard-spike.md`). Both were written by Claude review and spike agents, not by Kiro. Every claim of the notes that this design relies on was checked against the code at the head of `feat/page-capture`; where the code differs, the code wins and "Where the code differs from the notes" says so. The specs `page-capture` and `page-capture-fixes` stay as they are; this spec changes their code.

Rule kept from `page-capture-fixes`: the name of the test-id attribute (the HTML attribute "data-" plus "test" plus "id") is never written in `lib/capture`, `lib/capture-fixture`, `app/capture-fixture`, `tests/capture` or this spec. Tests build it from parts in `tests/capture/helpers/forbidden-attribute.ts`.

## Finding to requirements to tasks

| Finding | What | Requirements | Tasks |
|---|---|---|---|
| N1 | Child targets attached paused and never resumed | 1.1 to 1.11, 2.1 to 2.11, 11.1 to 11.11 | 1, 4, 6 |
| N1 (loss) | Losing the guard fails open | 4.1 to 4.12, 5.1 to 5.5 | 2, 4, 5, 6 |
| N3 | SharedWorker, popup and WebSocket bypass the guard | 1.2 to 1.4, 3.1 to 3.4, 6.1 to 6.15, 7.1 to 7.5, 18.1 to 18.6 | 4, 7, 8 |
| N2 | DOM clobbering defeats the collector | 9.1 to 9.7, 17.15 | 10, 17 |
| N4 | Reclaim and sweep use an ignored filter | 10.1 to 10.11, 17.16 | 11, 17 |
| N5 | Live test cannot run as written; weak checks | 15.1 to 15.14, 16.1 to 16.8, 17.1 to 17.20 | 14, 15, 16, 17 |
| N6 | Error pages captured as success | 12.1 to 12.8, 13.1 to 13.5 | 12, 13 |
| N7 | Document hosts skip the host limit; cache unbounded | 8.1 to 8.7 | 9 |
| N8 | Tiled mode slow, less coverage | none (limitation below) | none |
| N9, L8 | Blind spots; failures must read "could not scan" | 14.1 to 14.8 (rest is a limitation below) | 2, 3 |
| Housekeeping | `.env.example`, steering, text rules | 19.1 to 19.9 | 15, 18 |

## Differences from the notes

| Item | Notes | This spec | Why |
|---|---|---|---|
| New reason codes | Spike: `service-worker-blocked` as a new `UrlErrorCode` | A new union `GuardReasonCode` = `UrlErrorCode` plus `service-worker-blocked`, `host-limit-reached`, `response-too-large`, `response-rewrite-failed` | `UrlErrorCode` is part of `CaptureErrorCode`; guard reasons are warning reasons, never capture errors |
| Host-limit reason | Notes are silent | The code refuses with `url-host-blocked`; this spec uses `host-limit-reached` and changes the test that pins the old reason | The old reason says the host is bad when only the budget ran out |
| Service-worker policy | Spike: default on, a variant with the policy off for the live test | Always on, no switch; the live variant with the policy off is dropped | The hardening relies on it and the capture needs no service worker. A switch would only weaken the guard |
| Heartbeat | Spike: idea, `Browser.getVersion` every 2 s with a 2 s timeout, untested | In, every 2 s with a 5 s timeout | See "Guard loss". The longer timeout allows for multi-MB screenshot frames on the same socket |
| WebSocket hardening | Spike: optional, decide together with the egress proxy | On by default, switch `CAPTURE_WEBSOCKET_HARDENING` | Owner's decision |
| JavaScript response match | Spike: `Content-Type` contains `javascript` | Contains `javascript` or `ecmascript` | `application/ecmascript` is a JavaScript MIME type (by reading); the extra match only rewrites more |
| Document hosts (N7) | Review: separate higher cap, for example 300 | `MAX_LOOKUP_HOSTS` 300 for all hosts, `MAX_REQUEST_HOSTS` 100 stays for non-document hosts, plus a cache cap of 1,200 origins | The cache in `capture.ts` is keyed by origin, not host (up to four origins per host pass the port rule) |
| HTTP status (N6) | Review: warn or fail at 400 and above | Warning `http-error-status`; the reload check gives `reload-differs` | A 404 page can still show patterns; detectors and the route decide |
| Fixture results | Spike: `window.__fixture`, read in the isolated world | A result list in the DOM, read through the normal snapshot | An isolated world shares the DOM but not main-world globals |
| Popup trigger | Spike: a page function the test calls through `evaluate` | `RemoteBrowserDeps.onPageReady` gives the live test `callWithGesture(name)` | The seam has no `evaluate`, and no code outside `lib/capture` may drive Playwright |
| Pixel check | Review: decoded pixels, as in probes P1a and P3 (decoder not named) | `jpeg-js` 0.4.4 as a dev dependency, used only by the live test | See "Dependency" |
| Cross-site fixture origin | Spike: custom domain and `*.vercel.app` alias | Server variable `CAPTURE_FIXTURE_ALT_ORIGIN` on the deployment; the live test gates the case on `LIVE_FIXTURE_ALT_BASE_URL` | The page cannot know which of its two names is "the other" one |
| Module name | Spike sketch: `lib/capture/browser-guard.ts` | Same name; `request-guard.ts` and its test are deleted | The old file holds only the child-session design |

## Where the code differs from the notes

- `.env.example` says `NEXT_PUBLIC_APP_URL` is "the one origin the page capture may scan despite its address checks". `config.ts` and `url-check.ts` bypass nothing for it; `allowOrigin` is parsed and used nowhere in `lib/capture`.
- `structure.md` describes `extractor.ts` as a "page.evaluate script". `collectInPage` runs through `Runtime.callFunctionOn` in an isolated world (`cdp.ts`, `runInIsolatedWorld`), and `remote-browser.ts` has no `page.evaluate`. `structure.md` and `tech.md` also describe the guard with child targets and service-worker bypass.
- The review counts lookups per host. `capture.ts` caches verdicts per origin and resolves per origin, so one host can cost up to four lookups.
- The review's line numbers for the weak tests match. In addition, the Playwright-shaped fake in `remote-browser.test.ts` drops every event that has a `targetSessionId` in `on` (line 123), so the adapter tests never saw child events either.
- `remote-browser.test.ts` pins the old setup order including `Network.setBypassServiceWorker` and `Target.setAutoAttach` (around lines 450 to 560); those cases go with the child code.

## Architecture and module boundaries

`playwright-core` stays imported only in `remote-browser.ts`, with `await import(...)` inside the connect function. Every new module takes structural interfaces, so unit tests load nothing.

| File | Change | `server-only` |
|---|---|---|
| `lib/capture/guard-types.ts` | Adds `GuardSession`, `GuardBrowser`, `GuardLossCause`; reasons become `GuardReasonCode` | no |
| `lib/capture/browser-guard.ts` (new) | `installBrowserGuard`: one `Fetch.enable`, verdict loop, service-worker check, loss detection, heartbeat, host limits, response stage hand-off | no |
| `lib/capture/response-hardening.ts` (new) | Pure header helpers and `answerResponse` for the response stage | no |
| `lib/capture/request-guard.ts` | Deleted with `tests/capture/request-guard.test.ts` | — |
| `lib/capture/guard-policy.ts` (new) | `createGuardPolicy`: syntax, DNS and the capped verdict cache, moved out of `capture.ts` | no |
| `lib/capture/outcome.ts` (new) | `COULD_NOT_SCAN_REASONS`, `toScanOutcome` | no |
| `lib/capture/cdp.ts` | `CdpSession` keeps only `send(method, params?)` | no |
| `lib/capture/remote-browser.ts` | Opens the guard session, reads `mainFrameId`, wires loss to `guard-lost`, hardening switch, HTTP status, `onPageReady` | yes |
| `lib/capture/capture.ts` | Fail closed on `guard-lost`; uses `createGuardPolicy`; status warning and reload check | yes |
| `lib/capture/browser-use-api.ts` | List URL builder, paging, collect-then-stop | yes |
| `lib/capture/extractor.ts` | Collector reads through captured prototype getters and methods | no |
| `lib/capture/config.ts` | `CAPTURE_WEBSOCKET_HARDENING` | yes |
| `lib/capture/seam.ts`, `types.ts`, `constants.ts` | `guard-lost` event, `status`, codes, `ScanOutcome`, constants | no |
| `lib/types/index.ts` | Optional `CaptureMeta.httpStatus` | no |
| `lib/capture-fixture/pages.ts` (new) | Pure builders of the fixture HTML and scripts, `FIXTURE_TAGS`, env reading | no |
| `app/capture-fixture/**/route.ts` (new) | Thin route handlers that call the builders | n/a |
| `tests/capture/helpers/fake-guard-browser.ts` (new) | Faithful fake of the guard session and its browser | n/a |
| `tests/capture/helpers/fake-cdp.ts` | Two-argument `send`, violation list | n/a |

Dependency direction: `browser-guard.ts` imports `guard-types.ts`, `response-hardening.ts`, `clock.ts`, `constants.ts`. `remote-browser.ts` imports `browser-guard.ts` and `cdp.ts`. `capture.ts` imports `guard-policy.ts` and sees the guard only through the seam. `lib/capture-fixture` imports nothing from `lib/capture`; `app/capture-fixture` imports only `lib/capture-fixture`.

## Key types and interfaces

```ts
// types.ts
export type GuardReasonCode =
  | UrlErrorCode | "service-worker-blocked" | "host-limit-reached" | "response-too-large" | "response-rewrite-failed";
export type CaptureErrorCode = /* existing 24 */ | "guard-lost";
export type CaptureWarningCode = /* existing 12 */ | "http-error-status" | "reload-differs";
export type CaptureWarning = { code: CaptureWarningCode; message: string; reason?: GuardReasonCode; count?: number };
export type CaptureError = {
  code: CaptureErrorCode;
  message: string;
  /** Internal. May hold page- or URL-controlled text. Server logs only; never in a public outcome. */
  detail?: string;
};
export type CouldNotScanReason = CaptureErrorCode;
export type ScanOutcome =
  | { status: "captured"; snapshot: PageSnapshot; images: CaptureImage[]; warnings: CaptureWarning[] }
  | { status: "could-not-scan"; reason: CouldNotScanReason; message: string; warnings: CaptureWarning[] };

// outcome.ts
export const COULD_NOT_SCAN_REASONS: Readonly<Record<CaptureErrorCode, CouldNotScanReason>>;
export function toScanOutcome(result: CaptureResult): ScanOutcome; // pure
```

```ts
// guard-types.ts
export type GuardVerdict = { allowed: true } | { allowed: false; reason: GuardReasonCode };
export type RequestGuardEvent =
  | { kind: "request-blocked"; reason: GuardReasonCode; mainFrame: boolean }
  | { kind: "request-host-limit" };
export type GuardLossCause = "session-closed" | "disconnected" | "heartbeat";
/** The browser-target CDP session. `send` takes exactly two arguments. */
export interface GuardSession {
  send(method: string, params?: Record<string, unknown>): Promise<unknown>;
  onEvent(handler: (event: { method: string; params: unknown }) => void | Promise<void>): void;
  onClose(handler: () => void): void;
}
export interface GuardBrowser {
  openGuardSession(): Promise<GuardSession>; // browser.newBrowserCDPSession()
  onDisconnected(handler: () => void): void;
}

// browser-guard.ts
export type BrowserGuardOptions = {
  clock: Clock;
  mainFrameId: string;
  onLost: (cause: GuardLossCause) => void; // called at most once
  hardening?: { maxBodyBytes: number };    // absent: request stage only
  maxHosts?: number;                       // default MAX_REQUEST_HOSTS
  maxLookupHosts?: number;                 // default MAX_LOOKUP_HOSTS
  decisionTimeoutMs?: number;              // default GUARD_DECISION_TIMEOUT_MS
  heartbeat?: { intervalMs: number; timeoutMs: number }; // default the two constants
};
export type BrowserGuard = { /** Stops loss reporting and the heartbeat. Never detaches. */ stopWatching(): void };
export function installBrowserGuard(
  browser: GuardBrowser, policy: RequestPolicy, options: BrowserGuardOptions,
): Promise<BrowserGuard>;

// response-hardening.ts
export type HeaderEntry = { name: string; value: string };
export type PausedResponse = {
  requestId: string; resourceType: string; frameId?: string;
  responseStatusCode?: number; responseStatusText?: string; responseErrorReason?: string; responseHeaders?: HeaderEntry[];
};
export function hardenedHeaders(headers: readonly HeaderEntry[]): HeaderEntry[];
export function needsRewrite(resourceType: string, headers: readonly HeaderEntry[]): boolean;
/** Sends continue or fulfil itself; returns a refusal for the guard to send. */
export function answerResponse(session: GuardSession, paused: PausedResponse, limits: { maxBodyBytes: number }): Promise<GuardVerdict>;
```

```ts
// cdp.ts
export interface CdpSession { send(method: string, params?: Record<string, unknown>): Promise<unknown> }

// seam.ts
export type NavigationOutcome = { finalUrl: string; /** Main-document HTTP status, 100 to 599. */ status?: number };
export type GuardEvent = RequestGuardEvent | { kind: "download-refused" } | { kind: "popup-closed" } | { kind: "guard-lost" };

// guard-policy.ts
export type GuardPolicy = PageGuards & { inspect(url: string, maxLength?: number): Promise<UrlCheckResult> };
export function createGuardPolicy(options: {
  resolver: Resolver; report: (event: GuardEvent) => void; maxCacheEntries?: number; // default MAX_VERDICT_CACHE_ENTRIES
}): GuardPolicy;

// remote-browser.ts
export type PageGestureControl = { callWithGesture(globalFunctionName: string): Promise<void> };
export type RemoteBrowserDeps = { fetch: typeof fetch; clock: Clock; loadPlaywright?: () => Promise<unknown>;
  /** Opt-in live test only. `getBrowser` never sets it. */ onPageReady?: (control: PageGestureControl) => void };

// config.ts: CaptureConfig gains `websocketHardening?: "on" | "off"`; the parser always sets it; absent means "on".
// lib/types: CaptureMetaSchema gains `httpStatus: z.number().int().min(100).max(599).optional()`.
// browser-use-api.ts
export function activeSessionsUrl(pageNumber: number, captureId?: string): string;
```

## Request guard

### Call sequence (Playwright's one connection, two CDP sessions)

| Step | Session | Call |
|---|---|---|
| 1 | — | `connectOverCDP`, first context and page (as today) |
| 2 | page | `Emulation.setScrollbarsHidden { hidden: true }` (in `connect`, as today) |
| 3 | page | `Page.getFrameTree`; `mainFrameId = frameTree.frame.id`; missing id fails `installGuards` |
| 4 | — | `openGuardSession()` = `browser.newBrowserCDPSession()` |
| 5 | guard | Register `Fetch.requestPaused`, `close`, and the browser's `disconnected` |
| 6 | guard | `Fetch.enable { patterns }` (one call; covers later targets too) |
| 7 | guard | Heartbeat timer starts |
| 8 | — | `installGuards` resolves; only then does `capturePage` call `goto` |
| teardown | — | `stopWatching()`, `PATCH stop`, then `browser.close()`. No `detach()` |

Patterns: `[{ urlPattern: "*", requestStage: "Request" }]`, and with hardening also `{ urlPattern: "*", resourceType: "Document", requestStage: "Response" }` and `{ urlPattern: "*", resourceType: "Other", requestStage: "Response" }`.

The page session keeps only the scrollbar call, the frame-tree read, the isolated-world reads and scrolls, and the gesture control. Downloads and popups keep their Playwright handlers (`download` cancel, `context.on("page")` close).

### One paused event

```
if responseStatusCode or responseErrorReason set:      -> response stage (hardening), below
isDocument = resourceType == "Document"; mainFrame = isDocument && frameId == mainFrameId
if a header named service-worker (any case) == "script" -> refuse service-worker-blocked
else verdict = withTimeout(decide(url, isDocument), decisionTimeoutMs); throw or late -> refuse url-invalid
allowed -> Fetch.continueRequest { requestId }
refused -> report request-blocked { reason, mainFrame }; Fetch.failRequest { requestId, BlockedByClient }
any answer rejects -> Fetch.failRequest { requestId, BlockedByClient } once more, failure ignored
```

`decide` is the logic of the old guard, moved: URL parse, pass-through schemes, `policy.checkSyntax`, the host limits, `policy.checkHost`. A late or throwing verdict keeps the reason `url-invalid`, as the code does today. `worker` requests carry their owner frame's id, so the `resourceType` check is what keeps them off the main-frame flag (spike, step 3). Answers that throw `Invalid InterceptionId` after a navigation cancelled the request end in the quiet fallback.

### Host and DNS budget

The guard keeps one set of distinct lower-case host names per capture. Check and add happen with no `await` between them.

- Non-document, new host, set size at least `MAX_REQUEST_HOSTS`: refuse `host-limit-reached`.
- Document, new host, set size at least `MAX_LOOKUP_HOSTS`: refuse `host-limit-reached`.
- The first such refusal also reports `request-host-limit` (one warning per capture, as before).

`createGuardPolicy` holds the verdict cache keyed by origin. When it holds `MAX_VERDICT_CACHE_ENTRIES` entries, a new origin is refused with `host-limit-reached` and not resolved; no entry is ever evicted, so the same origin is never resolved twice. `capturePage` uses the same policy for the input URL (checked first, so it always fits) and both final-URL checks.

### Guard loss (fail closed)

- **Detection.** `close` on the guard session, `disconnected` on the browser, or a heartbeat that rejects or has no answer after `GUARD_HEARTBEAT_TIMEOUT_MS`. Each calls `onLost` once. After `stopWatching()` nothing is reported, so the capture's own stop never counts as loss.
- **Adapter.** `onLost` becomes `guards.report({ kind: "guard-lost" })` unless `stop()` has started.
- **Orchestrator.** `report` with `guard-lost` sets the context flag, rejects a shared "lost" promise with `CaptureFailure("guard-lost")`, and starts `stopSafely` at once. Every `step` races its call against that promise. `takeReloadSample` and `checkLayoutDrift` rethrow `guard-lost` instead of swallowing it. After `runCapture`, a set flag turns any success into `guard-lost`. The `finally` block reuses the stop promise already running, so the stop is called once.
- **Result.** `ok: false`, `guard-lost`, the warnings so far, no snapshot and no images.

What the heartbeat adds: Chromium releases interception on detach, so loss fails open (spike p1, p3). A deliberate `browser.close()` fired both events at once. A silent drop (no TCP close) was not tested: without a heartbeat it is noticed only when a later Playwright command times out, which can be the rest of the 45 s budget. With the heartbeat the detection bound is about 7 s (interval plus timeout). If Chromium has not noticed the drop either, the paused requests stay paused, which is closed. The heartbeat itself is untested live. A false alarm (for example a slow answer behind a large screenshot frame) ends the capture as `guard-lost`, which is a "could not scan", never an open guard. That trade is why it is in.

The unavoidable window: from the moment Chromium drops the session until our `PATCH stop` has ended the browser, the page's requests go out unguarded. For a deliberate close this is detection (immediate) plus the stop call, which took 578 to 823 ms in the spike. For a silent drop it is up to about 7 s plus the stop call. CDP cannot close this window; only an egress proxy can.

### WebSocket hardening (response stage)

`answerResponse` handles a paused event that has `responseStatusCode` or `responseErrorReason`:

1. `responseErrorReason` set, or status 300 to 399: `Fetch.continueRequest`.
2. Not `needsRewrite` (a `Document`, or an `Other` whose `Content-Type` contains `javascript` or `ecmascript`): `Fetch.continueRequest`.
3. A `Content-Length` above `maxBodyBytes`: refuse `response-too-large` before reading the body.
4. `Fetch.getResponseBody`; decoded size above `maxBodyBytes`: refuse `response-too-large`. A body that is not base64 is encoded from its UTF-8 bytes.
5. `Fetch.fulfillRequest { requestId, responseCode, responseHeaders: hardenedHeaders(headers), body }`. `responsePhrase` is passed when present.

The whole answer is raced against `decisionTimeoutMs`; late, or a rejected call in steps 4 and 5, refuses with `response-rewrite-failed`. A refusal is sent by the guard as at the request stage, with `mainFrame` from the same rule. `Fetch.continueResponse` is never used: header-only changes had no effect in Chrome 156 (spike p4). `hardenedHeaders` drops `Content-Encoding` and `Content-Length` in any case, keeps every other header including repeated `Set-Cookie`, and appends `Content-Security-Policy: connect-src http: https: data: blob:` (`HARDENING_CSP`). An existing page policy stays; both apply. A streaming document that never ends is refused at the timeout. The main world can see the injected policy through `securitypolicyviolation` events.

## Coverage of the new guard

From the spike (Chrome `156.0.8078.79` at Browser Use, playwright-core 1.64.1). "Live" means a spike probe; nothing here was run by this repo's tests.

| Request source | Seen and refusable | State |
|---|---|---|
| Main-frame navigation, redirect hops (`ERR_BLOCKED_BY_CLIENT` on `goto`) | yes | live (p1, p4) |
| Main-frame img, `fetch`/XHR, `sendBeacon`, EventSource, prefetch, CSS `@import`, `@font-face` | yes | live (p1, p4) |
| IP-literal URLs; plain `http:` page and its sub-requests; HTTPS-upgrade attempts | yes | live (p3, p8, p9) |
| Same-site iframe document and sub-resources | yes | live (p1) |
| Cross-site iframe (OOPIF): document, sub-resources, blob worker inside; frame loads with the guard on | yes | live (p1, 4 runs) |
| Form POST into an iframe, meta refresh in a `srcdoc` iframe | yes | live (p4) |
| Dedicated worker (blob and URL script), shared worker (URL script): script and first fetch; workers run | yes | live (p1) |
| Service-worker script (`Service-Worker: script`): registration rejected | yes | live (p7, p10) |
| Service worker's own fetches (with the policy off) | yes | live (p1) |
| Popup with a gesture: navigation and its sub-resources | yes | live (p1, p2) |
| Mixed-content `fetch` and `ftp:` | never sent by Chrome or the vendor browser | live (p8, p9) |
| WebSocket, hardening off | no | live (p1, p2, p3) |
| WebSocket, hardening on (page, blob and URL workers, shared workers, `data:`/`about:blank`/`blob:` iframes, popup `about:blank`, cross-site iframe) | blocked by the injected policy | live (p7, p8) |
| Nested OOPIF, downloads | expected yes | by reading, untested |
| `keepalive` requests after unload, module workers, `importScripts`, worklets | unknown | untested |
| Vendor proxy on (`BROWSER_USE_PROXY=on`) with browser-level `Fetch` | unknown | untested |
| WebTransport | no (`connect-src https:` admits it) | live for "not seen" (p3); not blocked, by reading |
| WebRTC, preconnect, DNS prefetch (connections without a request) | no | by reading |
| DNS rebinding (our resolver and the browser's are independent) | no | by reading |
| Non-page browser traffic | none observed | live (p1, p3, p4 logs) |

## Residual risks

Stated in the header of `browser-guard.ts` and in `tech.md`:

- WebTransport, WebRTC, preconnect and DNS prefetch are not covered; neither is DNS rebinding.
- Connection loss fails open for the window described under "Guard loss".
- WebSocket coverage exists only while `CAPTURE_WEBSOCKET_HARDENING` is on, and only for the contexts the spike verified on Chrome 156. A URL-script worker served with a MIME type that is not matched would escape; Chrome normally refuses such worker scripts (by reading).
- Unverified: nested OOPIFs, downloads, keepalive after unload, module workers, `importScripts`, worklets, the vendor proxy on, behaviour under Playwright tracing.
- The design rests on the vendor allowing `Target.attachToBrowserTarget` and browser-target `Fetch`. If either is refused later, `installGuards` fails with `connect-failed`, which is closed. The live test is the tripwire.
- Recommendation, not built: an egress-filtering proxy (`customProxy`) is the real control for everything CDP cannot see.

## Collector against DOM clobbering

A `<form>` exposes its controls as named properties that shadow built-ins (`[LegacyOverrideBuiltIns]`) in every world. Calling a getter or method taken from the prototype bypasses that shadowing. At the start of `collectInPage`, inside the function (it must stay self-contained), the collector takes `Object.getOwnPropertyDescriptor(<Proto>, name).get` or `<Proto>.<method>` for every member below, and from then on uses `getter.call(obj)` or `method.call(obj, ...)`. No helper is a named inner function.

| Member used by the code | Taken from |
|---|---|
| `document.documentElement` | `Document.prototype` getter |
| `tagName`, `children`, `attributes`, `getAttribute`, `hasAttribute`, `getBoundingClientRect` | `Element.prototype` |
| `childNodes`, `nodeType`, `nodeValue`, `textContent` | `Node.prototype` getters |
| `innerText` | `HTMLElement.prototype` getter; if missing (jsdom), `textContent` |
| `checked` (only when the tag is `input`), `selected` (only when the tag is `option`) | `HTMLInputElement.prototype`, `HTMLOptionElement.prototype` getters |
| `children.length`, `children[i]` | `HTMLCollection.prototype` `length` getter and `item` |
| `childNodes.length`, `childNodes[i]` | `NodeList.prototype` `length` getter and `item` |
| `attributes.length`, `attributes[i]`, `attr.name`, `attr.value` | `NamedNodeMap.prototype` `length` and `item`; `Attr.prototype` getters |

`getComputedStyle` and `window.devicePixelRatio` are window members; the isolated world gives them their own built-ins (live, review M1). `parentElement` and `nextElementSibling` are not used by the code. The jsdom tests check first that the form's named property really shadows the member; jsdom 31 support for form named properties is unverified, so where it does not shadow, the test defines the same own property on the form instance with `Object.defineProperty`, which is what the named property does.

## Sessions

`activeSessionsUrl(n, captureId?)` returns `https://api.browser-use.com/api/v4/browsers?filterBy=active&metadata=app%3Dtrick-or-trap` plus, for a capture id, `&metadata=` and `encodeURIComponent("captureId=" + id)`, then `&pageSize=100&pageNumber=n`. Facts from the spike: `status=` is ignored, `filterBy=bogus` gives 422, `pageSize` is 1 to 100, `pageNumber` starts at 1, `metadata` is an exact, repeatable AND filter, and the answer has `items`, `totalItems`, `pageNumber`, `pageSize` and no `hasMore`.

- **Reclaim** reads page 1 only and still checks `metadata.captureId` itself.
- **Sweep** pages from 1 and stops on an empty `items`, on `n × 100 >= totalItems`, on a missing numeric `totalItems` (after that page), or after `SESSION_LIST_MAX_PAGES`. It selects tagged sessions older than `STALE_SESSION_AGE_MS` on every page, and stops them only after the last page, because stopping shifts later pages of an `active` list.
- A failed or unreadable page ends the paging; what was selected before is still stopped. Neither function rejects, and untagged sessions are never stopped.

## HTTP status and the reload check

`goto` and `reload` in the adapter keep the Playwright response and pass `response.status()` as a number when it is an integer from 100 to 599; a `null` response gives no status. `capturePage` writes it to `capture.httpStatus` of the sample, adds `http-error-status` for a first status of 400 or above, and after the reload adds `reload-differs` by requirement 13 (`eligibleElementCount` of both samples, final URLs compared after normalisation). A Chrome HTTPS upgrade or a redirect gives the status of the final response.

## "Could not scan"

`toScanOutcome` maps `ok: true` to `captured` and `ok: false` to `could-not-scan` with `reason: COULD_NOT_SCAN_REASONS[code]`, `message: ERROR_MESSAGES[code]` and the warnings. The reason is the error code itself; the `Record` exists so that a new code cannot be added without a deliberate public decision, which `tsc` enforces. The public arm has no `detail` field, so the route cannot pass `detail` on by accident. Warnings already hold no free text.

## Fixture routes and the live test

All fixture routes live under `app/capture-fixture/` (no leading underscore, because underscore folders are private in the App Router). Each `route.ts` exports `GET` and `dynamic = "force-dynamic"`, reads `process.env` at request time and calls `lib/capture-fixture/pages.ts`. With `CAPTURE_FIXTURE_ROUTES` not exactly `on`, the answer is a plain 404 with an empty body. Every answer has `X-Robots-Tag: noindex, nofollow` and `Cache-Control: no-store`; HTML pages also carry the robots meta tag. The app has no `robots` or `sitemap` file today, so none is added. Route handlers bypass the root and Boo-tique layouts.

| Route | Content |
|---|---|
| `/capture-fixture` | Main page: the sources below, a result list `<ul id="fixture-results">`, global `openFixturePopups()` |
| `/capture-fixture/frame?variant=same` and `?variant=cross` | Frame with a forbidden image; `cross` also starts a blob worker that fetches a forbidden tag and posts `loaded` to its parent |
| `/capture-fixture/worker.js`, `/capture-fixture/shared.js`, `/capture-fixture/sw.js` | `text/javascript`; first statement fetches a forbidden tag; workers then post `RAN`; the service worker also fetches in `install` |
| `/capture-fixture/popup` | Same-origin popup page with a forbidden image |
| `/capture-fixture/redirect` | 302 to a forbidden tag |
| `/capture-fixture/alignment` | 5,000 px tall: `100vh` hero, wrapping paragraphs, a solid `rgb(255, 0, 0)` 200 × 40 marker centred with `left: 50%` at y 2,500, with own text |
| `/capture-fixture/clobber` | A form with inputs named as in 9.3 and a paragraph of known text inside the form |

Forbidden tag URL: `https://example.org:8443/ff/<tag>` (`FIXTURE_FORBIDDEN_ORIGIN`), refused by the real syntax check (`url-port-blocked`). Main-page sources: `<img>`, `fetch` (no-cors), `sendBeacon`, `EventSource`, `<link rel=prefetch>`, CSS `@import`, `@font-face`, a same-site frame with a forbidden image, a same-site frame whose `src` is forbidden, the cross-site frame (only when `CAPTURE_FIXTURE_ALT_ORIGIN` is an `https` origin), dedicated workers from URL and blob, the shared worker, the service-worker registration, and a `wss:` WebSocket to a public echo host. Results are list items such as `result worker-url-ran` or `result ws-error`, plus `result csp-connect-violation` from a `securitypolicyviolation` listener. `FIXTURE_TAGS` lists every tag with the case it belongs to.

Live test (owner only):

| Case | Variables | Asserts |
|---|---|---|
| Redirect to a blocked port (httpbingo) | base | `navigation-blocked` within `LIVE_BLOCK_MAX_MS` |
| Stopped and not listed | base | status `stopped`; list with `filterBy=active` and the capture id is empty (capture id from `newCaptureId`) |
| Boo-tique home | base + `NEXT_PUBLIC_APP_URL` | existing assertions |
| Guard coverage | base + `LIVE_FIXTURE_BASE_URL` | adapter-level: real `createGuardPolicy` wrapped to record checked URLs and events; load within `NAVIGATION_TIMEOUT_MS`; refused tags equal the same-site set; event count; workers ran; service worker refused; popups through `callWithGesture`; WebSocket error plus policy violation |
| Cross-site frame | base + both fixture URLs | `loaded` result; cross-site tags refused |
| Fixture redirect | base + `LIVE_FIXTURE_BASE_URL` | `navigation-blocked` |
| Alignment | base + `LIVE_FIXTURE_BASE_URL` | marker box against the red pixel bounds of the decoded first image, within 2 px |
| Clobbering | base + `LIVE_FIXTURE_BASE_URL` | `ok: true`, the form text present |

"base" is `RUN_REMOTE_CAPTURE=1` plus `BROWSER_USE_API_KEY`. A popup opened by the gesture is closed by the adapter at once, so the popup's own sub-resource tag may never be requested; only its navigation tag is required. Every session is stopped in a `finally`. Kiro never runs this file; the owner does.

## Dependency

`jpeg-js` 0.4.4, exact, dev only. The live alignment check needs the pixels of the JPEG the capture returns, and Node has no JPEG decoder. `jpeg-js` is pure JavaScript with no install scripts and no native code, so it adds no build step; `sharp` sits in `node_modules` only as an optional dependency of Next.js and must not be relied on. Nothing under `lib/` or `app/` imports it, and the dependencies test pins it. If installing it fails, the alignment case is the only thing lost and the task stops and reports.

## New constants (`constants.ts`)

| Name | Value | Why |
|---|---|---|
| `GUARD_HEARTBEAT_INTERVAL_MS` | 2,000 | Spike figure |
| `GUARD_HEARTBEAT_TIMEOUT_MS` | 5,000 | Above one round trip (about 140 ms) plus a large screenshot frame on the same socket |
| `MAX_LOOKUP_HOSTS` | 300 | Review figure; bounds documents too |
| `MAX_VERDICT_CACHE_ENTRIES` | 1,200 | Four origins per host for 300 hosts |
| `MAX_REWRITE_BODY_BYTES` | 8,388,608 | 8 MiB; large shop HTML is 1 to 2 MB; each body crosses CDP twice |
| `HARDENING_CSP` | `connect-src http: https: data: blob:` | Spike, verified live |
| `HTTP_ERROR_STATUS_MIN` | 400 | N6 |
| `RELOAD_ELEMENT_MIN_COUNT`, `RELOAD_ELEMENT_RATIO_MAX` | 50, 3 | The review's case was 11 against 750; small pages never warn |
| `SESSION_LIST_PAGE_SIZE`, `SESSION_LIST_MAX_PAGES` | 100, 20 | Vendor maximum; 2,000 sessions per sweep |
| `GESTURE_FUNCTION_NAME` | `/^[A-Za-z_$][A-Za-z0-9_$]{0,63}$/` | Only a plain global name reaches `Runtime.evaluate` |

## Error handling

| Condition | Result |
|---|---|
| Frame-tree read, guard session or `Fetch.enable` fails | `connect-failed`, redacted, no navigation, stop once |
| Guard session `close`, browser `disconnected`, heartbeat miss | `guard-lost`, stop started at once, no snapshot or images |
| Same events after `stop()` started | ignored |
| Request refused (any stage) | capture continues; one `request-blocked` with count and first reason |
| Main-frame document refused, `goto` fails | `navigation-blocked` |
| Host limit or cache cap reached | `host-limit-reached` refusals; one `request-host-limit` warning |
| Answer to a paused request rejects | quiet `failRequest` fallback |
| First status 400 or above | warning `http-error-status` |
| Reload differs | warning `reload-differs`, `afterReload` kept |
| `callWithGesture` with a bad name or a failing call | rejects, redacted; only the live test uses it |
| List call fails | stop nothing new, never reject |

Redaction stays as it is: every stage error passes `toDetail` with the session's secrets, and `finalise` redacts once more. The guard session adds no new secret; its error texts go through the same path.

## Test strategy

| Area | Kind | Files |
|---|---|---|
| Fake guard browser and fake page session | unit, tests of the fakes themselves | `tests/capture/fake-guard-browser.test.ts`, `tests/capture/fake-cdp.test.ts` |
| Browser guard: order, verdicts, flag, fallback, service worker, limits, loss, heartbeat | unit, fake guard browser, manual clock | `tests/capture/browser-guard.test.ts` |
| Response stage | unit, fake guard browser | `tests/capture/response-hardening.test.ts` |
| Policy and verdict cache | unit, fake resolver | `tests/capture/guard-policy.test.ts` |
| Fail closed in the orchestrator | unit, fake browser emitting `guard-lost` | `tests/capture/capture-guard-lost.test.ts` |
| Adapter wiring, status, gesture control, hardening switch | unit, Playwright-shaped fakes | `tests/capture/remote-browser.test.ts` |
| Outcome totality | unit | `tests/capture/outcome.test.ts` |
| Collector clobbering | jsdom | `tests/capture/collector-dom.test.ts` |
| Listing | unit, fake `fetch` | `tests/capture/browser-use-api.test.ts` |
| Status and reload warnings, meta schema | unit | `tests/capture/capture-reload.test.ts`, `capture.test.ts`, `tests/types/capture-meta.test.ts` |
| Fixture builders and routes | unit, node environment | `tests/capture-fixture/pages.test.ts`, `tests/capture-fixture/routes.test.ts` |
| Real vendor, Chrome and network | opt-in live, owner only | `tests/capture/remote-capture.test.ts` |

Every guard test file runs an `afterEach` that asserts the fake's violation list is empty, so a third `send` argument anywhere fails the file. Tests removed because they prove only the child design: all of `request-guard.test.ts` (its non-child cases move to `browser-guard.test.ts`), and the setup-order, auto-attach and bypass cases of `remote-browser.test.ts`. Tests changed because they pin now-wrong behaviour: the `?status=active` URL in `browser-use-api.test.ts` (line 29) and `remote-browser.test.ts` (around line 1100), and the host-limit reason `url-host-blocked`. Not provable offline: real Playwright session routing, Chromium's interception, the CSP effect, jsdom's form named properties, real geometry and the vendor API. The live test covers those, run by the owner.

## Task order

The owner's driver commits after every task, so each task leaves a tree that compiles and whose touched tests pass, without a stub that a later task fills:

1. The fake guard browser and its types come first (task 1); nothing uses them yet.
2. Reason codes and `guard-lost` (task 2) widen types only, so the old guard still compiles. The public outcome (task 3) needs `guard-lost` in the code list.
3. The new guard is built beside the old one in its own file (task 4). The orchestrator learns `guard-lost` from the fake browser (task 5) before the adapter can emit it.
4. Task 6 switches the adapter, makes the page fake strict, and deletes the old guard together with the tests that only prove it.
5. Hardening is built in the guard (task 7) before the switch turns it on in the adapter (task 8). Until task 8 the adapter runs with the request stage only, which is the spike's verified base design.
6. The remaining tasks touch one concern each. The fixture routes (tasks 14 and 15) and the live-test support (task 16) come before the live test that uses them (task 17). Steering and `.env.example` housekeeping come last (task 18).

## Limitations and follow-ups (no code here)

- **N8.** Tiled mode is slow: 10 tiles took 18.0 s at DPR 2 and covered 5,880 of 30,217 px, against 8,000 px in single mode for pages up to 20,000 px. With create, connect and `goto` added, tall pages will usually get `reload-skipped`. Follow-up: force DPR 1 for tiles or accept and report.
- **N9.** The collector enters neither shadow roots (open or closed) nor same-origin iframes; their text is in the screenshot but not in the snapshot. Ordinary `aria-*` attributes (32 × 200 characters per element) can push a page to `snapshot-too-large`, which now reads "could not scan". Follow-ups: walk open shadow roots and same-origin frames; a smaller `aria-*` budget.

## Requirements recorded for the later route spec

1. Map every capture result with `toScanOutcome`, show `could-not-scan` as "could not scan", never as clean, and never send `CaptureError.detail` to a client.
2. Pass `deps.waitUntil` and call `sweepStaleSessions` from the cron, as recorded by `page-capture-fixes`.
3. Do not list `app/capture-fixture` in any sitemap; disallow it in robots if a robots file is added; keep `CAPTURE_FIXTURE_ROUTES` off in production.

## Risks

1. **Vendor dependence.** Browser-target `Fetch` and `Target.attachToBrowserTarget` were verified on Chrome 156 only. A refusal fails closed as `connect-failed`.
2. **Heartbeat false alarms.** Untested live; a false alarm costs a scan, not safety.
3. **Hardening cost.** About 0.25 to 0.6 s per load (spike), twice per capture, plus body memory up to `MAX_REWRITE_BODY_BYTES` per response in flight.
4. **Latency.** The guard adds about 0.2 to 0.45 s per load at 140 ms round trip, more from a distant region.
5. **Host limits.** The browser-level session now counts worker and popup hosts too, so busy pages reach 100 non-document hosts sooner.
6. **jsdom named properties.** If jsdom does not shadow form members, the DOM test emulates it; only the live clobbering case shows the real browser.
7. **Gesture control.** It runs a named page function in the main world with a user gesture. Only the live test sets it; a unit test proves `getBrowser` does not.
