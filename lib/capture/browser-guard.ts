/**
 * The browser-level request guard. One CDP session on the browser target pauses every
 * request of every target (page, iframes, workers, popups) with `Fetch` at the request
 * stage. Each paused request is continued or failed before it is sent. A redirect hop is
 * a new paused request and gets its own verdict.
 *
 * With hardening on, the guard also pauses document and JavaScript responses and serves
 * them again with a policy that blocks WebSocket connections (`response-hardening.ts`).
 *
 * The module takes a structural `GuardBrowser` and a `RequestPolicy`. It loads no
 * browser-automation library, so unit tests drive it with a fake. Request URLs are
 * untrusted data: they are parsed and passed to the policy, never executed, and never put
 * in an event.
 *
 * Losing the guard (the session closes, the browser disconnects, or a heartbeat fails)
 * is reported once through `onLost`, and the caller must end the capture. After
 * `stopWatching()` nothing is reported. The guard never detaches its session.
 *
 * Coverage and residual risks. Checked on Chrome 156.0.8078.79 at Browser Use with
 * playwright-core 1.64.1 (docs/research/page-capture-guard-spike.md). "live" means a spike
 * probe saw it, "by reading" means it follows from the protocol documentation only, and
 * "untested" means neither.
 *
 * Covered, and refusable:
 * - Main-frame navigations and redirect hops; images, `fetch`/XHR, `sendBeacon`,
 *   EventSource, prefetch, CSS `@import` and `@font-face` of the main frame (live).
 * - IP-literal URLs, plain `http:` pages and their sub-requests (live).
 * - Same-site and cross-site iframes (out-of-process): document and sub-resources, and a
 *   blob worker inside the cross-site iframe; the frame loads with the guard on (live).
 * - Form posts into an iframe and a meta refresh in a `srcdoc` iframe (live).
 * - Dedicated workers (blob and URL scripts) and shared workers: script and first fetch
 *   (live).
 * - service-worker scripts (`Service-Worker: script`): refused, so the registration is
 *   rejected (live).
 * - A popup opened with a user gesture: its navigation and sub-resources (live).
 * - Downloads and nested out-of-process iframes (by reading).
 * - WebSocket connections, only while hardening is on, and only in the contexts the spike
 *   checked on Chrome 156: the page, blob and URL workers, shared workers, `data:`,
 *   `about:blank` and `blob:` iframes, the popup `about:blank` and the cross-site iframe
 *   (live). With hardening off a WebSocket is not seen (live).
 *
 * Not covered:
 * - WebTransport (the policy `connect-src https:` admits it), WebRTC, preconnect, and
 *   DNS prefetch: connections that carry no request (by reading).
 * - DNS rebinding: our resolver and the browser's resolver are independent (by reading).
 *
 * Unverified (untested): nested out-of-process iframes in practice, downloads, keepalive
 * requests after unload, module workers, `importScripts`, worklets, the guard with the
 * vendor proxy turned on, and behaviour under Playwright tracing. A worker script served
 * with a type that hardening does not match would escape the WebSocket policy (by
 * reading); Chrome normally refuses such worker scripts.
 *
 * Fail-open window. Chromium releases interception when the session ends, so a lost guard
 * fails open (the fail-open window): from the moment Chromium drops the session until the
 * stop call has ended
 * the browser, page requests go out unguarded. For a deliberate close that is the
 * detection time plus the stop call (578 to 823 ms in the spike). For a silent drop it is
 * up to about 7 s (heartbeat interval plus timeout) plus the stop call. CDP cannot close
 * this window. Only an egress proxy can: the recommended control, for this window and for
 * everything CDP cannot see, is egress filtering through the vendor's `customProxy`. It is
 * not built here.
 */
import { CaptureFailure, type GuardReasonCode } from "./types";
import { withTimeout, type Clock } from "./clock";
import {
  GUARD_DECISION_TIMEOUT_MS,
  GUARD_HEARTBEAT_INTERVAL_MS,
  GUARD_HEARTBEAT_TIMEOUT_MS,
  MAX_LOOKUP_HOSTS,
  MAX_REQUEST_HOSTS,
} from "./constants";
import type { GuardBrowser, GuardLossCause, GuardSession, GuardVerdict, RequestPolicy } from "./guard-types";
import { answerResponse, type HeaderEntry, type PausedResponse } from "./response-hardening";

export type BrowserGuardOptions = {
  clock: Clock;
  /** The frame id of the page's main frame. A document request of this frame is a main-frame request. */
  mainFrameId: string;
  /** Called at most once, when the guard is lost. Never called after `stopWatching()`. */
  onLost: (cause: GuardLossCause) => void;
  /**
   * WebSocket hardening. Present: document and JavaScript responses are paused at the
   * response stage and served again, up to `maxBodyBytes`. Absent: request stage only.
   */
  hardening?: { maxBodyBytes: number };
  /** Distinct hosts accepted for non-document requests. Default `MAX_REQUEST_HOSTS`. */
  maxHosts?: number;
  /** Distinct hosts accepted in all, document requests included. Default `MAX_LOOKUP_HOSTS`. */
  maxLookupHosts?: number;
  /** Longest wait for one verdict. Default `GUARD_DECISION_TIMEOUT_MS`. */
  decisionTimeoutMs?: number;
  /** Default: the two heartbeat constants. */
  heartbeat?: { intervalMs: number; timeoutMs: number };
};

export type BrowserGuard = {
  /** Stops loss reporting and the heartbeat. Never detaches the session. */
  stopWatching(): void;
};

const REQUEST_STAGE_PATTERN = { urlPattern: "*", requestStage: "Request" };
const RESPONSE_STAGE_PATTERNS = [
  { urlPattern: "*", resourceType: "Document", requestStage: "Response" },
  { urlPattern: "*", resourceType: "Other", requestStage: "Response" },
];
/** Schemes that carry no network request of their own. */
const PASS_THROUGH_SCHEMES: ReadonlySet<string> = new Set(["data:", "blob:", "about:"]);
const NETWORK_SCHEMES: ReadonlySet<string> = new Set(["http:", "https:"]);
const ALLOW: GuardVerdict = { allowed: true };

function refuse(reason: GuardReasonCode): GuardVerdict {
  return { allowed: false, reason };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** The header entries of a response-stage event. Entries that are not a name and a value are dropped. */
function toHeaderEntries(value: unknown): HeaderEntry[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const entries: HeaderEntry[] = [];
  for (const item of value) {
    const entry = asRecord(item);
    if (entry && typeof entry.name === "string" && typeof entry.value === "string") {
      entries.push({ name: entry.name, value: entry.value });
    }
  }
  return entries;
}

/** Builds the typed view of a response-stage event. Optional fields are set only when the event has them. */
function toPausedResponse(paused: Record<string, unknown>, requestId: string): PausedResponse {
  const result: PausedResponse = {
    requestId,
    resourceType: typeof paused.resourceType === "string" ? paused.resourceType : "",
  };
  const frameId = asString(paused.frameId);
  if (frameId !== undefined) result.frameId = frameId;
  if (typeof paused.responseStatusCode === "number" && Number.isInteger(paused.responseStatusCode)) {
    result.responseStatusCode = paused.responseStatusCode;
  }
  if (typeof paused.responseStatusText === "string") result.responseStatusText = paused.responseStatusText;
  if (paused.responseErrorReason !== undefined) result.responseErrorReason = String(paused.responseErrorReason);
  const headers = toHeaderEntries(paused.responseHeaders);
  if (headers !== undefined) result.responseHeaders = headers;
  return result;
}

/** Runs an action and ignores any failure, also a synchronous throw. */
async function quietly(action: () => unknown): Promise<void> {
  try {
    await action();
  } catch {
    // best effort: the request may be gone already
  }
}

/** True when a request header named `Service-Worker` (any case) has the value `script`. */
function isServiceWorkerScript(headers: unknown): boolean {
  const map = asRecord(headers);
  if (!map) return false;
  for (const [name, value] of Object.entries(map)) {
    if (name.toLowerCase() === "service-worker" && typeof value === "string" && value.trim().toLowerCase() === "script") {
      return true;
    }
  }
  return false;
}

/**
 * Opens the guard session, registers its handlers, enables request interception and
 * starts the heartbeat. Rejects when opening or enabling fails, and the caller must then
 * not navigate. Resolves only after `Fetch.enable` has resolved.
 */
export async function installBrowserGuard(
  browser: GuardBrowser,
  policy: RequestPolicy,
  options: BrowserGuardOptions,
): Promise<BrowserGuard> {
  const { clock, mainFrameId, onLost, hardening } = options;
  const maxHosts = options.maxHosts ?? MAX_REQUEST_HOSTS;
  const maxLookupHosts = options.maxLookupHosts ?? MAX_LOOKUP_HOSTS;
  const decisionTimeoutMs = options.decisionTimeoutMs ?? GUARD_DECISION_TIMEOUT_MS;
  const heartbeatIntervalMs = options.heartbeat?.intervalMs ?? GUARD_HEARTBEAT_INTERVAL_MS;
  const heartbeatTimeoutMs = options.heartbeat?.timeoutMs ?? GUARD_HEARTBEAT_TIMEOUT_MS;

  /** Hosts seen in this capture, shared by every target. */
  const seenHosts = new Set<string>();
  let hostLimitReported = false;
  let stopped = false;
  let lost = false;
  let cancelTick: (() => void) | undefined;
  let cancelBeatTimeout: (() => void) | undefined;
  let beatInFlight = false;

  function cancelTimers(): void {
    cancelTick?.();
    cancelBeatTimeout?.();
    cancelTick = undefined;
    cancelBeatTimeout = undefined;
  }

  function reportLost(cause: GuardLossCause): void {
    if (stopped || lost) return;
    lost = true;
    cancelTimers();
    try {
      onLost(cause);
    } catch {
      // The caller's handler must not break the guard.
    }
  }

  /** The verdict for one URL. Everything up to the host check runs synchronously. */
  async function decide(url: string, isDocument: boolean): Promise<GuardVerdict> {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return refuse("url-invalid");
    }
    if (PASS_THROUGH_SCHEMES.has(parsed.protocol)) return ALLOW;
    if (!NETWORK_SCHEMES.has(parsed.protocol)) return refuse("url-scheme-blocked");

    const syntax = policy.checkSyntax(url);
    if (!syntax.allowed) return syntax;

    // Check and add happen with no await in between, so requests that are paused at
    // the same time cannot push the set past the limit. A new host of a non-document
    // request counts against `maxHosts`; a new host of any request counts against
    // `maxLookupHosts`, which bounds the DNS work of the capture. A refused host is not added.
    const host = parsed.hostname.toLowerCase();
    if (!seenHosts.has(host)) {
      const limit = isDocument ? maxLookupHosts : maxHosts;
      if (seenHosts.size >= limit) {
        if (!hostLimitReported) {
          hostLimitReported = true;
          await quietly(() => policy.report({ kind: "request-host-limit" }));
        }
        return refuse("host-limit-reached");
      }
      seenHosts.add(host);
    }
    return policy.checkHost(url);
  }

  function failRequest(session: GuardSession, requestId: string): Promise<unknown> {
    return Promise.resolve(session.send("Fetch.failRequest", { requestId, errorReason: "BlockedByClient" }));
  }

  /** Continues a paused request. When that fails, the request is failed: it must not stay paused or go out unchecked. */
  async function continueOrFail(session: GuardSession, requestId: string): Promise<void> {
    try {
      await session.send("Fetch.continueRequest", { requestId });
    } catch {
      await quietly(() => failRequest(session, requestId));
    }
  }

  /** Reports a refusal, then fails the request, with one more try when the first failure rejects. */
  async function refuseRequest(
    session: GuardSession,
    requestId: string,
    reason: GuardReasonCode,
    mainFrame: boolean,
  ): Promise<void> {
    await quietly(() => policy.report({ kind: "request-blocked", reason, mainFrame }));
    try {
      await failRequest(session, requestId);
    } catch {
      await quietly(() => failRequest(session, requestId));
    }
  }

  /** The response-stage answer of one paused event. */
  async function onResponsePaused(
    session: GuardSession,
    paused: Record<string, unknown>,
    requestId: string,
    mainFrame: boolean,
  ): Promise<void> {
    if (!hardening) {
      // Response patterns were not enabled, so this should not happen. The request passed
      // its request-stage check already; the response is let through.
      await continueOrFail(session, requestId);
      return;
    }
    let verdict: GuardVerdict;
    try {
      verdict = await withTimeout(
        clock,
        decisionTimeoutMs,
        answerResponse(session, toPausedResponse(paused, requestId), hardening),
        "capture-timeout",
      );
    } catch (error) {
      if (!(error instanceof CaptureFailure)) {
        // The plain continue was rejected (the request is gone, or the answer was invalid).
        await quietly(() => failRequest(session, requestId));
        return;
      }
      // Not ready in time: the response is refused, never passed on unrewritten.
      verdict = refuse("response-rewrite-failed");
    }
    if (verdict.allowed) return;
    await refuseRequest(session, requestId, verdict.reason, mainFrame);
  }

  async function onRequestPaused(session: GuardSession, params: unknown): Promise<void> {
    const paused = asRecord(params);
    const requestId = asString(paused?.requestId);
    if (!paused || !requestId) return;

    const isDocument = paused.resourceType === "Document";
    const mainFrame = isDocument && paused.frameId === mainFrameId;

    if (paused.responseStatusCode !== undefined || paused.responseErrorReason !== undefined) {
      await onResponsePaused(session, paused, requestId, mainFrame);
      return;
    }

    const request = asRecord(paused.request);
    const url = asString(request?.url);

    let verdict: GuardVerdict;
    if (isServiceWorkerScript(request?.headers)) {
      verdict = refuse("service-worker-blocked");
    } else if (url === undefined) {
      verdict = refuse("url-invalid");
    } else {
      try {
        verdict = await withTimeout(clock, decisionTimeoutMs, decide(url, isDocument), "capture-timeout");
      } catch {
        // A verdict that throws or takes too long is a refusal.
        verdict = refuse("url-invalid");
      }
    }

    if (verdict.allowed) {
      await continueOrFail(session, requestId);
      return;
    }
    await refuseRequest(session, requestId, verdict.reason, mainFrame);
  }

  function startHeartbeat(session: GuardSession): void {
    const tick = (): void => {
      if (stopped || lost) return;
      cancelTick = clock.setTimer(heartbeatIntervalMs, tick);
      if (beatInFlight) return;
      beatInFlight = true;
      let settled = false;
      cancelBeatTimeout = clock.setTimer(heartbeatTimeoutMs, () => {
        if (settled) return;
        settled = true;
        beatInFlight = false;
        reportLost("heartbeat");
      });
      let answer: Promise<unknown>;
      try {
        answer = Promise.resolve(session.send("Browser.getVersion"));
      } catch (error) {
        answer = Promise.reject(error);
      }
      answer.then(
        () => {
          if (settled) return;
          settled = true;
          beatInFlight = false;
          cancelBeatTimeout?.();
          cancelBeatTimeout = undefined;
        },
        () => {
          if (settled) return;
          settled = true;
          beatInFlight = false;
          reportLost("heartbeat");
        },
      );
    };
    if (stopped || lost) return;
    cancelTick = clock.setTimer(heartbeatIntervalMs, tick);
  }

  const session = await browser.openGuardSession();

  // Registered before the first command, so no event or loss is missed during setup.
  session.onEvent(async (event) => {
    try {
      if (event.method === "Fetch.requestPaused") await onRequestPaused(session, event.params);
    } catch {
      // The decision code never throws out of the handler.
    }
  });
  session.onClose(() => reportLost("session-closed"));
  browser.onDisconnected(() => reportLost("disconnected"));

  const patterns = hardening ? [REQUEST_STAGE_PATTERN, ...RESPONSE_STAGE_PATTERNS] : [REQUEST_STAGE_PATTERN];
  await session.send("Fetch.enable", { patterns });
  startHeartbeat(session);

  return {
    stopWatching() {
      stopped = true;
      cancelTimers();
    },
  };
}
