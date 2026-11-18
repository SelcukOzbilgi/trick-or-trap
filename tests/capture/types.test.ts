import { describe, expect, it } from "vitest";
import {
  CaptureFailure,
  ERROR_MESSAGES,
  WARNING_MESSAGES,
  type CaptureErrorCode,
  type CaptureWarning,
  type CaptureWarningCode,
  type GuardReasonCode,
  type UrlErrorCode,
} from "@/lib/capture/types";

const URL_CODES: UrlErrorCode[] = [
  "url-invalid",
  "url-too-long",
  "url-scheme-blocked",
  "url-credentials-blocked",
  "url-port-blocked",
  "url-host-blocked",
  "url-address-blocked",
  "dns-failed",
];

const OTHER_CODES: CaptureErrorCode[] = [
  "config-invalid",
  "browser-mode-unsupported",
  "session-create-failed",
  "session-create-timeout",
  "connect-failed",
  "connect-timeout",
  "navigation-failed",
  "navigation-timeout",
  "navigation-blocked",
  "page-read-failed",
  "screenshot-failed",
  "screenshot-too-large",
  "snapshot-invalid",
  "snapshot-too-large",
  "capture-timeout",
  "internal-error",
  "guard-lost",
];

const GUARD_ONLY_REASONS: GuardReasonCode[] = [
  "service-worker-blocked",
  "host-limit-reached",
  "response-too-large",
  "response-rewrite-failed",
];

const WARNING_CODES: CaptureWarningCode[] = [
  "session-stop-failed",
  "reload-skipped",
  "reload-failed",
  "redirected",
  "elements-truncated",
  "screenshot-truncated",
  "tall-page-tiled",
  "download-refused",
  "popup-closed",
  "request-blocked",
  "request-host-limit",
  "layout-shifted",
];

function expectSafeText(text: string): void {
  expect(text.length).toBeGreaterThan(0);
  expect(text.toLowerCase()).not.toContain("http");
  expect(text).not.toContain("ws://");
  expect(text).not.toContain("wss://");
  expect(text).not.toMatch(/[{}]|\$\{|%s|<[a-z]+>/i);
}

describe("ERROR_MESSAGES", () => {
  it("has 8 url codes and 17 other codes in the table (25 in all)", () => {
    expect(URL_CODES).toHaveLength(8);
    expect(OTHER_CODES).toHaveLength(17);
    expect(Object.keys(ERROR_MESSAGES)).toHaveLength(25);
    expect(Object.keys(ERROR_MESSAGES).sort()).toEqual(
      [...URL_CODES, ...OTHER_CODES].sort()
    );
  });

  it("has a fixed message for guard-lost that differs from connect-failed", () => {
    expect(ERROR_MESSAGES["guard-lost"]).toBeTruthy();
    expect(ERROR_MESSAGES["guard-lost"]).not.toBe(ERROR_MESSAGES["connect-failed"]);
  });

  it("has a fixed message for snapshot-too-large that differs from snapshot-invalid", () => {
    expect(ERROR_MESSAGES["snapshot-too-large"]).toBeTruthy();
    expect(ERROR_MESSAGES["snapshot-too-large"]).not.toBe(ERROR_MESSAGES["snapshot-invalid"]);
  });

  it.each([...URL_CODES, ...OTHER_CODES])(
    "has a safe fixed message for %s",
    (code) => {
      expectSafeText(ERROR_MESSAGES[code]);
    }
  );

  it("uses a different message for every code", () => {
    const messages = Object.values(ERROR_MESSAGES);
    expect(new Set(messages).size).toBe(messages.length);
  });
});

describe("GuardReasonCode", () => {
  it("holds every url error code and four guard-only reasons", () => {
    const reasons: GuardReasonCode[] = [...URL_CODES, ...GUARD_ONLY_REASONS];
    expect(new Set(reasons).size).toBe(12);
  });

  it("keeps the guard-only reasons out of the capture error codes", () => {
    const errorCodes = Object.keys(ERROR_MESSAGES);
    for (const reason of GUARD_ONLY_REASONS) expect(errorCodes).not.toContain(reason);
    // @ts-expect-error a guard-only reason is not a capture error code
    const notAnError: CaptureErrorCode = "service-worker-blocked";
    expect(notAnError).toBe("service-worker-blocked");
  });

  it("accepts every url error code", () => {
    for (const code of URL_CODES) {
      const reason: GuardReasonCode = code;
      expect(reason).toBe(code);
    }
  });

  it("is accepted as the reason of a warning", () => {
    for (const reason of GUARD_ONLY_REASONS) {
      const warning: CaptureWarning = { code: "request-blocked", message: "x", reason, count: 1 };
      expect(warning.reason).toBe(reason);
    }
  });
});

describe("WARNING_MESSAGES", () => {
  it("has exactly the 12 warning codes", () => {
    expect(WARNING_CODES).toHaveLength(12);
    expect(Object.keys(WARNING_MESSAGES).sort()).toEqual([...WARNING_CODES].sort());
  });

  it.each(WARNING_CODES)("has a safe fixed message for %s", (code) => {
    expectSafeText(WARNING_MESSAGES[code]);
  });

  it("has distinct messages for the new warning codes", () => {
    expect(WARNING_MESSAGES["request-host-limit"]).not.toBe(WARNING_MESSAGES["request-blocked"]);
    expect(WARNING_MESSAGES["layout-shifted"]).toBeTruthy();
  });
});

describe("CaptureFailure", () => {
  it("carries the code and the fixed message", () => {
    const failure = new CaptureFailure("navigation-failed");
    expect(failure).toBeInstanceOf(Error);
    expect(failure.code).toBe("navigation-failed");
    expect(failure.message).toBe(ERROR_MESSAGES["navigation-failed"]);
    expect(failure.detail).toBeUndefined();
    expect(failure.reclaim).toBe(false);
  });

  it("defaults reclaim to false when the detail is given", () => {
    expect(new CaptureFailure("session-create-failed", "HTTP 500").reclaim).toBe(false);
  });

  it("sets reclaim to true when the option is given", () => {
    const failure = new CaptureFailure("session-create-timeout", undefined, { reclaim: true });
    expect(failure.reclaim).toBe(true);
    expect(failure.detail).toBeUndefined();
    expect(failure.message).toBe(ERROR_MESSAGES["session-create-timeout"]);
  });

  it("keeps the detail next to the reclaim option", () => {
    const failure = new CaptureFailure("session-create-failed", "fetch failed", { reclaim: true });
    expect(failure.detail).toBe("fetch failed");
    expect(failure.reclaim).toBe(true);
  });

  it("carries the detail without putting it into the message", () => {
    const failure = new CaptureFailure("connect-failed", "socket hang up");
    expect(failure.detail).toBe("socket hang up");
    expect(failure.message).toBe(ERROR_MESSAGES["connect-failed"]);
    expect(failure.message).not.toContain("socket");
  });

  it.each([...URL_CODES, ...OTHER_CODES])(
    "uses ERROR_MESSAGES as the message for %s",
    (code) => {
      expect(new CaptureFailure(code).message).toBe(ERROR_MESSAGES[code]);
    }
  );
});
