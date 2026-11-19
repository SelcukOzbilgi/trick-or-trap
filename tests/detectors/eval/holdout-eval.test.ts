import { describe, it, expect } from "vitest";
import { HOLDOUT_CASES, KNOWN_FALSE_POSITIVES } from "@/tests/detectors/eval/helpers/holdout-cases";
import { formatHoldoutTable, runHoldout, scoreHoldout } from "@/tests/detectors/eval/helpers/holdout";

/**
 * Hold-out evaluation (requirement 4). A regression figure over the first review's probes (the
 * fix round used them as targets), not a generalisation figure. It asserts only what requirement
 * 4.6 allows: every case ran with no detector error, the case counts, and a sanity floor of
 * recall 0.5 over the 28 flag cases. There is no threshold tuned to a result. The table is
 * printed for the record.
 *
 * One exception, from the second independent review: every id in `KNOWN_FALSE_POSITIVES` must
 * still produce a false positive, so that the list is updated when task 7 removes one. Nothing
 * else about false positives is asserted.
 */

const runs = runHoldout();
const score = scoreHoldout(HOLDOUT_CASES, runs);

describe("hold-out evaluation", () => {
  it("prints the result table", () => {
    console.log(`\n${formatHoldoutTable(score)}\n`);
    expect(score.outcomes).toHaveLength(HOLDOUT_CASES.length);
  });

  it("runs every case with no detector error", () => {
    // Requirement 4.2 and the second review: 56 cases became 58 with the two banner cases.
    expect(runs).toHaveLength(58);
    for (const run of runs) expect(run.errorMessages, run.caseId).toEqual([]);
    expect(score.errorCount).toBe(0);
  });

  it("keeps the case counts: 28 flag cases, 20 honest cases and 10 extras", () => {
    // Requirement 4.2 and the second review: 8 extras became 10 with the two banner cases.
    expect(score.flag.total).toBe(28);
    expect(score.honest.total).toBe(20);
    expect(score.extraFlag.total + score.extraHonest.total).toBe(10);
  });

  it("has a recall of at least 0.5 over the 28 flag cases (sanity floor)", () => {
    expect(score.flag.recall).toBeGreaterThanOrEqual(0.5);
  });

  it("still produces a false positive for every id in KNOWN_FALSE_POSITIVES", () => {
    const stale = [...score.honest.staleKnownIds, ...score.extraHonest.staleKnownIds];
    expect(
      stale,
      `These cases are listed in KNOWN_FALSE_POSITIVES but no longer produce a finding (task 7 may be done). ` +
        `Remove them from the list in tests/detectors/eval/helpers/holdout-cases.ts and update the record: ${stale.join(", ")}`
    ).toEqual([]);
    const flagged = [...score.honest.knownFalsePositiveIds, ...score.extraHonest.knownFalsePositiveIds];
    expect([...flagged].sort()).toEqual([...KNOWN_FALSE_POSITIVES].sort());
  });
});
