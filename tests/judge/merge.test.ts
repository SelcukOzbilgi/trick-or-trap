import { describe, it, expect } from "vitest";
import { FORBIDDEN_WORDS } from "@/lib/detectors/data/forbidden-words";
import {
  EXPLANATIONS,
  TITLES,
  containsForbidden,
} from "@/lib/detectors/shared/finding";
import { buildCandidates, ruleKind } from "@/lib/judge/candidates";
import type { BuiltCandidates } from "@/lib/judge/candidates";
import { assembleJudgeFinding, mergeReview } from "@/lib/judge/merge";
import type { MergeOutput } from "@/lib/judge/merge";
import {
  DEFAULT_TEMPLATES,
  JUDGE_TITLES,
  REASON_SENTENCES,
} from "@/lib/judge/templates";
import type { JudgeTemplates } from "@/lib/judge/templates";
import {
  FLAG_CODES_BY_PATTERN,
  INSUFFICIENT_CONTEXT,
  JUDGE_PATTERN_IDS,
  LOOK_ALIKE_CODES,
} from "@/lib/judge/types";
import type { AnomalyCode, JudgePatternId, ReasonCode } from "@/lib/judge/types";
import type { ValidationResult } from "@/lib/judge/validate";
import { FindingSchema } from "@/lib/types";
import type { Confidence, Finding } from "@/lib/types";
import {
  SNAPSHOT_CAPTURED_AT,
  makeInput,
  makeSnapshot,
  makeText,
} from "@/tests/judge/helpers/snapshot";
import type { ElementInput } from "@/tests/judge/helpers/snapshot";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type Ok = Extract<ValidationResult, { kind: "ok" }>;
type FindingIn = Ok["findings"][number];
type VerdictIn = Ok["verdicts"][number];

const FORBIDDEN_SAMPLE = FORBIDDEN_WORDS[0];

const RANK: Record<Confidence, number> = { low: 0, medium: 1, high: 2 };

const TEXT_TITLE = TITLES["fake-scarcity"].find(
  (title) => ruleKind(title) === "text",
) as string;
const RELOAD_TITLE = TITLES["fake-urgency"][0];
const STRUCTURAL_TITLE = TITLES.preselection[0];
const MEASURED_TITLE = TITLES["visual-interference"][0];

function ruleFinding(
  patternId: JudgePatternId,
  title: string,
  elementIds: string[],
  confidence: Confidence = "medium",
): Finding {
  return {
    patternId,
    confidence,
    title,
    description: `Description of ${title}.`,
    evidence: { text: "Evidence of the rule finding.", measuredValues: { n: 1 } },
    elementIds,
    boundingBoxes: elementIds.map(() => ({ x: 1, y: 2, width: 3, height: 4 })),
    explanation: EXPLANATIONS[patternId],
    detectorName: patternId,
    detectedAt: SNAPSHOT_CAPTURED_AT,
  };
}

/** The page of the power table: one rule finding of each kind. */
const KIND_PAGE: ElementInput[] = [
  makeText("el-0", "p", "Only 3 left in stock"),
  makeInput("el-1", "checkbox", { checked: true }),
  makeText("el-2", "label", "Add gift wrap for $4.99"),
  makeText("el-3-0", "button", "Yes, save 10% today"),
  makeText("el-3-1", "button", "No thanks, I like paying full price"),
  makeText("el-5", "div", "Sale ends in 10:00"),
];

type Kind = "text" | "structural" | "measured" | "reload";

const KIND_INDEX: Record<Kind, number> = {
  text: 0,
  structural: 1,
  measured: 2,
  reload: 3,
};

function kindRules(level: Record<Kind, Confidence>): Finding[] {
  return [
    ruleFinding("fake-scarcity", TEXT_TITLE, ["el-0"], level.text),
    ruleFinding("preselection", STRUCTURAL_TITLE, ["el-1", "el-2"], level.structural),
    ruleFinding("visual-interference", MEASURED_TITLE, ["el-3-1"], level.measured),
    ruleFinding("fake-urgency", RELOAD_TITLE, ["el-5"], level.reload),
  ];
}

function okResult(
  findings: FindingIn[] = [],
  verdicts: VerdictIn[] = [],
  anomalies: AnomalyCode[] = [],
): Ok {
  return { kind: "ok", findings, verdicts, anomalies, returned: findings.length };
}

function ruleIdOf(built: BuiltCandidates, sourceIndex: number): string {
  for (const [id, rule] of built.map.rules) {
    if (rule.index === sourceIndex) return id;
  }
  throw new Error(`rule ${sourceIndex} was not sent`);
}

function candidateIdOf(built: BuiltCandidates, elementId: string): string {
  for (const [id, candidate] of built.map.candidates) {
    if (candidate.elementIds.includes(elementId)) return id;
  }
  throw new Error(`no candidate holds ${elementId}`);
}

function verdict(
  built: BuiltCandidates,
  sourceIndex: number,
  decision: VerdictIn["decision"],
  reason: ReasonCode,
  confidence: Confidence = "high",
): VerdictIn {
  return {
    rule: ruleIdOf(built, sourceIndex) as VerdictIn["rule"],
    decision,
    confidence,
    reason: reason as VerdictIn["reason"],
  };
}

function judged(
  built: BuiltCandidates,
  elementId: string,
  pattern: JudgePatternId,
  reason: string,
  confidence: Confidence = "high",
  quote = "Only 3 left",
): FindingIn {
  return {
    candidate: candidateIdOf(built, elementId) as FindingIn["candidate"],
    pattern,
    quote,
    confidence,
    reason: reason as FindingIn["reason"],
  };
}

type Run = { built: BuiltCandidates; out: MergeOutput; rules: Finding[] };

function run(
  elements: ElementInput[],
  rules: Finding[],
  make: (built: BuiltCandidates) => Ok,
): Run {
  const snapshot = makeSnapshot(elements);
  const built = buildCandidates(snapshot, rules);
  const out = mergeReview(rules, built, make(built), snapshot);
  return { built, out, rules };
}

const LEVELS: Confidence[] = ["high", "medium", "low"];

// ---------------------------------------------------------------------------
// The power table
// ---------------------------------------------------------------------------

type Row = {
  kind: Kind;
  decision: VerdictIn["decision"];
  level: Confidence;
  reason: string;
  judgeConfidence?: Confidence;
  expectLevel: Confidence;
  expectSetAside?: boolean;
  /** The verdict is ignored: the finding keeps source "rules". */
  expectIgnored?: boolean;
};

const FLAG_REASON: Record<Kind, string> = {
  text: "vague-low-stock",
  structural: "prechecked-paid-addon",
  measured: "faint-decline",
  reload: "undated-deadline",
};

function downgradeRows(kind: Kind): Row[] {
  const rows: Row[] = [];
  for (const level of LEVELS) {
    const lowered: Confidence = level === "high" ? "medium" : "low";
    const reloadFloor: Confidence = level === "high" ? "medium" : level;
    rows.push({
      kind,
      decision: "downgrade",
      level,
      reason: FLAG_REASON[kind],
      expectLevel:
        kind === "measured" ? "low" : kind === "reload" ? reloadFloor : lowered,
    });
    rows.push({
      kind,
      decision: "downgrade",
      level,
      reason: "neutral-default",
      expectLevel: kind === "reload" ? reloadFloor : "low",
    });
  }
  return rows;
}

const ROWS: Row[] = [];
for (const kind of ["text", "structural", "measured", "reload"] as Kind[]) {
  for (const level of LEVELS) {
    ROWS.push({
      kind,
      decision: "confirm",
      level,
      reason: FLAG_REASON[kind],
      expectLevel: level,
    });
  }
  ROWS.push(...downgradeRows(kind));
}
for (const kind of ["text", "structural"] as Kind[]) {
  for (const level of LEVELS) {
    ROWS.push({
      kind,
      decision: "reject",
      level,
      reason: "required-terms",
      expectLevel: level,
      expectSetAside: true,
    });
    // A reject without judge confidence "high" is a downgrade, capped at low.
    for (const judgeConfidence of ["medium", "low"] as Confidence[]) {
      ROWS.push({
        kind,
        decision: "reject",
        level,
        reason: "required-terms",
        judgeConfidence,
        expectLevel: "low",
      });
    }
  }
}
for (const kind of ["measured", "reload"] as Kind[]) {
  for (const level of LEVELS) {
    ROWS.push({
      kind,
      decision: "reject",
      level,
      reason: "dated-deadline",
      expectLevel: level,
      expectIgnored: true,
    });
  }
}

describe("verdict powers by kind and level", () => {
  it.each(ROWS)(
    "$kind $level: $decision with $reason (judge $judgeConfidence)",
    (row) => {
      const level: Record<Kind, Confidence> = {
        text: "medium",
        structural: "medium",
        measured: "medium",
        reload: "medium",
      };
      level[row.kind] = row.level;
      const rules = kindRules(level);
      const index = KIND_INDEX[row.kind];
      const { out } = run(KIND_PAGE, rules, (built) =>
        okResult(
          [],
          [
            verdict(
              built,
              index,
              row.decision,
              row.reason as ReasonCode,
              row.judgeConfidence ?? "high",
            ),
          ],
        ),
      );
      expect(out.anomalies).toEqual([]);

      const original = rules[index];
      if (row.expectSetAside) {
        expect(out.setAside).toEqual([
          { finding: original, judgeReason: row.reason },
        ]);
        expect(out.findings.some((f) => f.finding === original)).toBe(false);
        expect(out.findings).toHaveLength(3);
        return;
      }
      expect(out.setAside).toEqual([]);
      expect(out.findings).toHaveLength(4);
      const reviewed = out.findings.find((f) => f.finding.title === original.title);
      expect(reviewed).toBeDefined();
      if (row.expectIgnored) {
        expect(reviewed).toEqual({ finding: original, source: "rules" });
        return;
      }
      expect(reviewed?.finding.confidence).toBe(row.expectLevel);
      expect(reviewed?.source).toBe("rules+judge");
      expect(reviewed?.judgeReason).toBe(row.reason);
      if (row.expectLevel === row.level) {
        expect(reviewed?.ruleConfidence).toBeUndefined();
        expect(reviewed?.finding).toEqual(original);
      } else {
        expect(reviewed?.ruleConfidence).toBe(row.level);
        expect(reviewed?.finding).toEqual({
          ...original,
          confidence: row.expectLevel,
        });
      }
    },
  );

  it("never changes a rule finding that has no verdict", () => {
    const rules = kindRules({
      text: "high",
      structural: "medium",
      measured: "low",
      reload: "high",
    });
    const { out } = run(KIND_PAGE, rules, () => okResult());
    expect(out.setAside).toEqual([]);
    expect(out.findings).toHaveLength(4);
    for (const reviewed of out.findings) {
      expect(reviewed.source).toBe("rules");
      expect(reviewed.ruleConfidence).toBeUndefined();
      expect(reviewed.judgeReason).toBeUndefined();
      expect(rules).toContain(reviewed.finding);
    }
  });

  it("gives a reject without high confidence a downgrade, not a set-aside", () => {
    const rules = kindRules({
      text: "high",
      structural: "high",
      measured: "high",
      reload: "high",
    });
    const { out } = run(KIND_PAGE, rules, (built) =>
      okResult([], [verdict(built, 0, "reject", "required-terms", "medium")]),
    );
    expect(out.setAside).toEqual([]);
    const reviewed = out.findings.find((f) => f.finding.title === TEXT_TITLE);
    expect(reviewed?.finding.confidence).toBe("low");
    expect(reviewed?.ruleConfidence).toBe("high");
  });
});

// ---------------------------------------------------------------------------
// Reject limits
// ---------------------------------------------------------------------------

const WORDS = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel"];

function textPage(count: number): { elements: ElementInput[]; rules: Finding[] } {
  const elements = WORDS.slice(0, count).map((word, i) =>
    makeText(`el-${i}`, "p", `Stock notice ${word}`),
  );
  const rules = elements.map((element) =>
    ruleFinding("fake-scarcity", TEXT_TITLE, [element.id], "high"),
  );
  return { elements, rules };
}

function rejectRun(n: number, rejects: number) {
  const page = textPage(n);
  const result = run(page.elements, page.rules, (built) =>
    okResult(
      [],
      Array.from({ length: rejects }, (_, i) =>
        verdict(built, i, "reject", "required-terms"),
      ),
    ),
  );
  return { ...result, rules: page.rules };
}

describe("reject limits", () => {
  it.each([
    { n: 7, rejects: 3 },
    { n: 8, rejects: 3 },
    { n: 2, rejects: 1 },
    { n: 3, rejects: 1 },
    { n: 4, rejects: 2 },
  ])("applies $rejects rejects over $n rejectable findings", ({ n, rejects }) => {
    const { out } = rejectRun(n, rejects);
    expect(out.anomalies).toEqual([]);
    expect(out.setAside).toHaveLength(rejects);
    expect(out.findings).toHaveLength(n - rejects);
  });

  it.each([
    { n: 8, rejects: 4 },
    { n: 7, rejects: 4 },
    { n: 1, rejects: 1 },
    { n: 2, rejects: 2 },
    { n: 3, rejects: 2 },
    { n: 5, rejects: 3 },
  ])("ignores all rejects when $rejects are asked over $n findings", ({ n, rejects }) => {
    const { out, rules } = rejectRun(n, rejects);
    expect(out.anomalies).toEqual(["too-many-rejects"]);
    expect(out.setAside).toEqual([]);
    expect(out.findings).toHaveLength(n);
    for (const reviewed of out.findings) {
      expect(reviewed.source).toBe("rules");
      expect(rules).toContain(reviewed.finding);
    }
  });

  it("ignores every verdict, not only the rejects, when there are too many rejects", () => {
    const page = textPage(4);
    const { out } = run(page.elements, page.rules, (built) =>
      okResult(
        [],
        [
          verdict(built, 0, "reject", "required-terms"),
          verdict(built, 1, "reject", "required-terms"),
          verdict(built, 2, "reject", "required-terms"),
          verdict(built, 3, "downgrade", "neutral-stock-fact"),
        ],
      ),
    );
    expect(out.anomalies).toEqual(["too-many-rejects"]);
    expect(out.findings.every((f) => f.source === "rules")).toBe(true);
    expect(out.findings.every((f) => f.finding.confidence === "high")).toBe(true);
  });

  it("does not count rejects on reload and measured findings", () => {
    // Two rejectable findings (floor 1) and two ignored rejects: still fine.
    const rules = kindRules({
      text: "high",
      structural: "high",
      measured: "high",
      reload: "high",
    });
    const { out } = run(KIND_PAGE, rules, (built) =>
      okResult(
        [],
        [
          verdict(built, 0, "reject", "required-terms"),
          verdict(built, 2, "reject", "dated-deadline"),
          verdict(built, 3, "reject", "dated-deadline"),
        ],
      ),
    );
    expect(out.anomalies).toEqual([]);
    expect(out.setAside).toHaveLength(1);
  });

  it("keeps a set-aside finding unchanged with its reason", () => {
    const { out, rules } = rejectRun(4, 1);
    expect(out.setAside).toEqual([
      { finding: rules[0], judgeReason: "required-terms" },
    ]);
    expect(out.setAside[0].finding).toBe(rules[0]);
  });
});

// ---------------------------------------------------------------------------
// Anomalous input
// ---------------------------------------------------------------------------

describe("an anomalous validated output", () => {
  it.each<AnomalyCode>(["too-many-findings", "too-many-flagged"])(
    "ignores every verdict on %s and keeps the new findings",
    (anomaly) => {
      const page = textPage(4);
      const { out } = run(
        [...page.elements, makeText("el-9", "p", "Only 3 left in stock")],
        page.rules,
        (built) =>
          okResult(
            [judged(built, "el-9", "fake-urgency", "undated-deadline")],
            [
              verdict(built, 0, "reject", "required-terms"),
              verdict(built, 1, "downgrade", "neutral-stock-fact"),
              verdict(built, 2, "confirm", "vague-low-stock"),
            ],
            [anomaly],
          ),
      );
      expect(out.anomalies).toEqual([anomaly]);
      expect(out.setAside).toEqual([]);
      const ruleSourced = out.findings.filter((f) => f.source !== "judge");
      expect(ruleSourced).toHaveLength(4);
      expect(ruleSourced.every((f) => f.source === "rules")).toBe(true);
      expect(ruleSourced.every((f) => f.finding.confidence === "high")).toBe(true);
      expect(out.findings.filter((f) => f.source === "judge")).toHaveLength(1);
    },
  );

  it("keeps at most 8 new findings", () => {
    const elements = WORDS.map((word, i) => makeText(`el-${i}`, "p", `Notice ${word}`));
    const { out } = run(elements, [], (built) =>
      okResult(
        [
          ...WORDS.map((_, i) =>
            judged(built, `el-${i}`, "fake-urgency", "undated-deadline"),
          ),
          judged(built, "el-0", "fake-scarcity", "vague-low-stock"),
        ],
        [],
        ["too-many-findings"],
      ),
    );
    expect(out.findings.length).toBeLessThanOrEqual(8);
  });

  it("does not turn a duplicate into a confirm", () => {
    const rules = [ruleFinding("fake-scarcity", TEXT_TITLE, ["el-0"], "medium")];
    const { out } = run([makeText("el-0", "p", "Only 3 left in stock")], rules, (built) =>
      okResult(
        [judged(built, "el-0", "fake-scarcity", "vague-low-stock")],
        [],
        ["too-many-flagged"],
      ),
    );
    expect(out.findings).toEqual([{ finding: rules[0], source: "rules" }]);
  });
});

// ---------------------------------------------------------------------------
// Judge-only findings
// ---------------------------------------------------------------------------

const SINGLE_PAGE: ElementInput[] = [makeText("el-0", "p", "Only 3 left in stock")];

describe("judge-only findings", () => {
  it.each(["high", "medium"] as Confidence[])(
    "shows a %s judge finding as low",
    (confidence) => {
      const { out } = run(SINGLE_PAGE, [], (built) =>
        okResult([judged(built, "el-0", "fake-scarcity", "vague-low-stock", confidence)]),
      );
      expect(out.findings).toHaveLength(1);
      const reviewed = out.findings[0];
      expect(reviewed.source).toBe("judge");
      expect(reviewed.finding.confidence).toBe("low");
      expect(reviewed.judgeReason).toBe("vague-low-stock");
      expect(reviewed.ruleConfidence).toBeUndefined();
    },
  );

  it("drops a low judge finding", () => {
    const { out } = run(SINGLE_PAGE, [], (built) =>
      okResult([judged(built, "el-0", "fake-scarcity", "vague-low-stock", "low")]),
    );
    expect(out.findings).toEqual([]);
  });

  it("assembles the finding from templates, the map and the snapshot", () => {
    const elements: ElementInput[] = [
      makeText("el-0", "p", "Only 3 left in stock"),
      makeText("el-1", "p", "Other text here"),
    ];
    const snapshot = makeSnapshot(elements);
    const built = buildCandidates(snapshot, []);
    const out = mergeReview(
      [],
      built,
      okResult([judged(built, "el-0", "fake-scarcity", "vague-low-stock")]),
      snapshot,
    );
    const finding = out.findings[0].finding;
    expect(FindingSchema.safeParse(finding).success).toBe(true);
    expect(finding.detectorName).toBe("judge");
    expect(finding.patternId).toBe("fake-scarcity");
    expect(finding.title).toBe(JUDGE_TITLES["fake-scarcity"]);
    expect(finding.title.startsWith("Possible")).toBe(true);
    expect(finding.explanation).toBe(EXPLANATIONS["fake-scarcity"]);
    expect(finding.detectedAt).toBe(SNAPSHOT_CAPTURED_AT);
    expect(finding.elementIds).toEqual(["el-0"]);
    expect(finding.boundingBoxes).toEqual([snapshot.elements[0].boundingBox]);
    expect(finding.description).toContain("Only 3 left");
    expect(finding.description).toContain(REASON_SENTENCES["vague-low-stock"]);
    expect(finding.evidence.text).toContain("Only 3 left");
  });

  it("uses every element id of a split candidate", () => {
    const elements: ElementInput[] = [
      makeText("el-0", "div", "Offer ends soon"),
      makeText("el-0-0", "span", "SALE50"),
    ];
    const snapshot = makeSnapshot(elements);
    const built = buildCandidates(snapshot, []);
    const candidate = [...built.map.candidates.values()][0];
    expect(candidate.elementIds).toEqual(["el-0", "el-0-0"]);
    const out = mergeReview(
      [],
      built,
      okResult([judged(built, "el-0", "fake-urgency", "undated-deadline")]),
      snapshot,
    );
    expect(out.findings[0].finding.elementIds).toEqual(["el-0", "el-0-0"]);
    expect(out.findings[0].finding.boundingBoxes).toHaveLength(2);
  });

  it("turns a quote with a forbidden word into a masked quote", () => {
    const { out } = run(SINGLE_PAGE, [], (built) =>
      okResult([
        judged(
          built,
          "el-0",
          "fake-scarcity",
          "vague-low-stock",
          "high",
          `Only ${FORBIDDEN_SAMPLE} 3 left`,
        ),
      ]),
    );
    expect(out.findings).toHaveLength(1);
    const finding = out.findings[0].finding;
    expect(finding.description).toContain("[word omitted]");
    expect(finding.evidence.text).toContain("[word omitted]");
    for (const text of [
      finding.title,
      finding.description,
      finding.evidence.text,
      finding.explanation,
    ]) {
      expect(containsForbidden(text)).toBe(false);
    }
  });

  it("collapses two findings of the same pattern and candidate", () => {
    const { out } = run(SINGLE_PAGE, [], (built) =>
      okResult([
        judged(built, "el-0", "fake-scarcity", "vague-low-stock"),
        judged(built, "el-0", "fake-scarcity", "selling-fast-claim", "medium"),
      ]),
    );
    expect(out.findings).toHaveLength(1);
  });

  it("keeps findings of different patterns on one candidate apart, by pattern id", () => {
    const { out } = run(SINGLE_PAGE, [], (built) =>
      okResult([
        judged(built, "el-0", "fake-urgency", "pressure-wording"),
        judged(built, "el-0", "fake-scarcity", "stock-with-pressure"),
      ]),
    );
    expect(out.findings.map((f) => f.finding.patternId)).toEqual([
      "fake-scarcity",
      "fake-urgency",
    ]);
  });

  it("still collapses when the first of two findings is low", () => {
    const { out } = run(SINGLE_PAGE, [], (built) =>
      okResult([
        judged(built, "el-0", "fake-scarcity", "vague-low-stock", "low"),
        judged(built, "el-0", "fake-scarcity", "selling-fast-claim", "high"),
      ]),
    );
    expect(out.findings).toHaveLength(1);
    expect(out.findings[0].judgeReason).toBe("selling-fast-claim");
  });
});

// ---------------------------------------------------------------------------
// assembleJudgeFinding
// ---------------------------------------------------------------------------

describe("assembleJudgeFinding", () => {
  const input = {
    pattern: "fake-scarcity" as const,
    quote: "Only 3 left",
    reason: "vague-low-stock" as const,
    elementIds: ["el-0"],
    boundingBoxes: [{ x: 1, y: 2, width: 3, height: 4 }],
    detectedAt: SNAPSHOT_CAPTURED_AT,
  };

  it("builds a valid finding with the default templates", () => {
    const finding = assembleJudgeFinding(input);
    expect(FindingSchema.safeParse(finding).success).toBe(true);
    expect(finding?.detectorName).toBe("judge");
    expect(finding?.confidence).toBe("low");
  });

  function templatesWith(change: Partial<JudgeTemplates>): JudgeTemplates {
    return { ...DEFAULT_TEMPLATES, ...change };
  }

  it("returns nothing when a title template holds a forbidden word", () => {
    const templates = templatesWith({
      titles: {
        ...JUDGE_TITLES,
        "fake-scarcity": `Possible ${FORBIDDEN_SAMPLE} stock wording`,
      },
    });
    expect(assembleJudgeFinding(input, templates)).toBeNull();
  });

  it("returns nothing when a description template holds a forbidden word", () => {
    const templates = templatesWith({
      description: (quoteText, reason) =>
        `The page shows ${quoteText}. A ${FORBIDDEN_SAMPLE} was seen. ${REASON_SENTENCES[reason]}`,
    });
    expect(assembleJudgeFinding(input, templates)).toBeNull();
  });

  it("returns nothing when an evidence template holds a forbidden word", () => {
    const templates = templatesWith({
      evidenceText: () => `Seen: ${FORBIDDEN_SAMPLE}.`,
    });
    expect(assembleJudgeFinding(input, templates)).toBeNull();
  });

  it("returns nothing when a reason sentence holds a forbidden word", () => {
    const templates = templatesWith({
      reasonSentences: {
        ...REASON_SENTENCES,
        "vague-low-stock": `This is a ${FORBIDDEN_SAMPLE}.`,
      },
    });
    expect(assembleJudgeFinding(input, templates)).toBeNull();
  });

  it("returns nothing when the title does not start with Possible", () => {
    const templates = templatesWith({
      titles: { ...JUDGE_TITLES, "fake-scarcity": "Stock wording" },
    });
    expect(assembleJudgeFinding(input, templates)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Duplicates
// ---------------------------------------------------------------------------

describe("duplicates of a rule finding", () => {
  const rule = (ids: string[], level: Confidence = "medium") =>
    ruleFinding("fake-scarcity", TEXT_TITLE, ids, level);

  it("counts a judge finding on the same element as a confirm and adds no marker", () => {
    const rules = [rule(["el-0"], "high")];
    const { out } = run(SINGLE_PAGE, rules, (built) =>
      okResult([judged(built, "el-0", "fake-scarcity", "vague-low-stock", "low")]),
    );
    expect(out.findings).toEqual([
      { finding: rules[0], source: "rules+judge", judgeReason: "vague-low-stock" },
    ]);
  });

  it("counts a judge finding on a descendant of the rule element", () => {
    const elements: ElementInput[] = [
      makeText("el-0", "p", "Only a few pieces of this item are left in stock"),
      makeText("el-0-1", "span", "Only a few left"),
    ];
    const rules = [rule(["el-0"])];
    const { out } = run(elements, rules, (built) =>
      okResult([judged(built, "el-0-1", "fake-scarcity", "vague-low-stock")]),
    );
    expect(out.findings).toHaveLength(1);
    expect(out.findings[0].source).toBe("rules+judge");
  });

  it("counts a judge finding on an ancestor of the rule element", () => {
    const elements: ElementInput[] = [
      makeText("el-0", "p", "Only a few pieces of this item are left in stock"),
      makeText("el-0-1", "span", "Only a few left"),
    ];
    const rules = [rule(["el-0-1"])];
    const { out } = run(elements, rules, (built) =>
      okResult([judged(built, "el-0", "fake-scarcity", "vague-low-stock")]),
    );
    expect(out.findings).toHaveLength(1);
    expect(out.findings[0].source).toBe("rules+judge");
  });

  it("does not treat el-0-1 and el-0-12 as related", () => {
    const elements: ElementInput[] = [
      makeText("el-0", "p", "Only a few pieces of this item are left in stock"),
      makeText("el-0-1", "span", "Only a few left"),
      makeText("el-0-12", "span", "Almost gone today"),
    ];
    const rules = [rule(["el-0-12"])];
    const { out } = run(elements, rules, (built) =>
      okResult([judged(built, "el-0-1", "fake-scarcity", "vague-low-stock")]),
    );
    expect(out.findings).toHaveLength(2);
    expect(out.findings.map((f) => f.source).sort()).toEqual(["judge", "rules"]);
  });

  it("does not count a finding of another pattern", () => {
    const rules = [rule(["el-0"])];
    const { out } = run(SINGLE_PAGE, rules, (built) =>
      okResult([judged(built, "el-0", "fake-urgency", "pressure-wording")]),
    );
    expect(out.findings).toHaveLength(2);
    expect(out.findings.find((f) => f.source === "rules")?.finding).toBe(rules[0]);
    expect(out.findings.find((f) => f.source === "judge")?.finding.patternId).toBe(
      "fake-urgency",
    );
  });

  it("lets an explicit verdict win over a duplicate", () => {
    const rules = [rule(["el-0"], "high")];
    const { out } = run(SINGLE_PAGE, rules, (built) =>
      okResult(
        [judged(built, "el-0", "fake-scarcity", "vague-low-stock", "high")],
        [verdict(built, 0, "downgrade", "neutral-stock-fact")],
      ),
    );
    expect(out.findings).toHaveLength(1);
    expect(out.findings[0].finding.confidence).toBe("low");
    expect(out.findings[0].ruleConfidence).toBe("high");
    expect(out.findings[0].judgeReason).toBe("neutral-stock-fact");
  });

  it("adds no marker for a duplicate of a rule finding that was not sent", () => {
    // 21 rule findings: the last is not sent, but a judge finding on it is still a duplicate.
    const elements: ElementInput[] = Array.from({ length: 21 }, (_, i) =>
      makeText(`el-${i}`, "p", `Short stock note ${i}`),
    );
    const rules = elements.map((e) => rule([e.id]));
    const { built, out } = run(elements, rules, (b) =>
      okResult([judged(b, "el-20", "fake-scarcity", "vague-low-stock")]),
    );
    expect(built.map.rules.size).toBe(20);
    expect(out.findings).toHaveLength(21);
    expect(out.findings.every((f) => rules.includes(f.finding))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Ordering
// ---------------------------------------------------------------------------

describe("ordering", () => {
  it("orders findings by the document position of the first element, then by pattern id", () => {
    const elements: ElementInput[] = [
      makeText("el-0", "p", "First notice here"),
      makeText("el-1", "p", "Second notice here"),
      makeText("el-2", "p", "Third notice here"),
    ];
    const rules = [
      ruleFinding("fake-urgency", TITLES["fake-urgency"][2], ["el-2"]),
      ruleFinding("fake-scarcity", TEXT_TITLE, ["el-1"]),
    ];
    const { out } = run(elements, rules, (built) =>
      okResult([
        judged(built, "el-0", "fake-urgency", "undated-deadline"),
        judged(built, "el-1", "fake-activity", "live-viewers"),
      ]),
    );
    expect(
      out.findings.map((f) => [f.finding.elementIds[0], f.finding.patternId]),
    ).toEqual([
      ["el-0", "fake-urgency"],
      ["el-1", "fake-activity"],
      ["el-1", "fake-scarcity"],
      ["el-2", "fake-urgency"],
    ]);
  });

  it("orders the set-aside list the same way", () => {
    const page = textPage(4);
    const rules = [...page.rules].reverse();
    const { out } = run(page.elements, rules, (built) =>
      okResult(
        [],
        [
          verdict(built, 0, "reject", "required-terms"),
          verdict(built, 1, "reject", "required-terms"),
        ],
      ),
    );
    expect(out.setAside.map((s) => s.finding.elementIds[0])).toEqual(["el-2", "el-3"]);
  });
});

// ---------------------------------------------------------------------------
// By construction (design section 15)
// ---------------------------------------------------------------------------

/** A small seeded generator; the test never calls Math.random. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PICK_PAGE: ElementInput[] = [
  ...KIND_PAGE,
  makeText("el-6", "p", "Offer ends tonight"),
  makeText("el-7", "p", "12 people are viewing this"),
  makeText("el-8", "p", "No thanks, I hate saving money"),
];

describe("by construction", () => {
  it("never raises a level, never shows a judge finding above low, never adds medium or high", () => {
    const random = seeded(20260101);
    const pick = <T,>(list: readonly T[]): T => list[Math.floor(random() * list.length)];
    const snapshot = makeSnapshot(PICK_PAGE);

    for (let round = 0; round < 500; round += 1) {
      const level = () => pick(LEVELS);
      const candidatesRules: Finding[] = [
        ruleFinding("fake-scarcity", TEXT_TITLE, ["el-0"], level()),
        ruleFinding("preselection", STRUCTURAL_TITLE, ["el-1", "el-2"], level()),
        ruleFinding("visual-interference", MEASURED_TITLE, ["el-3-1"], level()),
        ruleFinding("fake-urgency", RELOAD_TITLE, ["el-5"], level()),
        ruleFinding("fake-urgency", TITLES["fake-urgency"][2], ["el-6"], level()),
        ruleFinding("fake-activity", TITLES["fake-activity"][2], ["el-7"], level()),
        ruleFinding("confirmshaming", TITLES.confirmshaming[0], ["el-8"], level()),
      ];
      const rules = candidatesRules.filter(() => random() < 0.8);
      const built = buildCandidates(snapshot, rules);

      const verdicts: VerdictIn[] = [];
      for (const [id, mapped] of built.map.rules) {
        if (random() < 0.4) continue;
        const pattern = rules[mapped.index].patternId as JudgePatternId;
        const decision = pick(["confirm", "downgrade", "reject"] as const);
        const reason =
          decision === "confirm"
            ? pick(FLAG_CODES_BY_PATTERN[pattern])
            : decision === "reject"
              ? pick(LOOK_ALIKE_CODES)
              : pick([
                  ...LOOK_ALIKE_CODES,
                  ...FLAG_CODES_BY_PATTERN[pattern],
                  INSUFFICIENT_CONTEXT,
                ]);
        verdicts.push({
          rule: id as VerdictIn["rule"],
          decision,
          confidence: pick(LEVELS),
          reason: reason as VerdictIn["reason"],
        });
      }

      const findings: FindingIn[] = [];
      const candidateIds = [...built.map.candidates.keys()];
      const count = Math.floor(random() * 6);
      for (let i = 0; i < count; i += 1) {
        const pattern = pick(JUDGE_PATTERN_IDS);
        findings.push({
          candidate: pick(candidateIds) as FindingIn["candidate"],
          pattern,
          quote: "Only 3 left",
          confidence: pick(LEVELS),
          reason: pick(FLAG_CODES_BY_PATTERN[pattern]) as FindingIn["reason"],
        });
      }

      const out = mergeReview(rules, built, okResult(findings, verdicts), snapshot);

      const keyOf = (f: Finding) => `${f.title}|${f.elementIds.join(",")}`;
      const original = new Map(rules.map((f) => [keyOf(f), f]));

      let rulesOnlyStrong = 0;
      for (const f of rules) if (RANK[f.confidence] >= 1) rulesOnlyStrong += 1;
      let mergedStrong = 0;

      let ruleSourced = 0;
      for (const reviewed of out.findings) {
        const finding = reviewed.finding;
        expect(FindingSchema.safeParse(finding).success).toBe(true);
        if (RANK[finding.confidence] >= 1) mergedStrong += 1;
        if (reviewed.source === "judge") {
          expect(finding.confidence).toBe("low");
          expect(finding.detectorName).toBe("judge");
          continue;
        }
        ruleSourced += 1;
        const before = original.get(keyOf(finding));
        expect(before).toBeDefined();
        expect(RANK[finding.confidence]).toBeLessThanOrEqual(
          RANK[(before as Finding).confidence],
        );
        if (reviewed.source === "rules") {
          expect(finding).toBe(before);
        }
      }
      // Nothing disappears: every rule finding is shown or set aside.
      expect(ruleSourced + out.setAside.length).toBe(rules.length);
      for (const aside of out.setAside) {
        expect(aside.finding).toBe(original.get(keyOf(aside.finding)));
      }
      expect(mergedStrong).toBeLessThanOrEqual(rulesOnlyStrong);
    }
  });
});
