import { runAllDetectors } from "@/lib/detectors/all";
import { PageSnapshotSchema } from "@/lib/types";
import type { Confidence, Finding, PageSnapshot, PatternId } from "@/lib/types";
import { HOLDOUT_CASES, KNOWN_FALSE_POSITIVES } from "@/tests/detectors/eval/helpers/holdout-cases";
import type { HoldoutCase } from "@/tests/detectors/eval/helpers/holdout-cases";
import { toLightSample } from "@/tests/detectors/eval/helpers/light";
import { assertNoTestHooks } from "@/tests/detectors/eval/helpers/no-hooks";
import { BASE_TIME, RELOAD_TIME } from "@/tests/detectors/eval/helpers/pages";
import { buildSnapshot } from "@/tests/detectors/eval/helpers/tree";

/**
 * Runner, scoring and report of the hold-out evaluation (requirement 4, design section 13).
 * The cases are never tuned: nothing here reads a result back into a case.
 */

export const REVIEW_BASELINE_LINE = "Review baseline (c21325f): 18/28 hits, 3/20 false positives";

const ORIGIN = "https://holdout.example";

export type BuiltHoldoutCase = {
  readonly snapshot: PageSnapshot;
  /** Node key to synthetic id of the first sample. */
  readonly keyToId: ReadonlyMap<string, string>;
};

/** Builds and checks the snapshot of a case: the first sample plus, for a reload pair, the light reload sample. */
export function buildHoldoutSnapshot(c: HoldoutCase): BuiltHoldoutCase {
  const url = `${ORIGIN}/${c.id}`;
  const first = buildSnapshot(c.first, { capturedAt: BASE_TIME, url });
  let snapshot = first.snapshot;
  if (c.reload !== undefined) {
    const reload = buildSnapshot(c.reload, { capturedAt: RELOAD_TIME, url });
    snapshot = { ...first.snapshot, afterReload: toLightSample(reload.snapshot, RELOAD_TIME) };
  }
  const checked = PageSnapshotSchema.parse(snapshot);
  assertNoTestHooks(checked);
  return { snapshot: checked, keyToId: first.keyToId };
}

export type CaseRun = {
  readonly caseId: string;
  readonly findings: readonly Finding[];
  readonly errorCount: number;
  readonly errorMessages: readonly string[];
  readonly keyToId: ReadonlyMap<string, string>;
};

/** Runs `runAllDetectors` on every case. */
export function runHoldout(cases: readonly HoldoutCase[] = HOLDOUT_CASES): CaseRun[] {
  return cases.map((c) => {
    const built = buildHoldoutSnapshot(c);
    const result = runAllDetectors(built.snapshot);
    return {
      caseId: c.id,
      findings: result.findings,
      errorCount: result.errors.length,
      errorMessages: result.errors.map((error) => error.message),
      keyToId: built.keyToId,
    };
  });
}

// ── Scoring ─────────────────────────────────────────────────────────────────

const RANK: Record<Confidence, number> = { low: 0, medium: 1, high: 2 };

function highest(findings: readonly Finding[]): Confidence | undefined {
  let best: Confidence | undefined;
  for (const f of findings) {
    if (best === undefined || RANK[f.confidence] > RANK[best]) best = f.confidence;
  }
  return best;
}

/** True when the id is the node or one of its descendants (ids are `el-` plus the child path). */
function isNodeOrChild(id: string, nodeId: string): boolean {
  return id === nodeId || id.startsWith(`${nodeId}-`);
}

/** The body is `el-1`; every element of a case page is inside it. */
const PAGE_ROOT = "el-1";

export type CaseOutcome = {
  readonly id: string;
  readonly group: HoldoutCase["group"];
  readonly text: string;
  readonly expected: "flag" | "no-flag";
  readonly pattern?: PatternId;
  /** Flag cases: a finding with the pattern touches the node or a child. */
  readonly hit: boolean;
  /** Honest cases: any finding touches the page. Includes the cases of `KNOWN_FALSE_POSITIVES`. */
  readonly falsePositive: boolean;
  /** True when the case id is in the known-false-positive list (open under task 7). */
  readonly known: boolean;
  /** Highest confidence among the findings that count for this case. */
  readonly confidence?: Confidence;
  /** Patterns of the findings that touched an honest case. */
  readonly patterns: readonly PatternId[];
  readonly knownMiss?: string;
};

export type FlagScore = {
  readonly total: number;
  readonly hits: number;
  readonly recall: number;
  readonly missedIds: readonly string[];
  /** Missed cases that carry a `knownMiss` reason. */
  readonly knownMissIds: readonly string[];
};

export type HonestScore = {
  /** Every honest case of the group, listed known false positives included. */
  readonly total: number;
  /** Ordinary false positives: honest cases with a finding that are not in the known list. */
  readonly falsePositiveIds: readonly string[];
  /** Confidence split of the ordinary false positives only. */
  readonly byConfidence: Readonly<Record<Confidence, number>>;
  /** Honest cases of this group that are in the known list, flagged or not. */
  readonly knownTotal: number;
  /** Known-list cases that still produce a finding. Never counted as clean, never in `falsePositiveIds`. */
  readonly knownFalsePositiveIds: readonly string[];
  /** Confidence split of the known false positives. */
  readonly knownByConfidence: Readonly<Record<Confidence, number>>;
  /** Known-list cases that no longer produce a finding. This is an error: the list must be updated. */
  readonly staleKnownIds: readonly string[];
};

export type HoldoutScore = {
  readonly outcomes: readonly CaseOutcome[];
  readonly flag: FlagScore;
  readonly honest: HonestScore;
  readonly extraFlag: FlagScore;
  readonly extraHonest: HonestScore;
  /** Detector errors summed over all runs. */
  readonly errorCount: number;
};

function outcomeOf(c: HoldoutCase, run: CaseRun, knownIds: ReadonlySet<string>): CaseOutcome {
  const base = {
    id: c.id,
    group: c.group,
    text: c.text,
    known: c.pattern === undefined && knownIds.has(c.id),
    ...(c.knownMiss !== undefined ? { knownMiss: c.knownMiss } : {}),
  };
  if (c.pattern !== undefined) {
    const nodeId = run.keyToId.get(c.node);
    if (nodeId === undefined) throw new Error(`Case ${c.id} has no node "${c.node}".`);
    const matching = run.findings.filter(
      (f) => f.patternId === c.pattern && f.elementIds.some((id) => isNodeOrChild(id, nodeId))
    );
    const confidence = highest(matching);
    return {
      ...base,
      expected: "flag",
      pattern: c.pattern,
      hit: matching.length > 0,
      falsePositive: false,
      patterns: [],
      ...(confidence !== undefined ? { confidence } : {}),
    };
  }
  const touching = run.findings.filter(
    (f) => f.elementIds.length === 0 || f.elementIds.some((id) => isNodeOrChild(id, PAGE_ROOT))
  );
  const confidence = highest(touching);
  return {
    ...base,
    expected: "no-flag",
    hit: false,
    falsePositive: touching.length > 0,
    patterns: [...new Set(touching.map((f) => f.patternId))],
    ...(confidence !== undefined ? { confidence } : {}),
  };
}

function flagScore(outcomes: readonly CaseOutcome[]): FlagScore {
  const flags = outcomes.filter((o) => o.expected === "flag");
  const hits = flags.filter((o) => o.hit).length;
  const missed = flags.filter((o) => !o.hit);
  return {
    total: flags.length,
    hits,
    recall: flags.length === 0 ? 0 : hits / flags.length,
    missedIds: missed.map((o) => o.id),
    knownMissIds: missed.filter((o) => o.knownMiss !== undefined).map((o) => o.id),
  };
}

function confidenceSplit(outcomes: readonly CaseOutcome[]): Record<Confidence, number> {
  const by: Record<Confidence, number> = { low: 0, medium: 0, high: 0 };
  for (const o of outcomes) {
    if (o.confidence !== undefined) by[o.confidence]++;
  }
  return by;
}

function honestScore(outcomes: readonly CaseOutcome[]): HonestScore {
  const honest = outcomes.filter((o) => o.expected === "no-flag");
  const ordinary = honest.filter((o) => o.falsePositive && !o.known);
  const knownFlagged = honest.filter((o) => o.falsePositive && o.known);
  const stale = honest.filter((o) => !o.falsePositive && o.known);
  return {
    total: honest.length,
    falsePositiveIds: ordinary.map((o) => o.id),
    byConfidence: confidenceSplit(ordinary),
    knownTotal: knownFlagged.length + stale.length,
    knownFalsePositiveIds: knownFlagged.map((o) => o.id),
    knownByConfidence: confidenceSplit(knownFlagged),
    staleKnownIds: stale.map((o) => o.id),
  };
}

/**
 * Scores the runs against the cases. Throws when a case has no run. `knownFalsePositives` are
 * honest cases that are expected to be flagged today (second review, open under task 7): they are
 * scored apart from the ordinary false positives and never counted as clean. A listed case that
 * has no finding is reported in `staleKnownIds`.
 */
export function scoreHoldout(
  cases: readonly HoldoutCase[],
  runs: readonly CaseRun[],
  knownFalsePositives: readonly string[] = KNOWN_FALSE_POSITIVES
): HoldoutScore {
  const byId = new Map(runs.map((run) => [run.caseId, run] as const));
  const knownIds = new Set(knownFalsePositives);
  const outcomes = cases.map((c) => {
    const run = byId.get(c.id);
    if (run === undefined) throw new Error(`No run for hold-out case ${c.id}.`);
    return outcomeOf(c, run, knownIds);
  });
  const ofGroup = (group: HoldoutCase["group"]) => outcomes.filter((o) => o.group === group);
  const extras = ofGroup("extra");
  return {
    outcomes,
    flag: flagScore(ofGroup("flag")),
    honest: honestScore(ofGroup("honest")),
    extraFlag: flagScore(extras),
    extraHonest: honestScore(extras),
    errorCount: cases.reduce((sum, c) => sum + (byId.get(c.id)?.errorCount ?? 0), 0),
  };
}

// ── Report ──────────────────────────────────────────────────────────────────

function flagLine(o: CaseOutcome): string {
  if (o.hit) return `  HIT   ${o.id} [${o.pattern}] ${o.confidence} confidence: ${o.text}`;
  const reason = o.knownMiss !== undefined ? ` (knownMiss: ${o.knownMiss})` : "";
  return `  MISS  ${o.id} [${o.pattern}]${reason}: ${o.text}`;
}

const KNOWN_FP_LABEL = "FP (known, task 7)";

function honestLine(o: CaseOutcome): string {
  if (o.known && o.falsePositive) {
    return `  ${KNOWN_FP_LABEL}  ${o.id} [${o.patterns.join(", ")}] ${o.confidence} confidence: ${o.text}`;
  }
  if (o.known) {
    return `  ERROR known false positive has no finding any more, update KNOWN_FALSE_POSITIVES: ${o.id}: ${o.text}`;
  }
  if (!o.falsePositive) return `  ok    ${o.id}: ${o.text}`;
  return `  FP    ${o.id} [${o.patterns.join(", ")}] ${o.confidence} confidence: ${o.text}`;
}

function split(by: Readonly<Record<Confidence, number>>): string {
  return `low ${by.low}, medium ${by.medium}, high ${by.high}`;
}

/** The own line for the known false positives. Printed only when the list has a case in this group. */
export function knownFalsePositiveLine(honest: HonestScore): string | undefined {
  if (honest.knownTotal === 0) return undefined;
  const base =
    `Known false positives (open under task 7, requirement 11; listed apart, never counted as clean): ` +
    `${honest.knownFalsePositiveIds.length}/${honest.knownTotal} listed cases flagged (${split(honest.knownByConfidence)})`;
  if (honest.staleKnownIds.length === 0) return base;
  return `${base}; ERROR, listed but no finding: ${honest.staleKnownIds.join(", ")}`;
}

/** The result table printed by the hold-out test. */
export function formatHoldoutTable(score: HoldoutScore): string {
  const flags = score.outcomes.filter((o) => o.group === "flag");
  const honest = score.outcomes.filter((o) => o.group === "honest");
  const extras = score.outcomes.filter((o) => o.group === "extra");
  const lines: string[] = [];
  lines.push("Hold-out evaluation (cases are never tuned)");
  lines.push("A regression figure over the first review's probes, not a generalisation or accuracy figure.");
  lines.push(REVIEW_BASELINE_LINE);
  lines.push("");
  lines.push(
    `Flag cases: ${score.flag.hits}/${score.flag.total} hits (recall ${score.flag.recall.toFixed(2)}), ` +
      `${score.flag.knownMissIds.length} of the misses are known misses`
  );
  for (const o of flags) lines.push(flagLine(o));
  lines.push("");
  lines.push(
    `Honest cases: ${score.honest.falsePositiveIds.length}/${score.honest.total - score.honest.knownTotal} false positives ` +
      `(${split(score.honest.byConfidence)})`
  );
  for (const o of honest) lines.push(honestLine(o));
  const honestKnown = knownFalsePositiveLine(score.honest);
  if (honestKnown !== undefined) lines.push(honestKnown);
  lines.push("");
  lines.push(
    `Extras: flag ${score.extraFlag.hits}/${score.extraFlag.total} hits; ` +
      `honest ${score.extraHonest.falsePositiveIds.length}/${score.extraHonest.total - score.extraHonest.knownTotal} ` +
      `false positives (${split(score.extraHonest.byConfidence)})`
  );
  for (const o of extras) lines.push(o.expected === "flag" ? flagLine(o) : honestLine(o));
  const extrasKnown = knownFalsePositiveLine(score.extraHonest);
  if (extrasKnown !== undefined) lines.push(extrasKnown);
  lines.push("");
  lines.push(`Detector errors: ${score.errorCount}`);
  return lines.join("\n");
}
