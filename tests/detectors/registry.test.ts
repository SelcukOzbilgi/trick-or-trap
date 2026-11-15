import { describe, it, expect, beforeEach } from "vitest";
import {
  registerDetector,
  runDetectors,
  _resetRegistryForTests,
} from "@/lib/detectors";
import type { PageSnapshot, Finding } from "@/lib/types";

// ── Shared fixtures ────────────────────────────────────────────────────────

const minimalSnapshot: PageSnapshot = {
  url: "https://example.com",
  capturedAt: "2025-01-01T00:00:00.000Z",
  viewportWidth: 1280,
  viewportHeight: 800,
  fullWidth: 1280,
  fullHeight: 3000,
  elements: [],
};

const validFinding: Finding = {
  patternId: "fake-urgency",
  confidence: "high",
  title: "Possible fake urgency",
  description: "A countdown timer restarts on every page reload.",
  evidence: { text: 'Countdown "Only 2 hours left!" resets on reload.' },
  elementIds: [],
  boundingBoxes: [],
  explanation:
    "Artificial time pressure may coerce users into rushed purchases.",
  detectorName: "fake-detector",
  detectedAt: "2025-01-01T00:00:00.000Z",
};

// ── Reset registry before every test ──────────────────────────────────────

beforeEach(() => {
  _resetRegistryForTests();
});

// ── Tests ──────────────────────────────────────────────────────────────────

describe("runDetectors", () => {
  it("returns [] when no detectors are registered (5.7)", () => {
    const results = runDetectors(minimalSnapshot);
    expect(results).toEqual([]);
  });

  it(
    "returns the finding from a registered detector that returns a valid Finding (5.5)",
    () => {
      function fakeDetector(_snapshot: PageSnapshot): Finding[] {
        return [validFinding];
      }
      registerDetector(fakeDetector);

      const results = runDetectors(minimalSnapshot);
      expect(results).toHaveLength(1);
      expect(results[0].title).toBe("Possible fake urgency");
    }
  );

  it(
    "calls detectors in registration order and collects all findings",
    () => {
      function detectorA(_snapshot: PageSnapshot): Finding[] {
        return [{ ...validFinding, title: "Possible fake urgency A" }];
      }
      function detectorB(_snapshot: PageSnapshot): Finding[] {
        return [{ ...validFinding, title: "Possible fake urgency B" }];
      }
      registerDetector(detectorA);
      registerDetector(detectorB);

      const results = runDetectors(minimalSnapshot);
      expect(results).toHaveLength(2);
      expect(results[0].title).toBe("Possible fake urgency A");
      expect(results[1].title).toBe("Possible fake urgency B");
    }
  );

  it(
    "throws TypeError when a detector returns a finding whose title does not start with 'Possible' (5.6)",
    () => {
      function badDetector(_snapshot: PageSnapshot): Finding[] {
        // Cast to bypass TypeScript — simulates a runtime schema violation
        return [{ ...validFinding, title: "Fake urgency detected" } as Finding];
      }
      registerDetector(badDetector);

      expect(() => runDetectors(minimalSnapshot)).toThrowError(TypeError);
    }
  );

  it(
    "includes the detector name in the error message when a finding is invalid",
    () => {
      function namedBadDetector(_snapshot: PageSnapshot): Finding[] {
        return [{ ...validFinding, title: "Not Possible" } as Finding];
      }
      registerDetector(namedBadDetector);

      expect(() => runDetectors(minimalSnapshot)).toThrow("namedBadDetector");
    }
  );
});
