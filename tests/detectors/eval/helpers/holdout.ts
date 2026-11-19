import { runAllDetectors } from "@/lib/detectors/all";
import { PageSnapshotSchema } from "@/lib/types";
import type { Confidence, Finding, PageSnapshot, PatternId } from "@/lib/types";
import { HOLDOUT_CASES } from "@/tests/detectors/eval/helpers/holdout-cases";
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
  /** Honest cases: any finding touches the page. */
  readonly falsePositive: boolean;
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
  readonly total: number;
  readonly falsePositiveIds: readonly string[];
  readonly byConfidence: Readonly<Record<Confidence, number>>;
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

function outcomeOf(c: HoldoutCase, run: CaseRun): CaseOutcome {
  const base = { id: c.id, group: c.group, text: c.text, ...(c.knownMiss !== undefined ? { knownMiss: c.knownMiss } : {}) };
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

function honestScore(outcomes: readonly CaseOutcome[]): HonestScore {
  const honest = outcomes.filter((o) => o.expected === "no-flag");
  const positives = honest.filter((o) => o.falsePositive);
  const byConfidence: Record<Confidence, number> = { low: 0, medium: 0, high: 0 };
  for (const o of positives) {
    if (o.confidence !== undefined) byConfidence[o.confidence]++;
  }
  return { total: honest.length, falsePositiveIds: positives.map((o) => o.id), byConfidence };
}

/** Scores the runs against the cases. Throws when a case has no run. */
export function scoreHoldout(cases: readonly HoldoutCase[], runs: readonly CaseRun[]): HoldoutScore {
  const byId = new Map(runs.map((run) => [run.caseId, run] as const));
  const outcomes = cases.map((c) => {
    const run = byId.get(c.id);
    if (run === undefined) throw new Error(`No run for hold-out case ${c.id}.`);
    return outcomeOf(c, run);
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

function honestLine(o: CaseOutcome): string {
  if (!o.falsePositive) return `  ok    ${o.id}: ${o.text}`;
  return `  FP    ${o.id} [${o.patterns.join(", ")}] ${o.confidence} confidence: ${o.text}`;
}

function split(by: Readonly<Record<Confidence, number>>): string {
  return `low ${by.low}, medium ${by.medium}, high ${by.high}`;
}

/** The result table printed by the hold-out test. */
export function formatHoldoutTable(score: HoldoutScore): string {
  const flags = score.outcomes.filter((o) => o.group === "flag");
  const honest = score.outcomes.filter((o) => o.group === "honest");
  const extras = score.outcomes.filter((o) => o.group === "extra");
  const lines: string[] = [];
  lines.push("Hold-out evaluation (cases are never tuned)");
  lines.push(REVIEW_BASELINE_LINE);
  lines.push("");
  lines.push(
    `Flag cases: ${score.flag.hits}/${score.flag.total} hits (recall ${score.flag.recall.toFixed(2)}), ` +
      `${score.flag.knownMissIds.length} of the misses are known misses`
  );
  for (const o of flags) lines.push(flagLine(o));
  lines.push("");
  lines.push(
    `Honest cases: ${score.honest.falsePositiveIds.length}/${score.honest.total} false positives ` +
      `(${split(score.honest.byConfidence)})`
  );
  for (const o of honest) lines.push(honestLine(o));
  lines.push("");
  lines.push(
    `Extras: flag ${score.extraFlag.hits}/${score.extraFlag.total} hits; ` +
      `honest ${score.extraHonest.falsePositiveIds.length}/${score.extraHonest.total} false positives ` +
      `(${split(score.extraHonest.byConfidence)})`
  );
  for (const o of extras) lines.push(o.expected === "flag" ? flagLine(o) : honestLine(o));
  lines.push("");
  lines.push(`Detector errors: ${score.errorCount}`);
  return lines.join("\n");
}
