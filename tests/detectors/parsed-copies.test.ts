import { describe, it, expect } from "vitest";
import { createRegistry } from "@/lib/detectors";
import type { Detector } from "@/lib/detectors";
import type { Finding, PageSnapshot } from "@/lib/types";

const snapshot: PageSnapshot = {
  url: "https://example.com",
  capturedAt: "2026-12-01T12:00:00.000Z",
  viewportWidth: 1280,
  viewportHeight: 800,
  fullWidth: 1280,
  fullHeight: 3000,
  elements: [],
};

function makeFinding(): Finding {
  return {
    patternId: "fake-urgency",
    confidence: "high",
    title: "Possible fake urgency",
    description: "A countdown showed a higher remaining time after a reload.",
    evidence: {
      text: 'Countdown "Sale ends in 01:59:59" showed 01:59:58, then 01:59:59.',
      measuredValues: { firstValue: 7198, reloadValue: 7199 },
    },
    elementIds: ["el-1-1"],
    boundingBoxes: [{ x: 0, y: 0, width: 10, height: 10 }],
    explanation: "Time limits that reset can push people to decide faster.",
    detectorName: "fake-urgency",
    detectedAt: "2026-12-01T12:00:00.000Z",
  };
}

describe("runDetectors returns parsed copies (foundation-fixes 3.6)", () => {
  it("drops an extra key from a returned finding", () => {
    const registry = createRegistry();
    const detector: Detector = () => [
      { ...makeFinding(), extra: 1 } as unknown as Finding,
    ];
    registry.registerDetector("extra-key", detector);

    const { findings, errors } = registry.runDetectors(snapshot);

    expect(errors).toEqual([]);
    expect(findings).toHaveLength(1);
    expect("extra" in findings[0]).toBe(false);
  });

  it("returns a finding that is not the same reference as the returned one", () => {
    const registry = createRegistry();
    const original = makeFinding();
    registry.registerDetector("same-reference", () => [original]);

    const { findings } = registry.runDetectors(snapshot);

    expect(findings).toHaveLength(1);
    expect(findings[0]).not.toBe(original);
    expect(findings[0]).toEqual(original);
  });

  it("returns an evidence object that is not the same reference as the original", () => {
    const registry = createRegistry();
    const original = makeFinding();
    registry.registerDetector("evidence-reference", () => [original]);

    const { findings } = registry.runDetectors(snapshot);

    expect(findings[0].evidence).not.toBe(original.evidence);
    expect(findings[0].evidence).toEqual(original.evidence);
  });

  it("is not changed by a later mutation of the original finding", () => {
    const registry = createRegistry();
    const original = makeFinding();
    registry.registerDetector("mutation", () => [original]);

    const { findings } = registry.runDetectors(snapshot);
    original.evidence.text = "changed after the run";

    expect(findings[0].evidence.text).not.toBe("changed after the run");
  });
});
