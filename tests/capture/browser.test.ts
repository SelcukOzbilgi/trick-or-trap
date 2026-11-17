import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { getBrowser } from "@/lib/capture/browser";
import type { CaptureConfig } from "@/lib/capture/config";
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

  it("imports server-only", async () => {
    const { readFileSync } = await import("node:fs");
    expect(readFileSync("lib/capture/browser.ts", "utf8")).toContain('import "server-only"');
    expect(readFileSync("lib/capture/remote-browser.ts", "utf8")).toContain('import "server-only"');
  });
});
