import { describe, it, expect } from "vitest";
import { FORBIDDEN_WORDS } from "@/lib/detectors/data/forbidden-words";
import { containsForbidden } from "@/lib/detectors/shared/finding";
import { JUDGE_SYSTEM_PROMPT } from "@/lib/judge/prompt";
import { DISCLAIMER, STATUS_REASONS, statusLine } from "@/lib/judge/summary";
import {
  DEFAULT_TEMPLATES,
  JUDGE_EVIDENCE_PREFIX,
  JUDGE_TITLES,
  REASON_SENTENCES,
  SET_ASIDE_HEADING,
  judgeDescription,
  judgeEvidenceText,
} from "@/lib/judge/templates";
import {
  JUDGE_PATTERN_IDS,
  JUDGE_STATUSES,
  REASON_CODES,
} from "@/lib/judge/types";
import type { ReviewResult } from "@/lib/judge/types";

/** A forbidden word taken from the data file, so no literal is written here. */
const FORBIDDEN_SAMPLE = FORBIDDEN_WORDS[0];

function resultFor(
  status: ReviewResult["judge"]["status"],
  withFinding: boolean,
  ruleErrors: number,
): ReviewResult {
  const finding = {
    patternId: "fake-scarcity" as const,
    confidence: "low" as const,
    title: "Possible fake scarcity: stock wording",
    description: "d",
    evidence: { text: "e" },
    elementIds: ["el-0"],
    boundingBoxes: [{ x: 0, y: 0, width: 1, height: 1 }],
    explanation: "x",
    detectorName: "judge",
    detectedAt: "2026-01-01T00:00:00.000Z",
  };
  return {
    findings: withFinding ? [{ finding, source: "judge" }] : [],
    setAside: [],
    judge: { status, candidateCount: 0, truncated: false },
    ruleErrors,
  };
}

function allStatusLines(): string[] {
  const lines: string[] = [];
  for (const status of JUDGE_STATUSES) {
    for (const withFinding of [false, true]) {
      for (const ruleErrors of [0, 2]) {
        lines.push(statusLine(resultFor(status, withFinding, ruleErrors)));
      }
    }
  }
  return lines;
}

describe("titles", () => {
  it("has one title per pattern and each starts with Possible", () => {
    expect(Object.keys(JUDGE_TITLES).sort()).toEqual([...JUDGE_PATTERN_IDS].sort());
    for (const pattern of JUDGE_PATTERN_IDS) {
      expect(JUDGE_TITLES[pattern].startsWith("Possible")).toBe(true);
    }
  });

  it("uses the fixed titles of the design", () => {
    expect(JUDGE_TITLES["fake-urgency"]).toBe("Possible fake urgency: deadline wording");
    expect(JUDGE_TITLES["fake-scarcity"]).toBe("Possible fake scarcity: stock wording");
    expect(JUDGE_TITLES["fake-activity"]).toBe(
      "Possible fake activity: shopper activity wording",
    );
    expect(JUDGE_TITLES.confirmshaming).toBe("Possible confirmshaming: decline wording");
    expect(JUDGE_TITLES.preselection).toBe(
      "Possible preselection: option selected in advance",
    );
    expect(JUDGE_TITLES["visual-interference"]).toBe(
      "Possible visual interference: uneven choice",
    );
  });

  it("is the title set of the default templates", () => {
    expect(DEFAULT_TEMPLATES.titles).toBe(JUDGE_TITLES);
  });
});

describe("reason sentences", () => {
  it("has exactly one sentence per reason code", () => {
    expect(Object.keys(REASON_SENTENCES).sort()).toEqual([...REASON_CODES].sort());
  });

  it("writes each as one sentence that ends with a full stop", () => {
    for (const code of REASON_CODES) {
      const sentence = REASON_SENTENCES[code];
      expect(sentence.length).toBeGreaterThan(10);
      expect(sentence.endsWith(".")).toBe(true);
      const terminators = [...sentence].filter((ch) => ".!?".includes(ch));
      expect(terminators).toHaveLength(1);
    }
  });

  it("keeps the two sentences the note gives as examples", () => {
    expect(REASON_SENTENCES["rolling-deadline"]).toBe(
      "The deadline rolls over: it has no calendar date.",
    );
    expect(REASON_SENTENCES["required-terms"]).toBe(
      "This box looks like a required agreement, which is normally ticked by the shopper.",
    );
  });
});

describe("forbidden words", () => {
  it("is false for every title", () => {
    for (const title of Object.values(JUDGE_TITLES)) {
      expect(containsForbidden(title)).toBe(false);
    }
  });

  it("is false for every reason sentence", () => {
    for (const code of REASON_CODES) {
      expect(containsForbidden(REASON_SENTENCES[code])).toBe(false);
    }
  });

  it("is false for every description and evidence text built with a neutral quote", () => {
    for (const code of REASON_CODES) {
      expect(containsForbidden(judgeDescription("Only 2 left", code))).toBe(false);
    }
    expect(containsForbidden(judgeEvidenceText("Only 2 left"))).toBe(false);
  });

  it("is false for every status line, reason template, the heading and the system prompt", () => {
    for (const line of allStatusLines()) expect(containsForbidden(line)).toBe(false);
    for (const reason of Object.values(STATUS_REASONS)) {
      expect(containsForbidden(reason)).toBe(false);
    }
    expect(containsForbidden(DISCLAIMER)).toBe(false);
    expect(containsForbidden(SET_ASIDE_HEADING)).toBe(false);
    expect(containsForbidden(JUDGE_SYSTEM_PROMPT)).toBe(false);
  });

  it("masks a forbidden word of a quote in the description and the evidence text", () => {
    const text = `This is a ${FORBIDDEN_SAMPLE} offer`;
    expect(containsForbidden(text)).toBe(true);
    const description = judgeDescription(text, "pressure-wording");
    const evidence = judgeEvidenceText(text);
    expect(description).toContain("[word omitted]");
    expect(evidence).toContain("[word omitted]");
    expect(description.toLowerCase()).not.toContain(FORBIDDEN_SAMPLE);
    expect(evidence.toLowerCase()).not.toContain(FORBIDDEN_SAMPLE);
    expect(containsForbidden(description)).toBe(false);
    expect(containsForbidden(evidence)).toBe(false);
  });
});

describe("description and evidence text", () => {
  it("states what the page shows, the reason and that nothing was measured", () => {
    const description = judgeDescription("Only 2 left", "vague-low-stock");
    expect(description).toBe(
      `The page shows "Only 2 left". ${REASON_SENTENCES["vague-low-stock"]} A language-model reviewer flagged this; nothing was measured.`,
    );
  });

  it("uses quote(): inner double quotes become single quotes", () => {
    expect(judgeDescription('He said "now"', "pressure-wording")).toContain(
      `"He said 'now'"`,
    );
  });

  it("builds the evidence text from the prefix and the quote", () => {
    expect(JUDGE_EVIDENCE_PREFIX).toBe("Text checked by the reviewer: ");
    expect(judgeEvidenceText("Only 2 left")).toBe(
      'Text checked by the reviewer: "Only 2 left".',
    );
  });

  it("is what the default templates call", () => {
    expect(DEFAULT_TEMPLATES.description("Only 2 left", "vague-low-stock")).toBe(
      judgeDescription("Only 2 left", "vague-low-stock"),
    );
    expect(DEFAULT_TEMPLATES.evidenceText("Only 2 left")).toBe(
      judgeEvidenceText("Only 2 left"),
    );
    expect(DEFAULT_TEMPLATES.reasonSentences).toBe(REASON_SENTENCES);
  });

  it("states no intent: no template says the shop meant or tried to do something", () => {
    const texts = [
      ...Object.values(REASON_SENTENCES),
      ...Object.values(JUDGE_TITLES),
    ].join(" ").toLowerCase();
    for (const word of ["intend", "trick", "deliberate", "on purpose", "manipulat"]) {
      expect(texts).not.toContain(word);
    }
  });
});

describe("set-aside heading", () => {
  it("is the fixed heading", () => {
    expect(SET_ASIDE_HEADING).toBe("Set aside as a likely honest look-alike");
  });
});
