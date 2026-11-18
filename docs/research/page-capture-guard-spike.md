# Page capture: request-guard spike (N1, N3, N4)

- **Purpose.** Facts for the fix of findings N1, N3 and N4 of [[page-capture-review-2]]. Kiro writes and implements the fix from this note.
- **Code under study.** Worktree `scratchpad/tot-capture`, branch `feat/page-capture`, head `35fcdfa`; `lib/capture/request-guard.ts` and `lib/capture/remote-browser.ts`. Nothing in any worktree was edited, staged or committed; `git status --short` is empty.
- **Date and access.** 2026-11-18. Live probes against Browser Use Cloud. The remote browser reported `Chrome/156.0.8078.79`. playwright-core 1.64.1 was imported from the worktree's `node_modules`.
- **Sessions.** 11 of the 20 allowed (probes p1 to p10; p4 ran twice). Every session had a 2 or 3 minute timeout and no proxy.
  - Each was stopped with `PATCH {"action":"stop"}` in a `finally`. All 11 stops answered HTTP 200 (`$G/out/sessions.log`).
  - Each read back as `stopped`, except p2, whose result file was lost to a script bug.
  - At the end, `GET /api/v4/browsers?filterBy=active&pageSize=100` returned `totalItems: 0`.
- **Secrets.** The key was loaded only through `node --env-file`. Output went through a redaction filter. Every saved file passed a leak check for the key, UUIDs, `cdpUrl` and `wss://` addresses: 0 hits.
- **Evidence.** In session scratch, which can be cleared: the spike agent's scratch directory, written here as `$G/`.
  - Scripts: `browser-guard.mjs` (the sketch below as runnable JS, run in p8, p9 and p10), `guard.mjs` (earlier spike guard, p1 to p6), `fixtures.mjs`, `probe1.mjs` to `probe10.mjs`, `lib.mjs`.
  - Results: `$G/out/probe{1,3,4,5,6,7,8,9,10}.json`. For p2 only `probe2.stdout` survives, without the paused-request log; `probe4.json` holds the second p4 run.
  - Also `$G/out/protocol-picks.json`: the browser's own `/json/protocol` entries for `Fetch` and `Network.setBlockedURLs`.

## Answer in short

**Use browser-level `Fetch`.**
- **Mechanism.** Open one `Fetch.enable` on a browser-target CDP session that Playwright itself creates, with `browser.newBrowserCDPSession()` (`Target.attachToBrowserTarget`).
- **No children.** No child attach, no `waitForDebuggerOnStart` and no second connection.

**Results, all live:**
- **Requests seen.** In Chrome 156 at the vendor, that one session paused every `http:` and `https:` request from every request source tested. Each paused request could be refused. The sources:
  - the main frame, same-site and cross-site iframes;
  - dedicated, shared and service workers, and popups;
  - redirect hops, and both attempts of Chrome's HTTPS upgrade;
  - beacons, EventSource, prefetch, CSS and fonts, form POSTs and meta refresh.

  Requests that never go out are not paused: mixed content that Chrome blocks itself, and `ftp:`, which the vendor browser blocks with `ERR_BLOCKED_BY_ADMINISTRATOR`.
- **Children run.** Cross-site iframes and workers load and run normally.
- **Playwright works.** Navigation, reload, `evaluate`, isolated-world calls and full-page screenshots kept working, with no hang.

**What the guard does not cover:**
- **WebSocket.** `Fetch` never sees it, and `Network.setBlockedURLs` does not block it.
- **WebTransport, WebRTC, preconnect and DNS rebinding.** The guard cannot cover these either.
- **Optional WebSocket hardening, verified live.** It costs about 0.25 to 0.6 s more per page load:
  - re-serve every document and every JavaScript response with `Fetch.getResponseBody` and `Fetch.fulfillRequest`;
  - add `Content-Security-Policy: connect-src http: https: data: blob:`.

  This blocked `wss:` in every page, frame and worker context tested. With documents only, URL-script workers escaped: they take their policy from their own script response.

**Losing the guard fails open.** When its CDP session detaches or the connection drops, Chromium releases all interception and the page's requests go out unguarded. The capture must therefore treat guard loss as fatal and stop the session at once (the stop call took 578 to 823 ms). How fast a *silent* drop is detected was not measured.

**Service workers: refuse them by default.**
- **How.** Refuse every request that carries `Service-Worker: script`.
- **Effect.** Registration then fails, so a page cannot install a worker. The capture does not need one.
- **Cost.** One header check.
- **Verified live** with the sketch code (p10), after p7.
- **If the policy is turned off.** A service worker's own fetches are still paused and refused (p1).

**N4.** `filterBy=active` is the real filter, and `status=` is ignored. `pageSize` is 1 to 100 (101 → 422), and `pageNumber` starts at 1. `metadata=key=value` is an exact, repeatable AND filter (call under N4 below).

## Recommended design

### Call sequence

All calls go over **Playwright's single CDP connection**, so there is no second connection. Two CDP sessions are used:
- the **page session** that `remote-browser.ts` already opens with `context.newCDPSession(page)`;
- one new **guard session** on the browser target.

| Step | Session | Call | Notes |
|---|---|---|---|
| 1 | — | `chromium.connectOverCDP(cdpUrl)`; `page = contexts()[0].pages()[0]` | As today. |
| 2 | page | `Emulation.setScrollbarsHidden {hidden:true}` | As today. |
| 3 | page | `Page.getFrameTree` → `mainFrameId = frameTree.frame.id` | The browser-level events carry the same `frameId` (verified: `mainFrame` was true for top documents and false for iframe documents). It stayed valid across cross-site main-frame navigations and the redirect hop. |
| 4 | — | `guard = await browser.newBrowserCDPSession()` | Playwright sends `Target.attachToBrowserTarget`, so it owns the session id and delivers events. This is what the old page-level child sessions lacked. |
| 5 | guard | Register `guard.on("Fetch.requestPaused")`, `guard.on("close")` and `browser.on("disconnected")` | **Before** step 6, so no event is missed. |
| 6 | guard | `Fetch.enable {patterns:[{urlPattern:"*", requestStage:"Request"}]}` | One call covers every target, also those created later. Measured 288 ms for steps 4 to 6. |
| 7 | — | `page.goto(url)` | Only after step 6 resolved. |
| per event | guard | `Fetch.continueRequest {requestId}` or `Fetch.failRequest {requestId, errorReason:"BlockedByClient"}` | The verdict comes from the existing `decide` (syntax, then host plus DNS, verdict cache, host limit, decision timeout). A redirect hop is a new paused event with `redirectedRequestId`. |
| teardown | — | `PATCH stop` first, then `browser.close()` | Already the order in `stop()`. Never `guard.detach()` while the page is alive (see Fail-closed). |

Remove the following:
- From `request-guard.ts`: `Target.setAutoAttach` (the cause of N1), `onAttachedToTarget`, every three-argument `send`, `Runtime.runIfWaitingForDebugger` and `Target.closeTarget`.
- From `cdp.ts` / `remote-browser.ts`: the `targetSessionId` parameter.
- `Network.setBypassServiceWorker` is no longer needed: service-worker scripts are refused, and even without that a worker's own fetches are paused and refused. If kept, it must go on the page session; it does not exist on the browser target.

**Main-frame flag.** `mainFrame = ev.resourceType === "Document" && ev.frameId === mainFrameId`.
- The `resourceType` check is required: requests from a dedicated worker carry their owner frame's id (the top-level workers' XHRs had `frameId === mainFrameId`).
- Popup documents have their own frame id, so they are not the main frame.

### Code sketch

This is a typed rewrite of `$G/browser-guard.mjs`, the JavaScript that ran in p8, p9 and p10. The flow and the branches are the same, but the code is not identical:
- `decide(...)` stands for `policy.decide(...)`;
- `withTimeout` takes the repo's clock;
- `refuse` is a helper;
- `onResponse` is optional;
- `report` gets no event object.

Which probe exercised which branch with that file:
- **Request path, refusal, report and main-frame flag:** p8 and p9. A refused main-frame `goto` reported `mainFrame: true`; iframe and subresource refusals reported `false`.
- **Decision timeout:** p8. A 10 s verdict became a refusal at 2.3 s with a 2 s timeout.
- **Service-worker check:** p10. Registration was rejected and reported as `service-worker-blocked`.
- **`onResponse` hook:** p8 and p10 (hardening).
- **Fallback `failRequest` after a failed answer:** never triggered with this file. In the earlier `guard.mjs` (p4), 2 of 82 answers threw `Invalid InterceptionId`. That fallback was added after p2 left a request paused.

**What to take over.** In the repo, `decide` and `report` are the existing `request-guard.ts` parts, minus the child-session code.

```ts
// lib/capture/browser-guard.ts (sketch)
type HeaderEntry = { name: string; value: string };
type Paused = {
  requestId: string;
  request: { url: string; method: string; headers: Record<string, string> };
  frameId?: string;
  resourceType: string; // "Document", "XHR", "Fetch", "Image", "Ping", "Other", ...
  redirectedRequestId?: string;
  responseStatusCode?: number; // set only at the Response stage (optional hardening)
  responseErrorReason?: string;
  responseHeaders?: HeaderEntry[];
};
/** Playwright's CDPSession from browser.newBrowserCDPSession(): send takes exactly two arguments. */
type BrowserCdp = {
  send(method: string, params?: Record<string, unknown>): Promise<any>;
  on(event: "Fetch.requestPaused", handler: (ev: Paused) => void): void;
  on(event: "close", handler: () => void): void;
};
type PwBrowser = { newBrowserCDPSession(): Promise<BrowserCdp>; on(event: "disconnected", h: () => void): void };
type GuardOptions = {
  clock: Clock;
  decisionTimeoutMs: number;
  onLost: (why: "session-closed" | "disconnected") => void;
  /** Optional hardening only; without it the Response stage is never enabled. */
  onResponse?: (session: BrowserCdp, ev: Paused) => Promise<unknown>;
};

export async function installBrowserGuard(browser: PwBrowser, mainFrameId: string, policy: RequestPolicy, opts: GuardOptions) {
  const session = await browser.newBrowserCDPSession();
  let lost = false;
  const markLost = (why: "session-closed" | "disconnected") => {
    if (lost) return;
    lost = true;
    opts.onLost(why); // the capture must fail and stop the session now
  };
  session.on("close", () => markLost("session-closed"));
  browser.on("disconnected", () => markLost("disconnected"));
  const refuse = (requestId: string) =>
    session.send("Fetch.failRequest", { requestId, errorReason: "BlockedByClient" }).catch(() => {});

  session.on("Fetch.requestPaused", async (ev) => {
    if (ev.responseStatusCode !== undefined || ev.responseErrorReason !== undefined) {
      await (opts.onResponse?.(session, ev) ?? Promise.reject()).catch(() => refuse(ev.requestId));
      return;
    }
    const isDocument = ev.resourceType === "Document";
    const mainFrame = isDocument && ev.frameId === mainFrameId;
    let verdict: GuardVerdict;
    try {
      verdict = isServiceWorkerScript(ev)
        ? { allowed: false, reason: "service-worker-blocked" } // new UrlErrorCode; default on
        : await withTimeout(opts.clock, opts.decisionTimeoutMs, decide(ev.request.url, isDocument), "capture-timeout");
    } catch {
      verdict = { allowed: false, reason: "url-invalid" }; // a verdict that throws or is late is a refusal
    }
    try {
      if (verdict.allowed) {
        await session.send("Fetch.continueRequest", { requestId: ev.requestId });
        return;
      }
      await quietly(() => policy.report({ kind: "request-blocked", reason: verdict.reason, mainFrame }));
      await session.send("Fetch.failRequest", { requestId: ev.requestId, errorReason: "BlockedByClient" });
    } catch {
      // Gone ("Invalid InterceptionId" after a navigation cancelled it) or an invalid answer.
      // Fail closed: a paused request must never stay paused or be continued by accident.
      await refuse(ev.requestId);
    }
  });

  // Rejects (→ connect-failed) if the vendor ever refuses browser-target Fetch.
  await session.send("Fetch.enable", { patterns: [{ urlPattern: "*", requestStage: "Request" }] });
  return { session, lost: () => lost };
}

/** Service-worker scripts are fetched with "Service-Worker: script" (seen live, p7). */
function isServiceWorkerScript(ev: Paused): boolean {
  return Object.entries(ev.request.headers ?? {}).some(([k, v]) => k.toLowerCase() === "service-worker" && v === "script");
}
```

**Wiring in `remote-browser.ts`:**
- Types: extend `PwBrowser` with `newBrowserCDPSession()` and `on("disconnected")`, and `PwCdpSession` with `on("close")`.
- Install: in `installGuards`, read `mainFrameId` from the page session, then call `installBrowserGuard(state.browser, mainFrameId, guards, …)` before returning.
- `onLost`: reject the running stage with a new code (for example `guard-lost`) and start `stop()` at once, without waiting for the stage.

## Coverage

Spike policy used in the live probes:
- **Refused:** non-default ports, `192.0.2.0/24`, non-HTTP(S) network schemes, and any path under `/deny/`.
- **Why `/deny/`.** `https://example.org/deny/<tag>` is a real, reachable URL. So the page outcome tells the cases apart: `LOADED` means the request went out, and `ERR` means it was refused.
- **Fixtures.** Pages under `/__spike/` on `example.com`, `www.example.com` and `example.net` were synthetic: the guard served them with `Fetch.fulfillRequest`, and their subresources were real requests. The service-worker rows used a real HTTPS origin: `httpbingo.org`, with the worker script served from `/base64/…`.

Repeat counts:
- Probe 1 loaded the fixture page 4 times. In every run, all 10 `/deny/` tags and the port case were paused and refused, so no first-request race appeared.
- Repeats outside the fixture runs:
  - Main-frame refusal, IP literals and popup navigation ran in two probes or more.
  - Redirect hop, beacon, EventSource, prefetch, CSS, font, form POST, meta refresh, service-worker fetches and popup subresources ran once each.

| Request source | Seen by guard | Refusable | How verified |
|---|---|---|---|
| Main-frame navigation | yes (`Document`, `mainFrame` true) | yes | live (p1, p4) |
| Main-frame redirect hop | yes (`redirectedRequestId` set, `mainFrame` true) | yes: `net::ERR_BLOCKED_BY_CLIENT` on `goto` | live (p4) |
| Main-frame subresources: img, `fetch`/XHR, `sendBeacon` (`Ping`), EventSource, `<link rel=prefetch>`, CSS `@import`, `@font-face` | yes | yes | live (p1, p4) |
| IP-literal URL (`https://192.0.2.1/…`, `http://192.0.2.1/…`) | yes | yes | live (p3, p9) |
| Plain `http:` page (`http://portquiz.net/`): its `http:` img, `fetch`, iframe, IP-literal img and fetch, `:8080` iframe, explicit `:80` | yes | yes | live (p9) |
| Chrome's HTTPS upgrade of an `http:` navigation | yes: both the `https:` attempt and the `http:` fallback were paused | yes | live (p8, p9) |
| `http:` subresource on an `https:` page (mixed content) | image: auto-upgraded to `https:`, then paused and refused. `fetch` and IP-literal image: blocked by Chrome as `mixed-content`, never sent, never paused. | n/a | live (p8, page `Network` events) |
| `ftp:` iframe | no | n/a: the vendor browser blocks it (`net::ERR_BLOCKED_BY_ADMINISTRATOR`); Chrome no longer loads FTP | live (p9) |
| Same-site iframe document (`example.com:8443`) | yes | yes: frame shows `chrome-error:` | live (p1, 4 runs) |
| Same-site iframe subresources (initial HTML and script) | yes | yes | live (p1) |
| Cross-site iframe (OOPIF): document, initial-HTML img, `fetch`, blob worker inside it | yes | yes | live (p1, 4 runs) |
| Cross-site iframe liveness | — | — | live: the real `example.org` frame loaded with the guard on; data page with it loaded in 694–708 ms vs 388–507 ms without (p1). N1's hang is gone. |
| Form POST into an iframe; meta refresh in a `srcdoc` iframe | yes (`Document`, `mainFrame` false) | yes | live (p4) |
| Dedicated worker, blob URL, fetch as first statement | yes | yes | live (p1, 4 runs) |
| Dedicated worker, URL script: script fetch and first-statement fetch | yes | yes | live (p1) |
| Dedicated worker liveness | — | — | live: a blob worker posted `RAN` with the guard on (p1). |
| Shared worker, URL script: script fetch and first-statement fetch | yes | yes | live (p1, 4 runs) |
| Service worker: script fetch (`Other`, header `Service-Worker: script`) | yes | yes: registration rejected | live (p1 seen; p7 and p10 refused) |
| Service worker: own fetches at script start and on `message` | yes | yes | live, real origin (p1) |
| Popup (`window.open` with a gesture): navigation | yes | yes: popup shows `chrome-error:` | live (p1, p2) |
| Popup: its own subresources | yes | yes | live (p2) |
| Popup without a user gesture | — | — | live: the vendor browser's popup blocker returned `null` (p2). Do not rely on it. |
| Nested cross-site iframe (iframe in an OOPIF) | expected yes | expected yes | by reading: interception is browser-wide, not per target. Not tested. |
| Downloads | expected yes (`Document`/`Other`) | expected yes | by reading; not tested |
| WebSocket (page, dedicated worker, shared worker, `data:`/`about:blank`/`blob:` iframe, popup `about:blank`, cross-site iframe) | **no**: no paused event in the saved logs (p1, p3) | not by `Fetch`; `Network.setBlockedURLs` (`urls` and `urlPatterns` forms) on the page session blocked HTTP but **not** `wss:`; the browser target has no `Network` domain | live (p1, p2, p3) |
| WebSocket with the optional hardening, documents re-served with the CSP | — | page, blob worker, blob shared worker, `data:`/`about:blank`/`blob:` iframes, popup `about:blank`, cross-site iframe: `error`. **URL-script dedicated and shared workers: `open`** (escape). | live (p7, p8) |
| WebSocket with the hardening extended to JavaScript responses (`Other` at the Response stage) | — | all of the above, URL-script workers included: `error` | live (p8) |
| WebTransport (`https://host:4433`) | no | no: `connect-src https:` admits it; same result with and without hardening | live for "not seen" (p3 log); not blocked, by reading (the handshake failed the same way in p2, p3 and p7 because nothing listens there) |
| WebRTC (STUN/TURN), preconnect, DNS prefetch | no | no | by reading; not tested |
| DNS rebinding (our resolver vs the browser's) | n/a | no | by reading (unchanged from review 2) |
| Non-page browser traffic (updates, telemetry) | none observed | — | live: in the saved logs (p1, p3, p4), every paused request belonged to a page we loaded |

## What failed or was not needed

| Design | Status | Why |
|---|---|---|
| **N1 as shipped** (page-session `Target.setAutoAttach` with `waitForDebuggerOnStart`, child commands with a third `send` argument) | fails | Review 2 showed it live. Playwright's `CDPSession.send` takes two arguments, and its connection drops messages for session ids it did not create. Not re-run. |
| **D0: browser-level `Fetch` on `browser.newBrowserCDPSession()`** | **works** | Recommended above. |
| **A: second raw CDP WebSocket** | precondition met; not pursued | The vendor accepted a second connection: `Browser.getVersion` and `Target.getTargets` answered, and Playwright kept working (p1). Not pursued because D0 does the same on Playwright's own connection. A second connection would add a separate failure domain: the guard socket can drop while Playwright keeps driving the page, unguarded. It would also need per-target attach and resume, whose interaction with Playwright's own `waitForDebuggerOnStart` was not tested. |
| **B: non-flattened `Target.sendMessageToTarget`** | not tested | Unnecessary after D0. The mode is deprecated, and it would need per-target JSON tunnelling. |
| **C: no child attach plus policy fallback** | not tested | Unnecessary after D0. From reading: refusing cross-site subframes breaks payment, video and chat embeds. Workers and service workers cannot be switched off over CDP without per-target attach. `connectOverCDP` uses the existing default context, so the `serviceWorkers: "block"` context option does not apply. |
| **D: vendor network policy (`networkPolicyId`)** | docs only, not used | [Network policies](https://docs.browser-use.com/cloud/browser/network-policies.md). Lists are domains only; the API answers 422 for IPs, ports and URLs. The vendor proxy applies them, and we run with the proxy off. A policy is persistent account configuration, so none was created. It can add a hostname blocklist but cannot express private ranges or ports. `customProxy` (enterprise) is the egress control for what CDP cannot see. |
| `Network.setBlockedURLs` for WebSocket | fails | Accepted on the page session in both forms; blocks HTTP; does not block `wss:` in Chrome 156 (p2). Not available on the browser target (`'Network.setBlockedURLs' wasn't found`, p1). |
| CSP added with `Fetch.continueResponse` (response stage, header only) | fails | No effect, even with `connect-src 'none'`: `fetch` and `wss:` both still succeeded (p4). The same header delivered with `Fetch.fulfillRequest`, or as a `<meta>` tag, was enforced (p5, p6). Also, in p2 a `continueResponse` with headers but without `responseCode` left the document paused until the 15 s `goto` timeout. The cause is **inferred** from the protocol text ("if either responseCode or headers are modified, all of them must be present"); the p2 error log was lost. |

## Timing

**What was measured.**
- **Path.** Measured from the owner's machine to the vendor's browser. Command round trip: about 140 ms (`Browser.getVersion` 142 ms; other single commands 138 to 144 ms).
- **Cost model.** The guard adds about one round trip per paused request; parallel requests overlap. A server closer to the vendor's region will see less.
- **Cache.** Disabled on the page target.

| Load | No guard | Guard (request stage) | Guard + WS hardening |
|---|---|---|---|
| `example.com` (2 requests) | 181–312 ms (warm 181–186) | 486–649 ms | 828–832 ms |
| `iana.org/help/example-domains` (5) | 354–418 ms | 768–860 ms | 1,114–1,119 ms |
| MDN home (about 27) | 358–365 ms warm, 780 cold | 564–620 ms | 925–1,189 ms |
| `data:` page with a cross-site iframe and a worker | 388–507 ms | 694–708 ms | — |
| Fixture page (5 frames, 3 workers, 11 refusals) | — | 780–890 ms | — |

- **Guard install** (session, handlers, `Fetch.enable`): 288 ms, once per capture.
- **Added per page load:** about 0.2 to 0.45 s. The capture loads twice (`goto` plus `reload`), so about 0.5 to 0.9 s per capture.
- **With the hardening:** another 0.25 to 0.6 s per load. The document body crosses the CDP link twice.
  - Documents only (p7): example.com 828–832 ms, iana 1,114–1,119 ms, MDN 925–1,189 ms.
  - Documents plus JavaScript `Other` responses (p10): example.com 806–813 ms (504–522 ms without), iana 1,061–1,065 (775–795), MDN 999–1,026 (535–739).
  - These pages served no JavaScript as `Other`, so p10 re-served documents only. Pages with worker scripts pay one more body round trip per script.
- **Not included:** the repo's DNS check per new origin (`checkHost`).
- **Session stop** (`PATCH`): 578 to 823 ms.

## Fail-closed behaviour and lifecycle

Measured live:
- **Detach releases everything (p1).**
  - A request held paused by the guard completed (`LOADED`) once the guard session was detached.
  - A later `/deny/` fetch also went out (`LOADED`).
  - Chromium continues paused requests on detach. It does not fail them.
- **A dropped connection is fail-open until the session stops (p3).** The page fetched a `/deny/` URL every 500 ms.
  - The 3 fetches before the drop were refused.
  - Every fetch from +253 ms after `browser.close()` went out (`LOADED`), through the 4.8 s observed.
  - The vendor keeps the browser running after CDP closes; its docs say "Closing CDP does not stop a browser".
- **A slow verdict becomes a refusal.** A verdict that took 10 s was refused at 2.3 s with a 2 s decision timeout (p8, sketch code).
- **An unanswered paused request stays paused** (Chromium has no timeout). In p2 a bad answer left the main document paused until the 15 s navigation timeout. That is fail-closed, but it costs a hang, so every answer path needs the `failRequest` fallback in the sketch.
- **Cancelled requests.** Answering a request that navigation already cancelled throws `Invalid InterceptionId`: 2 of 82 answers on MDN (p4). This is harmless. The fallback `failRequest` then fails quietly.

Rules for the implementation:
1. **Install before navigating.** The capture must not navigate until `Fetch.enable` resolved, and a failure there is `connect-failed`.
2. **Guard loss is fatal.** `guard.on("close")` or `browser.on("disconnected")` means "guard lost". Reject the running stage, call `stop()` (the `PATCH` first) at once, and discard all captured data.
   - The unguarded window is the time to notice the loss plus the stop call. The stop took 578 to 823 ms across 10 sessions.
   - Detection was measured only for a deliberate `browser.close()`, where both events fire at once.
   - A **silent** network drop (no TCP close) was not tested. It may go unnoticed until the next command times out. Consider a heartbeat on the guard session, for example `Browser.getVersion` every 2 s with a 2 s timeout, treating a miss as guard loss (not tested).
   - Nothing in CDP survives a detach, so this window cannot be closed from our side. Only an egress proxy closes it.
3. **Never detach the guard while the page lives.** Teardown order: `PATCH stop`, then `browser.close()`.
4. **Time bounds.** Every verdict has a time bound (the existing `GUARD_DECISION_TIMEOUT_MS`), and a late verdict is a refusal.
5. **Don't mix interceptors.** Do not add Playwright `route()` or another `Fetch.enable` on page sessions. Two interceptors would chain, which was not tested.
6. **Same failure domain.** The guard rides on Playwright's connection. A connection loss therefore also ends Playwright, and the capture cannot keep going unguarded without noticing.

## Optional WebSocket hardening (verified, not required for the merge)

Probes 7 and 8, on the same browser-target session, through the `onResponse` hook of the sketch:

Service-worker scripts are refused by default (see Answer in short); the hardening relies on that.

1. Use `Fetch.enable` with three patterns:
   - `{urlPattern:"*", requestStage:"Request"}`;
   - `{urlPattern:"*", resourceType:"Document", requestStage:"Response"}`;
   - `{urlPattern:"*", resourceType:"Other", requestStage:"Response"}`. Worker scripts arrive as `Other`.
2. At the response stage:
   - 3xx answers and `responseErrorReason` → `Fetch.continueRequest`.
   - A `Document`, or an `Other` response whose `Content-Type` contains `javascript`, → `Fetch.getResponseBody` → `Fetch.fulfillRequest {responseCode, responseHeaders, body}`. The headers are the original ones minus `Content-Encoding` and `Content-Length`, plus `Content-Security-Policy: connect-src http: https: data: blob:`.
   - Anything else → `Fetch.continueRequest`.
3. Keep refusing `Service-Worker: script`. Otherwise a service worker could synthesise a document that never passes the response stage. In p3, a document made by a service worker for an iframe opened `wss:`; no response-stage event was logged for it.

Results:
- **Documents only (step 2 without `Other`):** `wss:` failed in:
  - the page, a blob dedicated worker and a blob shared worker;
  - `data:`, `about:blank` and `blob:` iframes;
  - a popup `about:blank` and a real cross-site iframe.

  Dedicated and shared workers loaded from a URL script still opened `wss:`, because they take their policy from their own script response (p8).
- **Documents plus JavaScript responses:** every context above failed, the URL-script workers included (p8).
- **Still allowed:** HTTPS `fetch` stayed `LOADED`, and service-worker registration was rejected (p7).
- **Ineffective variant:** the same header added with `Fetch.continueResponse` has no effect (p4).

Costs and caveats:
- **Latency:** see Timing.
- **Body size:** every document and script body crosses the CDP link twice. This needs a size cap: refuse above it.
- **Streaming documents:** a never-ending HTML response would block at the response stage until the decision timeout.
- **Main world:** the page's main world can see the injected policy through `securitypolicyviolation` events.
- **Not covered:** WebTransport, WebRTC and preconnect.
- **Not tested:** module workers, `importScripts`, and worklets (audio, paint).
- **Recommendation:** decide this together with the egress proxy question, not as part of the N1 fix.

## Faking it in unit tests

The earlier fake accepted a third `sessionId` argument that the real client ignores. A faithful fake of the guard session must:
- **Reject a third argument to `send`.** Throw if `send` receives more than two arguments, or if `params` contains `sessionId`.
- **Reject commands the browser target lacks.** Throw `'<method>' wasn't found` for `Network.*`, `Page.*`, `Runtime.*` and `Emulation.*`. Live: `Network.setBlockedURLs` was not found on it.
- **Emit everything on one session.** Every `Fetch.requestPaused` arrives on this one session, never with a child session id, for every source. Events carry:
  - `frameId`: the owner frame for worker requests, and the main-frame id for top documents;
  - `resourceType`, `request.headers` and `redirectedRequestId`.
- **Keep unanswered requests paused.** A request with no answer stays pending forever; the fake must not auto-continue.
- **Throw on stale ids.** Throw `Invalid InterceptionId` for an unknown `requestId` or a second answer.
- **Fail open on detach.** `detach()` and a connection drop must continue every pending request (the fake records them as "went out") and emit `close` (and `disconnected` on the browser). Tests then assert that the capture fails with the guard-lost code and that `stop` was called.
- **Mimic `continueResponse`** (if the hardening is built): reject headers without `responseCode` (inferred from the protocol text), and model that header-only CSP has no effect.

Tests to keep or add:
- **Document refusal.** A refused `Document` with `frameId === mainFrameId` reports `mainFrame: true`. With another `frameId`, or a non-`Document` type with the main frame's id, it reports `false`.
- **Fallback refusal.** A failed answer triggers `failRequest`.
- **Install order.** No `goto` before `Fetch.enable` resolves.

## Owner-hosted fixture for the opt-in live test

Synthetic `fulfillRequest` fixtures prove the mechanism but not the production path. The opt-in live test should load a page the owner hosts, for example `/__capture-fixture` on the Boo-tique deployment. Two registrable domains are needed, both owner-controlled, for example the custom domain and its `*.vercel.app` alias.

**Forbidden targets:**
- Use a public host on a non-default port, for example `https://example.org:8443/<tag>`. The real `checkUrl` refuses these.
- An unrefused `:8443` request fails too, so the page outcome cannot tell the cases apart. Assert on the guard's own `request-blocked` events instead: wrap `report` in the test and count distinct tags.
- A test-only policy hook that refuses `/deny/` paths would allow page-side assertions as in this spike.

**Content of the page:**
1. **Main frame:** an `<img>`, a `fetch` (no-cors), a `sendBeacon`, an `EventSource`, a `<link rel=prefetch>`, a CSS `@import` and an `@font-face`. Each points at a forbidden tag.
2. **Same-site iframe:** a sub-path, with a forbidden image in its initial HTML. Also a same-site iframe whose `src` itself is forbidden.
3. **Cross-site iframe:** on the second domain, with a forbidden image in its initial HTML and a script that starts a blob worker whose first statement fetches a forbidden tag. The frame must post `loaded` to the parent; that assert proves N1 is gone.
4. **Dedicated workers:** one from a URL (`/fixture-worker.js`) and one from a blob. Each fetches a forbidden tag as its first statement and posts `RAN`.
5. **Shared worker:** `/fixture-shared.js`, whose first statement fetches a forbidden tag.
6. **Service worker:** `/fixture-sw.js`, which fetches a forbidden tag at script start and in `install`.
   - With the default policy, assert that the registration is rejected (`service-worker-blocked`).
   - A variant with the policy off asserts that the worker's own fetches are refused.
7. **Popups:** a function the test calls through `evaluate` (it needs a user gesture). It opens one forbidden URL and one same-origin popup page with a forbidden subresource.
8. **Redirect:** an endpoint that 302s to a forbidden tag, or `httpbingo.org/redirect-to`. Assert `navigation-blocked` on `goto`.
9. **WebSocket:** one `wss:` to a public echo server. Record that it opens; assert `error` only if the hardening ships.
10. **Results:** everything reports into `window.__fixture`. The test reads it in the isolated world and asserts:
    - every forbidden tag was refused;
    - the cross-site frame and the workers ran;
    - `load` fired within the navigation budget.

## N4: listing active sessions

Verified live (counts only):
- **Status filter.** `?status=active` is ignored: it returned all 33 sessions, the same as no filter. `?filterBy=active` returned 1 while a session was active, and 0 at the end. `?filterBy=bogus` → 422.
- **Paging.** Without `pageSize` the page holds 10. `pageSize` maximum 100 (`101` → 422); `pageNumber` starts at 1 (`0` → 422).
  - `?pageSize=100&pageNumber=2` returned `items: []` with `totalItems: 33`.
  - Response keys: `items`, `totalItems`, `pageNumber`, `pageSize`. No `hasMore` field.
- **Metadata filter.** `metadata` filters on tags and repeats as AND.
  - `metadata=app%3Dtrick-or-trap` → 20 of 40.
  - `metadata=app` (key only) → 20.
  - `metadata=captureId%3Dno-such-capture` → 0.
  - `metadata=app%3Dtrick-or-trap&metadata=captureId%3Dspike-guard-p7` → 1.

A correct "my active sessions, all pages" call:

```
GET https://api.browser-use.com/api/v4/browsers?filterBy=active&metadata=app%3Dtrick-or-trap&pageSize=100&pageNumber={n}
X-Browser-Use-API-Key: <key>
```

- **Pagination.** Start at `n = 1`. Stop when `items` is empty or `n * pageSize >= totalItems`.
- **Sweep.** Collect the ids first and stop them afterwards, because stopping while paging shifts later pages of an `active` list.
- **Reclaim** for one capture: add `&metadata=captureId%3D<encoded captureId>` and use a single page.
- **Tests.** Pin the query string in the tests (the current tests pin `?status=active`).

## Open risks

- **Vendor dependence.**
  - The design rests on Chromium's browser-target `Fetch` and on the vendor allowing `Target.attachToBrowserTarget`. Both were verified on `Chrome/156.0.8078.79` only.
  - If either is refused later, step 6 rejects and the capture fails closed (`connect-failed`).
  - Keep the opt-in live test as the tripwire.
- **Fail-open window on connection loss.** Detection plus the stop call (578 to 823 ms). Detection of a silent drop was not measured. CDP cannot close the window; only an egress proxy can.
- **Vendor URL blocklist.** The vendor browser runs a URL blocklist policy of its own (`ftp:` got `ERR_BLOCKED_BY_ADMINISTRATOR`). Its contents are unknown; do not rely on it.
- **Not covered by `Fetch`:** WebSocket (unless hardened), WebTransport, WebRTC, preconnect and DNS prefetch (connections without a request), and DNS rebinding. Add these to the residual-risk list, together with the egress-proxy recommendation. Shared workers and popups can now be removed from that list.
- **Latency.** It scales with the server-to-vendor round trip, and grows with dependency depth rather than request count. Measured from the owner's machine (about 140 ms RTT), not from the production region.
- **Host limit (N7).** The browser-level session sees every target's requests, so the per-capture host limit (`MAX_REQUEST_HOSTS`) now also counts worker and popup hosts. That is correct, but pages may reach the limit sooner. Documents are still exempt (N7).
- **Untested by design:**
  - nested OOPIFs, downloads and requests after `unload` (`keepalive`);
  - two interceptors at once (do not add `route()`);
  - behaviour under Playwright tracing;
  - the vendor proxy on (`proxy: on`) with browser-level `Fetch`.
- **Popups without a gesture** were blocked by the vendor browser's popup blocker. That is configuration, not a guarantee; the guard covers popups either way.
