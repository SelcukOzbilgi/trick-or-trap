import { describe, expect, it } from "vitest";
import { GUARD_DECISION_TIMEOUT_MS, MAX_REQUEST_HOSTS } from "@/lib/capture/constants";
import type { GuardVerdict, RequestGuardEvent, RequestPolicy } from "@/lib/capture/guard-types";
import { installRequestGuard } from "@/lib/capture/request-guard";
import { createFakeCdp, type CdpCall, type FakeCdp } from "./helpers/fake-cdp";
import { createManualClock, type ManualClock } from "./helpers/manual-clock";

const MAIN_FRAME = "MAIN";
const FRAME_TREE = { frameTree: { frame: { id: MAIN_FRAME } } };
const PATTERNS = { patterns: [{ urlPattern: "*", requestStage: "Request" }] };
const AUTO_ATTACH = { autoAttach: true, waitForDebuggerOnStart: true, flatten: true };

type TestPolicy = RequestPolicy & {
  events: RequestGuardEvent[];
  syntaxCalls: string[];
  hostCalls: string[];
  /** Overrides the host check. Return a promise that never settles, or throw, to test those paths. */
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

type Setup = { cdp: FakeCdp; policy: TestPolicy; clock: ManualClock };

async function setup(options: { maxHosts?: number; decisionTimeoutMs?: number } = {}): Promise<Setup> {
  const cdp = createFakeCdp({ "Page.getFrameTree": FRAME_TREE });
  const policy = createPolicy();
  const clock = createManualClock();
  await installRequestGuard(cdp, policy, { clock, ...options });
  return { cdp, policy, clock };
}

function paused(requestId: string, url: string, extra: Record<string, unknown> = {}) {
  return {
    requestId,
    request: { url, method: "GET" },
    frameId: MAIN_FRAME,
    resourceType: "Document",
    ...extra,
  };
}

function answerFor(cdp: FakeCdp, method: string, requestId: string): CdpCall | undefined {
  return cdp.callsOf(method).find((call) => (call.params as { requestId?: string }).requestId === requestId);
}

/** Lets promise callbacks that need no timer run. */
function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe("installRequestGuard setup", () => {
  it("registers the handler first, then bypasses service workers, reads the frame tree, enables Fetch and auto-attach", async () => {
    const { cdp } = await setup();
    expect(cdp.handlersAtFirstSend).toBe(1);
    expect(cdp.calls.map((call) => call.method)).toEqual([
      "Network.setBypassServiceWorker",
      "Page.getFrameTree",
      "Fetch.enable",
      "Target.setAutoAttach",
    ]);
    expect(cdp.calls[0]?.params).toEqual({ bypass: true });
    expect(cdp.calls[2]?.params).toEqual(PATTERNS);
    expect(cdp.calls[3]?.params).toEqual(AUTO_ATTACH);
    expect(cdp.calls.every((call) => call.targetSessionId === undefined)).toBe(true);
  });

  it.each(["Network.setBypassServiceWorker", "Page.getFrameTree", "Fetch.enable", "Target.setAutoAttach"])(
    "rejects when %s rejects",
    async (method) => {
      const cdp = createFakeCdp({ "Page.getFrameTree": FRAME_TREE, [method]: new Error("refused by browser") });
      await expect(installRequestGuard(cdp, createPolicy(), { clock: createManualClock() })).rejects.toThrow(
        "refused by browser",
      );
    },
  );

  it("rejects when the frame tree has no main frame id", async () => {
    const cdp = createFakeCdp({ "Page.getFrameTree": { frameTree: {} } });
    await expect(installRequestGuard(cdp, createPolicy(), { clock: createManualClock() })).rejects.toThrow();
  });

  it("does not call Fetch.enable when an earlier step failed", async () => {
    const cdp = createFakeCdp({
      "Page.getFrameTree": FRAME_TREE,
      "Network.setBypassServiceWorker": new Error("nope"),
    });
    await expect(installRequestGuard(cdp, createPolicy(), { clock: createManualClock() })).rejects.toThrow();
    expect(cdp.callsOf("Fetch.enable")).toHaveLength(0);
  });
});

describe("verdicts for paused requests", () => {
  it("continues an allowed request without changing it", async () => {
    const { cdp, policy } = await setup();
    await cdp.emit("Fetch.requestPaused", paused("r1", "https://shop.example/"));
    expect(answerFor(cdp, "Fetch.continueRequest", "r1")?.params).toEqual({ requestId: "r1" });
    expect(cdp.callsOf("Fetch.failRequest")).toHaveLength(0);
    expect(policy.events).toEqual([]);
  });

  it("fails a redirect hop to a blocked address in the same event turn, with no timer advanced", async () => {
    const { cdp, policy, clock } = await setup();
    await cdp.emit("Fetch.requestPaused", paused("r1", "https://shop.example/"));
    await cdp.emit("Fetch.requestPaused", paused("r2", "http://10.0.0.1/", { redirectedRequestId: "r1" }));
    expect(answerFor(cdp, "Fetch.failRequest", "r2")?.params).toEqual({
      requestId: "r2",
      errorReason: "BlockedByClient",
    });
    expect(answerFor(cdp, "Fetch.continueRequest", "r2")).toBeUndefined();
    expect(policy.events).toEqual([{ kind: "request-blocked", reason: "url-address-blocked", mainFrame: true }]);
    expect(clock.pendingTimers).toBe(0);
  });

  it("fails a request whose syntax check refuses it, without a DNS check", async () => {
    const { cdp, policy } = await setup();
    await cdp.emit("Fetch.requestPaused", paused("r1", "https://badsyntax.example/"));
    expect(answerFor(cdp, "Fetch.failRequest", "r1")).toBeDefined();
    expect(policy.syntaxCalls).toEqual(["https://badsyntax.example/"]);
    expect(policy.hostCalls).toEqual([]);
    expect(policy.events).toEqual([{ kind: "request-blocked", reason: "url-port-blocked", mainFrame: true }]);
  });

  it.each(["data:text/plain,hello", "blob:https://shop.example/1234", "about:blank"])(
    "continues %s without calling the policy",
    async (url) => {
      const { cdp, policy } = await setup();
      await cdp.emit("Fetch.requestPaused", paused("r1", url, { resourceType: "Image" }));
      expect(answerFor(cdp, "Fetch.continueRequest", "r1")).toBeDefined();
      expect(policy.syntaxCalls).toEqual([]);
      expect(policy.hostCalls).toEqual([]);
      expect(policy.events).toEqual([]);
    },
  );

  it("refuses an ftp: URL with url-scheme-blocked", async () => {
    const { cdp, policy } = await setup();
    await cdp.emit("Fetch.requestPaused", paused("r1", "ftp://shop.example/file", { resourceType: "Image" }));
    expect(answerFor(cdp, "Fetch.failRequest", "r1")).toBeDefined();
    expect(policy.events).toEqual([{ kind: "request-blocked", reason: "url-scheme-blocked", mainFrame: false }]);
  });

  it("refuses a URL that cannot be parsed", async () => {
    const { cdp, policy } = await setup();
    await cdp.emit("Fetch.requestPaused", paused("r1", "not a url", { resourceType: "Image" }));
    expect(answerFor(cdp, "Fetch.failRequest", "r1")).toBeDefined();
    expect(policy.events).toEqual([{ kind: "request-blocked", reason: "url-invalid", mainFrame: false }]);
  });

  it("fails a paused request that has no URL", async () => {
    const { cdp } = await setup();
    await cdp.emit("Fetch.requestPaused", { requestId: "r1", resourceType: "Image" });
    expect(answerFor(cdp, "Fetch.failRequest", "r1")).toBeDefined();
  });

  it("ignores events of other methods and paused events without a request id", async () => {
    const { cdp, policy } = await setup();
    const before = cdp.calls.length;
    await cdp.emit("Network.requestWillBeSent", paused("r1", "https://shop.example/"));
    await cdp.emit("Fetch.requestPaused", { request: { url: "https://shop.example/" } });
    await cdp.emit("Fetch.requestPaused", "not an object");
    expect(cdp.calls.length).toBe(before);
    expect(policy.events).toEqual([]);
  });

  it("ignores a failing continueRequest and a failing failRequest", async () => {
    const { cdp } = await setup();
    cdp.script("Fetch.continueRequest", new Error("request is gone"));
    cdp.script("Fetch.failRequest", new Error("request is gone"));
    await expect(cdp.emit("Fetch.requestPaused", paused("r1", "https://shop.example/"))).resolves.toBeUndefined();
    await expect(cdp.emit("Fetch.requestPaused", paused("r2", "http://10.0.0.1/"))).resolves.toBeUndefined();
  });
});

describe("main-frame flag", () => {
  it("is true for the main-frame document and false for an iframe document and a sub-resource", async () => {
    const { cdp, policy } = await setup();
    await cdp.emit("Fetch.requestPaused", paused("r1", "http://10.0.0.1/a"));
    await cdp.emit("Fetch.requestPaused", paused("r2", "http://10.0.0.1/b", { frameId: "CHILD" }));
    await cdp.emit("Fetch.requestPaused", paused("r3", "http://10.0.0.1/c", { resourceType: "Script" }));
    expect(policy.events.map((event) => (event.kind === "request-blocked" ? event.mainFrame : null))).toEqual([
      true,
      false,
      false,
    ]);
  });

  it("is false for a document request that arrives on a child session", async () => {
    const { cdp, policy } = await setup();
    await cdp.emit("Fetch.requestPaused", paused("r1", "http://10.0.0.1/a"), "child-1");
    expect(policy.events).toEqual([{ kind: "request-blocked", reason: "url-address-blocked", mainFrame: false }]);
  });
});

describe("host seen-set and host limit", () => {
  it("checks the host of a new sub-resource once and does not add a host for a repeat", async () => {
    const { cdp, policy } = await setup({ maxHosts: 1 });
    await cdp.emit("Fetch.requestPaused", paused("r1", "https://a.example/1.png", { resourceType: "Image" }));
    expect(policy.hostCalls).toEqual(["https://a.example/1.png"]);
    await cdp.emit("Fetch.requestPaused", paused("r2", "https://a.example/2.png", { resourceType: "Image" }));
    expect(answerFor(cdp, "Fetch.continueRequest", "r2")).toBeDefined();
    expect(policy.events).toEqual([]);
  });

  it("refuses the 101st distinct host on a sub-resource and reports the limit once", async () => {
    const { cdp, policy } = await setup();
    for (let i = 0; i < MAX_REQUEST_HOSTS; i += 1) {
      await cdp.emit("Fetch.requestPaused", paused(`ok-${i}`, `https://h${i}.example/x.png`, { resourceType: "Image" }));
    }
    expect(cdp.callsOf("Fetch.failRequest")).toHaveLength(0);
    await cdp.emit("Fetch.requestPaused", paused("over-1", "https://extra1.example/x.png", { resourceType: "Image" }));
    await cdp.emit("Fetch.requestPaused", paused("over-2", "https://extra2.example/x.png", { resourceType: "Image" }));
    expect(answerFor(cdp, "Fetch.failRequest", "over-1")).toBeDefined();
    expect(answerFor(cdp, "Fetch.failRequest", "over-2")).toBeDefined();
    expect(policy.events.filter((event) => event.kind === "request-host-limit")).toHaveLength(1);
    expect(policy.hostCalls).not.toContain("https://extra1.example/x.png");
    // A host seen before the limit is still allowed.
    await cdp.emit("Fetch.requestPaused", paused("again", "https://h0.example/y.png", { resourceType: "Image" }));
    expect(answerFor(cdp, "Fetch.continueRequest", "again")).toBeDefined();
  });

  it("reports each request refused for the limit as blocked", async () => {
    const { cdp, policy } = await setup({ maxHosts: 1 });
    await cdp.emit("Fetch.requestPaused", paused("r1", "https://a.example/1.png", { resourceType: "Image" }));
    await cdp.emit("Fetch.requestPaused", paused("r2", "https://b.example/1.png", { resourceType: "Image" }));
    expect(policy.events).toEqual([
      { kind: "request-host-limit" },
      { kind: "request-blocked", reason: "url-host-blocked", mainFrame: false },
    ]);
  });

  it("never refuses a document request for the host limit", async () => {
    const { cdp, policy } = await setup({ maxHosts: 1 });
    await cdp.emit("Fetch.requestPaused", paused("r1", "https://a.example/1.png", { resourceType: "Image" }));
    await cdp.emit("Fetch.requestPaused", paused("r2", "https://b.example/", { frameId: "CHILD" }));
    await cdp.emit("Fetch.requestPaused", paused("r3", "https://c.example/"));
    expect(answerFor(cdp, "Fetch.continueRequest", "r2")).toBeDefined();
    expect(answerFor(cdp, "Fetch.continueRequest", "r3")).toBeDefined();
    expect(policy.events).toEqual([]);
  });

  it("counts the host of a document request as seen", async () => {
    const { cdp, policy } = await setup({ maxHosts: 1 });
    await cdp.emit("Fetch.requestPaused", paused("r1", "https://a.example/"));
    await cdp.emit("Fetch.requestPaused", paused("r2", "https://a.example/1.png", { resourceType: "Image" }));
    await cdp.emit("Fetch.requestPaused", paused("r3", "https://b.example/1.png", { resourceType: "Image" }));
    expect(answerFor(cdp, "Fetch.continueRequest", "r2")).toBeDefined();
    expect(answerFor(cdp, "Fetch.failRequest", "r3")).toBeDefined();
    expect(policy.events.some((event) => event.kind === "request-host-limit")).toBe(true);
  });

  it("applies the limit to requests that are paused at the same time", async () => {
    const { cdp } = await setup({ maxHosts: 2 });
    await Promise.all(
      [1, 2, 3, 4].map((n) =>
        cdp.emit("Fetch.requestPaused", paused(`r${n}`, `https://h${n}.example/x.png`, { resourceType: "Image" })),
      ),
    );
    expect(cdp.callsOf("Fetch.continueRequest")).toHaveLength(2);
    expect(cdp.callsOf("Fetch.failRequest")).toHaveLength(2);
  });
});

describe("decision timeout and errors", () => {
  it("fails a request whose host check never settles, after GUARD_DECISION_TIMEOUT_MS", async () => {
    const { cdp, policy, clock } = await setup();
    policy.hostCheck = () => new Promise<GuardVerdict>(() => {});
    const done = cdp.emit("Fetch.requestPaused", paused("r1", "https://slow.example/"));
    await flush();
    expect(cdp.callsOf("Fetch.failRequest")).toHaveLength(0);
    expect(clock.pendingTimers).toBe(1);
    clock.advance(GUARD_DECISION_TIMEOUT_MS - 1);
    await flush();
    expect(cdp.callsOf("Fetch.failRequest")).toHaveLength(0);
    clock.advance(1);
    await done;
    expect(answerFor(cdp, "Fetch.failRequest", "r1")?.params).toEqual({
      requestId: "r1",
      errorReason: "BlockedByClient",
    });
    expect(policy.events).toEqual([{ kind: "request-blocked", reason: "url-invalid", mainFrame: true }]);
    expect(clock.pendingTimers).toBe(0);
  });

  it("uses the decision timeout of the options", async () => {
    const { cdp, policy, clock } = await setup({ decisionTimeoutMs: 50 });
    policy.hostCheck = () => new Promise<GuardVerdict>(() => {});
    const done = cdp.emit("Fetch.requestPaused", paused("r1", "https://slow.example/"));
    await flush();
    clock.advance(50);
    await done;
    expect(answerFor(cdp, "Fetch.failRequest", "r1")).toBeDefined();
  });

  it("fails a request when the host check rejects", async () => {
    const { cdp, policy } = await setup();
    policy.hostCheck = () => Promise.reject(new Error("resolver exploded"));
    await cdp.emit("Fetch.requestPaused", paused("r1", "https://shop.example/"));
    expect(answerFor(cdp, "Fetch.failRequest", "r1")).toBeDefined();
    expect(policy.events).toEqual([{ kind: "request-blocked", reason: "url-invalid", mainFrame: true }]);
  });

  it("fails a request when the syntax check throws", async () => {
    const { cdp, policy } = await setup();
    policy.checkSyntax = () => {
      throw new Error("syntax exploded");
    };
    await cdp.emit("Fetch.requestPaused", paused("r1", "https://shop.example/"));
    expect(answerFor(cdp, "Fetch.failRequest", "r1")).toBeDefined();
  });

  it("does not leave a timer behind after a normal decision", async () => {
    const { cdp, clock } = await setup();
    await cdp.emit("Fetch.requestPaused", paused("r1", "https://shop.example/"));
    expect(clock.pendingTimers).toBe(0);
  });
});

describe("child targets", () => {
  const attached = (sessionId: string, targetId = "target-1") => ({
    sessionId,
    targetInfo: { targetId, type: "iframe", url: "https://other.example/" },
    waitingForDebugger: true,
  });

  it("enables Fetch and auto-attach on the child, then resumes it, in this order", async () => {
    const { cdp } = await setup();
    await cdp.emit("Target.attachedToTarget", attached("child-1"));
    const onChild = cdp.calls.filter((call) => call.targetSessionId === "child-1");
    expect(onChild.map((call) => call.method)).toEqual([
      "Fetch.enable",
      "Target.setAutoAttach",
      "Runtime.runIfWaitingForDebugger",
    ]);
    expect(onChild[0]?.params).toEqual(PATTERNS);
    expect(onChild[1]?.params).toEqual(AUTO_ATTACH);
    expect(cdp.callsOf("Target.closeTarget")).toHaveLength(0);
  });

  it("covers a nested target that is announced on a child session", async () => {
    const { cdp } = await setup();
    await cdp.emit("Target.attachedToTarget", attached("grandchild-1", "target-2"), "child-1");
    const onGrandchild = cdp.calls.filter((call) => call.targetSessionId === "grandchild-1");
    expect(onGrandchild.map((call) => call.method)).toEqual([
      "Fetch.enable",
      "Target.setAutoAttach",
      "Runtime.runIfWaitingForDebugger",
    ]);
  });

  it("still resumes a child when Fetch.enable fails, closes its target and reports a blocked request", async () => {
    const { cdp, policy } = await setup();
    cdp.script("Fetch.enable", (call: CdpCall) => (call.targetSessionId === "child-1" ? new Error("no fetch") : {}));
    await cdp.emit("Target.attachedToTarget", attached("child-1", "target-9"));
    const onChild = cdp.calls.filter((call) => call.targetSessionId === "child-1").map((call) => call.method);
    expect(onChild).toContain("Runtime.runIfWaitingForDebugger");
    expect(cdp.callsOf("Target.closeTarget").map((call) => call.params)).toEqual([{ targetId: "target-9" }]);
    expect(policy.events).toEqual([{ kind: "request-blocked", reason: "url-invalid", mainFrame: false }]);
  });

  it("ignores a failing close and a failing resume", async () => {
    const { cdp } = await setup();
    cdp.script("Fetch.enable", (call: CdpCall) => (call.targetSessionId === "child-1" ? new Error("no fetch") : {}));
    cdp.script("Target.closeTarget", new Error("already closed"));
    cdp.script("Runtime.runIfWaitingForDebugger", new Error("gone"));
    await expect(cdp.emit("Target.attachedToTarget", attached("child-1"))).resolves.toBeUndefined();
  });

  it("ignores an attach event without a session id", async () => {
    const { cdp } = await setup();
    const before = cdp.calls.length;
    await cdp.emit("Target.attachedToTarget", { targetInfo: { targetId: "t" } });
    expect(cdp.calls.length).toBe(before);
  });

  it("answers a paused request of a child session on that session, with the shared host set", async () => {
    const { cdp, policy } = await setup({ maxHosts: 1 });
    await cdp.emit("Fetch.requestPaused", paused("r1", "https://a.example/1.png", { resourceType: "Image" }));
    await cdp.emit(
      "Fetch.requestPaused",
      paused("r2", "https://a.example/2.png", { resourceType: "Image", frameId: "CHILD" }),
      "child-1",
    );
    await cdp.emit(
      "Fetch.requestPaused",
      paused("r3", "https://b.example/3.png", { resourceType: "Image", frameId: "CHILD" }),
      "child-1",
    );
    expect(answerFor(cdp, "Fetch.continueRequest", "r1")?.targetSessionId).toBeUndefined();
    expect(answerFor(cdp, "Fetch.continueRequest", "r2")?.targetSessionId).toBe("child-1");
    expect(answerFor(cdp, "Fetch.failRequest", "r3")?.targetSessionId).toBe("child-1");
    expect(policy.events.filter((event) => event.kind === "request-host-limit")).toHaveLength(1);
  });
});
