import { describe, it, expect } from "vitest";
import { TITLES } from "@/lib/detectors/shared/finding";
import { buildCandidates, ruleKind } from "@/lib/judge/candidates";
import type { BuiltCandidates } from "@/lib/judge/candidates";
import {
  ANOMALY_FLAGGED_MIN,
  ANOMALY_MAX_FINDINGS,
  MAX_FINDINGS_KEPT,
  MAX_VERDICTS,
} from "@/lib/judge/constants";
import { validateOutput } from "@/lib/judge/validate";
import type { ValidationResult } from "@/lib/judge/validate";
import {
  FLAG_CODES_BY_PATTERN,
  INSUFFICIENT_CONTEXT,
  LOOK_ALIKE_CODES,
} from "@/lib/judge/types";
import type { JudgePatternId } from "@/lib/judge/types";
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

function ruleFinding(
  patternId: JudgePatternId,
  title: string,
  elementIds: string[],
): Finding {
  return {
    patternId,
    confidence: "medium",
    title,
    description: "Description of the rule finding.",
    evidence: { text: "Evidence of the rule finding." },
    elementIds,
    boundingBoxes: elementIds.map(() => ({ x: 0, y: 0, width: 1, height: 1 })),
    explanation: "Explanation.",
    detectorName: patternId,
    detectedAt: SNAPSHOT_CAPTURED_AT,
  };
}

const TEXT_TITLE = TITLES["fake-scarcity"].find(
  (title) => ruleKind(title) === "text",
) as string;
const STRUCTURAL_TITLE = TITLES.preselection[0];
const MEASURED_TITLE = TITLES["visual-interference"][0];

/** The page of most tests: text, a ticked box, an unticked box, a button group, an option and a split claim. */
const PAGE: ElementInput[] = [
  makeText("el-0", "p", "Only 3 left in stock"),
  makeInput("el-1", "checkbox", { checked: true }),
  makeText("el-2", "label", "Add gift wrap for $4.99"),
  makeInput("el-3", "checkbox", { checked: false }),
  makeText("el-4", "label", "Subscribe to the newsletter"),
  makeText("el-5-0", "button", "Yes, save 10% today"),
  makeText("el-5-1", "button", "No thanks, I like paying full price"),
  { id: "el-6", tag: "select", text: "" },
  { id: "el-6-0", tag: "option", text: "Express delivery", selected: true },
  makeText("el-7", "div", "Offer ends soon"),
  makeText("el-7-0", "span", "SALE50"),
];

const RULES: Finding[] = [
  ruleFinding("fake-scarcity", TEXT_TITLE, ["el-0"]),
  ruleFinding("preselection", STRUCTURAL_TITLE, ["el-1"]),
  ruleFinding("visual-interference", MEASURED_TITLE, ["el-5-1"]),
];

function buildPage(): BuiltCandidates {
  return buildCandidates(makeSnapshot(PAGE), RULES);
}

/** The id of the sent candidate whose text holds `needle`. */
function cid(built: BuiltCandidates, needle: string): string {
  const found = built.candidates.find((c) => c.text.includes(needle));
  if (!found) throw new Error(`no candidate holds ${needle}`);
  return found.id;
}

type FindingIn = {
  candidate: string;
  pattern: JudgePatternId;
  quote: string;
  confidence?: Confidence;
  reason: string;
};

type VerdictIn = {
  rule: string;
  decision: "confirm" | "downgrade" | "reject";
  confidence?: Confidence;
  reason: string;
};

function finding(input: FindingIn): Required<FindingIn> {
  return { confidence: "low", ...input };
}

function verdict(input: VerdictIn): Required<VerdictIn> {
  return { confidence: "high", ...input };
}

function respond(
  findings: unknown[],
  verdicts: unknown[] = [],
  stopReason = "end_turn",
): { text: string; stopReason: string } {
  return { text: JSON.stringify({ findings, verdicts }), stopReason };
}

function validate(
  raw: { text: string; stopReason: string },
  built: BuiltCandidates = buildPage(),
  rules: readonly Finding[] = RULES,
): ValidationResult {
  return validateOutput(raw, built.map, rules);
}

function ok(result: ValidationResult) {
  if (result.kind !== "ok") throw new Error("expected an ok result");
  return result;
}

/** A page of `count` short paragraphs with distinct words. */
function wordPage(count: number): { built: BuiltCandidates; texts: string[] } {
  const words = [
    "alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel",
    "india", "juliet", "kilo", "lima", "mike", "november", "oscar", "papa",
    "quebec", "romeo", "sierra", "tango", "uniform", "victor", "whiskey",
    "xray", "yankee", "zulu", "amber", "birch", "cedar", "dune",
  ];
  const texts = Array.from({ length: count }, (_, i) => `Sentence ${words[i]}`);
  const elements = texts.map((text, i) => makeText(`el-${i}`, "p", text));
  return { built: buildCandidates(makeSnapshot(elements), []), texts };
}

function flagOn(built: BuiltCandidates, text: string, pattern: JudgePatternId = "fake-urgency") {
  return finding({
    candidate: cid(built, text),
    pattern,
    quote: text,
    reason: FLAG_CODES_BY_PATTERN[pattern][0],
  });
}

// ---------------------------------------------------------------------------
// Invalid answers (9.1, 9.2)
// ---------------------------------------------------------------------------

describe("validateOutput: invalid answers", () => {
  it("rejects text that is not JSON", () => {
    expect(validate({ text: "this is not json", stopReason: "end_turn" })).toEqual({
      kind: "invalid",
    });
  });

  // Requirement 22.4 (replaces 9.2): a max_tokens answer is invalid and now
  // carries the code `stop-max-tokens`.
  it("rejects truncated JSON with stop reason max_tokens", () => {
    const text = '{"findings":[{"candidate":"c1","pattern":"fake-urgency"';
    expect(validate({ text, stopReason: "max_tokens" })).toEqual({
      kind: "invalid",
      code: "stop-max-tokens",
    });
  });

  it("rejects a complete answer when the stop reason is max_tokens", () => {
    expect(validate(respond([], [], "max_tokens"))).toEqual({
      kind: "invalid",
      code: "stop-max-tokens",
    });
  });

  it("rejects an empty and a blank text", () => {
    expect(validate({ text: "", stopReason: "end_turn" })).toEqual({ kind: "invalid" });
    expect(validate({ text: "  \n ", stopReason: "end_turn" })).toEqual({ kind: "invalid" });
  });

  it("rejects an extra key at any level", () => {
    const built = buildPage();
    const good = finding({
      candidate: cid(built, "Only 3 left"),
      pattern: "fake-scarcity",
      quote: "Only 3 left",
      reason: "vague-low-stock",
    });
    const top = { text: JSON.stringify({ findings: [], verdicts: [], note: "x" }), stopReason: "end_turn" };
    expect(validate(top, built)).toEqual({ kind: "invalid" });
    expect(validate(respond([{ ...good, extra: 1 }]), built)).toEqual({ kind: "invalid" });
    expect(
      validate(respond([], [{ ...verdict({ rule: "r1", decision: "confirm", reason: "vague-low-stock" }), extra: 1 }]), built),
    ).toEqual({ kind: "invalid" });
  });

  it("rejects a wrong enum value and a missing key", () => {
    const built = buildPage();
    const id = cid(built, "Only 3 left");
    const base = { candidate: id, pattern: "fake-scarcity", quote: "Only 3 left", confidence: "low", reason: "vague-low-stock" };
    expect(validate(respond([{ ...base, pattern: "dark-pattern" }]), built)).toEqual({ kind: "invalid" });
    expect(validate(respond([{ ...base, confidence: "certain" }]), built)).toEqual({ kind: "invalid" });
    expect(validate(respond([{ ...base, reason: "neutral-stock-fact" }]), built)).toEqual({ kind: "invalid" });
    expect(validate(respond([{ ...base, candidate: "c61" }]), built)).toEqual({ kind: "invalid" });
    const missing: Record<string, unknown> = { ...base };
    delete missing.quote;
    expect(validate(respond([missing]), built)).toEqual({ kind: "invalid" });
    expect(validate({ text: JSON.stringify({ findings: [] }), stopReason: "end_turn" }, built)).toEqual({ kind: "invalid" });
    expect(
      validate(
        respond([], [{ rule: "r1", decision: "remove", confidence: "high", reason: "neutral-stock-fact" }]),
        built,
      ),
    ).toEqual({ kind: "invalid" });
  });

  it("accepts an empty answer", () => {
    expect(validate(respond([]))).toEqual({
      kind: "ok",
      findings: [],
      verdicts: [],
      anomalies: [],
      returned: 0,
    });
  });
});

// ---------------------------------------------------------------------------
// Stop reasons (22.1 to 22.7)
// ---------------------------------------------------------------------------

describe("validateOutput: stop reasons", () => {
  const PLACEHOLDER_STOP = "placeholder-stop";

  it.each(["end_turn", "stop_sequence"])("goes on to validation for %s (22.1)", (stopReason) => {
    const result = validate(respond([], [], stopReason));
    expect(result.kind).toBe("ok");
  });

  it.each([
    ["refusal", "stop-refusal"],
    ["pause_turn", "stop-pause-turn"],
    ["max_tokens", "stop-max-tokens"],
    ["tool_use", "stop-tool-use"],
    ["", "stop-unknown"],
    [PLACEHOLDER_STOP, "stop-unknown"],
  ])("gives invalid with a code for stop reason %j (22.2 to 22.6)", (stopReason, code) => {
    expect(validate(respond([], [], stopReason))).toStrictEqual({ kind: "invalid", code });
  });

  it("checks the stop reason before the empty-text and parse checks", () => {
    expect(validate({ text: "", stopReason: "refusal" })).toStrictEqual({
      kind: "invalid",
      code: "stop-refusal",
    });
    expect(validate({ text: "not json", stopReason: "pause_turn" })).toStrictEqual({
      kind: "invalid",
      code: "stop-pause-turn",
    });
  });

  it("gives invalid for a refusal whose text is a valid answer with findings and verdicts (22.7)", () => {
    const built = buildPage();
    const flag = finding({
      candidate: cid(built, "Only 3 left"),
      pattern: "fake-scarcity",
      quote: "Only 3 left",
      reason: "vague-low-stock",
    });
    const note = verdict({ rule: "r1", decision: "confirm", reason: "vague-low-stock" });
    expect(validate(respond([flag], [note], "end_turn"), built).kind).toBe("ok");
    expect(validate(respond([flag], [note], "refusal"), built)).toStrictEqual({
      kind: "invalid",
      code: "stop-refusal",
    });
  });

  it("gives invalid with no code for empty text, bad JSON and a schema failure at end_turn", () => {
    expect(validate({ text: "", stopReason: "end_turn" })).toStrictEqual({ kind: "invalid" });
    expect(validate({ text: "{oops", stopReason: "end_turn" })).toStrictEqual({ kind: "invalid" });
    expect(
      validate({ text: JSON.stringify({ findings: "x", verdicts: [] }), stopReason: "end_turn" }),
    ).toStrictEqual({ kind: "invalid" });
  });
});

// ---------------------------------------------------------------------------
// Findings (9.3 to 9.8)
// ---------------------------------------------------------------------------

describe("validateOutput: findings", () => {
  const SCARCITY_OK = (built: BuiltCandidates, quote = "Only 3 left") =>
    finding({
      candidate: cid(built, "Only 3 left"),
      pattern: "fake-scarcity",
      quote,
      reason: "vague-low-stock",
    });

  it("keeps a valid finding with the checked quote", () => {
    const built = buildPage();
    const result = ok(validate(respond([SCARCITY_OK(built)]), built));
    expect(result.findings).toEqual([
      {
        candidate: cid(built, "Only 3 left"),
        pattern: "fake-scarcity",
        quote: "Only 3 left",
        confidence: "low",
        reason: "vague-low-stock",
      },
    ]);
    expect(result.returned).toBe(1);
  });

  it("drops a candidate id beyond those sent", () => {
    const built = buildPage();
    const sent = built.candidates.length;
    const result = ok(
      validate(respond([{ ...SCARCITY_OK(built), candidate: `c${sent + 1}` }]), built),
    );
    expect(result.findings).toEqual([]);
    expect(result.returned).toBe(1);
  });

  it("keeps a quote that is a substring of a part", () => {
    const built = buildPage();
    const split = built.candidates.find((c) => c.text === "Offer ends soon");
    expect(split?.parts).toEqual(["SALE50"]);
    const result = ok(
      validate(
        respond([
          finding({ candidate: (split as { id: string }).id, pattern: "fake-urgency", quote: "SALE50", reason: "pressure-wording" }),
        ]),
        built,
      ),
    );
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].quote).toBe("SALE50");
  });

  it("drops a quote that is in neither the text nor a part", () => {
    const built = buildPage();
    const result = ok(validate(respond([SCARCITY_OK(built, "Only 4 left")]), built));
    expect(result.findings).toEqual([]);
  });

  // Requirement 23.4 (task 18.3): the quote check reads the sent, redacted text.
  // A date stays readable in it and can be quoted; the phone number that stood
  // next to it was replaced, so a quote of the original digits is not found.
  it("checks a quote against the sent text: a date can be quoted, redacted digits cannot", () => {
    const built = buildCandidates(
      makeSnapshot([
        makeText("el-0", "p", "Sale ends 31.12.2025 23:59 call 0532 123 45 67 now"),
      ]),
      [],
    );
    expect(built.candidates[0].text).toBe("Sale ends 31.12.2025 23:59 call [number] now");
    const id = built.candidates[0].id;
    const quoteOf = (quote: string) =>
      finding({ candidate: id, pattern: "fake-urgency", quote, reason: "pressure-wording" });

    const dated = ok(validate(respond([quoteOf("ends 31.12.2025 23:59")]), built, []));
    expect(dated.findings).toHaveLength(1);
    expect(dated.findings[0].quote).toBe("ends 31.12.2025 23:59");

    const sentForm = ok(validate(respond([quoteOf("call [number] now")]), built, []));
    expect(sentForm.findings).toHaveLength(1);

    const original = ok(validate(respond([quoteOf("call 0532 123 45 67")]), built, []));
    expect(original.findings).toEqual([]);
  });

  it("accepts Unicode form and spacing differences and returns the normalised quote", () => {
    const elements = [makeText("el-0", "p", "Caf\u00e9 offer: only 3 left")];
    const built = buildCandidates(makeSnapshot(elements), []);
    const id = built.candidates[0].id;
    const decomposed = finding({
      candidate: id,
      pattern: "fake-scarcity",
      quote: "  Cafe\u0301   offer:\n only  3 left ",
      reason: "vague-low-stock",
    });
    const result = ok(validate(respond([decomposed]), built, []));
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].quote).toBe("Caf\u00e9 offer: only 3 left");
  });

  it("drops a quote that is a URL or markup", () => {
    const built = buildPage();
    for (const quote of [
      "https://shop.example/sale",
      "shop.example://x",
      "<script>alert(1)</script>",
      "<b>Only 3 left</b>",
    ]) {
      const result = ok(validate(respond([SCARCITY_OK(built, quote)]), built));
      expect(result.findings, quote).toEqual([]);
    }
  });

  it("drops a markup quote even when the sent text holds that markup", () => {
    const built = buildCandidates(
      makeSnapshot([makeText("el-0", "p", "Hurry <b>Only 3 left</b> now please")]),
      [],
    );
    const result = ok(
      validate(
        respond([
          finding({ candidate: built.candidates[0].id, pattern: "fake-scarcity", quote: "<b>Only 3 left</b>", reason: "vague-low-stock" }),
        ]),
        built,
        [],
      ),
    );
    expect(result.findings).toEqual([]);
  });

  it("keeps quotes of 3 and 120 characters and drops those of 2 and 121", () => {
    const text = "abcdefghij".repeat(15);
    const built = buildCandidates(makeSnapshot([makeText("el-0", "p", text)]), []);
    const id = built.candidates[0].id;
    expect(built.candidates[0].text).toBe(text);
    const at = (length: number) =>
      finding({ candidate: id, pattern: "fake-urgency", quote: text.slice(0, length), reason: "pressure-wording" });
    for (const [length, kept] of [[2, false], [3, true], [120, true], [121, false]] as const) {
      const result = ok(validate(respond([at(length)]), built, []));
      expect(result.findings.length, `length ${length}`).toBe(kept ? 1 : 0);
    }
  });

  it("drops a quote that is shorter than 3 characters once its spacing is collapsed", () => {
    const built = buildPage();
    const result = ok(validate(respond([SCARCITY_OK(built, "On ")]), built));
    expect(result.findings).toEqual([]);
  });

  describe("structural checks", () => {
    it("keeps preselection on a ticked box and on a selected option", () => {
      const built = buildPage();
      const ticked = finding({
        candidate: cid(built, "gift wrap"),
        pattern: "preselection",
        quote: "Add gift wrap",
        reason: "prechecked-paid-addon",
      });
      const option = finding({
        candidate: cid(built, "Express delivery"),
        pattern: "preselection",
        quote: "Express delivery",
        reason: "preselected-pricier",
      });
      expect(ok(validate(respond([ticked, option]), built)).findings).toHaveLength(2);
    });

    it("drops preselection on an unticked box and on a paragraph", () => {
      const built = buildPage();
      const unticked = finding({
        candidate: cid(built, "newsletter"),
        pattern: "preselection",
        quote: "Subscribe to the newsletter",
        reason: "prechecked-marketing",
      });
      const paragraph = finding({
        candidate: cid(built, "Only 3 left"),
        pattern: "preselection",
        quote: "Only 3 left",
        reason: "prechecked-paid-addon",
      });
      expect(ok(validate(respond([unticked, paragraph]), built)).findings).toEqual([]);
    });

    it("keeps visual interference on a group member and drops it elsewhere", () => {
      const built = buildPage();
      const member = finding({
        candidate: cid(built, "No thanks"),
        pattern: "visual-interference",
        quote: "No thanks",
        reason: "faint-decline",
      });
      const paragraph = finding({
        candidate: cid(built, "Only 3 left"),
        pattern: "visual-interference",
        quote: "Only 3 left",
        reason: "tiny-decline",
      });
      const result = ok(validate(respond([member, paragraph]), built));
      expect(result.findings.map((f) => f.candidate)).toEqual([member.candidate]);
    });
  });

  it("drops a finding whose reason is a flag code of another pattern", () => {
    const built = buildPage();
    const wrong = SCARCITY_OK(built);
    wrong.reason = "pressure-wording";
    expect(ok(validate(respond([wrong]), built)).findings).toEqual([]);
  });

  it("accepts every flag code with its own pattern", () => {
    const { built, texts } = wordPage(1);
    for (const [pattern, codes] of Object.entries(FLAG_CODES_BY_PATTERN)) {
      if (pattern === "preselection" || pattern === "visual-interference") continue;
      for (const code of codes) {
        const result = ok(
          validate(
            respond([finding({ candidate: "c1", pattern: pattern as JudgePatternId, quote: texts[0], reason: code })]),
            built,
            [],
          ),
        );
        expect(result.findings, `${pattern} ${code}`).toHaveLength(1);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Keeping 8 (9.11) and anomalies (9.12, 9.13)
// ---------------------------------------------------------------------------

describe("validateOutput: the 8 kept", () => {
  it("keeps 8 by document position, then pattern id, and returns them in that order", () => {
    const { built, texts } = wordPage(30);
    // Reverse order on the wire: document order is what counts.
    const urgencyOnFirst = flagOn(built, texts[0], "fake-urgency");
    const scarcityOnFirst = flagOn(built, texts[0], "fake-scarcity");
    const others = [8, 7, 6, 5, 4, 3, 2, 1].map((i) => flagOn(built, texts[i]));
    const result = ok(validate(respond([...others, urgencyOnFirst, scarcityOnFirst]), built, []));
    expect(result.returned).toBe(10);
    expect(result.anomalies).toEqual([]);
    expect(result.findings).toHaveLength(MAX_FINDINGS_KEPT);
    expect(result.findings.map((f) => [f.candidate, f.pattern])).toEqual([
      [cid(built, texts[0]), "fake-scarcity"],
      [cid(built, texts[0]), "fake-urgency"],
      ...[1, 2, 3, 4, 5, 6].map((i) => [cid(built, texts[i]), "fake-urgency"]),
    ]);
  });
});

describe("validateOutput: anomalies", () => {
  it("flags more than 12 findings and not 12", () => {
    const { built, texts } = wordPage(30);
    const same = (count: number) =>
      respond(Array.from({ length: count }, () => flagOn(built, texts[0])));
    const twelve = ok(validate(same(ANOMALY_MAX_FINDINGS), built, []));
    expect(twelve.anomalies).toEqual([]);
    const thirteen = ok(validate(same(ANOMALY_MAX_FINDINGS + 1), built, []));
    expect(thirteen.anomalies).toEqual(["too-many-findings"]);
    expect(thirteen.returned).toBe(13);
    expect(thirteen.findings).toHaveLength(MAX_FINDINGS_KEPT);
  });

  it("counts findings before any drop", () => {
    const { built } = wordPage(30);
    const junk = Array.from({ length: 13 }, () =>
      finding({ candidate: "c60", pattern: "fake-urgency", quote: "nothing", reason: "pressure-wording" }),
    );
    const result = ok(validate(respond(junk), built, []));
    expect(result.findings).toEqual([]);
    expect(result.anomalies).toEqual(["too-many-findings"]);
  });

  it("flags more than half of the candidates when at least 6 are flagged", () => {
    const { built, texts } = wordPage(10);
    const flag = (count: number) =>
      respond(texts.slice(0, count).map((text) => flagOn(built, text)));
    const five = ok(validate(flag(5), built, []));
    expect(five.anomalies).toEqual([]);
    const six = ok(validate(flag(ANOMALY_FLAGGED_MIN), built, []));
    expect(six.anomalies).toEqual(["too-many-flagged"]);
    expect(six.findings).toHaveLength(6);
  });

  it("needs at least 6 flagged candidates even when they are over half", () => {
    const { built, texts } = wordPage(4);
    const result = ok(
      validate(respond(texts.slice(0, 3).map((text) => flagOn(built, text))), built, []),
    );
    expect(result.anomalies).toEqual([]);
  });

  it("does not count dropped findings or repeated candidates as flagged", () => {
    const { built, texts } = wordPage(10);
    const valid = texts.slice(0, 5).map((text) => flagOn(built, text));
    const repeated = flagOn(built, texts[0]);
    const dropped = finding({ candidate: cid(built, texts[6]), pattern: "fake-urgency", quote: "nothing", reason: "pressure-wording" });
    const result = ok(validate(respond([...valid, repeated, dropped]), built, []));
    expect(result.anomalies).toEqual([]);
  });

  it("reports both anomalies when both apply", () => {
    const { built, texts } = wordPage(10);
    const findings = [...texts, ...texts.slice(0, 3)].map((text) => flagOn(built, text));
    const result = ok(validate(respond(findings), built, []));
    expect(result.anomalies).toEqual(["too-many-findings", "too-many-flagged"]);
  });
});

// ---------------------------------------------------------------------------
// Verdicts (9.3, 9.9, 9.10)
// ---------------------------------------------------------------------------

describe("validateOutput: verdicts", () => {
  const verdicts = (...list: VerdictIn[]) => respond([], list.map(verdict));
  const kept = (...list: VerdictIn[]) => ok(validate(verdicts(...list))).verdicts;

  it("keeps a valid verdict with its fields", () => {
    expect(
      kept({ rule: "r1", decision: "reject", confidence: "high", reason: "neutral-stock-fact" }),
    ).toEqual([
      { rule: "r1", decision: "reject", confidence: "high", reason: "neutral-stock-fact" },
    ]);
  });

  it("drops a rule id beyond those sent", () => {
    expect(
      kept(
        { rule: "r4", decision: "reject", reason: "neutral-stock-fact" },
        { rule: "r20", decision: "reject", reason: "neutral-stock-fact" },
      ),
    ).toEqual([]);
  });

  it("applies the reason family of each decision against the rule's pattern", () => {
    // r1 is a fake-scarcity rule finding.
    const cases: Array<[VerdictIn["decision"], string, boolean]> = [
      ["reject", "neutral-stock-fact", true],
      ["reject", "dated-deadline", true],
      ["reject", "vague-low-stock", false],
      ["reject", INSUFFICIENT_CONTEXT, false],
      ["confirm", "vague-low-stock", true],
      ["confirm", "selling-fast-claim", true],
      ["confirm", "pressure-wording", false],
      ["confirm", "neutral-stock-fact", false],
      ["confirm", INSUFFICIENT_CONTEXT, false],
      ["downgrade", "neutral-stock-fact", true],
      ["downgrade", "vague-low-stock", true],
      ["downgrade", INSUFFICIENT_CONTEXT, true],
      ["downgrade", "pressure-wording", false],
    ];
    for (const [decision, reason, expected] of cases) {
      expect(kept({ rule: "r1", decision, reason }).length, `${decision} ${reason}`).toBe(
        expected ? 1 : 0,
      );
    }
  });

  it("uses the pattern of each rule finding", () => {
    // r2 is a preselection rule finding, r3 a visual-interference one.
    expect(kept({ rule: "r2", decision: "confirm", reason: "prechecked-paid-addon" })).toHaveLength(1);
    expect(kept({ rule: "r2", decision: "confirm", reason: "faint-decline" })).toHaveLength(0);
    expect(kept({ rule: "r3", decision: "confirm", reason: "faint-decline" })).toHaveLength(1);
    expect(kept({ rule: "r3", decision: "downgrade", reason: "prechecked-paid-addon" })).toHaveLength(0);
  });

  it("accepts every look-alike code on a reject", () => {
    for (const code of LOOK_ALIKE_CODES) {
      expect(kept({ rule: "r1", decision: "reject", reason: code }), code).toHaveLength(1);
    }
  });

  it("ignores a verdict whose rule finding is unknown to the caller", () => {
    const built = buildPage();
    const result = ok(
      validate(verdicts({ rule: "r1", decision: "reject", reason: "neutral-stock-fact" }), built, []),
    );
    expect(result.verdicts).toEqual([]);
  });

  it("keeps the first verdict of a repeated rule id", () => {
    const result = kept(
      { rule: "r1", decision: "reject", reason: "neutral-stock-fact" },
      { rule: "r1", decision: "confirm", reason: "vague-low-stock" },
      { rule: "r2", decision: "confirm", reason: "prechecked-paid-addon" },
    );
    expect(result.map((v) => [v.rule, v.decision])).toEqual([
      ["r1", "reject"],
      ["r2", "confirm"],
    ]);
  });

  it("lets the first verdict of a rule id win even when its reason is ignored", () => {
    expect(
      kept(
        { rule: "r1", decision: "reject", reason: "vague-low-stock" },
        { rule: "r1", decision: "reject", reason: "neutral-stock-fact" },
      ),
    ).toEqual([]);
  });

  it("reads at most 20 verdicts", () => {
    const list: VerdictIn[] = Array.from({ length: MAX_VERDICTS }, () => ({
      rule: "r1",
      decision: "downgrade",
      reason: "neutral-stock-fact",
    }));
    list.push({ rule: "r2", decision: "confirm", reason: "prechecked-paid-addon" });
    const result = kept(...list);
    expect(result.map((v) => v.rule)).toEqual(["r1"]);
  });

  it("does not make a verdict count as an anomaly", () => {
    const result = ok(
      validate(verdicts({ rule: "r1", decision: "reject", reason: "neutral-stock-fact" })),
    );
    expect(result.anomalies).toEqual([]);
  });
});
