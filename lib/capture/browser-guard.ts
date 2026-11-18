/**
 * The browser-level request guard. One CDP session on the browser target pauses every
 * request of every target (page, iframes, workers, popups) with `Fetch` at the request
 * stage. Each paused request is continued or failed before it is sent. A redirect hop is
 * a new paused request and gets its own verdict.
 *
 * The module takes a structural `GuardBrowser` and a `RequestPolicy`. It loads no
 * browser-automation library, so unit tests drive it with a fake. Request URLs are
 * untrusted data: they are parsed and passed to the policy, never executed, and never put
 * in an event.
 *
 * Losing the guard (the session closes, the browser disconnects, or a heartbeat fails)
 * is reported once through `onLost`, and the caller must end the capture. After
 * `stopWatching()` nothing is reported. The guard never detaches its session.
 */
import { withTimeout, type Clock } from "./clock";
import {
  GUARD_DECISION_TIMEOUT_MS,
  GUARD_HEARTBEAT_INTERVAL_MS,
  GUARD_HEARTBEAT_TIMEOUT_MS,
  MAX_REQUEST_HOSTS,
} from "./constants";
import type { GuardBrowser, GuardLossCause, GuardSession, GuardVerdict, RequestPolicy } from "./guard-types";
import type { GuardReasonCode } from "./types";

export type BrowserGuardOptions = {
  clock: Clock;
  /** The frame id of the page's main frame. A document request of this frame is a main-frame request. */
  mainFrameId: string;
  /** Called at most once, when the guard is lost. Never called after `stopWatching()`. */
  onLost: (cause: GuardLossCause) => void;
  /** Distinct hosts accepted for non-document requests. Default `MAX_REQUEST_HOSTS`. */
  maxHosts?: number;
  /** Longest wait for one verdict. Default `GUARD_DECISION_TIMEOUT_MS`. */
  decisionTimeoutMs?: number;
  /** Default: the two heartbeat constants. */
  heartbeat?: { intervalMs: number; timeoutMs: number };
};

export type BrowserGuard = {
  /** Stops loss reporting and the heartbeat. Never detaches the session. */
  stopWatching(): void;
};

const FETCH_ENABLE = { patterns: [{ urlPattern: "*", requestStage: "Request" }] };
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
  const { clock, mainFrameId, onLost } = options;
  const maxHosts = options.maxHosts ?? MAX_REQUEST_HOSTS;
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
    // the same time cannot push the set past the limit.
    const host = parsed.hostname.toLowerCase();
    if (!isDocument && !seenHosts.has(host) && seenHosts.size >= maxHosts) {
      if (!hostLimitReported) {
        hostLimitReported = true;
        await quietly(() => policy.report({ kind: "request-host-limit" }));
      }
      return refuse("url-host-blocked");
    }
    seenHosts.add(host);
    return policy.checkHost(url);
  }

  function failRequest(session: GuardSession, requestId: string): Promise<unknown> {
    return Promise.resolve(session.send("Fetch.failRequest", { requestId, errorReason: "BlockedByClient" }));
  }

  async function onRequestPaused(session: GuardSession, params: unknown): Promise<void> {
    const paused = asRecord(params);
    const requestId = asString(paused?.requestId);
    if (!paused || !requestId) return;

    const request = asRecord(paused.request);
    const url = asString(request?.url);
    const isDocument = paused.resourceType === "Document";
    const mainFrame = isDocument && paused.frameId === mainFrameId;

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
      try {
        await session.send("Fetch.continueRequest", { requestId });
      } catch {
        // The answer failed: the request must not stay paused or go out unchecked.
        await quietly(() => failRequest(session, requestId));
      }
      return;
    }
    const { reason } = verdict;
    await quietly(() => policy.report({ kind: "request-blocked", reason, mainFrame }));
    try {
      await failRequest(session, requestId);
    } catch {
      await quietly(() => failRequest(session, requestId));
    }
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

  await session.send("Fetch.enable", FETCH_ENABLE);
  startHeartbeat(session);

  return {
    stopWatching() {
      stopped = true;
      cancelTimers();
    },
  };
}
