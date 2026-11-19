import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { capturePage, type CaptureDeps } from "@/lib/capture/capture";
import type { CaptureConfig } from "@/lib/capture/config";
import { COLLECT_LIMITS } from "@/lib/capture/constants";
import type { GetBrowserResult } from "@/lib/capture/seam";
import { CaptureFailure } from "@/lib/capture/types";
import type { CaptureResult, RawElement, RawPageRead } from "@/lib/capture/types";
import type { Resolver } from "@/lib/capture/url-check";
import { BaseSnapshotSchema, PageSnapshotSchema } from "@/lib/types";
import { createFakeBrowser, createRawPageRead, type FakeBrowser, type FakeScript } from "./helpers/fake-browser";
import { createManualClock, type ManualClock } from "./helpers/manual-clock";
import { TEST_ID_ATTRIBUTE } from "./helpers/forbidden-attribute";

const URL_OK = "https://shop.example.com/";
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

const config: CaptureConfig = {
  browserMode: "remote",
  apiKey: "sk-test-sentinel",
  proxy: "off",
  sessionTimeoutMinutes: 2,
  allowOrigin: null,
};

const resolver: Resolver = {
  async resolveAddresses() {
    return ["93.184.216.34"];
  },
};

function element(path: number[], text: string): RawElement {
  return {
    path,
    tag: "p",
    role: null,
    text,
    textTruncated: false,
    rect: { left: 10, top: 100, width: 200, height: 20 },
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
    attrs: { [TEST_ID_ATTRIBUTE]: "t", href: "/x", type: "text" },
  };
}

const rawWithElements = (overrides: Partial<RawPageRead> = {}): RawPageRead =>
  createRawPageRead({
    scrollHeight: 1_200,
    eligibleCount: 2,
    elements: [element([1, 0, 3], "Ends in 10:00"), element([1, 2], "Only 3 left")],
    ...overrides,
  });

function setup(script: FakeScript = {}, clock: ManualClock = createManualClock()) {
  const fake = createFakeBrowser(script);
  const deps: Partial<CaptureDeps> = {
    config,
    getBrowser: (): GetBrowserResult => ({ ok: true, browser: fake.provider }),
    resolver,
    clock,
  };
  return { clock, fake, deps };
}

/** A screenshot step that takes `ms` of manual-clock time. */
const slowScreenshot = (clock: ManualClock, ms: number) => () => {
  clock.advance(ms);
  return JPEG;
};

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

function warningCodes(result: CaptureResult): string[] {
  return result.warnings.map((warning) => warning.code);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("capturePage: reload sample", () => {
  it("reloads once after the images, settles 500 ms, then reads with the light options", async () => {
    const { clock, fake, deps } = setup({ collect: rawWithElements() });
    const promise = capturePage(URL_OK, deps);

    await tick();
    clock.advance(500); // first settle
    await tick();
    expect(fake.calls).toEqual([
      "createSession",
      "connect",
      "installGuards",
      "goto",
      "collect",
      "screenshot",
      "collect", // the layout drift re-read, before the reload
      "reload",
    ]);

    // The settle after the reload: no light read of the reload before 500 ms have passed.
    await tick();
    clock.advance(499);
    await tick();
    expect(fake.calls.filter((call) => call === "collect")).toHaveLength(2);
    clock.advance(1);
    await tick();

    const result = await promise;
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
    expect(fake.collectOptions).toEqual([
      { maxElements: 1_500, maxTextChars: 300, maxAttrChars: 200, attributeNames: "full", limits: COLLECT_LIMITS },
      light, // the layout drift re-read
      light, // the reload sample
    ]);
    expect(fake.screenshotRequests).toHaveLength(1);
    expect(fake.scrollRequests).toEqual([]);
    expect(fake.stopCalls).toBe(1);
  });

  it("stores the light sample in afterReload with the same ids and no images", async () => {
    const { clock, deps } = setup({ collect: rawWithElements() });
    const result = await drive(capturePage(URL_OK, deps), clock);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(PageSnapshotSchema.safeParse(result.snapshot).success).toBe(true);
    const after = result.snapshot.afterReload;
    expect(after).toBeDefined();
    if (!after) return;
    expect(BaseSnapshotSchema.safeParse(after).success).toBe(true);
    expect(after.url).toBe(URL_OK);
    expect(after.capture?.light).toBe(true);
    expect(after.capture?.images).toBeUndefined();
    expect(after.elements.map((item) => item.id)).toEqual(result.snapshot.elements.map((item) => item.id));
    expect(after.elements.map((item) => item.id)).toEqual(["el-1-0-3", "el-1-2"]);
    expect(after.elements.every((item) => item.outsideImage === undefined)).toBe(true);
    // Light attributes only.
    expect(after.elements[0].attributes).toEqual({ type: "text" });
    expect(result.snapshot.elements[0].attributes).toMatchObject({ href: "/x" });
    expect(result.snapshot.elements[0].attributes).not.toHaveProperty(TEST_ID_ATTRIBUTE);
    expect(result.snapshot.capture?.light).toBe(false);
    expect(result.snapshot.secondSample).toBeUndefined();
    expect(result.snapshot.capture?.images).toBeDefined();
    expect(result.images).toHaveLength(1);
    expect(warningCodes(result)).toEqual([]);
  });

  it("sets capturedAt of the reload sample from the clock", async () => {
    const { clock, deps } = setup({ collect: rawWithElements() });
    const start = clock.now();
    const result = await drive(capturePage(URL_OK, deps), clock);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.capturedAt).toBe(new Date(start + 500).toISOString());
    expect(result.snapshot.afterReload?.capturedAt).toBe(new Date(start + 1_000).toISOString());
  });

  it("uses the second read for afterReload, not a copy of the first", async () => {
    const second = rawWithElements({ elements: [element([1, 0, 3], "Ends in 09:59")], eligibleCount: 1 });
    const { clock, deps } = setup({ collect: (n) => (n === 1 ? rawWithElements() : second) });
    const result = await drive(capturePage(URL_OK, deps), clock);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.elements[0].text).toBe("Ends in 10:00");
    expect(result.snapshot.afterReload?.elements.map((item) => item.text)).toEqual(["Ends in 09:59"]);
  });

  it("reloads when exactly 12,000 ms remain", async () => {
    const clock = createManualClock();
    // 500 ms of settle plus 32,500 ms in the screenshot leave exactly 12,000 ms.
    const { fake, deps } = setup({ screenshot: slowScreenshot(clock, 32_500) }, clock);
    const result = await drive(capturePage(URL_OK, deps), clock);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(fake.calls.filter((call) => call === "reload")).toHaveLength(1);
    expect(result.snapshot.afterReload).toBeDefined();
    expect(warningCodes(result)).not.toContain("reload-skipped");
    expect(fake.stopCalls).toBe(1);
  });

  it("skips the reload with reload-skipped when 11,999 ms remain", async () => {
    const clock = createManualClock();
    const { fake, deps } = setup({ screenshot: slowScreenshot(clock, 32_501) }, clock);
    const result = await drive(capturePage(URL_OK, deps), clock);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(fake.calls).not.toContain("reload");
    // The first read and the layout drift re-read (3,000 ms or more remain); no reload read.
    expect(fake.calls.filter((call) => call === "collect")).toHaveLength(2);
    expect(result.snapshot.afterReload).toBeUndefined();
    expect(result.snapshot.secondSample).toBeUndefined();
    expect(warningCodes(result)).toEqual(["reload-skipped"]);
    expect(fake.stopCalls).toBe(1);
  });

  it("gives the reload navigation 15,000 ms when more than that remains", async () => {
    const limits: number[] = [];
    const { clock, deps } = setup({
      reload: (_n, options) => {
        limits.push(options.timeoutMs);
        return { finalUrl: URL_OK };
      },
    });
    const result = await drive(capturePage(URL_OK, deps), clock);
    expect(result.ok).toBe(true);
    expect(limits).toEqual([15_000]);
  });

  it("gives the reload navigation the remaining time when that is less than 15,000 ms", async () => {
    const clock = createManualClock();
    const limits: number[] = [];
    const { deps } = setup(
      {
        screenshot: slowScreenshot(clock, 30_500), // 14,000 ms remain after the settle
        reload: (_n, options) => {
          limits.push(options.timeoutMs);
          return { finalUrl: URL_OK };
        },
      },
      clock,
    );
    const result = await drive(capturePage(URL_OK, deps), clock);
    expect(result.ok).toBe(true);
    expect(limits).toEqual([14_000]);
  });

  it("calls reload after the final scrollTo(0) in tiled mode", async () => {
    const { clock, fake, deps } = setup({ collect: rawWithElements({ scrollHeight: 45_000 }) });
    const result = await drive(capturePage(URL_OK, deps), clock);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const reloadAt = fake.calls.indexOf("reload");
    const lastScrollAt = fake.calls.lastIndexOf("scrollTo");
    expect(reloadAt).toBeGreaterThan(lastScrollAt);
    expect(fake.scrollRequests[fake.scrollRequests.length - 1]).toBe(0);
    expect(fake.calls.slice(reloadAt)).toEqual(["reload", "collect", "stop"]);
    expect(fake.screenshotRequests).toHaveLength(10);
    expect(result.snapshot.afterReload).toBeDefined();
    expect(result.snapshot.afterReload?.capture?.images).toBeUndefined();
    expect(warningCodes(result)).toEqual(["tall-page-tiled", "screenshot-truncated"]);
  });
});

describe("capturePage: a reload that shows another page", () => {
  /** First read has `first` eligible elements, the drift re-read the same, the reload sample `second`. */
  const counts = (first: number, second: number) => (n: number) =>
    rawWithElements({ eligibleCount: n <= 2 ? first : second });

  it("adds reload-differs when the reload ends on another URL, and keeps afterReload", async () => {
    const { clock, deps } = setup({ reload: { finalUrl: "https://shop.example.com/login" } });
    const result = await drive(capturePage(URL_OK, deps), clock);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(warningCodes(result)).toContain("reload-differs");
    expect(result.snapshot.afterReload).toBeDefined();
    expect(result.snapshot.afterReload?.url).toBe("https://shop.example.com/login");
    expect(PageSnapshotSchema.safeParse(result.snapshot).success).toBe(true);
  });

  it("adds no warning when the URLs differ only in the fragment", async () => {
    const { clock, deps } = setup({ reload: { finalUrl: "https://shop.example.com/#top" } });
    const result = await drive(capturePage(URL_OK, deps), clock);

    expect(result.ok).toBe(true);
    expect(warningCodes(result)).not.toContain("reload-differs");
  });

  it("adds reload-differs when the reload status is 500 and records it in afterReload", async () => {
    const { clock, deps } = setup({ gotoStatus: 200, reloadStatus: 500 });
    const result = await drive(capturePage(URL_OK, deps), clock);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(warningCodes(result)).toContain("reload-differs");
    expect(warningCodes(result)).not.toContain("http-error-status");
    expect(result.snapshot.afterReload?.capture?.httpStatus).toBe(500);
  });

  it("adds reload-differs at a reload status of exactly 400 and not at 399", async () => {
    const at = setup({ reloadStatus: 400 });
    const below = setup({ reloadStatus: 399 });
    const a = await drive(capturePage(URL_OK, at.deps), at.clock);
    const b = await drive(capturePage(URL_OK, below.deps), below.clock);

    expect(warningCodes(a)).toContain("reload-differs");
    expect(warningCodes(b)).not.toContain("reload-differs");
  });

  it("adds reload-differs for 11 eligible elements against 750 and keeps afterReload", async () => {
    const { clock, deps } = setup({ collect: counts(11, 750) });
    const result = await drive(capturePage(URL_OK, deps), clock);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(warningCodes(result)).toContain("reload-differs");
    expect(result.snapshot.afterReload?.capture?.eligibleElementCount).toBe(750);
    expect(result.snapshot.capture?.eligibleElementCount).toBe(11);
  });

  it("adds reload-differs when the reload has far fewer elements than the first read", async () => {
    const { clock, deps } = setup({ collect: counts(750, 11) });
    const result = await drive(capturePage(URL_OK, deps), clock);

    expect(result.ok).toBe(true);
    expect(warningCodes(result)).toContain("reload-differs");
  });

  it("adds reload-differs at 50 against 16 and not at 50 against 17", async () => {
    // The larger count reaches the minimum of 50; 50 is more than 3 × 16 but not more than 3 × 17.
    const over = setup({ collect: counts(16, 50) });
    const within = setup({ collect: counts(17, 50) });
    const a = await drive(capturePage(URL_OK, over.deps), over.clock);
    const b = await drive(capturePage(URL_OK, within.deps), within.clock);

    expect(warningCodes(a)).toContain("reload-differs");
    expect(warningCodes(b)).not.toContain("reload-differs");
  });

  it("adds no warning for 40 against 10: the larger count is below the minimum of 50", async () => {
    const { clock, deps } = setup({ collect: counts(10, 40) });
    const result = await drive(capturePage(URL_OK, deps), clock);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(warningCodes(result)).not.toContain("reload-differs");
    expect(result.snapshot.afterReload).toBeDefined();
  });

  it("adds no warning for 100 against 300: exactly 3 times is not more than 3 times", async () => {
    const { clock, deps } = setup({ collect: counts(100, 300) });
    const result = await drive(capturePage(URL_OK, deps), clock);

    expect(result.ok).toBe(true);
    expect(warningCodes(result)).not.toContain("reload-differs");
  });

  it("adds no warning when nothing differs", async () => {
    const { clock, deps } = setup({ collect: rawWithElements(), gotoStatus: 200, reloadStatus: 200 });
    const result = await drive(capturePage(URL_OK, deps), clock);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(warningCodes(result)).toEqual([]);
  });

  it("adds no reload-differs when the reload was skipped or failed", async () => {
    const failed = setup({ reload: new Error("boom"), reloadStatus: 500 });
    const result = await drive(capturePage(URL_OK, failed.deps), failed.clock);

    expect(result.ok).toBe(true);
    expect(warningCodes(result)).toContain("reload-failed");
    expect(warningCodes(result)).not.toContain("reload-differs");
  });
});

describe("capturePage: a failing reload is only a warning", () => {
  async function expectReloadFailed(script: FakeScript | ((clock: ManualClock) => FakeScript)) {
    const clock = createManualClock();
    const { fake, deps } = setup(typeof script === "function" ? script(clock) : script, clock);
    const result = await drive(capturePage(URL_OK, deps), clock);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.snapshot.afterReload).toBeUndefined();
    expect(result.snapshot.secondSample).toBeUndefined();
    expect(warningCodes(result)).toContain("reload-failed");
    expect(PageSnapshotSchema.safeParse(result.snapshot).success).toBe(true);
    expect(result.images).toHaveLength(1);
    expect(fake.stopCalls).toBe(1);
    expect(fake.calls).toContain("reload");
    return { result, fake };
  }

  it("when the reload hangs past its limit", async () => {
    await expectReloadFailed({ reload: "hang" });
  });

  it("when the reload throws", async () => {
    await expectReloadFailed({ reload: new Error("net::ERR_FAILED") });
  });

  it("when the reload throws a CaptureFailure", async () => {
    await expectReloadFailed({ reload: new CaptureFailure("navigation-failed") });
  });

  it("when a guard blocks the reload", async () => {
    const holder: { fake?: FakeBrowser } = {};
    const clock = createManualClock();
    const { fake, deps } = setup(
      {
        reload: () => {
          holder.fake?.emit({ kind: "request-blocked", reason: "url-address-blocked", mainFrame: true });
          return new CaptureFailure("navigation-failed");
        },
      },
      clock,
    );
    holder.fake = fake;
    const result = await drive(capturePage(URL_OK, deps), clock);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.afterReload).toBeUndefined();
    expect(warningCodes(result)).toContain("reload-failed");
    expect(warningCodes(result)).toContain("request-blocked");
    expect(fake.stopCalls).toBe(1);
  });

  it("when the reload ends on a blocked address", async () => {
    await expectReloadFailed({ reload: { finalUrl: "http://10.0.0.1/" } });
  });

  it("when the whole deadline ends during the reload", async () => {
    // 12,000 ms remain; the reload answers, then the second read never does. Read 1 is the
    // first read, read 2 the layout drift re-read, read 3 the reload sample.
    const { result, fake } = await expectReloadFailed((clock) => ({
      screenshot: slowScreenshot(clock, 32_500),
      collect: (n) => (n <= 2 ? rawWithElements() : "hang"),
    }));
    expect(fake.calls.filter((call) => call === "collect")).toHaveLength(3);
    expect(result.ok).toBe(true);
  });

  it("when the reload navigation reaches the whole deadline", async () => {
    const { fake } = await expectReloadFailed((clock) => ({
      screenshot: slowScreenshot(clock, 32_500),
      reload: "hang",
    }));
    // The first read and the layout drift re-read; the reload never answers.
    expect(fake.calls.filter((call) => call === "collect")).toHaveLength(2);
  });

  it("when the second read throws", async () => {
    await expectReloadFailed({ collect: (n) => (n <= 2 ? rawWithElements() : new Error("evaluate failed")) });
  });

  it("when the second read throws a CaptureFailure", async () => {
    await expectReloadFailed({
      collect: (n) => (n <= 2 ? rawWithElements() : new CaptureFailure("page-read-failed")),
    });
  });

  it("when the sample fails BaseSnapshotSchema", async () => {
    // An implausible page metric is replaced and no longer invalid, so the failure is forced.
    const spy = vi
      .spyOn(BaseSnapshotSchema, "safeParse")
      .mockReturnValueOnce({ success: false, error: { issues: [{ path: ["capture", "light"] }] } } as never);
    try {
      await expectReloadFailed({ collect: () => rawWithElements() });
    } finally {
      spy.mockRestore();
    }
  });

  it("never lets a reload failure change the first capture", async () => {
    const good = await (async () => {
      const { clock, deps } = setup({ collect: rawWithElements() });
      return drive(capturePage(URL_OK, deps), clock);
    })();
    const { clock, deps } = setup({ collect: rawWithElements(), reload: new Error("boom") });
    const bad = await drive(capturePage(URL_OK, deps), clock);

    expect(good.ok && bad.ok).toBe(true);
    if (!good.ok || !bad.ok) return;
    expect(bad.snapshot.elements).toEqual(good.snapshot.elements);
    expect(bad.snapshot.capture).toEqual(good.snapshot.capture);
    expect(bad.images).toEqual(good.images);
  });

  it("keeps secrets out of the result when the reload fails", async () => {
    const { clock, deps } = setup({ reload: new Error("failed for sk-test-sentinel") });
    const result = await drive(capturePage(URL_OK, deps), clock);
    expect(JSON.stringify(result)).not.toContain("sk-test-sentinel");
  });
});
