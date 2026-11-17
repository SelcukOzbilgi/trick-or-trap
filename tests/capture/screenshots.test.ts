import { describe, expect, it } from "vitest";
import { createDeadline } from "@/lib/capture/clock";
import { captureImages } from "@/lib/capture/screenshots";
import type { CapturePage } from "@/lib/capture/seam";
import { CaptureFailure } from "@/lib/capture/types";
import { createFakeBrowser, createRawPageRead, type FakeScript } from "./helpers/fake-browser";
import { createManualClock } from "./helpers/manual-clock";

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

/** The fake's default image bytes, spelled out for step functions that must return a value. */
const jpeg = () => new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);

async function setup(script: FakeScript = {}) {
  const clock = createManualClock();
  const deadline = createDeadline(clock, 45_000);
  const fake = createFakeBrowser(script);
  const handle = await fake.provider.createSession({
    timeoutMinutes: 2,
    proxy: "off",
    viewport: { width: 1280, height: 800 },
  });
  const page: CapturePage = await handle.connect({ timeoutMs: 1_000 });
  return { clock, deadline, fake, page };
}

describe("captureImages: single mode", () => {
  it("takes one clipped image of the whole page when it is 5,000 px tall", async () => {
    const { page, deadline, fake } = await setup();
    const read = createRawPageRead({ scrollHeight: 5_000 });

    const outcome = await captureImages(page, read, deadline);

    expect(fake.screenshotRequests).toEqual([
      { kind: "clip", clip: { x: 0, y: 0, width: 1280, height: 5_000 }, quality: 70 },
    ]);
    expect(fake.scrollRequests).toEqual([]);
    expect(outcome.images).toHaveLength(1);
    expect(outcome.images[0]).toMatchObject({ offsetY: 0, width: 1280, height: 5_000 });
    expect(outcome.images[0].bytes).toEqual(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]));
    expect(outcome.images[0].base64Length).toBe(8);
    expect(outcome.meta).toEqual({
      mode: "single",
      truncated: false,
      items: [{ offsetY: 0, width: 1280, height: 5_000 }],
    });
    expect(outcome.warnings).toEqual([]);
  });

  it("rounds the width up to a whole pixel", async () => {
    const { page, deadline, fake } = await setup();
    await captureImages(page, createRawPageRead({ innerWidth: 1280.4, scrollHeight: 900 }), deadline);
    expect(fake.screenshotRequests[0]).toMatchObject({ clip: { width: 1281, height: 900 } });
  });

  it("cuts a 20,000 px page to 8,000 px and warns", async () => {
    const { page, deadline, fake } = await setup();
    const outcome = await captureImages(page, createRawPageRead({ scrollHeight: 20_000 }), deadline);

    expect(fake.screenshotRequests).toEqual([
      { kind: "clip", clip: { x: 0, y: 0, width: 1280, height: 8_000 }, quality: 70 },
    ]);
    expect(outcome.meta.truncated).toBe(true);
    expect(outcome.meta.items).toEqual([{ offsetY: 0, width: 1280, height: 8_000 }]);
    expect(outcome.warnings).toEqual(["screenshot-truncated"]);
  });

  it.each([
    { scrollHeight: 30_000, devicePixelRatio: 1, mode: "single" },
    { scrollHeight: 15_000, devicePixelRatio: 2, mode: "single" },
    { scrollHeight: 30_001, devicePixelRatio: 1, mode: "tiled" },
    { scrollHeight: 15_001, devicePixelRatio: 2, mode: "tiled" },
  ])("chooses $mode mode at height $scrollHeight with DPR $devicePixelRatio", async (testCase) => {
    const { page, deadline } = await setup();
    const outcome = await captureImages(
      page,
      createRawPageRead({ scrollHeight: testCase.scrollHeight, devicePixelRatio: testCase.devicePixelRatio }),
      deadline,
    );
    expect(outcome.meta.mode).toBe(testCase.mode);
  });

  it("returns screenshot-failed when the screenshot throws a plain error", async () => {
    const { page, deadline } = await setup({ screenshot: new Error("boom") });
    await expect(captureImages(page, createRawPageRead({ scrollHeight: 900 }), deadline)).rejects.toMatchObject({
      code: "screenshot-failed",
    });
  });

  it("keeps the code of a CaptureFailure from the seam", async () => {
    const { page, deadline } = await setup({ screenshot: new CaptureFailure("screenshot-failed", "seam detail") });
    await expect(captureImages(page, createRawPageRead({ scrollHeight: 900 }), deadline)).rejects.toMatchObject({
      code: "screenshot-failed",
      detail: "seam detail",
    });
  });

  it("accepts one image of exactly 3,145,728 bytes", async () => {
    const { page, deadline } = await setup({ screenshot: new Uint8Array(3_145_728) });
    const outcome = await captureImages(page, createRawPageRead({ scrollHeight: 900 }), deadline);
    expect(outcome.images).toHaveLength(1);
    expect(outcome.images[0].base64Length).toBe(4_194_304);
  });

  it("returns screenshot-too-large for one image of 3,145,729 bytes", async () => {
    const { page, deadline } = await setup({ screenshot: new Uint8Array(3_145_729) });
    await expect(captureImages(page, createRawPageRead({ scrollHeight: 900 }), deadline)).rejects.toMatchObject({
      code: "screenshot-too-large",
    });
  });
});

describe("captureImages: tiled mode", () => {
  it("takes 10 viewport tiles of a 45,000 px page and never a clipped or full-page shot", async () => {
    const { page, deadline, fake } = await setup();
    const read = createRawPageRead({ scrollHeight: 45_000 });

    const outcome = await captureImages(page, read, deadline);

    expect(fake.log[0]).toEqual({ kind: "scrollTo", y: 0 });
    expect(fake.log[1]).toEqual({ kind: "screenshot", request: { kind: "viewport", quality: 70 } });
    expect(fake.log[fake.log.length - 1]).toEqual({ kind: "scrollTo", y: 0 });
    expect(fake.screenshotRequests).toHaveLength(10);
    expect(fake.screenshotRequests.every((request) => request.kind === "viewport")).toBe(true);
    expect(fake.screenshotRequests.some((request) => request.kind === "clip")).toBe(false);
    expect(fake.scrollRequests).toEqual([0, 800, 1_600, 2_400, 3_200, 4_000, 4_800, 5_600, 6_400, 7_200, 0]);

    expect(outcome.images.map((image) => image.offsetY)).toEqual([
      0, 800, 1_600, 2_400, 3_200, 4_000, 4_800, 5_600, 6_400, 7_200,
    ]);
    expect(outcome.images.every((image) => image.width === 1280 && image.height === 800)).toBe(true);
    expect(outcome.meta.mode).toBe("tiled");
    expect(outcome.meta.truncated).toBe(true);
    expect(outcome.warnings).toEqual(["tall-page-tiled", "screenshot-truncated"]);
  });

  it("records the scrollY the page reports as the offset of a tile", async () => {
    const { page, deadline } = await setup({ scrollTo: (callNumber, y) => (callNumber === 3 ? 1_601 : y) });
    const outcome = await captureImages(page, createRawPageRead({ scrollHeight: 45_000 }), deadline);
    expect(outcome.images.slice(0, 4).map((image) => image.offsetY)).toEqual([0, 800, 1_601, 2_400]);
    expect(outcome.meta.items.slice(0, 4).map((item) => item.offsetY)).toEqual([0, 800, 1_601, 2_400]);
  });

  it("takes 4 tiles for a 3,000 px document and keeps the clamped last offset", async () => {
    const { page, deadline, fake } = await setup({ maxScrollY: 2_200 });
    // 3,000 px at DPR 11 is 33,000 device px, which is above the single-mode limit.
    const read = createRawPageRead({ scrollHeight: 3_000, devicePixelRatio: 11 });

    const outcome = await captureImages(page, read, deadline);

    expect(outcome.images.map((image) => image.offsetY)).toEqual([0, 800, 1_600, 2_200]);
    expect(outcome.meta.truncated).toBe(false);
    expect(outcome.warnings).toEqual(["tall-page-tiled"]);
    expect(fake.log[fake.log.length - 1]).toEqual({ kind: "scrollTo", y: 0 });
  });

  it("stops before further tiles when the previous tile reached the bottom", async () => {
    const { page, deadline, fake } = await setup({ maxScrollY: 200 });
    const read = createRawPageRead({ scrollHeight: 1_000, devicePixelRatio: 40 });

    const outcome = await captureImages(page, read, deadline);

    expect(outcome.images.map((image) => image.offsetY)).toEqual([0, 200]);
    expect(outcome.meta.truncated).toBe(false);
    expect(fake.screenshotRequests).toHaveLength(2);
  });

  it("stops when scrolling makes no progress instead of repeating the same tile", async () => {
    const { page, deadline } = await setup({ scrollTo: 0 });
    const outcome = await captureImages(page, createRawPageRead({ scrollHeight: 45_000 }), deadline);
    expect(outcome.images).toHaveLength(1);
    expect(outcome.meta.truncated).toBe(true);
    expect(outcome.warnings).toEqual(["tall-page-tiled", "screenshot-truncated"]);
  });

  it("returns screenshot-failed when the first tile fails", async () => {
    const { page, deadline } = await setup({ screenshot: (callNumber) => (callNumber === 1 ? new Error("boom") : jpeg()) });
    await expect(captureImages(page, createRawPageRead({ scrollHeight: 45_000 }), deadline)).rejects.toMatchObject({
      code: "screenshot-failed",
    });
  });

  it("returns screenshot-failed when the first scroll fails", async () => {
    const { page, deadline } = await setup({ scrollTo: (callNumber, y) => (callNumber === 1 ? new Error("boom") : y) });
    await expect(captureImages(page, createRawPageRead({ scrollHeight: 45_000 }), deadline)).rejects.toMatchObject({
      code: "screenshot-failed",
    });
  });

  it("keeps two tiles when the third tile fails", async () => {
    const { page, deadline, fake } = await setup({
      screenshot: (callNumber) => (callNumber === 3 ? new Error("boom") : jpeg()),
    });

    const outcome = await captureImages(page, createRawPageRead({ scrollHeight: 45_000 }), deadline);

    expect(outcome.images.map((image) => image.offsetY)).toEqual([0, 800]);
    expect(outcome.meta.truncated).toBe(true);
    expect(outcome.warnings).toEqual(["tall-page-tiled", "screenshot-truncated"]);
    expect(fake.log[fake.log.length - 1]).toEqual({ kind: "scrollTo", y: 0 });
  });

  it("keeps the tiles when a later scroll fails", async () => {
    const { page, deadline } = await setup({ scrollTo: (callNumber, y) => (callNumber === 3 ? new Error("boom") : y) });
    const outcome = await captureImages(page, createRawPageRead({ scrollHeight: 45_000 }), deadline);
    expect(outcome.images).toHaveLength(2);
    expect(outcome.meta.truncated).toBe(true);
  });

  it("stops after four tiles when less than 3,000 ms remain before the fifth", async () => {
    const clock = createManualClock();
    const deadline = createDeadline(clock, 45_000);
    const fake = createFakeBrowser({
      screenshot: (callNumber) => {
        if (callNumber === 4) clock.advance(43_000); // 2,000 ms are left afterwards
        return jpeg();
      },
    });
    const handle = await fake.provider.createSession({
      timeoutMinutes: 2,
      proxy: "off",
      viewport: { width: 1280, height: 800 },
    });
    const page = await handle.connect({ timeoutMs: 1_000 });

    const outcome = await captureImages(page, createRawPageRead({ scrollHeight: 45_000 }), deadline);

    expect(outcome.images).toHaveLength(4);
    expect(outcome.meta.truncated).toBe(true);
    expect(outcome.warnings).toEqual(["tall-page-tiled", "screenshot-truncated"]);
  });

  it("returns capture-timeout when a scroll hangs until the budget ends", async () => {
    const { page, deadline, clock } = await setup({ scrollTo: "hang" });

    const outcome = captureImages(page, createRawPageRead({ scrollHeight: 45_000 }), deadline);
    const assertion = expect(outcome).rejects.toMatchObject({ code: "capture-timeout" });
    await tick();
    clock.advance(45_000);
    await assertion;
  });

  it("returns screenshot-too-large and no images when the base64 sum is above 4,194,304", async () => {
    const big = new Uint8Array(1_600_000); // 2,133,336 base64 characters each
    const { page, deadline } = await setup({ screenshot: big });
    await expect(captureImages(page, createRawPageRead({ scrollHeight: 45_000 }), deadline)).rejects.toMatchObject({
      code: "screenshot-too-large",
    });
  });
});
