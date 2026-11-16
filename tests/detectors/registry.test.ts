import { describe, it, expect } from "vitest";
import * as detectorsModule from "@/lib/detectors";
import {
  createRegistry,
  defaultRegistry,
  registerDetector as defaultRegisterDetector,
  runDetectors as defaultRunDetectors,
} from "@/lib/detectors";
import type { Detector } from "@/lib/detectors";
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

/** A finding that fails FindingSchema because the title lacks "Possible". */
const invalidFinding = {
  ...validFinding,
  title: "Fake urgency detected",
} as Finding;

/** Wrap a function that returns something other than Finding[] as a Detector. */
function asDetector(fn: () => unknown): Detector {
  return fn as unknown as Detector;
}

function throwValue(value: unknown): never {
  throw value;
}

// ── Factory and exports (1.1) ──────────────────────────────────────────────

describe("createRegistry", () => {
  it("returns an object whose only members are registerDetector and runDetectors", () => {
    const registry = createRegistry();
    expect(Object.keys(registry).sort()).toEqual([
      "registerDetector",
      "runDetectors",
    ]);
  });

  it("returns registries whose detectors are independent", () => {
    const first = createRegistry();
    const second = createRegistry();
    first.registerDetector("only-in-first", () => [validFinding]);

    expect(first.runDetectors(minimalSnapshot).findings).toHaveLength(1);
    expect(second.runDetectors(minimalSnapshot)).toEqual({
      findings: [],
      errors: [],
    });
  });

  it("works when the methods are destructured and called without a receiver", () => {
    const { registerDetector, runDetectors } = createRegistry();
    registerDetector("destructured", () => [validFinding]);

    expect(runDetectors(minimalSnapshot).findings).toHaveLength(1);
  });
});

describe("module exports", () => {
  it("exports exactly four runtime values", () => {
    expect(Object.keys(detectorsModule).sort()).toEqual([
      "createRegistry",
      "defaultRegistry",
      "registerDetector",
      "runDetectors",
    ]);
  });

  it("does not export _resetRegistryForTests", () => {
    expect("_resetRegistryForTests" in detectorsModule).toBe(false);
  });

  it("module-level functions operate on defaultRegistry", () => {
    const name = "module-level-default-registry-test";
    defaultRegisterDetector(name, () => [validFinding]);

    const viaModule = defaultRunDetectors(minimalSnapshot);
    const viaInstance = defaultRegistry.runDetectors(minimalSnapshot);

    expect(viaModule.errors).toEqual([]);
    expect(viaModule.findings).toContainEqual(validFinding);
    expect(viaInstance.findings).toEqual(viaModule.findings);
    expect(() => defaultRegisterDetector(name, () => [])).toThrow(name);
  });
});

// ── Registration (1.2) ─────────────────────────────────────────────────────

describe("registerDetector", () => {
  it("throws on a duplicate name, names it in the message, and keeps the first detector running once", () => {
    const registry = createRegistry();
    let firstCalls = 0;
    registry.registerDetector("dup-detector", () => {
      firstCalls += 1;
      return [validFinding];
    });

    expect(() =>
      registry.registerDetector("dup-detector", () => [validFinding])
    ).toThrow("dup-detector");

    const result = registry.runDetectors(minimalSnapshot);
    expect(firstCalls).toBe(1);
    expect(result.findings).toHaveLength(1);
    expect(result.errors).toEqual([]);
  });

  it.each([
    ["an empty string", ""],
    ["a whitespace-only string", "   \t"],
  ])("throws TypeError for %s as the name and leaves the registry unchanged", (_label, name) => {
    const registry = createRegistry();
    let calls = 0;

    expect(() =>
      registry.registerDetector(name, () => {
        calls += 1;
        return [validFinding];
      })
    ).toThrowError(TypeError);

    expect(registry.runDetectors(minimalSnapshot)).toEqual({
      findings: [],
      errors: [],
    });
    expect(calls).toBe(0);
  });

  it("accepts the same name once in each of two registries", () => {
    const first = createRegistry();
    const second = createRegistry();

    expect(() => first.registerDetector("shared-name", () => [])).not.toThrow();
    expect(() =>
      second.registerDetector("shared-name", () => [])
    ).not.toThrow();
  });

  it("compares names case-sensitively", () => {
    const registry = createRegistry();
    registry.registerDetector("Case-Name", () => [validFinding]);

    expect(() =>
      registry.registerDetector("case-name", () => [validFinding])
    ).not.toThrow();
    expect(registry.runDetectors(minimalSnapshot).findings).toHaveLength(2);
  });
});

// ── Running (1.3) ──────────────────────────────────────────────────────────

describe("runDetectors", () => {
  it("returns empty findings and errors when no detectors are registered", () => {
    const registry = createRegistry();
    expect(registry.runDetectors(minimalSnapshot)).toEqual({
      findings: [],
      errors: [],
    });
  });

  it("returns the findings of a detector that returns valid findings, with no errors", () => {
    const registry = createRegistry();
    registry.registerDetector("valid-detector", () => [validFinding]);

    const result = registry.runDetectors(minimalSnapshot);
    expect(result.findings).toEqual([validFinding]);
    expect(result.errors).toEqual([]);
  });

  it("passes the snapshot to every detector", () => {
    const registry = createRegistry();
    const received: PageSnapshot[] = [];
    registry.registerDetector("spy-a", (snapshot) => {
      received.push(snapshot);
      return [];
    });
    registry.registerDetector("spy-b", (snapshot) => {
      received.push(snapshot);
      return [];
    });

    registry.runDetectors(minimalSnapshot);
    expect(received).toEqual([minimalSnapshot, minimalSnapshot]);
  });

  it("orders findings by detector registration order, then by array position", () => {
    const registry = createRegistry();
    registry.registerDetector("detector-a", () => [
      { ...validFinding, title: "Possible A1" },
      { ...validFinding, title: "Possible A2" },
    ]);
    registry.registerDetector("detector-b", () => [
      { ...validFinding, title: "Possible B1" },
    ]);

    const titles = registry
      .runDetectors(minimalSnapshot)
      .findings.map((f) => f.title);
    expect(titles).toEqual(["Possible A1", "Possible A2", "Possible B1"]);
  });

  it("does not accumulate findings across calls", () => {
    const registry = createRegistry();
    let calls = 0;
    registry.registerDetector("counted", () => {
      calls += 1;
      return [validFinding];
    });

    registry.runDetectors(minimalSnapshot);
    const second = registry.runDetectors(minimalSnapshot);

    expect(calls).toBe(2);
    expect(second.findings).toHaveLength(1);
  });
});

// ── Failure isolation and reporting (1.4) ──────────────────────────────────

describe("runDetectors failure handling", () => {
  it("records a thrown Error as a 'threw' error with the registered name and message", () => {
    const registry = createRegistry();
    registry.registerDetector("throws-error", () => {
      throw new Error("boom");
    });

    const result = registry.runDetectors(minimalSnapshot);
    expect(result.findings).toEqual([]);
    expect(result.errors).toHaveLength(1);
    const [error] = result.errors;
    expect(error.kind).toBe("threw");
    expect(error.detectorName).toBe("throws-error");
    expect(error.message).toContain("throws-error");
    expect(error.message).toContain("boom");
    expect(error.findingIndex).toBeUndefined();
    expect(error.finding).toBeUndefined();
  });

  it("records a thrown string as a 'threw' error that includes the text", () => {
    const registry = createRegistry();
    registry.registerDetector(
      "throws-string",
      asDetector(() => throwValue("plain text failure"))
    );

    const result = registry.runDetectors(minimalSnapshot);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].kind).toBe("threw");
    expect(result.errors[0].detectorName).toBe("throws-string");
    expect(result.errors[0].message).toContain("throws-string");
    expect(result.errors[0].message).toContain("plain text failure");
  });

  it.each([
    ["undefined", () => undefined],
    ["null", () => null],
    ["a plain object", () => ({ findings: [] })],
    ["a Promise", () => Promise.resolve([validFinding])],
  ])("records %s as a 'non-array' error", (_label, returnValue) => {
    const registry = createRegistry();
    registry.registerDetector("returns-non-array", asDetector(returnValue));

    const result = registry.runDetectors(minimalSnapshot);
    expect(result.findings).toEqual([]);
    expect(result.errors).toHaveLength(1);
    const [error] = result.errors;
    expect(error.kind).toBe("non-array");
    expect(error.detectorName).toBe("returns-non-array");
    expect(error.message).toContain("returns-non-array");
    expect(error.message).toContain("did not return an array");
    expect(error.findingIndex).toBeUndefined();
    expect(error.finding).toBeUndefined();
  });

  it("reports an invalid finding in the middle of an array with its index and JSON", () => {
    const registry = createRegistry();
    registry.registerDetector("bad-middle", () => [
      validFinding,
      invalidFinding,
      validFinding,
    ]);

    const result = registry.runDetectors(minimalSnapshot);
    expect(result.findings).toHaveLength(2);
    expect(result.errors).toHaveLength(1);
    const [error] = result.errors;
    expect(error.kind).toBe("invalid-finding");
    expect(error.detectorName).toBe("bad-middle");
    expect(error.findingIndex).toBe(1);
    expect(error.finding).toBe(JSON.stringify(invalidFinding));
    expect(error.message).toContain("bad-middle");
    expect(error.message).toContain("index 1");
    expect(error.message).toContain(JSON.stringify(invalidFinding));
    expect(error.message).toContain("title");
  });

  it("keeps valid items and reports one error for each invalid item in a mixed array", () => {
    const registry = createRegistry();
    registry.registerDetector("mixed", () => [
      invalidFinding,
      { ...validFinding, title: "Possible kept" },
      { ...validFinding, confidence: "very-high" } as unknown as Finding,
    ]);

    const result = registry.runDetectors(minimalSnapshot);
    expect(result.findings.map((f) => f.title)).toEqual(["Possible kept"]);
    expect(result.errors.map((e) => e.kind)).toEqual([
      "invalid-finding",
      "invalid-finding",
    ]);
    expect(result.errors.map((e) => e.findingIndex)).toEqual([0, 2]);
  });

  it("reports an undefined item with finding 'undefined'", () => {
    const registry = createRegistry();
    registry.registerDetector(
      "undefined-item",
      asDetector(() => [undefined])
    );

    const result = registry.runDetectors(minimalSnapshot);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].kind).toBe("invalid-finding");
    expect(result.errors[0].findingIndex).toBe(0);
    expect(result.errors[0].finding).toBe("undefined");
  });

  it("reports a circular item with finding '[unserializable finding]'", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const registry = createRegistry();
    registry.registerDetector(
      "circular-item",
      asDetector(() => [circular])
    );

    const result = registry.runDetectors(minimalSnapshot);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].kind).toBe("invalid-finding");
    expect(result.errors[0].finding).toBe("[unserializable finding]");
    expect(result.errors[0].message).toContain("circular-item");
  });

  it("uses the registered name for an inline anonymous arrow detector", () => {
    const registry = createRegistry();
    registry.registerDetector("anon-arrow", () => {
      throw new Error("anonymous failure");
    });
    registry.registerDetector("anon-arrow-bad-finding", () => [
      invalidFinding,
    ]);

    const result = registry.runDetectors(minimalSnapshot);
    expect(result.errors.map((e) => e.detectorName)).toEqual([
      "anon-arrow",
      "anon-arrow-bad-finding",
    ]);
    for (const error of result.errors) {
      expect(error.message).toContain(error.detectorName);
    }
  });

  it("uses the registered name for a function whose own name is 'default'", () => {
    const fn = () => [invalidFinding];
    Object.defineProperty(fn, "name", { value: "default" });
    expect(fn.name).toBe("default");

    const registry = createRegistry();
    registry.registerDetector("registered-as-this", fn);

    const result = registry.runDetectors(minimalSnapshot);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].detectorName).toBe("registered-as-this");
    expect(result.errors[0].message).toContain('"registered-as-this"');
    expect(result.errors[0].message).not.toContain('Detector "default"');
  });

  it("still runs detectors registered after a failing one and does not throw", () => {
    const registry = createRegistry();
    registry.registerDetector("fails-first", () => {
      throw new Error("first detector broke");
    });
    registry.registerDetector("healthy-second", () => [
      { ...validFinding, title: "Possible healthy" },
    ]);

    let result: ReturnType<typeof registry.runDetectors> | undefined;
    expect(() => {
      result = registry.runDetectors(minimalSnapshot);
    }).not.toThrow();

    expect(result?.findings.map((f) => f.title)).toEqual(["Possible healthy"]);
    expect(result?.errors).toHaveLength(1);
    expect(result?.errors[0].detectorName).toBe("fails-first");
  });

  it("returns errors as plain data that survives a JSON round trip", () => {
    const registry = createRegistry();
    registry.registerDetector("throws", () => {
      throw new Error("boom");
    });
    registry.registerDetector(
      "non-array",
      asDetector(() => null)
    );
    registry.registerDetector("invalid", () => [invalidFinding]);

    const { errors } = registry.runDetectors(minimalSnapshot);
    expect(errors).toHaveLength(3);
    expect(JSON.parse(JSON.stringify(errors))).toEqual(errors);
    for (const error of errors) {
      expect(error).not.toBeInstanceOf(Error);
    }
  });
});
