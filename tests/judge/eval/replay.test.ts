import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { runAllDetectors } from "@/lib/detectors/all";
import { buildCandidates } from "@/lib/judge/candidates";
import { createMockJudge } from "@/lib/judge/mock";
import { buildJudgeRequest } from "@/lib/judge/prompt";
import { createCooldown, reviewFindings } from "@/lib/judge/review";
import { ReviewResultSchema } from "@/lib/judge/types";
import type { JudgeLogRecord, JudgeStatus, ReviewResult } from "@/lib/judge/types";
import { createHarness } from "@/tests/judge/helpers/harness";
import { buildCaseSnapshot, loadDevSet } from "@/tests/judge/eval/build-case";
import type { DevCase } from "@/tests/judge/eval/build-case";
import { noisyJudge } from "@/tests/judge/eval/fake-judges";
import { formatTable, scoreRun } from "@/tests/judge/eval/score";

// ---------------------------------------------------------------------------
// The replay test (16.15). The owner's live run on dev records the raw model
// answers into `tests/fixtures/judge-dev-responses.json` (design section 20).
// This test replays run 1 of each recorded case through validation and
// merging with the mock client, so real model output exercises the pipeline
// with no network. While the file does not exist, the replay is skipped.
// ---------------------------------------------------------------------------

const RECORDING_PATH = "tests/fixtures/judge-dev-responses.json";
const RECORDING_EXISTS = existsSync(join(process.cwd(), RECORDING_PATH));

const RecordingSchema = z.object({
  meta: z.object({
    promptVersion: z.string(),
    model: z.string(),
    mode: z.string(),
    recordedAt: z.string(),
    runs: z.number(),
  }),
  responses: z.array(
    z.object({
      caseId: z.string(),
      run: z.number(),
      text: z.string(),
      stopReason: z.string(),
      usage: z.object({
        input: z.number(),
        output: z.number(),
        cacheRead: z.number(),
        cacheWrite: z.number(),
      }),
    }),
  ),
});

type Recording = z.infer<typeof RecordingSchema>;

const ALLOWED_STATUSES: readonly JudgeStatus[] = ["ran", "ran-anomalous", "invalid-output"];

const devSet = loadDevSet();

type Replayed = { cases: DevCase[]; results: ReviewResult[]; rulesOnly: ReviewResult[] };

/** Replay run 1 of every recorded dev case. A case with no run 1 is not replayed. */
async function replay(recording: Recording): Promise<Replayed> {
  const first = new Map(
    recording.responses.filter((entry) => entry.run === 1).map((entry) => [entry.caseId, entry]),
  );
  const replayed: Replayed = { cases: [], results: [], rulesOnly: [] };
  for (const devCase of devSet.cases) {
    const recorded = first.get(devCase.id);
    if (recorded === undefined) continue;
    const snapshot = buildCaseSnapshot(devCase);
    const rules = runAllDetectors(snapshot);
    const harness = createHarness();
    const base = {
      now: harness.now,
      deadline: harness.now() + 20_000,
      cooldown: createCooldown(),
      log: (_record: JudgeLogRecord) => {},
      setTimer: harness.setTimer,
    };
    const client = createMockJudge({
      text: recorded.text,
      stopReason: recorded.stopReason,
      usage: { ...recorded.usage },
    });
    replayed.cases.push(devCase);
    replayed.results.push(
      await reviewFindings(snapshot, rules, { ...base, mode: "gateway", client }),
    );
    replayed.rulesOnly.push(await reviewFindings(snapshot, rules, { ...base, mode: "off" }));
  }
  return replayed;
}

function expectReplayInvariants(replayed: Replayed): void {
  for (const [index, result] of replayed.results.entries()) {
    const id = replayed.cases[index].id;
    expect(ReviewResultSchema.safeParse(result).success, id).toBe(true);
    expect(ALLOWED_STATUSES, id).toContain(result.judge.status);
    for (const entry of result.findings) {
      if (entry.source === "judge") expect(entry.finding.confidence, id).toBe("low");
    }
  }
}

// -- The plumbing, on an in-memory recording ----------------------------------

describe("replay plumbing on an in-memory recording", () => {
  const SAMPLE_SIZE = 12;
  let recording: Recording;

  beforeAll(() => {
    // Answers of the noisy fake, standing in for recorded model output.
    const responses = devSet.cases.slice(0, SAMPLE_SIZE).map((devCase) => {
      const snapshot = buildCaseSnapshot(devCase);
      const built = buildCandidates(snapshot, runAllDetectors(snapshot).findings);
      const answer = noisyJudge(buildJudgeRequest(built.data));
      return { caseId: devCase.id, run: 1, ...answer };
    });
    recording = RecordingSchema.parse({
      meta: {
        promptVersion: "in-memory",
        model: "none",
        mode: "off",
        recordedAt: "2026-11-21T12:00:00.000Z",
        runs: 1,
      },
      responses,
    });
  });

  it("replays run 1 of every recorded case with valid results", async () => {
    const replayed = await replay(recording);
    expect(replayed.cases.map((c) => c.id)).toEqual(
      devSet.cases.slice(0, SAMPLE_SIZE).map((c) => c.id),
    );
    expectReplayInvariants(replayed);
    expect(replayed.results.every((r) => r.judge.status !== "invalid-output")).toBe(true);
  });

  it("does not replay a run other than 1", async () => {
    const other: Recording = {
      ...recording,
      responses: recording.responses.map((entry) => ({ ...entry, run: 2 })),
    };
    const replayed = await replay(other);
    expect(replayed.cases).toEqual([]);
  });

  it("turns an unusable recorded answer into invalid-output and keeps the rule findings", async () => {
    const broken: Recording = {
      ...recording,
      responses: recording.responses.slice(0, 3).map((entry) => ({ ...entry, text: "not json" })),
    };
    const replayed = await replay(broken);
    expect(replayed.results).toHaveLength(3);
    expectReplayInvariants(replayed);
    for (const [index, result] of replayed.results.entries()) {
      expect(result.judge.status).toBe("invalid-output");
      expect(result.findings.map((entry) => entry.finding)).toEqual(
        replayed.rulesOnly[index].findings.map((entry) => entry.finding),
      );
    }
  });
});

// -- The recorded responses of the owner's live run ---------------------------

describe.skipIf(!RECORDING_EXISTS)("replay of the recorded dev responses", () => {
  let recording: Recording;
  let replayed: Replayed;

  beforeAll(async () => {
    recording = RecordingSchema.parse(
      JSON.parse(readFileSync(join(process.cwd(), RECORDING_PATH), "utf8")),
    );
    replayed = await replay(recording);
    console.info(
      `replay of ${replayed.cases.length} recorded dev cases, prompt version ${recording.meta.promptVersion}\n${formatTable(
        [
          { label: "rules-only", score: scoreRun(replayed.cases, replayed.rulesOnly) },
          { label: "rules+judge", score: scoreRun(replayed.cases, replayed.results) },
        ],
      )}`,
    );
  }, 60_000);

  it("holds only responses of dev cases", () => {
    const ids = new Set(devSet.cases.map((c) => c.id));
    for (const entry of recording.responses) expect(ids.has(entry.caseId)).toBe(true);
  });

  it("replays every recorded case with valid results", () => {
    expect(replayed.cases.length).toBeGreaterThan(0);
    expectReplayInvariants(replayed);
  });
});
