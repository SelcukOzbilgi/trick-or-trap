import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createSession, proxyBodyFields, stopSession } from "@/lib/capture/browser-use-api";
import { API_FETCH_TIMEOUT_MS } from "@/lib/capture/constants";
import { CaptureFailure } from "@/lib/capture/types";
import { createManualClock } from "./helpers/manual-clock";

const API_KEY = "sk-test-sentinel";
const SESSION_ID = "sess-sentinel-1234";
const CDP_URL = "wss://abc.cdp.browser-use.com/devtools/browser/sentinel";
const LIVE_URL = "https://live.browser-use.com/?wss=sentinel";

const REQUEST = {
  timeoutMinutes: 2,
  proxy: "off" as const,
  viewport: { width: 1280, height: 800 },
};

type FetchCall = { url: string; init: RequestInit };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function createFakeFetch(handler: (call: FetchCall) => Promise<Response>) {
  const calls: FetchCall[] = [];
  const fakeFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const call = { url: String(input), init: init ?? {} };
    calls.push(call);
    return handler(call);
  });
  return { fetch: fakeFetch as unknown as typeof fetch, calls };
}

/** A fetch that never answers and rejects only when its abort signal fires. */
function hangUntilAborted(call: FetchCall): Promise<Response> {
  return new Promise<Response>((_resolve, reject) => {
    const signal = call.init.signal;
    signal?.addEventListener("abort", () => reject(new DOMException("The operation was aborted.", "AbortError")));
  });
}

async function flush(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

async function failureOf(promise: Promise<unknown>): Promise<CaptureFailure> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(CaptureFailure);
    return error as CaptureFailure;
  }
  throw new Error("expected the promise to reject");
}

describe("proxyBodyFields", () => {
  it("turns the proxy off with proxyCountryCode null", () => {
    expect(proxyBodyFields("off")).toEqual({ proxyCountryCode: null });
  });

  it("adds nothing when the proxy is on", () => {
    expect(proxyBodyFields("on")).toEqual({});
    expect("proxyCountryCode" in proxyBodyFields("on")).toBe(false);
  });
});

describe("createSession", () => {
  it("sends POST with the API key header and the documented body (proxy off)", async () => {
    const clock = createManualClock();
    const { fetch, calls } = createFakeFetch(async () =>
      jsonResponse({ id: SESSION_ID, cdpUrl: CDP_URL, liveUrl: LIVE_URL, timeoutAt: "later" }),
    );

    await createSession({ fetch, clock, apiKey: API_KEY }, REQUEST);

    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call.url).toBe("https://api.browser-use.com/api/v4/browsers");
    expect(call.init.method).toBe("POST");
    const headers = call.init.headers as Record<string, string>;
    expect(headers["X-Browser-Use-API-Key"]).toBe(API_KEY);
    expect(JSON.parse(call.init.body as string)).toEqual({
      timeout: 2,
      browserScreenWidth: 1280,
      browserScreenHeight: 800,
      proxyCountryCode: null,
    });
  });

  it("omits proxyCountryCode when the proxy is on and passes the timeout in minutes", async () => {
    const clock = createManualClock();
    const { fetch, calls } = createFakeFetch(async () =>
      jsonResponse({ id: SESSION_ID, cdpUrl: CDP_URL, liveUrl: LIVE_URL }),
    );

    await createSession({ fetch, clock, apiKey: API_KEY }, { ...REQUEST, proxy: "on", timeoutMinutes: 4 });

    const body = JSON.parse(calls[0].init.body as string) as Record<string, unknown>;
    expect(body).toEqual({ timeout: 4, browserScreenWidth: 1280, browserScreenHeight: 800 });
    expect("proxyCountryCode" in body).toBe(false);
  });

  it("returns id, cdpUrl and liveUrl", async () => {
    const clock = createManualClock();
    const { fetch } = createFakeFetch(async () =>
      jsonResponse({ id: SESSION_ID, cdpUrl: CDP_URL, liveUrl: LIVE_URL, timeoutAt: "later" }),
    );

    const session = await createSession({ fetch, clock, apiKey: API_KEY }, REQUEST);

    expect(session).toEqual({ id: SESSION_ID, cdpUrl: CDP_URL, liveUrl: LIVE_URL });
  });

  it("fails with session-create-failed on a 401 and keeps the key out of message and detail", async () => {
    const clock = createManualClock();
    const { fetch } = createFakeFetch(async () => jsonResponse({ error: `bad key ${API_KEY}` }, 401));

    const failure = await failureOf(createSession({ fetch, clock, apiKey: API_KEY }, REQUEST));

    expect(failure.code).toBe("session-create-failed");
    expect(failure.message).not.toContain(API_KEY);
    expect(failure.detail ?? "").not.toContain(API_KEY);
    expect(failure.detail ?? "").toContain("401");
  });

  it.each([
    ["no id", { cdpUrl: CDP_URL }],
    ["no cdpUrl", { id: SESSION_ID }],
    ["empty id", { id: "", cdpUrl: CDP_URL }],
    ["non-string cdpUrl", { id: SESSION_ID, cdpUrl: 5 }],
    ["not an object", "oops"],
    ["null", null],
  ])("fails with session-create-failed for a body with %s", async (_label, body) => {
    const clock = createManualClock();
    const { fetch } = createFakeFetch(async () => jsonResponse(body));

    const failure = await failureOf(createSession({ fetch, clock, apiKey: API_KEY }, REQUEST));

    expect(failure.code).toBe("session-create-failed");
  });

  it("fails with session-create-failed for a body that is not JSON", async () => {
    const clock = createManualClock();
    const { fetch } = createFakeFetch(async () => new Response("<html>", { status: 200 }));

    const failure = await failureOf(createSession({ fetch, clock, apiKey: API_KEY }, REQUEST));

    expect(failure.code).toBe("session-create-failed");
  });

  it("redacts the key, a websocket address and a cdp host from the detail of a thrown fetch error", async () => {
    const clock = createManualClock();
    const { fetch } = createFakeFetch(async () => {
      throw new Error(`connect failed for ${API_KEY} via wss://abc.cdp.browser-use.com/x and def.cdp.browser-use.com`);
    });

    const failure = await failureOf(createSession({ fetch, clock, apiKey: API_KEY }, REQUEST));

    expect(failure.code).toBe("session-create-failed");
    expect(failure.message).toBe("The remote browser session could not be created.");
    expect(failure.detail).toBeDefined();
    expect(failure.detail).not.toContain(API_KEY);
    expect(failure.detail).not.toContain("wss://");
    expect(failure.detail).not.toContain("cdp.browser-use.com");
    expect(failure.detail!.length).toBeLessThanOrEqual(200);
  });

  it("fails with session-create-timeout after 10 s when the abort signal fires", async () => {
    const clock = createManualClock();
    const { fetch, calls } = createFakeFetch(hangUntilAborted);

    const failureP = failureOf(createSession({ fetch, clock, apiKey: API_KEY }, REQUEST));
    await flush();
    expect(calls[0].init.signal?.aborted).toBe(false);

    clock.advance(API_FETCH_TIMEOUT_MS - 1);
    await flush();
    expect(calls[0].init.signal?.aborted).toBe(false);

    clock.advance(1);
    const failure = await failureP;

    expect(failure.code).toBe("session-create-timeout");
    expect(calls[0].init.signal?.aborted).toBe(true);
  });

  it("times out even when fetch ignores the abort signal", async () => {
    const clock = createManualClock();
    const { fetch } = createFakeFetch(() => new Promise<Response>(() => {}));

    const failureP = failureOf(createSession({ fetch, clock, apiKey: API_KEY }, REQUEST));
    await flush();
    clock.advance(API_FETCH_TIMEOUT_MS);

    expect((await failureP).code).toBe("session-create-timeout");
  });

  it("cancels the timer when the call finishes", async () => {
    const clock = createManualClock();
    const { fetch } = createFakeFetch(async () => jsonResponse({ id: SESSION_ID, cdpUrl: CDP_URL, liveUrl: LIVE_URL }));

    await createSession({ fetch, clock, apiKey: API_KEY }, REQUEST);

    expect(clock.pendingTimers).toBe(0);
  });
});

describe("stopSession", () => {
  it("sends PATCH with the stop action", async () => {
    const clock = createManualClock();
    const { fetch, calls } = createFakeFetch(async () => jsonResponse({ id: SESSION_ID, status: "stopped" }));

    await stopSession({ fetch, clock, apiKey: API_KEY }, SESSION_ID);

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`https://api.browser-use.com/api/v4/browsers/${SESSION_ID}`);
    expect(calls[0].init.method).toBe("PATCH");
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers["X-Browser-Use-API-Key"]).toBe(API_KEY);
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ action: "stop" });
    expect(clock.pendingTimers).toBe(0);
  });

  it("encodes the session id in the path", async () => {
    const clock = createManualClock();
    const { fetch, calls } = createFakeFetch(async () => jsonResponse({}));

    await stopSession({ fetch, clock, apiKey: API_KEY }, "a/b c");

    expect(calls[0].url).toBe("https://api.browser-use.com/api/v4/browsers/a%2Fb%20c");
  });

  it("rejects on a non-2xx status without leaking secrets", async () => {
    const clock = createManualClock();
    const { fetch } = createFakeFetch(async () => jsonResponse({ error: `nope ${API_KEY} ${SESSION_ID}` }, 500));

    const error = await stopSession({ fetch, clock, apiKey: API_KEY }, SESSION_ID).then(
      () => null,
      (e: unknown) => e as Error,
    );

    expect(error).toBeInstanceOf(Error);
    expect(error!.message).toContain("500");
    expect(error!.message).not.toContain(API_KEY);
    expect(error!.message).not.toContain(SESSION_ID);
  });

  it("rejects when fetch throws, with the secrets redacted", async () => {
    const clock = createManualClock();
    const { fetch } = createFakeFetch(async () => {
      throw new Error(`network down ${API_KEY} ${SESSION_ID}`);
    });

    const error = await stopSession({ fetch, clock, apiKey: API_KEY }, SESSION_ID).then(
      () => null,
      (e: unknown) => e as Error,
    );

    expect(error).toBeInstanceOf(Error);
    expect(error!.message).not.toContain(API_KEY);
    expect(error!.message).not.toContain(SESSION_ID);
  });

  it("aborts after 10 s and rejects", async () => {
    const clock = createManualClock();
    const { fetch, calls } = createFakeFetch(hangUntilAborted);

    const result = stopSession({ fetch, clock, apiKey: API_KEY }, SESSION_ID).then(
      () => null,
      (e: unknown) => e as Error,
    );
    await flush();
    clock.advance(API_FETCH_TIMEOUT_MS);
    const error = await result;

    expect(error).toBeInstanceOf(Error);
    expect(calls[0].init.signal?.aborted).toBe(true);
  });

  it("rejects after 10 s even when fetch ignores the abort signal", async () => {
    const clock = createManualClock();
    const { fetch } = createFakeFetch(() => new Promise<Response>(() => {}));

    const result = stopSession({ fetch, clock, apiKey: API_KEY }, SESSION_ID).then(
      () => null,
      (e: unknown) => e as Error,
    );
    await flush();
    clock.advance(API_FETCH_TIMEOUT_MS);

    expect(await result).toBeInstanceOf(Error);
  });
});
