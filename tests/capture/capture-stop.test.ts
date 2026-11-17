import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { capturePage, type CaptureDeps } from "@/lib/capture/capture";
import type { CaptureConfig } from "@/lib/capture/config";
import type { BrowserProvider, BrowserSessionHandle, GetBrowserResult } from "@/lib/capture/seam";
import { CaptureFailure, ERROR_MESSAGES, type CaptureErrorCode, type CaptureResult } from "@/lib/capture/types";
import type { Resolver } from "@/lib/capture/url-check";
import { PageSnapshotSchema } from "@/lib/types";
import { createFakeBrowser, type FakeScript } from "./helpers/fake-browser";
import { createManualClock, type ManualClock } from "./helpers/manual-clock";

const SECRET_KEY = "sk-test-sentinel";
const CDP_URL = "wss://sess-sentinel.cdp.browser-use.com/devtools/browser/x";
const LIVE_URL = "https://sess-sentinel.cdp.browser-use.com/live?id=sentinel";
const SESSION_ID = "session-sentinel-id";
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

const publicResolver: Resolver = {
  async resolveAddresses() {
    return ["93.184.216.34"];
  },
};

function setup(script: FakeScript = {}, depsOverrides: Partial<CaptureDeps> = {}) {
  const clock = createManualClock();
  const fake = createFakeBrowser(script);
  const getBrowser = vi.fn((): GetBrowserResult => ({ ok: true, browser: fake.provider }));
  const deps: Partial<CaptureDeps> = {
    config: configFor(),
    getBrowser,
    resolver: publicResolver,
    clock,
    ...depsOverrides,
  };
  return { clock, fake, getBrowser, deps };
}

/** Runs a capture to the end, advancing the manual clock whenever it waits on a timer. */
async function drive(promise: Promise<CaptureResult>, clock: ManualClock): Promise<CaptureResult> {
  let done = false;
  void promise.then(
    () => (done = true),
    () => (done = true),
  );
  for (let i = 0; i < 400 && !done; i++) {
    await tick();
    if (done) break;
    if (clock.pendingTimers > 0) clock.advance(500);
  }
  return promise;
}

function failureOf(result: CaptureResult) {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected a failure");
  return result;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("capturePage: stop is called exactly once on every path", () => {
  it("success", async () => {
    const { clock, fake, deps } = setup();
    const result = await drive(capturePage(URL_OK, deps), clock);
    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual([]);
    expect(fake.createCalls).toBe(1);
    expect(fake.stopCalls).toBe(1);
  });

  it("connect fails", async () => {
    const { clock, fake, deps } = setup({ connect: new CaptureFailure("connect-failed") });
    const result = failureOf(await drive(capturePage(URL_OK, deps), clock));
    expect(result.error.code).toBe("connect-failed");
    expect(fake.stopCalls).toBe(1);
  });

  it("navigation fails", async () => {
    const { clock, fake, deps } = setup({ goto: new CaptureFailure("navigation-failed") });
    const result = failureOf(await drive(capturePage(URL_OK, deps), clock));
    expect(result.error.code).toBe("navigation-failed");
    expect(fake.stopCalls).toBe(1);
  });

  it("navigation times out", async () => {
    const { clock, fake, deps } = setup({ goto: "hang" });
    const result = failureOf(await drive(capturePage(URL_OK, deps), clock));
    expect(result.error.code).toBe("navigation-timeout");
    expect(fake.stopCalls).toBe(1);
  });

  it("collect fails", async () => {
    const { clock, fake, deps } = setup({ collect: new CaptureFailure("page-read-failed") });
    const result = failureOf(await drive(capturePage(URL_OK, deps), clock));
    expect(result.error.code).toBe("page-read-failed");
    expect(fake.stopCalls).toBe(1);
  });

  it("a screenshot fails", async () => {
    const { clock, fake, deps } = setup({ screenshot: new CaptureFailure("screenshot-failed") });
    const result = failureOf(await drive(capturePage(URL_OK, deps), clock));
    expect(result.error.code).toBe("screenshot-failed");
    expect(fake.stopCalls).toBe(1);
  });

  it("the screenshot is too large (bytes over 3,145,728)", async () => {
    const { clock, fake, deps } = setup({ screenshot: new Uint8Array(3_145_729) });
    const result = failureOf(await drive(capturePage(URL_OK, deps), clock));
    expect(result.error.code).toBe("screenshot-too-large");
    expect(fake.stopCalls).toBe(1);
  });

  it("validation fails", async () => {
    // An implausible page metric is replaced and no longer invalid, so the failure is forced.
    const spy = vi
      .spyOn(PageSnapshotSchema, "safeParse")
      .mockReturnValueOnce({ success: false, error: { issues: [{ path: ["capture", "light"] }] } } as never);
    try {
      const { clock, fake, deps } = setup();
      const result = failureOf(await drive(capturePage(URL_OK, deps), clock));
      expect(result.error.code).toBe("snapshot-invalid");
      expect(fake.stopCalls).toBe(1);
    } finally {
      spy.mockRestore();
    }
  });

  it("the whole-capture deadline is hit", async () => {
    const { clock, fake, deps } = setup({ collect: "hang" });
    const result = failureOf(await drive(capturePage(URL_OK, deps), clock));
    expect(result.error.code).toBe("capture-timeout");
    expect(fake.stopCalls).toBe(1);
  });

  it("stop rejects: the result is kept and a warning is added", async () => {
    const { clock, fake, deps } = setup({ stop: new Error(`stop failed ${SECRET_KEY}`) });
    const result = await drive(capturePage(URL_OK, deps), clock);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(PageSnapshotSchema.safeParse(result.snapshot).success).toBe(true);
    expect(result.warnings.map((warning) => warning.code)).toEqual(["session-stop-failed"]);
    expect(fake.stopCalls).toBe(1);
    expect(JSON.stringify(result.warnings)).not.toContain(SECRET_KEY);
  });

  it("stop rejects after a failed capture: the error is kept and a warning is added", async () => {
    const { clock, fake, deps } = setup({ goto: new Error("boom"), stop: new CaptureFailure("internal-error") });
    const result = failureOf(await drive(capturePage(URL_OK, deps), clock));
    expect(result.error.code).toBe("navigation-failed");
    expect(result.warnings.map((warning) => warning.code)).toEqual(["session-stop-failed"]);
    expect(fake.stopCalls).toBe(1);
  });

  it("stop throws synchronously", async () => {
    const { clock, fake, deps } = setup();
    const createSession = vi.spyOn(fake.provider, "createSession").mockImplementation(async () => ({
      async connect() {
        throw new Error("connect refused");
      },
      stop: () => {
        throw new Error("sync stop");
      },
      secrets: () => [],
    }));
    const result = failureOf(await drive(capturePage(URL_OK, deps), clock));
    expect(createSession).toHaveBeenCalledTimes(1);
    expect(result.error.code).toBe("connect-failed");
    expect(result.warnings.map((warning) => warning.code)).toEqual(["session-stop-failed"]);
  });

  it("session creation fails: no stop call", async () => {
    const { clock, fake, deps } = setup({ createSession: new CaptureFailure("session-create-failed") });
    const result = failureOf(await drive(capturePage(URL_OK, deps), clock));
    expect(result.error.code).toBe("session-create-failed");
    expect(fake.createCalls).toBe(1);
    expect(fake.stopCalls).toBe(0);
    expect(result.warnings).toEqual([]);
  });

  it("a URL refusal creates no session and calls no stop", async () => {
    const { clock, fake, deps } = setup();
    const result = failureOf(await drive(capturePage("http://10.0.0.1/", deps), clock));
    expect(result.error.code).toBe("url-address-blocked");
    expect(fake.createCalls).toBe(0);
    expect(fake.stopCalls).toBe(0);
  });

  it("stop that hangs gives session-stop-failed after exactly 10 s", async () => {
    const { clock, fake, deps } = setup({ stop: "hang" });
    const promise = capturePage(URL_OK, deps);
    let settled = false;
    void promise.then(() => (settled = true));

    await tick();
    clock.advance(500); // the settle delay
    await tick();
    clock.advance(500); // the settle delay after the reload (task 14)
    await tick();
    expect(fake.stopCalls).toBe(1);
    expect(settled).toBe(false);

    clock.advance(9_999);
    await tick();
    expect(settled).toBe(false);
    clock.advance(1);
    await tick();
    expect(settled).toBe(true);

    const result = await promise;
    expect(result.ok).toBe(true);
    expect(result.warnings.map((warning) => warning.code)).toEqual(["session-stop-failed"]);
    expect(fake.stopCalls).toBe(1);
  });

  it("stops a session created after the whole deadline has already won", async () => {
    const fake = createFakeBrowser();
    const handle = await fake.provider.createSession({
      timeoutMinutes: 2,
      proxy: "off",
      viewport: { width: 1280, height: 800 },
      captureId: "capture-id-sentinel",
    });
    let release: (value: BrowserSessionHandle) => void = () => {};
    const late = new Promise<BrowserSessionHandle>((resolve) => {
      release = resolve;
    });
    const provider: BrowserProvider = { mode: "fake", createSession: () => late };

    const clock = createManualClock();
    // The DNS answer takes 40 s, so 5 s of the budget are left when creation starts.
    const slowResolver: Resolver = {
      resolveAddresses: () =>
        new Promise<string[]>((resolve) => {
          clock.setTimer(40_000, () => resolve(["93.184.216.34"]));
        }),
    };
    const deps: Partial<CaptureDeps> = {
      config: configFor(),
      getBrowser: () => ({ ok: true, browser: provider }),
      resolver: slowResolver,
      clock,
    };
    const promise = capturePage(URL_OK, deps);
    let settled = false;
    void promise.then(() => (settled = true));

    await tick();
    clock.advance(40_000);
    await tick();
    expect(settled).toBe(false);
    clock.advance(4_999);
    await tick();
    expect(settled).toBe(false);
    clock.advance(1);
    await tick();
    expect(settled).toBe(true);

    const result = failureOf(await promise);
    expect(result.error.code).toBe("capture-timeout");
    expect(fake.stopCalls).toBe(0);

    release(handle);
    await tick();
    await tick();
    expect(fake.stopCalls).toBe(1);

    clock.advance(20_000);
    await tick();
    expect(fake.stopCalls).toBe(1);
  });

  it("a late session whose stop fails raises no unhandled rejection", async () => {
    const fake = createFakeBrowser({ stop: new Error("late stop failed") });
    const handle = await fake.provider.createSession({
      timeoutMinutes: 2,
      proxy: "off",
      viewport: { width: 1280, height: 800 },
      captureId: "capture-id-sentinel",
    });
    let release: (value: BrowserSessionHandle) => void = () => {};
    const late = new Promise<BrowserSessionHandle>((resolve) => {
      release = resolve;
    });
    const clock = createManualClock();
    const slowResolver: Resolver = {
      resolveAddresses: () =>
        new Promise<string[]>((resolve) => {
          clock.setTimer(44_000, () => resolve(["93.184.216.34"]));
        }),
    };
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      const promise = capturePage(URL_OK, {
        config: configFor(),
        getBrowser: () => ({ ok: true, browser: { mode: "fake", createSession: () => late } }),
        resolver: slowResolver,
        clock,
      });
      await tick();
      clock.advance(44_000);
      await tick();
      clock.advance(1_000);
      await tick();
      const result = failureOf(await promise);
      expect(result.error.code).toBe("capture-timeout");
      release(handle);
      await tick();
      await tick();
      expect(fake.stopCalls).toBe(1);
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });
});

describe("capturePage: error mapping", () => {
  const rawText = `boom ${SECRET_KEY} ${CDP_URL} ${LIVE_URL}\n\n   ${"detail ".repeat(100)}`;

  it.each<{ code: CaptureErrorCode; script: FakeScript; stopCalls: number }>([
    { code: "session-create-failed", script: { createSession: new Error(rawText) }, stopCalls: 0 },
    { code: "connect-failed", script: { connect: new Error(rawText) }, stopCalls: 1 },
    { code: "navigation-failed", script: { goto: new Error(rawText) }, stopCalls: 1 },
    { code: "page-read-failed", script: { collect: new Error(rawText) }, stopCalls: 1 },
    { code: "screenshot-failed", script: { screenshot: new Error(rawText) }, stopCalls: 1 },
  ])("maps a plain Error from the stage to $code", async ({ code, script, stopCalls }) => {
    const { clock, fake, deps } = setup(script);

    const result = failureOf(await drive(capturePage(URL_OK, deps), clock));

    expect(result.error.code).toBe(code);
    expect(result.error.message).toBe(ERROR_MESSAGES[code]);
    expect(result.error.message).not.toContain("boom");
    expect(result.error.detail).toBeDefined();
    expect(result.error.detail?.length).toBeLessThanOrEqual(200);
    expect(result.error.detail).toContain("boom");
    expect(result.error.detail).not.toContain(SECRET_KEY);
    expect(result.error.detail).not.toContain("wss://");
    expect(result.error.detail).not.toContain("cdp.browser-use.com");
    expect(result.error.detail).not.toMatch(/\s{2,}/);
    expect(fake.stopCalls).toBe(stopCalls);

    const json = JSON.stringify(result);
    for (const secret of [SECRET_KEY, CDP_URL, LIVE_URL, SESSION_ID]) expect(json).not.toContain(secret);
  });

  it("maps a plain Error thrown synchronously by a stage", async () => {
    const { clock, fake, deps } = setup();
    vi.spyOn(fake.provider, "createSession").mockImplementation(() => {
      throw new Error("sync boom");
    });
    const result = failureOf(await drive(capturePage(URL_OK, deps), clock));
    expect(result.error.code).toBe("session-create-failed");
    expect(result.error.detail).toBe("sync boom");
  });

  it("keeps the code of a CaptureFailure thrown by a stage", async () => {
    const { clock, deps } = setup({ collect: new CaptureFailure("capture-timeout") });
    const result = failureOf(await drive(capturePage(URL_OK, deps), clock));
    expect(result.error.code).toBe("capture-timeout");
  });

  it("maps a goto failure after a guard blocked the navigation to navigation-blocked", async () => {
    const { clock, fake, deps } = setup({ hops: ["https://shop.example.com/", "http://10.0.0.1/admin"] });

    const result = failureOf(await drive(capturePage(URL_OK, deps), clock));

    expect(result.error.code).toBe("navigation-blocked");
    expect(result.error.message).toBe(ERROR_MESSAGES["navigation-blocked"]);
    expect(result.error.detail).toBeUndefined();
    expect(result.warnings.map((warning) => warning.code)).toEqual(["request-blocked"]);
    expect(JSON.stringify(result)).not.toContain("10.0.0.1");
    expect(fake.calls).not.toContain("collect");
    expect(fake.stopCalls).toBe(1);
  });

  it("maps a plain goto Error after a guard blocked the navigation to navigation-blocked", async () => {
    const holder: { emit?: () => void } = {};
    const { clock, fake, deps } = setup({
      goto: () => {
        holder.emit?.();
        return new Error("net::ERR_BLOCKED_BY_CLIENT");
      },
    });
    holder.emit = () =>
      fake.emit({ kind: "request-blocked", reason: "url-address-blocked", mainFrame: true });
    const result = failureOf(await drive(capturePage(URL_OK, deps), clock));
    expect(result.error.code).toBe("navigation-blocked");
    expect(fake.stopCalls).toBe(1);
  });

  it("keeps navigation-failed when no guard blocked anything", async () => {
    const { clock, deps } = setup({ goto: new Error("net::ERR_NAME_NOT_RESOLVED") });
    const result = failureOf(await drive(capturePage(URL_OK, deps), clock));
    expect(result.error.code).toBe("navigation-failed");
    expect(result.warnings).toEqual([]);
  });

  it("maps a throw outside any stage to internal-error", async () => {
    const { clock, fake, deps } = setup(
      {},
      {
        getBrowser: () => {
          throw new Error(`unexpected ${SECRET_KEY}`);
        },
      },
    );
    const result = failureOf(await drive(capturePage(URL_OK, deps), clock));
    expect(result.error.code).toBe("internal-error");
    expect(result.error.message).toBe(ERROR_MESSAGES["internal-error"]);
    expect(result.error.message).not.toContain("unexpected");
    expect(result.error.detail).toBe("unexpected [redacted]");
    expect(fake.createCalls).toBe(0);
    expect(fake.stopCalls).toBe(0);
  });

  it("serialises neither a success nor a failure with a secret in it", async () => {
    const ok = setup({ goto: { finalUrl: URL_OK } });
    const success = await drive(capturePage(URL_OK, ok.deps), ok.clock);
    expect(success.ok).toBe(true);
    const failing = setup({ stop: new Error(`${SECRET_KEY} ${CDP_URL}`), screenshot: new Error(`${LIVE_URL} ${SECRET_KEY}`) });
    const failure = await drive(capturePage(URL_OK, failing.deps), failing.clock);
    expect(failure.ok).toBe(false);

    for (const result of [success, failure]) {
      const json = JSON.stringify(result);
      for (const secret of [SECRET_KEY, CDP_URL, LIVE_URL, SESSION_ID]) expect(json).not.toContain(secret);
    }
  });
});
