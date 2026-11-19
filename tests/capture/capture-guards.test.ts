import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { capturePage, type CaptureDeps } from "@/lib/capture/capture";
import type { CaptureConfig } from "@/lib/capture/config";
import { MAX_HOP_URL_LENGTH } from "@/lib/capture/constants";
import type { GetBrowserResult } from "@/lib/capture/seam";
import { ERROR_MESSAGES, WARNING_MESSAGES, type CaptureResult } from "@/lib/capture/types";
import type { Resolver } from "@/lib/capture/url-check";
import { createFakeBrowser, type FakeBrowser, type FakeScript } from "./helpers/fake-browser";
import { createManualClock, type ManualClock } from "./helpers/manual-clock";

const SECRET_KEY = "sk-test-sentinel";
const URL_OK = "https://shop.example.com/";

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

function configFor(): CaptureConfig {
  return { browserMode: "remote", apiKey: SECRET_KEY, proxy: "off", sessionTimeoutMinutes: 1, allowOrigin: null };
}

function createResolver() {
  const calls: string[] = [];
  const resolver: Resolver = {
    async resolveAddresses(hostname) {
      calls.push(hostname);
      return ["93.184.216.34"];
    },
  };
  return { resolver, calls };
}

function setup(script: FakeScript = {}) {
  const clock = createManualClock();
  const fake = createFakeBrowser(script);
  const { resolver, calls: resolverCalls } = createResolver();
  const deps: Partial<CaptureDeps> = {
    config: configFor(),
    getBrowser: (): GetBrowserResult => ({ ok: true, browser: fake.provider }),
    resolver,
    clock,
  };
  return { clock, fake, resolverCalls, deps };
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

/** A URL of exactly `length` characters on the shop host. */
function urlOfLength(length: number): string {
  const prefix = "https://shop.example.com/";
  return prefix + "a".repeat(length - prefix.length);
}

/** Sends guard events from inside `goto`, as the request guard would while the page loads. */
function gotoEmitting(holder: { fake?: FakeBrowser }, events: Parameters<FakeBrowser["emit"]>[0][], then: unknown): FakeScript["goto"] {
  return (_n, requestedUrl) => {
    for (const event of events) holder.fake?.emit(event);
    return (then === "ok" ? { finalUrl: requestedUrl } : then) as never;
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("capturePage: refused requests become one warning", () => {
  it("folds three refused sub-resource requests into one warning with count 3 and the first reason", async () => {
    const holder: { fake?: FakeBrowser } = {};
    const { clock, fake, deps } = setup({
      goto: gotoEmitting(
        holder,
        [
          { kind: "request-blocked", reason: "url-address-blocked", mainFrame: false },
          { kind: "request-blocked", reason: "url-port-blocked", mainFrame: false },
          { kind: "request-blocked", reason: "url-scheme-blocked", mainFrame: false },
        ],
        "ok",
      ),
      reload: { finalUrl: URL_OK },
    });
    holder.fake = fake;

    const result = await drive(capturePage(URL_OK, deps), clock);

    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual([
      {
        code: "request-blocked",
        message: WARNING_MESSAGES["request-blocked"],
        reason: "url-address-blocked",
        count: 3,
      },
    ]);
  });

  it("carries no URL, host or path in any warning field", async () => {
    const { clock, deps } = setup({ hops: [URL_OK, "http://10.0.0.1/secret/path?x=1"] });

    const result = await drive(capturePage(URL_OK, deps), clock);

    const json = JSON.stringify(result.warnings);
    expect(json).not.toContain("10.0.0.1");
    expect(json).not.toContain("secret/path");
    expect(json).not.toContain("shop.example.com");
    expect(json).not.toMatch(/https?:/);
    for (const warning of result.warnings) {
      expect(Object.keys(warning).sort()).toEqual(["code", "count", "message", "reason"]);
    }
  });

  it("gives navigation-blocked for a refused main-frame hop and a failing goto", async () => {
    const { clock, fake, deps } = setup({ hops: [URL_OK, "http://10.0.0.1/admin"] });

    const result = await drive(capturePage(URL_OK, deps), clock);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("navigation-blocked");
    expect(result.error.message).toBe(ERROR_MESSAGES["navigation-blocked"]);
    expect(result.warnings).toEqual([
      {
        code: "request-blocked",
        message: WARNING_MESSAGES["request-blocked"],
        reason: "url-address-blocked",
        count: 1,
      },
    ]);
    expect(fake.stopCalls).toBe(1);
  });

  it("gives navigation-blocked for a main-frame event and a plain goto Error", async () => {
    const holder: { fake?: FakeBrowser } = {};
    const { clock, fake, deps } = setup({
      goto: gotoEmitting(
        holder,
        [{ kind: "request-blocked", reason: "url-port-blocked", mainFrame: true }],
        new Error("net::ERR_BLOCKED_BY_CLIENT"),
      ),
    });
    holder.fake = fake;

    const result = await drive(capturePage(URL_OK, deps), clock);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("navigation-blocked");
  });

  it.each([
    { name: "a plain Error", then: new Error("net::ERR_NAME_NOT_RESOLVED"), code: "navigation-failed" },
    { name: "a hang", then: "hang", code: "navigation-timeout" },
  ])("keeps the code of the goto failure ($name) when only a sub-resource was refused", async ({ then, code }) => {
    const holder: { fake?: FakeBrowser } = {};
    const { clock, fake, deps } = setup({
      goto: gotoEmitting(holder, [{ kind: "request-blocked", reason: "url-address-blocked", mainFrame: false }], then),
    });
    holder.fake = fake;

    const result = await drive(capturePage(URL_OK, deps), clock);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe(code);
    expect(result.warnings.map((warning) => warning.code)).toEqual(["request-blocked"]);
  });

  it("returns ok: true when a sub-frame document request was refused", async () => {
    const holder: { fake?: FakeBrowser } = {};
    const { clock, fake, deps } = setup({
      goto: gotoEmitting(holder, [{ kind: "request-blocked", reason: "url-address-blocked", mainFrame: false }], "ok"),
      reload: { finalUrl: URL_OK },
    });
    holder.fake = fake;

    const result = await drive(capturePage(URL_OK, deps), clock);

    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual([
      { code: "request-blocked", message: WARNING_MESSAGES["request-blocked"], reason: "url-address-blocked", count: 1 },
    ]);
  });

  it("turns request-host-limit events into one warning", async () => {
    const holder: { fake?: FakeBrowser } = {};
    const { clock, fake, deps } = setup({
      goto: gotoEmitting(holder, [{ kind: "request-host-limit" }, { kind: "request-host-limit" }], "ok"),
      reload: { finalUrl: URL_OK },
    });
    holder.fake = fake;

    const result = await drive(capturePage(URL_OK, deps), clock);

    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual([
      { code: "request-host-limit", message: WARNING_MESSAGES["request-host-limit"] },
    ]);
  });
});

describe("capturePage: hop length and host verdicts", () => {
  it("lets the guards refuse an 8,193-character URL and accept a 3,000-character hop", async () => {
    const { clock, fake, deps } = setup();
    await drive(capturePage(URL_OK, deps), clock);
    const guards = fake.guards;
    expect(guards).toBeDefined();
    if (!guards) return;

    expect(guards.checkSyntax(urlOfLength(MAX_HOP_URL_LENGTH + 1))).toEqual({ allowed: false, reason: "url-too-long" });
    expect(guards.checkSyntax(urlOfLength(MAX_HOP_URL_LENGTH))).toEqual({ allowed: true });
    expect(guards.checkSyntax(urlOfLength(3_000))).toEqual({ allowed: true });
    expect(await guards.checkHost(urlOfLength(3_000))).toEqual({ allowed: true });
    expect(await guards.checkHost(urlOfLength(MAX_HOP_URL_LENGTH + 1))).toEqual({
      allowed: false,
      reason: "url-too-long",
    });
  });

  it("still limits the URL the user gives to 2,048 characters", async () => {
    const { clock, fake, deps } = setup();
    const result = await drive(capturePage(urlOfLength(3_000), deps), clock);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("url-too-long");
    expect(fake.createCalls).toBe(0);
  });

  it("accepts a 3,000-character final URL after goto and after reload", async () => {
    const long = urlOfLength(3_000);
    const { clock, deps } = setup({ goto: { finalUrl: long }, reload: { finalUrl: long } });

    const result = await drive(capturePage(URL_OK, deps), clock);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.url).toBe(long);
    expect(result.snapshot.afterReload).toBeDefined();
    expect(result.warnings.map((warning) => warning.code)).toEqual(["redirected"]);
  });

  it("refuses an 8,193-character final URL after goto with navigation-blocked", async () => {
    const { clock, fake, deps } = setup({ goto: { finalUrl: urlOfLength(MAX_HOP_URL_LENGTH + 1) } });

    const result = await drive(capturePage(URL_OK, deps), clock);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("navigation-blocked");
    expect(fake.calls).not.toContain("collect");
  });

  it("accepts an 8,192-character final URL after goto", async () => {
    const edge = urlOfLength(MAX_HOP_URL_LENGTH);
    const { clock, deps } = setup({ goto: { finalUrl: edge }, reload: { finalUrl: edge } });
    const result = await drive(capturePage(URL_OK, deps), clock);
    expect(result.ok).toBe(true);
  });

  it("drops the reload sample when the final URL after reload is over 8,192 characters", async () => {
    const { clock, deps } = setup({
      goto: { finalUrl: URL_OK },
      reload: { finalUrl: urlOfLength(MAX_HOP_URL_LENGTH + 1) },
    });

    const result = await drive(capturePage(URL_OK, deps), clock);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.afterReload).toBeUndefined();
    expect(result.warnings.map((warning) => warning.code)).toEqual(["reload-failed"]);
  });

  it("makes one resolver call for two requests to one host", async () => {
    const { clock, fake, resolverCalls, deps } = setup();
    await drive(capturePage(URL_OK, deps), clock);
    const guards = fake.guards;
    expect(guards).toBeDefined();
    if (!guards) return;
    resolverCalls.length = 0;

    expect(await guards.checkHost("https://cdn.example.net/a.js")).toEqual({ allowed: true });
    expect(await guards.checkHost("https://cdn.example.net/b.css")).toEqual({ allowed: true });

    expect(resolverCalls).toEqual(["cdn.example.net"]);
  });

  it("makes one resolver call for hops on one host, shared with the requested URL", async () => {
    const { clock, resolverCalls, deps } = setup({
      hops: [URL_OK, "https://shop.example.com/step-2", "https://shop.example.com/step-3"],
    });

    const result = await drive(capturePage(URL_OK, deps), clock);

    expect(result.ok).toBe(true);
    expect(resolverCalls.filter((host) => host === "shop.example.com")).toHaveLength(1);
  });
});
