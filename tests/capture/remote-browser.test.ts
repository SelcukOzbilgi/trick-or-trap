import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { collectInPage } from "@/lib/capture/extractor";
import { COLLECT_LIMITS, STOP_TIMEOUT_MS } from "@/lib/capture/constants";
import { createRemoteBrowser, DISCONNECT_TIMEOUT_MS } from "@/lib/capture/remote-browser";
import type { CaptureConfig } from "@/lib/capture/config";
import type { BrowserSessionHandle, CapturePage, GuardEvent, GuardVerdict, PageGuards } from "@/lib/capture/seam";
import { CaptureFailure } from "@/lib/capture/types";
import type { CollectOptions, RawPageRead } from "@/lib/capture/types";
import { createFakeCdp, type CdpScript } from "./helpers/fake-cdp";
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

const RAW_READ: RawPageRead = {
  innerWidth: 1280,
  innerHeight: 800,
  devicePixelRatio: 1,
  scrollX: 0,
  scrollY: 0,
  scrollWidth: 1280,
  scrollHeight: 2000,
  eligibleCount: 0,
  elements: [],
};

type AnyFn = (...args: never[]) => unknown;

const MAIN_FRAME_ID = "main-frame-1";

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
  evaluateError?: Error;
  scrollY?: number;
  finalUrl?: string;
  events?: string[];
};

function createFakePlaywright(options: FakePlaywrightOptions = {}) {
  const events = options.events ?? [];
  const cdp = createFakeCdp({
    "Page.getFrameTree": { frameTree: { frame: { id: MAIN_FRAME_ID } } },
    ...options.cdpScript,
  });
  // The shape of a Playwright CDPSession: `send` and `on` by event name.
  const cdpSession = {
    send: vi.fn((method: string, params?: Record<string, unknown>, targetSessionId?: string) =>
      cdp.send(method, params, targetSessionId),
    ),
    on: vi.fn((name: string, handler: (params: unknown) => unknown) => {
      cdp.onEvent(async (event) => {
        if (event.method === name && event.targetSessionId === undefined) await handler(event.params);
      });
    }),
  };
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
    evaluate: vi.fn(async (fn: unknown, _arg: unknown) => {
      if (options.evaluateError) throw options.evaluateError;
      if (fn === collectInPage) return RAW_READ;
      return options.scrollY ?? 0;
    }),
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
  it("runs the request guard through the CDP session of the page, in order", async () => {
    const { fake, page } = await connectedPage();
    const { guards } = createGuards({ allowed: true });
    await page.installGuards(guards);

    expect(fake.context.newCDPSession).toHaveBeenCalledTimes(1);
    expect(fake.context.newCDPSession).toHaveBeenCalledWith(fake.firstPage);
    expect(fake.cdp.calls.map((call) => call.method)).toEqual([
      "Network.setBypassServiceWorker",
      "Page.getFrameTree",
      "Fetch.enable",
      "Target.setAutoAttach",
    ]);
    expect(fake.cdp.callsOf("Fetch.enable")[0].params).toEqual({
      patterns: [{ urlPattern: "*", requestStage: "Request" }],
    });
  });

  it("registers the event handlers before the first command", async () => {
    const { fake, page } = await connectedPage();
    await page.installGuards(createGuards({ allowed: true }).guards);
    expect(fake.cdp.handlersAtFirstSend).toBeGreaterThan(0);
  });

  it("never calls route on the context or the page", async () => {
    const { fake, page } = await connectedPage();
    await page.installGuards(createGuards({ allowed: true }).guards);
    expect("route" in fake.context).toBe(false);
    expect("route" in fake.firstPage).toBe(false);
    expect("routeWebSocket" in fake.context).toBe(false);
  });

  it("continues a paused request that the guards allow", async () => {
    const { fake, page } = await connectedPage();
    const { guards, checkHost, events } = createGuards({ allowed: true });
    await page.installGuards(guards);

    await fake.cdp.emit("Fetch.requestPaused", {
      requestId: "req-1",
      request: { url: "https://shop.example.com/a" },
      resourceType: "Document",
      frameId: MAIN_FRAME_ID,
    });

    expect(checkHost).toHaveBeenCalledWith("https://shop.example.com/a");
    expect(fake.cdp.callsOf("Fetch.continueRequest").map((call) => call.params)).toEqual([{ requestId: "req-1" }]);
    expect(fake.cdp.callsOf("Fetch.failRequest")).toEqual([]);
    expect(events).toEqual([]);
  });

  it("fails a paused main-frame request that the guards refuse and reports it without a URL", async () => {
    const { fake, page } = await connectedPage();
    const { guards, events } = createGuards({ allowed: false, reason: "url-address-blocked" });
    await page.installGuards(guards);

    await fake.cdp.emit("Fetch.requestPaused", {
      requestId: "req-2",
      request: { url: "http://10.0.0.1/" },
      resourceType: "Document",
      frameId: MAIN_FRAME_ID,
    });

    expect(fake.cdp.callsOf("Fetch.failRequest").map((call) => call.params)).toEqual([
      { requestId: "req-2", errorReason: "BlockedByClient" },
    ]);
    expect(fake.cdp.callsOf("Fetch.continueRequest")).toEqual([]);
    expect(events).toEqual([{ kind: "request-blocked", reason: "url-address-blocked", mainFrame: true }]);
    expect(JSON.stringify(events)).not.toContain("10.0.0.1");
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

    await fake.cdp.emit("Fetch.requestPaused", {
      requestId: "req-3",
      request: { url: "https://shop.example.com/" },
      resourceType: "Image",
      frameId: MAIN_FRAME_ID,
    });

    expect(fake.cdp.callsOf("Fetch.failRequest")).toHaveLength(1);
    expect(events).toEqual([{ kind: "request-blocked", reason: "url-invalid", mainFrame: false }]);
  });

  it.each(["Network.setBypassServiceWorker", "Fetch.enable", "Target.setAutoAttach"])(
    "maps a failing %s to connect-failed and keeps every secret out of the detail",
    async (method) => {
      const { page } = await connectedPage({
        cdpScript: {
          [method]: new Error(`${method} refused: key=${API_KEY} id=${SESSION_ID} cdp=${CDP_URL} live=${LIVE_URL}`),
        },
      });
      const failure = await failureOf(page.installGuards(createGuards({ allowed: true }).guards));
      expect(failure.code).toBe("connect-failed");
      expectNoSecrets(failure.message);
      expectNoSecrets(failure.detail ?? "");
      expect(failure.detail ?? "").toContain(method);
    },
  );

  it("maps a failing newCDPSession to connect-failed with a redacted detail", async () => {
    const { fake, page } = await connectedPage();
    fake.context.newCDPSession.mockRejectedValueOnce(new Error(`no session for ${API_KEY} ${LIVE_URL}`));
    const failure = await failureOf(page.installGuards(createGuards({ allowed: true }).guards));
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
  it("collects everything with exactly one evaluate call", async () => {
    const { fake, page } = await connectedPage();
    const read = await page.collect(COLLECT_OPTIONS);

    expect(fake.firstPage.evaluate).toHaveBeenCalledTimes(1);
    expect(fake.firstPage.evaluate).toHaveBeenCalledWith(collectInPage, COLLECT_OPTIONS);
    expect(read).toEqual(RAW_READ);
  });

  it("maps an evaluate error to page-read-failed with a redacted detail", async () => {
    const { page } = await connectedPage({ evaluateError: new Error(`Execution context was destroyed ${API_KEY}`) });
    const failure = await failureOf(page.collect(COLLECT_OPTIONS));
    expect(failure.code).toBe("page-read-failed");
    expectNoSecrets(failure.detail ?? "");
  });

  it("takes a clipped JPEG screenshot with css scale and fullPage", async () => {
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

  it("scrolls with one evaluate call and returns the scrollY read back from the page", async () => {
    const { fake, page } = await connectedPage({ scrollY: 2200 });
    const real = await page.scrollTo(2400);

    expect(fake.firstPage.evaluate).toHaveBeenCalledTimes(1);
    expect(fake.firstPage.evaluate.mock.calls[0][1]).toBe(2400);
    expect(real).toBe(2200);
  });

  it("maps a scroll error to screenshot-failed", async () => {
    const { page } = await connectedPage({ evaluateError: new Error("gone") });
    const failure = await failureOf(page.scrollTo(100));
    expect(failure.code).toBe("screenshot-failed");
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
