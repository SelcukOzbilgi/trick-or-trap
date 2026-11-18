import { describe, it, expect } from "vitest";
import type { Confidence, Finding, PatternId } from "@/lib/types";
import { ENTRY_MAP, entriesOfVariant, nodesOf } from "@/tests/detectors/eval/helpers/entry-map";
import { formatTable, recallOf, score } from "@/tests/detectors/eval/helpers/score";
import type { VariantFindings } from "@/tests/detectors/eval/helpers/score";

// ── Synthetic inputs ───────────────────────────────────────────────────────

/** Every variant id that the entry map mentions. */
const VARIANT_IDS: readonly string[] = [
  ...new Set(Object.values(ENTRY_MAP).flatMap((mapping) => mapping.variants)),
];

/** Node key to id for a variant: each key of the entry map gets an id of its own. */
function keyToIdOf(variantId: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const { id } of entriesOfVariant(variantId)) {
    for (const key of nodesOf(id)) {
      if (!map.has(key)) map.set(key, `el-1-${map.size + 1}`);
    }
  }
  return map;
}

function idOf(variantId: string, key: string): string {
  const id = keyToIdOf(variantId).get(key);
  if (id === undefined) throw new Error(`No node "${key}" in variant "${variantId}".`);
  return id;
}

function finding(
  patternId: PatternId,
  confidence: Confidence,
  elementIds: readonly string[],
  title = `Possible ${patternId}`,
): Finding {
  return {
    patternId,
    confidence,
    title,
    description: "A description.",
    evidence: { text: "Some evidence." },
    elementIds: [...elementIds],
    boundingBoxes: elementIds.map(() => ({ x: 0, y: 0, width: 10, height: 10 })),
    explanation: "An explanation.",
    detectorName: patternId,
    detectedAt: "2026-12-01T12:00:00.000Z",
  };
}

/** All variants with no finding, except the given ones. */
function inputs(findings: Readonly<Record<string, readonly Finding[]>> = {}): VariantFindings[] {
  return VARIANT_IDS.map((variantId) => ({
    variantId,
    keyToId: keyToIdOf(variantId),
    findings: findings[variantId] ?? [],
  }));
}

function rowOf(result: ReturnType<typeof score>, entryId: string) {
  const row = result.rows.find((candidate) => candidate.entryId === entryId);
  if (row === undefined) throw new Error(`No row for ${entryId}.`);
  return row;
}

/** One finding per flag entry of its primary variant, right pattern, on the entry's primary node. */
function perfectFindings(skip: readonly string[] = []): Record<string, Finding[]> {
  const byVariant: Record<string, Finding[]> = {};
  for (const [entryId, mapping] of Object.entries(ENTRY_MAP)) {
    if (skip.includes(entryId)) continue;
    const pattern = FLAG_PATTERNS[entryId];
    if (pattern === undefined) continue;
    const variantId = mapping.variants[0];
    (byVariant[variantId] ??= []).push(finding(pattern, "medium", [idOf(variantId, mapping.primary)]));
  }
  return byVariant;
}

/** Pattern of each flag entry (the same values as the fixture; stated here so the unit test needs no fixture). */
const FLAG_PATTERNS: Readonly<Record<string, PatternId>> = {
  "home-hero-countdown-restart": "fake-urgency",
  "home-rolling-midnight-text": "fake-urgency",
  "home-cookie-accept-dominant": "visual-interference",
  "home-cookie-ghost-reject": "visual-interference",
  "product-low-stock-random": "fake-scarcity",
  "product-viewers-random": "fake-activity",
  "product-selling-fast-badge": "fake-scarcity",
  "product-almost-gone-tiny": "fake-scarcity",
  "product-sold-toast": "fake-activity",
  "product-upsell-modal-tiny-close": "visual-interference",
  "cart-protection-prechecked": "preselection",
  "cart-warranty-radio-preselected": "preselection",
  "cart-packaging-switch-on": "preselection",
  "checkout-newsletter-prechecked": "preselection",
  "club-modal-hate-saving": "confirmshaming",
  "club-modal-full-price-mortal": "confirmshaming",
  "club-modal-no-need-protection": "confirmshaming",
  "club-timer-session-restart": "fake-urgency",
  "newsletter-partners-prechecked": "preselection",
};

// ── Tests ──────────────────────────────────────────────────────────────────

describe("score: rows", () => {
  it("has one row per scored entry: 19 flag and 8 look-alike", () => {
    const result = score(inputs());
    expect(result.rows).toHaveLength(27);
    expect(result.rows.filter((row) => row.expected === "flag")).toHaveLength(19);
    expect(result.rows.filter((row) => row.expected === "no-flag")).toHaveLength(8);
    expect(result.rows.every((row) => row.result === "miss" || row.result === "ok")).toBe(true);
  });

  it("counts a finding with the right pattern on a node of the entry as a hit, and keeps its confidence", () => {
    const node = idOf("home-default-equal", "hero-countdown");
    const result = score(inputs({ "home-default-equal": [finding("fake-urgency", "medium", [node])] }));
    const row = rowOf(result, "home-hero-countdown-restart");
    expect(row.result).toBe("hit");
    expect(row.confidences).toEqual(["medium"]);
    expect(row.pattern).toBe("fake-urgency");
    expect(row.expected).toBe("flag");
    expect(result.unplanted).toEqual([]);
  });

  it("counts a finding on a related node (the label or the accept control) as a hit", () => {
    const result = score(
      inputs({ "home-default-equal": [finding("visual-interference", "high", [idOf("home-default-equal", "cookie-accept")])] }),
    );
    expect(rowOf(result, "home-cookie-accept-dominant").result).toBe("hit");
  });

  it("counts a wrong pattern on the entry's node as a miss, and lists the finding as unplanted", () => {
    const node = idOf("home-default-equal", "hero-countdown");
    const result = score(inputs({ "home-default-equal": [finding("fake-scarcity", "low", [node])] }));
    expect(rowOf(result, "home-hero-countdown-restart").result).toBe("miss");
    expect(result.unplanted).toHaveLength(1);
    expect(result.unplanted[0].patternId).toBe("fake-scarcity");
  });

  it("counts a finding on a node of another entry as a miss for this entry", () => {
    const node = idOf("home-default-equal", "rolling-midnight");
    const result = score(inputs({ "home-default-equal": [finding("fake-urgency", "low", [node])] }));
    expect(rowOf(result, "home-hero-countdown-restart").result).toBe("miss");
    expect(rowOf(result, "home-rolling-midnight-text").result).toBe("hit");
  });

  it("counts a finding on a look-alike node as a false positive, whatever its pattern", () => {
    const node = idOf("home-default-equal", "fixed-date-sale");
    const result = score(inputs({ "home-default-equal": [finding("fake-urgency", "low", [node])] }));
    const row = rowOf(result, "home-fixed-date-sale");
    expect(row.result).toBe("false-positive");
    expect(row.confidences).toEqual(["low"]);
    expect(result.falsePositives).toBe(1);
    expect(result.unplanted).toEqual([]);
    const urgency = result.detectors.find((detector) => detector.pattern === "fake-urgency");
    expect(urgency?.falsePositives).toBe(1);
  });

  it("counts any finding on a whole-page look-alike page as a false positive", () => {
    const stray = finding("preselection", "low", ["el-1-77"]);
    const checkout = score(inputs({ "checkout-honest": [stray] }));
    expect(rowOf(checkout, "checkout-consistent-shipping-tax").result).toBe("false-positive");
    const account = score(inputs({ "account-honest": [finding("visual-interference", "low", ["el-1-5"])] }));
    expect(rowOf(account, "account-one-click-cancel-plan").result).toBe("false-positive");
    expect(account.unplanted).toEqual([]);
  });

  it("ignores flow-pattern findings: no hit, no false positive, no unplanted entry", () => {
    const stray = finding("drip-pricing", "high", ["el-1-77"]);
    const result = score(
      inputs({
        "checkout-honest": [stray],
        "account-honest": [finding("hard-to-cancel", "high", ["el-1-5"])],
        cart: [finding("sneak-into-basket", "medium", ["el-1-9"])],
      }),
    );
    expect(result.falsePositives).toBe(0);
    expect(result.unplanted).toEqual([]);
    expect(result.ignoredFlowFindings).toBe(3);
    expect(rowOf(result, "checkout-consistent-shipping-tax").result).toBe("ok");
  });

  it("lists a finding that matches no entry as unplanted, with its confidence and variant", () => {
    const result = score(inputs({ cart: [finding("preselection", "medium", ["el-1-999"], "Possible preselection: x")] }));
    expect(result.unplanted).toEqual([
      {
        variantId: "cart",
        patternId: "preselection",
        confidence: "medium",
        title: "Possible preselection: x",
        elementIds: ["el-1-999"],
      },
    ]);
  });

  it("takes the primary variant of an entry by default and the last one with pairs: secondary", () => {
    const increase = idOf("home-default-increase", "hero-countdown");
    const found = inputs({ "home-default-increase": [finding("fake-urgency", "high", [increase])] });
    expect(rowOf(score(found), "home-hero-countdown-restart").result).toBe("miss");
    expect(rowOf(score(found, { pairs: "secondary" }), "home-hero-countdown-restart").result).toBe("hit");
    expect(rowOf(score(found, { pairs: "secondary" }), "home-hero-countdown-restart").confidences).toEqual(["high"]);
  });

  it("does not count a finding of the secondary variant as unplanted", () => {
    const increase = idOf("home-default-increase", "hero-countdown");
    const found = inputs({ "home-default-increase": [finding("fake-urgency", "high", [increase])] });
    expect(score(found).unplanted).toEqual([]);
  });

  it("throws when a variant is missing from the input", () => {
    expect(() => score(inputs().filter((item) => item.variantId !== "cart"))).toThrow(/cart/);
  });
});

describe("score: detector summary and recall", () => {
  it("summarises found, missed and false positives per static detector", () => {
    const result = score(inputs(perfectFindings(["home-rolling-midnight-text"])));
    const urgency = result.detectors.find((detector) => detector.pattern === "fake-urgency");
    expect(urgency).toMatchObject({ flagEntries: 3, found: 2, missed: 1, falsePositives: 0 });
    expect(result.detectors.map((detector) => detector.pattern)).toEqual([
      "fake-urgency",
      "fake-scarcity",
      "fake-activity",
      "confirmshaming",
      "preselection",
      "visual-interference",
    ]);
  });

  it("recallOf counts hits over the 19 flag entries", () => {
    expect(recallOf(score(inputs()))).toBe(0);
    expect(recallOf(score(inputs(perfectFindings())))).toBe(1);
    const three = score(
      inputs(
        perfectFindings(Object.keys(FLAG_PATTERNS).filter((id) => !["cart-protection-prechecked", "club-modal-hate-saving", "product-sold-toast"].includes(id))),
      ),
    );
    expect(three.hits).toBe(3);
    expect(recallOf(three)).toBeCloseTo(3 / 19, 10);
  });
});

describe("formatTable", () => {
  it("lists every entry with expected verdict, confidences and result, plus recall and unplanted findings", () => {
    const stray = finding("preselection", "medium", ["el-1-999"], "Possible preselection: stray");
    const planted = perfectFindings(["cart-protection-prechecked"]);
    planted.cart = [...(planted.cart ?? []), stray];
    const result = score(inputs(planted));
    const table = formatTable(result);
    for (const row of result.rows) expect(table).toContain(row.entryId);
    expect(table).toContain("hit");
    expect(table).toContain("miss");
    expect(table).toContain("ok");
    expect(table).toContain("medium");
    expect(table).toContain("Possible preselection: stray");
    expect(table).toContain("Recall");
    expect(table).toContain("18/19");
    expect(table).toContain("fake-urgency");
  });

  it("shows false positives and the ignored flow-pattern count", () => {
    const result = score(
      inputs({
        "home-default-equal": [finding("fake-urgency", "low", [idOf("home-default-equal", "fixed-date-sale")])],
        "checkout-honest": [finding("drip-pricing", "high", ["el-1-1"])],
      }),
    );
    const table = formatTable(result);
    expect(table).toContain("false-positive");
    expect(table).toContain("home-fixed-date-sale");
    expect(table).toMatch(/Flow-pattern findings ignored: 1/);
  });
});
