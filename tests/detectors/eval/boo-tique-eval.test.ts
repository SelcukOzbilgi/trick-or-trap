import { describe, it, expect, beforeAll } from "vitest";
import { runAllDetectors } from "@/lib/detectors/all";
import { FORBIDDEN_WORDS } from "@/lib/detectors/data/forbidden-words";
import { normaliseText } from "@/lib/detectors/shared/text";
import type { Finding } from "@/lib/types";
import { loadFixture } from "@/tests/boo-tique/helpers/fixture";
import { assertNoTestHooks } from "@/tests/detectors/eval/helpers/no-hooks";
import { PAGE_VARIANTS, SECONDARY_VARIANT_IDS, buildVariantSnapshot } from "@/tests/detectors/eval/helpers/pages";
import { formatTable, recallOf, score } from "@/tests/detectors/eval/helpers/score";
import type { EntryRow, ScoreResult, VariantFindings } from "@/tests/detectors/eval/helpers/score";

// ── Requirement 17 lists ───────────────────────────────────────────────────

/** 17.1: the 19 scorable flag entries. */
const SCORABLE_FLAG_IDS: readonly string[] = [
  "home-hero-countdown-restart",
  "home-rolling-midnight-text",
  "home-cookie-accept-dominant",
  "home-cookie-ghost-reject",
  "product-low-stock-random",
  "product-viewers-random",
  "product-selling-fast-badge",
  "product-almost-gone-tiny",
  "product-sold-toast",
  "product-upsell-modal-tiny-close",
  "cart-protection-prechecked",
  "cart-warranty-radio-preselected",
  "cart-packaging-switch-on",
  "checkout-newsletter-prechecked",
  "club-modal-hate-saving",
  "club-modal-full-price-mortal",
  "club-modal-no-need-protection",
  "club-timer-session-restart",
  "newsletter-partners-prechecked",
];

/** 17.2: the three entries one static snapshot cannot show. */
const EXCLUDED_IDS: readonly string[] = [
  "cart-insurance-sneaked",
  "checkout-handling-fees-drip",
  "account-cancel-five-screens",
];

/** 17.3: the 8 honest look-alikes. */
const LOOKALIKE_IDS: readonly string[] = [
  "home-fixed-date-sale",
  "home-cookie-equal-buttons",
  "product-real-inventory-3-left",
  "cart-gift-wrap-unchecked",
  "cart-cheapest-shipping-default",
  "checkout-consistent-shipping-tax",
  "club-plain-no-thanks",
  "account-one-click-cancel-plan",
];

/** 17.4: the entries that one page plus one same-session reload can show. */
const NEEDS_MORE_THAN_ONE_RELOAD: readonly string[] = ["product-sold-toast", "club-timer-session-restart"];
const RELOAD_SHOWABLE_IDS: readonly string[] = SCORABLE_FLAG_IDS.filter(
  (id) => !NEEDS_MORE_THAN_ONE_RELOAD.includes(id),
);

const FLOW_PATTERNS: readonly string[] = ["sneak-into-basket", "drip-pricing", "hard-to-cancel"];

function sorted(ids: readonly string[]): string[] {
  return [...ids].sort();
}

// ── Sets ───────────────────────────────────────────────────────────────────

describe("Boo-tique evaluation: sets", () => {
  const fixture = loadFixture();

  it("derives the 19 scorable flag entries from the fixture", () => {
    const scorable = fixture
      .filter((entry) => entry.expectedVerdict === "flag" && !(entry.detectionSignals.length === 1 && entry.detectionSignals[0] === "not-static"))
      .map((entry) => entry.id);
    expect(scorable).toHaveLength(19);
    expect(sorted(scorable)).toEqual(sorted(SCORABLE_FLAG_IDS));
  });

  it("derives the 3 excluded not-static entries from the fixture", () => {
    const excluded = fixture.filter((entry) => entry.detectionSignals.includes("not-static")).map((entry) => entry.id);
    expect(excluded).toHaveLength(3);
    expect(sorted(excluded)).toEqual(sorted(EXCLUDED_IDS));
  });

  it("derives the 8 look-alike entries from the fixture", () => {
    const lookalikes = fixture.filter((entry) => entry.expectedVerdict === "no-flag").map((entry) => entry.id);
    expect(lookalikes).toHaveLength(8);
    expect(sorted(lookalikes)).toEqual(sorted(LOOKALIKE_IDS));
  });

  it("covers every fixture entry exactly once with the three sets", () => {
    const all = [...SCORABLE_FLAG_IDS, ...EXCLUDED_IDS, ...LOOKALIKE_IDS];
    expect(all).toHaveLength(30);
    expect(sorted(fixture.map((entry) => entry.id))).toEqual(sorted(all));
  });

  it("names the 17 entries that one page plus one same-session reload can show", () => {
    expect(RELOAD_SHOWABLE_IDS).toHaveLength(17);
    expect(RELOAD_SHOWABLE_IDS).not.toContain("product-sold-toast");
    expect(RELOAD_SHOWABLE_IDS).not.toContain("club-timer-session-restart");
    for (const id of RELOAD_SHOWABLE_IDS) expect(SCORABLE_FLAG_IDS).toContain(id);
  });
});

// ── Evaluation ─────────────────────────────────────────────────────────────

type VariantRun = VariantFindings & { readonly errorCount: number; readonly errorMessages: readonly string[] };

function runVariants(): VariantRun[] {
  return PAGE_VARIANTS.map((page) => {
    const built = buildVariantSnapshot(page);
    assertNoTestHooks(built.snapshot);
    const run = runAllDetectors(built.snapshot);
    return {
      variantId: page.id,
      keyToId: built.keyToId,
      findings: run.findings,
      errorCount: run.errors.length,
      errorMessages: run.errors.map((error) => error.message),
    };
  });
}

function wordsOf(text: string): string[] {
  return normaliseText(text, text.length)
    .split(/[^\p{L}\p{N}']+/u)
    .filter((word) => word !== "");
}

function stringsOf(finding: Finding): string[] {
  return [finding.title, finding.description, finding.explanation, finding.evidence.text, finding.detectorName];
}

function rowOf(result: ScoreResult, entryId: string): EntryRow {
  const row = result.rows.find((candidate) => candidate.entryId === entryId);
  if (row === undefined) throw new Error(`No row for entry ${entryId}.`);
  return row;
}

describe("Boo-tique evaluation: targets", () => {
  let runs: VariantRun[] = [];
  let primary: ScoreResult;
  let secondary: ScoreResult;
  let primaryTable = "";
  let secondaryTable = "";
  let report = "";

  beforeAll(() => {
    runs = runVariants();
    // Primary pairs: the "equal" hero pair and the differing product pair.
    primary = score(runs);
    // Secondary pairs: the "increase" hero pair and the coinciding product pair.
    secondary = score(runs, { pairs: "secondary" });
    primaryTable = formatTable(primary);
    secondaryTable = formatTable(secondary);
    report = [
      primaryTable,
      "",
      secondaryTable,
      "",
      `Entries that one page plus one same-session reload can show (${RELOAD_SHOWABLE_IDS.length}): ${RELOAD_SHOWABLE_IDS.join(", ")}`,
      `Secondary variants: ${SECONDARY_VARIANT_IDS.join(", ")}`,
    ].join("\n");
    console.log(`\n${report}\n`);
  });

  function message(what: string): string {
    return `${what}\n\n${report}`;
  }

  it("runs every detector on every variant without a detector error", () => {
    expect(runs).toHaveLength(PAGE_VARIANTS.length);
    for (const run of runs) {
      expect(run.errorMessages, message(`Detector errors on variant ${run.variantId}`)).toEqual([]);
    }
  });

  it("scores the 19 flag entries and the 8 look-alike entries", () => {
    expect(primary.rows.filter((row) => row.expected === "flag").map((row) => row.entryId)).toHaveLength(19);
    expect(primary.rows.filter((row) => row.expected === "no-flag").map((row) => row.entryId)).toHaveLength(8);
    expect(sorted(primary.rows.map((row) => row.entryId))).toEqual(sorted([...SCORABLE_FLAG_IDS, ...LOOKALIKE_IDS]));
  });

  it("reaches a recall of at least 0.8 on the 19 flag entries with the primary pairs", () => {
    expect(primary.flagEntries).toBe(19);
    expect(primary.hits, message(`Recall ${primary.hits}/19, at least 16 hits needed`)).toBeGreaterThanOrEqual(16);
    expect(recallOf(primary), message("Recall below 0.8")).toBeGreaterThanOrEqual(0.8);
  });

  it("gives no false positive on the 8 look-alike entries, with either pair", () => {
    const falsePositives = (result: ScoreResult) =>
      result.rows.filter((row) => row.result === "false-positive").map((row) => row.entryId);
    expect(falsePositives(primary), message("False positives with the primary pairs")).toEqual([]);
    expect(falsePositives(secondary), message("False positives with the secondary pairs")).toEqual([]);
  });

  it("gives no medium or high finding that matches no entry", () => {
    const loud = primary.unplanted.filter((item) => item.confidence !== "low");
    expect(loud, message("Unplanted findings of medium or high confidence")).toEqual([]);
  });

  it("returns no flow-pattern finding on any variant", () => {
    const flow = runs.flatMap((run) =>
      run.findings.filter((finding) => FLOW_PATTERNS.includes(finding.patternId)).map((finding) => `${run.variantId}: ${finding.patternId}`),
    );
    expect(flow, message("Flow-pattern findings")).toEqual([]);
    expect(primary.ignoredFlowFindings, message("Ignored flow-pattern findings")).toBe(0);
  });

  it("finds S1, A1 and U3 with the primary pairs", () => {
    const stock = rowOf(primary, "product-low-stock-random");
    expect(stock.result, message("product-low-stock-random")).toBe("hit");
    expect(stock.confidences, message("S1 is high")).toEqual(["high"]);
    expect(stock.titles, message("S1 title")).toEqual(["Possible fake scarcity: stock number changed on reload"]);

    const viewers = rowOf(primary, "product-viewers-random");
    expect(viewers.result, message("product-viewers-random")).toBe("hit");
    expect(viewers.confidences, message("A1 is high")).toEqual(["high"]);
    expect(viewers.titles, message("A1 title")).toEqual(["Possible fake activity: number changed on reload"]);

    const hero = rowOf(primary, "home-hero-countdown-restart");
    expect(hero.result, message("home-hero-countdown-restart")).toBe("hit");
    expect(hero.confidences, message("U3 is medium")).toEqual(["medium"]);
    expect(hero.titles, message("U3 title")).toEqual([
      "Possible fake urgency: countdown did not count down across a reload",
    ]);
  });

  it("finds S3, A3 and U2 with the secondary pairs, and nothing on the real inventory", () => {
    const stock = rowOf(secondary, "product-low-stock-random");
    expect(stock.result, message("product-low-stock-random (coinciding)")).toBe("hit");
    expect(stock.confidences, message("S3 is medium")).toEqual(["medium"]);
    expect(stock.titles, message("S3 title")).toEqual(["Possible fake scarcity: low-stock message"]);

    const viewers = rowOf(secondary, "product-viewers-random");
    expect(viewers.result, message("product-viewers-random (coinciding)")).toBe("hit");
    expect(viewers.confidences, message("A3 is low")).toEqual(["low"]);
    expect(viewers.titles, message("A3 title")).toEqual(["Possible fake activity: activity message"]);

    const hero = rowOf(secondary, "home-hero-countdown-restart");
    expect(hero.result, message("home-hero-countdown-restart (increase)")).toBe("hit");
    expect(hero.confidences, message("U2 is high")).toEqual(["high"]);
    expect(hero.titles, message("U2 title")).toEqual(["Possible fake urgency: countdown restarted on reload"]);

    const inventory = rowOf(secondary, "product-real-inventory-3-left");
    expect(inventory.result, message("product-real-inventory-3-left (coinciding)")).toBe("ok");
    expect(inventory.matched, message("No finding on the real inventory")).toEqual([]);
  });

  it("uses no word of FORBIDDEN_WORDS in any string of any finding", () => {
    const forbidden = new Set(FORBIDDEN_WORDS.map((word) => normaliseText(word)));
    const hits: string[] = [];
    for (const run of runs) {
      for (const finding of run.findings) {
        for (const text of stringsOf(finding)) {
          for (const word of wordsOf(text)) {
            if (forbidden.has(word)) hits.push(`${run.variantId}: "${word}" in ${finding.title}`);
          }
        }
      }
    }
    expect(hits, message("Forbidden words in findings")).toEqual([]);
  });

  it("starts every title with Possible and gives two equal runs", () => {
    for (const run of runs) {
      for (const finding of run.findings) expect(finding.title.startsWith("Possible")).toBe(true);
    }
    const again = runVariants();
    expect(again.map((run) => run.findings)).toEqual(runs.map((run) => run.findings));
  });
});
