/**
 * Browser Use Cloud HTTP client: creates and stops remote browser sessions.
 *
 * The API key travels only in the request header. Nothing here logs, and error text
 * is redacted before it reaches a `detail` or a message.
 */
import "server-only";
import type { Clock } from "./clock";
import { API_FETCH_TIMEOUT_MS } from "./constants";
import { toDetail } from "./redact";
import type { SessionRequest } from "./seam";
import { CaptureFailure } from "./types";

const API_BASE_URL = "https://api.browser-use.com/api/v4/browsers";
const API_KEY_HEADER = "X-Browser-Use-API-Key";

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
 * request is absorbed.
 */
function callApi(
  deps: BrowserUseApiDeps,
  url: string,
  method: "POST" | "PATCH",
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
      const response = await deps.fetch(url, {
        method,
        headers: { [API_KEY_HEADER]: deps.apiKey, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
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

/**
 * Creates a billed remote browser session. Throws `CaptureFailure`
 * (`session-create-failed` or `session-create-timeout`). When it throws there is
 * nothing to stop.
 */
export async function createSession(deps: BrowserUseApiDeps, request: SessionRequest): Promise<CreatedSession> {
  const secrets = [deps.apiKey];
  const payload = {
    timeout: request.timeoutMinutes,
    browserScreenWidth: request.viewport.width,
    browserScreenHeight: request.viewport.height,
    ...proxyBodyFields(request.proxy),
  };

  let response: ApiResponse;
  try {
    response = await callApi(deps, API_BASE_URL, "POST", payload, true);
  } catch (error) {
    if (error instanceof ApiTimeoutError) throw new CaptureFailure("session-create-timeout");
    throw new CaptureFailure("session-create-failed", toDetail(error, secrets));
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
    throw new CaptureFailure("session-create-failed", "The response has no session id or CDP address.");
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
