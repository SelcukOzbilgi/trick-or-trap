import { JUDGE_PATTERN_IDS } from "@/lib/judge/types";
import type { ReviewResult, ReviewedFinding } from "@/lib/judge/types";
import type { Confidence } from "@/lib/types";
import type { DevCase } from "@/tests/judge/eval/build-case";

/**
 * The scoring of the judge evaluation harness (design section 18, the "Scoring"
 * section of the fixture README, requirements 16.3 to 16.9). The input is a
 * `ReviewResult` per case, and only `ReviewResult.findings` is read: a rule
 * finding that the judge set aside is neither a hit nor a false positive.
 *
 * The module is pure. It holds no state and reads no file.
 */

type Pattern = DevCase["pattern"];
type Language = DevCase["lang"];

// -- Per-case score -----------------------------------------------------------

export type CaseScore = {
  id: string;
  lang: Language;
  pattern: Pattern;
  expected: DevCase["expected"];
  /** `clean`, `miss`, `hit:<level>`, `tolerated-low`, `fp:low` or `fp:medium+`. */
  outcome: string;
  /** Flag case: a finding of the pattern on the evidence or a related element. */
  hit: boolean;
  /** Flag case: a finding of the pattern, none of them on those elements. */
  misplaced: boolean;
  /** Clean case: a finding of the pattern, a tolerated low excepted. */
  falsePositive: boolean;
  /** Clean case: a medium or high finding of the pattern. */
  falsePositiveMediumPlus: boolean;
  /** Clean case with `tolerateLow`: low findings of the pattern only. */
  toleratedLow: boolean;
  /** The pattern id of every finding of another pattern, sorted. */
  offPattern: string[];
  /** `ReviewResult.ruleErrors`. */
  detectorErrors: number;
};

const LEVEL_RANK: Readonly<Record<Confidence, number>> = Object.freeze({
  low: 0,
  medium: 1,
  high: 2,
});

function judgeCase(
  devCase: DevCase,
  findings: readonly ReviewedFinding[],
): Omit<CaseScore, "detectorErrors"> {
  const own: ReviewedFinding[] = [];
  const offPattern: string[] = [];
  for (const entry of findings) {
    if (entry.finding.patternId === devCase.pattern) own.push(entry);
    else offPattern.push(entry.finding.patternId);
  }
  offPattern.sort();

  const base = {
    id: devCase.id,
    lang: devCase.lang,
    pattern: devCase.pattern,
    expected: devCase.expected,
    offPattern,
  };

  if (devCase.expected === "flag") {
    const wanted = new Set<string>([
      ...(devCase.evidenceElementId !== undefined ? [devCase.evidenceElementId] : []),
      ...(devCase.relatedElementIds ?? []),
    ]);
    const hits = own.filter((entry) =>
      entry.finding.elementIds.some((id) => wanted.has(id)),
    );
    if (hits.length > 0) {
      const best = hits.reduce<Confidence>(
        (level, entry) =>
          LEVEL_RANK[entry.finding.confidence] > LEVEL_RANK[level]
            ? entry.finding.confidence
            : level,
        "low",
      );
      return {
        ...base,
        outcome: `hit:${best}`,
        hit: true,
        misplaced: false,
        falsePositive: false,
        falsePositiveMediumPlus: false,
        toleratedLow: false,
      };
    }
    return {
      ...base,
      outcome: "miss",
      hit: false,
      misplaced: own.length > 0,
      falsePositive: false,
      falsePositiveMediumPlus: false,
      toleratedLow: false,
    };
  }

  const mediumPlus = own.some((entry) => entry.finding.confidence !== "low");
  const anyLow = own.some((entry) => entry.finding.confidence === "low");
  const tolerate = devCase.tolerateLow === true;
  const common = { ...base, hit: false, misplaced: false };
  if (mediumPlus) {
    return {
      ...common,
      outcome: "fp:medium+",
      falsePositive: true,
      falsePositiveMediumPlus: true,
      toleratedLow: false,
    };
  }
  if (anyLow && tolerate) {
    return {
      ...common,
      outcome: "tolerated-low",
      falsePositive: false,
      falsePositiveMediumPlus: false,
      toleratedLow: true,
    };
  }
  if (anyLow) {
    return {
      ...common,
      outcome: "fp:low",
      falsePositive: true,
      falsePositiveMediumPlus: false,
      toleratedLow: false,
    };
  }
  return {
    ...common,
    outcome: "clean",
    falsePositive: false,
    falsePositiveMediumPlus: false,
    toleratedLow: false,
  };
}

/** The outcome string of one case (design section 3). */
export function outcomeOf(
  devCase: DevCase,
  findings: readonly ReviewedFinding[],
): string {
  return judgeCase(devCase, findings).outcome;
}

/** Score one case from one review result. Reads `result.findings` only. */
export function scoreCase(devCase: DevCase, result: ReviewResult): CaseScore {
  return {
    ...judgeCase(devCase, result.findings),
    detectorErrors: result.ruleErrors,
  };
}

// -- Totals -------------------------------------------------------------------

export type Tally = {
  flagCases: number;
  cleanCases: number;
  hits: number;
  misplaced: number;
  falsePositives: number;
  falsePositivesMediumPlus: number;
  toleratedLow: number;
  /** The number of findings of other patterns, not scored. */
  offPatternFindings: number;
};

export type RunScore = {
  total: Tally;
  byPattern: Record<Pattern, Tally>;
  byLanguage: Record<Language, Tally>;
  cases: CaseScore[];
};

function emptyTally(): Tally {
  return {
    flagCases: 0,
    cleanCases: 0,
    hits: 0,
    misplaced: 0,
    falsePositives: 0,
    falsePositivesMediumPlus: 0,
    toleratedLow: 0,
    offPatternFindings: 0,
  };
}

function add(tally: Tally, score: CaseScore): void {
  if (score.expected === "flag") tally.flagCases += 1;
  else tally.cleanCases += 1;
  if (score.hit) tally.hits += 1;
  if (score.misplaced) tally.misplaced += 1;
  if (score.falsePositive) tally.falsePositives += 1;
  if (score.falsePositiveMediumPlus) tally.falsePositivesMediumPlus += 1;
  if (score.toleratedLow) tally.toleratedLow += 1;
  tally.offPatternFindings += score.offPattern.length;
}

/**
 * Score a run: `results[i]` is the review of `cases[i]`. Fails when the two
 * lists differ in length, so a missing result is never read as a miss.
 */
export function scoreRun(
  cases: readonly DevCase[],
  results: readonly ReviewResult[],
): RunScore {
  if (cases.length !== results.length) {
    throw new Error("scoreRun: one result is needed for every case");
  }
  const run: RunScore = {
    total: emptyTally(),
    byPattern: Object.fromEntries(
      JUDGE_PATTERN_IDS.map((pattern) => [pattern, emptyTally()]),
    ) as Record<Pattern, Tally>,
    byLanguage: { en: emptyTally(), tr: emptyTally() },
    cases: [],
  };
  cases.forEach((devCase, index) => {
    const score = scoreCase(devCase, results[index]);
    run.cases.push(score);
    add(run.total, score);
    add(run.byPattern[score.pattern], score);
    add(run.byLanguage[score.lang], score);
  });
  return run;
}

// -- The table ----------------------------------------------------------------

export type TableColumn = { label: string; score: RunScore };

function cell(tally: Tally): string {
  return (
    `${tally.hits}/${tally.flagCases} hits, ` +
    `fp ${tally.falsePositives}/${tally.cleanCases}, ` +
    `med+ ${tally.falsePositivesMediumPlus}/${tally.cleanCases}, ` +
    `tol ${tally.toleratedLow}, off ${tally.offPatternFindings}`
  );
}

/**
 * A plain-text table with a row per pattern, per language and the total, and a
 * column per run (rules-only, judge-only, rules+judge). Each cell gives hits
 * over flag cases, false positives at any confidence and at medium or high over
 * clean cases, tolerated lows and off-pattern findings.
 */
export function formatTable(columns: readonly TableColumn[]): string {
  const rows: { label: string; pick: (score: RunScore) => Tally }[] = [
    ...JUDGE_PATTERN_IDS.map((pattern) => ({
      label: pattern as string,
      pick: (score: RunScore) => score.byPattern[pattern],
    })),
    { label: "en", pick: (score) => score.byLanguage.en },
    { label: "tr", pick: (score) => score.byLanguage.tr },
    { label: "total", pick: (score) => score.total },
  ];
  const labelWidth = Math.max("group".length, ...rows.map((row) => row.label.length));
  const cells = rows.map((row) => columns.map((column) => cell(row.pick(column.score))));
  const widths = columns.map((column, index) =>
    Math.max(column.label.length, ...cells.map((line) => line[index].length)),
  );
  const line = (label: string, values: readonly string[]): string =>
    [label.padEnd(labelWidth), ...values.map((value, index) => value.padEnd(widths[index]))]
      .join(" | ")
      .trimEnd();
  return [
    line("group", columns.map((column) => column.label)),
    ...rows.map((row, index) => line(row.label, cells[index])),
  ].join("\n");
}
