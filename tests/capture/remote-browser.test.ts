import { readdirSync, readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { scrollInPage } from "@/lib/capture/cdp";
import { collectInPage } from "@/lib/capture/extractor";
import {
  BROWSER_VIEWPORT,
  COLLECT_LIMITS,
  GUARD_HEARTBEAT_INTERVAL_MS,
  MAX_PLAUSIBLE_PX,
  STOP_TIMEOUT_MS,
} from "@/lib/capture/constants";
import { createRemoteBrowser, DISCONNECT_TIMEOUT_MS } from "@/lib/capture/remote-browser";
import type { CaptureConfig } from "@/lib/capture/config";
import type { BrowserSessionHandle, CapturePage, GuardEvent, GuardVerdict, PageGuards } from "@/lib/capture/seam";
import { CaptureFailure } from "@/lib/capture/types";
import type { CollectOptions, RawCollection, RawPageRead } from "@/lib/capture/types";
import { createFakeCdp, type CdpCall, type CdpScript } from "./helpers/fake-cdp";
import { createFakeGuardBrowser, type FakeGuardBrowser } from "./helpers/fake-guard-browser";
import { createManualClock } from "./helpers/manual-clock";

const API_KEY = "sk-test-sentinel";
const SESSION_ID = "sess-sentinel-1234";
const CDP_URL = "wss://abc.cdp.browser-use.com/devtools/browser/sentinel";
const LIVE_URL = "https://live.browser-use.com/?wss=sentinel";

const CONFIG: CaptureConfig = {
  browserMode: "remote",
  apiKey: API_KEY,
  proxy: "off",
  sessionTimeoutMinutes: 2,
  allowOrigin: null,
};

const SESSION_REQUEST = {
  timeoutMinutes: 2,
  proxy: "off" as const,
  viewport: { width: 1280, height: 800 },
  captureId: "capture-id-sentinel",
};

const COLLECT_OPTIONS: CollectOptions = {
  maxElements: 1500,
  maxTextChars: 300,
  maxAttrChars: 200,
  attributeNames: "full",
  limits: COLLECT_LIMITS,
};

/** What the collector returns from the isolated world: the ratio, the count and the elements. */
const RAW_COLLECTION: RawCollection = { devicePixelRatio: 1, eligibleCount: 0, elements: [] };

/** A canned answer of `Page.getLayoutMetrics`. The layout width is narrower than the window: scrollbars are hidden. */
const LAYOUT_METRICS = {
  cssLayoutViewport: { pageX: 0, pageY: 0, clientWidth: 1265, clientHeight: 588 },
  cssContentSize: { x: 0, y: 0, width: 1265, height: 2000 },
};

/** The read that `LAYOUT_METRICS` and `RAW_COLLECTION` must give. */
const RAW_READ: RawPageRead = {
  innerWidth: 1265,
  innerHeight: 588,
  devicePixelRatio: 1,
  scrollX: 0,
  scrollY: 0,
  scrollWidth: 1265,
  scrollHeight: 2000,
  layoutWidth: 1265,
  eligibleCount: 0,
  elements: [],
};

type AnyFn = (...args: never[]) => unknown;

const MAIN_FRAME_ID = "main-frame-1";

/** Every fake page session and guard browser made in a test; `afterEach` checks that none broke the protocol. */
const fakes: Array<{ cdp: ReturnType<typeof createFakeCdp>; guard: FakeGuardBrowser }> = [];

afterEach(() => {
  const made = fakes.splice(0);
  for (const { cdp, guard } of made) {
    cdp.assertNoViolations();
    guard.assertNoViolations();
  }
});

/** Lets every pending promise callback run. The tests use real timers for this only. */
function flush(): Promise<void> {
  return new Promise<void>((resolve) => setImmediate(resolve));
}

type FakePlaywrightOptions = {
  /** Answers of the fake CDP session behind `context.newCDPSession(page)`. */
  cdpScript?: CdpScript;
  contexts?: "none" | "one";
  pages?: "none" | "one";
  connectError?: Error;
  closeError?: Error;
  gotoError?: Error;
  reloadError?: Error;
  screenshotError?: Error;
  /** `Runtime.callFunctionOn` rejects. */
  callError?: Error;
  /** What the collector returns from the isolated world. */
  collection?: unknown;
  /** The answer of `Page.getLayoutMetrics`. */
  layoutMetrics?: unknown;
  /** The `scrollY` the scroll function reports back. */
  scrollY?: unknown;
  finalUrl?: string;
  events?: string[];
};

function createFakePlaywright(options: FakePlaywrightOptions = {}) {
  const events = options.events ?? [];
  let nextContext = 1;
  const cdp = createFakeCdp({
    "Page.getFrameTree": { frameTree: { frame: { id: MAIN_FRAME_ID } } },
    "Page.getLayoutMetrics": "layoutMetrics" in options ? options.layoutMetrics : LAYOUT_METRICS,
    "Page.createIsolatedWorld": () => ({ executionContextId: nextContext++ }),
    "Runtime.callFunctionOn": (call: CdpCall) => {
      if (options.callError) return options.callError;
      const declaration = (call.params as { functionDeclaration?: string }).functionDeclaration;
      if (declaration === String(collectInPage)) {
        return { result: { value: "collection" in options ? options.collection : RAW_COLLECTION } };
      }
      return { result: { value: "scrollY" in options ? options.scrollY : 0 } };
    },
    ...options.cdpScript,
  });
  // The shape of a Playwright CDPSession for the page: `send` with two arguments. The page session has no
  // events here, because every protocol event of the guard comes from the browser-level session below.
  // The wrapper forwards every argument, so a third one reaches the fake and is recorded as a violation.
  const cdpSession = {
    send: vi.fn((...args: unknown[]) => (cdp.send as (...a: unknown[]) => Promise<unknown>)(...args)),
  };

  // The browser-level guard session of `browser.newBrowserCDPSession()`, backed by the faithful fake guard browser.
  const guard = createFakeGuardBrowser();
  const disconnectedHandlers: Array<() => void> = [];
  const guardCdpSession = (session: Awaited<ReturnType<FakeGuardBrowser["openGuardSession"]>>) => ({
    send: vi.fn((...args: unknown[]) => (session.send as (...a: unknown[]) => Promise<unknown>)(...args)),
    on: vi.fn((event: string, handler: (params?: unknown) => unknown) => {
      if (event === "Fetch.requestPaused") {
        session.onEvent(async (paused) => {
          if (paused.method === event) await handler(paused.params);
        });
      } else if (event === "close") {
        session.onClose(() => {
          void handler();
        });
      } else {
        throw new Error(`The fake browser session has no event "${event}".`);
      }
    }),
    detach: vi.fn(async () => {}),
  });
  const guardSessions: Array<ReturnType<typeof guardCdpSession>> = [];
  fakes.push({ cdp, guard });

  const pageHandlers: Record<string, AnyFn> = {};
  const contextHandlers: Record<string, AnyFn> = {};

  const makePage = () => ({
    goto: vi.fn(async (_url: string, _options: unknown) => {
      if (options.gotoError) throw options.gotoError;
      return null;
    }),
    reload: vi.fn(async (_options: unknown) => {
      if (options.reloadError) throw options.reloadError;
      return null;
    }),
    // There is deliberately no `evaluate` here: the adapter must read the page through CDP.
    screenshot: vi.fn(async (_options: unknown) => {
      if (options.screenshotError) throw options.screenshotError;
      return new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    }),
    url: vi.fn(() => options.finalUrl ?? "https://shop.example.com/"),
    viewportSize: vi.fn(() => {
      throw new Error("viewportSize must not be called");
    }),
    on: vi.fn((event: string, handler: AnyFn) => {
      pageHandlers[event] = handler;
    }),
    close: vi.fn(async () => {}),
  });

  const firstPage = makePage();
  const createdPage = makePage();
  const pageList = options.pages === "none" ? [] : [firstPage];

  const context = {
    pages: vi.fn(() => pageList),
    newPage: vi.fn(async () => createdPage),
    // There is deliberately no `route` here: a call to it fails the test.
    newCDPSession: vi.fn(async (_page: unknown) => cdpSession),
    on: vi.fn((event: string, handler: AnyFn) => {
      contextHandlers[event] = handler;
    }),
  };

  const browser = {
    contexts: vi.fn(() => (options.contexts === "none" ? [] : [context])),
    close: vi.fn(async () => {
      events.push("close");
      if (options.closeError) throw options.closeError;
    }),
    // The browser-level CDP session the guard uses. There is deliberately no `route` and no `detach` call expected.
    newBrowserCDPSession: vi.fn(async () => {
      events.push("open");
      const session = guardCdpSession(await guard.openGuardSession());
      guardSessions.push(session);
      return session;
    }),
    on: vi.fn((event: string, handler: () => void) => {
      if (event !== "disconnected") throw new Error(`The fake browser has no event "${event}".`);
      disconnectedHandlers.push(handler);
      guard.onDisconnected(handler);
    }),
  };

  const connectOverCDP = vi.fn(async (_url: string, _options: { timeout: number }) => {
    if (options.connectError) throw options.connectError;
    return browser;
  });

  const loadPlaywright = vi.fn(async () => ({ chromium: { connectOverCDP } }));

  return {
    loadPlaywright,
    connectOverCDP,
    browser,
    context,
    firstPage,
    createdPage,
    events,
    cdp,
    cdpSession,
    guard,
    guardSessions,
    /** Calls the handlers registered for the browser's `disconnected` event, without a session close. */
    emitDisconnected: () => {
      for (const handler of disconnectedHandlers) handler();
    },
    pageHandler: (event: string) => pageHandlers[event] as unknown as (arg: unknown) => unknown,
    contextHandler: (event: string) => contextHandlers[event] as unknown as (arg: unknown) => unknown,
  };
}

type FetchCall = { url: string; method: string; body: string };

function createFakeFetch(
  options: {
    stopStatus?: number;
    events?: string[];
    stopError?: Error;
    /** The stop request never answers (the abort signal is ignored, as a stuck network would). */
    stopHangs?: boolean;
    /** The stop request answers after this many ms of the manual clock. */
    stopDelayMs?: number;
    clock?: ReturnType<typeof createManualClock>;
  } = {},
) {
  const calls: FetchCall[] = [];
  const fakeFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push({ url: String(input), method, body: String(init?.body ?? "") });
    if (method === "POST") {
      return new Response(JSON.stringify({ id: SESSION_ID, cdpUrl: CDP_URL, liveUrl: LIVE_URL }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (options.stopHangs) return new Promise<Response>(() => {});
    if (options.stopDelayMs !== undefined && options.clock) {
      const clock = options.clock;
      await new Promise<void>((resolve) => {
        clock.setTimer(options.stopDelayMs as number, resolve);
      });
    }
    options.events?.push("patch");
    if (options.stopError) throw options.stopError;
    return new Response("{}", { status: options.stopStatus ?? 200 });
  });
  return { fetch: fakeFetch as unknown as typeof fetch, calls };
}

type Harness = {
  fake: ReturnType<typeof createFakePlaywright>;
  fetchFake: ReturnType<typeof createFakeFetch>;
  clock: ReturnType<typeof createManualClock>;
  handle: BrowserSessionHandle;
};

async function openSession(
  playwright: FakePlaywrightOptions = {},
  fetchOptions: { stopStatus?: number; stopError?: Error; stopHangs?: boolean; stopDelayMs?: number } = {},
): Promise<Harness> {
  const events: string[] = [];
  const fake = createFakePlaywright({ ...playwright, events });
  const clock = createManualClock();
  const fetchFake = createFakeFetch({ ...fetchOptions, events, clock });
  const provider = createRemoteBrowser(CONFIG, {
    fetch: fetchFake.fetch,
    clock,
    loadPlaywright: fake.loadPlaywright,
  });
  const handle = await provider.createSession(SESSION_REQUEST);
  return { fake, fetchFake, clock, handle };
}

async function connectedPage(playwright: FakePlaywrightOptions = {}): Promise<Harness & { page: CapturePage }> {
  const harness = await openSession(playwright);
  const page = await harness.handle.connect({ timeoutMs: 15_000 });
  return { ...harness, page };
}

function createGuards(verdict: GuardVerdict) {
  const events: GuardEvent[] = [];
  const checkSyntax = vi.fn((_url: string): GuardVerdict => ({ allowed: true }));
  const checkHost = vi.fn(async (_url: string) => verdict);
  const guards: PageGuards = { checkSyntax, checkHost, report: (event) => events.push(event) };
  return { guards, events, checkSyntax, checkHost };
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

function expectNoSecrets(text: string): void {
  for (const secret of [API_KEY, SESSION_ID, CDP_URL, LIVE_URL, "cdp.browser-use.com"]) {
    expect(text).not.toContain(secret);
  }
}

describe("createRemoteBrowser", () => {
  it("reports the mode remote", () => {
    const fake = createFakePlaywright();
    const provider = createRemoteBrowser(CONFIG, {
      fetch: createFakeFetch().fetch,
      clock: createManualClock(),
      loadPlaywright: fake.loadPlaywright,
    });
    expect(provider.mode).toBe("remote");
  });

  it("does not load playwright-core before connect", async () => {
    const harness = await openSession();
    expect(harness.fake.loadPlaywright).not.toHaveBeenCalled();
    await harness.handle.connect({ timeoutMs: 15_000 });
    expect(harness.fake.loadPlaywright).toHaveBeenCalledTimes(1);
  });

  it("has no static import of playwright-core in its source", () => {
    const source = readFileSync("lib/capture/remote-browser.ts", "utf8");
    expect(source).not.toMatch(/^\s*import\s[^;]*from\s+["']playwright-core["']/m);
    expect(source).not.toMatch(/require\(\s*["']playwright-core["']/);
    expect(source).toMatch(/import\(\s*["']playwright-core["']\s*\)/);
  });

  it("creates the session through the Browser Use API with the configured request", async () => {
    const { fetchFake } = await openSession();
    expect(fetchFake.calls).toHaveLength(1);
    expect(fetchFake.calls[0].method).toBe("POST");
    expect(fetchFake.calls[0].url).toBe("https://api.browser-use.com/api/v4/browsers");
    expect(JSON.parse(fetchFake.calls[0].body)).toEqual({
      timeout: 2,
      browserScreenWidth: 1280,
      browserScreenHeight: 800,
      proxyCountryCode: null,
      metadata: { app: "trick-or-trap", captureId: SESSION_REQUEST.captureId },
    });
  });

  it("fails with config-invalid when the API key is missing", async () => {
    const provider = createRemoteBrowser(
      { ...CONFIG, apiKey: null },
      { fetch: createFakeFetch().fetch, clock: createManualClock(), loadPlaywright: async () => ({}) },
    );
    const failure = await failureOf(provider.createSession(SESSION_REQUEST));
    expect(failure.code).toBe("config-invalid");
  });
});

describe("connect", () => {
  it("passes the CDP address and the timeout to connectOverCDP", async () => {
    const { fake } = await connectedPage();
    expect(fake.connectOverCDP).toHaveBeenCalledTimes(1);
    expect(fake.connectOverCDP).toHaveBeenCalledWith(CDP_URL, { timeout: 15_000 });
  });

  it("accepts a module that exposes chromium under default", async () => {
    const fake = createFakePlaywright();
    const provider = createRemoteBrowser(CONFIG, {
      fetch: createFakeFetch().fetch,
      clock: createManualClock(),
      loadPlaywright: async () => ({ default: { chromium: { connectOverCDP: fake.connectOverCDP } } }),
    });
    const handle = await provider.createSession(SESSION_REQUEST);
    await handle.connect({ timeoutMs: 1000 });
    expect(fake.connectOverCDP).toHaveBeenCalledTimes(1);
  });

  it("fails with connect-failed when the connection has no browser context", async () => {
    const harness = await openSession({ contexts: "none" });
    const failure = await failureOf(harness.handle.connect({ timeoutMs: 15_000 }));
    expect(failure.code).toBe("connect-failed");
  });

  it("uses the first page of the first context", async () => {
    const { fake } = await connectedPage();
    expect(fake.context.newPage).not.toHaveBeenCalled();
  });

  it("opens one CDP session for the page and hides the scrollbars before connect returns", async () => {
    const { fake } = await connectedPage();
    expect(fake.context.newCDPSession).toHaveBeenCalledTimes(1);
    expect(fake.context.newCDPSession).toHaveBeenCalledWith(fake.firstPage);
    expect(fake.cdp.calls).toEqual([{ method: "Emulation.setScrollbarsHidden", params: { hidden: true } }]);
  });

  it("hides the scrollbars on the page that was created when the context had none", async () => {
    const { fake } = await connectedPage({ pages: "none" });
    expect(fake.context.newCDPSession).toHaveBeenCalledWith(fake.createdPage);
    expect(fake.cdp.callsOf("Emulation.setScrollbarsHidden")).toHaveLength(1);
  });

  it("maps a failing scrollbar call to connect-failed with a redacted detail, before any navigation", async () => {
    const harness = await openSession({
      cdpScript: {
        "Emulation.setScrollbarsHidden": new Error(`refused: key=${API_KEY} id=${SESSION_ID} cdp=${CDP_URL} live=${LIVE_URL}`),
      },
    });
    const failure = await failureOf(harness.handle.connect({ timeoutMs: 15_000 }));
    expect(failure.code).toBe("connect-failed");
    expect(failure.detail ?? "").toContain("refused");
    expectNoSecrets(failure.message);
    expectNoSecrets(failure.detail ?? "");
    expect(harness.fake.firstPage.goto).not.toHaveBeenCalled();
  });

  it("creates a page when the context has none", async () => {
    const { fake, page } = await connectedPage({ pages: "none" });
    expect(fake.context.newPage).toHaveBeenCalledTimes(1);
    await page.goto("https://shop.example.com/", { timeoutMs: 1000 });
    expect(fake.createdPage.goto).toHaveBeenCalledTimes(1);
    expect(fake.firstPage.goto).not.toHaveBeenCalled();
  });

  it("maps a connection error to connect-failed with a redacted detail and a fixed message", async () => {
    const harness = await openSession({
      connectError: new Error(`connect ECONNREFUSED ${CDP_URL} key=${API_KEY} id=${SESSION_ID} live=${LIVE_URL}`),
    });
    const failure = await failureOf(harness.handle.connect({ timeoutMs: 15_000 }));
    expect(failure.code).toBe("connect-failed");
    expect(failure.message).toBe("The connection to the remote browser failed.");
    expectNoSecrets(failure.message);
    expectNoSecrets(failure.detail ?? "");
    expect((failure.detail ?? "").length).toBeLessThanOrEqual(200);
  });

  it("maps a loader error to connect-failed", async () => {
    const provider = createRemoteBrowser(CONFIG, {
      fetch: createFakeFetch().fetch,
      clock: createManualClock(),
      loadPlaywright: async () => {
        throw new Error(`cannot load module for ${API_KEY}`);
      },
    });
    const handle = await provider.createSession(SESSION_REQUEST);
    const failure = await failureOf(handle.connect({ timeoutMs: 1000 }));
    expect(failure.code).toBe("connect-failed");
    expectNoSecrets(failure.detail ?? "");
  });

  it("fails with connect-failed when the module has no chromium", async () => {
    const provider = createRemoteBrowser(CONFIG, {
      fetch: createFakeFetch().fetch,
      clock: createManualClock(),
      loadPlaywright: async () => ({}),
    });
    const handle = await provider.createSession(SESSION_REQUEST);
    const failure = await failureOf(handle.connect({ timeoutMs: 1000 }));
    expect(failure.code).toBe("connect-failed");
  });
});

describe("guards", () => {
  it("reads the frame tree on the page session, then opens the guard session, then enables Fetch once", async () => {
    const { fake, page } = await connectedPage();
    fake.cdp.script("Page.getFrameTree", () => {
      fake.events.push("frame-tree");
      return { frameTree: { frame: { id: MAIN_FRAME_ID } } };
    });
    fake.guard.script("Fetch.enable", () => {
      fake.events.push("enable");
      return {};
    });
    await page.installGuards(createGuards({ allowed: true }).guards);

    expect(fake.events).toEqual(["frame-tree", "open", "enable"]);
    // The page session got the scrollbar call and the frame-tree read, and nothing else.
    expect(fake.cdp.calls.map((call) => call.method)).toEqual(["Emulation.setScrollbarsHidden", "Page.getFrameTree"]);
    // One page session and one guard session.
    expect(fake.context.newCDPSession).toHaveBeenCalledTimes(1);
    expect(fake.browser.newBrowserCDPSession).toHaveBeenCalledTimes(1);
    expect(fake.guard.openCalls).toBe(1);
    expect(fake.guard.callsOf("Fetch.enable")).toHaveLength(1);
    expect(fake.guard.callsOf("Fetch.enable")[0].params).toEqual({
      patterns: [{ urlPattern: "*", requestStage: "Request" }],
    });
  });

  it("registers the paused, close and disconnected handlers before the first command of the guard", async () => {
    const { fake, page } = await connectedPage();
    await page.installGuards(createGuards({ allowed: true }).guards);
    expect(fake.guard.handlersAtFirstSend).toEqual({ event: 1, close: 1, disconnected: 1 });
    expect(fake.guard.calls[0].method).toBe("Fetch.enable");
  });

  it("sends none of the child-target, page-domain or bypass commands, and no Fetch.enable on the page session", async () => {
    const { fake, page } = await connectedPage();
    await page.installGuards(createGuards({ allowed: true }).guards);
    const methods = [...fake.cdp.calls, ...fake.guard.calls].map((call) => call.method);
    for (const forbidden of [
      "Target.setAutoAttach",
      "Runtime.runIfWaitingForDebugger",
      "Target.closeTarget",
      "Network.setBypassServiceWorker",
    ]) {
      expect(methods).not.toContain(forbidden);
    }
    expect(fake.cdp.callsOf("Fetch.enable")).toEqual([]);
    expect(fake.guard.calls.every((call) => !/^(Network|Page|Runtime|Emulation|Target)\./.test(call.method))).toBe(true);
  });

  it("never calls route on the context or the page, and never detaches the guard session", async () => {
    const { fake, page } = await connectedPage();
    await page.installGuards(createGuards({ allowed: true }).guards);
    expect("route" in fake.context).toBe(false);
    expect("route" in fake.firstPage).toBe(false);
    expect("routeWebSocket" in fake.context).toBe(false);
    for (const session of fake.guardSessions) expect(session.detach).not.toHaveBeenCalled();
  });

  it("does not navigate while Fetch.enable has not resolved", async () => {
    const { fake, page } = await connectedPage();
    fake.guard.script("Fetch.enable", "hang");

    let settled = false;
    void page.installGuards(createGuards({ allowed: true }).guards).then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    await flush();

    expect(fake.guard.callsOf("Fetch.enable")).toHaveLength(1);
    expect(settled).toBe(false);
    // `capturePage` calls goto only after installGuards resolved, so goto has not run here.
    expect(fake.firstPage.goto).not.toHaveBeenCalled();
  });

  it("starts the guard heartbeat on the guard session", async () => {
    const { fake, clock, page } = await connectedPage();
    await page.installGuards(createGuards({ allowed: true }).guards);
    expect(fake.guard.callsOf("Browser.getVersion")).toEqual([]);
    clock.advance(GUARD_HEARTBEAT_INTERVAL_MS);
    expect(fake.guard.callsOf("Browser.getVersion")).toHaveLength(1);
  });

  it("continues a paused request that the guards allow", async () => {
    const { fake, page } = await connectedPage();
    const { guards, checkHost, events } = createGuards({ allowed: true });
    await page.installGuards(guards);

    await fake.guard.emitPaused({
      requestId: "req-1",
      url: "https://shop.example.com/a",
      resourceType: "Document",
      frameId: MAIN_FRAME_ID,
    }).handled;

    expect(checkHost).toHaveBeenCalledWith("https://shop.example.com/a");
    expect(fake.guard.callsOf("Fetch.continueRequest").map((call) => call.params)).toEqual([{ requestId: "req-1" }]);
    expect(fake.guard.callsOf("Fetch.failRequest")).toEqual([]);
    expect(events).toEqual([]);
  });

  it("fails a paused main-frame request that the guards refuse and reports it without a URL", async () => {
    const { fake, page } = await connectedPage();
    const { guards, events } = createGuards({ allowed: false, reason: "url-address-blocked" });
    await page.installGuards(guards);

    await fake.guard.emitPaused({
      requestId: "req-2",
      url: "http://10.0.0.1/",
      resourceType: "Document",
      frameId: MAIN_FRAME_ID,
    }).handled;

    expect(fake.guard.callsOf("Fetch.failRequest").map((call) => call.params)).toEqual([
      { requestId: "req-2", errorReason: "BlockedByClient" },
    ]);
    expect(fake.guard.callsOf("Fetch.continueRequest")).toEqual([]);
    expect(events).toEqual([{ kind: "request-blocked", reason: "url-address-blocked", mainFrame: true }]);
    expect(JSON.stringify(events)).not.toContain("10.0.0.1");
  });

  it("uses the main frame id read from the page: a document of another frame is not a main-frame request", async () => {
    const { fake, page } = await connectedPage();
    const { guards, events } = createGuards({ allowed: false, reason: "url-address-blocked" });
    await page.installGuards(guards);

    await fake.guard.emitPaused({
      requestId: "req-frame",
      url: "http://10.0.0.1/",
      resourceType: "Document",
      frameId: "some-other-frame",
    }).handled;

    expect(events).toEqual([{ kind: "request-blocked", reason: "url-address-blocked", mainFrame: false }]);
  });

  it("fails a paused request when the check itself throws", async () => {
    const { fake, page } = await connectedPage();
    const events: GuardEvent[] = [];
    await page.installGuards({
      checkSyntax: () => ({ allowed: true }),
      checkHost: async () => {
        throw new Error("resolver exploded");
      },
      report: (event) => events.push(event),
    });

    await fake.guard.emitPaused({
      requestId: "req-3",
      url: "https://shop.example.com/",
      resourceType: "Image",
      frameId: MAIN_FRAME_ID,
    }).handled;

    expect(fake.guard.callsOf("Fetch.failRequest")).toHaveLength(1);
    expect(events).toEqual([{ kind: "request-blocked", reason: "url-invalid", mainFrame: false }]);
  });

  it("maps a failing frame-tree read to connect-failed without a secret, opens no guard session and does not navigate", async () => {
    const { fake, page } = await connectedPage({
      cdpScript: {
        "Page.getFrameTree": new Error(`tree refused: key=${API_KEY} id=${SESSION_ID} cdp=${CDP_URL} live=${LIVE_URL}`),
      },
    });
    const failure = await failureOf(page.installGuards(createGuards({ allowed: true }).guards));
    expect(failure.code).toBe("connect-failed");
    expectNoSecrets(failure.message);
    expectNoSecrets(failure.detail ?? "");
    expect(failure.detail ?? "").toContain("tree refused");
    expect(fake.browser.newBrowserCDPSession).not.toHaveBeenCalled();
    expect(fake.guard.calls).toEqual([]);
    expect(fake.firstPage.goto).not.toHaveBeenCalled();
  });

  it("maps a frame tree without a main frame id to connect-failed", async () => {
    const { fake, page } = await connectedPage({ cdpScript: { "Page.getFrameTree": { frameTree: {} } } });
    const failure = await failureOf(page.installGuards(createGuards({ allowed: true }).guards));
    expect(failure.code).toBe("connect-failed");
    expect(fake.browser.newBrowserCDPSession).not.toHaveBeenCalled();
  });

  it("maps a failing guard session open to connect-failed without a secret, and sends no Fetch.enable", async () => {
    const { fake, page } = await connectedPage();
    fake.browser.newBrowserCDPSession.mockRejectedValueOnce(
      new Error(`no browser session: key=${API_KEY} id=${SESSION_ID} cdp=${CDP_URL} live=${LIVE_URL}`),
    );
    const failure = await failureOf(page.installGuards(createGuards({ allowed: true }).guards));
    expect(failure.code).toBe("connect-failed");
    expectNoSecrets(failure.message);
    expectNoSecrets(failure.detail ?? "");
    expect(failure.detail ?? "").toContain("no browser session");
    expect(fake.guard.calls).toEqual([]);
    expect(fake.firstPage.goto).not.toHaveBeenCalled();
  });

  it("maps a failing Fetch.enable to connect-failed without a secret", async () => {
    const { fake, page } = await connectedPage();
    fake.guard.script(
      "Fetch.enable",
      new Error(`Fetch.enable refused: key=${API_KEY} id=${SESSION_ID} cdp=${CDP_URL} live=${LIVE_URL}`),
    );
    const failure = await failureOf(page.installGuards(createGuards({ allowed: true }).guards));
    expect(failure.code).toBe("connect-failed");
    expectNoSecrets(failure.message);
    expectNoSecrets(failure.detail ?? "");
    expect(failure.detail ?? "").toContain("Fetch.enable");
    expect(fake.firstPage.goto).not.toHaveBeenCalled();
  });

  it("reports guard-lost when the guard session closes", async () => {
    const { fake, page } = await connectedPage();
    const { guards, events } = createGuards({ allowed: true });
    await page.installGuards(guards);

    fake.guard.detach();

    expect(events).toEqual([{ kind: "guard-lost" }]);
  });

  it("reports guard-lost when the browser disconnects", async () => {
    const { fake, page } = await connectedPage();
    const { guards, events } = createGuards({ allowed: true });
    await page.installGuards(guards);

    fake.emitDisconnected();

    expect(events).toEqual([{ kind: "guard-lost" }]);
  });

  it("reports guard-lost once when the connection drops with both signals", async () => {
    const { fake, page } = await connectedPage();
    const { guards, events } = createGuards({ allowed: true });
    await page.installGuards(guards);

    fake.guard.dropConnection();

    expect(events).toEqual([{ kind: "guard-lost" }]);
  });

  it("reports guard-lost when the heartbeat is rejected", async () => {
    const { fake, clock, page } = await connectedPage();
    const { guards, events } = createGuards({ allowed: true });
    await page.installGuards(guards);
    fake.guard.script("Browser.getVersion", new Error("Target closed"));

    clock.advance(GUARD_HEARTBEAT_INTERVAL_MS);
    await flush();

    expect(events).toEqual([{ kind: "guard-lost" }]);
  });

  it("reports no guard-lost for a close, a disconnect or a heartbeat after stop() has started", async () => {
    const { fake, clock, handle, page } = await connectedPage();
    const { guards, events } = createGuards({ allowed: true });
    await page.installGuards(guards);

    // The stop is started and not awaited: the signals below arrive while it runs.
    const stopped = handle.stop();
    fake.guard.dropConnection();
    fake.emitDisconnected();
    // Less than the stop budget, so the manual clock cannot fire the stop request's own timeout.
    clock.advance(2 * GUARD_HEARTBEAT_INTERVAL_MS);
    await stopped;
    await flush();

    expect(events).toEqual([]);
    expect(fake.guard.callsOf("Browser.getVersion")).toEqual([]);
  });

  it("reports no guard-lost when the connection closes after stop() has ended", async () => {
    const { fake, handle, page } = await connectedPage();
    const { guards, events } = createGuards({ allowed: true });
    await page.installGuards(guards);

    await handle.stop();
    fake.guard.detach();
    fake.emitDisconnected();

    expect(events).toEqual([]);
  });

  it("keeps the guard session attached through stop: the stop request first, then browser.close, never detach", async () => {
    const { fake, fetchFake, handle, page } = await connectedPage();
    await page.installGuards(createGuards({ allowed: true }).guards);

    await handle.stop();

    expect(fake.events).toEqual(["open", "patch", "close"]);
    expect(fetchFake.calls.filter((call) => call.method === "PATCH")).toHaveLength(1);
    for (const session of fake.guardSessions) expect(session.detach).not.toHaveBeenCalled();
    expect(fake.guard.pending()).toEqual([]);
  });

  it("maps a failing newCDPSession to connect-failed with a redacted detail", async () => {
    const harness = await openSession();
    harness.fake.context.newCDPSession.mockRejectedValueOnce(new Error(`no session for ${API_KEY} ${LIVE_URL}`));
    const failure = await failureOf(harness.handle.connect({ timeoutMs: 15_000 }));
    expect(failure.code).toBe("connect-failed");
    expectNoSecrets(failure.detail ?? "");
  });

  it("cancels a download and reports it", async () => {
    const { fake, page } = await connectedPage();
    const { guards, events } = createGuards({ allowed: true });
    await page.installGuards(guards);

    const download = { cancel: vi.fn(async () => {}) };
    await fake.pageHandler("download")(download);

    expect(download.cancel).toHaveBeenCalledTimes(1);
    expect(events).toEqual([{ kind: "download-refused" }]);
  });

  it("still reports a download when cancel fails", async () => {
    const { fake, page } = await connectedPage();
    const { guards, events } = createGuards({ allowed: true });
    await page.installGuards(guards);

    const download = {
      cancel: vi.fn(async () => {
        throw new Error("already finished");
      }),
    };
    await fake.pageHandler("download")(download);
    expect(events).toEqual([{ kind: "download-refused" }]);
  });

  it("closes and reports a second page", async () => {
    const { fake, page } = await connectedPage();
    const { guards, events } = createGuards({ allowed: true });
    await page.installGuards(guards);

    const popup = { close: vi.fn(async () => {}) };
    await fake.contextHandler("page")(popup);

    expect(popup.close).toHaveBeenCalledTimes(1);
    expect(events).toEqual([{ kind: "popup-closed" }]);
  });

  it("leaves the first page open", async () => {
    const { fake, page } = await connectedPage();
    const { guards, events } = createGuards({ allowed: true });
    await page.installGuards(guards);

    await fake.contextHandler("page")(fake.firstPage);

    expect(fake.firstPage.close).not.toHaveBeenCalled();
    expect(events).toEqual([]);
  });
});

describe("child-session code", () => {
  it("is gone from every file under lib/capture, and so is the old guard module", () => {
    const files = readdirSync("lib/capture").filter((name) => name.endsWith(".ts"));
    expect(files).not.toContain("request-guard.ts");
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const source = readFileSync(`lib/capture/${file}`, "utf8");
      for (const forbidden of [
        "targetSessionId",
        "Target.attachedToTarget",
        "waitForDebuggerOnStart",
        "Target.setAutoAttach",
        "Runtime.runIfWaitingForDebugger",
        "Network.setBypassServiceWorker",
        "Target.closeTarget",
      ]) {
        expect(source, `${file} mentions ${forbidden}`).not.toContain(forbidden);
      }
    }
  });
});

describe("navigation", () => {
  it("goes to the URL with the load event and returns the final page URL", async () => {
    const { fake, page } = await connectedPage({ finalUrl: "https://shop.example.com/landing" });
    const outcome = await page.goto("https://shop.example.com/", { timeoutMs: 12_000 });

    expect(fake.firstPage.goto).toHaveBeenCalledWith("https://shop.example.com/", {
      timeout: 12_000,
      waitUntil: "load",
    });
    expect(outcome).toEqual({ finalUrl: "https://shop.example.com/landing" });
  });

  it("reloads with the load event and returns the final page URL", async () => {
    const { fake, page } = await connectedPage();
    const outcome = await page.reload({ timeoutMs: 9_000 });

    expect(fake.firstPage.reload).toHaveBeenCalledWith({ timeout: 9_000, waitUntil: "load" });
    expect(outcome).toEqual({ finalUrl: "https://shop.example.com/" });
  });

  it("maps a Playwright timeout to navigation-timeout", async () => {
    const timeout = new Error("page.goto: Timeout 15000ms exceeded.");
    timeout.name = "TimeoutError";
    const { page } = await connectedPage({ gotoError: timeout });
    const failure = await failureOf(page.goto("https://shop.example.com/", { timeoutMs: 15_000 }));
    expect(failure.code).toBe("navigation-timeout");
  });

  it("maps another goto error to navigation-failed with a redacted detail", async () => {
    const { page } = await connectedPage({
      gotoError: new Error(`net::ERR_FAILED at ${CDP_URL} with ${API_KEY}`),
    });
    const failure = await failureOf(page.goto("https://shop.example.com/", { timeoutMs: 15_000 }));
    expect(failure.code).toBe("navigation-failed");
    expect(failure.message).toBe("The page could not be opened.");
    expectNoSecrets(failure.detail ?? "");
  });

  it("maps a reload error to navigation-failed", async () => {
    const { page } = await connectedPage({ reloadError: new Error("boom") });
    const failure = await failureOf(page.reload({ timeoutMs: 1000 }));
    expect(failure.code).toBe("navigation-failed");
  });
});

describe("reading and screenshots", () => {
  it("has a fake page without evaluate, and the adapter source never calls it or route", () => {
    const fake = createFakePlaywright();
    expect("evaluate" in fake.firstPage).toBe(false);
    expect("evaluate" in fake.createdPage).toBe(false);
    const source = readFileSync("lib/capture/remote-browser.ts", "utf8");
    expect(source).not.toMatch(/\.evaluate\s*\(/);
    expect(source).not.toMatch(/\.route\s*\(/);
  });

  it("collects in an isolated world: frame tree, new world, then the collector in that world", async () => {
    const { fake, page } = await connectedPage();
    fake.cdp.calls.length = 0;
    const read = await page.collect(COLLECT_OPTIONS);

    expect(fake.cdp.calls.map((call) => call.method)).toEqual([
      "Page.getFrameTree",
      "Page.createIsolatedWorld",
      "Runtime.callFunctionOn",
      "Page.getLayoutMetrics",
    ]);
    expect(fake.cdp.callsOf("Page.createIsolatedWorld")[0].params).toMatchObject({ frameId: MAIN_FRAME_ID });
    expect(fake.cdp.callsOf("Runtime.callFunctionOn")[0].params).toEqual({
      executionContextId: 1,
      functionDeclaration: String(collectInPage),
      arguments: [{ value: COLLECT_OPTIONS }],
      returnByValue: true,
      awaitPromise: true,
    });
    expect(read).toEqual(RAW_READ);
  });

  it("creates a new isolated world for every read", async () => {
    const { fake, page } = await connectedPage();
    await page.collect(COLLECT_OPTIONS);
    await page.collect(COLLECT_OPTIONS);
    expect(fake.cdp.callsOf("Page.createIsolatedWorld")).toHaveLength(2);
    expect(
      fake.cdp.callsOf("Runtime.callFunctionOn").map((call) => (call.params as { executionContextId: number }).executionContextId),
    ).toEqual([1, 2]);
  });

  it("takes sizes, scroll position and the layout width from the layout metrics and the ratio from the collector", async () => {
    const { page } = await connectedPage({
      layoutMetrics: {
        cssLayoutViewport: { pageX: 5, pageY: 300, clientWidth: 1200, clientHeight: 560 },
        cssContentSize: { x: 0, y: 0, width: 1210, height: 7000 },
      },
      collection: { devicePixelRatio: 2, eligibleCount: 3, elements: [] },
    });
    const read = await page.collect(COLLECT_OPTIONS);
    expect(read).toEqual({
      innerWidth: 1200,
      innerHeight: 560,
      devicePixelRatio: 2,
      scrollX: 5,
      scrollY: 300,
      scrollWidth: 1210,
      scrollHeight: 7000,
      layoutWidth: 1200,
      eligibleCount: 3,
      elements: [],
    });
  });

  it.each([0, NaN, 1e9, -1, Infinity, "2"])("gives a ratio of 1 when the collector reports %s", async (ratio) => {
    const { page } = await connectedPage({ collection: { ...RAW_COLLECTION, devicePixelRatio: ratio } });
    const read = await page.collect(COLLECT_OPTIONS);
    expect(read.devicePixelRatio).toBe(1);
  });

  it.each([NaN, 0, -3, Infinity, 1e9, "wide", null])(
    "gives the browser viewport sizes when the layout metrics hold %s",
    async (bad) => {
      const { page } = await connectedPage({
        layoutMetrics: {
          cssLayoutViewport: { pageX: bad, pageY: bad, clientWidth: bad, clientHeight: bad },
          cssContentSize: { x: 0, y: 0, width: bad, height: bad },
        },
      });
      const read = await page.collect(COLLECT_OPTIONS);
      expect(read.innerWidth).toBe(BROWSER_VIEWPORT.width);
      expect(read.innerHeight).toBe(BROWSER_VIEWPORT.height);
      expect(read.layoutWidth).toBe(BROWSER_VIEWPORT.width);
      // A scroll offset is clamped, not replaced, so 1e9 gives the limit and the rest give 0.
      for (const offset of [read.scrollX, read.scrollY]) {
        expect(Number.isFinite(offset) && offset >= 0 && offset <= MAX_PLAUSIBLE_PX).toBe(true);
      }
      expect(Number.isFinite(read.scrollWidth) && read.scrollWidth > 0).toBe(true);
      expect(Number.isFinite(read.scrollHeight) && read.scrollHeight > 0).toBe(true);
    },
  );

  it("uses the browser viewport sizes when the layout metrics answer is not an object", async () => {
    const { page } = await connectedPage({ layoutMetrics: null });
    const read = await page.collect(COLLECT_OPTIONS);
    expect(read.innerWidth).toBe(BROWSER_VIEWPORT.width);
    expect(read.innerHeight).toBe(BROWSER_VIEWPORT.height);
    expect(read.devicePixelRatio).toBe(1);
  });

  it("maps a collector result that is not an object to page-read-failed", async () => {
    const { page } = await connectedPage({ collection: "not an object" });
    const failure = await failureOf(page.collect(COLLECT_OPTIONS));
    expect(failure.code).toBe("page-read-failed");
  });

  it("maps a collector result without an element list to page-read-failed", async () => {
    const { page } = await connectedPage({ collection: { devicePixelRatio: 1, eligibleCount: 0 } });
    const failure = await failureOf(page.collect(COLLECT_OPTIONS));
    expect(failure.code).toBe("page-read-failed");
  });

  it.each(["Page.getFrameTree", "Page.createIsolatedWorld", "Runtime.callFunctionOn", "Page.getLayoutMetrics"])(
    "maps a failing %s during collect to page-read-failed with a redacted detail",
    async (method) => {
      const { page } = await connectedPage({
        cdpScript: { [method]: new Error(`${method} failed: ${API_KEY} ${SESSION_ID} ${CDP_URL} ${LIVE_URL}`) },
      });
      const failure = await failureOf(page.collect(COLLECT_OPTIONS));
      expect(failure.code).toBe("page-read-failed");
      expect(failure.detail ?? "").toContain(method);
      expectNoSecrets(failure.message);
      expectNoSecrets(failure.detail ?? "");
    },
  );

  it("maps an exception of the collector to page-read-failed with a redacted detail", async () => {
    const { page } = await connectedPage({
      cdpScript: {
        "Runtime.callFunctionOn": {
          result: {},
          exceptionDetails: { text: "Uncaught", exception: { description: `Error: ${API_KEY} ${LIVE_URL}` } },
        },
      },
    });
    const failure = await failureOf(page.collect(COLLECT_OPTIONS));
    expect(failure.code).toBe("page-read-failed");
    expectNoSecrets(failure.detail ?? "");
  });

  it("takes a clipped JPEG screenshot with css scale, disabled animations and fullPage", async () => {
    const { fake, page } = await connectedPage();
    const bytes = await page.screenshot({
      kind: "clip",
      clip: { x: 0, y: 0, width: 1280, height: 5000 },
      quality: 70,
    });

    expect(fake.firstPage.screenshot).toHaveBeenCalledTimes(1);
    expect(fake.firstPage.screenshot).toHaveBeenCalledWith({
      type: "jpeg",
      quality: 70,
      scale: "css",
      animations: "disabled",
      fullPage: true,
      clip: { x: 0, y: 0, width: 1280, height: 5000 },
    });
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBeGreaterThan(0);
  });

  it("takes a viewport-only screenshot without a clip", async () => {
    const { fake, page } = await connectedPage();
    await page.screenshot({ kind: "viewport", quality: 70 });

    expect(fake.firstPage.screenshot).toHaveBeenCalledWith({
      type: "jpeg",
      quality: 70,
      scale: "css",
      animations: "disabled",
      fullPage: false,
    });
    const options = fake.firstPage.screenshot.mock.calls[0][0] as Record<string, unknown>;
    expect("clip" in options).toBe(false);
  });

  it("maps a screenshot error to screenshot-failed", async () => {
    const { page } = await connectedPage({ screenshotError: new Error(`render failed ${CDP_URL}`) });
    const failure = await failureOf(page.screenshot({ kind: "viewport", quality: 70 }));
    expect(failure.code).toBe("screenshot-failed");
    expectNoSecrets(failure.detail ?? "");
  });

  it("scrolls in an isolated world and returns the scrollY read back from the page", async () => {
    const { fake, page } = await connectedPage({ scrollY: 2200 });
    fake.cdp.calls.length = 0;
    const real = await page.scrollTo(2400);

    expect(fake.cdp.calls.map((call) => call.method)).toEqual([
      "Page.getFrameTree",
      "Page.createIsolatedWorld",
      "Runtime.callFunctionOn",
    ]);
    expect(fake.cdp.callsOf("Runtime.callFunctionOn")[0].params).toEqual({
      executionContextId: 1,
      functionDeclaration: String(scrollInPage),
      arguments: [{ value: 2400 }],
      returnByValue: true,
      awaitPromise: true,
    });
    expect(real).toBe(2200);
  });

  it.each([NaN, Infinity, "2200", null, undefined])("returns 0 when the scroll reports %s", async (reported) => {
    const { page } = await connectedPage({ scrollY: reported });
    await expect(page.scrollTo(100)).resolves.toBe(0);
  });

  it("maps a scroll error to screenshot-failed with a redacted detail", async () => {
    const { page } = await connectedPage({ callError: new Error(`gone ${API_KEY} ${LIVE_URL}`) });
    const failure = await failureOf(page.scrollTo(100));
    expect(failure.code).toBe("screenshot-failed");
    expectNoSecrets(failure.detail ?? "");
  });

  it("never reads viewportSize", async () => {
    const { fake, page } = await connectedPage();
    await page.installGuards(createGuards({ allowed: true }).guards);
    await page.goto("https://shop.example.com/", { timeoutMs: 1000 });
    await page.collect(COLLECT_OPTIONS);
    await page.scrollTo(0);
    await page.screenshot({ kind: "viewport", quality: 70 });
    await page.reload({ timeoutMs: 1000 });
    expect(fake.firstPage.viewportSize).not.toHaveBeenCalled();
  });
});

describe("stop", () => {
  it("sends the stop request first and then disconnects", async () => {
    const events: string[] = [];
    const fake = createFakePlaywright({ events });
    const clock = createManualClock();
    const fetchFake = createFakeFetch({ events, clock });
    const provider = createRemoteBrowser(CONFIG, {
      fetch: fetchFake.fetch,
      clock,
      loadPlaywright: fake.loadPlaywright,
    });
    const handle = await provider.createSession(SESSION_REQUEST);
    await handle.connect({ timeoutMs: 15_000 });

    await handle.stop();

    expect(events).toEqual(["patch", "close"]);
    const patch = fetchFake.calls.find((call) => call.method === "PATCH");
    expect(patch?.url).toBe(`https://api.browser-use.com/api/v4/browsers/${SESSION_ID}`);
    expect(JSON.parse(patch?.body ?? "{}")).toEqual({ action: "stop" });
  });

  it("still closes the connection when the stop request fails, and then rejects without secrets", async () => {
    const harness = await openSession({}, { stopError: new Error(`network down ${API_KEY} ${SESSION_ID}`) });
    await harness.handle.connect({ timeoutMs: 15_000 });

    const error = await harness.handle.stop().then(
      () => undefined,
      (e: unknown) => e as Error,
    );

    expect(error).toBeInstanceOf(Error);
    expectNoSecrets(String((error as Error).message));
    expect(harness.fake.browser.close).toHaveBeenCalledTimes(1);
  });

  it("still closes the connection when the stop request answers with a non-2xx status, then rejects", async () => {
    const harness = await openSession({}, { stopStatus: 500 });
    await harness.handle.connect({ timeoutMs: 15_000 });

    await expect(harness.handle.stop()).rejects.toBeInstanceOf(Error);

    expect(harness.fake.browser.close).toHaveBeenCalledTimes(1);
  });

  it("resolves when the disconnect fails", async () => {
    const { handle, fetchFake } = await openSession({ closeError: new Error("socket already closed") });
    await handle.connect({ timeoutMs: 15_000 });
    await expect(handle.stop()).resolves.toBeUndefined();
    expect(fetchFake.calls.filter((call) => call.method === "PATCH")).toHaveLength(1);
  });

  it("resolves after the stop request when the disconnect hangs", async () => {
    const harness = await openSession();
    await harness.handle.connect({ timeoutMs: 15_000 });
    harness.fake.browser.close.mockImplementation(() => new Promise<void>(() => {}));

    let settled = false;
    const stopped = harness.handle.stop().then(() => {
      settled = true;
    });
    await flush();
    expect(harness.fetchFake.calls.filter((call) => call.method === "PATCH")).toHaveLength(1);
    expect(settled).toBe(false);

    harness.clock.advance(DISCONNECT_TIMEOUT_MS);
    await stopped;
    expect(settled).toBe(true);
  });

  it("gives the disconnect only what is left of the stop budget", async () => {
    const harness = await openSession({}, { stopDelayMs: 8_000 });
    await harness.handle.connect({ timeoutMs: 15_000 });
    harness.fake.browser.close.mockImplementation(() => new Promise<void>(() => {}));

    let settled = false;
    void harness.handle.stop().then(() => {
      settled = true;
    });
    await flush();
    harness.clock.advance(8_000);
    await flush();
    expect(settled).toBe(false);

    // 10,000 ms of budget minus the 8,000 ms the request took is less than the 3,000 ms disconnect limit.
    harness.clock.advance(1_999);
    await flush();
    expect(settled).toBe(false);
    harness.clock.advance(1);
    await flush();
    expect(settled).toBe(true);
  });

  it("ends the whole call within the stop budget when the stop request hangs", async () => {
    const harness = await openSession({}, { stopHangs: true });
    await harness.handle.connect({ timeoutMs: 15_000 });
    harness.fake.browser.close.mockImplementation(() => new Promise<void>(() => {}));

    let outcome: "pending" | "resolved" | "rejected" = "pending";
    void harness.handle.stop().then(
      () => {
        outcome = "resolved";
      },
      () => {
        outcome = "rejected";
      },
    );
    await flush();
    harness.clock.advance(STOP_TIMEOUT_MS - 1);
    await flush();
    expect(outcome).toBe("pending");
    harness.clock.advance(1);
    await flush();
    expect(outcome).toBe("rejected");
  });

  it("sends the stop request when it was never connected", async () => {
    const { handle, fetchFake, fake } = await openSession();
    await handle.stop();
    expect(fake.browser.close).not.toHaveBeenCalled();
    expect(fetchFake.calls.filter((call) => call.method === "PATCH")).toHaveLength(1);
  });

  it("rejects when the stop request returns a non-2xx status, without secrets", async () => {
    const { handle } = await openSession({}, { stopStatus: 500 });
    const error = await handle.stop().then(
      () => undefined,
      (e: unknown) => e as Error,
    );
    expect(error).toBeInstanceOf(Error);
    expectNoSecrets(String((error as Error).message));
  });

  it("rejects when the stop request fails, without secrets", async () => {
    const { handle } = await openSession({}, { stopError: new Error(`network down ${API_KEY} ${SESSION_ID}`) });
    const error = await handle.stop().then(
      () => undefined,
      (e: unknown) => e as Error,
    );
    expect(error).toBeInstanceOf(Error);
    expectNoSecrets(String((error as Error).message));
  });
});

describe("secrets", () => {
  it("keeps the handle and the page free of session addresses when serialised", async () => {
    const { handle, page } = await connectedPage();
    expectNoSecrets(JSON.stringify(handle));
    expectNoSecrets(JSON.stringify(page));
  });

  it("lists the API key, the session id, the CDP address and the live address", async () => {
    const { handle } = await openSession();
    const secrets = handle.secrets();
    expect(secrets).toHaveLength(4);
    expect([...secrets].sort()).toEqual([API_KEY, SESSION_ID, CDP_URL, LIVE_URL].sort());
  });

  it("leaves out a live address the session did not report", async () => {
    const fetchFake = {
      fetch: (async (_input: string | URL | Request, init?: RequestInit) =>
        new Response(init?.method === "POST" ? JSON.stringify({ id: SESSION_ID, cdpUrl: CDP_URL }) : "{}", {
          status: 200,
        })) as unknown as typeof fetch,
    };
    const provider = createRemoteBrowser(CONFIG, {
      fetch: fetchFake.fetch,
      clock: createManualClock(),
      loadPlaywright: async () => ({}),
    });
    const handle = await provider.createSession(SESSION_REQUEST);
    expect([...handle.secrets()].sort()).toEqual([API_KEY, SESSION_ID, CDP_URL].sort());
  });
});

describe("capture id and reclaim", () => {
  it("sends the capture id of the session request in the create body", async () => {
    const { fetchFake } = await openSession();
    const body = JSON.parse(fetchFake.calls[0].body) as { metadata: unknown };
    expect(body.metadata).toEqual({ app: "trick-or-trap", captureId: SESSION_REQUEST.captureId });
  });

  it("reclaims by listing the active sessions and stopping the one with the capture id", async () => {
    const calls: FetchCall[] = [];
    const fakeFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({ url: String(input), method, body: String(init?.body ?? "") });
      if (method === "GET") {
        return new Response(
          JSON.stringify({
            items: [
              { id: "mine", metadata: { app: "trick-or-trap", captureId: "capture-id-sentinel" } },
              { id: "other", metadata: { app: "trick-or-trap", captureId: "someone-else" } },
            ],
          }),
          { status: 200 },
        );
      }
      return new Response("{}", { status: 200 });
    });
    const provider = createRemoteBrowser(CONFIG, {
      fetch: fakeFetch as unknown as typeof fetch,
      clock: createManualClock(),
      loadPlaywright: async () => ({}),
    });

    await provider.reclaim?.("capture-id-sentinel");

    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      "GET https://api.browser-use.com/api/v4/browsers?status=active",
      "PATCH https://api.browser-use.com/api/v4/browsers/mine",
    ]);
  });

  it("does nothing when there is no API key", async () => {
    const fetchFake = createFakeFetch();
    const provider = createRemoteBrowser(
      { ...CONFIG, apiKey: null },
      { fetch: fetchFake.fetch, clock: createManualClock(), loadPlaywright: async () => ({}) },
    );

    await expect(provider.reclaim?.("capture-id-sentinel")).resolves.toBeUndefined();

    expect(fetchFake.calls).toEqual([]);
  });
});
