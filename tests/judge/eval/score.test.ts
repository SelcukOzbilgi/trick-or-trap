import { describe, expect, it } from "vitest";
import { EXPLANATIONS } from "@/lib/detectors/shared/finding";
import type { ReviewResult, ReviewedFinding } from "@/lib/judge/types";
import type { Confidence, Finding } from "@/lib/types";
import type { DevCase } from "@/tests/judge/eval/build-case";
import {
  formatTable,
  outcomeOf,
  scoreCase,
  scoreRun,
} from "@/tests/judge/eval/score";

// ---------------------------------------------------------------------------
// Hand-built cases and results: one test per rule of the fixture README.
// ---------------------------------------------------------------------------

type Pattern = DevCase["pattern"];

function makeCase(overrides: Partial<DevCase> & { id: string }): DevCase {
  return {
    lang: "en",
    pattern: "fake-scarcity",
    expected: "flag",
    elements: [],
    why: "a hand-built case",
    ...overrides,
  };
}

const FLAG_CASE = makeCase({
  id: "flag-1",
  expected: "flag",
  evidenceElementId: "el-0-2",
  relatedElementIds: ["el-0-2-0", "el-0-3"],
});

const CLEAN_CASE = makeCase({ id: "clean-1", expected: "clean" });

const TOLERANT_CASE = makeCase({
  id: "clean-tolerant",
  expected: "clean",
  tolerateLow: true,
});

function finding(
  pattern: Pattern,
  confidence: Confidence,
  elementIds: string[],
): Finding {
  return {
    patternId: pattern,
    confidence,
    title: "Possible pattern",
    description: "A hand-built finding.",
    evidence: { text: "Evidence." },
    elementIds,
    boundingBoxes: elementIds.map(() => ({ x: 0, y: 0, width: 1, height: 1 })),
    explanation: EXPLANATIONS[pattern],
    detectorName: pattern,
    detectedAt: "2026-11-21T12:00:00.000Z",
  };
}

function reviewed(
  pattern: Pattern,
  confidence: Confidence,
  elementIds: string[],
): ReviewedFinding {
  return { finding: finding(pattern, confidence, elementIds), source: "rules" };
}

function result(
  findings: ReviewedFinding[],
  extra: Partial<ReviewResult> = {},
): ReviewResult {
  return {
    findings,
    setAside: [],
    judge: { status: "off", candidateCount: 0, truncated: false },
    ruleErrors: 0,
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// Flag cases
// ---------------------------------------------------------------------------

describe("flag cases (16.3, 16.4)", () => {
  it("counts a hit on the evidence element", () => {
    const score = scoreCase(
      FLAG_CASE,
      result([reviewed("fake-scarcity", "medium", ["el-0-2"])]),
    );
    expect(score.hit).toBe(true);
    expect(score.misplaced).toBe(false);
    expect(score.outcome).toBe("hit:medium");
  });

  it("counts a hit on a related element", () => {
    const onRelated = scoreCase(
      FLAG_CASE,
      result([reviewed("fake-scarcity", "low", ["el-0-3"])]),
    );
    expect(onRelated.hit).toBe(true);
    expect(onRelated.outcome).toBe("hit:low");

    const onSecondId = scoreCase(
      FLAG_CASE,
      result([reviewed("fake-scarcity", "high", ["el-9", "el-0-2-0"])]),
    );
    expect(onSecondId.hit).toBe(true);
    expect(onSecondId.outcome).toBe("hit:high");
  });

  it("takes the highest level among the hits for the outcome", () => {
    const score = scoreCase(
      FLAG_CASE,
      result([
        reviewed("fake-scarcity", "low", ["el-0-2"]),
        reviewed("fake-scarcity", "high", ["el-0-3"]),
        reviewed("fake-scarcity", "medium", ["el-0-2-0"]),
      ]),
    );
    expect(score.outcome).toBe("hit:high");
  });

  it("counts a finding of the right pattern on another element as a misplaced hit and a miss", () => {
    const score = scoreCase(
      FLAG_CASE,
      result([reviewed("fake-scarcity", "high", ["el-0-9"])]),
    );
    expect(score.hit).toBe(false);
    expect(score.misplaced).toBe(true);
    expect(score.outcome).toBe("miss");
  });

  it("counts a hit, not a misplaced hit, when one finding is on the evidence and another is elsewhere", () => {
    const score = scoreCase(
      FLAG_CASE,
      result([
        reviewed("fake-scarcity", "low", ["el-0-9"]),
        reviewed("fake-scarcity", "low", ["el-0-2"]),
      ]),
    );
    expect(score.hit).toBe(true);
    expect(score.misplaced).toBe(false);
  });

  it("counts a miss when there is no finding", () => {
    const score = scoreCase(FLAG_CASE, result([]));
    expect(score.hit).toBe(false);
    expect(score.misplaced).toBe(false);
    expect(score.outcome).toBe("miss");
  });

  it("does not count a finding of another pattern on the evidence element", () => {
    const score = scoreCase(
      FLAG_CASE,
      result([reviewed("fake-activity", "high", ["el-0-2"])]),
    );
    expect(score.hit).toBe(false);
    expect(score.misplaced).toBe(false);
    expect(score.outcome).toBe("miss");
    expect(score.offPattern).toEqual(["fake-activity"]);
  });
});

// ---------------------------------------------------------------------------
// Clean cases
// ---------------------------------------------------------------------------

describe("clean cases (16.5, 16.6)", () => {
  it("is clean with no finding", () => {
    const score = scoreCase(CLEAN_CASE, result([]));
    expect(score.outcome).toBe("clean");
    expect(score.falsePositive).toBe(false);
    expect(score.falsePositiveMediumPlus).toBe(false);
  });

  it("counts a false positive at low as any-confidence only", () => {
    const score = scoreCase(
      CLEAN_CASE,
      result([reviewed("fake-scarcity", "low", ["el-0-1"])]),
    );
    expect(score.outcome).toBe("fp:low");
    expect(score.falsePositive).toBe(true);
    expect(score.falsePositiveMediumPlus).toBe(false);
    expect(score.toleratedLow).toBe(false);
  });

  it("counts a false positive at medium in both figures", () => {
    const score = scoreCase(
      CLEAN_CASE,
      result([reviewed("fake-scarcity", "medium", ["el-0-1"])]),
    );
    expect(score.outcome).toBe("fp:medium+");
    expect(score.falsePositive).toBe(true);
    expect(score.falsePositiveMediumPlus).toBe(true);
  });

  it("counts a false positive at high in both figures", () => {
    const score = scoreCase(
      CLEAN_CASE,
      result([reviewed("fake-scarcity", "high", ["el-0-1"])]),
    );
    expect(score.outcome).toBe("fp:medium+");
    expect(score.falsePositiveMediumPlus).toBe(true);
  });

  it("counts one false positive per case, whatever the number of findings", () => {
    const run = scoreRun(
      [CLEAN_CASE],
      [
        result([
          reviewed("fake-scarcity", "low", ["el-0-1"]),
          reviewed("fake-scarcity", "medium", ["el-0-2"]),
          reviewed("fake-scarcity", "medium", ["el-0-3"]),
        ]),
      ],
    );
    expect(run.total.falsePositives).toBe(1);
    expect(run.total.falsePositivesMediumPlus).toBe(1);
  });

  it("reports a tolerated low and does not count it as a false positive", () => {
    const score = scoreCase(
      TOLERANT_CASE,
      result([reviewed("fake-scarcity", "low", ["el-0-1"])]),
    );
    expect(score.outcome).toBe("tolerated-low");
    expect(score.toleratedLow).toBe(true);
    expect(score.falsePositive).toBe(false);
    expect(score.falsePositiveMediumPlus).toBe(false);
  });

  it("still counts a medium finding on a case that tolerates a low one", () => {
    const score = scoreCase(
      TOLERANT_CASE,
      result([
        reviewed("fake-scarcity", "low", ["el-0-1"]),
        reviewed("fake-scarcity", "medium", ["el-0-2"]),
      ]),
    );
    expect(score.outcome).toBe("fp:medium+");
    expect(score.falsePositive).toBe(true);
    expect(score.falsePositiveMediumPlus).toBe(true);
    expect(score.toleratedLow).toBe(false);
  });

  it("does not tolerate a low finding when the case does not say so", () => {
    const score = scoreCase(
      CLEAN_CASE,
      result([reviewed("fake-scarcity", "low", ["el-0-1"])]),
    );
    expect(score.toleratedLow).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Off-pattern findings and setAside
// ---------------------------------------------------------------------------

describe("off-pattern findings and set-aside findings (16.7, 16.8)", () => {
  it("reports findings of other patterns and does not score them", () => {
    const score = scoreCase(
      CLEAN_CASE,
      result([
        reviewed("preselection", "high", ["el-0-1"]),
        reviewed("fake-activity", "low", ["el-0-2"]),
        reviewed("preselection", "low", ["el-0-3"]),
      ]),
    );
    expect(score.outcome).toBe("clean");
    expect(score.falsePositive).toBe(false);
    expect(score.offPattern).toEqual(["fake-activity", "preselection", "preselection"]);

    const run = scoreRun([CLEAN_CASE], [
      result([
        reviewed("preselection", "high", ["el-0-1"]),
        reviewed("fake-activity", "low", ["el-0-2"]),
      ]),
    ]);
    expect(run.total.offPatternFindings).toBe(2);
    expect(run.total.falsePositives).toBe(0);
  });

  it("ignores setAside on a flag case", () => {
    const score = scoreCase(
      FLAG_CASE,
      result([], {
        setAside: [
          {
            finding: finding("fake-scarcity", "high", ["el-0-2"]),
            judgeReason: "neutral-stock-fact",
          },
        ],
      }),
    );
    expect(score.hit).toBe(false);
    expect(score.outcome).toBe("miss");
  });

  it("ignores setAside on a clean case", () => {
    const score = scoreCase(
      CLEAN_CASE,
      result([], {
        setAside: [
          {
            finding: finding("fake-scarcity", "high", ["el-0-1"]),
            judgeReason: "neutral-stock-fact",
          },
        ],
      }),
    );
    expect(score.outcome).toBe("clean");
    expect(score.falsePositive).toBe(false);
    expect(score.offPattern).toEqual([]);
  });

  it("carries the number of rule errors of the result", () => {
    expect(scoreCase(CLEAN_CASE, result([], { ruleErrors: 2 })).detectorErrors).toBe(2);
    expect(scoreCase(CLEAN_CASE, result([])).detectorErrors).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// outcomeOf
// ---------------------------------------------------------------------------

describe("outcomeOf (the outcome strings)", () => {
  it("gives clean, miss, hit:<level>, tolerated-low, fp:low and fp:medium+", () => {
    expect(outcomeOf(CLEAN_CASE, [])).toBe("clean");
    expect(outcomeOf(FLAG_CASE, [])).toBe("miss");
    expect(outcomeOf(FLAG_CASE, [reviewed("fake-scarcity", "low", ["el-0-2"])])).toBe("hit:low");
    expect(outcomeOf(FLAG_CASE, [reviewed("fake-scarcity", "medium", ["el-0-2"])])).toBe(
      "hit:medium",
    );
    expect(outcomeOf(FLAG_CASE, [reviewed("fake-scarcity", "high", ["el-0-2"])])).toBe(
      "hit:high",
    );
    expect(outcomeOf(TOLERANT_CASE, [reviewed("fake-scarcity", "low", ["x"])])).toBe(
      "tolerated-low",
    );
    expect(outcomeOf(CLEAN_CASE, [reviewed("fake-scarcity", "low", ["x"])])).toBe("fp:low");
    expect(outcomeOf(CLEAN_CASE, [reviewed("fake-scarcity", "medium", ["x"])])).toBe(
      "fp:medium+",
    );
  });
});

// ---------------------------------------------------------------------------
// Totals per pattern and per language
// ---------------------------------------------------------------------------

describe("totals (16.6, 16.9)", () => {
  const cases: DevCase[] = [
    makeCase({
      id: "a",
      lang: "en",
      pattern: "fake-urgency",
      expected: "flag",
      evidenceElementId: "e1",
    }),
    makeCase({
      id: "b",
      lang: "tr",
      pattern: "fake-urgency",
      expected: "flag",
      evidenceElementId: "e1",
    }),
    makeCase({ id: "c", lang: "en", pattern: "fake-urgency", expected: "clean" }),
    makeCase({
      id: "d",
      lang: "tr",
      pattern: "preselection",
      expected: "clean",
      tolerateLow: true,
    }),
    makeCase({
      id: "e",
      lang: "tr",
      pattern: "preselection",
      expected: "flag",
      evidenceElementId: "e1",
    }),
    makeCase({ id: "f", lang: "en", pattern: "preselection", expected: "clean" }),
  ];
  const results: ReviewResult[] = [
    result([reviewed("fake-urgency", "low", ["e1"])]), // a: hit
    result([]), // b: miss
    result([reviewed("fake-urgency", "low", ["z"])]), // c: fp low
    result([reviewed("preselection", "low", ["z"])]), // d: tolerated low
    result([reviewed("preselection", "medium", ["z"])], { ruleErrors: 1 }), // e: misplaced
    result([reviewed("preselection", "high", ["z"]), reviewed("fake-activity", "low", ["z"])]), // f: fp medium+
  ];
  const run = scoreRun(cases, results);

  it("totals every figure", () => {
    expect(run.total).toEqual({
      flagCases: 3,
      cleanCases: 3,
      hits: 1,
      misplaced: 1,
      falsePositives: 2,
      falsePositivesMediumPlus: 1,
      toleratedLow: 1,
      offPatternFindings: 1,
    });
  });

  it("totals per pattern", () => {
    expect(run.byPattern["fake-urgency"]).toEqual({
      flagCases: 2,
      cleanCases: 1,
      hits: 1,
      misplaced: 0,
      falsePositives: 1,
      falsePositivesMediumPlus: 0,
      toleratedLow: 0,
      offPatternFindings: 0,
    });
    expect(run.byPattern.preselection).toEqual({
      flagCases: 1,
      cleanCases: 2,
      hits: 0,
      misplaced: 1,
      falsePositives: 1,
      falsePositivesMediumPlus: 1,
      toleratedLow: 1,
      offPatternFindings: 1,
    });
    expect(run.byPattern["fake-scarcity"].flagCases).toBe(0);
  });

  it("totals per language", () => {
    expect(run.byLanguage.en).toEqual({
      flagCases: 1,
      cleanCases: 2,
      hits: 1,
      misplaced: 0,
      falsePositives: 2,
      falsePositivesMediumPlus: 1,
      toleratedLow: 0,
      offPatternFindings: 1,
    });
    expect(run.byLanguage.tr).toEqual({
      flagCases: 2,
      cleanCases: 1,
      hits: 0,
      misplaced: 1,
      falsePositives: 0,
      falsePositivesMediumPlus: 0,
      toleratedLow: 1,
      offPatternFindings: 0,
    });
  });

  it("keeps one score per case, in order", () => {
    expect(run.cases.map((c) => c.id)).toEqual(["a", "b", "c", "d", "e", "f"]);
    expect(run.cases.map((c) => c.outcome)).toEqual([
      "hit:low",
      "miss",
      "fp:low",
      "tolerated-low",
      "miss",
      "fp:medium+",
    ]);
    expect(run.cases[4].detectorErrors).toBe(1);
  });

  it("refuses results that do not match the cases", () => {
    expect(() => scoreRun(cases, results.slice(1))).toThrow();
  });
});

// ---------------------------------------------------------------------------
// The table
// ---------------------------------------------------------------------------

describe("formatTable (16.9)", () => {
  const cases: DevCase[] = [
    makeCase({
      id: "a",
      lang: "en",
      pattern: "fake-urgency",
      expected: "flag",
      evidenceElementId: "e1",
    }),
    makeCase({ id: "b", lang: "tr", pattern: "confirmshaming", expected: "clean" }),
  ];
  const rulesOnly = scoreRun(cases, [result([]), result([])]);
  const both = scoreRun(cases, [
    result([reviewed("fake-urgency", "low", ["e1"])]),
    result([reviewed("confirmshaming", "medium", ["z"])]),
  ]);
  const table = formatTable([
    { label: "rules-only", score: rulesOnly },
    { label: "rules+judge", score: both },
  ]);

  it("has one column per run and a row per pattern, per language and the total", () => {
    const [header] = table.split("\n");
    expect(header).toContain("rules-only");
    expect(header).toContain("rules+judge");
    for (const label of [
      "fake-urgency",
      "fake-scarcity",
      "fake-activity",
      "confirmshaming",
      "preselection",
      "visual-interference",
      "en",
      "tr",
      "total",
    ]) {
      expect(table.split("\n").some((line) => line.startsWith(label))).toBe(true);
    }
  });

  it("shows the figures of each column", () => {
    const totalLine = table.split("\n").find((line) => line.startsWith("total"));
    expect(totalLine).toBeDefined();
    expect(totalLine).toContain("0/1 hits");
    expect(totalLine).toContain("1/1 hits");
    expect(totalLine).toContain("fp 1/1");
    expect(totalLine).toContain("med+ 1/1");
  });

  it("shows tolerated lows and off-pattern findings", () => {
    expect(table).toContain("tol 0");
    expect(table).toContain("off 0");
  });
});
