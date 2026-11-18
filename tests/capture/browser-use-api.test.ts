import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createSession,
  proxyBodyFields,
  reclaimSession,
  stopSession,
  sweepStaleSessions,
} from "@/lib/capture/browser-use-api";
import { API_FETCH_TIMEOUT_MS, STALE_SESSION_AGE_MS } from "@/lib/capture/constants";
import { CaptureFailure } from "@/lib/capture/types";
import { createManualClock } from "./helpers/manual-clock";

const API_KEY = "sk-test-sentinel";
const SESSION_ID = "sess-sentinel-1234";
const CDP_URL = "wss://abc.cdp.browser-use.com/devtools/browser/sentinel";
const LIVE_URL = "https://live.browser-use.com/?wss=sentinel";
const CAPTURE_ID = "capture-id-sentinel";

const REQUEST = {
  timeoutMinutes: 2,
  proxy: "off" as const,
  viewport: { width: 1280, height: 800 },
  captureId: CAPTURE_ID,
};

const LIST_URL = "https://api.browser-use.com/api/v4/browsers?status=active";

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
      metadata: { app: "trick-or-trap", captureId: CAPTURE_ID },
    });
  });

  it("omits proxyCountryCode when the proxy is on and passes the timeout in minutes", async () => {
    const clock = createManualClock();
    const { fetch, calls } = createFakeFetch(async () =>
      jsonResponse({ id: SESSION_ID, cdpUrl: CDP_URL, liveUrl: LIVE_URL }),
    );

    await createSession({ fetch, clock, apiKey: API_KEY }, { ...REQUEST, proxy: "on", timeoutMinutes: 4 });

    const body = JSON.parse(calls[0].init.body as string) as Record<string, unknown>;
    expect(body).toEqual({
      timeout: 4,
      browserScreenWidth: 1280,
      browserScreenHeight: 800,
      metadata: { app: "trick-or-trap", captureId: CAPTURE_ID },
    });
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

  it("sends the capture id in the metadata and nothing else secret", async () => {
    const clock = createManualClock();
    const { fetch, calls } = createFakeFetch(async () => jsonResponse({ id: SESSION_ID, cdpUrl: CDP_URL }));

    await createSession({ fetch, clock, apiKey: API_KEY }, { ...REQUEST, captureId: "another-capture" });

    const body = JSON.parse(calls[0].init.body as string) as { metadata: unknown };
    expect(body.metadata).toEqual({ app: "trick-or-trap", captureId: "another-capture" });
  });

  describe("a response with an id and no usable cdpUrl", () => {
    it.each([
      ["a missing cdpUrl", { id: SESSION_ID, liveUrl: LIVE_URL }],
      ["a null cdpUrl", { id: SESSION_ID, cdpUrl: null, liveUrl: LIVE_URL }],
      ["an empty cdpUrl", { id: SESSION_ID, cdpUrl: "", liveUrl: LIVE_URL }],
      ["a non-string cdpUrl", { id: SESSION_ID, cdpUrl: 5, liveUrl: LIVE_URL }],
    ])("stops that session once and fails with session-create-failed for %s", async (_label, body) => {
      const clock = createManualClock();
      const { fetch, calls } = createFakeFetch(async (call) =>
        call.init.method === "POST" ? jsonResponse(body) : jsonResponse({ id: SESSION_ID, status: "stopped" }),
      );

      const failure = await failureOf(createSession({ fetch, clock, apiKey: API_KEY }, REQUEST));

      expect(failure.code).toBe("session-create-failed");
      expect(failure.reclaim).toBe(false);
      expect(calls.map((call) => call.init.method)).toEqual(["POST", "PATCH"]);
      expect(calls[1].url).toBe(`https://api.browser-use.com/api/v4/browsers/${SESSION_ID}`);
      expect(JSON.parse(calls[1].init.body as string)).toEqual({ action: "stop" });
      const text = `${failure.message} ${failure.detail ?? ""}`;
      for (const secret of [API_KEY, SESSION_ID, CDP_URL, LIVE_URL]) expect(text).not.toContain(secret);
      expect(clock.pendingTimers).toBe(0);
    });

    it("ignores a failing stop call and still throws session-create-failed", async () => {
      const clock = createManualClock();
      const { fetch, calls } = createFakeFetch(async (call) => {
        if (call.init.method === "POST") return jsonResponse({ id: SESSION_ID });
        throw new Error(`stop failed ${API_KEY} ${SESSION_ID}`);
      });

      const failure = await failureOf(createSession({ fetch, clock, apiKey: API_KEY }, REQUEST));

      expect(failure.code).toBe("session-create-failed");
      expect(calls).toHaveLength(2);
      expect(failure.detail ?? "").not.toContain(API_KEY);
      expect(failure.detail ?? "").not.toContain(SESSION_ID);
    });

    it("ignores a stop call that answers with an HTTP error", async () => {
      const clock = createManualClock();
      const { fetch } = createFakeFetch(async (call) =>
        call.init.method === "POST" ? jsonResponse({ id: SESSION_ID }) : jsonResponse({}, 500),
      );

      const failure = await failureOf(createSession({ fetch, clock, apiKey: API_KEY }, REQUEST));

      expect(failure.code).toBe("session-create-failed");
    });

    it("sends no stop call when the response has no usable id", async () => {
      const clock = createManualClock();
      const { fetch, calls } = createFakeFetch(async () => jsonResponse({ id: "", cdpUrl: CDP_URL }));

      await failureOf(createSession({ fetch, clock, apiKey: API_KEY }, REQUEST));

      expect(calls).toHaveLength(1);
    });
  });

  describe("the reclaim flag of a failure", () => {
    it("is true for an abort at 10 s", async () => {
      const clock = createManualClock();
      const { fetch } = createFakeFetch(hangUntilAborted);

      const failureP = failureOf(createSession({ fetch, clock, apiKey: API_KEY }, REQUEST));
      await flush();
      clock.advance(API_FETCH_TIMEOUT_MS);
      const failure = await failureP;

      expect(failure.code).toBe("session-create-timeout");
      expect(failure.reclaim).toBe(true);
    });

    it("is true for a rejected fetch", async () => {
      const clock = createManualClock();
      const { fetch } = createFakeFetch(async () => {
        throw new Error("socket hang up");
      });

      const failure = await failureOf(createSession({ fetch, clock, apiKey: API_KEY }, REQUEST));

      expect(failure.code).toBe("session-create-failed");
      expect(failure.reclaim).toBe(true);
    });

    it("is false for an HTTP 500", async () => {
      const clock = createManualClock();
      const { fetch } = createFakeFetch(async () => jsonResponse({ error: "down" }, 500));

      const failure = await failureOf(createSession({ fetch, clock, apiKey: API_KEY }, REQUEST));

      expect(failure.code).toBe("session-create-failed");
      expect(failure.reclaim).toBe(false);
    });

    it("is false for a body that is not JSON", async () => {
      const clock = createManualClock();
      const { fetch } = createFakeFetch(async () => new Response("<html>", { status: 200 }));

      const failure = await failureOf(createSession({ fetch, clock, apiKey: API_KEY }, REQUEST));

      expect(failure.reclaim).toBe(false);
    });

    it("is false for a body of the wrong shape", async () => {
      const clock = createManualClock();
      const { fetch } = createFakeFetch(async () => jsonResponse("oops"));

      const failure = await failureOf(createSession({ fetch, clock, apiKey: API_KEY }, REQUEST));

      expect(failure.reclaim).toBe(false);
    });
  });
});

function listItem(id: string, metadata: unknown, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { id, ...(metadata === undefined ? {} : { metadata }), ...extra };
}

/** A fetch that answers the list call with `listBody` and every PATCH with `patchStatus`. */
function createListFetch(listBody: unknown, options: { listStatus?: number; patchStatus?: number; patchThrows?: boolean } = {}) {
  return createFakeFetch(async (call) => {
    if (call.init.method === "GET") return jsonResponse(listBody, options.listStatus ?? 200);
    if (options.patchThrows) throw new Error(`stop failed ${API_KEY}`);
    return jsonResponse({}, options.patchStatus ?? 200);
  });
}

function patchedIds(calls: FetchCall[]): string[] {
  return calls
    .filter((call) => call.init.method === "PATCH")
    .map((call) => decodeURIComponent(call.url.slice("https://api.browser-use.com/api/v4/browsers/".length)));
}

describe("reclaimSession", () => {
  it("lists active sessions with the key header and stops only the one with this capture id", async () => {
    const clock = createManualClock();
    const { fetch, calls } = createListFetch([
      listItem("mine", { app: "trick-or-trap", captureId: CAPTURE_ID }),
      listItem("other-capture", { app: "trick-or-trap", captureId: "someone-else" }),
      listItem("no-capture", { app: "trick-or-trap" }),
      listItem("not-ours", { captureId: "someone-else" }),
    ]);

    await reclaimSession({ fetch, clock, apiKey: API_KEY }, CAPTURE_ID);

    expect(calls[0].url).toBe(LIST_URL);
    expect(calls[0].init.method).toBe("GET");
    expect((calls[0].init.headers as Record<string, string>)["X-Browser-Use-API-Key"]).toBe(API_KEY);
    expect(patchedIds(calls)).toEqual(["mine"]);
    expect(clock.pendingTimers).toBe(0);
  });

  it.each([
    ["items", { items: [listItem("mine", { captureId: CAPTURE_ID })] }],
    ["browsers", { browsers: [listItem("mine", { captureId: CAPTURE_ID })] }],
    ["results", { results: [listItem("mine", { captureId: CAPTURE_ID })] }],
    ["an array", [listItem("mine", { captureId: CAPTURE_ID })]],
  ])("reads the list from %s", async (_label, body) => {
    const clock = createManualClock();
    const { fetch, calls } = createListFetch(body);

    await reclaimSession({ fetch, clock, apiKey: API_KEY }, CAPTURE_ID);

    expect(patchedIds(calls)).toEqual(["mine"]);
  });

  it.each([
    ["null", null],
    ["a string", "oops"],
    ["an object without a list", { total: 1 }],
    ["an object with a list that is not an array", { items: "nope" }],
    ["items without metadata", [listItem("mine", undefined), listItem("also-mine", null), listItem("third", "text")]],
    ["items without an id", [{ metadata: { captureId: CAPTURE_ID } }, { id: 5, metadata: { captureId: CAPTURE_ID } }]],
    ["entries that are not objects", ["x", 5, null]],
  ])("stops nothing and does not throw for %s", async (_label, body) => {
    const clock = createManualClock();
    const { fetch, calls } = createListFetch(body);

    await expect(reclaimSession({ fetch, clock, apiKey: API_KEY }, CAPTURE_ID)).resolves.toBeUndefined();

    expect(patchedIds(calls)).toEqual([]);
  });

  it("stops nothing and does not throw for a non-2xx list answer", async () => {
    const clock = createManualClock();
    const { fetch, calls } = createListFetch([listItem("mine", { captureId: CAPTURE_ID })], { listStatus: 500 });

    await expect(reclaimSession({ fetch, clock, apiKey: API_KEY }, CAPTURE_ID)).resolves.toBeUndefined();

    expect(patchedIds(calls)).toEqual([]);
  });

  it("stops nothing and does not throw for a list body that is not JSON", async () => {
    const clock = createManualClock();
    const { fetch, calls } = createFakeFetch(async () => new Response("<html>", { status: 200 }));

    await expect(reclaimSession({ fetch, clock, apiKey: API_KEY }, CAPTURE_ID)).resolves.toBeUndefined();

    expect(calls).toHaveLength(1);
  });

  it("does not throw when the list call itself fails", async () => {
    const clock = createManualClock();
    const { fetch } = createFakeFetch(async () => {
      throw new Error(`network down ${API_KEY}`);
    });

    await expect(reclaimSession({ fetch, clock, apiKey: API_KEY }, CAPTURE_ID)).resolves.toBeUndefined();
  });

  it("does not throw when a stop call fails and still tries the other sessions", async () => {
    const clock = createManualClock();
    const { fetch, calls } = createListFetch(
      [listItem("first", { captureId: CAPTURE_ID }), listItem("second", { captureId: CAPTURE_ID })],
      { patchThrows: true },
    );

    await expect(reclaimSession({ fetch, clock, apiKey: API_KEY }, CAPTURE_ID)).resolves.toBeUndefined();

    expect(patchedIds(calls).sort()).toEqual(["first", "second"]);
  });

  it("does not throw when a stop call answers with an HTTP error", async () => {
    const clock = createManualClock();
    const { fetch } = createListFetch([listItem("mine", { captureId: CAPTURE_ID })], { patchStatus: 500 });

    await expect(reclaimSession({ fetch, clock, apiKey: API_KEY }, CAPTURE_ID)).resolves.toBeUndefined();
  });

  it("stops nothing for an empty capture id", async () => {
    const clock = createManualClock();
    const { fetch, calls } = createListFetch([listItem("x", { captureId: "" })]);

    await reclaimSession({ fetch, clock, apiKey: API_KEY }, "");

    expect(patchedIds(calls)).toEqual([]);
  });

  it("gives up on a list call that never answers after 10 s", async () => {
    const clock = createManualClock();
    const { fetch } = createFakeFetch(() => new Promise<Response>(() => {}));

    const done = reclaimSession({ fetch, clock, apiKey: API_KEY }, CAPTURE_ID);
    await flush();
    clock.advance(API_FETCH_TIMEOUT_MS);

    await expect(done).resolves.toBeUndefined();
  });
});

describe("sweepStaleSessions", () => {
  const NOW = Date.parse("2026-01-01T12:00:00.000Z");
  const iso = (ageMs: number) => new Date(NOW - ageMs).toISOString();
  const TAG = { app: "trick-or-trap" };

  it("stops only tagged sessions older than 120,000 ms by startedAt or createdAt", async () => {
    const clock = createManualClock();
    const { fetch, calls } = createListFetch({
      items: [
        listItem("stale-started", TAG, { startedAt: iso(STALE_SESSION_AGE_MS + 1) }),
        listItem("stale-created", TAG, { createdAt: iso(10 * STALE_SESSION_AGE_MS) }),
        listItem("exactly-limit", TAG, { startedAt: iso(STALE_SESSION_AGE_MS) }),
        listItem("fresh", TAG, { startedAt: iso(1_000) }),
        listItem("other-app", { app: "something-else" }, { startedAt: iso(10 * STALE_SESSION_AGE_MS) }),
        listItem("no-app", {}, { startedAt: iso(10 * STALE_SESSION_AGE_MS) }),
        listItem("no-age", TAG),
        listItem("bad-age", TAG, { startedAt: "not a date", createdAt: 5 }),
        listItem("future", TAG, { startedAt: iso(-60_000) }),
      ],
    });

    const result = await sweepStaleSessions({ fetch, clock, apiKey: API_KEY, now: () => NOW });

    expect(calls[0].url).toBe(LIST_URL);
    expect(patchedIds(calls).sort()).toEqual(["stale-created", "stale-started"]);
    expect(result).toEqual({ listed: 9, stopped: 2, failed: 0 });
  });

  it("counts failed stops and returns no session id", async () => {
    const clock = createManualClock();
    const { fetch } = createListFetch([listItem("stale", TAG, { startedAt: iso(500_000) })], { patchStatus: 500 });

    const result = await sweepStaleSessions({ fetch, clock, apiKey: API_KEY, now: () => NOW });

    expect(result).toEqual({ listed: 1, stopped: 0, failed: 1 });
    expect(JSON.stringify(result)).not.toContain("stale");
  });

  it("counts a stop call that throws as failed", async () => {
    const clock = createManualClock();
    const { fetch } = createListFetch([listItem("stale", TAG, { startedAt: iso(500_000) })], { patchThrows: true });

    const result = await sweepStaleSessions({ fetch, clock, apiKey: API_KEY, now: () => NOW });

    expect(result).toEqual({ listed: 1, stopped: 0, failed: 1 });
  });

  it.each([
    ["null", null],
    ["a string", "oops"],
    ["an object without a list", {}],
  ])("returns zero counts for %s", async (_label, body) => {
    const clock = createManualClock();
    const { fetch, calls } = createListFetch(body);

    const result = await sweepStaleSessions({ fetch, clock, apiKey: API_KEY, now: () => NOW });

    expect(result).toEqual({ listed: 0, stopped: 0, failed: 0 });
    expect(patchedIds(calls)).toEqual([]);
  });

  it("returns zero counts for a non-2xx list answer and for a failing list call", async () => {
    const clock = createManualClock();
    const status = createListFetch([], { listStatus: 503 });
    expect(await sweepStaleSessions({ fetch: status.fetch, clock, apiKey: API_KEY, now: () => NOW })).toEqual({
      listed: 0,
      stopped: 0,
      failed: 0,
    });

    const broken = createFakeFetch(async () => {
      throw new Error("down");
    });
    expect(await sweepStaleSessions({ fetch: broken.fetch, clock, apiKey: API_KEY, now: () => NOW })).toEqual({
      listed: 0,
      stopped: 0,
      failed: 0,
    });
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
