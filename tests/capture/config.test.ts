import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { getCaptureConfig, parseCaptureConfig } from "@/lib/capture/config";

function expectOk(env: Record<string, string | undefined>) {
  const result = parseCaptureConfig(env);
  if (!result.ok) throw new Error(`expected ok, got ${result.error.code}: ${result.error.message}`);
  return result.config;
}

function expectInvalid(env: Record<string, string | undefined>) {
  const result = parseCaptureConfig(env);
  if (result.ok) throw new Error("expected config-invalid");
  expect(result.error.code).toBe("config-invalid");
  return result.error;
}

describe("parseCaptureConfig: defaults and mode", () => {
  it("uses the defaults when only the API key is set", () => {
    const config = expectOk({ BROWSER_USE_API_KEY: "k" });
    expect(config.browserMode).toBe("remote");
    expect(config.apiKey).toBe("k");
    expect(config.proxy).toBe("off");
    expect(config.sessionTimeoutMinutes).toBe(1);
    expect(config.allowOrigin).toBeNull();
  });

  it("returns a config with exactly the five fields", () => {
    const config = expectOk({ BROWSER_USE_API_KEY: "k" });
    expect(Object.keys(config).sort()).toEqual(
      ["allowOrigin", "apiKey", "browserMode", "proxy", "sessionTimeoutMinutes"].sort()
    );
  });

  it("rejects a missing API key when the mode is remote by default", () => {
    const error = expectInvalid({});
    expect(error.message).toContain("BROWSER_USE_API_KEY");
  });

  it("rejects a missing API key when the mode is explicitly remote", () => {
    const error = expectInvalid({ CAPTURE_BROWSER_MODE: "remote" });
    expect(error.message).toContain("BROWSER_USE_API_KEY");
  });

  it("accepts mode local without an API key", () => {
    const config = expectOk({ CAPTURE_BROWSER_MODE: "local" });
    expect(config.browserMode).toBe("local");
    expect(config.apiKey).toBeNull();
  });

  it("accepts any other non-empty mode string and leaves support to getBrowser", () => {
    expect(expectOk({ CAPTURE_BROWSER_MODE: "bundled" }).browserMode).toBe("bundled");
    expect(expectOk({ CAPTURE_BROWSER_MODE: "weird" }).browserMode).toBe("weird");
  });

  it("rejects a mode longer than 32 characters", () => {
    const error = expectInvalid({ CAPTURE_BROWSER_MODE: "x".repeat(33), BROWSER_USE_API_KEY: "k" });
    expect(error.message).toContain("CAPTURE_BROWSER_MODE");
  });

  it("trims the mode and the API key", () => {
    const config = expectOk({ CAPTURE_BROWSER_MODE: "  remote ", BROWSER_USE_API_KEY: "  k  " });
    expect(config.browserMode).toBe("remote");
    expect(config.apiKey).toBe("k");
  });
});

describe("parseCaptureConfig: proxy", () => {
  it.each(["on", "off"])("accepts %s", (value) => {
    expect(expectOk({ BROWSER_USE_API_KEY: "k", BROWSER_USE_PROXY: value }).proxy).toBe(value);
  });

  it.each(["ON", "maybe", "true", "1"])("rejects %s", (value) => {
    const error = expectInvalid({ BROWSER_USE_API_KEY: "k", BROWSER_USE_PROXY: value });
    expect(error.message).toContain("BROWSER_USE_PROXY");
  });
});

describe("parseCaptureConfig: session timeout", () => {
  it.each(["1", "5"])("accepts %s", (value) => {
    const config = expectOk({ BROWSER_USE_API_KEY: "k", BROWSER_USE_SESSION_TIMEOUT_MINUTES: value });
    expect(config.sessionTimeoutMinutes).toBe(Number(value));
  });

  it("uses 1 when the timeout is unset", () => {
    expect(expectOk({ BROWSER_USE_API_KEY: "k" }).sessionTimeoutMinutes).toBe(1);
  });

  it.each(["2", "3"])("also accepts %s", (value) => {
    const config = expectOk({ BROWSER_USE_API_KEY: "k", BROWSER_USE_SESSION_TIMEOUT_MINUTES: value });
    expect(config.sessionTimeoutMinutes).toBe(Number(value));
  });

  it.each(["0", "6", "2.5", "abc", "-1", "1e1", "0x2"])("rejects %s", (value) => {
    const error = expectInvalid({ BROWSER_USE_API_KEY: "k", BROWSER_USE_SESSION_TIMEOUT_MINUTES: value });
    expect(error.message).toContain("BROWSER_USE_SESSION_TIMEOUT_MINUTES");
  });
});

describe("parseCaptureConfig: empty strings count as unset", () => {
  it.each([
    ["BROWSER_USE_PROXY"],
    ["BROWSER_USE_SESSION_TIMEOUT_MINUTES"],
    ["NEXT_PUBLIC_APP_URL"],
  ])("treats an empty or blank %s as unset", (name) => {
    for (const blank of ["", "   ", "\t"]) {
      const config = expectOk({ BROWSER_USE_API_KEY: "k", [name]: blank });
      expect(config.proxy).toBe("off");
      expect(config.sessionTimeoutMinutes).toBe(1);
      expect(config.allowOrigin).toBeNull();
    }
  });

  it("treats an empty CAPTURE_BROWSER_MODE as the default remote", () => {
    expect(expectOk({ BROWSER_USE_API_KEY: "k", CAPTURE_BROWSER_MODE: "" }).browserMode).toBe("remote");
    expect(expectOk({ BROWSER_USE_API_KEY: "k", CAPTURE_BROWSER_MODE: "  " }).browserMode).toBe("remote");
  });

  it("treats an empty or blank BROWSER_USE_API_KEY as missing", () => {
    expect(expectInvalid({ BROWSER_USE_API_KEY: "" }).message).toContain("BROWSER_USE_API_KEY");
    expect(expectInvalid({ BROWSER_USE_API_KEY: "   " }).message).toContain("BROWSER_USE_API_KEY");
    expect(expectOk({ CAPTURE_BROWSER_MODE: "local", BROWSER_USE_API_KEY: " " }).apiKey).toBeNull();
  });
});

describe("parseCaptureConfig: allow origin", () => {
  it("keeps only the origin of an https URL with a path", () => {
    const config = expectOk({ BROWSER_USE_API_KEY: "k", NEXT_PUBLIC_APP_URL: "https://demo.example.com/path" });
    expect(config.allowOrigin).toBe("https://demo.example.com");
  });

  it("drops the default port", () => {
    const config = expectOk({ BROWSER_USE_API_KEY: "k", NEXT_PUBLIC_APP_URL: "https://a.com:443" });
    expect(config.allowOrigin).toBe("https://a.com");
  });

  it("keeps a non-default port and an https scheme", () => {
    const config = expectOk({ BROWSER_USE_API_KEY: "k", NEXT_PUBLIC_APP_URL: "https://demo.example.com:8443/x?y=1#z" });
    expect(config.allowOrigin).toBe("https://demo.example.com:8443");
  });

  it("accepts a public host name with an http scheme", () => {
    const config = expectOk({ BROWSER_USE_API_KEY: "k", NEXT_PUBLIC_APP_URL: "http://demo.example.com/x" });
    expect(config.allowOrigin).toBe("http://demo.example.com");
  });

  it("accepts https://demo.example.com and returns its origin", () => {
    const config = expectOk({ BROWSER_USE_API_KEY: "k", NEXT_PUBLIC_APP_URL: "https://demo.example.com" });
    expect(config.allowOrigin).toBe("https://demo.example.com");
  });

  it.each(["http://10.0.0.5", "http://[::1]", "http://localhost", "http://127.0.0.1", "http://printer.local"])(
    "rejects the blocked host %s and names only the variable",
    (value) => {
      const error = expectInvalid({ BROWSER_USE_API_KEY: "k", NEXT_PUBLIC_APP_URL: value });
      expect(error.message).toBe("Invalid capture environment: NEXT_PUBLIC_APP_URL");
      expect(JSON.stringify(error)).not.toContain(value);
    }
  );

  it.each(["ftp://x", "not a url", "javascript:alert(1)", "//demo.example.com"])("rejects %s", (value) => {
    const error = expectInvalid({ BROWSER_USE_API_KEY: "k", NEXT_PUBLIC_APP_URL: value });
    expect(error.message).toContain("NEXT_PUBLIC_APP_URL");
  });

  it("has no allow origin when unset", () => {
    expect(expectOk({ BROWSER_USE_API_KEY: "k" }).allowOrigin).toBeNull();
  });
});

describe("parseCaptureConfig: error messages", () => {
  it("names every variable at fault in the documented format", () => {
    const error = expectInvalid({ BROWSER_USE_PROXY: "maybe", BROWSER_USE_SESSION_TIMEOUT_MINUTES: "9" });
    expect(error.message).toMatch(/^Invalid capture environment: /);
    expect(error.message).toContain("BROWSER_USE_API_KEY");
    expect(error.message).toContain("BROWSER_USE_PROXY");
    expect(error.message).toContain("BROWSER_USE_SESSION_TIMEOUT_MINUTES");
  });

  it("lists each variable once", () => {
    const error = expectInvalid({ BROWSER_USE_PROXY: "maybe" });
    const names = error.message.replace("Invalid capture environment: ", "").split(", ");
    expect(new Set(names).size).toBe(names.length);
  });

  it("never contains the value of any variable", () => {
    const env = {
      BROWSER_USE_API_KEY: "sk-test-sentinel",
      BROWSER_USE_PROXY: "proxy-sentinel-value",
      BROWSER_USE_SESSION_TIMEOUT_MINUTES: "timeout-sentinel-value",
      CAPTURE_BROWSER_MODE: "remote",
      NEXT_PUBLIC_APP_URL: "ftp://url-sentinel-value",
    };
    const error = expectInvalid(env);
    const text = JSON.stringify(error);
    for (const value of Object.values(env)) {
      if (value === "remote") continue;
      expect(text).not.toContain(value);
    }
    expect(error.detail).toBeUndefined();
  });

  it("does not echo a bad value of the API key mode combination", () => {
    const error = expectInvalid({ BROWSER_USE_API_KEY: "sk-test-sentinel", BROWSER_USE_PROXY: "nope-sentinel" });
    expect(JSON.stringify(error)).not.toContain("sk-test-sentinel");
    expect(JSON.stringify(error)).not.toContain("nope-sentinel");
  });

  it("does not read process.env when given an object", () => {
    const before = process.env.BROWSER_USE_API_KEY;
    const result = parseCaptureConfig({ BROWSER_USE_API_KEY: "from-injected-env" });
    expect(result.ok && result.config.apiKey).toBe("from-injected-env");
    expect(process.env.BROWSER_USE_API_KEY).toBe(before);
  });

  it("ignores unknown names", () => {
    expect(expectOk({ BROWSER_USE_API_KEY: "k", SOMETHING_ELSE: "x" }).apiKey).toBe("k");
  });
});

describe("getCaptureConfig", () => {
  it("validates once and reuses the result", () => {
    const first = getCaptureConfig();
    const second = getCaptureConfig();
    expect(second).toBe(first);
  });
});

describe(".env.example", () => {
  const lines = readFileSync(join(process.cwd(), ".env.example"), "utf8").split(/\r?\n/);

  it("no longer lists BROWSER_CDP_ENDPOINT", () => {
    expect(lines.some((line) => line.includes("BROWSER_CDP_ENDPOINT"))).toBe(false);
  });

  it.each([
    "BROWSER_USE_API_KEY",
    "BROWSER_USE_PROXY",
    "BROWSER_USE_SESSION_TIMEOUT_MINUTES",
    "CAPTURE_BROWSER_MODE",
  ])("lists %s with an empty value and a comment line before it", (name) => {
    const index = lines.findIndex((line) => line.startsWith(`${name}=`));
    expect(index).toBeGreaterThan(0);
    expect(lines[index]).toBe(`${name}=`);
    expect(lines[index - 1].startsWith("#")).toBe(true);
  });

  it("states the defaults in the comments", () => {
    const comment = (name: string) => lines[lines.findIndex((l) => l.startsWith(`${name}=`)) - 1];
    expect(comment("CAPTURE_BROWSER_MODE")).toContain("remote");
    expect(comment("BROWSER_USE_PROXY")).toContain("off");
    expect(comment("BROWSER_USE_SESSION_TIMEOUT_MINUTES")).toContain("default: 1");
    expect(comment("BROWSER_USE_SESSION_TIMEOUT_MINUTES")).not.toContain("default: 2");
  });

  it("gives every NAME= line an empty value", () => {
    const assignments = lines.filter((line) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(line));
    expect(assignments.length).toBeGreaterThan(0);
    for (const line of assignments) {
      expect(line).toMatch(/^[A-Za-z_][A-Za-z0-9_]*=$/);
    }
  });
});
