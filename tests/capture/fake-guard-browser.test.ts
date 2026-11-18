import { describe, expect, it } from "vitest";
import type { GuardBrowser, GuardSession } from "@/lib/capture/guard-types";
import { createFakeGuardBrowser, DEFAULT_MAIN_FRAME_ID } from "./helpers/fake-guard-browser";

type PausedEvent = { method: string; params: unknown };

/** Lets promise callbacks that need no timer run. */
function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/** Resolves with "pending" when the promise has not settled after a flush. */
async function state(promise: Promise<unknown>): Promise<"pending" | "resolved" | "rejected"> {
  let result: "pending" | "resolved" | "rejected" = "pending";
  promise.then(
    () => {
      result = "resolved";
    },
    () => {
      result = "rejected";
    },
  );
  await flush();
  return result;
}

/** Calls `send` the way a wrong caller would, with an extra argument. */
function sendWithThreeArguments(session: GuardSession): unknown {
  return (session.send as (...args: unknown[]) => unknown)("Fetch.enable", {}, "child-session");
}

async function open() {
  const fake = createFakeGuardBrowser();
  const session = await fake.openGuardSession();
  return { fake, session };
}

describe("fake guard browser: opening", () => {
  it("is a GuardBrowser and counts the sessions opened", async () => {
    const fake = createFakeGuardBrowser();
    const browser: GuardBrowser = fake;
    expect(fake.openCalls).toBe(0);
    const session: GuardSession = await browser.openGuardSession();
    expect(fake.openCalls).toBe(1);
    expect(typeof session.send).toBe("function");
  });

  it("rejects, or never settles, when the open is scripted so", async () => {
    const failing = createFakeGuardBrowser();
    failing.scriptOpen(new Error("no browser session"));
    await expect(failing.openGuardSession()).rejects.toThrow("no browser session");

    const hanging = createFakeGuardBrowser();
    hanging.scriptOpen("hang");
    expect(await state(hanging.openGuardSession())).toBe("pending");
  });

  it("records the handlers that were registered when the first command was sent", async () => {
    const { fake, session } = await open();
    session.onEvent(() => {});
    session.onClose(() => {});
    fake.onDisconnected(() => {});
    expect(fake.handlersAtFirstSend).toBeUndefined();
    await session.send("Fetch.enable", {});
    session.onEvent(() => {});
    expect(fake.handlersAtFirstSend).toEqual({ event: 1, close: 1, disconnected: 1 });
    expect(fake.handlerCounts).toEqual({ event: 2, close: 1, disconnected: 1 });
  });
});

describe("fake guard browser: strict send", () => {
  it("throws on a third argument and records a violation", async () => {
    const { fake, session } = await open();
    expect(() => sendWithThreeArguments(session)).toThrow(/at most two arguments/);
    expect(fake.violations).toHaveLength(1);
    expect(fake.violations[0]).toContain("Fetch.enable");
    expect(fake.calls).toHaveLength(0);
  });

  it("throws on params.sessionId and records a violation", async () => {
    const { fake, session } = await open();
    expect(() => session.send("Fetch.enable", { sessionId: "child" })).toThrow(/sessionId/);
    expect(fake.violations).toHaveLength(1);
    expect(fake.calls).toHaveLength(0);
  });

  it("accepts a command with no params and with params", async () => {
    const { fake, session } = await open();
    await session.send("Fetch.enable");
    await session.send("Fetch.enable", { patterns: [] });
    expect(fake.violations).toEqual([]);
    expect(fake.callsOf("Fetch.enable")).toHaveLength(2);
    fake.assertNoViolations();
  });
});

describe("fake guard browser: the browser target answers only its own domains", () => {
  it.each([
    "Network.setBlockedURLs",
    "Page.getFrameTree",
    "Runtime.evaluate",
    "Emulation.setScrollbarsHidden",
  ])("rejects %s as not found", async (method) => {
    const { fake, session } = await open();
    await expect(session.send(method, {})).rejects.toThrow(`'${method}' wasn't found`);
    // A rejected unknown method is a missing command, not a protocol violation.
    expect(fake.violations).toEqual([]);
    expect(fake.callsOf(method)).toHaveLength(1);
  });

  it("answers Browser.getVersion and the Fetch commands", async () => {
    const { session } = await open();
    await expect(session.send("Browser.getVersion")).resolves.toMatchObject({ product: expect.any(String) });
    await expect(session.send("Fetch.enable", { patterns: [] })).resolves.toEqual({});
    await expect(session.send("Fetch.disable")).resolves.toEqual({});
  });
});

describe("fake guard browser: scripted answers", () => {
  it("returns a value, rejects an Error, and never settles for hang", async () => {
    const { fake, session } = await open();
    fake.script("Browser.getVersion", { product: "Chrome/0" });
    fake.script("Fetch.enable", new Error("not allowed"));
    fake.script("Fetch.disable", "hang");
    await expect(session.send("Browser.getVersion")).resolves.toEqual({ product: "Chrome/0" });
    await expect(session.send("Fetch.enable")).rejects.toThrow("not allowed");
    expect(await state(session.send("Fetch.disable"))).toBe("pending");
  });

  it("lets a function choose per call, and falls back to the default for undefined", async () => {
    const { fake, session } = await open();
    let calls = 0;
    fake.script("Browser.getVersion", () => {
      calls += 1;
      return calls === 1 ? new Error("first fails") : undefined;
    });
    await expect(session.send("Browser.getVersion")).rejects.toThrow("first fails");
    await expect(session.send("Browser.getVersion")).resolves.toMatchObject({ product: expect.any(String) });
  });
});

describe("fake guard browser: paused requests", () => {
  it("delivers the paused events of every source on the one session", async () => {
    const { fake, session } = await open();
    const events: PausedEvent[] = [];
    session.onEvent((event) => {
      events.push(event);
    });

    const sources = ["page", "iframe", "oopif", "worker", "shared-worker", "popup"];
    for (const source of sources) {
      fake.emitPaused({ url: `https://example.com/${source}`, source, resourceType: "Fetch", frameId: `F-${source}` });
    }
    await flush();

    expect(fake.handlerCounts.event).toBe(1);
    expect(events).toHaveLength(sources.length);
    expect(events.every((event) => event.method === "Fetch.requestPaused")).toBe(true);
    expect(fake.requests.map((request) => request.source)).toEqual(sources);
  });

  it("gives each event the request id, URL, frame id, resource type, headers and redirect id", async () => {
    const { fake, session } = await open();
    const events: PausedEvent[] = [];
    session.onEvent((event) => {
      events.push(event);
    });

    const first = fake.emitPaused({
      url: "https://example.com/a",
      resourceType: "Document",
      frameId: "FRAME-1",
      headers: { "Service-Worker": "script", Accept: "*/*" },
      redirectedRequestId: "R-0",
    });
    const second = fake.emitPaused({ url: "https://example.com/b" });
    await flush();

    expect(first.requestId).not.toBe(second.requestId);
    expect(events[0]?.params).toMatchObject({
      requestId: first.requestId,
      request: { url: "https://example.com/a", headers: { "Service-Worker": "script", Accept: "*/*" } },
      frameId: "FRAME-1",
      resourceType: "Document",
      redirectedRequestId: "R-0",
    });
    // Defaults: a document of the main frame, no redirect id.
    expect(events[1]?.params).toMatchObject({ frameId: DEFAULT_MAIN_FRAME_ID, resourceType: "Document" });
    expect(events[1]?.params).not.toHaveProperty("redirectedRequestId");
  });

  it("keeps an unanswered request pending and never continues it by itself", async () => {
    const { fake, session } = await open();
    session.onEvent(() => {});
    const paused = fake.emitPaused({ url: "https://example.com/slow" });
    await flush();
    await flush();
    expect(fake.pending().map((request) => request.requestId)).toEqual([paused.requestId]);
    expect(fake.requests[0]?.state).toBe("pending");
    expect(fake.callsOf("Fetch.continueRequest")).toHaveLength(0);
  });

  it("answers a pending request once with continueRequest or failRequest", async () => {
    const { fake, session } = await open();
    const a = fake.emitPaused({ url: "https://example.com/a" });
    const b = fake.emitPaused({ url: "https://example.com/b" });
    await session.send("Fetch.continueRequest", { requestId: a.requestId });
    await session.send("Fetch.failRequest", { requestId: b.requestId, errorReason: "BlockedByClient" });
    expect(fake.requests.map((request) => request.state)).toEqual(["continued", "failed"]);
    expect(fake.requests[1]?.errorReason).toBe("BlockedByClient");
    expect(fake.pending()).toEqual([]);
  });

  it("rejects an unknown or a second answer with Invalid InterceptionId", async () => {
    const { fake, session } = await open();
    const a = fake.emitPaused({ url: "https://example.com/a" });
    await expect(session.send("Fetch.continueRequest", { requestId: "nope" })).rejects.toThrow("Invalid InterceptionId");
    await expect(session.send("Fetch.failRequest", { requestId: "nope", errorReason: "Failed" })).rejects.toThrow(
      "Invalid InterceptionId",
    );
    await expect(session.send("Fetch.continueRequest", {})).rejects.toThrow("Invalid InterceptionId");

    await session.send("Fetch.continueRequest", { requestId: a.requestId });
    await expect(session.send("Fetch.continueRequest", { requestId: a.requestId })).rejects.toThrow(
      "Invalid InterceptionId",
    );
    await expect(session.send("Fetch.failRequest", { requestId: a.requestId, errorReason: "Failed" })).rejects.toThrow(
      "Invalid InterceptionId",
    );
    expect(fake.requests[0]?.state).toBe("continued");
  });

  it("leaves a request pending when a scripted answer rejects, so a fallback can still answer it", async () => {
    const { fake, session } = await open();
    fake.script("Fetch.continueRequest", new Error("Session closed"));
    const a = fake.emitPaused({ url: "https://example.com/a" });
    await expect(session.send("Fetch.continueRequest", { requestId: a.requestId })).rejects.toThrow("Session closed");
    expect(fake.requests[0]?.state).toBe("pending");
    await session.send("Fetch.failRequest", { requestId: a.requestId, errorReason: "BlockedByClient" });
    expect(fake.requests[0]?.state).toBe("failed");
  });

  it("does not throw out of emitPaused when a handler throws, and records the error", async () => {
    const { fake, session } = await open();
    session.onEvent(() => {
      throw new Error("handler bug");
    });
    const paused = fake.emitPaused({ url: "https://example.com/a" });
    await expect(paused.handled).resolves.toBeUndefined();
    expect(fake.handlerErrors.map((error) => error.message)).toEqual(["handler bug"]);
  });

  it("throws when a request is emitted before a session was opened", () => {
    const fake = createFakeGuardBrowser();
    expect(() => fake.emitPaused({ url: "https://example.com/a" })).toThrow(/session/);
  });
});

describe("fake guard browser: response stage", () => {
  const HEADERS = [
    { name: "Content-Type", value: "text/html" },
    { name: "Set-Cookie", value: "a=1" },
    { name: "Set-Cookie", value: "b=2" },
  ];

  it("emits a response-stage event with status, phrase, headers and no error reason", async () => {
    const { fake, session } = await open();
    const events: PausedEvent[] = [];
    session.onEvent((event) => {
      events.push(event);
    });
    const paused = fake.emitPaused({
      url: "https://example.com/",
      response: { status: 201, statusText: "Created", headers: HEADERS },
    });
    await flush();
    expect(events[0]?.params).toMatchObject({
      requestId: paused.requestId,
      responseStatusCode: 201,
      responseStatusText: "Created",
      responseHeaders: HEADERS,
    });
    expect(events[0]?.params).not.toHaveProperty("responseErrorReason");
    expect(fake.requests[0]?.stage).toBe("response");
  });

  it("defaults the status to 200 and gives an error reason without a status code", async () => {
    const { fake, session } = await open();
    const events: PausedEvent[] = [];
    session.onEvent((event) => {
      events.push(event);
    });
    fake.emitPaused({ url: "https://example.com/a", response: {} });
    fake.emitPaused({ url: "https://example.com/b", response: { errorReason: "Failed" } });
    await flush();
    expect(events[0]?.params).toMatchObject({ responseStatusCode: 200 });
    expect(events[1]?.params).toMatchObject({ responseErrorReason: "Failed" });
    expect(events[1]?.params).not.toHaveProperty("responseStatusCode");
  });

  it("marks a request without a response as request stage and sends no response fields", async () => {
    const { fake, session } = await open();
    const events: PausedEvent[] = [];
    session.onEvent((event) => {
      events.push(event);
    });
    fake.emitPaused({ url: "https://example.com/a" });
    await flush();
    expect(fake.requests[0]?.stage).toBe("request");
    expect(events[0]?.params).not.toHaveProperty("responseStatusCode");
    expect(events[0]?.params).not.toHaveProperty("responseHeaders");
  });

  it("returns the body of a response-stage request and keeps it pending", async () => {
    const { fake, session } = await open();
    const a = fake.emitPaused({ url: "https://example.com/a", response: { body: "<p>hi</p>" } });
    const b = fake.emitPaused({ url: "https://example.com/b", response: { body: "aGk=", base64Encoded: true } });
    await expect(session.send("Fetch.getResponseBody", { requestId: a.requestId })).resolves.toEqual({
      body: "<p>hi</p>",
      base64Encoded: false,
    });
    await expect(session.send("Fetch.getResponseBody", { requestId: b.requestId })).resolves.toEqual({
      body: "aGk=",
      base64Encoded: true,
    });
    expect(fake.requests.map((request) => request.state)).toEqual(["pending", "pending"]);
  });

  it("rejects getResponseBody for an unknown id, a request-stage request and an errored response", async () => {
    const { fake, session } = await open();
    const early = fake.emitPaused({ url: "https://example.com/a" });
    const errored = fake.emitPaused({ url: "https://example.com/b", response: { errorReason: "Failed" } });
    await expect(session.send("Fetch.getResponseBody", { requestId: "nope" })).rejects.toThrow("Invalid InterceptionId");
    await expect(session.send("Fetch.getResponseBody", { requestId: early.requestId })).rejects.toThrow(
      /response|headers received/i,
    );
    await expect(session.send("Fetch.getResponseBody", { requestId: errored.requestId })).rejects.toThrow(
      /response|headers received/i,
    );
  });

  it("fulfils a pending request once and records what was sent", async () => {
    const { fake, session } = await open();
    const a = fake.emitPaused({ url: "https://example.com/a", response: { body: "x" } });
    await session.send("Fetch.fulfillRequest", {
      requestId: a.requestId,
      responseCode: 200,
      responsePhrase: "OK",
      responseHeaders: HEADERS,
      body: "eA==",
    });
    expect(fake.requests[0]?.state).toBe("fulfilled");
    expect(fake.requests[0]?.fulfilled).toEqual({
      responseCode: 200,
      responsePhrase: "OK",
      responseHeaders: HEADERS,
      body: "eA==",
    });
    await expect(session.send("Fetch.fulfillRequest", { requestId: a.requestId, responseCode: 200 })).rejects.toThrow(
      "Invalid InterceptionId",
    );
    await expect(session.send("Fetch.failRequest", { requestId: a.requestId })).rejects.toThrow("Invalid InterceptionId");
  });

  it("rejects fulfillRequest for an unknown id and without an integer responseCode", async () => {
    const { fake, session } = await open();
    const a = fake.emitPaused({ url: "https://example.com/a", response: {} });
    await expect(session.send("Fetch.fulfillRequest", { requestId: "nope", responseCode: 200 })).rejects.toThrow(
      "Invalid InterceptionId",
    );
    await expect(session.send("Fetch.fulfillRequest", { requestId: a.requestId })).rejects.toThrow(/responseCode/);
    await expect(session.send("Fetch.fulfillRequest", { requestId: a.requestId, responseCode: "200" })).rejects.toThrow(
      /responseCode/,
    );
    expect(fake.requests[0]?.state).toBe("pending");
  });

  it("lets a request-stage request be fulfilled too", async () => {
    const { fake, session } = await open();
    const a = fake.emitPaused({ url: "https://example.com/a" });
    await session.send("Fetch.fulfillRequest", { requestId: a.requestId, responseCode: 204 });
    expect(fake.requests[0]?.state).toBe("fulfilled");
  });

  it("rejects continueResponse with headers and no responseCode, and leaves the request pending", async () => {
    const { fake, session } = await open();
    const a = fake.emitPaused({ url: "https://example.com/a", response: {} });
    await expect(
      session.send("Fetch.continueResponse", { requestId: a.requestId, responseHeaders: HEADERS }),
    ).rejects.toThrow(/responseCode/);
    expect(fake.requests[0]?.state).toBe("pending");
    expect(fake.callsOf("Fetch.continueResponse")).toHaveLength(1);
  });

  it("accepts continueResponse with a responseCode, or with nothing, at the response stage only", async () => {
    const { fake, session } = await open();
    const a = fake.emitPaused({ url: "https://example.com/a", response: {} });
    const b = fake.emitPaused({ url: "https://example.com/b", response: {} });
    const early = fake.emitPaused({ url: "https://example.com/c" });
    await session.send("Fetch.continueResponse", { requestId: a.requestId, responseCode: 200, responseHeaders: HEADERS });
    await session.send("Fetch.continueResponse", { requestId: b.requestId });
    await expect(session.send("Fetch.continueResponse", { requestId: early.requestId })).rejects.toThrow(
      /response stage|Invalid InterceptionId/,
    );
    await expect(session.send("Fetch.continueResponse", { requestId: a.requestId })).rejects.toThrow(
      "Invalid InterceptionId",
    );
    expect(fake.requests.map((request) => request.state)).toEqual(["continued", "continued", "pending"]);
  });

  it("answers a response-stage request with continueRequest, like Chromium does", async () => {
    const { fake, session } = await open();
    const a = fake.emitPaused({ url: "https://example.com/a", response: {} });
    await session.send("Fetch.continueRequest", { requestId: a.requestId });
    expect(fake.requests[0]?.state).toBe("continued");
  });

  it("lets a fulfilled or never-answered request not count as gone out when the connection drops", async () => {
    const { fake, session } = await open();
    const done = fake.emitPaused({ url: "https://example.com/a", response: {} });
    const waiting = fake.emitPaused({ url: "https://example.com/b", response: {} });
    await session.send("Fetch.fulfillRequest", { requestId: done.requestId, responseCode: 200 });
    fake.dropConnection();
    expect(fake.wentOut().map((request) => request.requestId)).toEqual([waiting.requestId]);
  });
});

describe("fake guard browser: losing the connection", () => {
  it("detach records the pending requests as gone out and emits close only", async () => {
    const { fake, session } = await open();
    const closes: string[] = [];
    const disconnects: string[] = [];
    session.onClose(() => closes.push("close"));
    fake.onDisconnected(() => disconnects.push("disconnected"));
    const answered = fake.emitPaused({ url: "https://example.com/a" });
    const waiting = fake.emitPaused({ url: "https://example.com/b" });
    await session.send("Fetch.continueRequest", { requestId: answered.requestId });

    fake.detach();

    expect(closes).toEqual(["close"]);
    expect(disconnects).toEqual([]);
    expect(fake.wentOut().map((request) => request.requestId)).toEqual([waiting.requestId]);
    expect(fake.requests[0]?.state).toBe("continued");
    expect(fake.requests[1]?.state).toBe("gone-out");
    expect(fake.pending()).toEqual([]);
  });

  it("dropConnection records the pending requests as gone out and emits close and disconnected", async () => {
    const { fake, session } = await open();
    const order: string[] = [];
    session.onClose(() => order.push("close"));
    fake.onDisconnected(() => order.push("disconnected"));
    const waiting = fake.emitPaused({ url: "https://example.com/b" });

    fake.dropConnection();

    expect(order).toEqual(["close", "disconnected"]);
    expect(fake.wentOut().map((request) => request.requestId)).toEqual([waiting.requestId]);
  });

  it("emits each signal once, however often the connection is lost", async () => {
    const { fake, session } = await open();
    let closes = 0;
    let disconnects = 0;
    session.onClose(() => {
      closes += 1;
    });
    fake.onDisconnected(() => {
      disconnects += 1;
    });
    fake.detach();
    fake.detach();
    fake.dropConnection();
    expect(closes).toBe(1);
    expect(disconnects).toBe(1);
  });

  it("rejects every command after the connection is gone, and answers no request", async () => {
    const { fake, session } = await open();
    const waiting = fake.emitPaused({ url: "https://example.com/b" });
    fake.dropConnection();
    await expect(session.send("Browser.getVersion")).rejects.toThrow(/closed/i);
    await expect(session.send("Fetch.failRequest", { requestId: waiting.requestId })).rejects.toThrow(/closed/i);
    expect(fake.requests[0]?.state).toBe("gone-out");
  });
});

describe("fake guard browser: violations", () => {
  it("assertNoViolations passes for a guard that passes two arguments", async () => {
    const { fake, session } = await open();
    await session.send("Fetch.enable", {});
    expect(() => fake.assertNoViolations()).not.toThrow();
  });

  it("assertNoViolations fails for a deliberately wrong guard that passes a third argument", async () => {
    const fake = createFakeGuardBrowser();
    async function wrongGuard(browser: GuardBrowser): Promise<void> {
      const session = await browser.openGuardSession();
      try {
        await sendWithThreeArguments(session);
      } catch {
        // A guard that swallows the error must still be caught by the shared check.
      }
    }
    await wrongGuard(fake);
    expect(() => fake.assertNoViolations()).toThrow(/protocol violation/i);
  });

  it("assertNoViolations fails after a params.sessionId call", async () => {
    const { fake, session } = await open();
    try {
      await session.send("Fetch.enable", { sessionId: "child" });
    } catch {
      // swallowed on purpose
    }
    expect(() => fake.assertNoViolations()).toThrow(/protocol violation/i);
  });
});
