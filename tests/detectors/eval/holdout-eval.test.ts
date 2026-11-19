import { describe, it, expect } from "vitest";
import { HOLDOUT_CASES } from "@/tests/detectors/eval/helpers/holdout-cases";
import { formatHoldoutTable, runHoldout, scoreHoldout } from "@/tests/detectors/eval/helpers/holdout";

/**
 * Hold-out evaluation (requirement 4). It asserts only what requirement 4.6 allows:
 * every case ran with no detector error, the case counts, and a sanity floor of recall
 * 0.5 over the 28 flag cases. There is no assertion about false positives and no
 * threshold tuned to a result. The table is printed for the record.
 */

const runs = runHoldout();
const score = scoreHoldout(HOLDOUT_CASES, runs);

describe("hold-out evaluation", () => {
  it("prints the result table", () => {
    console.log(`\n${formatHoldoutTable(score)}\n`);
    expect(score.outcomes).toHaveLength(HOLDOUT_CASES.length);
  });

  it("runs every case with no detector error", () => {
    expect(runs).toHaveLength(56);
    for (const run of runs) expect(run.errorMessages, run.caseId).toEqual([]);
    expect(score.errorCount).toBe(0);
  });

  it("keeps the case counts: 28 flag cases, 20 honest cases and 8 extras", () => {
    expect(score.flag.total).toBe(28);
    expect(score.honest.total).toBe(20);
    expect(score.extraFlag.total + score.extraHonest.total).toBe(8);
  });

  it("has a recall of at least 0.5 over the 28 flag cases (sanity floor)", () => {
    expect(score.flag.recall).toBeGreaterThanOrEqual(0.5);
  });
});
