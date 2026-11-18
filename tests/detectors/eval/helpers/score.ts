import type { GroundTruthEntry } from "@/lib/boo-tique/ground-truth";
import type { Confidence, Finding, PatternId } from "@/lib/types";
import { loadFixture } from "@/tests/boo-tique/helpers/fixture";
import { ENTRY_MAP, mappingOf, nodesOf } from "@/tests/detectors/eval/helpers/entry-map";
import type { EntryMapping } from "@/tests/detectors/eval/helpers/entry-map";

/**
 * Scoring of detector findings against the ground-truth fixture (design section 13,
 * requirement 17). Findings are matched to entries only here, through the side table of
 * `entry-map.ts`; detectors never see an entry id.
 *
 * - Flag entry: a hit needs a finding with the entry's pattern whose `elementIds` include a
 *   node of the entry (row level). Any other outcome is a miss.
 * - Look-alike entry: a finding whose `elementIds` include a node of the entry is a false
 *   positive, whatever its pattern. On a whole-page look-alike any static finding is one.
 * - A static finding that is neither is "unplanted".
 * - Findings of the three flow patterns are not scored; they are counted and ignored.
 */

export const STATIC_PATTERNS: readonly PatternId[] = [
  "fake-urgency",
  "fake-scarcity",
  "fake-activity",
  "confirmshaming",
  "preselection",
  "visual-interference",
];

const FLOW_PATTERNS: readonly PatternId[] = ["sneak-into-basket", "drip-pricing", "hard-to-cancel"];

/** The findings of one page variant, with the node-key map of its first sample. */
export type VariantFindings = {
  readonly variantId: string;
  /** Node key to synthetic id of the variant's first sample. */
  readonly keyToId: ReadonlyMap<string, string>;
  readonly findings: readonly Finding[];
};

export type EntryResult = "hit" | "miss" | "ok" | "false-positive";

export type MatchedFinding = {
  readonly patternId: PatternId;
  readonly confidence: Confidence;
  readonly title: string;
};

export type EntryRow = {
  readonly entryId: string;
  /** Pattern of the fixture entry (`none` for a look-alike). */
  readonly pattern: string;
  readonly expected: "flag" | "no-flag";
  /** The variant the row was scored on. */
  readonly variantId: string;
  /** Findings that matched the entry in that variant (hits, or false positives for a look-alike). */
  readonly matched: readonly MatchedFinding[];
  readonly confidences: readonly Confidence[];
  readonly titles: readonly string[];
  readonly result: EntryResult;
};

export type DetectorSummary = {
  readonly pattern: PatternId;
  /** Flag entries of this pattern. */
  readonly flagEntries: number;
  readonly found: number;
  readonly missed: number;
  /** Findings of this pattern that landed on a look-alike entry. */
  readonly falsePositives: number;
};

export type UnplantedFinding = {
  readonly variantId: string;
  readonly patternId: PatternId;
  readonly confidence: Confidence;
  readonly title: string;
  readonly elementIds: readonly string[];
};

export type ScoreResult = {
  readonly pairs: "primary" | "secondary";
  readonly rows: readonly EntryRow[];
  readonly detectors: readonly DetectorSummary[];
  readonly unplanted: readonly UnplantedFinding[];
  /** Flag entries with a hit. */
  readonly hits: number;
  /** Flag entries scored. */
  readonly flagEntries: number;
  /** Look-alike rows with a false positive. */
  readonly falsePositives: number;
  /** Findings of the flow patterns, which are not scored. */
  readonly ignoredFlowFindings: number;
};

export type ScoreOptions = {
  /**
   * Which pair of an entry is scored: the first variant of the entry map (default) or the
   * last one (the "increase" hero pair and the coinciding product pair).
   */
  readonly pairs?: "primary" | "secondary";
  /** The fixture entries. Defaults to the ground-truth fixture. */
  readonly entries?: readonly GroundTruthEntry[];
};

type Match = { readonly entry: GroundTruthEntry; readonly mapping: EntryMapping };

/** The ids of the nodes of an entry in one variant. Throws when a node key is unknown. */
function nodeIdsOf(entryId: string, variant: VariantFindings): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const key of nodesOf(entryId)) {
    const id = variant.keyToId.get(key);
    if (id === undefined) {
      throw new Error(`Variant "${variant.variantId}" has no node "${key}" for entry "${entryId}".`);
    }
    ids.add(id);
  }
  return ids;
}

function touches(ids: ReadonlySet<string>, finding: Finding): boolean {
  return finding.elementIds.some((id) => ids.has(id));
}

function describe(finding: Finding): MatchedFinding {
  return { patternId: finding.patternId, confidence: finding.confidence, title: finding.title };
}

/** Scores the findings of every page variant. */
export function score(variants: readonly VariantFindings[], options: ScoreOptions = {}): ScoreResult {
  const pairs = options.pairs ?? "primary";
  const entries = (options.entries ?? loadFixture()).filter((entry) => ENTRY_MAP[entry.id] !== undefined);
  const byVariantId = new Map(variants.map((variant) => [variant.variantId, variant] as const));

  // Entries per variant, with the matches found there: entry id and variant id to findings.
  const matches = new Map<string, MatchedFinding[]>();
  const unplanted: UnplantedFinding[] = [];
  let ignoredFlowFindings = 0;

  for (const variant of variants) {
    const here: Match[] = entries
      .map((entry) => ({ entry, mapping: mappingOf(entry.id) }))
      .filter(({ mapping }) => mapping.variants.includes(variant.variantId));
    const nodeIds = new Map(here.map(({ entry }) => [entry.id, nodeIdsOf(entry.id, variant)] as const));

    for (const finding of variant.findings) {
      if (FLOW_PATTERNS.includes(finding.patternId)) {
        ignoredFlowFindings += 1;
        continue;
      }
      let matched = false;
      for (const { entry, mapping } of here) {
        const ids = nodeIds.get(entry.id) ?? new Set<string>();
        const isMatch =
          entry.expectedVerdict === "flag"
            ? entry.pattern === finding.patternId && touches(ids, finding)
            : mapping.wholePage || touches(ids, finding);
        if (!isMatch) continue;
        matched = true;
        const key = `${entry.id}|${variant.variantId}`;
        const list = matches.get(key) ?? [];
        list.push(describe(finding));
        matches.set(key, list);
      }
      if (!matched) {
        unplanted.push({
          variantId: variant.variantId,
          patternId: finding.patternId,
          confidence: finding.confidence,
          title: finding.title,
          elementIds: [...finding.elementIds],
        });
      }
    }
  }

  const rows: EntryRow[] = entries.map((entry) => {
    const mapping = mappingOf(entry.id);
    const variantId = pairs === "primary" ? mapping.variants[0] : mapping.variants[mapping.variants.length - 1];
    if (!byVariantId.has(variantId)) {
      throw new Error(`No findings were given for variant "${variantId}" (entry "${entry.id}").`);
    }
    const matched = matches.get(`${entry.id}|${variantId}`) ?? [];
    const flag = entry.expectedVerdict === "flag";
    const result: EntryResult = flag ? (matched.length > 0 ? "hit" : "miss") : matched.length > 0 ? "false-positive" : "ok";
    return {
      entryId: entry.id,
      pattern: entry.pattern,
      expected: entry.expectedVerdict,
      variantId,
      matched,
      confidences: matched.map((item) => item.confidence),
      titles: matched.map((item) => item.title),
      result,
    };
  });

  const detectors: DetectorSummary[] = STATIC_PATTERNS.map((pattern) => {
    const flagRows = rows.filter((row) => row.expected === "flag" && row.pattern === pattern);
    const found = flagRows.filter((row) => row.result === "hit").length;
    const falsePositives = rows
      .filter((row) => row.expected === "no-flag")
      .reduce((sum, row) => sum + row.matched.filter((item) => item.patternId === pattern).length, 0);
    return { pattern, flagEntries: flagRows.length, found, missed: flagRows.length - found, falsePositives };
  });

  const flagRows = rows.filter((row) => row.expected === "flag");
  return {
    pairs,
    rows,
    detectors,
    unplanted,
    hits: flagRows.filter((row) => row.result === "hit").length,
    flagEntries: flagRows.length,
    falsePositives: rows.filter((row) => row.result === "false-positive").length,
    ignoredFlowFindings,
  };
}

/** Hits over flag entries. Zero when there are no flag entries. */
export function recallOf(result: ScoreResult): number {
  return result.flagEntries === 0 ? 0 : result.hits / result.flagEntries;
}

function pad(text: string, width: number): string {
  return text.length >= width ? text : text + " ".repeat(width - text.length);
}

function padStart(text: string, width: number): string {
  return text.length >= width ? text : " ".repeat(width - text.length) + text;
}

/** A fixed-width text table: one block per detector, one row per entry, the unplanted findings and the recall. */
export function formatTable(result: ScoreResult): string {
  const lines: string[] = [];
  lines.push(`Boo-tique evaluation (${result.pairs} pairs)`);
  lines.push("");

  lines.push(
    `${pad("Detector", 22)}${padStart("flag", 6)}${padStart("found", 7)}${padStart("missed", 8)}${padStart("false pos.", 12)}`,
  );
  for (const detector of result.detectors) {
    lines.push(
      `${pad(detector.pattern, 22)}${padStart(String(detector.flagEntries), 6)}${padStart(String(detector.found), 7)}${padStart(String(detector.missed), 8)}${padStart(String(detector.falsePositives), 12)}`,
    );
  }
  lines.push("");

  const idWidth = Math.max(...result.rows.map((row) => row.entryId.length), 5) + 2;
  lines.push(
    `${pad("Entry", idWidth)}${pad("Pattern", 22)}${pad("Expected", 10)}${pad("Confidence", 14)}Result`,
  );
  for (const row of result.rows) {
    const confidences = row.confidences.length === 0 ? "-" : row.confidences.join(",");
    const detail =
      row.result === "false-positive"
        ? `${row.result} (${[...new Set(row.matched.map((item) => item.patternId))].join(", ")})`
        : row.result;
    lines.push(`${pad(row.entryId, idWidth)}${pad(row.pattern, 22)}${pad(row.expected, 10)}${pad(confidences, 14)}${detail}`);
  }
  lines.push("");

  lines.push(`Unplanted findings: ${result.unplanted.length}`);
  for (const item of result.unplanted) {
    lines.push(
      `  [${item.variantId}] ${item.patternId} ${item.confidence}: ${item.title} (elements: ${item.elementIds.join(", ")})`,
    );
  }
  lines.push(`Flow-pattern findings ignored: ${result.ignoredFlowFindings}`);
  lines.push(`False positives on look-alikes: ${result.falsePositives}`);
  lines.push(`Recall ${result.hits}/${result.flagEntries} = ${recallOf(result).toFixed(2)}`);
  return lines.join("\n");
}
