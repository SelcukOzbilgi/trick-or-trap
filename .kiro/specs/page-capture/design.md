# Design: Page Capture

`page-capture` is a server-only library in `lib/capture/`. Its entry point, `capturePage(url, deps?)`, checks the URL, opens a Browser Use Cloud browser over CDP, reads the page once, takes screenshots from the same load (one image, or viewport tiles for tall pages), reloads for a second lighter read, stops the session, and returns a validated `PageSnapshot` plus the images. It has no route, no UI, no detectors and no storage.

## Experiment findings

Measured on Vercel with Browser Use Cloud and `playwright-core` 1.64.1. Each finding drives a decision below.

| # | Finding | Consequence |
|---|---|---|
| 1 | `POST https://api.browser-use.com/api/v4/browsers` (header `X-Browser-Use-API-Key`, body `{ timeout, browserScreenWidth: 1280, browserScreenHeight: 800 }`) returns `id`, `cdpUrl`, `liveUrl`, `timeoutAt`. The timeout is charged upfront and refunded on stop. `PATCH /api/v4/browsers/{id}` with `{"action":"stop"}` stops it. Closing the CDP connection does not stop the browser or the billing. Connect with `chromium.connectOverCDP(cdpUrl, { timeout })`, use `contexts()[0]` and its first page. | Create with a small timeout (default 2 min). Always call stop in `finally`. Disconnect is only cleanup. |
| 2 | The residential proxy is on by default and costs about 24 times more per MB. The diagnostic script sent `proxyCountryCode: null` to turn it off. | One function, `proxyBodyFields(proxy)`, owns this detail. Default is `off`. |
| 3 | On Vercel the function crashes with "Cannot find module .../playwright-core/browsers.json" unless `outputFileTracingIncludes` lists `./node_modules/playwright-core/**/*` for the route. The experiment used `/api/chain-test`. | `next.config.ts` lists `/api/scan`. The scan-route spec must keep the keys in sync. |
| 4 | Device pixel ratio, user agent and viewport height are randomised per session and cannot be overridden. `page.viewportSize()` is null. | Read `innerWidth`, `innerHeight`, `devicePixelRatio`, `scrollX`, `scrollY`, `scrollWidth` and `scrollHeight` with `page.evaluate`. Screenshot with `scale: "css"` so image pixels equal CSS pixels. |
| 5 | `locator.boundingBox()` took 0.4 to 8 s per element. All rectangles in one `page.evaluate` took about 20 ms. Playwright's `boundingBox()` is viewport-relative. | One evaluation reads everything. Boxes are `getBoundingClientRect()` plus scroll, in document CSS px. |
| 6 | A full-page screenshot and a CDP `captureBeyondViewport` capture with a 3,000 px or 8,000 px clip both stalled for about 95 s on the 45,000 px page, with the proxy on or off. Pages up to about 22,000 CSS px worked. Viewport screenshots after scrolling took about 0.2 s each. Suspected cause: document height times device pixel ratio above a texture limit of about 65,535 px. JPEG q70 sizes: 0.7 MB at 5,000 px, 1.1 MB at 8,400 px, 2.65 MB at 16,700 px. Vercel's response limit is 4.5 MB. | Single mode (one clipped image, 8,000 px cap) only when `fullHeight × devicePixelRatio <= 30,000`. Above that, tiled mode takes viewport screenshots only and never calls a full-page or clipped-beyond-viewport screenshot. Check the sum of base64 lengths against 4 MiB. |
| 7 | Typical total time in the function was 1.7 to 3.4 s. Layout can differ between two loads of the same page. | A 45 s budget has ample room. Boxes and screenshot come from the same load. |

## Architecture and module boundaries

All files are in `lib/capture/`. Tests are in `tests/capture/<name>.test.ts`.

| File | Responsibility | `server-only` | `playwright-core` |
|---|---|---|---|
| `types.ts` | Error and warning code unions, fixed messages, `CaptureResult`, `CaptureFailure`, raw page types | no | no |
| `constants.ts` | Every named deadline and limit | no | no |
| `redact.ts` | `redactText`, `toDetail` | no | no |
| `clock.ts` | `Clock`, `createSystemClock`, `createDeadline`, `withTimeout` | no | no |
| `config.ts` | zod env parsing, `parseCaptureConfig`, `getCaptureConfig` | yes | no |
| `ip-ranges.ts` | IP parsing and `classifyAddress` | no | no |
| `url-check.ts` | `Resolver`, `checkUrlSyntax`, `checkUrl` | no | no |
| `resolver.ts` | `createDnsResolver` (default `Resolver`) | no | no |
| `seam.ts` | Seam interfaces, no implementation | no | no |
| `browser.ts` | `getBrowser` | yes | no |
| `browser-use-api.ts` | Create and stop calls with `fetch`, `proxyBodyFields` | yes | no |
| `remote-browser.ts` | `BrowserProvider` over CDP, lazy `import("playwright-core")` | yes | yes (only here) |
| `geometry.ts` | Pure maths: document boxes, mode choice, single-image plan, tile planning, outside-image test, base64 sizes | no | no |
| `extractor.ts` | `collectInPage` (runs in the page) and `buildSample` (post-processing) | no | no |
| `screenshots.ts` | `captureImages`: single or tiled screenshots through the seam | no | no |
| `capture.ts` | `capturePage` orchestrator | yes | no |

Dependency direction: `capture.ts` imports `config`, `url-check`, `browser`, `extractor`, `geometry`, `screenshots`, `clock`, `redact`, `types`. `screenshots.ts` imports `geometry`, `seam`, `clock`, `constants`, `types`. `browser.ts` imports `remote-browser.ts`, which imports `browser-use-api.ts`, `extractor.ts` (only for `collectInPage`), `seam.ts`, `clock.ts`, `redact.ts`. `url-check.ts` imports `ip-ranges.ts`. Every file may import `types.ts`, `constants.ts` and `@/lib/types`. Nothing imports `capture.ts` except the later scan route. `lib/capture` imports no other `lib/` area. `playwright-core` is imported in `remote-browser.ts` only, and only with `await import(...)` inside the connect function; unit tests inject a loader and never load it. Pure files carry no `server-only` so tests need no mock for them.

## Key types and interfaces

### Result and errors (`types.ts`)

```ts
export type UrlErrorCode =
  | "url-invalid" | "url-too-long" | "url-scheme-blocked" | "url-credentials-blocked"
  | "url-port-blocked" | "url-host-blocked" | "url-address-blocked" | "dns-failed";

export type CaptureErrorCode =
  | UrlErrorCode
  | "config-invalid" | "browser-mode-unsupported"
  | "session-create-failed" | "session-create-timeout"
  | "connect-failed" | "connect-timeout"
  | "navigation-failed" | "navigation-timeout" | "navigation-blocked"
  | "page-read-failed" | "screenshot-failed" | "screenshot-too-large"
  | "snapshot-invalid" | "capture-timeout" | "internal-error";

export type CaptureWarningCode =
  | "session-stop-failed" | "reload-skipped" | "reload-failed" | "redirected"
  | "elements-truncated" | "screenshot-truncated" | "tall-page-tiled"
  | "download-refused" | "popup-closed" | "request-blocked";

export const ERROR_MESSAGES: Record<CaptureErrorCode, string>;   // fixed text per code
export const WARNING_MESSAGES: Record<CaptureWarningCode, string>;

export type CaptureError = { code: CaptureErrorCode; message: string; detail?: string };
export type CaptureWarning = { code: CaptureWarningCode; message: string };

/** One JPEG image. All sizes are CSS px (image px equal CSS px with `scale: "css"`). */
export type CaptureImage = {
  offsetY: number;        // document Y of the image's top edge
  width: number;
  height: number;
  bytes: Uint8Array;
  base64Length: number;   // 4 * ceil(bytes / 3)
};

export type CaptureResult =
  | { ok: true; snapshot: PageSnapshot; images: CaptureImage[]; warnings: CaptureWarning[] }
  | { ok: false; error: CaptureError; warnings: CaptureWarning[] };

/** Thrown inside lib/capture only. capturePage catches it and never rethrows. */
export class CaptureFailure extends Error {
  readonly code: CaptureErrorCode;
  readonly detail?: string;   // already redacted
}
```

`ERROR_MESSAGES` is the only source of `message`; the raw exception text can reach only `detail`.

### Raw page types (`types.ts`)

```ts
export type CollectOptions = {
  maxElements: number; maxTextChars: number; maxAttrChars: number;
  attributeNames: readonly string[] | "full";   // "full" = the full allowlist
};
export type RawElement = {
  path: number[];                                     // element-child indices from <html>
  tag: string; role: string | null; text: string; textTruncated: boolean;
  rect: { left: number; top: number; width: number; height: number };   // viewport-relative
  style: { color: string; backgroundColor: string; fontSize: string; opacity: string;
           display: string; visibility: string; position: string };
  checked: boolean; selected: boolean;
  attrs: Record<string, string>;
};
export type RawPageRead = {
  innerWidth: number; innerHeight: number; devicePixelRatio: number;
  scrollX: number; scrollY: number; scrollWidth: number; scrollHeight: number;
  eligibleCount: number; elements: RawElement[];
};
```

### Time and deadlines (`clock.ts`)

```ts
export interface Clock {
  now(): number;                                         // epoch ms
  setTimer(ms: number, fn: () => void): () => void;      // returns cancel
}
export function createSystemClock(): Clock;

export type StageLimit = { ms: number; code: CaptureErrorCode };
export interface Deadline {
  remainingMs(): number;
  /** Races `op` against min(stage.ms, remaining). */
  run<T>(op: Promise<T>, stage?: StageLimit): Promise<T>;
}
export function createDeadline(clock: Clock, totalMs: number): Deadline;
export function withTimeout<T>(clock: Clock, ms: number, op: Promise<T>, code: CaptureErrorCode): Promise<T>;
```

`Deadline.run` rules: effective limit is `min(stage.ms, remaining)`. If it expires and `stage.ms <= remaining` at call time the error is `stage.code`, otherwise `capture-timeout`. If `remaining <= 0` it rejects at once. A late rejection of `op` is swallowed so no unhandled rejection appears. The timer is cancelled when `op` settles first. `withTimeout` is the same race without a shared budget; it times the stop call.

### Configuration (`config.ts`)

```ts
export type CaptureConfig = Readonly<{
  browserMode: string;                 // default "remote"
  apiKey: string | null;
  proxy: "on" | "off";                 // default "off"
  sessionTimeoutMinutes: number;       // integer 1..5, default 2
  allowOrigin: string | null;          // parsed once from NEXT_PUBLIC_APP_URL
}>;
export type ConfigResult = { ok: true; config: CaptureConfig } | { ok: false; error: CaptureError };

export function parseCaptureConfig(env: Readonly<Record<string, string | undefined>>): ConfigResult;
export function getCaptureConfig(): ConfigResult;   // parseCaptureConfig(process.env), memoised
```

Rules: every value is trimmed and an empty string becomes `undefined` (`.env.example` lists names with empty values). `BROWSER_USE_PROXY` is `z.enum(["on","off"])`. The timeout is an integer in 1..5. `CAPTURE_BROWSER_MODE` is any non-empty string up to 32 characters; whether it is supported is decided by `getBrowser`. A `superRefine` requires `BROWSER_USE_API_KEY` when the mode is `remote`. `NEXT_PUBLIC_APP_URL` must parse as an http or https URL, and only its `origin` is kept. On failure the message is `Invalid capture environment: NAME1, NAME2`, built from zod issue paths, never from values.

### URL safety (`url-check.ts`)

```ts
export interface Resolver {
  /** All A and AAAA addresses as text. Rejects when the lookup fails. */
  resolveAddresses(hostname: string): Promise<readonly string[]>;
}
export type UrlCheckOptions = { resolver: Resolver; allowOrigin: string | null };
export type UrlCheckResult =
  | { ok: true; url: string; hostname: string }           // url: normalised, no fragment
  | { ok: false; code: UrlErrorCode };

export function checkUrlSyntax(input: string, allowOrigin: string | null): UrlCheckResult;   // no DNS
export function checkUrl(input: string, options: UrlCheckOptions): Promise<UrlCheckResult>;
```

`ip-ranges.ts` exports `parseIp(text): { version: 4 | 6; bytes: number[] } | null` and `classifyAddress(text): { blocked: boolean }`. Unparsable text is blocked (fail closed).

### Browser seam (`seam.ts`)

No Playwright type appears here.

```ts
export type SessionRequest = {
  timeoutMinutes: number; proxy: "on" | "off"; viewport: { width: number; height: number };
};
export interface BrowserProvider {
  readonly mode: string;
  /** Creates a billed session. Throws CaptureFailure. Nothing to stop if it throws. */
  createSession(request: SessionRequest): Promise<BrowserSessionHandle>;
}
export interface BrowserSessionHandle {
  connect(options: { timeoutMs: number }): Promise<CapturePage>;   // throws CaptureFailure
  /** Disconnects (best effort) and stops billing. Rejects when stopping fails. */
  stop(): Promise<void>;
}

export type GuardEvent =
  | { kind: "request-blocked"; reason: UrlErrorCode }
  | { kind: "download-refused" }
  | { kind: "popup-closed" };
export interface PageGuards {
  allowNavigation(url: string): Promise<{ allowed: true } | { allowed: false; reason: UrlErrorCode }>;
  report(event: GuardEvent): void;
}
export type NavigationOutcome = { finalUrl: string };
export type ScreenshotRequest =
  | { kind: "clip"; clip: { x: 0; y: 0; width: number; height: number }; quality: number }   // single mode
  | { kind: "viewport"; quality: number };                                                    // tiled mode: current viewport only
export interface CapturePage {
  installGuards(guards: PageGuards): Promise<void>;
  goto(url: string, options: { timeoutMs: number }): Promise<NavigationOutcome>;
  reload(options: { timeoutMs: number }): Promise<NavigationOutcome>;
  collect(options: CollectOptions): Promise<RawPageRead>;
  /** Scrolls the document to `y` and resolves with the `scrollY` read back from the page (the browser may clamp). */
  scrollTo(y: number): Promise<number>;
  screenshot(request: ScreenshotRequest): Promise<Uint8Array>;
}

export type GetBrowserResult = { ok: true; browser: BrowserProvider } | { ok: false; error: CaptureError };
```

`getBrowser(config, deps: { fetch: typeof fetch; clock: Clock; loadPlaywright?: () => Promise<unknown> }): GetBrowserResult` returns the remote provider for `remote` and `browser-mode-unsupported` for every other string. Adding `local` or `bundled` later means adding a case; the interfaces do not change.

### Orchestrator dependencies (`capture.ts`)

```ts
export interface CaptureDeps {
  config: CaptureConfig;
  getBrowser: (config: CaptureConfig) => GetBrowserResult;
  resolver: Resolver;
  clock: Clock;
}
/** Page text in the snapshot is untrusted input for every consumer, including the LLM judge. */
export function capturePage(url: string, deps?: Partial<CaptureDeps>): Promise<CaptureResult>;
```

Defaults for missing deps: `getCaptureConfig()` (a failed config becomes an `ok: false` result), `createDnsResolver()`, `createSystemClock()` and `(config) => getBrowser(config, { fetch, clock })`.

### Screenshots (`screenshots.ts`)

```ts
export type ImagesOutcome = {
  images: CaptureImage[];
  meta: { mode: "single" | "tiled"; truncated: boolean; items: { offsetY: number; width: number; height: number }[] };
  warnings: CaptureWarningCode[];            // "screenshot-truncated", "tall-page-tiled"
};
/** Throws CaptureFailure("screenshot-failed" | "screenshot-too-large" | a deadline code). */
export function captureImages(page: CapturePage, read: RawPageRead, deadline: Deadline): Promise<ImagesOutcome>;
```

`captureImages` uses `read.scrollHeight`, `read.devicePixelRatio`, `read.innerWidth` and `read.innerHeight`, calls `chooseMode`, and runs the single or tiled procedure of "Geometry and screenshot".

### Constants (`constants.ts`)

| Name | Value | Why |
|---|---|---|
| `API_FETCH_TIMEOUT_MS` | 10,000 | Decision: each Browser Use API call |
| `CDP_CONNECT_TIMEOUT_MS` | 15,000 | Decision |
| `NAVIGATION_TIMEOUT_MS` | 15,000 | Decision |
| `CAPTURE_TIMEOUT_MS` | 45,000 | Decision. Plus the 10 s stop call, the worst case is 55 s, under the 60 s function limit |
| `SETTLE_DELAY_MS` | 500 | Short wait after `load` for late scripts such as countdown starts |
| `RELOAD_MIN_REMAINING_MS` | 12,000 | Typical full run is 1.7 to 3.4 s. A reload, settle and light read needs a few seconds; 12 s leaves about three times the worst typical figure |
| `MAX_URL_LENGTH` | 2,048 | Decision |
| `ALLOWED_PORTS` | 80, 443 | `tech.md` |
| `MAX_ELEMENTS` / `MAX_ELEMENTS_LIGHT` | 1,500 / 750 | A shop page has 1,000 to 3,000 DOM elements and the eligible subset is smaller. 1,500 element records are about 0.7 MB of JSON. The light read halves it |
| `MAX_TEXT_CHARS` / `MAX_TEXT_CHARS_LIGHT` | 300 / 120 | Banner, claim and button texts are short. 300 keeps a full sentence of a stock claim. 120 is enough to compare a counter |
| `MAX_ATTR_CHARS` | 200 | Enough for `aria-label` and a short `href` |
| `SCREENSHOT_MAX_HEIGHT_PX` | 8,000 | Decision. About 1.1 MB at q70 (finding 6). Single mode only |
| `TILE_MODE_THRESHOLD_PX` | 30,000 | Decision. Tiled mode when `fullHeight × devicePixelRatio` is above it. A hypothesis from one session (finding 6): 22,000 CSS px worked, 45,000 stalled, the stall is suspected near 65,535 device px |
| `MAX_TILES` | 10 | Decision. About 10 viewports from the top; 10 JPEG tiles at q70 stay near 1 MB each at most |
| `TILE_MIN_REMAINING_MS` | 3,000 | No further tile starts with less than this left in the whole-capture budget. A tile takes about 0.2 s, so 3 s leaves a wide margin and keeps the stop call and the result assembly clear of the deadline |
| `SCREENSHOT_JPEG_QUALITY` | 70 | Decision |
| `MAX_BASE64_LENGTH` | 4,194,304 | Decision (4 MiB). Applies to the sum over all images. For one image the largest allowed byte length is 3,145,728 |
| `BROWSER_VIEWPORT` | 1280 × 800 | Decision |
| `SESSION_TIMEOUT_DEFAULT/MIN/MAX_MINUTES` | 2 / 1 / 5 | Decision |
| `MAX_DETAIL_CHARS` | 200 | Keeps `detail` short |

## Schema changes to `lib/types`

Only new optional fields. No existing field changes. Existing tests in `tests/types/schemas.test.ts` and all fixtures parse as before, because zod ignores absent optional keys.

```ts
// Added to ElementSnapshotSchema
attributes: z.record(z.string(), z.string()).optional(),
textTruncated: z.boolean().optional(),
outsideImage: z.boolean().optional(),

// New, exported with its inferred type CaptureMeta
export const CaptureMetaSchema = z.object({
  devicePixelRatio: z.number().positive(),
  scrollX: z.number(),
  scrollY: z.number(),
  eligibleElementCount: z.number().int().nonnegative(),
  elementsTruncated: z.boolean(),
  light: z.boolean(),
  images: z
    .object({
      mode: z.enum(["single", "tiled"]),
      truncated: z.boolean(),
      items: z
        .array(
          z.object({
            offsetY: z.number().nonnegative(),
            width: z.number().int().positive(),
            height: z.number().int().positive(),
          })
        )
        .min(1),
    })
    .optional(),
});

// Added to BaseSnapshotSchema (so PageSnapshot, secondSample and afterReload all inherit it)
capture: CaptureMetaSchema.optional(),
```

| Field | On | Why |
|---|---|---|
| `attributes` | `ElementSnapshot` | Detectors need `disabled`, `aria-*`, `data-testid`, `type`, `name`, `href`, `for`, `placeholder`, `value` and the schema has no place for them |
| `textTruncated` | `ElementSnapshot` | A regex over cut text can miss a claim; consumers must know |
| `outsideImage` | `ElementSnapshot` | Marks boxes below or right of the cropped image so a marker is not pinned in empty space |
| `capture.devicePixelRatio`, `scrollX`, `scrollY` | `BaseSnapshot` | Randomised per session (finding 4); needed to interpret boxes and screenshot |
| `capture.eligibleElementCount`, `elementsTruncated` | `BaseSnapshot` | Tells a detector the element list is incomplete |
| `capture.light` | `BaseSnapshot` | The reload sample has lower caps and fewer attributes |
| `capture.images` (`mode`, `truncated`, `items`) | `BaseSnapshot` | Image offsets, sizes, mode and truncation; absent on `afterReload` (no screenshot) |

Mapping to existing fields: `viewportWidth`/`viewportHeight` from `innerWidth`/`innerHeight`, `fullWidth`/`fullHeight` from `scrollWidth`/`scrollHeight` (the real document height even when the image is cropped), `url` is the final page URL, `capturedAt` comes from the injected clock, `screenshotRef` stays unset. Tests go in a new file `tests/types/capture-meta.test.ts`; the existing test file is not edited.

## URL safety design

### Check order

`checkUrlSyntax` runs these steps in order and returns the first failure:

1. Length over 2,048 gives `url-too-long`.
2. Whitespace or control characters (`/[\u0000-\u0020\u007f]/`) or `new URL()` throwing gives `url-invalid`.
3. Scheme not `http:` or `https:` gives `url-scheme-blocked`.
4. Non-empty username or password gives `url-credentials-blocked`.
5. `url.port` non-empty and not 80 or 443 gives `url-port-blocked`. WHATWG drops the default port, so `https://a.com:443` has an empty port.
6. If `url.origin` equals `allowOrigin`, skip steps 7 and 8.
7. Host name rules: strip one trailing dot, then `localhost`, `*.localhost`, `*.local`, `*.internal` give `url-host-blocked`.
8. IP literal (host starts with `[` or matches four dotted numbers): classify; blocked gives `url-address-blocked`.

`new URL()` already turns decimal, octal and hex IPv4 spellings into dotted decimal (`http://2130706433/` becomes `127.0.0.1`) and IPv6 into compressed lowercase hex in brackets, so step 8 sees one canonical form. The normalised URL is `url.href` without the hash.

`checkUrl` then, for a host that is a name, calls `resolver.resolveAddresses`. A rejection or an empty list gives `dns-failed`. Any address that `classifyAddress` blocks, including unparsable text, gives `url-address-blocked`. The allow entry skips the classification but not the resolution.

### Blocked ranges

| Family | Blocked |
|---|---|
| IPv4 | 0.0.0.0/8, 10.0.0.0/8, 100.64.0.0/10, 127.0.0.0/8, 169.254.0.0/16 (includes 169.254.169.254), 172.16.0.0/12, 192.0.0.0/24, 192.0.2.0/24, 192.88.99.0/24, 192.168.0.0/16, 198.18.0.0/15, 198.51.100.0/24, 203.0.113.0/24, 224.0.0.0/4, 240.0.0.0/4 (includes 255.255.255.255), plus 168.63.129.16/32 |
| IPv6 | Allowed only inside 2000::/3. Blocked inside it: 2001::/23, 2001:db8::/32, 2002::/16, 3fff::/20. Everything outside 2000::/3 is blocked (`::`, `::1`, `::/96`, `64:ff9b::/96`, `100::/64`, fc00::/7, fe80::/10, fec0::/10, ff00::/8) |
| Mapped | `::ffff:a.b.c.d` in any spelling is judged by the IPv4 rules on `a.b.c.d` |

The 6to4 range 2002::/16 is blocked whole instead of by embedded address, which is simpler and safe. Zone identifiers (`fe80::1%eth0`) do not parse and are blocked.

### Allow entry

`NEXT_PUBLIC_APP_URL` is parsed in `parseCaptureConfig` to `new URL(value).origin` once. The comparison is `url.origin === allowOrigin`, a string equality on scheme, host and port: no wildcard, no suffix match. Only steps 7 and 8 and the range check of resolved addresses are skipped. The port rule still applies, so a local dev origin such as `http://localhost:3000` is not scannable. That is acceptable because the remote browser cannot reach a developer's localhost anyway.

### Guards in the browser

`capturePage` builds `PageGuards.allowNavigation` from `checkUrl`, with a per-capture cache from host name to verdict so each redirect hop on the same host does not repeat DNS. The remote adapter does the following:

- `context.route("**/*")`: if the request is a navigation request whose frame has no parent, call `allowNavigation`; on `allowed: false`, report `request-blocked` and `route.abort("blockedbyclient")`; otherwise `route.continue()`. Other requests continue untouched.
- `page.on("download")`: report `download-refused` and `download.cancel()`.
- `context.on("page")`: for any page other than the first, report `popup-closed` and close it.

After `goto` the orchestrator runs `checkUrl` on `finalUrl`. If a `request-blocked` event was recorded and `goto` failed, the error is `navigation-blocked`, not `navigation-failed`.

### Residual risk

- DNS is resolved by our function and again by the remote browser. A name can answer with a public address to us and a private one to the browser (rebinding). The remote browser runs in the vendor's network, outside ours and Vercel's, which limits the impact to what that network exposes. We have not verified the vendor's own egress filtering.
- The route handler is assumed to run for each redirect hop of a main-frame navigation (believed true for Chromium). Unit tests cannot prove it. The final-URL check is a backstop that runs after the request was made.
- Sub-resource requests (images, scripts, XHR) and sub-frame navigations are not checked.
- The per-capture host cache means a host that changes its answer between two hops of one capture is not re-checked.
- Page scripts run in the same JavaScript world as our collector, so a hostile page can alter what the collector sees. See "Untrusted page content".

## Capture sequence and time budget

`capturePage` starts the whole-capture `Deadline` (45 s) at entry. Each step is `deadline.run(...)`.

| # | Step | Limit | Error on failure | Typical |
|---|---|---|---|---|
| 1 | Load config, `checkUrl` (DNS inside the deadline) | whole budget | url codes, `dns-failed`, `config-invalid` | < 0.2 s |
| 2 | `getBrowser(config)` | none | `browser-mode-unsupported` | 0 |
| 3 | `createSession` (POST) | 10 s | `session-create-failed`, `session-create-timeout` | 0.5 s |
| 4 | `connect` then `installGuards` | 15 s | `connect-failed`, `connect-timeout` | 0.5 s |
| 5 | `goto(url)` with `load`, then `checkUrl(finalUrl)` | 15 s | `navigation-failed`, `-timeout`, `-blocked` | 0.5 to 2 s |
| 6 | Sleep `SETTLE_DELAY_MS` | whole budget | `capture-timeout` | 0.5 s |
| 7 | `collect(full options)`, then `buildSample` | whole budget | `page-read-failed` | 0.05 s |
| 8 | `captureImages`: `chooseMode`, then one clipped image (single) or up to 10 viewport tiles (tiled); check the base64 sum | whole budget | `screenshot-failed`, `screenshot-too-large`; later tile problems are warnings | single 0.3 to 1 s; tiled about 0.2 s per tile |
| 9 | If `remainingMs() >= 12,000`: `reload`, sleep, `collect(light)`; else warn `reload-skipped` | min(15 s, remaining) | warning `reload-failed` only | 1 to 2 s |
| 10 | Assemble, validate with `PageSnapshotSchema` | none | `snapshot-invalid` | < 0.01 s |
| 11 | `finally`: `withTimeout(stop(), 10 s)` | 10 s | warning `session-stop-failed` | 0.3 s |

Worst case: 45 s plus the 10 s stop call is 55 s. The default session timeout of 2 minutes covers the capture and the stop call with margin; the timeout is charged upfront and refunded on stop.

The first-sample steps (3 to 8) and the reload (9) are independent: any failure before step 9 returns an error; any failure in step 9 becomes a warning. If `afterReload` alone fails `BaseSnapshotSchema`, it is dropped with `reload-failed` and the rest is validated.

Session creation that is still pending when the whole deadline fires is tracked: when the promise later resolves, `stop()` is called on the handle without waiting (see "Error handling").

## Element collection

`collectInPage(options)` is a plain function with no imports or closures, so Playwright can serialise it. It walks `document.documentElement` in document order with a tree walker over elements.

- Skipped: `script`, `style`, `noscript`, `template`, `head` and everything inside `head`.
- Eligible: form controls (`input`, `select`, `textarea`, `button`), the selected `option` of each `select`, `a[href]`, `label`, `summary`, elements with `role`, and elements with at least one non-blank direct text node.
- Non-controls with a zero-width or zero-height box are skipped, so hidden menus do not use the cap. Controls are kept without a box because custom switches hide the real input.
- The walker counts every eligible element (`eligibleCount`) but stores only the first `maxElements`.
- `text`: collapsed whitespace. Own text nodes for plain text elements, so a parent does not repeat its children. Visible text (`innerText`) for controls, links, labels, summaries and role elements. Cut at `maxTextChars` with `textTruncated`.
- `path`: element-child index at each level from `<html>`. The post-processing turns `[1, 0, 3]` into `el-1-0-3`. The path depends only on DOM position, so an unchanged DOM gives the same ids in both samples, whatever the caps are.
- Attributes, full read: `disabled`, every `aria-*`, `data-testid`, `type`, `name`, `href`, `for`, `placeholder`, `value`. Light read: `type`, `name`, `disabled`, `data-testid`. Each value is cut at `maxAttrChars`. `value` is kept only for `input` of type `checkbox`, `radio`, `submit`, `button`, `reset`, for `button` and for `option`, because a text, password or hidden input can hold user or secret data.
- Style fields come from one `getComputedStyle(el)` call per element. `backgroundColor` is the element's own value; the effective background is a detector concern.

`buildSample(raw, params)` runs outside the page and never trusts it:

1. Drop elements whose shape is wrong (missing `path`, non-string `tag`, non-object `rect`).
2. Re-apply the element cap, the text cap and the attribute allowlist for the light or full mode. Strings are cut, not rejected.
3. Replace non-finite numbers with 0 and negative sizes with 0, round to two decimals.
4. Convert boxes: `x = rect.left + scrollX`, `y = rect.top + scrollY`.
5. For the first sample only, set `outsideImage` from `isOutsideImages` against all images, and copy the images metadata into `capture.images`.
6. Fill `viewportWidth`, `viewportHeight`, `fullWidth`, `fullHeight`, `capture`, `url`, `capturedAt`.

`collectInPage` runs in the page's main world (Playwright `evaluate` has no isolated world). A hostile page could replace `getComputedStyle` or `getBoundingClientRect` and feed false values. The post-processing bounds the damage to wrong data inside the schema. Detectors and the judge must not treat any value as ground truth about the shop's intent.

## Geometry and screenshot

```ts
// geometry.ts
export type ImageBox = { offsetY: number; width: number; height: number };
export type ScreenshotMode = "single" | "tiled";
export function toDocumentBox(rect: RawElement["rect"], scroll: { x: number; y: number }): BoundingBox;
export function chooseMode(page: { fullHeight: number; devicePixelRatio: number }): ScreenshotMode;
export function planSingle(page: { fullHeight: number; viewportWidth: number }): ImageBox & { truncated: boolean };
export function tileTarget(index: number, viewportHeight: number): number;       // index * viewportHeight
export function tileCount(fullHeight: number, viewportHeight: number): number;    // min(MAX_TILES, ceil(fullHeight / viewportHeight))
export function reachesBottom(last: ImageBox, fullHeight: number): boolean;      // offsetY + height >= fullHeight - 1
export function isOutsideImages(box: BoundingBox, images: readonly ImageBox[]): boolean;
export function base64Length(byteLength: number): number;                        // 4 * ceil(n / 3)
export function totalFits(byteLengths: readonly number[]): boolean;              // sum of base64Length <= 4_194_304
```

Mode choice: `chooseMode` returns `"single"` when `fullHeight * devicePixelRatio <= TILE_MODE_THRESHOLD_PX` (30,000) and `"tiled"` above it. 30,000 exactly is single; 30,001 is tiled. The product uses the DPR read from the page (finding 4).

**Single mode** (`planSingle`): `height = ceil(min(fullHeight, 8000))`, `truncated = fullHeight > 8000`, `width = ceil(viewportWidth)`, both at least 1, `offsetY = 0`. One request `{ kind: "clip", clip: { x: 0, y: 0, width, height }, quality: 70 }`. The remote adapter passes `fullPage: true`, the clip, `type: "jpeg"`, `quality: 70`, `scale: "css"`. Playwright reads a clip relative to the page when `fullPage` is true; the opt-in integration test checks this on the Boo-tique. With `fullHeight × DPR <= 30,000` this is the same call that worked in the experiment (up to about 22,000 CSS px).

**Tiled mode** (`captureImages` in `screenshots.ts`). The element read has already happened (step 7 of the sequence), so scrolling cannot change the boxes. The loop is:

1. `scrollTo(0)`, take a viewport tile.
2. For tile index `i` from 1: stop if `i == MAX_TILES`, if the previous tile `reachesBottom`, or if `deadline.remainingMs() < TILE_MIN_REMAINING_MS`. Otherwise `scrollTo(tileTarget(i, viewportHeight))`, and use the returned real `scrollY` as `offsetY` of the tile it then takes. The browser clamps the scroll at `fullHeight - viewportHeight`, so the last tile can overlap the previous one.
3. After the loop, `scrollTo(0)` (best effort; a failure here is ignored).

Each tile is a `{ kind: "viewport", quality: 70 }` request with width `ceil(viewportWidth)` and height `ceil(viewportHeight)`, `offsetY` as read back. Every scroll and screenshot runs through the whole-capture `Deadline`. `truncated` is true when the final tile does not reach the bottom (`offsetY + height < fullHeight - 1`) and false when it does. A fixed or sticky header repeats in every tile; this is accepted and not removed. The warning `tall-page-tiled` is always added in tiled mode; `screenshot-truncated` is added whenever `truncated` is true, in either mode.

Failures in tiled mode: if the first tile fails, `screenshot-failed`. If a later scroll or tile fails, or time runs short, the tiles taken so far are kept, `truncated` is true and `screenshot-truncated` is added. The tiles are never retried.

**Outside-image flag.** `isOutsideImages(box, images)` is true when no image covers any part of the box. An image covers a box when `box.y < offsetY + height && box.y + box.height >= offsetY && box.x < width`. With one image at `offsetY` 0 this is the old rule: a box that starts at or below the image height, or at or right of the width, is outside; a box that starts inside and extends beyond is not. An element covered by at least one tile is not flagged. Boxes right of the images are flagged because the width is clipped to the viewport width (horizontal overflow is rare and would multiply the image size).

**Size limit.** `totalFits(byteLengths)` sums `base64Length` over all images and compares with 4,194,304. For one image, 3,145,728 bytes fits and 3,145,729 does not. `captureImages` checks the sum after the last image is taken and throws `screenshot-too-large` if it is exceeded; no image is returned in that case.

`CaptureImage` objects come from `captureImages`; the matching snapshot metadata is `capture.images` (`mode`, `truncated`, `items` with `offsetY`, `width`, `height`).

## Error handling

Internal failures are `CaptureFailure` exceptions; `capturePage` has one outer `try/catch` that turns them into `{ ok: false }`. A non-`CaptureFailure` exception becomes `internal-error`. Seam implementations throw `CaptureFailure` only; the orchestrator also wraps each stage so a seam that throws something else gets the stage's code (for example `navigation-failed`).

| Condition | Result |
|---|---|
| URL refused (codes of requirements 1 to 3) | `ok: false`, no session |
| Config invalid, or mode unsupported | `ok: false` with `config-invalid` or `browser-mode-unsupported`, no session |
| Create fails or times out | `ok: false`, no stop call |
| Any failure after create | `ok: false`, stop called once |
| Whole deadline | `capture-timeout`, stop called once |
| Reload step fails | `ok: true`, warning `reload-failed` |
| First tile fails (tiled mode) | `screenshot-failed`, stop called once |
| Later tile fails or time is short (tiled mode) | `ok: true`, tiles kept, `truncated`, warning `screenshot-truncated` |
| Stop fails or exceeds 10 s | result unchanged, warning `session-stop-failed` |
| Validation fails | `snapshot-invalid`, stop called once |

`message` is `ERROR_MESSAGES[code]`. `detail` is set for `session-create-failed`, `connect-failed`, `navigation-failed`, `page-read-failed`, `screenshot-failed` and `internal-error`: `toDetail(error, secrets)` redacts, collapses whitespace and cuts to 200 characters. It is meant for server logs written by the caller, not for users. Warnings carry only a code and a fixed message.

`finally` structure:

```
handle = undefined
try { handle = await create...; ...all later steps... }
catch (e) { error = toCaptureError(e) }
finally { if (handle) await stopSafely(handle) }   // adds session-stop-failed on error
```

For step 3, when the whole deadline wins the race, `createPromise.then((h) => stopSafely(h))` is attached so a late session is still stopped. If the vendor created the session but the response never arrived (aborted fetch), the session cannot be stopped from here; the small timeout bounds the cost (risk 2).

## Secrets and redaction

`redactText(text, secrets)` applies, in order: replace each exact secret (non-empty, length at least 4) with `[redacted]`; replace `wss?://` followed by non-space characters with `[redacted-url]`; replace `*.cdp.browser-use.com` host strings, with or without scheme, port and path, with `[redacted-url]`. `secrets` holds the API key, session id, `cdpUrl` and `liveUrl`; `remote-browser.ts` builds the list after the create call. `toDetail` redacts first, then collapses whitespace, then cuts. The library calls no `console.*`. Results never include the handle, the `cdpUrl`, the `liveUrl` or the id. A test serialises success and failure results built with sentinel secrets and asserts none appear.

## Untrusted page content

Page text and attributes reach the snapshot only through caps and an attribute allowlist. This library never evaluates them and never builds a selector, URL or shell input from them. `types.ts` and `capturePage` carry a doc comment saying so, and the steering note repeats it. Every consumer must treat snapshot text as untrusted. The later LLM judge in particular must wrap it as quoted data and never follow instructions found in it, because a page can write "ignore previous instructions" into any element.

## Test strategy

| Area | Kind | File(s) in `tests/capture/` |
|---|---|---|
| Error and warning tables, constants | unit | `types.test.ts`, `constants.test.ts` |
| Redaction | unit, sentinel secrets | `redact.test.ts` |
| Clock and deadline | unit, manual clock (`helpers/manual-clock.ts`) | `clock.test.ts` |
| Config | unit, injected env objects, reads `.env.example` | `config.test.ts` |
| IP ranges | unit table | `ip-ranges.test.ts` |
| URL syntax, DNS, allow entry (40+ cases) | unit, fake `Resolver` | `url-check.test.ts` |
| Default resolver | unit, `vi.mock("node:dns/promises")` | `resolver.test.ts` |
| Geometry, mode choice and tile planning | unit | `geometry.test.ts` |
| Single and tiled screenshots through the fake page | unit, fake browser, manual clock | `screenshots.test.ts` |
| Extractor post-processing | unit on raw fixtures; `collectInPage` checked only for self-containment (its source has no `__name`, `import(`, `require(`) | `extractor.test.ts` |
| Browser Use client | unit, fake `fetch` | `browser-use-api.test.ts` |
| Remote adapter | unit, fake `loadPlaywright` | `remote-browser.test.ts` |
| `getBrowser` | unit | `browser.test.ts` |
| Fake implementation sanity | unit | `fake-browser.test.ts` |
| Orchestrator happy path, validation, guards, secrets | unit, fake browser, manual clock | `capture.test.ts` |
| Stop on every path, error mapping | unit, fake browser | `capture-stop.test.ts` |
| The four deadlines | unit, manual clock | `capture-deadlines.test.ts` |
| Reload sample and its rules | unit, fake browser, manual clock | `capture-reload.test.ts` |
| Schema extension | unit | `tests/types/capture-meta.test.ts` |
| Pins and tracing config | unit, reads `package.json` and imports `next.config.ts` | `dependencies.test.ts`, `tracing-config.test.ts` |
| Live capture on the Boo-tique | opt-in | `remote-capture.test.ts` |

The fake browser (`helpers/fake-browser.ts`) is scripted per step: each seam method can succeed, throw a `CaptureFailure`, hang until the manual clock advances, or return canned data. It counts `createSession`, `connect` and `stop` calls, records every `scrollTo` and every `screenshot` request in order (so a test can assert that tiled mode never sees a `clip` request and ends with `scrollTo(0)`), and can return a scripted `scrollY` per call to simulate clamping. Files that import a `server-only` module start with `vi.mock("server-only", () => ({}))`.

Covered only by the opt-in integration test: the real Browser Use API, `connectOverCDP`, `collectInPage` against a real DOM, the single-mode screenshot clip, and the real stop call. Not covered by any automated test: redirect-hop interception in a real browser, download and pop-up handling in a real browser, real tiled capture on a 45,000 px page, the proxy-on path, and vendor billing. Node has no DOM in this repo (no jsdom), so `collectInPage` cannot run in unit tests.

## Risks

1. **Tall-page screenshots.** Measured on a 45,000 px page: a full-page screenshot and a CDP `captureBeyondViewport` capture with a 3,000 px or 8,000 px clip each stalled for about 95 s, with the proxy on or off, while viewport screenshots after scrolling took about 0.2 s each. The design therefore never calls a full-page or clipped-beyond-viewport screenshot above `fullHeight × devicePixelRatio > 30,000`; it takes up to 10 viewport tiles instead (see "Geometry and screenshot"). Residual risks: the 30,000 threshold is a hypothesis from one session (the suspected limit is about 65,535 device px, and only 22,000 and 45,000 CSS px were tried, so a page between them might still stall in single mode and end in `capture-timeout`); sticky or fixed headers repeat in every tile and are accepted; 10 tiles cover about 10 viewports (about 8,000 CSS px at the 800 px viewport height), so very tall pages are truncated.
2. **Orphan sessions.** An aborted create call may still have created a session. It is billed for the timeout (default 2 min) with no way to stop it from here.
3. **Transpiler helpers in `collectInPage`.** A build step that adds helpers such as `__name` breaks `page.evaluate`. The self-containment test guards the vitest build; the integration test covers the Next build path.
4. **Clip with `fullPage` in single mode.** Assumed supported by Playwright 1.64.1. The integration test checks it. Tiled mode does not use it.
5. **Route interception cost.** `**/*` interception adds a round trip per request. Not measured; the integration test does not time it.
6. **Response size.** The images are bounded at 4 MiB of base64 in total, but the snapshot JSON (about 0.7 MB at 1,500 elements) adds to a response. The scan route must upload the images to storage and return URLs, as `tech.md` says.
7. **Version coupling.** `playwright-core` 1.64.1 must keep working with the vendor's Chromium. Pinned exactly; upgrades are a deliberate change.
8. **Hostile pages** can distort measured values (see "Untrusted page content").

## Deviations and notes

- `tech.md` says local Chromium is used in tests. This spec's tests use the fake and never a browser; the local mode comes in a later spec.
- `.env.example` has a `BROWSER_CDP_ENDPOINT` variable. This spec removes it because the CDP address is per session and comes from the create call.
- `docs/research/architecture.md` suggests a cap of about 6,000 px; the owner's decision is 8,000 px.
- `structure.md` lists two files under `lib/capture/`; the last task updates it to the list above.
- The route key `/api/scan` in `next.config.ts` must be kept in sync by the later scan-route spec, and by any other route that imports `lib/capture`.
