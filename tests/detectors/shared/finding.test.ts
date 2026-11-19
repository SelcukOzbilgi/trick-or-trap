import { describe, it, expect } from "vitest";
import { FORBIDDEN_WORDS } from "@/lib/detectors/data/forbidden-words";
import { FORBIDDEN_STEM_EXTRA_MAX } from "@/lib/detectors/shared/constants";
import { buildIndex } from "@/lib/detectors/shared/elements";
import type { IndexedElement } from "@/lib/detectors/shared/elements";
import {
  EXPLANATIONS,
  TITLES,
  containsForbidden,
  detectedAtFrom,
  finaliseFindings,
  lowerConfidence,
} from "@/lib/detectors/shared/finding";
import type {
  FindingContext,
  FindingDraft,
  StaticPatternId,
} from "@/lib/detectors/shared/finding";
import { FindingSchema } from "@/lib/types";

type Raw = Record<string, unknown>;

const EPOCH = "1970-01-01T00:00:00.000Z";
const OUTSIDE_SENTENCE = "The element lies outside the screenshot.";
const TRUNCATION_SENTENCE =
  "The capture stopped at its element limit, so later parts of the page were not checked.";

const PATTERNS: readonly StaticPatternId[] = [
  "fake-urgency",
  "fake-scarcity",
  "fake-activity",
  "confirmshaming",
  "preselection",
  "visual-interference",
];

function raw(id: string, over: Raw = {}): Raw {
  return {
    id,
    tag: "span",
    text: "Sale ends in 01:59:59",
    boundingBox: { x: 10, y: 20, width: 100, height: 30 },
    color: "rgb(0, 0, 0)",
    backgroundColor: "rgba(0, 0, 0, 0)",
    fontSize: "16px",
    opacity: "1",
    display: "block",
    visibility: "visible",
    position: "static",
    checked: false,
    selected: false,
    ...over,
  };
}

function elementsOf(rawElements: Raw[]): IndexedElement[] {
  const index = buildIndex({ elements: rawElements }, false);
  return [...index.elements];
}

function one(over: Raw = {}, id = "el-1-1"): IndexedElement {
  const [el] = elementsOf([raw(id, over)]);
  if (!el) throw new Error("expected an element");
  return el;
}

function draft(
  elements: readonly IndexedElement[],
  over: Partial<FindingDraft> = {}
): FindingDraft {
  return {
    patternId: "fake-urgency",
    confidence: "high",
    title: TITLES["fake-urgency"][0],
    description:
      "A countdown showed a higher remaining time after a reload than before it.",
    evidenceText:
      'Countdown "Sale ends in 01:59:58" showed 7198, then 7199 after a reload 9 s later.',
    elements,
    ruleOrder: 2,
    ...over,
  };
}

function context(
  capturedAt: unknown = "2026-12-01T12:00:00.000Z",
  pageTruncated = false
): FindingContext {
  return { detectedAt: detectedAtFrom({ capturedAt }), pageTruncated };
}

describe("detectedAtFrom", () => {
  it("keeps a valid UTC time and returns its milliseconds", () => {
    const result = detectedAtFrom({ capturedAt: "2026-12-01T12:00:00.000Z" });
    expect(result.iso).toBe("2026-12-01T12:00:00.000Z");
    expect(result.ms).toBe(Date.UTC(2026, 11, 1, 12, 0, 0));
  });

  it("writes the time with a millisecond fraction when the input has none", () => {
    const result = detectedAtFrom({ capturedAt: "2026-12-01T12:00:00Z" });
    expect(result.iso).toBe("2026-12-01T12:00:00.000Z");
    expect(result.ms).toBe(Date.UTC(2026, 11, 1, 12, 0, 0));
  });

  it("accepts a fraction of one to nine digits", () => {
    const result = detectedAtFrom({ capturedAt: "2026-12-01T12:00:00.5Z" });
    expect(result.iso).toBe("2026-12-01T12:00:00.500Z");
    expect(detectedAtFrom({ capturedAt: "2026-12-01T12:00:00.123456789Z" }).ms).toBe(
      Date.UTC(2026, 11, 1, 12, 0, 0, 123)
    );
  });

  it.each([
    ["an empty string", ""],
    ["a date without a time", "2026-12-01"],
    ["a time with an offset", "2026-12-01T12:00:00+02:00"],
    ["a non-string", 1_764_590_400_000],
    ["null", null],
    ["a missing value", undefined],
    ["a day that does not exist", "2026-02-30T00:00:00Z"],
    ["hour 24", "2026-12-01T24:00:00Z"],
    ["a month 13", "2026-13-01T00:00:00Z"],
    ["a very long string", `2026-12-01T12:00:00Z${"0".repeat(100_000)}`],
  ])("gives the epoch and no milliseconds for %s", (_label, value) => {
    expect(detectedAtFrom({ capturedAt: value })).toEqual({ iso: EPOCH, ms: null });
  });

  it("gives the epoch for a snapshot that is not an object", () => {
    expect(detectedAtFrom(null)).toEqual({ iso: EPOCH, ms: null });
    expect(detectedAtFrom("2026-12-01T12:00:00.000Z")).toEqual({ iso: EPOCH, ms: null });
    expect(detectedAtFrom(undefined)).toEqual({ iso: EPOCH, ms: null });
  });

  // Requirement 6.4: a read that itself throws is an unexpected exception and
  // propagates; the registry reports it. It used to give the epoch.
  it("lets an exception raised while reading capturedAt propagate", () => {
    const hostile = {
      get capturedAt(): string {
        throw new Error("boom");
      },
    };
    expect(() => detectedAtFrom(hostile)).toThrow("boom");
  });

  it("keeps the real epoch distinct from an unusable time", () => {
    expect(detectedAtFrom({ capturedAt: EPOCH })).toEqual({ iso: EPOCH, ms: 0 });
  });
});

describe("finaliseFindings: shape", () => {
  it("turns a draft into a finding that passes FindingSchema", () => {
    const el = one();
    const findings = finaliseFindings([draft([el])], context());
    expect(findings).toHaveLength(1);
    const finding = findings[0];
    expect(FindingSchema.safeParse(finding).success).toBe(true);
    expect(finding.patternId).toBe("fake-urgency");
    expect(finding.detectorName).toBe("fake-urgency");
    expect(finding.title).toBe(TITLES["fake-urgency"][0]);
    expect(finding.title.startsWith("Possible")).toBe(true);
    expect(finding.explanation).toBe(EXPLANATIONS["fake-urgency"]);
    expect(finding.confidence).toBe("high");
    expect(finding.detectedAt).toBe("2026-12-01T12:00:00.000Z");
    expect(finding.evidence.text).toContain("Countdown");
    expect(finding.description).toBe(
      "A countdown showed a higher remaining time after a reload than before it."
    );
  });

  it.each(PATTERNS)("uses the fixed title and explanation of %s", (patternId) => {
    const el = one();
    for (const title of TITLES[patternId]) {
      const findings = finaliseFindings(
        [draft([el], { patternId, title })],
        context()
      );
      expect(findings).toHaveLength(1);
      expect(findings[0].title).toBe(title);
      expect(findings[0].patternId).toBe(patternId);
      expect(findings[0].detectorName).toBe(patternId);
      expect(findings[0].explanation).toBe(EXPLANATIONS[patternId]);
      expect(FindingSchema.safeParse(findings[0]).success).toBe(true);
    }
  });

  it("lists ids and boxes in draft order", () => {
    const [a, b, c] = elementsOf([
      raw("el-1-1", { boundingBox: { x: 1, y: 2, width: 3, height: 4 } }),
      raw("el-1-2", { boundingBox: { x: 5, y: 6, width: 7, height: 8 } }),
      raw("el-1-3", { boundingBox: { x: 9, y: 10, width: 11, height: 12 } }),
    ]);
    const findings = finaliseFindings([draft([c, a, b])], context());
    expect(findings[0].elementIds).toEqual(["el-1-3", "el-1-1", "el-1-2"]);
    expect(findings[0].boundingBoxes).toEqual([
      { x: 9, y: 10, width: 11, height: 12 },
      { x: 1, y: 2, width: 3, height: 4 },
      { x: 5, y: 6, width: 7, height: 8 },
    ]);
  });

  it("reports the zero box for an element with an invalid box", () => {
    const bad = one({ boundingBox: { x: Number.NaN, y: 0, width: 10, height: 10 } });
    const negative = one(
      { boundingBox: { x: 5, y: 5, width: -4, height: 10 } },
      "el-1-2"
    );
    const findings = finaliseFindings([draft([bad, negative])], context());
    expect(findings).toHaveLength(1);
    expect(findings[0].boundingBoxes).toEqual([
      { x: 0, y: 0, width: 0, height: 0 },
      { x: 0, y: 0, width: 0, height: 0 },
    ]);
    expect(FindingSchema.safeParse(findings[0]).success).toBe(true);
  });

  it("returns boxes that are copies, not the frozen boxes of the index", () => {
    const el = one();
    const findings = finaliseFindings([draft([el])], context());
    expect(findings[0].boundingBoxes[0]).not.toBe(el.box);
    expect(Object.isFrozen(findings[0].boundingBoxes[0])).toBe(false);
  });

  it("passes measured values through and keeps the draft untouched", () => {
    const el = one();
    const measuredValues = { firstValue: 7198, reloadValue: 7199, gapSeconds: 9 };
    const input = draft([el], { measuredValues });
    const findings = finaliseFindings([input], context());
    expect(findings[0].evidence.measuredValues).toEqual({
      firstValue: 7198,
      reloadValue: 7199,
      gapSeconds: 9,
    });
    expect(findings[0].evidence.measuredValues).not.toBe(measuredValues);
    expect(measuredValues).toEqual({ firstValue: 7198, reloadValue: 7199, gapSeconds: 9 });
  });

  it("leaves measuredValues out when there are none to report", () => {
    const findings = finaliseFindings([draft([one()])], context());
    expect(findings[0].evidence.measuredValues).toBeUndefined();
  });

  it("drops measured values that are not finite numbers", () => {
    const findings = finaliseFindings(
      [
        draft([one()], {
          measuredValues: { good: 2, nan: Number.NaN, inf: Number.POSITIVE_INFINITY },
        }),
      ],
      context()
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].evidence.measuredValues).toEqual({ good: 2 });
  });

  it("sets captureTimeUnknown and the epoch when capturedAt is unusable", () => {
    for (const bad of ["", "2026-12-01", "2026-12-01T12:00:00+02:00", 5, null]) {
      const findings = finaliseFindings(
        [draft([one()], { measuredValues: { gapSeconds: 9 } })],
        context(bad)
      );
      expect(findings).toHaveLength(1);
      expect(findings[0].detectedAt).toBe(EPOCH);
      expect(findings[0].evidence.measuredValues).toEqual({
        gapSeconds: 9,
        captureTimeUnknown: 1,
      });
      expect(FindingSchema.safeParse(findings[0]).success).toBe(true);
    }
  });

  it("sets captureTimeUnknown even when the draft has no measured values", () => {
    const findings = finaliseFindings([draft([one()])], context("nope"));
    expect(findings[0].evidence.measuredValues).toEqual({ captureTimeUnknown: 1 });
  });

  it("does not set captureTimeUnknown for a usable time", () => {
    const findings = finaliseFindings(
      [draft([one()], { measuredValues: { gapSeconds: 9 } })],
      context()
    );
    expect(findings[0].evidence.measuredValues).toEqual({ gapSeconds: 9 });
  });

  it("returns an empty array for no drafts and for input that is not an array", () => {
    expect(finaliseFindings([], context())).toEqual([]);
    expect(finaliseFindings(null as unknown as FindingDraft[], context())).toEqual([]);
    expect(finaliseFindings(undefined as unknown as FindingDraft[], context())).toEqual([]);
  });

  it("skips a draft that is broken instead of throwing", () => {
    const good = draft([one()]);
    const findings = finaliseFindings(
      [null as unknown as FindingDraft, 5 as unknown as FindingDraft, good],
      context()
    );
    expect(findings).toHaveLength(1);
  });

  it("drops a draft whose title is not a fixed title of its pattern", () => {
    const el = one();
    expect(
      finaliseFindings([draft([el], { title: "Possible something else" })], context())
    ).toEqual([]);
    expect(
      finaliseFindings(
        [draft([el], { patternId: "preselection", title: TITLES["fake-urgency"][0] })],
        context()
      )
    ).toEqual([]);
    expect(
      finaliseFindings(
        [draft([el], { patternId: "flow-thing" as unknown as StaticPatternId })],
        context()
      )
    ).toEqual([]);
  });

  it("drops a draft with an invalid confidence", () => {
    const findings = finaliseFindings(
      [draft([one()], { confidence: "certain" as unknown as "high" })],
      context()
    );
    expect(findings).toEqual([]);
  });
});

describe("finaliseFindings: notes", () => {
  it("adds the outside-screenshot sentence when an evidence element lies outside", () => {
    const inside = one();
    const outside = one({ outsideImage: true }, "el-1-2");
    const [withOutside] = finaliseFindings([draft([inside, outside])], context());
    expect(withOutside.description).toBe(
      `A countdown showed a higher remaining time after a reload than before it. ${OUTSIDE_SENTENCE}`
    );
    const [without] = finaliseFindings([draft([inside])], context());
    expect(without.description).not.toContain(OUTSIDE_SENTENCE);
  });

  it("adds the truncation sentence to every description when the page was truncated", () => {
    const [a, b] = elementsOf([raw("el-1-1"), raw("el-1-2")]);
    const findings = finaliseFindings([draft([a]), draft([b])], context(undefined, true));
    expect(findings).toHaveLength(2);
    for (const finding of findings) {
      expect(finding.description).toContain(TRUNCATION_SENTENCE);
    }
    const [plain] = finaliseFindings([draft([a])], context());
    expect(plain.description).not.toContain(TRUNCATION_SENTENCE);
  });

  it("adds both sentences, outside first", () => {
    const outside = one({ outsideImage: true });
    const [finding] = finaliseFindings([draft([outside])], context(undefined, true));
    expect(finding.description).toBe(
      `A countdown showed a higher remaining time after a reload than before it. ${OUTSIDE_SENTENCE} ${TRUNCATION_SENTENCE}`
    );
  });
});

describe("finaliseFindings: forbidden words", () => {
  const word = FORBIDDEN_WORDS[0];

  it("drops a draft with a forbidden word in its description", () => {
    const el = one();
    const findings = finaliseFindings(
      [draft([el], { description: `This is ${word}.` }), draft([el], { ruleOrder: 3 })],
      context()
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].description).not.toContain(word);
  });

  it("drops a draft with a forbidden word in its evidence text", () => {
    const findings = finaliseFindings(
      [draft([one()], { evidenceText: `Text ${word.toUpperCase()}.` })],
      context()
    );
    expect(findings).toEqual([]);
  });

  it("does not count a dropped draft towards the cap", () => {
    const rawList: Raw[] = [];
    for (let i = 0; i < 22; i += 1) rawList.push(raw(`el-1-${i}`));
    const els = elementsOf(rawList);
    const drafts = els.map((el, i) =>
      draft([el], i < 2 ? { description: `Bad ${word}.` } : {})
    );
    const findings = finaliseFindings(drafts, context());
    expect(findings).toHaveLength(20);
    expect(findings[19].description).not.toContain("more similar");
  });

  it("keeps a template word that only looks like a listed word", () => {
    const [finding] = finaliseFindings([draft([one({}, "el-1-1")])], context());
    expect(finding).toBeDefined();
    expect(containsForbidden(OUTSIDE_SENTENCE)).toBe(false);
  });

  it("finds listed words whole-word, in any case and after normalisation", () => {
    expect(containsForbidden(word)).toBe(true);
    expect(containsForbidden(`A ${word.toUpperCase()}!`)).toBe(true);
    expect(containsForbidden(`a ${word}'s thing`)).toBe(true);
    expect(containsForbidden(`${word.slice(0, 2)}\u200b${word.slice(2)}`)).toBe(true);
    expect(containsForbidden("DOLANDIRICI")).toBe(true);
    expect(containsForbidden("yasadışı")).toBe(true);
    expect(containsForbidden("a fine, calm sentence")).toBe(false);
    expect(containsForbidden("")).toBe(false);
    expect(containsForbidden(5 as unknown as string)).toBe(false);
  });

  it("finds a listed word at the end of a long text", () => {
    const text = `${"ordinary words ".repeat(2_000)}${word}`;
    expect(containsForbidden(text)).toBe(true);
  });

  // Requirements 5.2, 5.4: a word with a forbidden stem and up to
  // FORBIDDEN_STEM_EXTRA_MAX letters counts, in any case and with an apostrophe suffix.
  it.each([
    "scammers",
    "frauds",
    "dolandırıcılara",
    "dolandırıcılık",
    "illegally",
    "yasadışı",
    "aldatıcı",
    "SCAMMERS",
    "DOLANDIRICILARA",
    "Yasadışı'nın",
    "dolandırıcılar'a",
    "scammers\u2019s",
  ])("finds the stem word %s", (text) => {
    expect(containsForbidden(text)).toBe(true);
    expect(containsForbidden(`A fine ${text}, really`)).toBe(true);
  });

  it("does not count a word with more than FORBIDDEN_STEM_EXTRA_MAX extra letters or a stem inside a word", () => {
    expect(containsForbidden(`scam${"q".repeat(FORBIDDEN_STEM_EXTRA_MAX)}`)).toBe(true);
    expect(containsForbidden(`scam${"q".repeat(FORBIDDEN_STEM_EXTRA_MAX + 1)}`)).toBe(false);
    expect(containsForbidden("gunscam")).toBe(false);
    expect(containsForbidden("cheaters")).toBe(false);
  });

  it("drops a draft with a stem word in its description, evidence text or both", () => {
    const el = one();
    const findings = finaliseFindings(
      [
        draft([el], { description: "People call this illegally cheap." }),
        draft([el], { evidenceText: "Text dolandırıcılara." }),
        draft([el], { ruleOrder: 3 }),
      ],
      context()
    );
    expect(findings).toHaveLength(1);
  });

  it("has no forbidden word in any fixed title or explanation", () => {
    for (const patternId of PATTERNS) {
      expect(containsForbidden(EXPLANATIONS[patternId])).toBe(false);
      for (const title of TITLES[patternId]) {
        expect(title.startsWith("Possible")).toBe(true);
        expect(containsForbidden(title)).toBe(false);
      }
    }
    expect(containsForbidden(OUTSIDE_SENTENCE)).toBe(false);
    expect(containsForbidden(TRUNCATION_SENTENCE)).toBe(false);
  });

  it("lists the fixed titles of the design for every pattern", () => {
    expect(TITLES["fake-urgency"]).toHaveLength(5);
    expect(TITLES["fake-scarcity"]).toHaveLength(3);
    expect(TITLES["fake-activity"]).toHaveLength(3);
    expect(TITLES.confirmshaming).toEqual(["Possible confirmshaming"]);
    expect(TITLES.preselection).toHaveLength(3);
    expect(TITLES["visual-interference"]).toHaveLength(2);
    expect(Object.keys(TITLES)).toEqual(PATTERNS);
    expect(Object.keys(EXPLANATIONS)).toEqual(PATTERNS);
  });
});

describe("finaliseFindings: order and cap", () => {
  it("sorts by element order, then rule order", () => {
    const [a, b, c] = elementsOf([raw("el-1-1"), raw("el-1-2"), raw("el-1-3")]);
    const drafts = [
      draft([c], { ruleOrder: 1, description: "c" }),
      draft([b], { ruleOrder: 5, description: "b-late" }),
      draft([b], { ruleOrder: 2, description: "b-early" }),
      draft([a], { ruleOrder: 9, description: "a" }),
    ];
    const findings = finaliseFindings(drafts, context());
    expect(findings.map((f) => f.description)).toEqual(["a", "b-early", "b-late", "c"]);
  });

  it("orders by the first element of each draft only", () => {
    const [a, b, c] = elementsOf([raw("el-1-1"), raw("el-1-2"), raw("el-1-3")]);
    const findings = finaliseFindings(
      [
        draft([c, a], { description: "first-is-c" }),
        draft([b, a], { description: "first-is-b" }),
      ],
      context()
    );
    expect(findings.map((f) => f.description)).toEqual(["first-is-b", "first-is-c"]);
  });

  it("puts a draft without elements last", () => {
    const [a] = elementsOf([raw("el-1-1")]);
    const findings = finaliseFindings(
      [draft([], { description: "none" }), draft([a], { description: "some" })],
      context()
    );
    expect(findings.map((f) => f.description)).toEqual(["some", "none"]);
    expect(findings[1].elementIds).toEqual([]);
    expect(findings[1].boundingBoxes).toEqual([]);
  });

  it("is deterministic and does not depend on the input order", () => {
    const els = elementsOf(
      Array.from({ length: 8 }, (_unused, i) => raw(`el-1-${i}`, { text: `t${i}` }))
    );
    const drafts = els.map((el, i) => draft([el], { description: `d${i}`, ruleOrder: i % 3 }));
    const forward = finaliseFindings(drafts, context());
    const backward = finaliseFindings([...drafts].reverse(), context());
    expect(backward).toEqual(forward);
    expect(finaliseFindings(drafts, context())).toEqual(forward);
  });

  it("keeps 20 of 25 drafts, in element order, with the omitted note on the last", () => {
    const rawList: Raw[] = [];
    for (let i = 0; i < 25; i += 1) rawList.push(raw(`el-1-${i}`, { text: `t${i}` }));
    const els = elementsOf(rawList);
    const drafts = els.map((el, i) => draft([el], { description: `Claim ${i}.` }));
    const findings = finaliseFindings([...drafts].reverse(), context());
    expect(findings).toHaveLength(20);
    expect(findings.map((f) => f.elementIds[0])).toEqual(
      els.slice(0, 20).map((el) => el.id)
    );
    const last = findings[19];
    expect(last.description).toBe("Claim 19. 5 more similar findings were not listed.");
    expect(last.evidence.measuredValues).toEqual({ omittedFindings: 5 });
    for (const finding of findings.slice(0, 19)) {
      expect(finding.description).not.toContain("more similar");
      expect(finding.evidence.measuredValues).toBeUndefined();
    }
    for (const finding of findings) {
      expect(FindingSchema.safeParse(finding).success).toBe(true);
    }
  });

  it("puts the omitted note after the other sentences and keeps other measured values", () => {
    const rawList: Raw[] = [];
    for (let i = 0; i < 21; i += 1) rawList.push(raw(`el-1-${i}`));
    const els = elementsOf(rawList);
    const drafts = els.map((el) => draft([el], { measuredValues: { gapSeconds: 9 } }));
    const findings = finaliseFindings(drafts, context(undefined, true));
    expect(findings).toHaveLength(20);
    const last = findings[19];
    expect(last.description.endsWith(`${TRUNCATION_SENTENCE} 1 more similar findings were not listed.`)).toBe(true);
    expect(last.evidence.measuredValues).toEqual({ gapSeconds: 9, omittedFindings: 1 });
  });

  it("does not add the omitted note at exactly 20 drafts", () => {
    const rawList: Raw[] = [];
    for (let i = 0; i < 20; i += 1) rawList.push(raw(`el-1-${i}`));
    const els = elementsOf(rawList);
    const findings = finaliseFindings(els.map((el) => draft([el])), context());
    expect(findings).toHaveLength(20);
    expect(findings[19].description).not.toContain("more similar");
  });
});

describe("lowerConfidence", () => {
  it("lowers by one level and keeps low", () => {
    expect(lowerConfidence("high")).toBe("medium");
    expect(lowerConfidence("medium")).toBe("low");
    expect(lowerConfidence("low")).toBe("low");
  });
});
