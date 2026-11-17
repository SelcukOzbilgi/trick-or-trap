/**
 * Browser Use Cloud HTTP client: creates, stops, reclaims and sweeps remote browser
 * sessions.
 *
 * The API key travels only in the request header. Nothing here logs, and error text
 * is redacted before it reaches a `detail` or a message.
 */
import "server-only";
import type { Clock } from "./clock";
import { API_FETCH_TIMEOUT_MS, STALE_SESSION_AGE_MS } from "./constants";
import { toDetail } from "./redact";
import type { SessionRequest } from "./seam";
import { CaptureFailure } from "./types";

const API_BASE_URL = "https://api.browser-use.com/api/v4/browsers";
const LIST_ACTIVE_URL = `${API_BASE_URL}?status=active`;
const API_KEY_HEADER = "X-Browser-Use-API-Key";
/** The value of `metadata.app` on every session this app creates. */
const APP_TAG = "trick-or-trap";
/** Keys under which a list answer may hold its array of sessions. */
const LIST_KEYS = ["items", "browsers", "results"] as const;

export type BrowserUseApiDeps = {
  fetch: typeof fetch;
  clock: Clock;
  apiKey: string;
};

/** The session fields the capture needs. Secret: never serialise or log them. */
export type CreatedSession = {
  id: string;
  cdpUrl: string;
  liveUrl: string | null;
};

/**
 * The single place that turns the proxy setting into create-body fields.
 * The residential proxy is on by default at the vendor, so `off` sends
 * `proxyCountryCode: null` and `on` sends nothing.
 */
export function proxyBodyFields(proxy: "on" | "off"): { proxyCountryCode?: null } {
  return proxy === "off" ? { proxyCountryCode: null } : {};
}

type ApiResponse = { status: number; ok: boolean; body: unknown };

class ApiTimeoutError extends Error {
  constructor() {
    super("The Browser Use API call timed out.");
    this.name = "ApiTimeoutError";
  }
}

/**
 * One API call with a hard deadline. On expiry the request is aborted and the call
 * rejects at once, without waiting for `fetch` to settle. A late settlement of the
 * request is absorbed. It resolves for every HTTP answer, whatever its status, and
 * rejects only for a timeout or a failure with no HTTP answer. `payload` is sent as
 * the JSON body unless it is `undefined`.
 */
function callApi(
  deps: BrowserUseApiDeps,
  url: string,
  method: "GET" | "POST" | "PATCH",
  payload: unknown,
  readBody: boolean,
): Promise<ApiResponse> {
  return new Promise<ApiResponse>((resolve, reject) => {
    const controller = new AbortController();
    let done = false;
    const cancel = deps.clock.setTimer(API_FETCH_TIMEOUT_MS, () => {
      if (done) return;
      done = true;
      controller.abort();
      reject(new ApiTimeoutError());
    });

    const work = async (): Promise<ApiResponse> => {
      const headers: Record<string, string> = { [API_KEY_HEADER]: deps.apiKey };
      const init: RequestInit = { method, headers, signal: controller.signal };
      if (payload !== undefined) {
        headers["Content-Type"] = "application/json";
        init.body = JSON.stringify(payload);
      }
      const response = await deps.fetch(url, init);
      let body: unknown;
      if (readBody && response.ok) {
        try {
          body = await response.json();
        } catch {
          body = undefined;
        }
      }
      return { status: response.status, ok: response.ok, body };
    };

    work().then(
      (value) => {
        if (done) return;
        done = true;
        cancel();
        resolve(value);
      },
      (error: unknown) => {
        if (done) return;
        done = true;
        cancel();
        reject(error);
      },
    );
  });
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function ignore(): void {}

/**
 * Creates a billed remote browser session. Throws `CaptureFailure`
 * (`session-create-failed` or `session-create-timeout`). When it throws there is
 * nothing left to stop, with one exception: a call that was aborted or failed with no
 * HTTP answer may have created a session. That failure has `reclaim: true`, and the
 * caller may then ask the provider for one clean-up.
 *
 * An answer that holds an `id` but no usable `cdpUrl` is a session that exists and
 * cannot be used. It is stopped here, once, and a failing stop is ignored.
 */
export async function createSession(deps: BrowserUseApiDeps, request: SessionRequest): Promise<CreatedSession> {
  const secrets = [deps.apiKey];
  const payload = {
    timeout: request.timeoutMinutes,
    browserScreenWidth: request.viewport.width,
    browserScreenHeight: request.viewport.height,
    ...proxyBodyFields(request.proxy),
    metadata: { app: APP_TAG, captureId: request.captureId },
  };

  let response: ApiResponse;
  try {
    response = await callApi(deps, API_BASE_URL, "POST", payload, true);
  } catch (error) {
    if (error instanceof ApiTimeoutError) {
      throw new CaptureFailure("session-create-timeout", undefined, { reclaim: true });
    }
    throw new CaptureFailure("session-create-failed", toDetail(error, secrets), { reclaim: true });
  }

  if (!response.ok) {
    throw new CaptureFailure("session-create-failed", `HTTP ${response.status}`);
  }
  const body = response.body;
  if (typeof body !== "object" || body === null) {
    throw new CaptureFailure("session-create-failed", "Unexpected response body.");
  }
  const { id, cdpUrl, liveUrl } = body as Record<string, unknown>;
  if (!isNonEmptyString(id) || !isNonEmptyString(cdpUrl)) {
    // Whatever was seen in the answer is redacted from the error, and a session that
    // has an id is stopped so that it does not run for its whole timeout.
    const seen = [id, cdpUrl, liveUrl].filter(isNonEmptyString);
    if (isNonEmptyString(id)) await stopSession(deps, id).catch(ignore);
    throw new CaptureFailure(
      "session-create-failed",
      toDetail("The response has no session id or CDP address.", [...secrets, ...seen]),
    );
  }
  return { id, cdpUrl, liveUrl: isNonEmptyString(liveUrl) ? liveUrl : null };
}

/**
 * Stops a session. Rejects with a plain `Error` (fixed text, redacted) when the call
 * fails, returns a non-2xx status or exceeds its 10 s deadline. The caller decides
 * what a failed stop means.
 */
export async function stopSession(deps: BrowserUseApiDeps, id: string): Promise<void> {
  const secrets = [deps.apiKey, id];
  let response: ApiResponse;
  try {
    response = await callApi(deps, `${API_BASE_URL}/${encodeURIComponent(id)}`, "PATCH", { action: "stop" }, false);
  } catch (error) {
    if (error instanceof ApiTimeoutError) throw new Error("Stopping the session timed out.");
    const detail = toDetail(error, secrets);
    throw new Error(detail ? `Stopping the session failed: ${detail}` : "Stopping the session failed.");
  }
  if (!response.ok) {
    throw new Error(`Stopping the session failed: HTTP ${response.status}`);
  }
}

/** One entry of the list of active sessions, as far as it is trusted. */
type ListedSession = { id: string; metadata: Record<string, unknown>; raw: Record<string, unknown> };

/**
 * Reads the list answer defensively. The list is an array, or an object with an array
 * under `items`, `browsers` or `results`. An entry needs a string `id` and an object
 * `metadata`; any other entry is left out. Anything else gives an empty list.
 */
function parseSessionList(body: unknown): ListedSession[] {
  let list: unknown;
  if (Array.isArray(body)) {
    list = body;
  } else if (isRecord(body)) {
    for (const key of LIST_KEYS) {
      if (Array.isArray(body[key])) {
        list = body[key];
        break;
      }
    }
  }
  if (!Array.isArray(list)) return [];
  const sessions: ListedSession[] = [];
  for (const entry of list as unknown[]) {
    if (!isRecord(entry)) continue;
    const { id, metadata } = entry;
    if (!isNonEmptyString(id) || !isRecord(metadata)) continue;
    sessions.push({ id, metadata, raw: entry });
  }
  return sessions;
}

/** Lists the active sessions. Never rejects; any failure gives an empty list. */
async function listActiveSessions(deps: BrowserUseApiDeps): Promise<ListedSession[]> {
  try {
    const response = await callApi(deps, LIST_ACTIVE_URL, "GET", undefined, true);
    return response.ok ? parseSessionList(response.body) : [];
  } catch {
    return [];
  }
}

/** Stops each session and counts the outcomes. Never rejects. */
async function stopEach(deps: BrowserUseApiDeps, ids: readonly string[]): Promise<{ stopped: number; failed: number }> {
  const outcomes = await Promise.all(
    ids.map((id) =>
      stopSession(deps, id).then(
        () => true,
        () => false,
      ),
    ),
  );
  const stopped = outcomes.filter(Boolean).length;
  return { stopped, failed: outcomes.length - stopped };
}

/**
 * One clean-up after a create call that was aborted or failed with no HTTP answer: it
 * lists the active sessions and stops those whose `metadata.captureId` equals
 * `captureId`. It never rejects and never throws. A list that cannot be read, a failed
 * list call and a failed stop all leave things as they are.
 */
export async function reclaimSession(deps: BrowserUseApiDeps, captureId: string): Promise<void> {
  try {
    if (!isNonEmptyString(captureId)) return;
    const sessions = await listActiveSessions(deps);
    const mine = sessions.filter((session) => session.metadata.captureId === captureId);
    await stopEach(
      deps,
      mine.map((session) => session.id),
    );
  } catch {
    // best effort
  }
}

export type SweepResult = { listed: number; stopped: number; failed: number };

/** Age of a listed session in ms by `startedAt`, else `createdAt`; `undefined` when unknown. */
function ageOf(session: ListedSession, now: number): number | undefined {
  for (const key of ["startedAt", "createdAt"] as const) {
    const value = session.raw[key];
    if (typeof value !== "string") continue;
    const time = Date.parse(value);
    if (Number.isFinite(time)) return now - time;
  }
  return undefined;
}

/**
 * Stops every active session tagged `metadata.app === "trick-or-trap"` that is older
 * than `STALE_SESSION_AGE_MS`. A session with another or no tag, or with no usable
 * age, is left alone. Returns counts only, never an id. `listed` counts the entries of
 * the list that could be read. It never rejects: a list that cannot be read gives zero
 * counts.
 */
export async function sweepStaleSessions(deps: BrowserUseApiDeps & { now: () => number }): Promise<SweepResult> {
  try {
    const sessions = await listActiveSessions(deps);
    const now = deps.now();
    const stale = sessions.filter((session) => {
      if (session.metadata.app !== APP_TAG) return false;
      const age = ageOf(session, now);
      return age !== undefined && age > STALE_SESSION_AGE_MS;
    });
    const { stopped, failed } = await stopEach(
      deps,
      stale.map((session) => session.id),
    );
    return { listed: sessions.length, stopped, failed };
  } catch {
    return { listed: 0, stopped: 0, failed: 0 };
  }
}
