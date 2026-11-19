import { describe, expect, expectTypeOf, it } from "vitest";
import { COULD_NOT_SCAN_REASONS, toScanOutcome } from "@/lib/capture/outcome";
import {
  ERROR_MESSAGES,
  type CaptureErrorCode,
  type CaptureImage,
  type CaptureResult,
  type CaptureWarning,
  type CouldNotScanReason,
  type ScanOutcome,
} from "@/lib/capture/types";
import type { PageSnapshot } from "@/lib/types";

/** Hard-coded on purpose: adding or removing an error code must change this list. */
const ALL_ERROR_CODES: CaptureErrorCode[] = [
  "url-invalid",
  "url-too-long",
  "url-scheme-blocked",
  "url-credentials-blocked",
  "url-port-blocked",
  "url-host-blocked",
  "url-address-blocked",
  "dns-failed",
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

const SENTINEL = "SENTINEL-detail-text-9f3a";

const WARNINGS: CaptureWarning[] = [
  { code: "request-blocked", message: "A navigation request was blocked by a safety check.", reason: "url-port-blocked", count: 2 },
  { code: "redirected", message: "The page address after loading differs from the requested address." },
];

function failure(code: CaptureErrorCode, detail?: string): CaptureResult {
  return {
    ok: false,
    error: { code, message: ERROR_MESSAGES[code], ...(detail === undefined ? {} : { detail }) },
    warnings: WARNINGS,
  };
}

function success(): Extract<CaptureResult, { ok: true }> {
  const snapshot = { url: "https://shop.example.com/" } as unknown as PageSnapshot;
  const images: CaptureImage[] = [
    { offsetY: 0, width: 10, height: 20, bytes: new Uint8Array([1, 2, 3]), base64Length: 4 },
  ];
  return { ok: true, snapshot, images, warnings: WARNINGS };
}

describe("COULD_NOT_SCAN_REASONS", () => {
  it("lists exactly the 25 error codes", () => {
    expect(ALL_ERROR_CODES).toHaveLength(25);
    expect(new Set(ALL_ERROR_CODES).size).toBe(25);
    expect(Object.keys(ERROR_MESSAGES).sort()).toEqual([...ALL_ERROR_CODES].sort());
    expect(Object.keys(COULD_NOT_SCAN_REASONS).sort()).toEqual([...ALL_ERROR_CODES].sort());
  });

  it("maps each code to its own reason", () => {
    for (const code of ALL_ERROR_CODES) expect(COULD_NOT_SCAN_REASONS[code]).toBe(code);
  });

  it("is keyed by every capture error code at the type level", () => {
    expectTypeOf(COULD_NOT_SCAN_REASONS).toEqualTypeOf<Readonly<Record<CaptureErrorCode, CouldNotScanReason>>>();
  });
});

describe("toScanOutcome", () => {
  it.each(ALL_ERROR_CODES)("maps the failure %s to could-not-scan with its reason and fixed message", (code) => {
    const outcome = toScanOutcome(failure(code));
    expect(outcome).toEqual({
      status: "could-not-scan",
      reason: COULD_NOT_SCAN_REASONS[code],
      message: ERROR_MESSAGES[code],
      warnings: WARNINGS,
    });
  });

  it("maps a success to captured with the snapshot, the images and the warnings", () => {
    const result = success();
    const outcome = toScanOutcome(result);
    expect(outcome).toEqual({
      status: "captured",
      snapshot: result.snapshot,
      images: result.images,
      warnings: WARNINGS,
    });
  });

  it("keeps the detail of a failure out of the outcome", () => {
    const outcome = toScanOutcome(failure("connect-failed", `socket ${SENTINEL} closed`));
    expect(JSON.stringify(outcome)).not.toContain(SENTINEL);
    expect(Object.keys(outcome).sort()).toEqual(["message", "reason", "status", "warnings"]);
    for (const key of ["detail", "snapshot", "images", "findings"]) {
      expect(outcome).not.toHaveProperty(key);
    }
  });

  it("keeps the detail out for another failure code too", () => {
    const outcome = toScanOutcome(failure("navigation-failed", SENTINEL));
    expect(JSON.stringify(outcome)).not.toContain(SENTINEL);
  });

  it("returns equal outcomes for equal results and leaves the input unchanged", () => {
    const a = failure("guard-lost", SENTINEL);
    const b = failure("guard-lost", SENTINEL);
    const before = JSON.stringify(a);
    expect(toScanOutcome(a)).toEqual(toScanOutcome(b));
    expect(JSON.stringify(a)).toBe(before);
    const ok = success();
    expect(toScanOutcome(ok)).toEqual(toScanOutcome(success()));
  });

  it("has no detail on the could-not-scan arm at the type level", () => {
    type Failure = Extract<ScanOutcome, { status: "could-not-scan" }>;
    expectTypeOf<Failure>().not.toHaveProperty("detail");
    expectTypeOf<Failure>().not.toHaveProperty("snapshot");
    expectTypeOf<Failure>().not.toHaveProperty("images");
    expectTypeOf<Failure>().not.toHaveProperty("findings");
    expectTypeOf<Failure["reason"]>().toEqualTypeOf<CouldNotScanReason>();
    expectTypeOf<CouldNotScanReason>().toEqualTypeOf<CaptureErrorCode>();
  });

  it("returns a ScanOutcome", () => {
    expectTypeOf(toScanOutcome).returns.toEqualTypeOf<ScanOutcome>();
  });
});
