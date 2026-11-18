import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const getCaptureConfigMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/capture/config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/capture/config")>()),
  getCaptureConfig: getCaptureConfigMock,
}));

import { capturePage, type CaptureDeps } from "@/lib/capture/capture";
import type { CaptureConfig } from "@/lib/capture/config";
import { COLLECT_LIMITS, LAYOUT_DRIFT_PX, MAX_ATTR_NAME_CHARS, TILE_MIN_REMAINING_MS } from "@/lib/capture/constants";
import { createRemoteBrowser } from "@/lib/capture/remote-browser";
import type { BrowserProvider, BrowserSessionHandle, GetBrowserResult } from "@/lib/capture/seam";
import { CaptureFailure, type CaptureResult, type RawElement } from "@/lib/capture/types";
import type { Resolver } from "@/lib/capture/url-check";
import { PageSnapshotSchema } from "@/lib/types";
import { createFakeBrowser, createRawPageRead, type FakeBrowser, type FakeScript } from "./helpers/fake-browser";
import { createManualClock, type ManualClock } from "./helpers/manual-clock";

const SECRET_KEY = "sk-test-sentinel";
const URL_OK = "https://shop.example.com/";

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

function configFor(overrides: Partial<CaptureConfig> = {}): CaptureConfig {
  return {
    browserMode: "remote",
    apiKey: SECRET_KEY,
    proxy: "off",
    sessionTimeoutMinutes: 2,
    allowOrigin: null,
    ...overrides,
  };
}

function createResolver(answers: Record<string, readonly string[] | Error> = {}) {
  const calls: string[] = [];
  const resolver: Resolver = {
    async resolveAddresses(hostname) {
      calls.push(hostname);
      const answer = answers[hostname] ?? ["93.184.216.34"];
      if (answer instanceof Error) throw answer;
      return answer;
    },
  };
  return { resolver, calls };
}

function element(path: number[], rect: Partial<RawElement["rect"]> = {}, text = "Hello"): RawElement {
  return {
    path,
    tag: "p",
    role: null,
    text,
    textTruncated: false,
    rect: { left: 10, top: 100, width: 200, height: 20, ...rect },
    style: {
      color: "rgb(0, 0, 0)",
      backgroundColor: "rgba(0, 0, 0, 0)",
      fontSize: "16px",
      opacity: "1",
      display: "block",
      visibility: "visible",
      position: "static",
    },
    checked: false,
    selected: false,
    attrs: {},
  };
}

function setup(script: FakeScript = {}, depsOverrides: Partial<CaptureDeps> = {}) {
  const clock = createManualClock();
  const fake = createFakeBrowser(script);
  const { resolver, calls: resolverCalls } = createResolver();
  const getBrowser = vi.fn((): GetBrowserResult => ({ ok: true, browser: fake.provider }));
  const deps: Partial<CaptureDeps> = { config: configFor(), getBrowser, resolver, clock, ...depsOverrides };
  return { clock, fake, getBrowser, resolverCalls, deps };
}

/** Runs a capture to the end, advancing the manual clock whenever it waits on a timer. */
async function drive(promise: Promise<CaptureResult>, clock: ManualClock): Promise<CaptureResult> {
  let done = false;
  void promise.then(
    () => (done = true),
    () => (done = true),
  );
  for (let i = 0; i < 200 && !done; i++) {
    await tick();
    if (done) break;
    if (clock.pendingTimers > 0) clock.advance(500);
  }
  return promise;
}

afterEach(() => {
  vi.restoreAllMocks();
  getCaptureConfigMock.mockReset();
});

describe("capturePage: success", () => {
  it("returns a valid snapshot and one image for a short page", async () => {
    const raw = createRawPageRead({
      scrollHeight: 1_200,
      scrollWidth: 1_280,
      scrollY: 0,
      eligibleCount: 1,
      elements: [element([1, 0, 3])],
    });
    const { clock, fake, deps } = setup({ collect: raw });
    const start = clock.now();

    const result = await drive(capturePage(URL_OK, deps), clock);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(PageSnapshotSchema.safeParse(result.snapshot).success).toBe(true);
    expect(result.snapshot.url).toBe(URL_OK);
    expect(result.snapshot.capturedAt).toBe(new Date(start + 500).toISOString());
    expect(result.snapshot.viewportWidth).toBe(1280);
    expect(result.snapshot.fullHeight).toBe(1_200);
    expect(result.snapshot.screenshotRef).toBeUndefined();
    expect(result.snapshot.afterReload).toBeDefined(); // the reload sample is covered by capture-reload.test.ts
    expect(result.snapshot.secondSample).toBeUndefined();
    expect(result.snapshot.elements).toHaveLength(1);
    expect(result.snapshot.elements[0]).toMatchObject({
      id: "el-1-0-3",
      boundingBox: { x: 10, y: 100, width: 200, height: 20 },
      outsideImage: false,
    });

    expect(result.images).toHaveLength(1);
    expect(result.images[0]).toMatchObject({ offsetY: 0, width: 1280, height: 1_200, base64Length: 8 });
    expect(result.images[0].bytes).toBeInstanceOf(Uint8Array);
    expect(result.snapshot.capture?.images).toEqual({
      mode: "single",
      truncated: false,
      items: [{ offsetY: 0, width: 1280, height: 1_200 }],
    });
    expect(result.snapshot.capture).toMatchObject({ light: false, elementsTruncated: false, eligibleElementCount: 1 });
    expect(result.warnings).toEqual([]);

    expect(fake.calls).toEqual([
      "createSession",
      "connect",
      "installGuards",
      "goto",
      "collect",
      "screenshot",
      "collect", // the layout drift re-read
      "reload",
      "collect",
      "stop",
    ]);
    expect(fake.createCalls).toBe(1);
    expect(fake.stopCalls).toBe(1);
    expect(fake.sessionRequests[0]).toEqual({
      timeoutMinutes: 2,
      proxy: "off",
      viewport: { width: 1280, height: 800 },
      captureId: expect.any(String),
    });
    expect(fake.gotoUrls).toEqual([URL_OK]);
    expect(fake.collectOptions[0]).toEqual({
      maxElements: 1_500,
      maxTextChars: 300,
      maxAttrChars: 200,
      attributeNames: "full",
      limits: COLLECT_LIMITS,
    });
  });

  it("passes the session settings of the configuration on", async () => {
    const { clock, fake, deps } = setup({}, { config: configFor({ proxy: "on", sessionTimeoutMinutes: 4 }) });
    await drive(capturePage(URL_OK, deps), clock);
    expect(fake.sessionRequests[0]).toMatchObject({ timeoutMinutes: 4, proxy: "on" });
  });

  it("waits 500 ms after load, then reads the page once, then takes the screenshots", async () => {
    const { clock, fake, deps } = setup();
    const promise = capturePage(URL_OK, deps);

    await tick();
    expect(fake.calls).toContain("goto");
    expect(fake.calls).not.toContain("collect");
    clock.advance(499);
    await tick();
    expect(fake.calls).not.toContain("collect");
    clock.advance(1);
    await tick();
    clock.advance(500); // the settle delay after the reload (task 14)
    await tick();

    const result = await promise;
    expect(result.ok).toBe(true);
    // The first read, the layout drift re-read and the reload sample.
    expect(fake.calls.filter((call) => call === "collect")).toHaveLength(3);
    expect(fake.calls.indexOf("collect")).toBeLessThan(fake.calls.indexOf("screenshot"));
    expect(fake.calls.indexOf("goto")).toBeLessThan(fake.calls.indexOf("collect"));
  });

  it("captures a 45,000 px page as tiles and warns", async () => {
    const { clock, fake, deps } = setup({ collect: createRawPageRead({ scrollHeight: 45_000 }) });

    const result = await drive(capturePage(URL_OK, deps), clock);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.images).toHaveLength(10);
    expect(result.snapshot.fullHeight).toBe(45_000);
    expect(result.snapshot.capture?.images).toMatchObject({ mode: "tiled", truncated: true });
    expect(result.snapshot.capture?.images?.items).toHaveLength(10);
    expect(result.warnings.map((warning) => warning.code)).toEqual(["tall-page-tiled", "screenshot-truncated"]);
    expect(fake.screenshotRequests.every((request) => request.kind === "viewport")).toBe(true);
    // The elements are read before the first scroll.
    expect(fake.calls.indexOf("collect")).toBeLessThan(fake.calls.indexOf("scrollTo"));
  });

  it("warns when a 20,000 px page is cut to one 8,000 px image", async () => {
    const { clock, deps } = setup({ collect: createRawPageRead({ scrollHeight: 20_000 }) });
    const result = await drive(capturePage(URL_OK, deps), clock);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.images[0].height).toBe(8_000);
    expect(result.snapshot.fullHeight).toBe(20_000);
    expect(result.warnings.map((warning) => warning.code)).toEqual(["screenshot-truncated"]);
  });

  it("flags elements outside a single cropped image", async () => {
    const raw = createRawPageRead({
      scrollHeight: 20_000,
      eligibleCount: 2,
      elements: [element([0], { top: 100 }), element([1], { top: 9_000 })],
    });
    const { clock, deps } = setup({ collect: raw });
    const result = await drive(capturePage(URL_OK, deps), clock);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.elements.map((item) => item.outsideImage)).toEqual([false, true]);
  });

  it("flags elements against all tiles, not only the first", async () => {
    const raw = createRawPageRead({
      scrollHeight: 45_000,
      eligibleCount: 3,
      elements: [element([0], { top: 100 }), element([1], { top: 4_100 }), element([2], { top: 20_000 })],
    });
    const { clock, deps } = setup({ collect: raw });
    const result = await drive(capturePage(URL_OK, deps), clock);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.elements.map((item) => item.outsideImage)).toEqual([false, false, true]);
  });

  it("warns when the page has more eligible elements than the cap", async () => {
    const raw = createRawPageRead({ eligibleCount: 2_000, elements: [element([0])] });
    const { clock, deps } = setup({ collect: raw });
    const result = await drive(capturePage(URL_OK, deps), clock);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.capture).toMatchObject({ elementsTruncated: true, eligibleElementCount: 2_000 });
    expect(result.warnings.map((warning) => warning.code)).toEqual(["elements-truncated"]);
  });

  it("warns about a redirect and records the final URL", async () => {
    const { clock, deps } = setup({
      goto: { finalUrl: "https://shop.example.com/final?x=1" },
      reload: { finalUrl: "https://shop.example.com/final?x=1" },
    });
    const result = await drive(capturePage(URL_OK, deps), clock);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.url).toBe("https://shop.example.com/final?x=1");
    expect(result.warnings.map((warning) => warning.code)).toEqual(["redirected"]);
  });

  it("does not call a fragment-only difference a redirect", async () => {
    const { clock, fake, deps } = setup({
      goto: { finalUrl: "https://shop.example.com/#section" },
      reload: { finalUrl: "https://shop.example.com/#section" },
    });
    const result = await drive(capturePage("https://shop.example.com/#top", deps), clock);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(fake.gotoUrls).toEqual([URL_OK]);
    expect(result.snapshot.url).toBe(URL_OK);
    expect(result.warnings).toEqual([]);
  });

  it("turns guard events into warnings without a URL", async () => {
    const holder: { fake?: FakeBrowser } = {};
    const { clock, fake, deps } = setup({
      goto: (_callNumber, requestedUrl) => {
        holder.fake?.emit({ kind: "popup-closed" });
        holder.fake?.emit({ kind: "download-refused" });
        holder.fake?.emit({ kind: "download-refused" });
        return { finalUrl: requestedUrl };
      },
      reload: { finalUrl: URL_OK },
    });
    holder.fake = fake;

    const result = await drive(capturePage(URL_OK, deps), clock);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings.map((warning) => warning.code)).toEqual(["popup-closed", "download-refused"]);
    for (const warning of result.warnings) {
      expect(Object.keys(warning).sort()).toEqual(["code", "message"]);
      expect(warning.message).not.toMatch(/https?:/);
    }
  });
});

describe("capturePage: refusals before any session", () => {
  it.each([
    { input: `https://shop.example.com/${"a".repeat(2_100)}`, code: "url-too-long" },
    { input: "not a url", code: "url-invalid" },
    { input: "ftp://shop.example.com/", code: "url-scheme-blocked" },
    { input: "https://user:pw@shop.example.com/", code: "url-credentials-blocked" },
    { input: "https://shop.example.com:8080/", code: "url-port-blocked" },
    { input: "http://localhost/", code: "url-host-blocked" },
    { input: "http://10.0.0.1/", code: "url-address-blocked" },
  ])("refuses $code", async ({ input, code }) => {
    const { clock, fake, getBrowser, resolverCalls, deps } = setup();

    const result = await drive(capturePage(input, deps), clock);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe(code);
    expect(result.error.message.length).toBeGreaterThan(0);
    expect(fake.createCalls).toBe(0);
    expect(fake.stopCalls).toBe(0);
    expect(getBrowser).not.toHaveBeenCalled();
    expect(resolverCalls).toEqual([]);
  });

  it("refuses a host name that resolves to a private address", async () => {
    const { resolver } = createResolver({ "shop.example.com": ["10.1.2.3"] });
    const { clock, fake, getBrowser, deps } = setup({}, { resolver });
    const result = await drive(capturePage(URL_OK, deps), clock);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("url-address-blocked");
    expect(fake.createCalls).toBe(0);
    expect(getBrowser).not.toHaveBeenCalled();
  });

  it("refuses a host name that does not resolve", async () => {
    const { resolver } = createResolver({ "shop.example.com": new Error("ENOTFOUND") });
    const { clock, fake, deps } = setup({}, { resolver });
    const result = await drive(capturePage(URL_OK, deps), clock);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("dns-failed");
    expect(fake.createCalls).toBe(0);
  });

  it("refuses the allowed origin when it resolves to a private address", async () => {
    const { resolver } = createResolver({ "demo.example.com": ["10.0.0.9"] });
    const { clock, fake, deps } = setup({}, { resolver, config: configFor({ allowOrigin: "https://demo.example.com" }) });
    const result = await drive(capturePage("https://demo.example.com/boo-tique", deps), clock);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("url-address-blocked");
    expect(fake.createCalls).toBe(0);
  });

  it("returns browser-mode-unsupported from an injected getBrowser", async () => {
    const getBrowser = vi.fn(
      (): GetBrowserResult => ({
        ok: false,
        error: { code: "browser-mode-unsupported", message: "The configured browser mode is not supported." },
      }),
    );
    const { clock, fake, deps } = setup({}, { getBrowser });
    const result = await drive(capturePage(URL_OK, deps), clock);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("browser-mode-unsupported");
      expect(result.error.message).toBe("The configured browser mode is not supported.");
    }
    expect(fake.createCalls).toBe(0);
  });

  it("returns browser-mode-unsupported through the default getBrowser for mode local", async () => {
    const { clock, deps } = setup({}, { getBrowser: undefined, config: configFor({ browserMode: "local" }) });
    const result = await drive(capturePage(URL_OK, deps), clock);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("browser-mode-unsupported");
  });

  it("returns config-invalid when the environment configuration is invalid", async () => {
    getCaptureConfigMock.mockReturnValue({
      ok: false,
      error: { code: "config-invalid", message: "Invalid capture environment: BROWSER_USE_API_KEY" },
    });
    const { clock, fake, getBrowser, deps } = setup({}, { config: undefined });

    const result = await drive(capturePage(URL_OK, deps), clock);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("config-invalid");
    expect(result.error.message).toBe("The capture configuration is invalid.");
    expect(result.error.detail).toBe("Invalid capture environment: BROWSER_USE_API_KEY");
    expect(fake.createCalls).toBe(0);
    expect(getBrowser).not.toHaveBeenCalled();
  });

  it("uses the environment configuration when none is injected", async () => {
    getCaptureConfigMock.mockReturnValue({ ok: true, config: configFor({ allowOrigin: "https://demo.example.com" }) });
    const { clock, fake, deps } = setup({}, { config: undefined });
    const result = await drive(capturePage(URL_OK, deps), clock);
    expect(result.ok).toBe(true);
    expect(getCaptureConfigMock).toHaveBeenCalledTimes(1);
    expect(fake.createCalls).toBe(1);
  });
});

describe("capturePage: guards and final URL", () => {
  it("refuses a private hop, reports request-blocked and stops the session", async () => {
    const { clock, fake, deps } = setup({ hops: ["https://shop.example.com/", "http://10.0.0.1/"] });

    const result = await drive(capturePage(URL_OK, deps), clock);

    expect(result.ok).toBe(false);
    expect(result.warnings.map((warning) => warning.code)).toContain("request-blocked");
    expect(JSON.stringify(result.warnings)).not.toContain("10.0.0.1");
    expect(fake.stopCalls).toBe(1);
  });

  it("allows public hops and checks DNS once per origin", async () => {
    const { resolver, calls } = createResolver({ "evil.example.net": ["10.0.0.5"] });
    const { clock, fake, deps } = setup({}, { resolver });
    await drive(capturePage(URL_OK, deps), clock);
    const guards = fake.guards;
    expect(guards).toBeDefined();
    if (!guards) return;
    calls.length = 0;

    expect(await guards.checkHost("https://shop.example.com/a")).toEqual({ allowed: true });
    expect(await guards.checkHost("https://shop.example.com/b")).toEqual({ allowed: true });
    expect(calls.filter((host) => host === "shop.example.com").length).toBeLessThanOrEqual(1);

    expect(await guards.checkHost("http://10.0.0.1/")).toEqual({ allowed: false, reason: "url-address-blocked" });
    expect(await guards.checkHost("https://evil.example.net/")).toEqual({
      allowed: false,
      reason: "url-address-blocked",
    });
    // A cached verdict for one origin never covers another scheme or port of the same host.
    expect(await guards.checkHost("https://shop.example.com:8080/")).toEqual({
      allowed: false,
      reason: "url-port-blocked",
    });
    expect(await guards.checkHost("ftp://shop.example.com/")).toEqual({
      allowed: false,
      reason: "url-scheme-blocked",
    });
  });

  it("gives the browser a synchronous syntax check that does no DNS lookup", async () => {
    const { resolver, calls } = createResolver();
    const { clock, fake, deps } = setup({}, { resolver });
    await drive(capturePage(URL_OK, deps), clock);
    const guards = fake.guards;
    expect(guards).toBeDefined();
    if (!guards) return;
    calls.length = 0;

    expect(guards.checkSyntax("https://shop.example.com/a")).toEqual({ allowed: true });
    expect(guards.checkSyntax("ftp://shop.example.com/")).toEqual({ allowed: false, reason: "url-scheme-blocked" });
    expect(guards.checkSyntax("http://10.0.0.1/")).toEqual({ allowed: false, reason: "url-address-blocked" });
    expect(calls).toEqual([]);
  });

  it("returns navigation-blocked when the final URL is a private address", async () => {
    const { clock, fake, deps } = setup({ goto: { finalUrl: "http://10.0.0.1/admin" } });
    const result = await drive(capturePage(URL_OK, deps), clock);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("navigation-blocked");
    expect(fake.calls).not.toContain("collect");
    expect(fake.stopCalls).toBe(1);
  });

  it("returns navigation-blocked when the final host name resolves to a private address", async () => {
    const { resolver } = createResolver({ "internal.example.org": ["192.168.1.5"] });
    const { clock, deps } = setup({ goto: { finalUrl: "https://internal.example.org/" } }, { resolver });
    const result = await drive(capturePage(URL_OK, deps), clock);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("navigation-blocked");
  });

  it("returns navigation-blocked when the final URL has a scheme that is not http or https", async () => {
    const { clock, deps } = setup({ goto: { finalUrl: "chrome-error://chromewebdata/" } });
    const result = await drive(capturePage(URL_OK, deps), clock);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("navigation-blocked");
  });
});

describe("capturePage: validation", () => {
  it("returns snapshot-invalid when the assembled snapshot fails validation", async () => {
    // An implausible page metric is replaced and no longer invalid, so the failure is forced.
    const spy = vi
      .spyOn(PageSnapshotSchema, "safeParse")
      .mockReturnValueOnce({ success: false, error: { issues: [{ path: ["capture", "light"] }] } } as never);
    try {
      const { clock, fake, deps } = setup();
      const result = await drive(capturePage(URL_OK, deps), clock);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("snapshot-invalid");
      expect(result.error.message).toBe("The captured page data is invalid.");
      expect(fake.stopCalls).toBe(1);
      expect("images" in result).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });

  it("returns screenshot-too-large and no images", async () => {
    const { clock, fake, deps } = setup({ screenshot: new Uint8Array(3_145_729) });
    const result = await drive(capturePage(URL_OK, deps), clock);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("screenshot-too-large");
    expect(fake.stopCalls).toBe(1);
  });
});

describe("capturePage: logging", () => {
  it("calls no console method on success or on failure", async () => {
    const spies = (["log", "info", "warn", "error", "debug", "trace"] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => {}),
    );

    const ok = setup();
    await drive(capturePage(URL_OK, ok.deps), ok.clock);
    const failing = setup({ collect: createRawPageRead({ devicePixelRatio: 0 }), screenshot: new Error(SECRET_KEY) });
    await drive(capturePage(URL_OK, failing.deps), failing.clock);
    const refused = setup();
    await drive(capturePage("http://10.0.0.1/", refused.deps), refused.clock);

    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });
});

describe("capturePage: capture id", () => {
  it("gives two captures different ids", async () => {
    const first = setup();
    const second = setup();

    await drive(capturePage(URL_OK, first.deps), first.clock);
    await drive(capturePage(URL_OK, second.deps), second.clock);

    const a = first.fake.sessionRequests[0].captureId;
    const b = second.fake.sessionRequests[0].captureId;
    expect(typeof a).toBe("string");
    expect(a.length).toBeGreaterThan(0);
    expect(a).not.toBe(b);
  });

  it("does not derive the id from the URL or the API key", async () => {
    const { clock, fake, deps } = setup();

    await drive(capturePage(URL_OK, deps), clock);

    const id = fake.sessionRequests[0].captureId;
    expect(id).not.toContain(SECRET_KEY);
    expect(id).not.toContain("shop.example.com");
    expect(id).not.toContain("https");
  });

  it("uses the id of deps.newCaptureId when given", async () => {
    const { clock, fake, deps } = setup({}, { newCaptureId: () => "fixed-capture-id" });

    await drive(capturePage(URL_OK, deps), clock);

    expect(fake.sessionRequests[0].captureId).toBe("fixed-capture-id");
  });

  it("sends the id in the create body and never calls the list endpoint", async () => {
    const clock = createManualClock();
    const calls: { url: string; method: string; body: string }[] = [];
    const fakeFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({ url: String(input), method, body: String(init?.body ?? "") });
      if (method === "POST") {
        return new Response(
          JSON.stringify({ id: "sess-sentinel-1234", cdpUrl: "wss://abc.cdp.browser-use.com/x", liveUrl: null }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response("{}", { status: 200 });
    });
    const provider = createRemoteBrowser(configFor(), {
      fetch: fakeFetch as unknown as typeof fetch,
      clock,
      loadPlaywright: async () => {
        throw new Error("no browser in unit tests");
      },
    });
    const { resolver } = createResolver();
    const deps: Partial<CaptureDeps> = {
      config: configFor(),
      getBrowser: () => ({ ok: true, browser: provider }),
      resolver,
      clock,
    };

    const result = await drive(capturePage(URL_OK, deps), clock);

    expect(result.ok).toBe(false);
    expect(calls.map((call) => call.method)).toEqual(["POST", "PATCH"]);
    expect(calls.some((call) => call.url.includes("status="))).toBe(false);
    const body = JSON.parse(calls[0].body) as { metadata: { app: string; captureId: string } };
    expect(body.metadata.app).toBe("trick-or-trap");
    expect(typeof body.metadata.captureId).toBe("string");
    expect(body.metadata.captureId).not.toContain(SECRET_KEY);
    expect(body.metadata.captureId).not.toContain("shop.example.com");
  });
});

describe("capturePage: waitUntil", () => {
  it("hands the stop promise to waitUntil", async () => {
    const waitUntil = vi.fn();
    const { clock, fake, deps } = setup({}, { waitUntil });

    const result = await drive(capturePage(URL_OK, deps), clock);

    expect(result.ok).toBe(true);
    expect(waitUntil).toHaveBeenCalledTimes(1);
    const handed = waitUntil.mock.calls[0][0] as Promise<unknown>;
    expect(typeof handed.then).toBe("function");
    await expect(handed).resolves.toBeUndefined();
    expect(fake.stopCalls).toBe(1);
  });

  it("hands the stop promise over even when the stop fails", async () => {
    const waitUntil = vi.fn();
    const { clock, deps } = setup({ stop: new Error("stop failed") }, { waitUntil });

    const result = await drive(capturePage(URL_OK, deps), clock);

    expect(result.ok).toBe(true);
    expect(waitUntil).toHaveBeenCalledTimes(1);
    await expect(waitUntil.mock.calls[0][0] as Promise<unknown>).resolves.toBeUndefined();
  });

  it("hands the reclaim promise to waitUntil", async () => {
    const waitUntil = vi.fn();
    const fake = createFakeBrowser({
      createSession: new CaptureFailure("session-create-timeout", undefined, { reclaim: true }),
    });
    const reclaim = vi.fn(async () => {});
    const provider: BrowserProvider = {
      mode: "fake",
      createSession: (request) => fake.provider.createSession(request),
      reclaim,
    };
    const { clock, deps } = setup({}, { getBrowser: () => ({ ok: true, browser: provider }), waitUntil });

    const result = await drive(capturePage(URL_OK, deps), clock);

    expect(result.ok).toBe(false);
    expect(reclaim).toHaveBeenCalledTimes(1);
    expect(waitUntil).toHaveBeenCalledTimes(1);
    await expect(waitUntil.mock.calls[0][0] as Promise<unknown>).resolves.toBeUndefined();
  });

  it("hands the stop of a session that arrives after the whole deadline to waitUntil", async () => {
    const fake = createFakeBrowser();
    const handle = await fake.provider.createSession({
      timeoutMinutes: 1,
      proxy: "off",
      viewport: { width: 1280, height: 800 },
      captureId: "capture-id-sentinel",
    });
    let release: (value: BrowserSessionHandle) => void = () => {};
    const late = new Promise<BrowserSessionHandle>((resolveLate) => {
      release = resolveLate;
    });
    const clock = createManualClock();
    const slowResolver: Resolver = {
      resolveAddresses: () =>
        new Promise<string[]>((resolveAddresses) => {
          clock.setTimer(40_000, () => resolveAddresses(["93.184.216.34"]));
        }),
    };
    const waitUntil = vi.fn();
    const promise = capturePage(URL_OK, {
      config: configFor(),
      getBrowser: () => ({ ok: true, browser: { mode: "fake", createSession: () => late } }),
      resolver: slowResolver,
      clock,
      waitUntil,
    });

    await tick();
    clock.advance(40_000);
    await tick();
    clock.advance(5_000);
    await tick();
    const result = await promise;
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("capture-timeout");
    expect(waitUntil).toHaveBeenCalledTimes(1);
    expect(fake.stopCalls).toBe(0);

    release(handle);
    await expect(waitUntil.mock.calls[0][0] as Promise<unknown>).resolves.toBeUndefined();
    expect(fake.stopCalls).toBe(1);
  });

  it("ignores a waitUntil that throws", async () => {
    const waitUntil = vi.fn(() => {
      throw new Error("waitUntil is not available");
    });
    const { clock, fake, deps } = setup({}, { waitUntil });

    const result = await drive(capturePage(URL_OK, deps), clock);

    expect(result.ok).toBe(true);
    expect(waitUntil).toHaveBeenCalled();
    expect(fake.stopCalls).toBe(1);
  });

  it("behaves as before without waitUntil", async () => {
    const { clock, fake, deps } = setup();
    expect(deps.waitUntil).toBeUndefined();

    const result = await drive(capturePage(URL_OK, deps), clock);

    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual([]);
    expect(fake.stopCalls).toBe(1);
  });
});

describe("capturePage: documentation", () => {
  it("states in its doc comment that detail is for server logs only", () => {
    const source = readFileSync(resolve(process.cwd(), "lib/capture/capture.ts"), "utf8");
    const index = source.indexOf("export async function capturePage");
    expect(index).toBeGreaterThan(0);
    const before = source.slice(0, index);
    const comment = before.slice(before.lastIndexOf("/**"));
    expect(comment).toMatch(/detail/);
    expect(comment).toMatch(/server logs only/);
  });
});

describe("capturePage: snapshot size", () => {
  /** An element with 32 allowed `aria-*` attributes, each with a 64-character name and a 200-character value. */
  function heavyElement(index: number): RawElement {
    const attrs: Record<string, string> = {};
    for (let i = 0; i < 32; i++) {
      const prefix = `aria-${String(i).padStart(2, "0")}`;
      attrs[prefix + "n".repeat(MAX_ATTR_NAME_CHARS - prefix.length)] = "v".repeat(200);
    }
    return { ...element([index]), attrs };
  }

  it("returns snapshot-too-large for 1,500 elements with 32 full attributes each and stops once", async () => {
    const elements = Array.from({ length: 1_500 }, (_, index) => heavyElement(index));
    const raw = createRawPageRead({ eligibleCount: 1_500, elements });
    const schemaSpy = vi.spyOn(PageSnapshotSchema, "safeParse");
    const { clock, fake, deps } = setup({ collect: raw });

    const result = await drive(capturePage(URL_OK, deps), clock);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("snapshot-too-large");
    expect(result.error.message).toBe("The captured page data is too large.");
    expect(fake.stopCalls).toBe(1);
    // The size is measured before validation, so a huge value is never validated.
    expect(schemaSpy).not.toHaveBeenCalled();
    expect("snapshot" in result).toBe(false);
    expect("images" in result).toBe(false);
  });

  it("drops afterReload with reload-failed when that brings a too-large total under the limit", async () => {
    // The first sample is about 1 MB. The light sample is about 0.8 MB: the total is over 1.5 MB.
    const first = createRawPageRead({
      eligibleCount: 1_500,
      elements: Array.from({ length: 1_500 }, (_, index) => element([index], {}, "t".repeat(300))),
    });
    const light = createRawPageRead({
      eligibleCount: 750,
      elements: Array.from({ length: 750 }, (_, index) => ({
        ...element([index], {}, "t".repeat(120)),
        attrs: { type: "t".repeat(200), name: "n".repeat(200), disabled: "d".repeat(200) },
      })),
    });
    const { clock, fake, deps } = setup({ collect: (n) => (n === 1 ? first : light) });

    const result = await drive(capturePage(URL_OK, deps), clock);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.afterReload).toBeUndefined();
    expect(result.snapshot.elements).toHaveLength(1_500);
    expect(result.warnings.map((warning) => warning.code)).toEqual(["reload-failed"]);
    expect(PageSnapshotSchema.safeParse(result.snapshot).success).toBe(true);
    expect(fake.stopCalls).toBe(1);
  });

  it("keeps afterReload when the total is under the limit", async () => {
    const { clock, deps } = setup();
    const result = await drive(capturePage(URL_OK, deps), clock);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.afterReload).toBeDefined();
    expect(result.warnings).toEqual([]);
  });
});

describe("capturePage: page metrics", () => {
  it("succeeds with a device pixel ratio of 1 when the page reports 0", async () => {
    const { clock, deps } = setup({ collect: createRawPageRead({ devicePixelRatio: 0 }) });

    const result = await drive(capturePage(URL_OK, deps), clock);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.capture?.devicePixelRatio).toBe(1);
    expect(result.snapshot.afterReload?.capture?.devicePixelRatio).toBe(1);
    expect(result.warnings).toEqual([]);
  });

  it("does not return snapshot-invalid for NaN and absurd metrics", async () => {
    const raw = createRawPageRead({
      devicePixelRatio: Number.NaN,
      innerWidth: 0,
      scrollHeight: Number.POSITIVE_INFINITY,
    });
    const { clock, deps } = setup({ collect: raw });
    const result = await drive(capturePage(URL_OK, deps), clock);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.capture?.devicePixelRatio).toBe(1);
    expect(result.snapshot.viewportWidth).toBe(1280);
  });

  it("records the layout width in the first and in the reload sample", async () => {
    const { clock, deps } = setup({ collect: createRawPageRead({ layoutWidth: 1_265 }) });

    const result = await drive(capturePage(URL_OK, deps), clock);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.capture?.layoutWidth).toBe(1_265);
    expect(result.snapshot.afterReload?.capture?.layoutWidth).toBe(1_265);
    expect(result.images[0].width).toBe(1_265);
    expect(result.snapshot.capture?.images?.items[0].width).toBe(1_265);
  });

  it("takes the inner width as the layout width when the read has none", async () => {
    const { clock, deps } = setup({ collect: createRawPageRead({ innerWidth: 1_200 }) });
    const result = await drive(capturePage(URL_OK, deps), clock);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.capture?.layoutWidth).toBe(1_200);
    expect(result.images[0].width).toBe(1_200);
  });
});

describe("capturePage: layout drift re-read", () => {
  const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);

  function rawWith(rect: Partial<RawElement["rect"]> = {}, overrides = {}) {
    return createRawPageRead({
      scrollHeight: 1_200,
      eligibleCount: 2,
      elements: [element([1, 0], rect), element([1, 1], { top: 300 })],
      ...overrides,
    });
  }

  /** Read 1 is the first read, read 2 the drift re-read, read 3 the reload sample. */
  function driftScript(second: RawElement["rect"] | Error | "hang"): FakeScript {
    return {
      collect: (n) => {
        if (n !== 2) return rawWith();
        if (second instanceof Error || second === "hang") return second;
        return rawWith(second);
      },
    };
  }

  it("reads again with the light options after the images, before the reload", async () => {
    const { clock, fake, deps } = setup(driftScript({ left: 10, top: 100, width: 200, height: 20 }));

    const result = await drive(capturePage(URL_OK, deps), clock);

    expect(result.ok).toBe(true);
    expect(fake.calls).toEqual([
      "createSession",
      "connect",
      "installGuards",
      "goto",
      "collect",
      "screenshot",
      "collect",
      "reload",
      "collect",
      "stop",
    ]);
    const light = {
      maxElements: 750,
      maxTextChars: 120,
      maxAttrChars: 200,
      attributeNames: ["type", "name", "disabled"],
      limits: COLLECT_LIMITS,
    };
    expect(fake.collectOptions[1]).toEqual(light);
    expect(fake.collectOptions[2]).toEqual(light);
  });

  it.each([
    { name: "x", rect: { left: 10 + LAYOUT_DRIFT_PX + 1 } },
    { name: "y", rect: { top: 100 - LAYOUT_DRIFT_PX - 1 } },
    { name: "width", rect: { width: 200 + LAYOUT_DRIFT_PX + 1 } },
    { name: "height", rect: { height: 20 - LAYOUT_DRIFT_PX - 1 } },
  ])("adds layout-shifted when boxes moved 5 px in $name", async ({ rect }) => {
    const { clock, deps } = setup(driftScript({ left: 10, top: 100, width: 200, height: 20, ...rect }));

    const result = await drive(capturePage(URL_OK, deps), clock);

    expect(result.ok).toBe(true);
    expect(result.warnings.map((warning) => warning.code)).toEqual(["layout-shifted"]);
    expect(Object.keys(result.warnings[0]).sort()).toEqual(["code", "message"]);
  });

  it("adds no warning when boxes moved 4 px", async () => {
    const { clock, deps } = setup(driftScript({ left: 14, top: 96, width: 204, height: 24 }));
    const result = await drive(capturePage(URL_OK, deps), clock);
    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  it("ignores ids that are in one read only", async () => {
    const { clock, deps } = setup({
      collect: (n) =>
        n === 2
          ? createRawPageRead({ eligibleCount: 1, elements: [element([9, 9], { left: 500, top: 500 })] })
          : rawWith(),
    });
    const result = await drive(capturePage(URL_OK, deps), clock);
    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  it("gives no error and no warning when the re-read throws", async () => {
    const { clock, fake, deps } = setup(driftScript(new Error("evaluate failed")));
    const result = await drive(capturePage(URL_OK, deps), clock);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings).toEqual([]);
    expect(result.snapshot.afterReload).toBeDefined();
    expect(fake.stopCalls).toBe(1);
  });

  it("gives no error and no warning when the re-read throws a CaptureFailure", async () => {
    const { clock, deps } = setup(driftScript(new CaptureFailure("page-read-failed")));
    const result = await drive(capturePage(URL_OK, deps), clock);
    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  it("limits a re-read that hangs to a few seconds and goes on with the reload", async () => {
    const { clock, fake, deps } = setup(driftScript("hang"));
    const result = await drive(capturePage(URL_OK, deps), clock);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings).toEqual([]);
    expect(result.snapshot.afterReload).toBeDefined();
    expect(fake.calls.filter((call) => call === "collect")).toHaveLength(3);
  });

  it("gives no error and no warning when the re-read is not a valid read", async () => {
    const { clock, deps } = setup({ collect: (n) => (n === 2 ? ("not a read" as never) : rawWith()) });
    const result = await drive(capturePage(URL_OK, deps), clock);
    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  it("re-reads when exactly TILE_MIN_REMAINING_MS remain", async () => {
    const holder: { clock?: ManualClock } = {};
    const { clock, fake, deps } = setup({
      collect: (n) => (n === 2 ? rawWith({ left: 100 }) : rawWith()),
      // 500 ms of settle plus 41,500 ms in the screenshot leave exactly 3,000 ms.
      screenshot: () => {
        holder.clock?.advance(45_000 - 500 - TILE_MIN_REMAINING_MS);
        return JPEG;
      },
    });
    holder.clock = clock;

    const result = await drive(capturePage(URL_OK, deps), clock);

    expect(result.ok).toBe(true);
    expect(fake.calls.filter((call) => call === "collect")).toHaveLength(2);
    expect(result.warnings.map((warning) => warning.code)).toEqual(["layout-shifted", "reload-skipped"]);
  });

  it("skips the re-read without a warning when less than TILE_MIN_REMAINING_MS remain", async () => {
    const holder: { clock?: ManualClock } = {};
    const { clock, fake, deps } = setup({
      collect: (n) => (n === 2 ? rawWith({ left: 100 }) : rawWith()),
      screenshot: () => {
        holder.clock?.advance(45_000 - 500 - TILE_MIN_REMAINING_MS + 1);
        return JPEG;
      },
    });
    holder.clock = clock;

    const result = await drive(capturePage(URL_OK, deps), clock);

    expect(result.ok).toBe(true);
    expect(fake.calls.filter((call) => call === "collect")).toHaveLength(1);
    expect(result.warnings.map((warning) => warning.code)).toEqual(["reload-skipped"]);
  });

  it("leaves the snapshot unchanged", async () => {
    const quiet = setup(driftScript({ left: 10, top: 100, width: 200, height: 20 }));
    const moved = setup(driftScript({ left: 60, top: 100, width: 200, height: 20 }));
    const failed = setup(driftScript(new Error("evaluate failed")));

    const a = await drive(capturePage(URL_OK, quiet.deps), quiet.clock);
    const b = await drive(capturePage(URL_OK, moved.deps), moved.clock);
    const c = await drive(capturePage(URL_OK, failed.deps), failed.clock);

    expect(a.ok && b.ok && c.ok).toBe(true);
    if (!a.ok || !b.ok || !c.ok) return;
    expect(b.warnings.map((warning) => warning.code)).toEqual(["layout-shifted"]);
    expect(b.snapshot).toEqual(a.snapshot);
    expect(c.snapshot).toEqual(a.snapshot);
    expect(b.images).toEqual(a.images);
  });

  it("comes after the final scrollTo(0) in tiled mode", async () => {
    const { clock, fake, deps } = setup({ collect: () => rawWith({}, { scrollHeight: 45_000 }) });

    const result = await drive(capturePage(URL_OK, deps), clock);

    expect(result.ok).toBe(true);
    const lastScroll = fake.calls.lastIndexOf("scrollTo");
    expect(fake.scrollRequests[fake.scrollRequests.length - 1]).toBe(0);
    expect(fake.calls.slice(lastScroll)).toEqual(["scrollTo", "collect", "reload", "collect", "stop"]);
  });
});
