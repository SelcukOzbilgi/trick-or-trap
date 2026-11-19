import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { installBrowserGuard, type BrowserGuardOptions } from "@/lib/capture/browser-guard";
import {
  GUARD_DECISION_TIMEOUT_MS,
  GUARD_HEARTBEAT_INTERVAL_MS,
  GUARD_HEARTBEAT_TIMEOUT_MS,
  MAX_LOOKUP_HOSTS,
  MAX_REQUEST_HOSTS,
} from "@/lib/capture/constants";
import type {
  GuardBrowser,
  GuardLossCause,
  GuardVerdict,
  RequestGuardEvent,
  RequestPolicy,
} from "@/lib/capture/guard-types";
import {
  createFakeGuardBrowser,
  DEFAULT_MAIN_FRAME_ID,
  type FakeGuardBrowser,
  type FakeRequest,
  type PausedInit,
} from "./helpers/fake-guard-browser";
import { createManualClock, type ManualClock } from "./helpers/manual-clock";

const PATTERNS = { patterns: [{ urlPattern: "*", requestStage: "Request" }] };
/** A heartbeat that never fires within a test, for the cases that are not about the heartbeat. */
const QUIET_HEARTBEAT = { intervalMs: 1_000_000_000, timeoutMs: 1_000_000_000 };

type TestPolicy = RequestPolicy & {
  events: RequestGuardEvent[];
  syntaxCalls: string[];
  hostCalls: string[];
  /** Overrides the host check. Return a promise that never settles, or reject, to test those paths. */
  hostCheck?: (url: string) => Promise<GuardVerdict>;
};

/** A policy that refuses "10.0.0.1" at the DNS step and "badsyntax" at the syntax step. */
function createPolicy(): TestPolicy {
  const policy: TestPolicy = {
    events: [],
    syntaxCalls: [],
    hostCalls: [],
    checkSyntax(url) {
      policy.syntaxCalls.push(url);
      return url.includes("badsyntax") ? { allowed: false, reason: "url-port-blocked" } : { allowed: true };
    },
    async checkHost(url) {
      policy.hostCalls.push(url);
      if (policy.hostCheck) return policy.hostCheck(url);
      return url.includes("10.0.0.1") ? { allowed: false, reason: "url-address-blocked" } : { allowed: true };
    },
    report(event) {
      policy.events.push(event);
    },
  };
  return policy;
}

const fakes: FakeGuardBrowser[] = [];

afterEach(() => {
  const open = fakes.splice(0);
  for (const fake of open) fake.assertNoViolations();
});

type Setup = {
  fake: FakeGuardBrowser;
  policy: TestPolicy;
  clock: ManualClock;
  lost: GuardLossCause[];
  /** Calls the handler the guard registered with `onDisconnected`, without a session close. */
  disconnect(): void;
  stopWatching(): void;
  /** Timers pending right after the install (the heartbeat tick). */
  baseTimers: number;
};

type SetupOptions = Partial<Omit<BrowserGuardOptions, "clock" | "onLost">>;

async function setup(options: SetupOptions = {}): Promise<Setup> {
  const fake = createFakeGuardBrowser();
  fakes.push(fake);
  const policy = createPolicy();
  const clock = createManualClock();
  const lost: GuardLossCause[] = [];
  let disconnectedHandler: (() => void) | undefined;
  const browser: GuardBrowser = {
    openGuardSession: () => fake.openGuardSession(),
    onDisconnected(handler) {
      disconnectedHandler = handler;
      fake.onDisconnected(handler);
    },
  };
  const guard = await installBrowserGuard(browser, policy, {
    clock,
    mainFrameId: DEFAULT_MAIN_FRAME_ID,
    onLost: (cause) => lost.push(cause),
    heartbeat: QUIET_HEARTBEAT,
    ...options,
  });
  return {
    fake,
    policy,
    clock,
    lost,
    disconnect: () => disconnectedHandler?.(),
    stopWatching: () => guard.stopWatching(),
    baseTimers: clock.pendingTimers,
  };
}

/** Emits one paused request with a readable id and waits until the guard has answered it. */
async function paused(fake: FakeGuardBrowser, requestId: string, url: string, init: Omit<PausedInit, "url" | "requestId"> = {}) {
  await fake.emitPaused({ url, requestId, ...init }).handled;
}

function request(fake: FakeGuardBrowser, requestId: string): FakeRequest {
  const found = fake.requests.find((candidate) => candidate.requestId === requestId);
  if (!found) throw new Error(`No request ${requestId}`);
  return found;
}

/** Lets promise callbacks that need no timer run. */
function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

async function settledState(promise: Promise<unknown>): Promise<"pending" | "resolved" | "rejected"> {
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

describe("installBrowserGuard setup", () => {
  it("registers the event, close and disconnected handlers before the first command", async () => {
    const { fake } = await setup();
    expect(fake.handlersAtFirstSend).toEqual({ event: 1, close: 1, disconnected: 1 });
  });

  it("opens one session and sends exactly one Fetch.enable with the request-stage pattern", async () => {
    const { fake } = await setup();
    expect(fake.openCalls).toBe(1);
    expect(fake.callsOf("Fetch.enable")).toHaveLength(1);
    expect(fake.callsOf("Fetch.enable")[0]?.params).toEqual(PATTERNS);
    expect(fake.calls.map((call) => call.method)).toEqual(["Fetch.enable"]);
  });

  it("stays pending while Fetch.enable has not resolved, and starts no heartbeat", async () => {
    const fake = createFakeGuardBrowser();
    fakes.push(fake);
    fake.script("Fetch.enable", "hang");
    const clock = createManualClock();
    const install = installBrowserGuard(fake, createPolicy(), {
      clock,
      mainFrameId: DEFAULT_MAIN_FRAME_ID,
      onLost: () => {},
    });
    expect(await settledState(install)).toBe("pending");
    expect(clock.pendingTimers).toBe(0);
  });

  it("resolves once Fetch.enable has resolved", async () => {
    const fake = createFakeGuardBrowser();
    fakes.push(fake);
    const install = installBrowserGuard(fake, createPolicy(), {
      clock: createManualClock(),
      mainFrameId: DEFAULT_MAIN_FRAME_ID,
      onLost: () => {},
    });
    expect(await settledState(install)).toBe("resolved");
  });

  it("rejects when opening the guard session rejects, and sends nothing", async () => {
    const fake = createFakeGuardBrowser();
    fakes.push(fake);
    fake.scriptOpen(new Error("no browser session"));
    await expect(
      installBrowserGuard(fake, createPolicy(), {
        clock: createManualClock(),
        mainFrameId: DEFAULT_MAIN_FRAME_ID,
        onLost: () => {},
      }),
    ).rejects.toThrow("no browser session");
    expect(fake.calls).toHaveLength(0);
  });

  it("rejects when Fetch.enable rejects", async () => {
    const fake = createFakeGuardBrowser();
    fakes.push(fake);
    fake.script("Fetch.enable", new Error("refused by browser"));
    await expect(
      installBrowserGuard(fake, createPolicy(), {
        clock: createManualClock(),
        mainFrameId: DEFAULT_MAIN_FRAME_ID,
        onLost: () => {},
      }),
    ).rejects.toThrow("refused by browser");
  });
});

describe("verdicts for paused requests", () => {
  it("continues an allowed request without changing it", async () => {
    const { fake, policy } = await setup();
    await paused(fake, "r1", "https://shop.example/");
    expect(request(fake, "r1").state).toBe("continued");
    expect(fake.callsOf("Fetch.continueRequest")[0]?.params).toEqual({ requestId: "r1" });
    expect(fake.callsOf("Fetch.failRequest")).toHaveLength(0);
    expect(policy.events).toEqual([]);
  });

  it("fails a redirect hop to a blocked address in the same event turn, with no timer advanced", async () => {
    const { fake, policy, clock, baseTimers } = await setup();
    await paused(fake, "r1", "https://shop.example/");
    await paused(fake, "r2", "http://10.0.0.1/", { redirectedRequestId: "r1" });
    expect(request(fake, "r2").state).toBe("failed");
    expect(request(fake, "r2").errorReason).toBe("BlockedByClient");
    expect(fake.callsOf("Fetch.failRequest")[0]?.params).toEqual({ requestId: "r2", errorReason: "BlockedByClient" });
    expect(policy.events).toEqual([{ kind: "request-blocked", reason: "url-address-blocked", mainFrame: true }]);
    expect(clock.pendingTimers).toBe(baseTimers);
  });

  it("reports the refusal before it sends the failure", async () => {
    const { fake, policy } = await setup();
    const order: string[] = [];
    policy.report = () => {
      order.push("report");
    };
    fake.script("Fetch.failRequest", () => {
      order.push("fail");
      return undefined;
    });
    await paused(fake, "r1", "http://10.0.0.1/");
    expect(order).toEqual(["report", "fail"]);
  });

  it("fails a request whose syntax check refuses it, without a DNS check", async () => {
    const { fake, policy } = await setup();
    await paused(fake, "r1", "https://badsyntax.example/");
    expect(request(fake, "r1").state).toBe("failed");
    expect(policy.syntaxCalls).toEqual(["https://badsyntax.example/"]);
    expect(policy.hostCalls).toEqual([]);
    expect(policy.events).toEqual([{ kind: "request-blocked", reason: "url-port-blocked", mainFrame: true }]);
  });

  it("decides a request that has redirectedRequestId like any other request", async () => {
    const { fake, policy } = await setup();
    await paused(fake, "r2", "https://shop.example/next", { redirectedRequestId: "r1", resourceType: "Image" });
    expect(request(fake, "r2").state).toBe("continued");
    expect(policy.hostCalls).toEqual(["https://shop.example/next"]);
  });

  it.each(["data:text/plain,hello", "blob:https://shop.example/1234", "about:blank"])(
    "continues %s without calling the policy",
    async (url) => {
      const { fake, policy } = await setup();
      await paused(fake, "r1", url, { resourceType: "Image" });
      expect(request(fake, "r1").state).toBe("continued");
      expect(policy.syntaxCalls).toEqual([]);
      expect(policy.hostCalls).toEqual([]);
      expect(policy.events).toEqual([]);
    },
  );

  it("refuses an ftp: URL with url-scheme-blocked", async () => {
    const { fake, policy } = await setup();
    await paused(fake, "r1", "ftp://shop.example/file", { resourceType: "Image" });
    expect(request(fake, "r1").state).toBe("failed");
    expect(policy.events).toEqual([{ kind: "request-blocked", reason: "url-scheme-blocked", mainFrame: false }]);
  });

  it("refuses a URL that cannot be parsed", async () => {
    const { fake, policy } = await setup();
    await paused(fake, "r1", "not a url", { resourceType: "Image" });
    expect(request(fake, "r1").state).toBe("failed");
    expect(policy.events).toEqual([{ kind: "request-blocked", reason: "url-invalid", mainFrame: false }]);
  });

  it("fails a paused request that has no URL and does not throw", async () => {
    const { fake, policy } = await setup();
    await fake.emitEvent("Fetch.requestPaused", { requestId: "ghost", resourceType: "Image" });
    expect(fake.callsOf("Fetch.failRequest").map((call) => (call.params as { requestId: string }).requestId)).toContain(
      "ghost",
    );
    expect(policy.events).toEqual([{ kind: "request-blocked", reason: "url-invalid", mainFrame: false }]);
    expect(fake.handlerErrors).toEqual([]);
  });

  it("ignores events of other methods and paused events without a usable request id", async () => {
    const { fake, policy } = await setup();
    const before = fake.calls.length;
    await fake.emitEvent("Network.requestWillBeSent", { requestId: "r1", request: { url: "https://shop.example/" } });
    await fake.emitEvent("Fetch.requestPaused", { request: { url: "https://shop.example/" } });
    await fake.emitEvent("Fetch.requestPaused", { requestId: 42, request: { url: "https://shop.example/" } });
    await fake.emitEvent("Fetch.requestPaused", "not an object");
    await fake.emitEvent("Fetch.requestPaused", null);
    expect(fake.calls.length).toBe(before);
    expect(policy.events).toEqual([]);
    expect(fake.handlerErrors).toEqual([]);
  });

  it("sends no Target, Runtime or Network command", async () => {
    const { fake, clock } = await setup({ heartbeat: undefined });
    await paused(fake, "r1", "https://shop.example/");
    await paused(fake, "r2", "http://10.0.0.1/");
    clock.advance(GUARD_HEARTBEAT_INTERVAL_MS);
    await flush();
    const methods = fake.calls.map((call) => call.method);
    expect(methods.length).toBeGreaterThan(3);
    expect(methods.filter((method) => /^(Target|Runtime|Network)\./.test(method))).toEqual([]);
  });
});

describe("main-frame flag", () => {
  it("is true only for a Document of the main frame", async () => {
    const { fake, policy } = await setup();
    await paused(fake, "r1", "http://10.0.0.1/a");
    await paused(fake, "r2", "http://10.0.0.1/b", { frameId: "CHILD" });
    await paused(fake, "r3", "http://10.0.0.1/c", { resourceType: "Script" });
    expect(policy.events.map((event) => (event.kind === "request-blocked" ? event.mainFrame : null))).toEqual([
      true,
      false,
      false,
    ]);
  });

  it("is false for a worker request that carries the main frame id", async () => {
    const { fake, policy } = await setup();
    await paused(fake, "r1", "http://10.0.0.1/worker-fetch", {
      resourceType: "Fetch",
      frameId: DEFAULT_MAIN_FRAME_ID,
      source: "worker",
    });
    await paused(fake, "r2", "http://10.0.0.1/worker-script", {
      resourceType: "Other",
      frameId: DEFAULT_MAIN_FRAME_ID,
      source: "worker",
    });
    expect(policy.events).toEqual([
      { kind: "request-blocked", reason: "url-address-blocked", mainFrame: false },
      { kind: "request-blocked", reason: "url-address-blocked", mainFrame: false },
    ]);
  });

  it("uses the main frame id of the options", async () => {
    const { fake, policy } = await setup({ mainFrameId: "FRAME-7" });
    await paused(fake, "r1", "http://10.0.0.1/a", { frameId: "FRAME-7" });
    await paused(fake, "r2", "http://10.0.0.1/b", { frameId: DEFAULT_MAIN_FRAME_ID });
    expect(policy.events).toEqual([
      { kind: "request-blocked", reason: "url-address-blocked", mainFrame: true },
      { kind: "request-blocked", reason: "url-address-blocked", mainFrame: false },
    ]);
  });
});

describe("answer failures", () => {
  it("fails a request with BlockedByClient when continueRequest rejects", async () => {
    const { fake } = await setup();
    fake.script("Fetch.continueRequest", new Error("request is gone"));
    await paused(fake, "r1", "https://shop.example/");
    expect(request(fake, "r1").state).toBe("failed");
    expect(request(fake, "r1").errorReason).toBe("BlockedByClient");
    expect(fake.handlerErrors).toEqual([]);
  });

  it("sends failRequest once more when the first failRequest rejects", async () => {
    const { fake } = await setup();
    let first = true;
    fake.script("Fetch.failRequest", () => {
      if (!first) return undefined;
      first = false;
      return new Error("transient");
    });
    await paused(fake, "r1", "http://10.0.0.1/");
    expect(fake.callsOf("Fetch.failRequest")).toHaveLength(2);
    expect(request(fake, "r1").state).toBe("failed");
  });

  it("ignores a failing fallback", async () => {
    const { fake } = await setup();
    fake.script("Fetch.continueRequest", new Error("request is gone"));
    fake.script("Fetch.failRequest", new Error("request is gone"));
    await paused(fake, "r1", "https://shop.example/");
    await paused(fake, "r2", "http://10.0.0.1/");
    expect(fake.callsOf("Fetch.failRequest")).toHaveLength(3);
    expect(fake.handlerErrors).toEqual([]);
  });
});

describe("service-worker scripts", () => {
  it.each(["Service-Worker", "service-worker", "SERVICE-WORKER", "sErViCe-WoRkEr"])(
    "refuses a request with the header %s: script, without calling the policy",
    async (name) => {
      const { fake, policy } = await setup();
      await paused(fake, "r1", "https://shop.example/sw.js", { resourceType: "Other", headers: { [name]: "script" } });
      expect(request(fake, "r1").state).toBe("failed");
      expect(request(fake, "r1").errorReason).toBe("BlockedByClient");
      expect(policy.syntaxCalls).toEqual([]);
      expect(policy.hostCalls).toEqual([]);
      expect(policy.events).toEqual([{ kind: "request-blocked", reason: "service-worker-blocked", mainFrame: false }]);
    },
  );

  it("decides a request with another Service-Worker value by the normal rules", async () => {
    const { fake, policy } = await setup();
    await paused(fake, "r1", "https://shop.example/x.js", { resourceType: "Script", headers: { "Service-Worker": "other" } });
    expect(request(fake, "r1").state).toBe("continued");
    expect(policy.syntaxCalls).toEqual(["https://shop.example/x.js"]);
    expect(policy.hostCalls).toEqual(["https://shop.example/x.js"]);
    expect(policy.events).toEqual([]);
  });

  it("refuses a service-worker script before it looks at the URL", async () => {
    const { fake, policy } = await setup();
    await paused(fake, "r1", "not a url", { resourceType: "Other", headers: { "Service-Worker": "script" } });
    expect(policy.events).toEqual([{ kind: "request-blocked", reason: "service-worker-blocked", mainFrame: false }]);
  });
});

describe("host seen-set and host limit", () => {
  it("checks the host of a new sub-resource once and does not refuse a repeat", async () => {
    const { fake, policy } = await setup({ maxHosts: 1 });
    await paused(fake, "r1", "https://a.example/1.png", { resourceType: "Image" });
    expect(policy.hostCalls).toEqual(["https://a.example/1.png"]);
    await paused(fake, "r2", "https://a.example/2.png", { resourceType: "Image" });
    expect(request(fake, "r2").state).toBe("continued");
    expect(policy.events).toEqual([]);
  });

  it("refuses the 101st distinct non-document host with host-limit-reached and reports the limit once", async () => {
    const { fake, policy } = await setup();
    for (let i = 0; i < MAX_REQUEST_HOSTS; i += 1) {
      await paused(fake, `ok-${i}`, `https://h${i}.example/x.png`, { resourceType: "Image" });
    }
    expect(fake.callsOf("Fetch.failRequest")).toHaveLength(0);
    await paused(fake, "over-1", "https://extra1.example/x.png", { resourceType: "Image" });
    await paused(fake, "over-2", "https://extra2.example/x.png", { resourceType: "Image" });
    expect(request(fake, "over-1").state).toBe("failed");
    expect(request(fake, "over-2").state).toBe("failed");
    expect(policy.events.filter((event) => event.kind === "request-host-limit")).toHaveLength(1);
    expect(
      policy.events.filter((event) => event.kind === "request-blocked").map((event) => event.kind === "request-blocked" && event.reason),
    ).toEqual(["host-limit-reached", "host-limit-reached"]);
    expect(policy.hostCalls).not.toContain("https://extra1.example/x.png");
    // A host seen before the limit is still allowed.
    await paused(fake, "again", "https://h0.example/y.png", { resourceType: "Image" });
    expect(request(fake, "again").state).toBe("continued");
  });

  it("reports the limit before the refused request", async () => {
    const { fake, policy } = await setup({ maxHosts: 1 });
    await paused(fake, "r1", "https://a.example/1.png", { resourceType: "Image" });
    await paused(fake, "r2", "https://b.example/1.png", { resourceType: "Image" });
    expect(policy.events).toEqual([
      { kind: "request-host-limit" },
      { kind: "request-blocked", reason: "host-limit-reached", mainFrame: false },
    ]);
  });

  it("does not refuse a document request for the non-document limit", async () => {
    const { fake, policy } = await setup({ maxHosts: 1 });
    await paused(fake, "r1", "https://a.example/1.png", { resourceType: "Image" });
    await paused(fake, "r2", "https://b.example/", { frameId: "CHILD" });
    await paused(fake, "r3", "https://c.example/");
    expect(request(fake, "r2").state).toBe("continued");
    expect(request(fake, "r3").state).toBe("continued");
    expect(policy.events).toEqual([]);
  });

  it("counts the host of a document request as seen", async () => {
    const { fake, policy } = await setup({ maxHosts: 1 });
    await paused(fake, "r1", "https://a.example/");
    await paused(fake, "r2", "https://a.example/1.png", { resourceType: "Image" });
    await paused(fake, "r3", "https://b.example/1.png", { resourceType: "Image" });
    expect(request(fake, "r2").state).toBe("continued");
    expect(request(fake, "r3").state).toBe("failed");
    expect(policy.events.some((event) => event.kind === "request-host-limit")).toBe(true);
  });

  it("applies the limit to requests that are paused at the same time", async () => {
    const { fake } = await setup({ maxHosts: 2 });
    await Promise.all(
      [1, 2, 3, 4].map(
        (n) => fake.emitPaused({ requestId: `r${n}`, url: `https://h${n}.example/x.png`, resourceType: "Image" }).handled,
      ),
    );
    expect(fake.callsOf("Fetch.continueRequest")).toHaveLength(2);
    expect(fake.callsOf("Fetch.failRequest")).toHaveLength(2);
  });

  it("refuses the 301st distinct document host with host-limit-reached and reports the limit once", async () => {
    const { fake, policy } = await setup();
    expect(MAX_LOOKUP_HOSTS).toBe(300);
    for (let i = 0; i < MAX_LOOKUP_HOSTS; i += 1) {
      await paused(fake, `doc-${i}`, `https://d${i}.example/`, { frameId: "CHILD" });
    }
    expect(fake.callsOf("Fetch.failRequest")).toHaveLength(0);
    await paused(fake, "over-1", "https://extra1.example/");
    await paused(fake, "over-2", "https://extra2.example/", { frameId: "CHILD" });
    expect(request(fake, "over-1").state).toBe("failed");
    expect(request(fake, "over-2").state).toBe("failed");
    expect(policy.events.filter((event) => event.kind === "request-host-limit")).toHaveLength(1);
    expect(policy.events.filter((event) => event.kind === "request-blocked")).toEqual([
      { kind: "request-blocked", reason: "host-limit-reached", mainFrame: true },
      { kind: "request-blocked", reason: "host-limit-reached", mainFrame: false },
    ]);
    expect(policy.hostCalls).not.toContain("https://extra1.example/");
    // A host seen before the limit is still allowed.
    await paused(fake, "again", "https://d0.example/next", { frameId: "CHILD" });
    expect(request(fake, "again").state).toBe("continued");
  });

  it("applies 100 hosts to non-documents and 300 to documents, with one request-host-limit report", async () => {
    const { fake, policy } = await setup();
    for (let i = 0; i < MAX_REQUEST_HOSTS; i += 1) {
      await paused(fake, `img-${i}`, `https://i${i}.example/x.png`, { resourceType: "Image" });
    }
    // 100 hosts are seen: a new non-document host is refused, a new document host is not.
    await paused(fake, "img-over", "https://more.example/x.png", { resourceType: "Image" });
    expect(request(fake, "img-over").state).toBe("failed");
    await paused(fake, "doc-new", "https://doc-100.example/", { frameId: "CHILD" });
    expect(request(fake, "doc-new").state).toBe("continued");
    // The non-document limit stays reached; documents go on until 300 hosts are seen.
    for (let i = 1; i < MAX_LOOKUP_HOSTS - MAX_REQUEST_HOSTS; i += 1) {
      await paused(fake, `doc-${i}`, `https://doc-${100 + i}.example/`, { frameId: "CHILD" });
    }
    expect(fake.callsOf("Fetch.failRequest")).toHaveLength(1);
    await paused(fake, "doc-over", "https://doc-over.example/", { frameId: "CHILD" });
    expect(request(fake, "doc-over").state).toBe("failed");
    expect(policy.events.filter((event) => event.kind === "request-host-limit")).toHaveLength(1);
    expect(
      policy.events
        .filter((event) => event.kind === "request-blocked")
        .map((event) => (event.kind === "request-blocked" ? event.reason : null)),
    ).toEqual(["host-limit-reached", "host-limit-reached"]);
  });

  it("uses the lookup limit of the options for documents", async () => {
    const { fake, policy } = await setup({ maxLookupHosts: 2 });
    await paused(fake, "r1", "https://a.example/", { frameId: "CHILD" });
    await paused(fake, "r2", "https://b.example/", { frameId: "CHILD" });
    await paused(fake, "r3", "https://c.example/", { frameId: "CHILD" });
    expect(request(fake, "r2").state).toBe("continued");
    expect(request(fake, "r3").state).toBe("failed");
    expect(policy.events).toEqual([
      { kind: "request-host-limit" },
      { kind: "request-blocked", reason: "host-limit-reached", mainFrame: false },
    ]);
  });

  it("does not add a refused host, so the same host is refused again without a DNS check", async () => {
    const { fake, policy } = await setup({ maxHosts: 1 });
    await paused(fake, "r1", "https://a.example/1.png", { resourceType: "Image" });
    await paused(fake, "r2", "https://b.example/1.png", { resourceType: "Image" });
    await paused(fake, "r3", "https://b.example/2.png", { resourceType: "Image" });
    expect(request(fake, "r2").state).toBe("failed");
    expect(request(fake, "r3").state).toBe("failed");
    expect(policy.hostCalls).toEqual(["https://a.example/1.png"]);
    expect(policy.events.filter((event) => event.kind === "request-host-limit")).toHaveLength(1);
  });

  it("does not count a host that fails the syntax check", async () => {
    const { fake, policy } = await setup({ maxHosts: 1 });
    await paused(fake, "r1", "https://badsyntax.example/1.png", { resourceType: "Image" });
    await paused(fake, "r2", "https://a.example/1.png", { resourceType: "Image" });
    expect(request(fake, "r1").state).toBe("failed");
    expect(request(fake, "r2").state).toBe("continued");
    expect(policy.events.filter((event) => event.kind === "request-host-limit")).toHaveLength(0);
  });
});

describe("decision timeout and errors", () => {
  it("fails a request whose host check never settles, after GUARD_DECISION_TIMEOUT_MS", async () => {
    const { fake, policy, clock, baseTimers } = await setup();
    policy.hostCheck = () => new Promise<GuardVerdict>(() => {});
    const handle = fake.emitPaused({ requestId: "r1", url: "https://slow.example/" });
    await flush();
    expect(fake.callsOf("Fetch.failRequest")).toHaveLength(0);
    expect(clock.pendingTimers).toBe(baseTimers + 1);
    clock.advance(GUARD_DECISION_TIMEOUT_MS - 1);
    await flush();
    expect(fake.callsOf("Fetch.failRequest")).toHaveLength(0);
    clock.advance(1);
    await handle.handled;
    expect(fake.callsOf("Fetch.failRequest")[0]?.params).toEqual({ requestId: "r1", errorReason: "BlockedByClient" });
    expect(policy.events).toEqual([{ kind: "request-blocked", reason: "url-invalid", mainFrame: true }]);
    expect(clock.pendingTimers).toBe(baseTimers);
  });

  it("uses the decision timeout of the options", async () => {
    const { fake, policy, clock } = await setup({ decisionTimeoutMs: 50 });
    policy.hostCheck = () => new Promise<GuardVerdict>(() => {});
    const handle = fake.emitPaused({ requestId: "r1", url: "https://slow.example/" });
    await flush();
    clock.advance(50);
    await handle.handled;
    expect(request(fake, "r1").state).toBe("failed");
  });

  it("fails a request when the host check rejects", async () => {
    const { fake, policy } = await setup();
    policy.hostCheck = () => Promise.reject(new Error("resolver exploded"));
    await paused(fake, "r1", "https://shop.example/");
    expect(request(fake, "r1").state).toBe("failed");
    expect(policy.events).toEqual([{ kind: "request-blocked", reason: "url-invalid", mainFrame: true }]);
  });

  it("fails a request when the syntax check throws", async () => {
    const { fake, policy } = await setup();
    policy.checkSyntax = () => {
      throw new Error("syntax exploded");
    };
    await paused(fake, "r1", "https://shop.example/");
    expect(request(fake, "r1").state).toBe("failed");
    expect(fake.handlerErrors).toEqual([]);
  });

  it("does not leave a timer behind after a normal decision", async () => {
    const { fake, clock, baseTimers } = await setup();
    await paused(fake, "r1", "https://shop.example/");
    expect(clock.pendingTimers).toBe(baseTimers);
  });
});

describe("response-stage hardening", () => {
  const HARDENED_PATTERNS = {
    patterns: [
      { urlPattern: "*", requestStage: "Request" },
      { urlPattern: "*", resourceType: "Document", requestStage: "Response" },
      { urlPattern: "*", resourceType: "Other", requestStage: "Response" },
    ],
  };

  it("enables three patterns with hardening, in one Fetch.enable", async () => {
    const { fake } = await setup({ hardening: { maxBodyBytes: 1_000 } });
    expect(fake.callsOf("Fetch.enable")).toHaveLength(1);
    expect(fake.callsOf("Fetch.enable")[0]?.params).toEqual(HARDENED_PATTERNS);
  });

  it("enables only the request-stage pattern without hardening", async () => {
    const { fake } = await setup();
    expect(fake.callsOf("Fetch.enable")[0]?.params).toEqual(PATTERNS);
  });

  it("reports a refused main-frame document response with mainFrame true, and fails it", async () => {
    const { fake, policy } = await setup({ hardening: { maxBodyBytes: 10 } });
    await fake.emitPaused({
      requestId: "r1",
      url: "https://shop.example/",
      response: { headers: [{ name: "Content-Length", value: "11" }] },
    }).handled;
    expect(policy.events).toEqual([{ kind: "request-blocked", reason: "response-too-large", mainFrame: true }]);
    expect(request(fake, "r1").state).toBe("failed");
    expect(fake.callsOf("Fetch.failRequest")[0]?.params).toEqual({ requestId: "r1", errorReason: "BlockedByClient" });
  });

  it("reports response-too-large as request-blocked and sends failRequest for a sub-frame response", async () => {
    const { fake, policy } = await setup({ hardening: { maxBodyBytes: 10 } });
    await fake.emitPaused({
      requestId: "r1",
      url: "https://shop.example/frame",
      frameId: "CHILD",
      response: { headers: [{ name: "Content-Length", value: "11" }] },
    }).handled;
    expect(policy.events).toEqual([{ kind: "request-blocked", reason: "response-too-large", mainFrame: false }]);
    expect(request(fake, "r1").state).toBe("failed");
  });

  it("reports response-rewrite-failed as request-blocked and sends failRequest for a sub-frame response", async () => {
    const { fake, policy } = await setup({ hardening: { maxBodyBytes: 10 } });
    fake.script("Fetch.getResponseBody", new Error("gone"));
    await fake.emitPaused({
      requestId: "r1",
      url: "https://shop.example/frame",
      frameId: "CHILD",
      response: { body: "x" },
    }).handled;
    expect(policy.events).toEqual([{ kind: "request-blocked", reason: "response-rewrite-failed", mainFrame: false }]);
    expect(request(fake, "r1").state).toBe("failed");
  });

  it("answers an allowed response and reports nothing", async () => {
    const { fake, policy } = await setup({ hardening: { maxBodyBytes: 10 } });
    await fake.emitPaused({ requestId: "r1", url: "https://shop.example/", response: { body: "ok" } }).handled;
    expect(request(fake, "r1").state).toBe("fulfilled");
    expect(policy.events).toEqual([]);
  });

  it("still decides a request-stage event by the request rules when hardening is on", async () => {
    const { fake, policy } = await setup({ hardening: { maxBodyBytes: 10 } });
    await paused(fake, "r1", "http://10.0.0.1/");
    expect(request(fake, "r1").state).toBe("failed");
    expect(policy.events).toEqual([{ kind: "request-blocked", reason: "url-address-blocked", mainFrame: true }]);
  });
});

describe("residual-risk header of the guard module", () => {
  const source = readFileSync(join(process.cwd(), "lib/capture/browser-guard.ts"), "utf8");
  const header = source.slice(0, source.indexOf("\nimport "));

  it.each([
    ["states what is covered", ["Covered", "WebSocket", "service-worker", "iframe", "popup"]],
    ["lists what is not covered", ["WebTransport", "WebRTC", "preconnect", "DNS prefetch", "DNS rebinding"]],
    ["states the fail-open window and the proxy", ["fail-open", "customProxy", "egress"]],
    ["states the scope of WebSocket coverage", ["hardening is on", "Chrome 156"]],
    [
      "lists what is unverified",
      ["nested", "downloads", "keepalive", "module workers", "importScripts", "worklets", "vendor proxy"],
    ],
    ["names the verification states", ["live", "by reading", "untested"]],
  ])("%s", (_name, words) => {
    for (const word of words) expect(header).toContain(word);
  });
});

describe("guard loss", () => {
  it("reports session-closed once when the guard session closes", async () => {
    const { fake, lost } = await setup();
    fake.detach();
    await flush();
    expect(lost).toEqual(["session-closed"]);
  });

  it("reports disconnected once when the browser disconnects", async () => {
    const { disconnect, lost } = await setup();
    disconnect();
    disconnect();
    expect(lost).toEqual(["disconnected"]);
  });

  it("reports only once when close and disconnected both fire", async () => {
    const { fake, lost } = await setup();
    fake.dropConnection();
    await flush();
    expect(lost).toHaveLength(1);
  });

  it("does not throw out of a failing onLost handler", async () => {
    const fake = createFakeGuardBrowser();
    fakes.push(fake);
    await installBrowserGuard(fake, createPolicy(), {
      clock: createManualClock(),
      mainFrameId: DEFAULT_MAIN_FRAME_ID,
      heartbeat: QUIET_HEARTBEAT,
      onLost: () => {
        throw new Error("handler failed");
      },
    });
    fake.dropConnection();
    await flush();
    expect(fake.handlerErrors).toEqual([]);
  });

  it("reports nothing after stopWatching", async () => {
    const { fake, disconnect, stopWatching, lost } = await setup();
    stopWatching();
    fake.detach();
    disconnect();
    await flush();
    expect(lost).toEqual([]);
  });

  it("does not detach the session", async () => {
    const { fake, stopWatching } = await setup();
    stopWatching();
    expect(fake.pending()).toEqual([]);
    expect(fake.calls.map((call) => call.method)).toEqual(["Fetch.enable"]);
  });
});

describe("heartbeat", () => {
  it("sends Browser.getVersion on the guard session every interval", async () => {
    const { fake, clock, lost } = await setup({ heartbeat: undefined });
    expect(GUARD_HEARTBEAT_INTERVAL_MS).toBe(2_000);
    clock.advance(GUARD_HEARTBEAT_INTERVAL_MS - 1);
    expect(fake.callsOf("Browser.getVersion")).toHaveLength(0);
    clock.advance(1);
    await flush();
    expect(fake.callsOf("Browser.getVersion")).toHaveLength(1);
    clock.advance(GUARD_HEARTBEAT_INTERVAL_MS);
    await flush();
    clock.advance(GUARD_HEARTBEAT_INTERVAL_MS);
    await flush();
    expect(fake.callsOf("Browser.getVersion")).toHaveLength(3);
    expect(lost).toEqual([]);
  });

  it("treats a rejecting heartbeat as loss", async () => {
    const { fake, clock, lost } = await setup({ heartbeat: undefined });
    fake.script("Browser.getVersion", new Error("Target closed"));
    clock.advance(GUARD_HEARTBEAT_INTERVAL_MS);
    await flush();
    expect(lost).toEqual(["heartbeat"]);
  });

  it("treats a heartbeat with no answer after GUARD_HEARTBEAT_TIMEOUT_MS as loss", async () => {
    const { fake, clock, lost } = await setup({ heartbeat: undefined });
    fake.script("Browser.getVersion", "hang");
    clock.advance(GUARD_HEARTBEAT_INTERVAL_MS); // the heartbeat is sent at t = 2,000
    await flush();
    clock.advance(GUARD_HEARTBEAT_TIMEOUT_MS - 1);
    await flush();
    expect(lost).toEqual([]);
    clock.advance(1);
    await flush();
    expect(lost).toEqual(["heartbeat"]);
  });

  it("keeps one heartbeat in flight while an earlier one has no answer", async () => {
    const { fake, clock } = await setup({ heartbeat: undefined });
    fake.script("Browser.getVersion", "hang");
    clock.advance(GUARD_HEARTBEAT_INTERVAL_MS * 3); // ticks at 2,000, 4,000 and 6,000
    await flush();
    expect(fake.callsOf("Browser.getVersion")).toHaveLength(1);
  });

  it("sends no further heartbeat and holds no timer after stopWatching", async () => {
    const { fake, clock, stopWatching, lost } = await setup({ heartbeat: undefined });
    stopWatching();
    expect(clock.pendingTimers).toBe(0);
    clock.advance(GUARD_HEARTBEAT_INTERVAL_MS * 10);
    await flush();
    expect(fake.callsOf("Browser.getVersion")).toHaveLength(0);
    expect(lost).toEqual([]);
  });

  it("cancels the timeout of a heartbeat in flight on stopWatching", async () => {
    const { fake, clock, stopWatching, lost } = await setup({ heartbeat: undefined });
    fake.script("Browser.getVersion", "hang");
    clock.advance(GUARD_HEARTBEAT_INTERVAL_MS);
    await flush();
    stopWatching();
    expect(clock.pendingTimers).toBe(0);
    clock.advance(GUARD_HEARTBEAT_TIMEOUT_MS * 2);
    await flush();
    expect(lost).toEqual([]);
  });

  it("reports loss once and stops its timers when the session closes", async () => {
    const { fake, clock, lost } = await setup({ heartbeat: undefined });
    fake.detach();
    await flush();
    expect(clock.pendingTimers).toBe(0);
    clock.advance(GUARD_HEARTBEAT_INTERVAL_MS * 5);
    await flush();
    expect(lost).toEqual(["session-closed"]);
  });

  it("answers requests that arrive while a heartbeat has no answer", async () => {
    const { fake, clock } = await setup({ heartbeat: undefined });
    fake.script("Browser.getVersion", "hang");
    clock.advance(GUARD_HEARTBEAT_INTERVAL_MS);
    await flush();
    await paused(fake, "r1", "https://shop.example/");
    expect(request(fake, "r1").state).toBe("continued");
  });
});
