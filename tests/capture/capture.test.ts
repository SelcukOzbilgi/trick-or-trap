import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const getCaptureConfigMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/capture/config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/capture/config")>()),
  getCaptureConfig: getCaptureConfigMock,
}));

import { capturePage, type CaptureDeps } from "@/lib/capture/capture";
import type { CaptureConfig } from "@/lib/capture/config";
import { COLLECT_LIMITS } from "@/lib/capture/constants";
import { createRemoteBrowser } from "@/lib/capture/remote-browser";
import type { GetBrowserResult } from "@/lib/capture/seam";
import type { CaptureResult, RawElement } from "@/lib/capture/types";
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
    expect(fake.calls.filter((call) => call === "collect")).toHaveLength(2);
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
