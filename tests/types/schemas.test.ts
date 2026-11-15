import { describe, it, expect } from "vitest";
import { ZodError } from "zod";
import {
  FindingSchema,
  PageSnapshotSchema,
  BaseSnapshotSchema,
} from "@/lib/types";

// ── Shared fixtures ────────────────────────────────────────────────────────

const validBoundingBox = { x: 0, y: 0, width: 100, height: 50 };

const validElement = {
  id: "el-1",
  tag: "div",
  boundingBox: validBoundingBox,
  color: "rgb(0,0,0)",
  backgroundColor: "rgb(255,255,255)",
  fontSize: "16px",
  opacity: "1",
  display: "block",
  visibility: "visible",
  position: "static",
  checked: false,
  selected: false,
};

const validBaseSnapshot = {
  url: "https://example.com",
  capturedAt: "2025-01-01T00:00:00.000Z",
  viewportWidth: 1280,
  viewportHeight: 800,
  fullWidth: 1280,
  fullHeight: 3000,
  elements: [validElement],
};

const validFinding = {
  patternId: "fake-urgency",
  confidence: "high",
  title: "Possible fake urgency",
  description: "A countdown timer was observed.",
  evidence: { text: 'Countdown showing "Only 2 hours left!"' },
  elementIds: ["el-1"],
  boundingBoxes: [validBoundingBox],
  explanation: "Artificial time pressure may coerce users into rushed purchases.",
  detectorName: "fake-urgency",
  detectedAt: "2025-01-01T00:00:00.000Z",
};

// ── FindingSchema ──────────────────────────────────────────────────────────

describe("FindingSchema", () => {
  it("parses a fully valid finding without error (5.1)", () => {
    expect(() => FindingSchema.parse(validFinding)).not.toThrow();
    const result = FindingSchema.parse(validFinding);
    expect(result.patternId).toBe("fake-urgency");
    expect(result.confidence).toBe("high");
  });

  it("throws ZodError when title does not start with 'Possible' (5.2)", () => {
    const bad = { ...validFinding, title: "Fake urgency detected" };
    expect(() => FindingSchema.parse(bad)).toThrowError(ZodError);
  });

  it("throws ZodError for an invalid patternId", () => {
    const bad = { ...validFinding, patternId: "unknown-pattern" };
    expect(() => FindingSchema.parse(bad)).toThrowError(ZodError);
  });

  it("throws ZodError for an invalid confidence value", () => {
    const bad = { ...validFinding, confidence: "very-high" };
    expect(() => FindingSchema.parse(bad)).toThrowError(ZodError);
  });

  it("includes measuredValues when provided", () => {
    const withMeasured = {
      ...validFinding,
      evidence: { text: "contrast check", measuredValues: { ratio: 2.1 } },
    };
    const result = FindingSchema.parse(withMeasured);
    expect(result.evidence.measuredValues?.ratio).toBe(2.1);
  });
});

// ── PageSnapshotSchema ─────────────────────────────────────────────────────

describe("PageSnapshotSchema", () => {
  it("parses a valid snapshot without error (5.3)", () => {
    expect(() => PageSnapshotSchema.parse(validBaseSnapshot)).not.toThrow();
  });

  it("parses a snapshot with secondSample and afterReload", () => {
    const withSamples = {
      ...validBaseSnapshot,
      secondSample: validBaseSnapshot,
      afterReload: validBaseSnapshot,
    };
    expect(() => PageSnapshotSchema.parse(withSamples)).not.toThrow();
  });

  it("throws ZodError when a required field is missing (5.4)", () => {
    // omit url
    const { url: _url, ...withoutUrl } = validBaseSnapshot;
    expect(() => PageSnapshotSchema.parse(withoutUrl)).toThrowError(ZodError);
  });

  it("throws ZodError when capturedAt is missing", () => {
    const { capturedAt: _c, ...withoutCapturedAt } = validBaseSnapshot;
    expect(() =>
      PageSnapshotSchema.parse(withoutCapturedAt)
    ).toThrowError(ZodError);
  });

  it("throws ZodError when elements is not an array", () => {
    const bad = { ...validBaseSnapshot, elements: "not-an-array" };
    expect(() => PageSnapshotSchema.parse(bad)).toThrowError(ZodError);
  });
});

// ── BaseSnapshotSchema ─────────────────────────────────────────────────────

describe("BaseSnapshotSchema", () => {
  it("parses a valid base snapshot without error", () => {
    expect(() => BaseSnapshotSchema.parse(validBaseSnapshot)).not.toThrow();
  });

  it("throws ZodError when viewportWidth is missing", () => {
    const { viewportWidth: _vw, ...bad } = validBaseSnapshot;
    expect(() => BaseSnapshotSchema.parse(bad)).toThrowError(ZodError);
  });
});
