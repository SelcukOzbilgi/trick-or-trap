import { describe, it, expect } from "vitest";
import { DISCLAIMER, STATUS_REASONS, statusLine } from "@/lib/judge/summary";
import { JUDGE_STATUSES } from "@/lib/judge/types";
import type { JudgeStatus, ReviewResult } from "@/lib/judge/types";

const RULE_ERROR_SENTENCE =
  "Part of the rule check failed, so this result is incomplete.";

const NOT_RUN: readonly JudgeStatus[] = [
  "off",
  "skipped-no-time",
  "skipped-over-budget",
  "skipped-cooldown",
  "timeout",
  "error",
  "invalid-output",
];

function resultFor(
  status: JudgeStatus,
  withFinding: boolean,
  ruleErrors: number,
): ReviewResult {
  const finding = {
    patternId: "fake-scarcity" as const,
    confidence: "low" as const,
    title: "Possible fake scarcity: low-stock message",
    description: "d",
    evidence: { text: "e" },
    elementIds: ["el-0"],
    boundingBoxes: [{ x: 0, y: 0, width: 1, height: 1 }],
    explanation: "x",
    detectorName: "fake-scarcity",
    detectedAt: "2026-01-01T00:00:00.000Z",
  };
  return {
    findings: withFinding ? [{ finding, source: "rules" }] : [],
    setAside: [],
    judge: { status, candidateCount: 0, truncated: false },
    ruleErrors,
  };
}

describe("the disclaimer", () => {
  it("is the fixed sentence", () => {
    expect(DISCLAIMER).toBe("Automated detection — may be wrong.");
  });
});

describe("status reason templates", () => {
  it("has the template of each status that did not run", () => {
    expect(STATUS_REASONS).toEqual({
      off: "turned off",
      "skipped-no-time": "not enough time left in this scan",
      "skipped-over-budget": "daily limit reached",
      "skipped-cooldown": "daily limit reached",
      timeout: "it took too long",
      error: "it could not be reached",
      "invalid-output": "its answer could not be used",
    });
  });
});

describe("statusLine rows", () => {
  it("ran with findings", () => {
    expect(statusLine(resultFor("ran", true, 0))).toBe(
      "Checked by rules and a language-model reviewer. Automated detection — may be wrong.",
    );
  });

  it("ran with no findings", () => {
    expect(statusLine(resultFor("ran", false, 0))).toBe(
      "No possible patterns found. Automated detection — may be wrong.",
    );
  });

  it("ran-anomalous with findings", () => {
    expect(statusLine(resultFor("ran-anomalous", true, 0))).toBe(
      "Checked by rules. The reviewer's answer looked unusual, so only its new findings were kept and none of the rule matches were set aside. Automated detection — may be wrong.",
    );
  });

  it("ran-anomalous with no findings", () => {
    expect(statusLine(resultFor("ran-anomalous", false, 0))).toBe(
      "Checked by rules. The reviewer's answer looked unusual, so only its new findings were kept and none of the rule matches were set aside. No possible patterns found. Automated detection — may be wrong.",
    );
  });

  it.each(NOT_RUN)("%s with findings gives the rules-only line and its reason", (status) => {
    expect(statusLine(resultFor(status, true, 0))).toBe(
      `Checked by rules only. The language-model reviewer did not run (${STATUS_REASONS[status as keyof typeof STATUS_REASONS]}), so wording outside the rules was not checked. Automated detection — may be wrong.`,
    );
  });

  it.each(NOT_RUN)("%s with no findings says the reviewer did not run", (status) => {
    expect(statusLine(resultFor(status, false, 0))).toBe(
      "No possible patterns found by the rules. The reviewer did not run. Automated detection — may be wrong.",
    );
  });

  it("adds the rule-error sentence before the disclaimer", () => {
    expect(statusLine(resultFor("ran", true, 1))).toBe(
      `Checked by rules and a language-model reviewer. ${RULE_ERROR_SENTENCE} Automated detection — may be wrong.`,
    );
    expect(statusLine(resultFor("off", false, 3))).toBe(
      `No possible patterns found by the rules. The reviewer did not run. ${RULE_ERROR_SENTENCE} Automated detection — may be wrong.`,
    );
  });

  it("leaves the rule-error sentence out when ruleErrors is 0", () => {
    for (const status of JUDGE_STATUSES) {
      expect(statusLine(resultFor(status, true, 0))).not.toContain(RULE_ERROR_SENTENCE);
    }
  });

  it("ignores the set-aside list: the findings list decides the empty case", () => {
    const base = resultFor("ran", false, 0);
    const withSetAside: ReviewResult = {
      ...base,
      setAside: [
        {
          finding: resultFor("ran", true, 0).findings[0].finding,
          judgeReason: "dated-deadline",
        },
      ],
    };
    expect(statusLine(withSetAside)).toBe(statusLine(base));
  });
});

describe("statusLine enumeration (9 statuses x 2 list states x 2 error states)", () => {
  const lines: { status: JudgeStatus; empty: boolean; errors: number; line: string }[] = [];
  for (const status of JUDGE_STATUSES) {
    for (const empty of [true, false]) {
      for (const errors of [0, 2]) {
        lines.push({
          status,
          empty,
          errors,
          line: statusLine(resultFor(status, !empty, errors)),
        });
      }
    }
  }

  it("covers 36 combinations", () => {
    expect(lines).toHaveLength(36);
  });

  it("never holds 'nothing found' in any letter case", () => {
    for (const { line } of lines) {
      expect(line.toLowerCase()).not.toContain("nothing found");
    }
  });

  it("ends every line with the disclaimer, and only once", () => {
    for (const { line } of lines) {
      expect(line.endsWith(DISCLAIMER)).toBe(true);
      expect(line.split(DISCLAIMER)).toHaveLength(2);
    }
  });

  it("says that the reviewer did not run or that its answer looked unusual on every empty line other than ran", () => {
    for (const { status, empty, line } of lines) {
      if (!empty || status === "ran") continue;
      const lower = line.toLowerCase();
      expect(
        lower.includes("reviewer did not run") || lower.includes("looked unusual"),
      ).toBe(true);
    }
  });

  it("adds the rule-error sentence exactly when ruleErrors is above 0", () => {
    for (const { errors, line } of lines) {
      expect(line.includes(RULE_ERROR_SENTENCE)).toBe(errors > 0);
    }
  });

  it("says 'No possible patterns found' on an empty line only, and never on a non-empty one", () => {
    for (const { empty, line } of lines) {
      expect(line.includes("No possible patterns found")).toBe(empty);
    }
  });
});
