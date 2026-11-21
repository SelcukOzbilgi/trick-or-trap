import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { buildCandidates } from "@/lib/judge/candidates";
import {
  MAX_CANDIDATES,
  MAX_DATA_BLOCK_BYTES,
  MAX_TOTAL_CANDIDATE_CHARS,
} from "@/lib/judge/constants";
import { encodePageData } from "@/lib/judge/prompt";
import { PageSnapshotSchema } from "@/lib/types";
import {
  DEV_JSON_PATH,
  DEV_SHA256,
  buildCaseSnapshot,
  loadDevSet,
  parseDevSet,
} from "@/tests/judge/eval/build-case";
import type { DevCase } from "@/tests/judge/eval/build-case";

/** The hash of dev.json recorded in design section 2 and note 7.1. */
const EXPECTED_SHA256 =
  "68173dd346198c43e3d325c645f50c14e375c8236a66eb123e2689eb444f9cff";

const devSet = loadDevSet();

function firstCaseWith(predicate: (c: DevCase) => boolean): DevCase {
  const found = devSet.cases.find(predicate);
  if (!found) throw new Error("no dev case matches");
  return found;
}

// ---------------------------------------------------------------------------
// 16.2 the hash
// ---------------------------------------------------------------------------

describe("16.2 the dev set hash", () => {
  it("is the value recorded in the design", () => {
    expect(DEV_SHA256).toBe(EXPECTED_SHA256);
    const bytes = readFileSync(join(process.cwd(), DEV_JSON_PATH));
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(EXPECTED_SHA256);
  });

  it("fails on a different file", () => {
    const bytes = readFileSync(join(process.cwd(), DEV_JSON_PATH));
    const changed = Buffer.concat([bytes, Buffer.from(" ")]);
    expect(() => parseDevSet(changed)).toThrow(/hash/);
    expect(() => parseDevSet(Buffer.from("{}"))).toThrow(/hash/);
  });

  it("loads 120 cases, 60 flag and 60 clean", () => {
    expect(devSet.meta.caseCount).toBe(120);
    expect(devSet.cases).toHaveLength(120);
    expect(devSet.cases.filter((c) => c.expected === "flag")).toHaveLength(60);
    expect(devSet.cases.filter((c) => c.expected === "clean")).toHaveLength(60);
  });

  it("gives every flag case an evidence element that exists in the case", () => {
    for (const c of devSet.cases.filter((x) => x.expected === "flag")) {
      expect(c.evidenceElementId, c.id).toBeDefined();
      expect(c.elements.map((e) => e.id), c.id).toContain(c.evidenceElementId);
    }
  });
});

// ---------------------------------------------------------------------------
// 16.1 the README defaults
// ---------------------------------------------------------------------------

describe("16.1 the README defaults", () => {
  it("sets the snapshot fields", () => {
    const snapshot = buildCaseSnapshot(devSet.cases[0]);
    expect(snapshot.url).toBe("https://shop.example.test/p");
    expect(snapshot.capturedAt).toBe("2026-11-21T12:00:00.000Z");
    expect(snapshot.viewportWidth).toBe(1280);
    expect(snapshot.viewportHeight).toBe(800);
    expect(snapshot.fullWidth).toBe(1280);
    expect(snapshot.fullHeight).toBe(3000);
    expect(snapshot.elements).toHaveLength(devSet.cases[0].elements.length);
    expect(snapshot.afterReload).toBeUndefined();
    expect(snapshot.secondSample).toBeUndefined();
  });

  it("fills the missing element fields on a sample case", () => {
    const sample = firstCaseWith(
      (c) => c.elements.length >= 3 && c.elements.some((e) => e.tag === "a"),
    );
    const snapshot = buildCaseSnapshot(sample);
    sample.elements.forEach((source, index) => {
      const built = snapshot.elements[index];
      expect(built.id).toBe(source.id);
      expect(built.tag).toBe(source.tag);
      expect(built.color).toBe(source.color ?? "rgb(0, 0, 0)");
      expect(built.backgroundColor).toBe(source.backgroundColor ?? "rgba(0, 0, 0, 0)");
      expect(built.fontSize).toBe(source.fontSize ?? "16px");
      expect(built.opacity).toBe(source.opacity ?? "1");
      expect(built.display).toBe(source.display ?? "block");
      expect(built.visibility).toBe(source.visibility ?? "visible");
      expect(built.position).toBe(source.position ?? "static");
      expect(built.checked).toBe(source.checked ?? false);
      expect(built.selected).toBe(source.selected ?? false);
      expect(built.boundingBox).toEqual(
        source.boundingBox ?? { x: 40, y: 100 + 40 * index, width: 400, height: 24 },
      );
      expect(built.role).toBe(source.role);
      expect(built.text).toBe(source.text);
    });
  });

  it("uses the position in the array for the default box", () => {
    const sample = firstCaseWith(
      (c) => c.elements.length >= 3 && c.elements.every((e) => e.boundingBox === undefined),
    );
    const snapshot = buildCaseSnapshot(sample);
    expect(snapshot.elements[0].boundingBox).toEqual({ x: 40, y: 100, width: 400, height: 24 });
    expect(snapshot.elements[2].boundingBox).toEqual({ x: 40, y: 180, width: 400, height: 24 });
  });

  it("gives every a element href /x and merges it into its attributes", () => {
    let seen = 0;
    for (const c of devSet.cases) {
      const snapshot = buildCaseSnapshot(c);
      c.elements.forEach((source, index) => {
        const built = snapshot.elements[index];
        if (source.tag === "a") {
          seen += 1;
          expect(built.attributes?.href, c.id).toBe("/x");
          for (const [key, value] of Object.entries(source.attributes ?? {})) {
            if (key !== "href") expect(built.attributes?.[key], c.id).toBe(value);
          }
        } else {
          expect(built.attributes?.href, c.id).toBeUndefined();
        }
      });
    }
    expect(seen).toBeGreaterThan(0);
  });

  it("builds a snapshot that passes PageSnapshotSchema for every dev case", () => {
    for (const c of devSet.cases) {
      const result = PageSnapshotSchema.safeParse(buildCaseSnapshot(c));
      expect(result.success, c.id).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// The candidate builder on dev shapes
// ---------------------------------------------------------------------------

describe("buildCandidates on every dev case", () => {
  it("stays within the caps, never throws and numbers its ids", () => {
    let flagCases = 0;
    let evidenceWithoutCandidate = 0;
    const missing: string[] = [];

    for (const c of devSet.cases) {
      const built = buildCandidates(buildCaseSnapshot(c), []);

      expect(built.candidates.length, c.id).toBeLessThanOrEqual(MAX_CANDIDATES);

      let chars = 0;
      for (const candidate of built.candidates) {
        chars += candidate.text.length;
        for (const part of candidate.parts ?? []) chars += part.length;
      }
      expect(chars, c.id).toBeLessThanOrEqual(MAX_TOTAL_CANDIDATE_CHARS);

      const bytes = new TextEncoder().encode(encodePageData(built.data)).length;
      expect(bytes, c.id).toBeLessThanOrEqual(MAX_DATA_BLOCK_BYTES);

      expect(built.candidates.map((x) => x.id), c.id).toEqual(
        built.candidates.map((_, i) => `c${i + 1}`),
      );
      expect(built.ruleFindings, c.id).toEqual([]);

      if (c.expected === "flag") {
        flagCases += 1;
        const mapped = [...built.map.candidates.values()].some((m) =>
          m.elementIds.includes(c.evidenceElementId ?? ""),
        );
        if (!mapped) {
          evidenceWithoutCandidate += 1;
          missing.push(c.id);
        }
      }
    }

    // Printed, not asserted: a measure of what the builder can show the model.
    console.info(
      `dev flag cases whose evidence element maps to no candidate: ${evidenceWithoutCandidate} of ${flagCases}`,
      missing.length > 0 ? missing.join(", ") : "",
    );
    expect(flagCases).toBe(60);
  });
});
