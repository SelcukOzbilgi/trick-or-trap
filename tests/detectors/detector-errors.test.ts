import { describe, expect, it } from "vitest";
import { createRegistry } from "@/lib/detectors";
import { STATIC_DETECTORS, STATIC_DETECTOR_NAMES, runAllDetectors } from "@/lib/detectors/all";
import { detectFakeUrgency } from "@/lib/detectors/fake-urgency";
import { PAGE_VARIANTS, buildVariantSnapshot } from "@/tests/detectors/eval/helpers/pages";
import type { Finding, PageSnapshot } from "@/lib/types";

/**
 * Detector exceptions are reported (requirements 6.1 to 6.7). A detector or a
 * shared helper never catches an exception: a read that itself throws, or a
 * bug, propagates, and `runDetectors` turns it into a `threw` error. Odd
 * values that can be read still give an array and no error. The messages of
 * the errors are for server logs only (requirement 6.10).
 */

function asSnapshot(value: unknown): PageSnapshot {
  return value as PageSnapshot;
}

const BOOM = "a hostile read";

/** A snapshot whose every property read throws. */
function throwingProxy(): PageSnapshot {
  return asSnapshot(
    new Proxy(
      {},
      {
        get() {
          throw new Error(BOOM);
        },
      }
    )
  );
}

/** A snapshot whose `elements` getter throws. */
function throwingElements(): PageSnapshot {
  return asSnapshot({
    get elements(): never {
      throw new Error(BOOM);
    },
  });
}

const NORMAL_SNAPSHOT: PageSnapshot = {
  url: "https://example.com",
  capturedAt: "2026-12-01T12:00:00.000Z",
  viewportWidth: 1280,
  viewportHeight: 800,
  fullWidth: 1280,
  fullHeight: 3000,
  elements: [
    {
      id: "el-1-1",
      tag: "span",
      text: "Sale ends in 04:59:59",
      boundingBox: { x: 0, y: 0, width: 100, height: 20 },
      color: "rgb(0, 0, 0)",
      backgroundColor: "rgba(0, 0, 0, 0)",
      fontSize: "16px",
      opacity: "1",
      display: "block",
      visibility: "visible",
      position: "static",
      checked: false,
      selected: false,
    },
  ],
};

const PROBE_FINDING: Finding = {
  patternId: "fake-urgency",
  confidence: "low",
  title: "Possible fake urgency",
  description: "A probe finding that a registry test returns.",
  evidence: { text: "probe" },
  elementIds: [],
  boundingBoxes: [],
  explanation: "A probe explanation.",
  detectorName: "probe",
  detectedAt: "2026-12-01T12:00:00.000Z",
};

const ODD_VALUES: ReadonlyArray<readonly [string, unknown]> = [
  ["undefined", undefined],
  ["null", null],
  ["a number", 42],
  ["an empty object", {}],
  ["elements that are a string", { elements: "x" }],
  ["elements with null, a number and an array", { elements: [null, 7, []] }],
];

describe("a hostile read is an exception, not odd input (requirements 6.4, 6.5)", () => {
  for (const [label, build] of [
    ["a proxy whose every read throws", throwingProxy],
    ["an elements getter that throws", throwingElements],
  ] as const) {
    it(`runAllDetectors reports six threw errors in registration order for ${label}`, () => {
      let result: ReturnType<typeof runAllDetectors> | undefined;
      expect(() => {
        result = runAllDetectors(build());
      }).not.toThrow();
      expect(result?.findings).toEqual([]);
      expect(result?.errors.map((error) => error.detectorName)).toEqual([
        ...STATIC_DETECTOR_NAMES,
      ]);
      expect(result?.errors.map((error) => error.kind)).toEqual(
        STATIC_DETECTOR_NAMES.map(() => "threw")
      );
      for (const error of result?.errors ?? []) expect(error.message).toContain(BOOM);
    });
  }

  for (const { name, detect } of STATIC_DETECTORS) {
    it(`${name} called directly throws on a proxy whose every read throws`, () => {
      expect(() => detect(throwingProxy())).toThrow(BOOM);
    });

    it(`${name} called directly throws on an elements getter that throws`, () => {
      expect(() => detect(throwingElements())).toThrow(BOOM);
    });
  }

  it("reports the error of the real detector and still returns the probe's finding (6.6)", () => {
    const registry = createRegistry();
    registry.registerDetector("fake-urgency", detectFakeUrgency);
    registry.registerDetector("probe", () => [PROBE_FINDING]);
    const result = registry.runDetectors(throwingElements());
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.detectorName).toBe("fake-urgency");
    expect(result.errors[0]?.kind).toBe("threw");
    expect(result.findings).toEqual([PROBE_FINDING]);
  });
});

describe("odd values that can be read give an array and no error (requirement 6.3)", () => {
  for (const [label, value] of ODD_VALUES) {
    for (const { name, detect } of STATIC_DETECTORS) {
      it(`${name} returns [] for ${label}`, () => {
        expect(detect(asSnapshot(value))).toEqual([]);
      });
    }

    it(`runAllDetectors returns no finding and no error for ${label}`, () => {
      const result = runAllDetectors(asSnapshot(value));
      expect(result.findings).toEqual([]);
      expect(result.errors).toEqual([]);
    });
  }
});

describe("normal snapshots report no error (requirement 6.7)", () => {
  it("runAllDetectors has errors: [] on a normal snapshot", () => {
    expect(runAllDetectors(NORMAL_SNAPSHOT).errors).toEqual([]);
  });

  for (const page of PAGE_VARIANTS) {
    it(`runAllDetectors has errors: [] on the harness variant ${page.id}`, () => {
      expect(runAllDetectors(buildVariantSnapshot(page).snapshot).errors).toEqual([]);
    });
  }
});

describe("the registration of the six detectors is unchanged (requirement 6.12)", () => {
  it("keeps the names and the order", () => {
    expect([...STATIC_DETECTOR_NAMES]).toEqual([
      "fake-urgency",
      "fake-scarcity",
      "fake-activity",
      "confirmshaming",
      "preselection",
      "visual-interference",
    ]);
  });
});
