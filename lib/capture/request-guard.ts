/**
 * The request guard. Every request the browser makes is paused with CDP `Fetch` at the
 * request stage and is continued or failed before it is sent. This covers main-frame
 * navigations, each redirect hop (a hop is a new paused request), sub-frame navigations
 * and sub-resources. Child targets (cross-process iframes, workers) are attached
 * paused, get the same `Fetch` setup, and are resumed afterwards. Service workers are
 * bypassed, so their requests are paused as page requests.
 *
 * The module takes a structural `CdpSession` and a `RequestPolicy`. It loads no
 * browser-automation library, so unit tests drive it with a fake session. Request
 * URLs are untrusted data: they are parsed and passed to the policy, never executed,
 * and never put in an event.
 *
 * Whether the real browser session can address child sessions through the session
 * given here is unverified until the live test (see the design of page-capture-fixes).
 */
import type { CdpSession } from "./cdp";
import { withTimeout, type Clock } from "./clock";
import { GUARD_DECISION_TIMEOUT_MS, MAX_REQUEST_HOSTS } from "./constants";
import type { GuardVerdict, RequestPolicy } from "./guard-types";
import type { UrlErrorCode } from "./types";

export type RequestGuardOptions = {
  clock: Clock;
  /** Distinct hosts accepted for non-document requests. Default `MAX_REQUEST_HOSTS`. */
  maxHosts?: number;
  /** Longest wait for one verdict. Default `GUARD_DECISION_TIMEOUT_MS`. */
  decisionTimeoutMs?: number;
};

const FETCH_ENABLE = { patterns: [{ urlPattern: "*", requestStage: "Request" }] };
const AUTO_ATTACH = { autoAttach: true, waitForDebuggerOnStart: true, flatten: true };
/** Schemes that carry no network request of their own. */
const PASS_THROUGH_SCHEMES: ReadonlySet<string> = new Set(["data:", "blob:", "about:"]);
const NETWORK_SCHEMES: ReadonlySet<string> = new Set(["http:", "https:"]);
const ALLOW: GuardVerdict = { allowed: true };

function refuse(reason: UrlErrorCode): GuardVerdict {
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
    // best effort: the request or target may be gone already
  }
}

/**
 * Sets up request interception on the page session. Rejects when any setup step
 * fails, and the caller must then not navigate.
 */
export async function installRequestGuard(
  session: CdpSession,
  policy: RequestPolicy,
  options: RequestGuardOptions,
): Promise<void> {
  const { clock } = options;
  const maxHosts = options.maxHosts ?? MAX_REQUEST_HOSTS;
  const decisionTimeoutMs = options.decisionTimeoutMs ?? GUARD_DECISION_TIMEOUT_MS;
  /** Hosts seen in this capture, shared by the page and every child target. */
  const seenHosts = new Set<string>();
  let hostLimitReported = false;
  let mainFrameId: string | undefined;

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

  async function onRequestPaused(params: unknown, targetSessionId: string | undefined): Promise<void> {
    const paused = asRecord(params);
    const requestId = asString(paused?.requestId);
    if (!paused || !requestId) return;

    const url = asString(asRecord(paused.request)?.url);
    const isDocument = paused.resourceType === "Document";
    const mainFrame =
      isDocument && targetSessionId === undefined && mainFrameId !== undefined && paused.frameId === mainFrameId;

    let verdict: GuardVerdict;
    if (url === undefined) {
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
      await quietly(() => session.send("Fetch.continueRequest", { requestId }, targetSessionId));
      return;
    }
    const { reason } = verdict;
    await quietly(() => policy.report({ kind: "request-blocked", reason, mainFrame }));
    await quietly(() =>
      session.send("Fetch.failRequest", { requestId, errorReason: "BlockedByClient" }, targetSessionId),
    );
  }

  async function onAttachedToTarget(params: unknown, parentSessionId: string | undefined): Promise<void> {
    const attached = asRecord(params);
    const childSessionId = asString(attached?.sessionId);
    if (!attached || !childSessionId) return;
    const targetId = asString(asRecord(attached.targetInfo)?.targetId);
    const bounded = (op: Promise<unknown>) => withTimeout(clock, decisionTimeoutMs, op, "capture-timeout");

    let guarded = true;
    try {
      await bounded(session.send("Fetch.enable", FETCH_ENABLE, childSessionId));
    } catch {
      guarded = false;
    }
    if (guarded) {
      // A failure here leaves nested targets of this child unattached. The design
      // only closes a child whose own `Fetch.enable` failed.
      await quietly(() => bounded(session.send("Target.setAutoAttach", AUTO_ATTACH, childSessionId)));
    }
    // The child must never stay paused, whatever happened above.
    await quietly(() => bounded(session.send("Runtime.runIfWaitingForDebugger", {}, childSessionId)));

    if (!guarded) {
      if (targetId !== undefined) {
        await quietly(() => session.send("Target.closeTarget", { targetId }, parentSessionId));
      }
      await quietly(() => policy.report({ kind: "request-blocked", reason: "url-invalid", mainFrame: false }));
    }
  }

  // Registered first, so no event is missed while the setup commands run.
  session.onEvent(async (event) => {
    try {
      if (event.method === "Fetch.requestPaused") {
        await onRequestPaused(event.params, event.targetSessionId);
      } else if (event.method === "Target.attachedToTarget") {
        await onAttachedToTarget(event.params, event.targetSessionId);
      }
    } catch {
      // The decision code never throws out of the handler.
    }
  });

  await session.send("Network.setBypassServiceWorker", { bypass: true });
  const tree = await session.send("Page.getFrameTree");
  mainFrameId = asString(asRecord(asRecord(asRecord(tree)?.frameTree)?.frame)?.id);
  if (mainFrameId === undefined) throw new Error("The page reported no main frame id.");
  await session.send("Fetch.enable", FETCH_ENABLE);
  await session.send("Target.setAutoAttach", AUTO_ATTACH);
}
