import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { capturePage, type CaptureDeps } from "@/lib/capture/capture";
import type { CaptureConfig } from "@/lib/capture/config";
import type { BrowserProvider, GetBrowserResult } from "@/lib/capture/seam";
import type { CaptureResult } from "@/lib/capture/types";
import type { Resolver } from "@/lib/capture/url-check";
import { createFakeBrowser, type FakeBrowser, type FakeScript } from "./helpers/fake-browser";
import { createManualClock, type ManualClock } from "./helpers/manual-clock";

const URL_OK = "https://shop.example.com/";

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

const config: CaptureConfig = {
  browserMode: "remote",
  apiKey: "sk-test-sentinel",
  proxy: "off",
  sessionTimeoutMinutes: 2,
  allowOrigin: null,
};

const publicResolver: Resolver = {
  async resolveAddresses() {
    return ["93.184.216.34"];
  },
};

function wait(clock: ManualClock, ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    clock.setTimer(ms, resolve);
  });
}

/** A provider whose create and connect steps take `delays` of manual-clock time. */
function slowProvider(clock: ManualClock, fake: FakeBrowser, delays: { create?: number; connect?: number }): BrowserProvider {
  return {
    mode: "fake",
    async createSession(request) {
      await wait(clock, delays.create ?? 0);
      const handle = await fake.provider.createSession(request);
      return {
        async connect(options) {
          await wait(clock, delays.connect ?? 0);
          return handle.connect(options);
        },
        stop: () => handle.stop(),
      };
    },
  };
}

function start(script: FakeScript = {}, overrides: Partial<CaptureDeps> = {}) {
  const clock = createManualClock();
  const fake = createFakeBrowser(script);
  const deps: Partial<CaptureDeps> = {
    config,
    getBrowser: (): GetBrowserResult => ({ ok: true, browser: fake.provider }),
    resolver: publicResolver,
    clock,
    ...overrides,
  };
  const state: { result?: CaptureResult } = {};
  const promise = capturePage(URL_OK, deps);
  void promise.then((result) => {
    state.result = result;
  });
  return { clock, fake, promise, state };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("capturePage: deadlines", () => {
  it("createSession that hangs gives session-create-timeout at 10 s", async () => {
    const { clock, fake, promise, state } = start({ createSession: "hang" });
    await tick();
    clock.advance(9_999);
    await tick();
    expect(state.result).toBeUndefined();

    clock.advance(1);
    await tick();
    const result = await promise;
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("session-create-timeout");
    expect(fake.createCalls).toBe(1);
    expect(fake.stopCalls).toBe(0);
  });

  it("connect that hangs gives connect-timeout at 15 s", async () => {
    const { clock, fake, promise, state } = start({ connect: "hang" });
    await tick();
    clock.advance(14_999);
    await tick();
    expect(state.result).toBeUndefined();

    clock.advance(1);
    await tick();
    const result = await promise;
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("connect-timeout");
    expect(fake.stopCalls).toBe(1);
  });

  it("goto that hangs gives navigation-timeout at 15 s", async () => {
    const { clock, fake, promise, state } = start({ goto: "hang" });
    await tick();
    clock.advance(14_999);
    await tick();
    expect(state.result).toBeUndefined();

    clock.advance(1);
    await tick();
    const result = await promise;
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("navigation-timeout");
    expect(fake.stopCalls).toBe(1);
  });

  it("collect that hangs gives capture-timeout at 45 s of the whole capture", async () => {
    const { clock, fake, promise, state } = start({ collect: "hang" });
    await tick();
    clock.advance(500); // the settle delay, then the read starts and hangs
    await tick();
    expect(fake.calls).toContain("collect");

    clock.advance(44_499);
    await tick();
    expect(state.result).toBeUndefined();
    expect(fake.stopCalls).toBe(0);

    clock.advance(1);
    await tick();
    const result = await promise;
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("capture-timeout");
    // The result came back while the read was still pending, and the session was stopped.
    expect(fake.stopCalls).toBe(1);
  });

  it("limits a stage to the remaining budget and reports capture-timeout", async () => {
    const clock = createManualClock();
    const fake = createFakeBrowser({ goto: "hang" });
    // 15 s DNS, 9 s create and 14 s connect leave 7 s of the 45 s for a 15 s navigation.
    const slowResolver: Resolver = {
      async resolveAddresses() {
        await wait(clock, 15_000);
        return ["93.184.216.34"];
      },
    };
    const state: { result?: CaptureResult } = {};
    const promise = capturePage(URL_OK, {
      config,
      getBrowser: () => ({ ok: true, browser: slowProvider(clock, fake, { create: 9_000, connect: 14_000 }) }),
      resolver: slowResolver,
      clock,
    });
    void promise.then((result) => {
      state.result = result;
    });

    await tick();
    clock.advance(15_000);
    await tick();
    clock.advance(9_000);
    await tick();
    clock.advance(14_000);
    await tick();
    expect(fake.calls).toContain("goto");
    expect(state.result).toBeUndefined();

    clock.advance(6_999);
    await tick();
    expect(state.result).toBeUndefined();
    clock.advance(1);
    await tick();

    const result = await promise;
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("capture-timeout");
    expect(fake.stopCalls).toBe(1);
  });

  it("limits the create stage to the remaining budget", async () => {
    const clock = createManualClock();
    const fake = createFakeBrowser({ createSession: "hang" });
    const slowResolver: Resolver = {
      async resolveAddresses() {
        await wait(clock, 38_000);
        return ["93.184.216.34"];
      },
    };
    const state: { result?: CaptureResult } = {};
    const promise = capturePage(URL_OK, {
      config,
      getBrowser: () => ({ ok: true, browser: fake.provider }),
      resolver: slowResolver,
      clock,
    });
    void promise.then((result) => {
      state.result = result;
    });
    await tick();
    clock.advance(38_000);
    await tick();
    clock.advance(6_999);
    await tick();
    expect(state.result).toBeUndefined();
    clock.advance(1);
    await tick();
    const result = await promise;
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("capture-timeout");
  });

  it("a DNS lookup that hangs gives capture-timeout and creates no session", async () => {
    const hangingResolver: Resolver = { resolveAddresses: () => new Promise<string[]>(() => {}) };
    const { clock, fake, promise, state } = start({}, { resolver: hangingResolver });
    await tick();
    clock.advance(44_999);
    await tick();
    expect(state.result).toBeUndefined();

    clock.advance(1);
    await tick();
    const result = await promise;
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("capture-timeout");
    expect(fake.createCalls).toBe(0);
    expect(fake.stopCalls).toBe(0);
  });

  it("a screenshot that hangs gives capture-timeout at the end of the budget", async () => {
    const { clock, fake, promise, state } = start({ screenshot: "hang" });
    await tick();
    clock.advance(500);
    await tick();
    clock.advance(44_499);
    await tick();
    expect(state.result).toBeUndefined();
    clock.advance(1);
    await tick();
    const result = await promise;
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("capture-timeout");
    expect(fake.stopCalls).toBe(1);
  });

  it("leaves no capture timer behind after a normal run", async () => {
    const { clock, promise } = start();
    await tick();
    clock.advance(500);
    await tick();
    clock.advance(500); // the settle delay after the reload (task 14)
    await tick();
    const result = await promise;
    expect(result.ok).toBe(true);
    expect(clock.pendingTimers).toBe(0);
  });
});
