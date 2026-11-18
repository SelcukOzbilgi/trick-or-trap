import { afterEach, describe, expect, it } from "vitest";
import { installBrowserGuard } from "@/lib/capture/browser-guard";
import { GUARD_DECISION_TIMEOUT_MS, HARDENING_CSP } from "@/lib/capture/constants";
import type { GuardSession, RequestGuardEvent, RequestPolicy } from "@/lib/capture/guard-types";
import {
  answerResponse,
  hardenedHeaders,
  needsRewrite,
  type HeaderEntry,
  type PausedResponse,
} from "@/lib/capture/response-hardening";
import {
  createFakeGuardBrowser,
  DEFAULT_MAIN_FRAME_ID,
  type FakeGuardBrowser,
  type PausedInit,
  type PausedResponseInit,
} from "./helpers/fake-guard-browser";
import { createManualClock } from "./helpers/manual-clock";

const LIMITS = { maxBodyBytes: 1_000 };
const CSP: HeaderEntry = { name: "Content-Security-Policy", value: HARDENING_CSP };

const fakes: FakeGuardBrowser[] = [];

afterEach(() => {
  for (const fake of fakes.splice(0)) fake.assertNoViolations();
});

/** Lets promise callbacks that need no timer run. */
function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

async function open(): Promise<{ fake: FakeGuardBrowser; session: GuardSession }> {
  const fake = createFakeGuardBrowser();
  fakes.push(fake);
  return { fake, session: await fake.openGuardSession() };
}

function b64(text: string): string {
  return Buffer.from(text, "utf8").toString("base64");
}

type ResponseCase = {
  resourceType?: string;
  status?: number;
  statusText?: string;
  errorReason?: string;
  headers?: HeaderEntry[];
  body?: string;
  base64Encoded?: boolean;
};

/** Emits a response-stage request on the fake and returns the matching `PausedResponse`. */
function pauseResponse(fake: FakeGuardBrowser, init: ResponseCase = {}): PausedResponse {
  const response: PausedResponseInit = {
    status: init.status ?? (init.errorReason === undefined ? 200 : undefined),
    statusText: init.statusText,
    errorReason: init.errorReason,
    headers: init.headers,
    body: init.body,
    base64Encoded: init.base64Encoded,
  };
  const paused = fake.emitPaused({ url: "https://shop.example/x", resourceType: init.resourceType ?? "Document", response });
  const result: PausedResponse = { requestId: paused.requestId, resourceType: init.resourceType ?? "Document" };
  result.frameId = DEFAULT_MAIN_FRAME_ID;
  if (response.status !== undefined) result.responseStatusCode = response.status;
  if (init.statusText !== undefined) result.responseStatusText = init.statusText;
  if (init.errorReason !== undefined) result.responseErrorReason = init.errorReason;
  if (init.headers !== undefined) result.responseHeaders = init.headers;
  return result;
}

const HTML_HEADERS: HeaderEntry[] = [{ name: "Content-Type", value: "text/html; charset=utf-8" }];

describe("hardenedHeaders", () => {
  it("appends the policy and keeps every other header in order, including repeated Set-Cookie", () => {
    const headers: HeaderEntry[] = [
      { name: "Content-Type", value: "text/html" },
      { name: "Set-Cookie", value: "a=1" },
      { name: "X-Other", value: "yes" },
      { name: "Set-Cookie", value: "b=2" },
    ];
    expect(hardenedHeaders(headers)).toEqual([...headers, CSP]);
  });

  it.each(["Content-Encoding", "content-encoding", "CONTENT-ENCODING", "Content-Length", "content-length", "cOnTeNt-LeNgTh"])(
    "removes %s",
    (name) => {
      const result = hardenedHeaders([
        { name, value: "x" },
        { name: "Content-Type", value: "text/html" },
      ]);
      expect(result).toEqual([{ name: "Content-Type", value: "text/html" }, CSP]);
    },
  );

  it("keeps a policy the page already sent, and adds its own after it", () => {
    const page: HeaderEntry = { name: "Content-Security-Policy", value: "default-src 'self'" };
    expect(hardenedHeaders([page])).toEqual([page, CSP]);
  });

  it("gives only the policy for no headers, and does not change its input", () => {
    expect(hardenedHeaders([])).toEqual([CSP]);
    const input: HeaderEntry[] = [{ name: "Content-Length", value: "5" }];
    hardenedHeaders(input);
    expect(input).toEqual([{ name: "Content-Length", value: "5" }]);
  });
});

describe("needsRewrite", () => {
  it("is true for every Document", () => {
    expect(needsRewrite("Document", [])).toBe(true);
    expect(needsRewrite("Document", [{ name: "Content-Type", value: "application/pdf" }])).toBe(true);
  });

  it.each([
    "application/javascript",
    "text/javascript; charset=utf-8",
    "application/ecmascript",
    "text/ecmascript",
    "APPLICATION/JAVASCRIPT",
    "application/x-javascript",
  ])("is true for Other with Content-Type %s", (value) => {
    expect(needsRewrite("Other", [{ name: "Content-Type", value }])).toBe(true);
    expect(needsRewrite("Other", [{ name: "content-type", value }])).toBe(true);
  });

  it("is false for Other with another or no Content-Type", () => {
    expect(needsRewrite("Other", [{ name: "Content-Type", value: "application/json" }])).toBe(false);
    expect(needsRewrite("Other", [{ name: "Content-Type", value: "text/html" }])).toBe(false);
    expect(needsRewrite("Other", [])).toBe(false);
  });

  it.each(["Script", "XHR", "Fetch", "Image", "Stylesheet", "Font", "Ping", "WebSocket"])(
    "is false for %s even with a JavaScript Content-Type",
    (type) => {
      expect(needsRewrite(type, [{ name: "Content-Type", value: "text/javascript" }])).toBe(false);
    },
  );
});

describe("answerResponse: pass-through", () => {
  it.each([300, 301, 302, 307, 399])("continues a %i response unchanged, without reading the body", async (status) => {
    const { fake, session } = await open();
    const paused = pauseResponse(fake, { status, headers: [{ name: "Location", value: "https://shop.example/next" }] });
    await expect(answerResponse(session, paused, LIMITS)).resolves.toEqual({ allowed: true });
    expect(fake.requests[0]?.state).toBe("continued");
    expect(fake.callsOf("Fetch.continueRequest")[0]?.params).toEqual({ requestId: paused.requestId });
    expect(fake.callsOf("Fetch.getResponseBody")).toHaveLength(0);
    expect(fake.callsOf("Fetch.fulfillRequest")).toHaveLength(0);
  });

  it("does not treat 299 and 400 as redirects", async () => {
    const { fake, session } = await open();
    await answerResponse(session, pauseResponse(fake, { status: 299 }), LIMITS);
    await answerResponse(session, pauseResponse(fake, { status: 400 }), LIMITS);
    expect(fake.callsOf("Fetch.fulfillRequest")).toHaveLength(2);
  });

  it("continues a response that has an error reason, also for a Document", async () => {
    const { fake, session } = await open();
    const paused = pauseResponse(fake, { errorReason: "ConnectionRefused" });
    await expect(answerResponse(session, paused, LIMITS)).resolves.toEqual({ allowed: true });
    expect(fake.requests[0]?.state).toBe("continued");
    expect(fake.callsOf("Fetch.getResponseBody")).toHaveLength(0);
  });

  it.each(["Script", "XHR", "Fetch", "Image", "Stylesheet", "Other"])(
    "continues a %s response that is not JavaScript",
    async (resourceType) => {
      const { fake, session } = await open();
      const paused = pauseResponse(fake, { resourceType, headers: [{ name: "Content-Type", value: "application/json" }] });
      await expect(answerResponse(session, paused, LIMITS)).resolves.toEqual({ allowed: true });
      expect(fake.requests[0]?.state).toBe("continued");
      expect(fake.callsOf("Fetch.getResponseBody")).toHaveLength(0);
    },
  );

  it("rejects when the continue itself rejects, so the guard can fail the request", async () => {
    const { fake, session } = await open();
    fake.script("Fetch.continueRequest", new Error("request is gone"));
    const paused = pauseResponse(fake, { status: 302 });
    await expect(answerResponse(session, paused, LIMITS)).rejects.toThrow("request is gone");
  });
});

describe("answerResponse: rewrite", () => {
  it("re-serves a Document with its status, phrase, hardened headers and body", async () => {
    const { fake, session } = await open();
    const headers: HeaderEntry[] = [
      ...HTML_HEADERS,
      { name: "Content-Encoding", value: "gzip" },
      { name: "Content-Length", value: "12" },
      { name: "Set-Cookie", value: "a=1" },
      { name: "Set-Cookie", value: "b=2" },
    ];
    const paused = pauseResponse(fake, {
      status: 404,
      statusText: "Not Found",
      headers,
      body: b64("<p>hello</p>"),
      base64Encoded: true,
    });
    await expect(answerResponse(session, paused, LIMITS)).resolves.toEqual({ allowed: true });
    expect(fake.callsOf("Fetch.getResponseBody")[0]?.params).toEqual({ requestId: paused.requestId });
    expect(fake.callsOf("Fetch.fulfillRequest")[0]?.params).toEqual({
      requestId: paused.requestId,
      responseCode: 404,
      responsePhrase: "Not Found",
      responseHeaders: [
        ...HTML_HEADERS,
        { name: "Set-Cookie", value: "a=1" },
        { name: "Set-Cookie", value: "b=2" },
        CSP,
      ],
      body: b64("<p>hello</p>"),
    });
    expect(fake.requests[0]?.state).toBe("fulfilled");
  });

  it("leaves out the phrase when the event has none", async () => {
    const { fake, session } = await open();
    const paused = pauseResponse(fake, { headers: HTML_HEADERS, body: b64("x"), base64Encoded: true });
    await answerResponse(session, paused, LIMITS);
    expect(fake.callsOf("Fetch.fulfillRequest")[0]?.params).not.toHaveProperty("responsePhrase");
  });

  it.each([
    "application/javascript",
    "text/javascript; charset=utf-8",
    "application/ecmascript",
    "application/x-ecmascript",
  ])("re-serves an Other response with Content-Type %s", async (type) => {
    const { fake, session } = await open();
    const paused = pauseResponse(fake, {
      resourceType: "Other",
      headers: [{ name: "content-type", value: type }],
      body: "self.postMessage(1)",
    });
    await expect(answerResponse(session, paused, LIMITS)).resolves.toEqual({ allowed: true });
    expect(fake.requests[0]?.state).toBe("fulfilled");
    expect(fake.requests[0]?.fulfilled?.responseHeaders).toEqual([{ name: "content-type", value: type }, CSP]);
  });

  it("re-serves a Document that has no headers at all", async () => {
    const { fake, session } = await open();
    const paused = pauseResponse(fake, { body: b64("x"), base64Encoded: true });
    await answerResponse(session, paused, LIMITS);
    expect(fake.requests[0]?.fulfilled?.responseHeaders).toEqual([CSP]);
  });

  it("passes a base64 body on unchanged", async () => {
    const { fake, session } = await open();
    const paused = pauseResponse(fake, { body: "aGk=", base64Encoded: true });
    await answerResponse(session, paused, LIMITS);
    expect(fake.requests[0]?.fulfilled?.body).toBe("aGk=");
  });

  it("encodes a body that is not base64 from its UTF-8 bytes", async () => {
    const { fake, session } = await open();
    const text = "<p>caf\u00e9 \u2603</p>";
    const paused = pauseResponse(fake, { body: text, base64Encoded: false });
    await answerResponse(session, paused, LIMITS);
    const sent = fake.requests[0]?.fulfilled?.body;
    expect(sent).toBe(Buffer.from(text, "utf8").toString("base64"));
    expect(Buffer.from(sent ?? "", "base64").toString("utf8")).toBe(text);
  });

  it("re-serves an empty body", async () => {
    const { fake, session } = await open();
    const paused = pauseResponse(fake, { body: "", base64Encoded: false });
    await expect(answerResponse(session, paused, LIMITS)).resolves.toEqual({ allowed: true });
    expect(fake.requests[0]?.fulfilled?.body).toBe("");
  });

  it("never sends continueResponse, in any branch", async () => {
    const { fake, session } = await open();
    await answerResponse(session, pauseResponse(fake, { status: 302 }), LIMITS);
    await answerResponse(session, pauseResponse(fake, { errorReason: "Failed" }), LIMITS);
    await answerResponse(session, pauseResponse(fake, { resourceType: "Image" }), LIMITS);
    await answerResponse(session, pauseResponse(fake, { body: "x" }), LIMITS);
    await answerResponse(session, pauseResponse(fake, { headers: [{ name: "Content-Length", value: "5000" }] }), LIMITS);
    fake.script("Fetch.getResponseBody", new Error("gone"));
    await answerResponse(session, pauseResponse(fake, { body: "x" }), LIMITS);
    expect(fake.callsOf("Fetch.continueResponse")).toHaveLength(0);
  });

  it("refuses a rewrite response that has no status code, and sends no answer", async () => {
    const { fake, session } = await open();
    const paused = pauseResponse(fake, { body: "x" });
    delete paused.responseStatusCode;
    await expect(answerResponse(session, paused, LIMITS)).resolves.toEqual({
      allowed: false,
      reason: "response-rewrite-failed",
    });
    expect(fake.callsOf("Fetch.fulfillRequest")).toHaveLength(0);
    expect(fake.requests[0]?.state).toBe("pending");
  });
});

describe("answerResponse: size limits", () => {
  it.each(["Content-Length", "content-length", "CONTENT-LENGTH"])(
    "refuses with response-too-large when %s is above the cap, before it reads the body",
    async (name) => {
      const { fake, session } = await open();
      const paused = pauseResponse(fake, { headers: [...HTML_HEADERS, { name, value: String(LIMITS.maxBodyBytes + 1) }] });
      await expect(answerResponse(session, paused, LIMITS)).resolves.toEqual({
        allowed: false,
        reason: "response-too-large",
      });
      expect(fake.callsOf("Fetch.getResponseBody")).toHaveLength(0);
      expect(fake.callsOf("Fetch.fulfillRequest")).toHaveLength(0);
      expect(fake.callsOf("Fetch.continueRequest")).toHaveLength(0);
      expect(fake.requests[0]?.state).toBe("pending");
    },
  );

  it("accepts a Content-Length at the cap", async () => {
    const { fake, session } = await open();
    const paused = pauseResponse(fake, {
      headers: [{ name: "Content-Length", value: String(LIMITS.maxBodyBytes) }],
      body: b64("x"),
      base64Encoded: true,
    });
    await expect(answerResponse(session, paused, LIMITS)).resolves.toEqual({ allowed: true });
  });

  it("ignores a Content-Length that is not a number and checks the body instead", async () => {
    const { fake, session } = await open();
    const paused = pauseResponse(fake, {
      headers: [{ name: "Content-Length", value: "lots" }],
      body: b64("x".repeat(LIMITS.maxBodyBytes + 1)),
      base64Encoded: true,
    });
    await expect(answerResponse(session, paused, LIMITS)).resolves.toEqual({
      allowed: false,
      reason: "response-too-large",
    });
    expect(fake.callsOf("Fetch.getResponseBody")).toHaveLength(1);
  });

  it("refuses a base64 body whose decoded size is above the cap, and accepts one at the cap", async () => {
    const { fake, session } = await open();
    const over = pauseResponse(fake, { body: b64("a".repeat(LIMITS.maxBodyBytes + 1)), base64Encoded: true });
    const at = pauseResponse(fake, { body: b64("a".repeat(LIMITS.maxBodyBytes)), base64Encoded: true });
    await expect(answerResponse(session, over, LIMITS)).resolves.toEqual({ allowed: false, reason: "response-too-large" });
    await expect(answerResponse(session, at, LIMITS)).resolves.toEqual({ allowed: true });
    expect(fake.requests[0]?.state).toBe("pending");
    expect(fake.requests[1]?.state).toBe("fulfilled");
  });

  it("counts a body that is not base64 in UTF-8 bytes, not characters", async () => {
    const { fake, session } = await open();
    // 400 characters of 3 bytes each: 1,200 bytes against a cap of 1,000.
    const wide = pauseResponse(fake, { body: "\u2603".repeat(400), base64Encoded: false });
    // 333 characters of 3 bytes each: 999 bytes.
    const fits = pauseResponse(fake, { body: "\u2603".repeat(333), base64Encoded: false });
    await expect(answerResponse(session, wide, LIMITS)).resolves.toEqual({ allowed: false, reason: "response-too-large" });
    await expect(answerResponse(session, fits, LIMITS)).resolves.toEqual({ allowed: true });
  });

  it("never passes a response that is too large on unrewritten", async () => {
    const { fake, session } = await open();
    await answerResponse(session, pauseResponse(fake, { body: "x".repeat(5_000) }), LIMITS);
    expect(fake.callsOf("Fetch.continueRequest")).toHaveLength(0);
    expect(fake.callsOf("Fetch.continueResponse")).toHaveLength(0);
    expect(fake.requests[0]?.state).toBe("pending");
  });
});

describe("answerResponse: failures", () => {
  it("refuses with response-rewrite-failed when the body read rejects", async () => {
    const { fake, session } = await open();
    fake.script("Fetch.getResponseBody", new Error("No resource with given identifier"));
    const paused = pauseResponse(fake, { body: "x" });
    await expect(answerResponse(session, paused, LIMITS)).resolves.toEqual({
      allowed: false,
      reason: "response-rewrite-failed",
    });
    expect(fake.callsOf("Fetch.fulfillRequest")).toHaveLength(0);
  });

  it("refuses with response-rewrite-failed when the fulfil rejects", async () => {
    const { fake, session } = await open();
    fake.script("Fetch.fulfillRequest", new Error("Invalid InterceptionId"));
    const paused = pauseResponse(fake, { body: "x" });
    await expect(answerResponse(session, paused, LIMITS)).resolves.toEqual({
      allowed: false,
      reason: "response-rewrite-failed",
    });
  });

  it("refuses with response-rewrite-failed when the body read answers something unusable", async () => {
    const { fake, session } = await open();
    fake.script("Fetch.getResponseBody", { base64Encoded: true });
    const paused = pauseResponse(fake, { body: "x" });
    await expect(answerResponse(session, paused, LIMITS)).resolves.toEqual({
      allowed: false,
      reason: "response-rewrite-failed",
    });
  });
});

describe("response stage through the guard", () => {
  const options = (clock = createManualClock()) => ({
    clock,
    mainFrameId: DEFAULT_MAIN_FRAME_ID,
    onLost: () => {},
    hardening: LIMITS,
    heartbeat: { intervalMs: 1_000_000_000, timeoutMs: 1_000_000_000 },
  });

  function createPolicy(): RequestPolicy & { events: RequestGuardEvent[]; syntaxCalls: string[] } {
    const policy = {
      events: [] as RequestGuardEvent[],
      syntaxCalls: [] as string[],
      checkSyntax(url: string) {
        policy.syntaxCalls.push(url);
        return { allowed: true as const };
      },
      async checkHost() {
        return { allowed: true as const };
      },
      report(event: RequestGuardEvent) {
        policy.events.push(event);
      },
    };
    return policy;
  }

  async function install(opts = options()) {
    const fake = createFakeGuardBrowser();
    fakes.push(fake);
    const policy = createPolicy();
    await installBrowserGuard(fake, policy, opts);
    return { fake, policy, clock: opts.clock };
  }

  function emit(fake: FakeGuardBrowser, init: Partial<PausedInit> & { response: PausedResponseInit }) {
    return fake.emitPaused({ url: "https://shop.example/", requestId: "r1", ...init });
  }

  it("fulfils a Document response with the hardened answer and reports nothing", async () => {
    const { fake, policy } = await install();
    await emit(fake, { response: { headers: HTML_HEADERS, body: "<p>x</p>" } }).handled;
    expect(fake.requests[0]?.state).toBe("fulfilled");
    expect(fake.requests[0]?.fulfilled?.responseHeaders).toEqual([...HTML_HEADERS, CSP]);
    expect(policy.events).toEqual([]);
    expect(fake.callsOf("Fetch.continueResponse")).toHaveLength(0);
  });

  it("does not run the request-stage policy for a response-stage event", async () => {
    const { fake, policy } = await install();
    await emit(fake, { response: { status: 302 } }).handled;
    expect(policy.syntaxCalls).toEqual([]);
    expect(fake.requests[0]?.state).toBe("continued");
  });

  it("reports and fails a response that is too large", async () => {
    const { fake, policy } = await install();
    await emit(fake, { response: { headers: [{ name: "Content-Length", value: "5000" }] } }).handled;
    expect(fake.requests[0]?.state).toBe("failed");
    expect(fake.requests[0]?.errorReason).toBe("BlockedByClient");
    expect(policy.events).toEqual([{ kind: "request-blocked", reason: "response-too-large", mainFrame: true }]);
  });

  it("reports and fails a response whose body read rejects", async () => {
    const { fake, policy } = await install();
    fake.script("Fetch.getResponseBody", new Error("gone"));
    await emit(fake, { response: { body: "x" } }).handled;
    expect(fake.requests[0]?.state).toBe("failed");
    expect(policy.events).toEqual([{ kind: "request-blocked", reason: "response-rewrite-failed", mainFrame: true }]);
  });

  it("refuses a response whose answer is not ready within the decision timeout", async () => {
    const { fake, policy, clock } = await install();
    fake.script("Fetch.getResponseBody", "hang");
    const handle = emit(fake, { response: { body: "x" } });
    await flush();
    expect(fake.callsOf("Fetch.failRequest")).toHaveLength(0);
    clock.advance(GUARD_DECISION_TIMEOUT_MS - 1);
    await flush();
    expect(fake.callsOf("Fetch.failRequest")).toHaveLength(0);
    clock.advance(1);
    await handle.handled;
    expect(fake.requests[0]?.state).toBe("failed");
    expect(policy.events).toEqual([{ kind: "request-blocked", reason: "response-rewrite-failed", mainFrame: true }]);
    expect(clock.pendingTimers).toBe(1); // only the heartbeat tick is left
  });

  it("refuses a response whose fulfil never settles, at the decision timeout", async () => {
    const { fake, policy, clock } = await install();
    fake.script("Fetch.fulfillRequest", "hang");
    const handle = emit(fake, { response: { body: "x" } });
    await flush();
    clock.advance(GUARD_DECISION_TIMEOUT_MS);
    await handle.handled;
    expect(policy.events).toEqual([{ kind: "request-blocked", reason: "response-rewrite-failed", mainFrame: true }]);
    expect(fake.callsOf("Fetch.failRequest")).toHaveLength(1);
  });

  it("fails a response quietly, without a report, when the continue of a redirect rejects", async () => {
    const { fake, policy } = await install();
    let first = true;
    fake.script("Fetch.continueRequest", () => {
      if (!first) return undefined;
      first = false;
      return new Error("request is gone");
    });
    await emit(fake, { response: { status: 301 } }).handled;
    expect(fake.requests[0]?.state).toBe("failed");
    expect(policy.events).toEqual([]);
    expect(fake.handlerErrors).toEqual([]);
  });

  it("sends failRequest once more when the first failRequest of a refused response rejects", async () => {
    const { fake } = await install();
    let first = true;
    fake.script("Fetch.failRequest", () => {
      if (!first) return undefined;
      first = false;
      return new Error("transient");
    });
    await emit(fake, { response: { headers: [{ name: "Content-Length", value: "5000" }] } }).handled;
    expect(fake.callsOf("Fetch.failRequest")).toHaveLength(2);
    expect(fake.requests[0]?.state).toBe("failed");
  });

  it("flags only a Document of the main frame as a main-frame refusal", async () => {
    const { fake, policy } = await install();
    const big = { headers: [{ name: "Content-Length", value: "5000" }] };
    await emit(fake, { requestId: "a", response: big }).handled;
    await emit(fake, { requestId: "b", frameId: "CHILD", response: big }).handled;
    await emit(fake, {
      requestId: "c",
      resourceType: "Other",
      response: { headers: [{ name: "Content-Type", value: "text/javascript" }, { name: "Content-Length", value: "5000" }] },
    }).handled;
    expect(policy.events.map((event) => (event.kind === "request-blocked" ? event.mainFrame : null))).toEqual([
      true,
      false,
      false,
    ]);
  });

  it("continues a response-stage event when hardening is off, without reading its body", async () => {
    const fake = createFakeGuardBrowser();
    fakes.push(fake);
    const base = options();
    await installBrowserGuard(fake, createPolicy(), {
      clock: base.clock,
      mainFrameId: base.mainFrameId,
      onLost: base.onLost,
      heartbeat: base.heartbeat,
    });
    await emit(fake, { response: { body: "x" } }).handled;
    expect(fake.requests[0]?.state).toBe("continued");
    expect(fake.callsOf("Fetch.getResponseBody")).toHaveLength(0);
  });
});
