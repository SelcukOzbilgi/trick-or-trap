import { describe, it, expect } from "vitest";
import { PageSnapshotSchema } from "@/lib/types";
import type { Confidence, Finding, PatternId } from "@/lib/types";
import { HOLDOUT_CASES } from "@/tests/detectors/eval/helpers/holdout-cases";
import type { HoldoutCase } from "@/tests/detectors/eval/helpers/holdout-cases";
import {
  REVIEW_BASELINE_LINE,
  buildHoldoutSnapshot,
  formatHoldoutTable,
  scoreHoldout,
} from "@/tests/detectors/eval/helpers/holdout";
import type { CaseRun } from "@/tests/detectors/eval/helpers/holdout";
import { assertNoTestHooks } from "@/tests/detectors/eval/helpers/no-hooks";
import { BASE_TIME, RELOAD_TIME } from "@/tests/detectors/eval/helpers/pages";

/**
 * Requirement 4.1 to 4.3, 4.7, 4.8, 4.10: the case table of design section 13 and the
 * scoring of the hold-out, checked with synthetic findings. The detectors are not run here.
 */

const FLAG_TEXTS: readonly string[] = [
  "Hurry! Only 3 left in stock",
  "Tükenmek üzere!",
  "Son 3 ürün!",
  "Stokta son 2 adet",
  "Selling fast",
  "Almost gone!",
  "Stokta son ürünler",
  "Only <span>3</span> left in stock",
  "12 people are looking at this right now",
  "İstanbul'dan Ayşe az önce satın aldı",
  "5 people have this in their cart",
  "Sarah in London purchased a Blue Dress 5 minutes ago",
  "23 kişi şu an bakıyor",
  "Bu ürünü şu anda 15 kişi inceliyor",
  "Sale ends tonight!",
  "Deal ends today",
  "Offer ends in 02:14:33",
  "Kampanya gece yarısı bitiyor, kaçırmayın!",
  "Fırsatı kaçırma! Kampanya bitimine 01:59:59",
  "Offer ends in <span>02</span>:<span>14</span>:<span>33</span>",
  "No thanks, I don't like free stuff",
  "No, I prefer paying full price",
  "Hayır, indirim istemiyorum",
  "Hayır, indirimleri kaçırmak istiyorum",
  "Add shipping insurance for $2.99",
  "email me offers and promotions",
  "Kampanyalardan e-posta ile haberdar olmak istiyorum",
  "Ürün koruma paketi ekle +49,90 TL",
];

const HONEST_TEXTS: readonly string[] = [
  "Only 3 left in stock",
  "Only 5 m left",
  "Only 1 M left",
  "Winter sale ends 28 February 2027",
  "3 in stock",
  "Stokta 3 adet",
  "Accept all / Reject all",
  "No thanks",
  "Hayır, teşekkürler",
  "Subscribe to our newsletter",
  "Bültenimize abone ol",
  "I agree to the Terms",
  "Mesafeli satış sözleşmesini okudum ve kabul ediyorum",
  "Order within 2h 15m for next-day delivery",
  "4.8 (1,203 reviews)",
  "Kış indirimi 28 Şubat 2027'de sona eriyor",
  "Sepetinizde 2 ürün var",
  "Saat 14:00'e kadar verilen siparişler aynı gün kargoda",
  "Standard shipping $4.99",
  "Free returns within 30 days",
];

const EXTRA_TEXTS: readonly string[] = [
  "Free returns within 30 days",
  "Battery life 12 hours",
  "Video 12:34",
  "Ready in 15 min",
  "Delivery in 2 days · 20% off",
  "Accept all / Reject all",
  "Only 2 days left",
  "Offer ends in 02:14:33",
];

const SHAPES: readonly string[] = [
  "single",
  "split-span",
  "split-countdown",
  "inflected-tr",
  "reload-pair",
  "form-control",
  "banner",
];

function group(name: HoldoutCase["group"]): HoldoutCase[] {
  return HOLDOUT_CASES.filter((c) => c.group === name);
}

function caseById(id: string): HoldoutCase {
  const found = HOLDOUT_CASES.find((c) => c.id === id);
  if (found === undefined) throw new Error(`No hold-out case ${id}.`);
  return found;
}

function finding(patternId: PatternId, confidence: Confidence, elementIds: string[]): Finding {
  return {
    patternId,
    confidence,
    title: "Possible synthetic finding",
    description: "Synthetic.",
    evidence: { text: "Synthetic." },
    elementIds,
    boundingBoxes: [],
    explanation: "Synthetic.",
    detectorName: "synthetic",
    detectedAt: BASE_TIME,
  };
}

/** A run of one case with the given findings, built on the case's real node ids. */
function runOf(c: HoldoutCase, make: (nodeId: string) => Finding[]): CaseRun {
  const { keyToId } = buildHoldoutSnapshot(c);
  const nodeId = keyToId.get(c.node);
  if (nodeId === undefined) throw new Error(`Case ${c.id} has no node ${c.node}.`);
  return { caseId: c.id, findings: make(nodeId), errorCount: 0, errorMessages: [], keyToId };
}

function emptyRun(c: HoldoutCase): CaseRun {
  return runOf(c, () => []);
}

describe("hold-out case table (4.1, 4.2)", () => {
  it("has 28 flag cases, 20 honest cases and 8 extras", () => {
    expect(group("flag")).toHaveLength(28);
    expect(group("honest")).toHaveLength(20);
    expect(group("extra")).toHaveLength(8);
    expect(HOLDOUT_CASES).toHaveLength(56);
  });

  it("has unique ids", () => {
    const ids = HOLDOUT_CASES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("uses the texts of design section 13, word for word", () => {
    expect(group("flag").map((c) => c.text).sort()).toEqual([...FLAG_TEXTS].sort());
    expect(group("honest").map((c) => c.text).sort()).toEqual([...HONEST_TEXTS].sort());
    expect(group("extra").map((c) => c.text).sort()).toEqual([...EXTRA_TEXTS].sort());
  });

  it("gives a pattern to every flag case and to none of the honest cases", () => {
    for (const c of group("flag")) expect(c.pattern, c.id).toBeDefined();
    for (const c of group("honest")) expect(c.pattern, c.id).toBeUndefined();
  });

  it("splits the 28 by pattern as the review did", () => {
    const count = (pattern: PatternId) => group("flag").filter((c) => c.pattern === pattern).length;
    expect(count("fake-scarcity")).toBe(8);
    expect(count("fake-activity")).toBe(6);
    expect(count("fake-urgency")).toBe(6);
    expect(count("confirmshaming")).toBe(4);
    expect(count("preselection")).toBe(4);
  });

  it("has two flag extras and six honest extras", () => {
    expect(group("extra").filter((c) => c.pattern !== undefined)).toHaveLength(2);
    expect(group("extra").filter((c) => c.pattern === undefined)).toHaveLength(6);
  });

  it("uses only the named markup shapes and the two languages", () => {
    for (const c of HOLDOUT_CASES) {
      expect(SHAPES, c.id).toContain(c.shape);
      expect(["en", "tr"], c.id).toContain(c.language);
    }
  });

  it("marks the two split cases and the counting-up extra as known misses (4.8)", () => {
    const known = HOLDOUT_CASES.filter((c) => c.knownMiss !== undefined).map((c) => c.shape + ":" + c.text);
    expect(known.sort()).toEqual(
      [
        "split-span:Only <span>3</span> left in stock",
        "split-countdown:Offer ends in <span>02</span>:<span>14</span>:<span>33</span>",
        "reload-pair:Offer ends in 02:14:33",
      ].sort()
    );
  });
});

describe("hold-out snapshots (4.3, 4.10)", () => {
  it.each(HOLDOUT_CASES.map((c) => [c.id, c] as const))("%s builds a valid snapshot without test hooks", (_id, c) => {
    const { snapshot, keyToId } = buildHoldoutSnapshot(c);
    expect(PageSnapshotSchema.safeParse(snapshot).success).toBe(true);
    expect(() => assertNoTestHooks(snapshot)).not.toThrow();
    expect(snapshot.capturedAt).toBe(BASE_TIME);
    expect(keyToId.has(c.node)).toBe(true);
    expect(snapshot.elements.length).toBeGreaterThan(0);
  });

  it("gives a reload sample 9 seconds after the first to every reload case", () => {
    const withReload = HOLDOUT_CASES.filter((c) => c.reload !== undefined);
    expect(withReload.length).toBeGreaterThan(0);
    for (const c of withReload) {
      const { snapshot } = buildHoldoutSnapshot(c);
      expect(snapshot.afterReload?.capturedAt, c.id).toBe(RELOAD_TIME);
      expect(Date.parse(RELOAD_TIME) - Date.parse(BASE_TIME)).toBe(9_000);
      expect(snapshot.afterReload?.capture?.light, c.id).toBe(true);
    }
  });

  it("builds no reload sample for a case without one", () => {
    for (const c of HOLDOUT_CASES.filter((x) => x.reload === undefined)) {
      expect(buildHoldoutSnapshot(c).snapshot.afterReload, c.id).toBeUndefined();
    }
  });

  it("writes the split cases as the extractor delivers them (own text only)", () => {
    const span = caseById("scarcity-only-3-split-span");
    const spanTexts = buildHoldoutSnapshot(span).snapshot.elements.map((e) => e.text);
    expect(spanTexts).toContain("Only left in stock");
    expect(spanTexts).toContain("3");
    const countdown = caseById("urgency-offer-split-countdown");
    const countdownTexts = buildHoldoutSnapshot(countdown).snapshot.elements.map((e) => e.text);
    expect(countdownTexts).toContain("Offer ends in : :");
    for (const part of ["02", "14", "33"]) expect(countdownTexts).toContain(part);
  });
});

describe("scoreHoldout (4.4, 4.7, 4.8)", () => {
  const flagCase = caseById("scarcity-selling-fast");
  const honestCase = caseById("honest-only-3-same-after-reload");
  const splitCase = caseById("scarcity-only-3-split-span");

  function scoreOf(runs: CaseRun[]) {
    const cases = [flagCase, honestCase, splitCase];
    return scoreHoldout(cases, runs);
  }

  it("counts a hit when a finding has the case's pattern and the case node", () => {
    const score = scoreOf([
      runOf(flagCase, (id) => [finding("fake-scarcity", "low", [id])]),
      emptyRun(honestCase),
      emptyRun(splitCase),
    ]);
    expect(score.flag.hits).toBe(1);
    expect(score.outcomes.find((o) => o.id === flagCase.id)?.hit).toBe(true);
    expect(score.outcomes.find((o) => o.id === flagCase.id)?.confidence).toBe("low");
  });

  it("counts a hit when the finding names a child of the case node", () => {
    const score = scoreOf([
      runOf(flagCase, (id) => [finding("fake-scarcity", "medium", [`${id}-0`])]),
      emptyRun(honestCase),
      emptyRun(splitCase),
    ]);
    expect(score.flag.hits).toBe(1);
  });

  it("is not a hit with another pattern, or with another node", () => {
    const score = scoreOf([
      runOf(flagCase, (id) => [
        finding("fake-activity", "high", [id]),
        finding("fake-scarcity", "high", ["el-9-9"]),
      ]),
      emptyRun(honestCase),
      emptyRun(splitCase),
    ]);
    expect(score.flag.hits).toBe(0);
    expect(score.flag.missedIds).toContain(flagCase.id);
  });

  it("does not treat a sibling id with the same prefix as a child", () => {
    const score = scoreOf([
      runOf(flagCase, (id) => [finding("fake-scarcity", "low", [`${id}0`])]),
      emptyRun(honestCase),
      emptyRun(splitCase),
    ]);
    expect(score.flag.hits).toBe(0);
  });

  it("lists a missed known-miss case apart, with its reason", () => {
    const score = scoreOf([emptyRun(flagCase), emptyRun(honestCase), emptyRun(splitCase)]);
    expect(score.flag.missedIds).toEqual([flagCase.id, splitCase.id]);
    expect(score.flag.knownMissIds).toEqual([splitCase.id]);
    expect(score.outcomes.find((o) => o.id === splitCase.id)?.knownMiss).toBe(splitCase.knownMiss);
  });

  it("records a false positive of an honest case with its highest confidence", () => {
    const score = scoreOf([
      emptyRun(flagCase),
      runOf(honestCase, (id) => [
        finding("fake-scarcity", "low", [id]),
        finding("fake-scarcity", "high", [id]),
      ]),
      emptyRun(splitCase),
    ]);
    expect(score.honest.falsePositiveIds).toEqual([honestCase.id]);
    expect(score.honest.byConfidence).toEqual({ low: 0, medium: 0, high: 1 });
  });

  it("splits false positives by confidence", () => {
    const other = caseById("honest-only-5-m-left");
    const third = caseById("honest-free-returns");
    const score = scoreHoldout(
      [honestCase, other, third],
      [
        runOf(honestCase, (id) => [finding("fake-scarcity", "low", [id])]),
        runOf(other, (id) => [finding("fake-scarcity", "medium", [id])]),
        emptyRun(third),
      ]
    );
    expect(score.honest.total).toBe(3);
    expect(score.honest.falsePositiveIds).toEqual([honestCase.id, other.id]);
    expect(score.honest.byConfidence).toEqual({ low: 1, medium: 1, high: 0 });
  });

  it("scores the extras apart from the 28 and the 20", () => {
    const extraFlag = caseById("extra-only-2-days-left");
    const extraHonest = caseById("extra-video-under-sale");
    const score = scoreHoldout(
      [extraFlag, extraHonest],
      [
        runOf(extraFlag, (id) => [finding("fake-urgency", "low", [id])]),
        runOf(extraHonest, (id) => [finding("fake-urgency", "low", [id])]),
      ]
    );
    expect(score.flag.total).toBe(0);
    expect(score.honest.total).toBe(0);
    expect(score.extraFlag.hits).toBe(1);
    expect(score.extraHonest.falsePositiveIds).toEqual([extraHonest.id]);
  });

  it("reports recall as hits over the flag cases", () => {
    const second = caseById("scarcity-almost-gone");
    const score = scoreHoldout(
      [flagCase, second],
      [runOf(flagCase, (id) => [finding("fake-scarcity", "low", [id])]), emptyRun(second)]
    );
    expect(score.flag.recall).toBe(0.5);
  });

  it("counts detector errors of every run", () => {
    const failing: CaseRun = { ...emptyRun(flagCase), errorCount: 2, errorMessages: ["a", "b"] };
    expect(scoreHoldout([flagCase], [failing]).errorCount).toBe(2);
  });

  it("throws when a case has no run", () => {
    expect(() => scoreHoldout([flagCase], [])).toThrow();
  });
});

describe("formatHoldoutTable (4.5)", () => {
  const flagCase = caseById("scarcity-selling-fast");
  const splitCase = caseById("scarcity-only-3-split-span");
  const honestCase = caseById("honest-only-3-same-after-reload");

  const table = formatHoldoutTable(
    scoreHoldout(
      [flagCase, splitCase, honestCase],
      [
        runOf(flagCase, (id) => [finding("fake-scarcity", "low", [id])]),
        emptyRun(splitCase),
        runOf(honestCase, (id) => [finding("fake-scarcity", "medium", [id])]),
      ]
    )
  );

  it("names the review baseline", () => {
    expect(REVIEW_BASELINE_LINE).toBe("Review baseline (c21325f): 18/28 hits, 3/20 false positives");
    expect(table).toContain(REVIEW_BASELINE_LINE);
  });

  it("lists hits with their confidence, misses with the knownMiss reason and false positives", () => {
    expect(table).toContain(flagCase.id);
    expect(table).toContain("low");
    expect(table).toContain(splitCase.id);
    expect(table).toContain("knownMiss");
    expect(table).toContain(splitCase.knownMiss as string);
    expect(table).toContain(honestCase.id);
    expect(table).toContain("medium");
  });

  it("prints a block for each group", () => {
    expect(table).toContain("Flag cases");
    expect(table).toContain("Honest cases");
    expect(table).toContain("Extras");
  });
});
