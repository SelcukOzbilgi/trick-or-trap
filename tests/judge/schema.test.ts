import { describe, it, expect } from "vitest";
import {
  FLAG_CODES,
  FLAG_CODES_BY_PATTERN,
  JUDGE_PATTERN_IDS,
  JUDGE_STATUSES,
  LOOK_ALIKE_CODES,
  REASON_CODES,
  ReviewResultSchema,
} from "@/lib/judge/types";
import {
  CANDIDATE_IDS,
  JUDGE_DECISIONS,
  JUDGE_OUTPUT_JSON_SCHEMA,
  JudgeOutputSchema,
  RULE_IDS,
} from "@/lib/judge/schema";
import { MAX_CANDIDATES, MAX_RULE_FINDINGS_SENT } from "@/lib/judge/constants";
import { ConfidenceSchema } from "@/lib/types";
import type { Finding } from "@/lib/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function validFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    patternId: "fake-urgency",
    confidence: "low",
    title: "Possible fake urgency: deadline wording",
    description: 'The page shows "Hurry". A language-model reviewer flagged this.',
    evidence: { text: 'Text checked by the reviewer: "Hurry".' },
    elementIds: ["el-0-1"],
    boundingBoxes: [{ x: 0, y: 0, width: 10, height: 10 }],
    explanation: "Time limits can push people to decide faster than planned.",
    detectorName: "judge",
    detectedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function validResult(): Record<string, unknown> {
  return {
    findings: [
      {
        finding: validFinding(),
        source: "judge",
        judgeReason: "pressure-wording",
      },
      {
        finding: validFinding({ confidence: "medium" }),
        source: "rules+judge",
        ruleConfidence: "high",
      },
      { finding: validFinding(), source: "rules" },
    ],
    setAside: [
      { finding: validFinding(), judgeReason: "dated-deadline" },
    ],
    judge: { status: "ran", candidateCount: 12, truncated: false },
    ruleErrors: 0,
  };
}

function validOutput(): Record<string, unknown> {
  return {
    findings: [
      {
        candidate: "c1",
        pattern: "fake-urgency",
        quote: "Hurry up",
        confidence: "low",
        reason: "pressure-wording",
      },
    ],
    verdicts: [
      {
        rule: "r1",
        decision: "reject",
        confidence: "high",
        reason: "dated-deadline",
      },
    ],
  };
}

type Json = { [key: string]: unknown };

function isRecord(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function walk(node: unknown, visit: (node: Json) => void): void {
  if (Array.isArray(node)) {
    node.forEach((child) => walk(child, visit));
    return;
  }
  if (!isRecord(node)) return;
  visit(node);
  Object.values(node).forEach((child) => walk(child, visit));
}

function isDeepFrozen(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return true;
  if (!Object.isFrozen(value)) return false;
  return Object.values(value).every(isDeepFrozen);
}

function enumAt(path: string[]): unknown {
  let node: unknown = JUDGE_OUTPUT_JSON_SCHEMA;
  for (const key of path) {
    if (!isRecord(node)) return undefined;
    node = node[key];
  }
  return isRecord(node) ? node.enum : undefined;
}

const FINDING_PROPS = ["properties", "findings", "items", "properties"];
const VERDICT_PROPS = ["properties", "verdicts", "items", "properties"];

// ---------------------------------------------------------------------------
// Reason codes, patterns and statuses
// ---------------------------------------------------------------------------

describe("reason codes", () => {
  it("holds the six patterns in the order of the design", () => {
    expect([...JUDGE_PATTERN_IDS]).toEqual([
      "fake-urgency",
      "fake-scarcity",
      "fake-activity",
      "confirmshaming",
      "preselection",
      "visual-interference",
    ]);
  });

  it("holds the flag codes of each pattern", () => {
    expect(Object.keys(FLAG_CODES_BY_PATTERN)).toEqual([...JUDGE_PATTERN_IDS]);
    expect({ ...FLAG_CODES_BY_PATTERN }).toEqual({
      "fake-urgency": [
        "undated-deadline",
        "rolling-deadline",
        "personal-timer",
        "pressure-wording",
      ],
      "fake-scarcity": [
        "vague-low-stock",
        "stock-with-pressure",
        "selling-fast-claim",
      ],
      "fake-activity": [
        "live-viewers",
        "live-baskets",
        "recent-purchase-notice",
        "recent-count",
      ],
      confirmshaming: ["shaming-decline", "guilt-decline"],
      preselection: [
        "prechecked-paid-addon",
        "prechecked-marketing",
        "prechecked-data-sharing",
        "preselected-recurring",
        "preselected-pricier",
      ],
      "visual-interference": ["faint-decline", "tiny-decline", "tiny-close"],
    });
  });

  it("has 21 flag codes, 17 look-alike codes and 1 other: 39 in all", () => {
    expect(FLAG_CODES).toHaveLength(21);
    expect(LOOK_ALIKE_CODES).toHaveLength(17);
    expect(REASON_CODES).toHaveLength(39);
    expect(new Set(REASON_CODES).size).toBe(39);
  });

  it("holds the look-alike codes and the one other code", () => {
    expect([...LOOK_ALIKE_CODES]).toEqual([
      "dated-deadline",
      "true-by-nature-deadline",
      "duration-not-deadline",
      "holiday-countdown",
      "neutral-stock-fact",
      "edition-or-purchase-limit",
      "cumulative-count",
      "own-order-status",
      "review-or-quote",
      "neutral-decline",
      "not-a-decline",
      "required-terms",
      "free-or-cheapest-default",
      "neutral-default",
      "comparable-prominence",
      "not-a-choice",
      "disabled-control",
    ]);
    const rest = REASON_CODES.filter(
      (code) =>
        !(FLAG_CODES as readonly string[]).includes(code) &&
        !(LOOK_ALIKE_CODES as readonly string[]).includes(code)
    );
    expect(rest).toEqual(["insufficient-context"]);
  });

  it("makes FLAG_CODES the flat list of the per-pattern codes", () => {
    const flat = JUDGE_PATTERN_IDS.flatMap((p) => [...FLAG_CODES_BY_PATTERN[p]]);
    expect([...FLAG_CODES]).toEqual(flat);
  });

  it("freezes the code lists", () => {
    expect(isDeepFrozen(FLAG_CODES_BY_PATTERN)).toBe(true);
    expect(Object.isFrozen(FLAG_CODES)).toBe(true);
    expect(Object.isFrozen(LOOK_ALIKE_CODES)).toBe(true);
    expect(Object.isFrozen(REASON_CODES)).toBe(true);
    expect(Object.isFrozen(JUDGE_PATTERN_IDS)).toBe(true);
    expect(Object.isFrozen(JUDGE_STATUSES)).toBe(true);
  });
});

describe("statuses", () => {
  it("holds exactly the nine statuses", () => {
    expect([...JUDGE_STATUSES]).toEqual([
      "ran",
      "ran-anomalous",
      "off",
      "skipped-no-time",
      "skipped-over-budget",
      "skipped-cooldown",
      "timeout",
      "error",
      "invalid-output",
    ]);
  });
});

// ---------------------------------------------------------------------------
// ReviewResultSchema
// ---------------------------------------------------------------------------

describe("ReviewResultSchema", () => {
  it("accepts a valid result", () => {
    expect(ReviewResultSchema.safeParse(validResult()).success).toBe(true);
  });

  it("accepts an empty result", () => {
    const result = {
      findings: [],
      setAside: [],
      judge: { status: "off", candidateCount: 0, truncated: false },
      ruleErrors: 0,
    };
    expect(ReviewResultSchema.safeParse(result).success).toBe(true);
  });

  it("accepts every status", () => {
    for (const status of JUDGE_STATUSES) {
      const result = {
        ...validResult(),
        judge: { status, candidateCount: 0, truncated: false },
      };
      expect(ReviewResultSchema.safeParse(result).success).toBe(true);
    }
  });

  it("rejects a bad source", () => {
    const result = validResult();
    (result.findings as Record<string, unknown>[])[0].source = "model";
    expect(ReviewResultSchema.safeParse(result).success).toBe(false);
  });

  it("rejects a title that does not start with Possible", () => {
    const result = validResult();
    (result.findings as Record<string, unknown>[])[0].finding = validFinding({
      title: "Fake urgency detected",
    });
    expect(ReviewResultSchema.safeParse(result).success).toBe(false);
  });

  it("rejects a set-aside title that does not start with Possible", () => {
    const result = validResult();
    (result.setAside as Record<string, unknown>[])[0].finding = validFinding({
      title: "Honest deadline",
    });
    expect(ReviewResultSchema.safeParse(result).success).toBe(false);
  });

  it("rejects a missing judge field", () => {
    const result = validResult();
    delete result.judge;
    expect(ReviewResultSchema.safeParse(result).success).toBe(false);
  });

  it("rejects a missing field inside judge", () => {
    for (const key of ["status", "candidateCount", "truncated"]) {
      const result = validResult();
      const judge = { ...(result.judge as Record<string, unknown>) };
      delete judge[key];
      result.judge = judge;
      expect(ReviewResultSchema.safeParse(result).success).toBe(false);
    }
  });

  it("rejects an unknown status", () => {
    const result = validResult();
    result.judge = { status: "done", candidateCount: 0, truncated: false };
    expect(ReviewResultSchema.safeParse(result).success).toBe(false);
  });

  it("rejects an unknown reason code", () => {
    const result = validResult();
    (result.setAside as Record<string, unknown>[])[0].judgeReason = "scary";
    expect(ReviewResultSchema.safeParse(result).success).toBe(false);
  });

  it("rejects a missing reason on a set-aside finding", () => {
    const result = validResult();
    delete (result.setAside as Record<string, unknown>[])[0].judgeReason;
    expect(ReviewResultSchema.safeParse(result).success).toBe(false);
  });

  it("rejects a bad ruleErrors, candidateCount and a missing findings list", () => {
    const negative = { ...validResult(), ruleErrors: -1 };
    expect(ReviewResultSchema.safeParse(negative).success).toBe(false);
    const fraction = { ...validResult(), ruleErrors: 0.5 };
    expect(ReviewResultSchema.safeParse(fraction).success).toBe(false);
    const count = {
      ...validResult(),
      judge: { status: "ran", candidateCount: -1, truncated: false },
    };
    expect(ReviewResultSchema.safeParse(count).success).toBe(false);
    const missing = validResult();
    delete missing.findings;
    expect(ReviewResultSchema.safeParse(missing).success).toBe(false);
  });

  it("rejects a finding that fails FindingSchema", () => {
    const result = validResult();
    (result.findings as Record<string, unknown>[])[2].finding = {
      ...validFinding(),
      detectedAt: "yesterday",
    };
    expect(ReviewResultSchema.safeParse(result).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// JudgeOutputSchema
// ---------------------------------------------------------------------------

describe("JudgeOutputSchema", () => {
  it("accepts a valid answer", () => {
    expect(JudgeOutputSchema.safeParse(validOutput()).success).toBe(true);
  });

  it("accepts empty lists", () => {
    expect(
      JudgeOutputSchema.safeParse({ findings: [], verdicts: [] }).success
    ).toBe(true);
  });

  it("rejects an extra key at the top, on a finding and on a verdict", () => {
    const top = { ...validOutput(), note: "x" };
    expect(JudgeOutputSchema.safeParse(top).success).toBe(false);

    const finding = validOutput();
    (finding.findings as Record<string, unknown>[])[0].extra = 1;
    expect(JudgeOutputSchema.safeParse(finding).success).toBe(false);

    const verdict = validOutput();
    (verdict.verdicts as Record<string, unknown>[])[0].extra = 1;
    expect(JudgeOutputSchema.safeParse(verdict).success).toBe(false);
  });

  it("rejects a missing key", () => {
    expect(JudgeOutputSchema.safeParse({ findings: [] }).success).toBe(false);
    expect(JudgeOutputSchema.safeParse({ verdicts: [] }).success).toBe(false);
    for (const key of ["candidate", "pattern", "quote", "confidence", "reason"]) {
      const out = validOutput();
      delete (out.findings as Record<string, unknown>[])[0][key];
      expect(JudgeOutputSchema.safeParse(out).success).toBe(false);
    }
    for (const key of ["rule", "decision", "confidence", "reason"]) {
      const out = validOutput();
      delete (out.verdicts as Record<string, unknown>[])[0][key];
      expect(JudgeOutputSchema.safeParse(out).success).toBe(false);
    }
  });

  it("rejects wrong enum values", () => {
    const cases: Array<[string, "findings" | "verdicts", string, string]> = [
      ["candidate id", "findings", "candidate", "c61"],
      ["candidate id zero", "findings", "candidate", "c0"],
      ["candidate id text", "findings", "candidate", "candidate1"],
      ["pattern", "findings", "pattern", "drip-pricing"],
      ["finding confidence", "findings", "confidence", "certain"],
      ["finding reason (look-alike)", "findings", "reason", "dated-deadline"],
      ["finding reason (other)", "findings", "reason", "insufficient-context"],
      ["rule id", "verdicts", "rule", "r21"],
      ["rule id zero", "verdicts", "rule", "r0"],
      ["decision", "verdicts", "decision", "approve"],
      ["verdict confidence", "verdicts", "confidence", "sure"],
      ["verdict reason", "verdicts", "reason", "scary"],
    ];
    for (const [label, list, key, value] of cases) {
      const out = validOutput();
      (out[list] as Record<string, unknown>[])[0][key] = value;
      expect(
        JudgeOutputSchema.safeParse(out).success,
        `${label} must be rejected`
      ).toBe(false);
    }
  });

  it("accepts every verdict reason code and every flag code on a finding", () => {
    for (const reason of REASON_CODES) {
      const out = validOutput();
      (out.verdicts as Record<string, unknown>[])[0].reason = reason;
      expect(JudgeOutputSchema.safeParse(out).success).toBe(true);
    }
    for (const reason of FLAG_CODES) {
      const out = validOutput();
      (out.findings as Record<string, unknown>[])[0].reason = reason;
      expect(JudgeOutputSchema.safeParse(out).success).toBe(true);
    }
  });

  it("does not enforce counts or lengths (validateOutput does)", () => {
    const out = validOutput();
    const one = (out.findings as Record<string, unknown>[])[0];
    out.findings = Array.from({ length: 30 }, () => ({ ...one, quote: "" }));
    expect(JudgeOutputSchema.safeParse(out).success).toBe(true);
  });

  it("rejects a non-object and a non-string quote", () => {
    expect(JudgeOutputSchema.safeParse(null).success).toBe(false);
    expect(JudgeOutputSchema.safeParse([]).success).toBe(false);
    expect(JudgeOutputSchema.safeParse("{}").success).toBe(false);
    const out = validOutput();
    (out.findings as Record<string, unknown>[])[0].quote = 7;
    expect(JudgeOutputSchema.safeParse(out).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// JSON Schema
// ---------------------------------------------------------------------------

describe("JUDGE_OUTPUT_JSON_SCHEMA", () => {
  it("lists candidate ids c1 to c60 and rule ids r1 to r20", () => {
    expect(CANDIDATE_IDS).toHaveLength(MAX_CANDIDATES);
    expect(CANDIDATE_IDS[0]).toBe("c1");
    expect(CANDIDATE_IDS[MAX_CANDIDATES - 1]).toBe("c60");
    expect(RULE_IDS).toHaveLength(MAX_RULE_FINDINGS_SENT);
    expect(RULE_IDS[0]).toBe("r1");
    expect(RULE_IDS[MAX_RULE_FINDINGS_SENT - 1]).toBe("r20");
  });

  it("holds the same values as the zod enums, enum by enum", () => {
    const findingShape = JudgeOutputSchema.shape.findings.element.shape;
    const verdictShape = JudgeOutputSchema.shape.verdicts.element.shape;

    expect(enumAt([...FINDING_PROPS, "candidate"])).toEqual([
      ...findingShape.candidate.options,
    ]);
    expect(enumAt([...FINDING_PROPS, "pattern"])).toEqual([
      ...findingShape.pattern.options,
    ]);
    expect(enumAt([...FINDING_PROPS, "confidence"])).toEqual([
      ...findingShape.confidence.options,
    ]);
    expect(enumAt([...FINDING_PROPS, "reason"])).toEqual([
      ...findingShape.reason.options,
    ]);
    expect(enumAt([...VERDICT_PROPS, "rule"])).toEqual([
      ...verdictShape.rule.options,
    ]);
    expect(enumAt([...VERDICT_PROPS, "decision"])).toEqual([
      ...verdictShape.decision.options,
    ]);
    expect(enumAt([...VERDICT_PROPS, "confidence"])).toEqual([
      ...verdictShape.confidence.options,
    ]);
    expect(enumAt([...VERDICT_PROPS, "reason"])).toEqual([
      ...verdictShape.reason.options,
    ]);
  });

  it("uses the named lists for every enum", () => {
    expect(enumAt([...FINDING_PROPS, "candidate"])).toEqual([...CANDIDATE_IDS]);
    expect(enumAt([...VERDICT_PROPS, "rule"])).toEqual([...RULE_IDS]);
    expect(enumAt([...FINDING_PROPS, "pattern"])).toEqual([
      ...JUDGE_PATTERN_IDS,
    ]);
    expect(enumAt([...FINDING_PROPS, "confidence"])).toEqual([
      ...ConfidenceSchema.options,
    ]);
    expect(enumAt([...VERDICT_PROPS, "confidence"])).toEqual([
      ...ConfidenceSchema.options,
    ]);
    expect(enumAt([...FINDING_PROPS, "reason"])).toEqual([...FLAG_CODES]);
    expect(enumAt([...VERDICT_PROPS, "reason"])).toEqual([...REASON_CODES]);
    expect(enumAt([...VERDICT_PROPS, "decision"])).toEqual([
      ...JUDGE_DECISIONS,
    ]);
    expect([...JUDGE_DECISIONS]).toEqual(["confirm", "downgrade", "reject"]);
  });

  it("has additionalProperties false and a full required list on every object", () => {
    let objects = 0;
    walk(JUDGE_OUTPUT_JSON_SCHEMA, (node) => {
      if (node.type !== "object") return;
      objects += 1;
      expect(node.additionalProperties).toBe(false);
      const properties = node.properties;
      expect(isRecord(properties)).toBe(true);
      const required = node.required;
      expect(Array.isArray(required)).toBe(true);
      expect([...(required as string[])].sort()).toEqual(
        Object.keys(properties as Json).sort()
      );
    });
    // the root, one finding item and one verdict item
    expect(objects).toBe(3);
  });

  it("requires exactly the keys of the zod schema", () => {
    const root = JUDGE_OUTPUT_JSON_SCHEMA as Json;
    expect(root.required).toEqual(["findings", "verdicts"]);
    const finding = (
      ((root.properties as Json).findings as Json).items as Json
    ).required;
    expect(finding).toEqual([
      "candidate",
      "pattern",
      "quote",
      "confidence",
      "reason",
    ]);
    const verdict = (
      ((root.properties as Json).verdicts as Json).items as Json
    ).required;
    expect(verdict).toEqual(["rule", "decision", "confidence", "reason"]);
  });

  it("makes quote a plain string with no length keyword", () => {
    const quote = (
      (((JUDGE_OUTPUT_JSON_SCHEMA as Json).properties as Json)
        .findings as Json).items as Json
    ).properties as Json;
    expect(quote.quote).toEqual({ type: "string" });
  });

  it("is deep-frozen and the same value on every read", () => {
    expect(isDeepFrozen(JUDGE_OUTPUT_JSON_SCHEMA)).toBe(true);
    const first = JSON.stringify(JUDGE_OUTPUT_JSON_SCHEMA);
    expect(JSON.stringify(JUDGE_OUTPUT_JSON_SCHEMA)).toBe(first);
    const copy = JSON.parse(first);
    expect(copy).toEqual(JUDGE_OUTPUT_JSON_SCHEMA);
    expect(() => {
      (JUDGE_OUTPUT_JSON_SCHEMA as Json).extra = 1;
    }).toThrow();
  });
});
