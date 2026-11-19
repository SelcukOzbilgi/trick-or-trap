# Design: Page Capture Fixes

This spec fixes the 17 findings of the security review of `page-capture` (H1 to H4, M1 to M4, L1 to L9) and the finding N1 of a second review. The branch `feat/page-capture` can only be merged after all of them are fixed. The code of `page-capture` (`lib/capture/`, `tests/capture/`) stays; this spec changes it. Nothing here adds a route, storage or UI.

Rule for implementers, from N1: the snapshot must never carry the test-id attribute (the HTML attribute whose name is "data-" plus "test" plus "id"). No file under `lib/capture`, `lib/detectors` or `lib/judge` may contain the text of that attribute name, in any case, because a guard test on the main branch fails on it. Write "the test-id attribute" in comments, specs and messages. Tests that need the name build it from parts in `tests/capture/helpers/forbidden-attribute.ts`.

## Finding to requirements to tasks

| Finding | What | Requirements | Tasks |
|---|---|---|---|
| H1 | Redirect hops never reach the guard | 1.1 to 1.8, 4.1, 4.6, 4.7, 13.13, 25.2 | 8, 9, 11, 13 |
| H2 | Sub-resources, sub-frames, service workers unchecked | 2.1 to 2.10, 3.1 to 3.7, 25.4 | 8, 9, 11, 13 |
| H3 | Snapshot size unbounded | 5.1 to 5.13, 6.1 to 6.9, 13.10, 13.11 | 3, 4, 5, 12 |
| H4 | Boxes do not line up with the image | 7.1 to 7.6, 8.1 to 8.6, 25.3 | 5, 10, 12, 13 |
| M1 | Collector runs in the main world | 9.1 to 9.10, 13.15 | 5, 10, 12 |
| M2 | Orphan sessions | 10.1 to 10.10, 11.1 to 11.4, 12.6, 25.5 | 3, 7, 11, 13 |
| M3 | Tests prove the fake | 13.1 to 13.15, 24.1 to 24.5 | 1, 4, 8, 9, 12 |
| M4 | Session id and `liveUrl` reach `detail` | 12.1 to 12.6 | 7, 9, 11 |
| L1 | Stop budget shorter than the stop chain | 16.1 to 16.6 | 9, 12 |
| L2 | Late stop is fire-and-forget | 17.1 to 17.5 (route part in "Requirements recorded for the later route spec") | 11 |
| L3 | Default timeout 2 minutes | 18.1 to 18.3 | 6 |
| L4 | `isOutsideImages` edge cases | 19.1 to 19.5 | 5 |
| L5 | Tile coverage and mode choice | 20.1 to 20.4 | 3, 5 |
| L6 | `request-blocked` has no reason code | 4.2 to 4.5, 4.8 | 3, 11 |
| L7 | Allowed origin adds nothing and is risky | 21.1 to 21.5 | 6 |
| L8 | `detail` can carry page-controlled text | 23.1, 23.2 (route part recorded below) | 3, 11 |
| L9 | Syntax check false negatives and positives | 2.9, 22.1 to 22.6 | 6, 11 |
| N1 | Test-id attribute reaches the snapshot | 14.1 to 14.8, 15.1 to 15.4 | 2, 4, 13 |
| Steering | Notes and lint | 26.1 to 26.5 | 14 |

## Differences from the review

The owner's decisions win over the review where they differ.

| Item | Review | This spec | Why |
|---|---|---|---|
| H2 WebSockets | Add `context.routeWebSocket(/.*/, ...)` | Not implemented. Stated residual risk; evaluate in the live test later | Unverified in the review |
| H2 host checks | DNS through the existing per-origin cache | Per-capture verdict cache plus `MAX_REQUEST_HOSTS` (100) distinct hosts for non-document requests, then refuse and warn `request-host-limit` | Bounds DNS work a hostile page can trigger |
| H2 child targets | Verify first, then add auto-attach if needed | `Target.setAutoAttach` is part of the design from the start, marked unverified | Owner's decision |
| H3 oversize | Fail with `snapshot-invalid` above about 2 MB | New error `snapshot-too-large`, limit 1.5 MB (`MAX_SNAPSHOT_BYTES`) | Owner's decision |
| H3 depth | "Drop or flag" deeper elements | Drop and count as eligible, so `elementsTruncated` and the warning show it | One clear rule |
| H4 fallback | Inject `html { scrollbar-width: none }` if the CDP call does not hold | Documented only. Only the CDP call is implemented | Owner's decision |
| H4 re-read | "Optionally" re-read | Included, small: light read, 4 px drift, warning `layout-shifted` | Owner's decision |
| M1 pixel ratio | Read DPR from `Page.getLayoutMetrics` | Size, scroll and content size come from `Page.getLayoutMetrics`. The ratio is read in the isolated world, because that method returns no device pixel ratio as far as is known (check in the live test) | A page script cannot reach an isolated world |
| M2 | Sweep helper for the route spec | Exported, not called. Plus the per-capture tag and one clean-up after an aborted create | Owner's decision |
| M3 | jsdom or an opt-in live page | jsdom 31.0.1, dev only, owner approved | Owner's decision |
| M4 | `redact(text)` or `secrets()` | `secrets()` on the handle | Owner's decision |
| L1 | PATCH first, parallel, or what is left of 10 s | PATCH first, then disconnect with what is left of `STOP_TIMEOUT_MS` | Old 7.6 updated explicitly |
| L2, L8 | Route work | Only `deps.waitUntil` is implemented. The rest is recorded for the route spec | Owner's decision |
| L5 | CSS-px threshold or force DPR 1 | CSS-px threshold 20,000. DPR cannot be overridden (finding 4 of `page-capture`) | Measured |
| L7 | Keep address checks or reject the config | Both | Owner's decision |
| L9 | "Consider" a larger cap | `MAX_HOP_URL_LENGTH` 8,192 for hops and final URLs | Owner's decision |
| Live test | Redirect result within 3 s | Whole call within `LIVE_BLOCK_MAX_MS` (5 s). The review measured about 0.5 s for the navigation stage; the whole call also holds create, connect and stop | The test cannot time one stage |
| Live test | Box centre against `(imageWidth - width) / 2 + width / 2` | Centre within 2 px of half the image width, which is the same value | Simpler to state |

## Architecture and module boundaries

All paths are under `lib/capture/` or `tests/capture/`. `playwright-core` stays imported in exactly one module, `remote-browser.ts`, with `await import(...)` inside the connect function. The new modules take a structural `CdpSession`, so they load nothing and unit tests never import `playwright-core`.

| File | Change | `server-only` |
|---|---|---|
| `cdp.ts` (new) | `CdpSession` interface; helpers that call CDP: `hideScrollbars`, `runInIsolatedWorld`, `readPageMetrics`; the page function `scrollInPage` | no |
| `guard-types.ts` (new) | Types only: `GuardVerdict`, `RequestGuardEvent`, `RequestPolicy`. Imported by `seam.ts` and `request-guard.ts`, so neither imports the other | no |
| `request-guard.ts` (new) | `installRequestGuard(session, policy, options)`: `Fetch`, auto-attach, service-worker bypass, verdict loop, host seen-set and limit | no |
| `remote-browser.ts` | Opens the CDP session (`context.newCDPSession(page)`), hides scrollbars, installs the guard, isolated-world reads, stop order, `secrets()`, `animations: "disabled"`. Drops `context.route`, `page.evaluate` | yes |
| `seam.ts` | New `PageGuards`, `GuardEvent`, `captureId` in `SessionRequest`, `secrets()`, optional `reclaim` | no |
| `capture.ts` | Guard policy, aggregated warning, central redaction, size check, drift re-read, `waitUntil`, `captureId`, reclaim | yes |
| `browser-use-api.ts` | Create metadata, orphan stop, `reclaimSession`, `sweepStaleSessions` | yes |
| `extractor.ts` | Collector returns `RawCollection` with caps; `buildSample` bounds; `snapshotBytes`; attribute rules | no |
| `geometry.ts` | `sanitiseMetrics`, CSS-px mode choice, `isOutsideImages`, `maxBoxDrift`, `planSingle` with layout width | no |
| `screenshots.ts` | Uses the clamped viewport and layout width | no |
| `url-check.ts` | No allowed-origin bypass, all trailing dots, `maxLength` option | no |
| `config.ts` | Origin rejection, default timeout 1 | yes |
| `constants.ts`, `types.ts` | New constants, codes, `RawCollection`, warning fields | no |
| `lib/types/index.ts` | `.max()` limits, `layoutWidth` | no |
| `tests/capture/helpers/fake-cdp.ts` (new) | Scripted `CdpSession` that records calls and emits events | n/a |
| `tests/capture/helpers/forbidden-attribute.ts` (new) | Builds the test-id attribute name from parts | n/a |
| `tests/capture/helpers/fake-browser.ts` | Follows the new `PageGuards`; `secrets()`, optional `reclaim` | n/a |

Dependency direction: `request-guard.ts` imports `cdp.ts`, `guard-types.ts`, `clock.ts` and `constants.ts`. `remote-browser.ts` imports both new modules. `capture.ts` imports neither: it sees only the seam.

## Key types and interfaces

```ts
// types.ts
export type CaptureErrorCode = /* existing */ | "snapshot-too-large";
export type CaptureWarningCode = /* existing */ | "request-host-limit" | "layout-shifted";
export type CaptureWarning = { code: CaptureWarningCode; message: string; reason?: UrlErrorCode; count?: number };
export type CollectLimits = {
  maxTagChars: number; maxRoleChars: number; maxStyleChars: number;
  maxAttrsPerElement: number; maxAttrNameChars: number; maxPathDepth: number;
};
export type CollectOptions = { /* existing four fields */ limits: CollectLimits };
/** What the in-page collector returns. Metrics come from CDP, not from the page. */
export type RawCollection = { devicePixelRatio: number; eligibleCount: number; elements: RawElement[] };
/** `layoutWidth` is optional so old fixtures and fakes stay valid; absent means `innerWidth`. */
export type RawPageRead = { /* existing fields */ layoutWidth?: number };
/** `reclaim` is true only for an aborted create or a fetch failure with no HTTP response. Default false. */
export class CaptureFailure extends Error { /* existing */ readonly reclaim: boolean }
```

```ts
// seam.ts
export type SessionRequest = { timeoutMinutes: number; proxy: "on" | "off"; viewport: { width: number; height: number }; captureId: string };
export interface BrowserProvider {
  readonly mode: string;
  createSession(request: SessionRequest): Promise<BrowserSessionHandle>;
  /** Optional. One best-effort clean-up after a create call that may have left a session. Never rejects. */
  reclaim?(captureId: string): Promise<void>;
}
export interface BrowserSessionHandle {
  connect(options: { timeoutMs: number }): Promise<CapturePage>;
  stop(): Promise<void>;
  /** API key, session id, cdpUrl, liveUrl. For redaction only. */
  secrets(): readonly string[];
}
// GuardVerdict and RequestGuardEvent are declared in guard-types.ts and re-exported here.
export type GuardVerdict = { allowed: true } | { allowed: false; reason: UrlErrorCode };
export type RequestGuardEvent =
  | { kind: "request-blocked"; reason: UrlErrorCode; mainFrame: boolean }
  | { kind: "request-host-limit" };
export type GuardEvent = RequestGuardEvent | { kind: "download-refused" } | { kind: "popup-closed" };
// RequestPolicy (guard-types.ts) has checkSyntax, checkHost and report(event: RequestGuardEvent);
// PageGuards below is assignable to it.
export interface PageGuards {
  /** Synchronous. Scheme, port, credentials, host name, IP literal, length. No DNS. */
  checkSyntax(url: string): GuardVerdict;
  /** Syntax plus DNS, with the per-capture verdict cache. */
  checkHost(url: string): Promise<GuardVerdict>;
  report(event: GuardEvent): void;
}
```

```ts
// cdp.ts
export interface CdpSession {
  send(method: string, params?: Record<string, unknown>, targetSessionId?: string): Promise<unknown>;
  onEvent(handler: (event: { method: string; params: unknown; targetSessionId?: string }) => void | Promise<void>): void;
}
export function hideScrollbars(session: CdpSession): Promise<void>;
/** Creates a fresh isolated world for the main frame and calls `fn` in it. `fn` must be self-contained. */
export function runInIsolatedWorld<A, R>(session: CdpSession, fn: (arg: A) => R, arg: A): Promise<R>;
export type RawMetrics = { innerWidth: unknown; innerHeight: unknown; scrollX: unknown; scrollY: unknown;
  scrollWidth: unknown; scrollHeight: unknown; layoutWidth: unknown };
export function readPageMetrics(session: CdpSession): Promise<RawMetrics>;

// request-guard.ts
export type RequestGuardOptions = { clock: Clock; maxHosts?: number; decisionTimeoutMs?: number };
export function installRequestGuard(session: CdpSession, policy: RequestPolicy, options: RequestGuardOptions): Promise<void>;
```

```ts
// capture.ts
export interface CaptureDeps { /* existing */
  /** Hands cleanup that must outlive the response to the platform (for example `after()` or `waitUntil`). */
  waitUntil?: (promise: Promise<unknown>) => void;
  newCaptureId?: () => string;      // default: crypto.randomUUID()
}

// browser-use-api.ts
export function reclaimSession(deps: BrowserUseApiDeps, captureId: string): Promise<void>;       // never rejects
export type SweepResult = { listed: number; stopped: number; failed: number };
export function sweepStaleSessions(deps: BrowserUseApiDeps & { now: () => number }): Promise<SweepResult>;

// geometry.ts
export type PageMetrics = { innerWidth: number; innerHeight: number; scrollX: number; scrollY: number;
  scrollWidth: number; scrollHeight: number; layoutWidth: number; devicePixelRatio: number };
export function sanitiseMetrics(raw: Partial<Record<keyof PageMetrics, unknown>>): PageMetrics;
export function chooseMode(page: { fullHeight: number }): ScreenshotMode;
export function planSingle(page: { fullHeight: number; layoutWidth: number }): ImageBox & { truncated: boolean };
export function maxBoxDrift(a: readonly ElementSnapshot[], b: readonly ElementSnapshot[]): number;

// extractor.ts
export function snapshotBytes(value: unknown): number;                 // UTF-8 bytes of JSON.stringify
export function isForbiddenAttributeName(name: string): boolean;      // uses FORBIDDEN_ATTRIBUTE_FRAGMENTS
```

## New and changed constants (`constants.ts`)

| Name | Value | Why |
|---|---|---|
| `GUARD_DECISION_TIMEOUT_MS` | 5,000 | A paused request must not wait on DNS longer than this. A DNS lookup takes tens of ms; 5 s is generous and still short of the 15 s navigation limit |
| `MAX_REQUEST_HOSTS` | 100 | A shop page loads from about 20 to 60 hosts. 100 leaves room and bounds lookups |
| `MAX_HOP_URL_LENGTH` | 8,192 | Redirect and tracking URLs exceed 2,048. User input stays at `MAX_URL_LENGTH` |
| `STOP_TIMEOUT_MS` | 10,000 | The whole stop chain (replaces the use of `API_FETCH_TIMEOUT_MS` in the stop budget). Worst case stays 55 s |
| `STALE_SESSION_AGE_MS` | 120,000 | The sweep helper |
| `MAX_TAG_CHARS`, `MAX_ROLE_CHARS`, `MAX_STYLE_CHARS`, `MAX_ATTR_NAME_CHARS` | 64 each | The review's figures. HTML tag names, roles and computed colours are far shorter |
| `MAX_ATTRS_PER_ELEMENT` | 32 | The review's figure |
| `MAX_PATH_DEPTH`, `MAX_PATH_INDEX` | 256, 100,000 | Real DOM depth is under 100; `MAX_PATH_DEPTH` is the review's figure |
| `MAX_ELEMENT_ID_CHARS` | 2,048 | `el-` plus 256 indices of at most 6 digits and a dash is 1,795 |
| `RAW_SCAN_FACTOR` | 2 | Examine at most twice the element cap of raw entries |
| `MAX_SNAPSHOT_BYTES` | 1,500,000 | Owner's decision. A full 1,500-element snapshot is about 0.7 MB |
| `LAYOUT_DRIFT_PX` | 4 | Owner's decision (the review's figure) |
| `MAX_PLAUSIBLE_DPR`, `MAX_PLAUSIBLE_PX` | 8, 1,000,000 | Real ratios are 1 to 3; no document is a million CSS px tall |
| `TILE_MODE_THRESHOLD_CSS_PX` | 20,000 | Replaces `TILE_MODE_THRESHOLD_PX`. Measured: pages up to about 22,000 CSS px captured fine at ratio 2, so the old `fullHeight × ratio <= 30,000` was wrong |
| `SESSION_TIMEOUT_DEFAULT_MINUTES` | 1 | Was 2. A capture and its stop take at most 55 s, and a failed stop is billed for the whole timeout |
| `FORBIDDEN_ATTRIBUTE_FRAGMENTS` | `verdict`, `pattern`, `no-flag`, `lookalike`, `expected`, `ground-truth` | Attribute names that name an outcome. The test-id attribute is excluded by the allowlist and is not listed |
| `ISOLATED_WORLD_NAME` | `"trick-or-trap-capture"` | In `cdp.ts` |

Live-test constant `LIVE_BLOCK_MAX_MS` (5,000) lives in the test file.

## Schema limits (`lib/types/index.ts`)

Only `.max()` and one optional field; no existing field changes name, type or requiredness. The limits are literals, because `lib/types` must not import `lib/capture`; `tests/types/capture-meta.test.ts` compares them with the constants.

| Field | Limit |
|---|---|
| `ElementSnapshot.id` | 2,048 |
| `tag`, `role` | 64 |
| `text` | 1,000 (looser than the 300 cap, so old fixtures stay valid) |
| `color`, `backgroundColor`, `fontSize`, `opacity`, `display`, `visibility`, `position` | 64 |
| `attributes` | at most 32 entries, name at most 64, value at most 200 |
| `BaseSnapshot.elements` | at most 1,500 |
| `BaseSnapshot.url` | 8,192 |
| `CaptureMeta.devicePixelRatio` | at most 16 |
| `CaptureMeta.layoutWidth` (new, optional) | positive, at most 100,000 |
| `CaptureMeta.images.items` | at most 10 |
| `CaptureMeta.eligibleElementCount` | at most 10,000,000 |

Before changing a limit the implementer greps the existing fixtures (`tests/fixtures`, `tests/types`, `tests/detectors`) for longer strings. If one exists, the limit is raised, never the fixture.

## Request guard

### Setup order (one page-level CDP session, created in `connect`)

1. `Emulation.setScrollbarsHidden({ hidden: true })` (7.1). Failure: `connect-failed`.
2. `installGuards(policy)` runs `installRequestGuard`:
   1. Register the event handler first, so no paused request is missed.
   2. `Network.setBypassServiceWorker({ bypass: true })`.
   3. `Page.getFrameTree`, to learn the main frame id.
   4. `Fetch.enable({ patterns: [{ urlPattern: "*", requestStage: "Request" }] })`.
   5. `Target.setAutoAttach({ autoAttach: true, waitForDebuggerOnStart: true, flatten: true })`.
   Any failure rejects, and the adapter wraps it in `connect-failed` (12.4).

### Verdict for one `Fetch.requestPaused` event

```
url = event.request.url
if scheme is data: blob: about:            -> continue
v = policy.checkSyntax(url)                -> refuse when not allowed
if resourceType is "Document":             -> v = await policy.checkHost(url); remember host
else if host already seen:                 -> v = await policy.checkHost(url)    (cached, no lookup)
else if seen hosts >= maxHosts:            -> refuse, report request-host-limit once
else:                                      -> remember host; v = await policy.checkHost(url)
race the whole verdict with decisionTimeoutMs (refuse on expiry or on a throw)
refuse   -> Fetch.failRequest({ requestId, errorReason: "BlockedByClient" }), report request-blocked
allow    -> Fetch.continueRequest({ requestId })
```

`mainFrame` in the event is true when `resourceType` is `Document`, the event comes from the page session (no `targetSessionId`) and `frameId` equals the main frame id. A redirect hop is a new paused event (`redirectedRequestId` set), so it takes the same path. Errors from `failRequest` or `continueRequest` (the request may be gone) are ignored. The decision never throws out of the handler.

`checkSyntax` and `checkHost` come from `capture.ts`: `checkSyntax` is `checkUrlSyntax(url, { maxLength: MAX_HOP_URL_LENGTH })`; `checkHost` adds the DNS check and keeps a verdict cache keyed by origin, as the old orchestrator already did for hops.

### Child targets

On `Target.attachedToTarget` (carries a `sessionId`; the event is read from the page session):

1. `Fetch.enable` (same patterns) on the child, addressed by `targetSessionId`.
2. `Target.setAutoAttach` (same parameters) on the child, so nested targets attach too.
3. `Runtime.runIfWaitingForDebugger` on the child, always, even after a failure above, so the child never stays paused.
4. If step 1 failed: `Target.closeTarget`, best effort, and report `request-blocked` with the reason `url-invalid` for the target.

Paused requests that arrive with a `targetSessionId` are answered on that session and use the same host cache and host limit. Whether the pinned Playwright lets `send` address a child `sessionId` through a `CDPSession` obtained from `context.newCDPSession(page)` is unverified. If the live test (task 13) shows it does not, the fallbacks are, in this order: open one `newCDPSession(frame)` per cross-process frame as frames attach, or use `browser.newBrowserCDPSession()`. That would be a follow-up to this spec, not part of it; the unit tests cover the logic against the fake CDP session.

## What is and is not covered by the request guard

Covered, by design and by unit tests with a fake CDP session:

- Main-frame navigations, each redirect hop, sub-frame navigations and sub-resources the page session sees, each with the syntax rules, the DNS check (documents and new hosts) and the host limit.
- Service-worker-handled requests, because they are bypassed.
- A refused hop ends `goto` as a blocked request and gives `navigation-blocked` within the time the browser needs to report it, not at the 15 s limit. The review measured about 0.5 s live.

Covered only if the live test confirms it:

- Cross-site (out-of-process) iframes and workers, through `Target.setAutoAttach`. Unverified.
- That `Fetch.enable` at the request stage keeps working across a reload and after cross-process navigations.
- That `data:`, `blob:` and `about:` URLs need no check and are not a way to reach a network.

Not covered (residual risks):

- DNS rebinding and split-horizon names. This function resolves a name, and the remote browser resolves it again on its own side. The check proves only what this function sees.
- WebSocket connections, WebRTC, preconnect and DNS-prefetch sockets, which the Fetch domain does not report. `routeWebSocket` is not implemented (out of scope).
- Pop-up targets opened by the page before `popup-closed` closes them; whether auto-attach covers them is unverified.
- Local Network Access: Chrome may block some private-address requests by itself. Not verified.
- The vendor's network egress. The real control is a filtering proxy (`customProxy`), a follow-up.
- Requests made before `Fetch.enable` returns. The session starts at `about:blank` and the first `goto` comes after setup, so there should be none.

## Page access: isolated world, metrics, alignment

- Each read and each scroll first runs `Page.getFrameTree`, then `Page.createIsolatedWorld({ frameId, worldName })`, then `Runtime.callFunctionOn({ executionContextId, functionDeclaration: String(fn), arguments: [{ value: arg }], returnByValue: true, awaitPromise: true })`. A new world per call avoids a stale execution context after a navigation. An `exceptionDetails` result becomes an error whose text is redacted later.
- Page scripts run in the main world and cannot replace the built-ins that the collector uses in its own world. The page can still shape what the collector reads: its DOM, attributes, text and inline styles. That is exactly what we report on, so this limit stays.
- `collectInPage` and `scrollInPage` are serialised with `String(fn)`. They stay self-contained; the existing source test (no `__name`, `import(`, `require(`) covers both.
- `readPageMetrics` calls `Page.getLayoutMetrics` and takes `cssLayoutViewport.clientWidth` and `clientHeight` as inner size and layout width, `cssLayoutViewport.pageX` and `pageY` as scroll, and `cssContentSize` as content size. `sanitiseMetrics` (pure, in `geometry.ts`) replaces anything non-finite, non-positive or above `MAX_PLAUSIBLE_PX` with the `BROWSER_VIEWPORT` value, and a ratio outside `(0, MAX_PLAUSIBLE_DPR]` with 1. The result is never `snapshot-invalid` because of a metric.
- Alignment: with scrollbars hidden before the first read, the read and the full-page screenshot should use one layout width. The review verified this on example.com only, and its numbers were not fully consistent (layout width 1265 before and after). The live test (25.3) decides. If it fails, the documented fallback is to inject `html { scrollbar-width: none }` before the read; this spec does not implement it.
- The single image width is the layout width, rounded up and clamped to `BROWSER_VIEWPORT.width`; the screenshot call adds `animations: "disabled"`.
- Drift check: after the images, and only with at least `TILE_MIN_REMAINING_MS` left, the orchestrator calls `collect` once more with the light options and compares boxes by id with `maxBoxDrift`. Above `LAYOUT_DRIFT_PX` it adds `layout-shifted`. The result is not stored. This costs one read of about 50 ms.

## Bounds on page data

The in-page collector receives `limits` in its options and applies them, so less data crosses CDP. `buildSample` applies the same limits again, in this order, because the page is not trusted:

1. Examine at most `RAW_SCAN_FACTOR × cap` raw entries; stop at `cap` kept elements.
2. Drop an entry with a wrong shape, a path deeper than `MAX_PATH_DEPTH` or with an index above `MAX_PATH_INDEX`, or an id longer than `MAX_ELEMENT_ID_CHARS`. Dropped-by-bound entries still count in `eligibleElementCount`, so `elementsTruncated` is true and the `elements-truncated` warning appears.
3. Cut `tag`, `role` and the seven style strings; cut text; clean attributes (allowlist, forbidden fragments, name length, value cut, at most 32).
4. After assembly, `snapshotBytes` measures the JSON. The orchestrator drops `afterReload` once if that gets under the limit, else returns `snapshot-too-large`. This check runs before `PageSnapshotSchema.safeParse`, so a huge value is never validated.

Past the depth cap the walker keeps a depth counter and no path array, so a very deep DOM costs no quadratic copying.

Attribute rules (N1): full sample `disabled`, `aria-*`, `type`, `name`, `href`, `for`, `placeholder`, `value`; light sample `type`, `name`, `disabled`. `value` keeps the old per-element rule. Names containing a `FORBIDDEN_ATTRIBUTE_FRAGMENTS` entry are dropped outside the page, also for `aria-*`. Everything else, including every `data-*` attribute, is not in the allowlist.

## Sessions

- **Create.** The body gains `metadata: { app: "trick-or-trap", captureId }`. The vendor field name and acceptance are unverified (see risks); the live test creates a session with it.
- **Id without address.** If `id` is a non-empty string and `cdpUrl` is missing, `createSession` calls `stopSession` once, ignores a failure, then throws `session-create-failed` with a detail redacted with the id and any partial `liveUrl`.
- **Aborted create.** On the 10 s abort or a fetch failure with no HTTP response, `createSession` throws a `CaptureFailure` with `reclaim: true`, and `capture.ts` then calls `provider.reclaim(captureId)` once, bounded by `STOP_TIMEOUT_MS` and handed to `waitUntil`. `reclaimSession` lists `GET /api/v4/browsers?status=active`, parses defensively (an array, or an object with an array under `items`, `browsers` or `results`; each item needs a string `id` and an object `metadata`), and stops only items whose `metadata.captureId` equals the capture's. Any parse problem means nothing is stopped. An HTTP 4xx or 5xx on create does not trigger it (a session was not created).
- **Sweep.** `sweepStaleSessions` lists the same way and stops items with `metadata.app === "trick-or-trap"` whose age (`startedAt` or `createdAt`, an ISO string) is above `STALE_SESSION_AGE_MS`. An item with no usable age is left alone. It returns counts only.
- **Stop order.** `handle.stop()` sends the `PATCH` first (it has its own `API_FETCH_TIMEOUT_MS`), then closes the CDP connection with `min(DISCONNECT_TIMEOUT_MS, STOP_TIMEOUT_MS - elapsed)`. A failed `PATCH` still tries the disconnect and then rejects. The orchestrator wraps the call in `withTimeout(STOP_TIMEOUT_MS)`.
- **Late session.** The stop of a session that arrives after `capture-timeout` is handed to `waitUntil` when given.

## Redaction and error handling

`remote-browser.ts` wraps the body of `installGuards`, `collect`, `scrollTo`, `screenshot`, `goto`, `reload` and `connect` in `fail(code, error)`, which redacts with the full list. `capture.ts` builds every result in one function, `finalise`, that applies `redactText(text, handle?.secrets() ?? [apiKey])` to each `error.detail` and each text field of each warning. This is the second line; the first remains in each seam method. Test: a fake injects each of the four secrets into every stage.

| Condition | Result |
|---|---|
| Guard setup, scrollbar call or auto-attach call fails | `connect-failed`, stop called once |
| Main-frame hop refused, `goto` fails | `navigation-blocked` |
| Sub-resource or sub-frame refused | Capture continues; one `request-blocked` warning with `count` and `reason` |
| Host limit reached | Capture continues; warning `request-host-limit` |
| Metric implausible | Replaced; capture continues |
| `collect` returns a non-object | `page-read-failed` |
| Snapshot over `MAX_SNAPSHOT_BYTES` after dropping `afterReload` | `snapshot-too-large`, stop once |
| `afterReload` dropped for size | warning `reload-failed` |
| Drift above 4 px | warning `layout-shifted` |
| Stop chain over 10 s | warning `session-stop-failed`, result kept |
| Create aborted | `session-create-timeout` or `-failed`, then one `reclaim` |
| Validation fails (no longer from a metric) | `snapshot-invalid` |

## Geometry changes

- `isOutsideImages(box, images)`: a box is inside an image when, on each axis, the overlap holds. For size above 0: `start + size > low && start < high`. For size 0: `start >= low && start < high`. The x axis uses `low = 0`, `high = image.width`; the y axis `low = offsetY`, `high = offsetY + height`. A box left of 0, or touching only the top edge, is outside; a zero-size control inside the image is inside.
- `chooseMode({ fullHeight })`: single when `fullHeight <= 20,000`, tiled above. The ratio is no longer an input.
- Tile coverage after this change: the real viewport height in live sessions was 544 or 588 CSS px (the browser UI takes part of 800). Ten tiles cover about 5,440 to 5,880 px, which is less than the 8,000 px of single mode. A page of 8,001 to 20,000 CSS px is captured as one 8,000 px image; a page above 20,000 gets about 5,900 px in tiles. This is accepted and stated; `screenshot-truncated` is added whenever the images stop short of the bottom.

## URL and configuration changes

- `checkUrlSyntax(input, options?: { maxLength?: number })` (default `MAX_URL_LENGTH`). The allowed-origin parameter is removed from `checkUrlSyntax`, `checkUrl` and `UrlCheckOptions`; nothing is bypassed.
- All trailing dots are stripped before `localhost`, `.localhost`, `.local` and `.internal` are tested. `http://localhost../` gives `url-host-blocked` without DNS.
- `config.ts` keeps `allowOrigin` (a validated, normalised origin) for the later route spec; inside `lib/capture` it now has no effect. `NEXT_PUBLIC_APP_URL` is rejected with `config-invalid` when `checkUrlSyntax` returns `url-host-blocked` or `url-address-blocked` for it. Other codes (a non-default port) do not reject it.
- The orchestrator checks the final URL after `goto` and after `reload` with `maxLength: MAX_HOP_URL_LENGTH`.

## Superseded criteria of `page-capture`

The old files stay in place. Task 2 adds a note at the top of the old `requirements.md` and `design.md` and removes the test-id attribute from the old spec and the steering files. These old items are replaced:

| Old criterion or statement | Replaced by |
|---|---|
| 4.2, 4.4 (the allowed origin skips host and address checks) | 21.1 to 21.5 |
| 5.1, 5.2 (main-frame navigation requests only, abort) | 1.1 to 1.8, 2.1 to 2.10, 3.1 to 3.7 |
| 5.3 (first navigation aborted gives `navigation-blocked`) | 4.6, 4.7 |
| 5.7 (warning with a closed reason code and no URL) | 4.2 to 4.5, 4.8 |
| 7.3 (create body fields; missing `id` or `cdpUrl`) | 10.1, 10.3 |
| 7.6 (disconnect first, then `PATCH`) | 16.1 to 16.5 |
| 8.3 (late session stopped without being awaited) | 17.2 |
| 9.6 (stop has its own 10 s deadline) | 16.3 (`STOP_TIMEOUT_MS`) |
| 10.2 (collect with one in-page evaluation) | 9.1, 9.4 (one isolated-world call plus the CDP metrics) |
| 10.11 and 13.4 (attribute lists with the test-id attribute) | 14.1 to 14.3 |
| 11.3, 11.4, 11.5 (metrics from the page; non-finite becomes 0) | 9.4 to 9.9 |
| 12.4 (image width is the viewport width) | 7.5 |
| 12 and 22.1, 22.2 (mode threshold `fullHeight × ratio <= 30,000`) | 20.1, 20.2 |
| 14.2 (`CaptureMeta` fields) | adds `layoutWidth`: 7.4, 6.8 |
| 15.2 (`snapshot-invalid` on an invalid ratio) | 9.9, 13.14, 13.15 |
| 15.9 (warnings carry only a code and a fixed message) | 4.8 |
| 16.1, 16.5 (secret list) | 12.1 to 12.6 |
| 17.3 (caps and allowlist re-applied outside) | 5.1 to 5.13 |
| 18.4 (default timeout 2) | 18.1 |
| 19.3 (no dependency other than two) | 24.1 (jsdom as a dev dependency) |
| 20.2 (allow-entry test cases) | 21.1 |
| 20.4 (mode choice at 29,999, 30,000, 30,001 with ratios 1 and 2) | 20.1, 20.2 |
| 20.10 (live test content) | 25.1 to 25.8 |

Old design statements replaced: "Guards in the browser" and the first three "Residual risk" bullets (the route handler assumption, sub-resources unchecked, one host cache); the last paragraph of "Element collection" (main world); the mode-choice rule and the constants `TILE_MODE_THRESHOLD_PX` and the default of `SESSION_TIMEOUT`; "Risk 2" (orphans) and "Risk 5" (route interception cost); the test-strategy sentence "no jsdom"; the table row for step 4 of the capture sequence (it now includes the CDP setup).

## Requirements recorded for the later route spec

These are not implemented here. The scan-route spec must satisfy them.

1. **L2.** Pass `after()` or the platform's `waitUntil` as `deps.waitUntil` when it calls `capturePage`, so the late-session stop, the stop call and the create clean-up finish after the response.
2. **L8.** Never send `error.detail` to a public client. Map only `code`, the fixed `message` and the warning codes, reasons and counts. If `detail` must be shown, label it as untrusted text.
3. **Sweep.** Call `sweepStaleSessions` outside the request path, for example in the daily cron that already keeps Supabase awake, with the API key from the configuration. Log the counts, never the ids.
4. **Tracing.** Keep `outputFileTracingIncludes` in sync for every route that imports `lib/capture` (unchanged from `page-capture`).

## Test strategy

| Area | Kind | Files |
|---|---|---|
| Collector logic on real DOM | jsdom, per-file directive | `tests/capture/collector-dom.test.ts` |
| Outside pass, bounds, size, attribute rules | unit, hostile raw data | `tests/capture/extractor.test.ts` |
| Request guard | unit, fake CDP session emitting paused-request events | `tests/capture/request-guard.test.ts`, helper `fake-cdp.ts` |
| Isolated world, metrics, scrollbars | unit, fake CDP session | `tests/capture/cdp.test.ts` |
| Remote adapter (stop order, secrets, no `route`, no `evaluate`) | unit, fake `loadPlaywright` and fake CDP | `tests/capture/remote-browser.test.ts` |
| Sessions: metadata, orphan stop, reclaim, sweep | unit, fake `fetch` | `tests/capture/browser-use-api.test.ts` |
| Orchestrator: warnings, redaction at every stage, size, drift, `waitUntil` | unit, fake browser, manual clock | `tests/capture/capture.test.ts`, `capture-stop.test.ts`, `capture-guards.test.ts`, `capture-reload.test.ts`, `capture-deadlines.test.ts` |
| Geometry, metrics, mode, drift, outside-image | unit | `tests/capture/geometry.test.ts` |
| URL and config | unit | `tests/capture/url-check.test.ts`, `config.test.ts` |
| Schema limits | unit | `tests/types/capture-meta.test.ts` |
| No forbidden word under `lib/capture` | unit, reads files | `tests/capture/lib-text-rules.test.ts` |
| Pins | unit, reads `package.json` | `tests/capture/dependencies.test.ts` |
| Real browser, vendor and network | opt-in live | `tests/capture/remote-capture.test.ts` |

Tests rewritten because they proved the fake and not the behaviour: the `fakeRoute` guard tests and the sub-frame pass-through test in `remote-browser.test.ts` (now `request-guard.test.ts` against the real guard); the self-containment-only `collectInPage` test and the DPR 0 test in `extractor.test.ts` (now DOM tests and a sanitising test); the DPR 0 validation tests in `capture.test.ts`, `capture-stop.test.ts` and `capture-reload.test.ts` (now a spy on `PageSnapshotSchema.safeParse`, plus a test that DPR 0 succeeds); the disconnect-then-`PATCH` test in `remote-browser.test.ts` (now `PATCH` first); the allow-entry cases in `url-check.test.ts`; the default-2 case in `config.test.ts`; the mode-choice cases in `geometry.test.ts` and `screenshots.test.ts`; the constant values in `constants.test.ts` and the code counts in `types.test.ts`. The fake browser's `hops` list now calls `checkSyntax` and `checkHost`, the same two calls the real guard makes.

What jsdom can prove: eligibility, text, attribute and cap logic of `collectInPage`, id paths, depth handling, and that the output stays bounded when built-ins are overridden in the test window. What it cannot: there is no layout (`getBoundingClientRect` returns zeros, so tests stub rectangles and only the non-geometric logic is covered), `innerText` is not implemented (the collector falls back to `textContent`, which includes hidden text), computed styles are partial, and an isolated world does not exist (so jsdom cannot show that page scripts are shut out). Real geometry, isolated-world behaviour, redirect and iframe interception, cross-process targets, scrollbar alignment and the vendor API are proven only by the live test, which the owner runs.

## Risks and what cannot be verified without a live run

1. **Cross-site iframe and worker coverage** through auto-attach is unverified, including whether a Playwright `CDPSession` can address a child `sessionId`.
2. **Scrollbar hiding** was seen working on one page; the numbers of the review were not fully consistent. If the live alignment check fails, the fallback is not implemented.
3. **Create `metadata`** and the `GET /api/v4/browsers?status=active` response shape are not verified. A vendor that rejects unknown fields would make every create fail; the live test shows it first. The defensive parsing means a different shape stops nothing.
4. **`Fetch` and `data:` URLs.** Whether `data:` and `blob:` requests are paused at all is unknown; the rule in 2.2 is safe either way.
5. **Request cost.** Every request now waits for a verdict. Host verdicts are cached and DNS runs once per host, but total page load time was not measured.
6. **Failing closed.** A failed scrollbar or guard setup call fails the capture with `connect-failed`. If the vendor browser rejected one of these CDP methods, every capture would fail. The live test is the check.
7. **jsdom needs Node `^22.22.2 || ^24.15.0 || >=26`**, while `engines` says `>=20.9.0`. The dev dependency can fail to install or run on Node 20; `engines` is not changed here.
8. **DNS rebinding, WebSockets, WebRTC and preconnect** remain open (see "What is and is not covered").
9. **Tall pages.** Tile coverage of about 5,900 px is below the single-mode 8,000 px; accepted.
10. **Hostile DOM.** The isolated world stops built-in tampering, not a page that shapes its own DOM, text and styles. Consumers must still treat every snapshot value as untrusted.
