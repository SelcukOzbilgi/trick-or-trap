import { readFileSync } from "node:fs";
import { describe, it, expect, vi } from "vitest";
import * as detectorsModule from "@/lib/detectors";
import { defaultRegistry } from "@/lib/detectors";
import {
  STATIC_DETECTOR_NAMES,
  STATIC_DETECTORS,
  createStaticRegistry,
  runAllDetectors,
} from "@/lib/detectors/all";
import type { PageSnapshot } from "@/lib/types";

const EXPECTED_NAMES = [
  "fake-urgency",
  "fake-scarcity",
  "fake-activity",
  "confirmshaming",
  "preselection",
  "visual-interference",
];

const DETECTOR_MODULES = [
  "fake-urgency",
  "fake-scarcity",
  "fake-activity",
  "confirmshaming",
  "preselection",
  "visual-interference",
] as const;

const emptySnapshot: PageSnapshot = {
  url: "https://example.com",
  capturedAt: "2026-12-01T12:00:00.000Z",
  viewportWidth: 1280,
  viewportHeight: 800,
  fullWidth: 1280,
  fullHeight: 3000,
  elements: [],
};

const snapshotWithElement: PageSnapshot = {
  ...emptySnapshot,
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

// ── Part one: names, empty snapshot, fresh registries (4.1, 4.2, 4.3, 4.8) ──

describe("static detector names and registries", () => {
  it("lists the six names in the order of requirement 4.2", () => {
    expect([...STATIC_DETECTOR_NAMES]).toEqual(EXPECTED_NAMES);
  });

  it("freezes the list of names", () => {
    expect(Object.isFrozen(STATIC_DETECTOR_NAMES)).toBe(true);
  });

  it("freezes STATIC_DETECTORS and keeps the same order", () => {
    expect(Object.isFrozen(STATIC_DETECTORS)).toBe(true);
    expect(STATIC_DETECTORS.map((entry) => entry.name)).toEqual(EXPECTED_NAMES);
    for (const entry of STATIC_DETECTORS) {
      expect(typeof entry.detect).toBe("function");
    }
  });

  it("returns no findings and no errors for an empty snapshot", () => {
    expect(runAllDetectors(emptySnapshot)).toEqual({
      findings: [],
      errors: [],
    });
  });

  it("returns a different registry on each call of createStaticRegistry", () => {
    const first = createStaticRegistry();
    const second = createStaticRegistry();
    expect(first).not.toBe(second);
    expect(first.runDetectors(emptySnapshot)).toEqual({
      findings: [],
      errors: [],
    });
    expect(second.runDetectors(emptySnapshot)).toEqual({
      findings: [],
      errors: [],
    });
  });

  it("registers every static name once, so a second registration of one name throws", () => {
    const registry = createStaticRegistry();
    for (const name of EXPECTED_NAMES) {
      expect(() => registry.registerDetector(name, () => [])).toThrow();
    }
  });

  it("does not share registered detectors between two registries", () => {
    const first = createStaticRegistry();
    first.registerDetector("extra", () => []);
    const second = createStaticRegistry();
    expect(() => second.registerDetector("extra", () => [])).not.toThrow();
  });
});

// ── Part two: second module instance (4.5) ─────────────────────────────────

describe("importing all.ts twice", () => {
  it("works after vi.resetModules and gives deep-equal results", async () => {
    const first = await import("@/lib/detectors/all");
    vi.resetModules();
    const second = await import("@/lib/detectors/all");

    expect(second).not.toBe(first);
    let resultFirst: ReturnType<typeof first.runAllDetectors> | undefined;
    let resultSecond: ReturnType<typeof second.runAllDetectors> | undefined;
    expect(() => {
      resultFirst = first.runAllDetectors(snapshotWithElement);
      resultSecond = second.runAllDetectors(snapshotWithElement);
    }).not.toThrow();
    expect(resultSecond).toEqual(resultFirst);
    expect(resultFirst).toBeDefined();
  });
});

// ── Part three: no side-effect registration (4.4, 4.6, 4.7) ────────────────

describe("registration wiring", () => {
  it("adds no detector to defaultRegistry by importing all.ts", () => {
    const result = defaultRegistry.runDetectors(snapshotWithElement);
    const staticNames = new Set<string>(EXPECTED_NAMES);
    expect(
      result.findings.filter((finding) => staticNames.has(finding.detectorName))
    ).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  const LOADERS: Record<(typeof DETECTOR_MODULES)[number], () => Promise<object>> =
    {
      "fake-urgency": () => import("@/lib/detectors/fake-urgency"),
      "fake-scarcity": () => import("@/lib/detectors/fake-scarcity"),
      "fake-activity": () => import("@/lib/detectors/fake-activity"),
      confirmshaming: () => import("@/lib/detectors/confirmshaming"),
      preselection: () => import("@/lib/detectors/preselection"),
      "visual-interference": () =>
        import("@/lib/detectors/visual-interference"),
    };

  for (const name of DETECTOR_MODULES) {
    it(`module ${name} has no default export and one named detector`, async () => {
      const mod = await LOADERS[name]();
      expect("default" in mod).toBe(false);
      expect(Object.keys(mod)).toHaveLength(1);
    });
  }

  it("still exports exactly the four names from @/lib/detectors", () => {
    expect(Object.keys(detectorsModule).sort()).toEqual([
      "createRegistry",
      "defaultRegistry",
      "registerDetector",
      "runDetectors",
    ]);
  });

  it("keeps lib/detectors/index.ts free of detector imports", () => {
    const source = readFileSync("lib/detectors/index.ts", "utf8");
    for (const name of DETECTOR_MODULES) {
      expect(source).not.toContain(`/${name}"`);
      expect(source).not.toContain(`/${name}'`);
    }
    expect(source).not.toContain("./all");
    expect(source).not.toContain("/shared/");
    expect(source).not.toContain("/data/");
  });
});
