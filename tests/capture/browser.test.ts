import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
// The real adapter factory, wrapped so that a test can read the dependencies `getBrowser` hands to it.
vi.mock("@/lib/capture/remote-browser", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/capture/remote-browser")>();
  return { ...original, createRemoteBrowser: vi.fn(original.createRemoteBrowser) };
});

import { getBrowser } from "@/lib/capture/browser";
import type { CaptureConfig } from "@/lib/capture/config";
import { createRemoteBrowser } from "@/lib/capture/remote-browser";
import { createManualClock } from "./helpers/manual-clock";

function configFor(browserMode: string): CaptureConfig {
  return {
    browserMode,
    apiKey: "sk-test-sentinel",
    proxy: "off",
    sessionTimeoutMinutes: 2,
    allowOrigin: null,
  };
}

function createDeps() {
  const fetchSpy = vi.fn(async () => new Response("{}", { status: 200 }));
  const loader = vi.fn(async () => ({}));
  return {
    fetchSpy,
    loader,
    deps: { fetch: fetchSpy as unknown as typeof fetch, clock: createManualClock(), loadPlaywright: loader },
  };
}

describe("getBrowser", () => {
  it("returns the remote provider for mode remote", () => {
    const { deps, fetchSpy, loader } = createDeps();
    const result = getBrowser(configFor("remote"), deps);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.browser.mode).toBe("remote");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(loader).not.toHaveBeenCalled();
  });

  it.each(["local", "bundled", "weird", ""])("returns browser-mode-unsupported for mode %j", (mode) => {
    const { deps, fetchSpy, loader } = createDeps();
    const result = getBrowser(configFor(mode), deps);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("browser-mode-unsupported");
      expect(result.error.message).toBe("The configured browser mode is not supported.");
    }
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(loader).not.toHaveBeenCalled();
  });

  it("does not leak the mode text into the error", () => {
    const { deps } = createDeps();
    const result = getBrowser(configFor("secret-mode-name"), deps);
    expect(JSON.stringify(result)).not.toContain("secret-mode-name");
  });

  it("returns config-invalid for mode remote without an API key", () => {
    const { deps } = createDeps();
    const result = getBrowser({ ...configFor("remote"), apiKey: null }, deps);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("config-invalid");
  });

  it("passes no onPageReady to the remote adapter", () => {
    const { deps } = createDeps();
    vi.mocked(createRemoteBrowser).mockClear();

    const result = getBrowser(configFor("remote"), deps);

    expect(result.ok).toBe(true);
    expect(createRemoteBrowser).toHaveBeenCalledTimes(1);
    const passed = vi.mocked(createRemoteBrowser).mock.calls[0][1];
    expect("onPageReady" in passed).toBe(false);
    expect(passed.fetch).toBe(deps.fetch);
    expect(passed.clock).toBe(deps.clock);
    expect(passed.loadPlaywright).toBe(deps.loadPlaywright);
  });

  it("drops an onPageReady that a caller slipped in", () => {
    const { deps } = createDeps();
    vi.mocked(createRemoteBrowser).mockClear();
    const onPageReady = vi.fn();

    // The parameter type has no such field; the cast stands for a caller that ignores the type.
    getBrowser(configFor("remote"), { ...deps, onPageReady } as unknown as typeof deps);

    const passed = vi.mocked(createRemoteBrowser).mock.calls[0][1];
    expect("onPageReady" in passed).toBe(false);
    expect(onPageReady).not.toHaveBeenCalled();
  });

  it("is not mentioned by capturePage", async () => {
    const { readFileSync } = await import("node:fs");
    expect(readFileSync("lib/capture/capture.ts", "utf8")).not.toContain("onPageReady");
  });

  it("imports server-only", async () => {
    const { readFileSync } = await import("node:fs");
    expect(readFileSync("lib/capture/browser.ts", "utf8")).toContain('import "server-only"');
    expect(readFileSync("lib/capture/remote-browser.ts", "utf8")).toContain('import "server-only"');
  });
});
