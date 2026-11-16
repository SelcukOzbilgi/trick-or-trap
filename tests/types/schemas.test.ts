import { describe, it, expect } from "vitest";
import { ZodError } from "zod";
import {
  BoundingBoxSchema,
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

// ── ISO-8601 timestamps (foundation-fixes 5.1 to 5.4) ──────────────────────

describe("timestamp validation", () => {
  const badDates = ["not a date", "2025-01-01"];

  it("still accepts a valid ISO-8601 capturedAt and detectedAt", () => {
    expect(() => BaseSnapshotSchema.parse(validBaseSnapshot)).not.toThrow();
    expect(() => PageSnapshotSchema.parse(validBaseSnapshot)).not.toThrow();
    expect(() => FindingSchema.parse(validFinding)).not.toThrow();
  });

  it.each(badDates)("FindingSchema rejects detectedAt %j", (detectedAt) => {
    const bad = { ...validFinding, detectedAt };
    expect(() => FindingSchema.parse(bad)).toThrowError(ZodError);
  });

  it.each(badDates)("BaseSnapshotSchema rejects capturedAt %j", (capturedAt) => {
    const bad = { ...validBaseSnapshot, capturedAt };
    expect(() => BaseSnapshotSchema.parse(bad)).toThrowError(ZodError);
  });

  it.each(badDates)("PageSnapshotSchema rejects capturedAt %j", (capturedAt) => {
    const bad = { ...validBaseSnapshot, capturedAt };
    expect(() => PageSnapshotSchema.parse(bad)).toThrowError(ZodError);
  });
});

// ── Nested samples (foundation-fixes 5.5, 6.3 to 6.5) ──────────────────────

describe("PageSnapshotSchema nested samples", () => {
  it("rejects an invalid capturedAt inside secondSample", () => {
    const bad = {
      ...validBaseSnapshot,
      secondSample: { ...validBaseSnapshot, capturedAt: "not a date" },
    };
    const result = PageSnapshotSchema.safeParse(bad);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].path[0]).toBe("secondSample");
  });

  it("rejects an invalid capturedAt inside afterReload", () => {
    const bad = {
      ...validBaseSnapshot,
      afterReload: { ...validBaseSnapshot, capturedAt: "2025-01-01" },
    };
    const result = PageSnapshotSchema.safeParse(bad);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].path[0]).toBe("afterReload");
  });

  it("rejects a secondSample element without tag, with the full path", () => {
    const { tag: _tag, ...elementWithoutTag } = validElement;
    const bad = {
      ...validBaseSnapshot,
      secondSample: { ...validBaseSnapshot, elements: [elementWithoutTag] },
    };
    const result = PageSnapshotSchema.safeParse(bad);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].path).toEqual([
      "secondSample",
      "elements",
      0,
      "tag",
    ]);
  });

  it("rejects an invalid element inside afterReload", () => {
    const bad = {
      ...validBaseSnapshot,
      afterReload: {
        ...validBaseSnapshot,
        elements: [{ ...validElement, checked: "yes" }],
      },
    };
    const result = PageSnapshotSchema.safeParse(bad);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].path.slice(0, 3)).toEqual([
      "afterReload",
      "elements",
      0,
    ]);
  });

  it("rejects a secondSample without url", () => {
    const { url: _url, ...sampleWithoutUrl } = validBaseSnapshot;
    const bad = { ...validBaseSnapshot, secondSample: sampleWithoutUrl };
    const result = PageSnapshotSchema.safeParse(bad);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].path[0]).toBe("secondSample");
  });
});

// ── BoundingBoxSchema (foundation-fixes 5.6 to 5.9) ────────────────────────

describe("BoundingBoxSchema", () => {
  it("rejects a negative width", () => {
    const bad = { ...validBoundingBox, width: -1 };
    expect(() => BoundingBoxSchema.parse(bad)).toThrowError(ZodError);
  });

  it("rejects a negative height", () => {
    const bad = { ...validBoundingBox, height: -1 };
    expect(() => BoundingBoxSchema.parse(bad)).toThrowError(ZodError);
  });

  it("accepts a width and height of 0", () => {
    const zero = { ...validBoundingBox, width: 0, height: 0 };
    expect(() => BoundingBoxSchema.parse(zero)).not.toThrow();
  });

  it("accepts a negative x and y", () => {
    const offscreen = { ...validBoundingBox, x: -20, y: -5 };
    expect(() => BoundingBoxSchema.parse(offscreen)).not.toThrow();
  });

  it("rejects a negative width inside FindingSchema.boundingBoxes", () => {
    const bad = {
      ...validFinding,
      boundingBoxes: [{ ...validBoundingBox, width: -1 }],
    };
    expect(() => FindingSchema.parse(bad)).toThrowError(ZodError);
  });
});

// ── "Possible" rule applies to the title only (foundation-fixes 6.1, 6.2) ──

describe("FindingSchema title and description", () => {
  it("accepts a valid title with a description that does not start with 'Possible'", () => {
    const finding = {
      ...validFinding,
      title: "Possible fake urgency",
      description: "A countdown timer was observed.",
    };
    expect(() => FindingSchema.parse(finding)).not.toThrow();
  });

  it("still rejects a title without the 'Possible' prefix", () => {
    const bad = {
      ...validFinding,
      title: "Fake urgency detected",
      description: "Possible fake urgency was observed.",
    };
    expect(() => FindingSchema.parse(bad)).toThrowError(ZodError);
  });
});
