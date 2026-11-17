import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { CollectOptions } from "@/lib/capture/types";
import { CaptureFailure } from "@/lib/capture/types";
import type { PageGuards, SessionRequest } from "@/lib/capture/seam";
import { createFakeBrowser, createRawPageRead } from "./helpers/fake-browser";

const request: SessionRequest = { timeoutMinutes: 2, proxy: "off", viewport: { width: 1280, height: 800 } };
const collectOptions: CollectOptions = { maxElements: 10, maxTextChars: 30, maxAttrChars: 20, attributeNames: "full" };

async function isPending(promise: Promise<unknown>): Promise<boolean> {
  const settled = Symbol("settled");
  const later = new Promise<string>((resolve) => setImmediate(() => resolve("pending")));
  const first = await Promise.race([promise.then(() => settled, () => settled), later]);
  return first === "pending";
}

async function openPage(fake = createFakeBrowser()) {
  const handle = await fake.provider.createSession(request);
  const page = await handle.connect({ timeoutMs: 15_000 });
  return { fake, handle, page };
}

function guardsAllowing(allowed: string[]) {
  const reported: unknown[] = [];
  const guards: PageGuards = {
    async allowNavigation(url) {
      return allowed.includes(url) ? { allowed: true } : { allowed: false, reason: "url-address-blocked" };
    },
    report(event) {
      reported.push(event);
    },
  };
  return { guards, reported };
}

describe("fake browser counters", () => {
  it("counts createSession, connect and stop calls", async () => {
    const fake = createFakeBrowser();
    expect(fake.provider.mode).toBe("fake");
    expect([fake.createCalls, fake.connectCalls, fake.stopCalls]).toEqual([0, 0, 0]);
    const handle = await fake.provider.createSession(request);
    expect(fake.createCalls).toBe(1);
    await handle.connect({ timeoutMs: 1 });
    expect(fake.connectCalls).toBe(1);
    await handle.stop();
    await handle.stop();
    expect(fake.stopCalls).toBe(2);
  });

  it("keeps the session request and the call order", async () => {
    const { fake, page, handle } = await openPage();
    await page.installGuards(guardsAllowing([]).guards);
    await page.goto("https://a.example/", { timeoutMs: 100 });
    await page.collect(collectOptions);
    await handle.stop();
    expect(fake.calls).toEqual(["createSession", "connect", "installGuards", "goto", "collect", "stop"]);
    expect(fake.sessionRequests).toEqual([request]);
    expect(fake.gotoUrls).toEqual(["https://a.example/"]);
    expect(fake.collectOptions).toEqual([collectOptions]);
  });
});

describe("fake browser scripting", () => {
  it("returns canned data and defaults", async () => {
    const read = createRawPageRead({ scrollHeight: 5_000 });
    const { page } = await openPage(createFakeBrowser({ collect: read }));
    expect(await page.collect(collectOptions)).toEqual(read);
    expect(await page.goto("https://a.example/", { timeoutMs: 1 })).toEqual({ finalUrl: "https://a.example/" });
    expect(await page.reload({ timeoutMs: 1 })).toEqual({ finalUrl: "https://a.example/" });
    const bytes = await page.screenshot({ kind: "viewport", quality: 70 });
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBeGreaterThan(0);
  });

  it("throws a scripted CaptureFailure and a scripted plain Error", async () => {
    const failure = new CaptureFailure("connect-failed");
    const fake = createFakeBrowser({ connect: failure });
    const handle = await fake.provider.createSession(request);
    await expect(handle.connect({ timeoutMs: 1 })).rejects.toBe(failure);

    const { page } = await openPage(createFakeBrowser({ collect: new Error("plain") }));
    await expect(page.collect(collectOptions)).rejects.toThrow("plain");

    const creating = createFakeBrowser({ createSession: new CaptureFailure("session-create-failed") });
    await expect(creating.provider.createSession(request)).rejects.toMatchObject({ code: "session-create-failed" });
  });

  it("supports a per-call function with the call number", async () => {
    const fake = createFakeBrowser({
      screenshot: (callNumber) => (callNumber === 2 ? new Error("tile failed") : new Uint8Array([callNumber])),
    });
    const { page } = await openPage(fake);
    expect(Array.from(await page.screenshot({ kind: "viewport", quality: 70 }))).toEqual([1]);
    await expect(page.screenshot({ kind: "viewport", quality: 70 })).rejects.toThrow("tile failed");
    expect(Array.from(await page.screenshot({ kind: "viewport", quality: 70 }))).toEqual([3]);
  });

  it("never settles a hanging createSession", async () => {
    const fake = createFakeBrowser({ createSession: "hang" });
    expect(await isPending(fake.provider.createSession(request))).toBe(true);
    expect(fake.createCalls).toBe(1);
  });

  it("never settles a hanging connect", async () => {
    const fake = createFakeBrowser({ connect: "hang" });
    const handle = await fake.provider.createSession(request);
    expect(await isPending(handle.connect({ timeoutMs: 1 }))).toBe(true);
    expect(fake.connectCalls).toBe(1);
  });

  it("never settles a hanging stop, and still counts it", async () => {
    const fake = createFakeBrowser({ stop: "hang" });
    const handle = await fake.provider.createSession(request);
    expect(await isPending(handle.stop())).toBe(true);
    expect(fake.stopCalls).toBe(1);
  });

  it("never settles a hanging page step", async () => {
    const { page } = await openPage(
      createFakeBrowser({ goto: "hang", reload: "hang", collect: "hang", scrollTo: "hang", screenshot: "hang" }),
    );
    expect(await isPending(page.goto("https://a.example/", { timeoutMs: 1 }))).toBe(true);
    expect(await isPending(page.reload({ timeoutMs: 1 }))).toBe(true);
    expect(await isPending(page.collect(collectOptions))).toBe(true);
    expect(await isPending(page.scrollTo(10))).toBe(true);
    expect(await isPending(page.screenshot({ kind: "viewport", quality: 70 }))).toBe(true);
  });

  it("settles a normal step so isPending is meaningful", async () => {
    const { page } = await openPage();
    expect(await isPending(page.scrollTo(10))).toBe(false);
  });
});

describe("fake browser scrolling and screenshots", () => {
  it("returns the requested y by default and logs every scrollTo", async () => {
    const { fake, page } = await openPage();
    expect(await page.scrollTo(800)).toBe(800);
    expect(await page.scrollTo(0)).toBe(0);
    expect(fake.scrollRequests).toEqual([800, 0]);
    expect(fake.log).toEqual([
      { kind: "scrollTo", y: 800 },
      { kind: "scrollTo", y: 0 },
    ]);
  });

  it("clamps with maxScrollY and returns a scripted scrollY", async () => {
    const clamped = await openPage(createFakeBrowser({ maxScrollY: 2_200 }));
    expect(await clamped.page.scrollTo(2_400)).toBe(2_200);
    expect(await clamped.page.scrollTo(1_600)).toBe(1_600);

    const scripted = await openPage(createFakeBrowser({ scrollTo: (callNumber, y) => (callNumber === 2 ? y - 5 : y) }));
    expect(await scripted.page.scrollTo(800)).toBe(800);
    expect(await scripted.page.scrollTo(1_600)).toBe(1_595);
    const fixed = await openPage(createFakeBrowser({ scrollTo: 123 }));
    expect(await fixed.page.scrollTo(900)).toBe(123);
  });

  it("tells a viewport request from a clip request in one ordered log", async () => {
    const { fake, page } = await openPage();
    await page.scrollTo(0);
    await page.screenshot({ kind: "viewport", quality: 70 });
    await page.screenshot({ kind: "clip", clip: { x: 0, y: 0, width: 1280, height: 5_000 }, quality: 70 });
    expect(fake.log.map((entry) => (entry.kind === "screenshot" ? `screenshot:${entry.request.kind}` : entry.kind))).toEqual([
      "scrollTo",
      "screenshot:viewport",
      "screenshot:clip",
    ]);
    expect(fake.screenshotRequests.map((r) => r.kind)).toEqual(["viewport", "clip"]);
  });
});

describe("fake browser guards and hops", () => {
  it("checks every hop of goto and returns the last one as the final URL", async () => {
    const { fake, page } = await openPage(createFakeBrowser({ hops: ["https://a.example/", "https://b.example/"] }));
    const { guards, reported } = guardsAllowing(["https://a.example/", "https://b.example/"]);
    await page.installGuards(guards);
    expect(await page.goto("https://a.example/", { timeoutMs: 1 })).toEqual({ finalUrl: "https://b.example/" });
    expect(reported).toEqual([]);
    expect(await page.reload({ timeoutMs: 1 })).toEqual({ finalUrl: "https://b.example/" });
    expect(fake.guards).toBe(guards);
  });

  it("reports a blocked hop and fails the navigation", async () => {
    const { page } = await openPage(createFakeBrowser({ hops: ["https://a.example/", "http://10.0.0.1/"] }));
    const { guards, reported } = guardsAllowing(["https://a.example/"]);
    await page.installGuards(guards);
    await expect(page.goto("https://a.example/", { timeoutMs: 1 })).rejects.toBeInstanceOf(CaptureFailure);
    expect(reported).toEqual([{ kind: "request-blocked", reason: "url-address-blocked" }]);
  });

  it("lets a test emit guard events", async () => {
    const { fake, page } = await openPage();
    const { guards, reported } = guardsAllowing([]);
    await page.installGuards(guards);
    fake.emit({ kind: "download-refused" });
    expect(reported).toEqual([{ kind: "download-refused" }]);
  });
});

describe("seam interfaces", () => {
  it("name no Playwright type", () => {
    const text = readFileSync(fileURLToPath(new URL("../../lib/capture/seam.ts", import.meta.url)), "utf8");
    expect(text.toLowerCase()).not.toContain("playwright");
  });
});
