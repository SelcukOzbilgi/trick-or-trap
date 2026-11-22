import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { runAllDetectors } from "@/lib/detectors/all";
import { createMockJudge } from "@/lib/judge/mock";
import type { MockStep } from "@/lib/judge/mock";
import { createCooldown, reviewFindings } from "@/lib/judge/review";
import { ReviewResultSchema } from "@/lib/judge/types";
import type { JudgeLogRecord, ReviewResult } from "@/lib/judge/types";
import type { DetectorRunResult } from "@/lib/detectors/index";
import { createHarness } from "@/tests/judge/helpers/harness";
import {
  DEV_SHA256,
  buildCaseSnapshot,
  loadDevSet,
} from "@/tests/judge/eval/build-case";
import type { DevCase } from "@/tests/judge/eval/build-case";
import { downgradeAllJudge, noisyJudge } from "@/tests/judge/eval/fake-judges";
import { formatTable, scoreRun } from "@/tests/judge/eval/score";
import type { RunScore } from "@/tests/judge/eval/score";

// ---------------------------------------------------------------------------
// The dev evaluation: the rules-only regression (16.10 to 16.12) and the
// plumbing with two fake judges (16.13, 16.14). No model is called. Only the
// dev split is read.
// ---------------------------------------------------------------------------

const BASELINE_PATH = "tests/fixtures/judge-eval/judge-eval-dev-baseline.json";

const BaselineSchema = z.object({
  meta: z.object({
    summary: z.object({
      hits: z.number(),
      flagCases: z.number(),
      falsePositives: z.number(),
      falsePositivesMediumPlus: z.number(),
      toleratedLow: z.number(),
      cleanCases: z.number(),
    }),
  }),
  cases: z.array(
    z.object({
      id: z.string(),
      outcome: z.string(),
      offPattern: z.array(z.string()),
      detectorErrors: z.number(),
    }),
  ),
});

const baseline = BaselineSchema.parse(
  JSON.parse(readFileSync(join(process.cwd(), BASELINE_PATH), "utf8")),
);

const devSet = loadDevSet();
const cases: DevCase[] = devSet.cases;
const snapshots = cases.map((devCase) => buildCaseSnapshot(devCase));
const ruleResults: DetectorRunResult[] = snapshots.map((snapshot) => runAllDetectors(snapshot));

const TEST_TIMEOUT_MS = 60_000;
const DEADLINE_MS = 20_000;

type Review = { mode: "off" } | { mode: "gateway"; step: MockStep };

/** Review every case; each scan has its own clock, timer and cooldown. */
async function reviewAll(
  review: Review,
  rules: (index: number) => DetectorRunResult,
): Promise<ReviewResult[]> {
  const results: ReviewResult[] = [];
  for (let index = 0; index < cases.length; index += 1) {
    const harness = createHarness();
    const records: JudgeLogRecord[] = [];
    const deps = {
      now: harness.now,
      deadline: harness.now() + DEADLINE_MS,
      cooldown: createCooldown(),
      log: (record: JudgeLogRecord) => records.push(record),
      setTimer: harness.setTimer,
    };
    const result =
      review.mode === "off"
        ? await reviewFindings(snapshots[index], rules(index), { ...deps, mode: "off" })
        : await reviewFindings(snapshots[index], rules(index), {
            ...deps,
            mode: "gateway",
            client: createMockJudge(review.step),
          });
    expect(records, cases[index].id).toHaveLength(1);
    results.push(result);
  }
  return results;
}

const withRules = (index: number): DetectorRunResult => ruleResults[index];
const withoutRules = (): DetectorRunResult => ({ findings: [], errors: [] });

// -- Rules only ---------------------------------------------------------------

describe("rules-only over dev (16.10, 16.11, 16.12)", () => {
  let results: ReviewResult[] = [];
  let run: RunScore;

  beforeAll(async () => {
    results = await reviewAll({ mode: "off" }, withRules);
    run = scoreRun(cases, results);
    console.info(`rules-only over dev\n${formatTable([{ label: "rules-only", score: run }])}`);
  }, TEST_TIMEOUT_MS);

  it("reviews every dev case with the judge off", () => {
    expect(DEV_SHA256).toBe("68173dd346198c43e3d325c645f50c14e375c8236a66eb123e2689eb444f9cff");
    expect(cases).toHaveLength(120);
    expect(results).toHaveLength(120);
    for (const result of results) {
      expect(ReviewResultSchema.safeParse(result).success).toBe(true);
      expect(result.judge.status).toBe("off");
      expect(result.setAside).toEqual([]);
      expect(result.findings.every((entry) => entry.source === "rules")).toBe(true);
    }
  });

  it("finds 18/60 hits, 3/60 false positives, 3/60 at medium or high and 1 tolerated low", () => {
    expect(run.total.flagCases).toBe(60);
    expect(run.total.cleanCases).toBe(60);
    expect({
      hits: run.total.hits,
      falsePositives: run.total.falsePositives,
      falsePositivesMediumPlus: run.total.falsePositivesMediumPlus,
      toleratedLow: run.total.toleratedLow,
    }).toEqual({
      hits: 18,
      falsePositives: 3,
      falsePositivesMediumPlus: 3,
      toleratedLow: 1,
    });
  });

  it("matches the summary of the baseline file", () => {
    const summary = baseline.meta.summary;
    expect({
      hits: run.total.hits,
      flagCases: run.total.flagCases,
      falsePositives: run.total.falsePositives,
      falsePositivesMediumPlus: run.total.falsePositivesMediumPlus,
      toleratedLow: run.total.toleratedLow,
      cleanCases: run.total.cleanCases,
    }).toEqual(summary);
  });

  it("gives every case the outcome, off-pattern list and error count of the baseline file", () => {
    const expected = new Map(baseline.cases.map((entry) => [entry.id, entry]));
    const differing: string[] = [];
    for (const score of run.cases) {
      const entry = expected.get(score.id);
      if (entry === undefined) {
        differing.push(`${score.id}: not in the baseline file`);
        continue;
      }
      if (entry.outcome !== score.outcome) {
        differing.push(`${score.id}: outcome ${score.outcome}, baseline ${entry.outcome}`);
      }
      if (JSON.stringify(entry.offPattern) !== JSON.stringify(score.offPattern)) {
        differing.push(
          `${score.id}: off-pattern ${JSON.stringify(score.offPattern)}, baseline ${JSON.stringify(entry.offPattern)}`,
        );
      }
      if (entry.detectorErrors !== score.detectorErrors) {
        differing.push(
          `${score.id}: ${score.detectorErrors} detector errors, baseline ${entry.detectorErrors}`,
        );
      }
    }
    const scored = new Set(run.cases.map((score) => score.id));
    for (const entry of baseline.cases) {
      if (!scored.has(entry.id)) differing.push(`${entry.id}: in the baseline file, not in dev`);
    }
    expect(differing, `cases that differ from the baseline:\n${differing.join("\n")}`).toEqual([]);
  });

  it("reports the off-pattern findings and the detector errors", () => {
    const off = run.cases.filter((score) => score.offPattern.length > 0);
    const errors = run.cases.reduce((sum, score) => sum + score.detectorErrors, 0);
    console.info(
      `off-pattern cases: ${off.length}, detector errors: ${errors}` +
        (off.length > 0 ? `\n${off.map((s) => `${s.id}: ${s.offPattern.join(", ")}`).join("\n")}` : ""),
    );
    expect(errors).toBe(baseline.cases.reduce((sum, entry) => sum + entry.detectorErrors, 0));
  });
});

// -- Fake judges --------------------------------------------------------------

describe("fake judges through the mock (16.13, 16.14)", () => {
  const FAKES: { name: string; step: MockStep }[] = [
    { name: "noisyJudge", step: noisyJudge },
    { name: "downgradeAllJudge", step: downgradeAllJudge },
  ];

  for (const fake of FAKES) {
    describe(fake.name, () => {
      let rulesOnly: RunScore;
      let judgeOnly: RunScore;
      let both: RunScore;
      let bothResults: ReviewResult[] = [];
      let judgeOnlyResults: ReviewResult[] = [];
      let rulesOnlyResults: ReviewResult[] = [];

      beforeAll(async () => {
        rulesOnlyResults = await reviewAll({ mode: "off" }, withRules);
        rulesOnly = scoreRun(cases, rulesOnlyResults);
        judgeOnlyResults = await reviewAll({ mode: "gateway", step: fake.step }, withoutRules);
        bothResults = await reviewAll({ mode: "gateway", step: fake.step }, withRules);
        judgeOnly = scoreRun(cases, judgeOnlyResults);
        both = scoreRun(cases, bothResults);
        console.info(
          `${fake.name} over dev\n${formatTable([
            { label: "rules-only", score: rulesOnly },
            { label: "judge-only", score: judgeOnly },
            { label: "rules+judge", score: both },
          ])}`,
        );
      }, TEST_TIMEOUT_MS);

      it("scores every case in all three columns", () => {
        expect(rulesOnly.cases).toHaveLength(120);
        expect(judgeOnly.cases).toHaveLength(120);
        expect(both.cases).toHaveLength(120);
        for (const result of [...judgeOnlyResults, ...bothResults]) {
          expect(ReviewResultSchema.safeParse(result).success).toBe(true);
        }
      });

      it("ends every review with a status that is not an error", () => {
        const statuses = new Set(
          [...judgeOnlyResults, ...bothResults].map((result) => result.judge.status),
        );
        for (const status of statuses) {
          expect(["ran", "ran-anomalous"]).toContain(status);
        }
      });

      // Requirement 20.15, 20.16: the merge ignores or voids the downgrade-all
      // answer, and a downgrade never removes a finding.
      it("never removes a finding, and leaves an anomalous review equal to rules-only", () => {
        const key = (entry: ReviewResult["findings"][number]) => JSON.stringify(entry.finding);
        let anomalous = 0;
        bothResults.forEach((result, index) => {
          const rules = rulesOnlyResults[index];
          expect(result.findings.length + result.setAside.length, cases[index].id).toBeGreaterThanOrEqual(
            rules.findings.length,
          );
          if (fake.name !== "downgradeAllJudge") return;
          expect(result.findings.length, cases[index].id).toBeGreaterThanOrEqual(
            rules.findings.length,
          );
          expect(result.setAside, cases[index].id).toEqual([]);
          if (result.judge.status !== "ran-anomalous") return;
          anomalous += 1;
          expect(result.findings.map(key).sort(), cases[index].id).toEqual(
            rules.findings.map(key).sort(),
          );
          expect(result.findings.every((entry) => entry.source === "rules")).toBe(true);
        });
        // Dev cases have at most two rule findings, so the lowering limit does
        // not apply here; the injection test A1b covers the anomalous case.
        console.info(`${fake.name}: ${anomalous} anomalous reviews`);
      });

      it("finds no more medium or high false positives than rules-only", () => {
        expect(both.total.falsePositivesMediumPlus).toBeLessThanOrEqual(
          rulesOnly.total.falsePositivesMediumPlus,
        );
      });

      it("adds only low findings of its own", () => {
        let added = 0;
        for (const result of [...judgeOnlyResults, ...bothResults]) {
          for (const entry of result.findings) {
            if (entry.source !== "judge") continue;
            added += 1;
            expect(entry.finding.confidence).toBe("low");
          }
        }
        // The noisy fake adds findings, so the check above is not empty.
        if (fake.name === "noisyJudge") expect(added).toBeGreaterThan(0);
        expect(judgeOnly.total.falsePositivesMediumPlus).toBe(0);
      });
    });
  }
});
