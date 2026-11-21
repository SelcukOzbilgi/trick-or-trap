import { describe, expect, it, vi } from "vitest";
import { EXPLANATIONS, TITLES } from "@/lib/detectors/shared/finding";
import type { DetectorRunResult } from "@/lib/detectors/index";
import {
  COOLDOWN_MS,
  RETRYABLE_STATUSES,
  estimateCostUsd,
} from "@/lib/judge/constants";
import { JudgeHttpError } from "@/lib/judge/interface";
import type { JudgeClient, JudgeRawResponse } from "@/lib/judge/interface";
import { createMockJudge, readPageData } from "@/lib/judge/mock";
import { createCooldown, defaultCooldown, reviewFindings } from "@/lib/judge/review";
import type { ReviewDeps } from "@/lib/judge/review";
import { JUDGE_STATUSES, ReviewResultSchema } from "@/lib/judge/types";
import type { JudgeLogRecord, JudgePatternId, JudgeStatus } from "@/lib/judge/types";
import { buildCandidates, ruleKind } from "@/lib/judge/candidates";
import type { BuiltCandidates } from "@/lib/judge/candidates";
import { mergeReview } from "@/lib/judge/merge";
import type { Confidence, Finding } from "@/lib/types";
import { createHarness, flush } from "@/tests/judge/helpers/harness";
import type { Harness } from "@/tests/judge/helpers/harness";
import {
  SNAPSHOT_CAPTURED_AT,
  makeSnapshot,
  makeText,
} from "@/tests/judge/helpers/snapshot";

// The builder and the merge are wrapped so that one test can make them throw.
// Every other call goes to the real function.
vi.mock("@/lib/judge/candidates", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/judge/candidates")>();
  return { ...actual, buildCandidates: vi.fn(actual.buildCandidates) };
});
vi.mock("@/lib/judge/merge", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/judge/merge")>();
  return { ...actual, mergeReview: vi.fn(actual.mergeReview) };
});

// ---------------------------------------------------------------------------
// Page, rule findings and responses
// ---------------------------------------------------------------------------

const PAGE = makeSnapshot([
  makeText("el-0", "p", "Only 3 left in stock"),
  makeText("el-1", "p", "Free delivery on all orders"),
  makeText("el-2", "span", "Selling fast, order today"),
]);

const TEXT_TITLE = TITLES["fake-scarcity"].find((title) => ruleKind(title) === "text") as string;

function ruleFinding(
  patternId: JudgePatternId,
  title: string,
  elementIds: string[],
  confidence: Confidence = "medium",
): Finding {
  return {
    patternId,
    confidence,
    title,
    description: `Description of ${title}.`,
    evidence: { text: "Evidence of the rule finding.", measuredValues: { n: 1 } },
    elementIds,
    boundingBoxes: elementIds.map(() => ({ x: 1, y: 2, width: 3, height: 4 })),
    explanation: EXPLANATIONS[patternId],
    detectorName: patternId,
    detectedAt: SNAPSHOT_CAPTURED_AT,
  };
}

const RULES: Finding[] = [ruleFinding("fake-scarcity", TEXT_TITLE, ["el-0"])];

function ruleResult(findings: Finding[] = RULES, errorCount = 0): DetectorRunResult {
  return {
    findings,
    errors: Array.from({ length: errorCount }, (_, i) => ({
      detectorName: `detector-${i}`,
      kind: "threw" as const,
      message: `Detector "detector-${i}" threw: fixed`,
    })),
  };
}

const USAGE = { input: 3000, output: 200, cacheRead: 100, cacheWrite: 50 };

function response(output: object, extra: Partial<JudgeRawResponse> = {}): JudgeRawResponse {
  return { text: JSON.stringify(output), stopReason: "end_turn", usage: USAGE, ...extra };
}

const EMPTY_OUTPUT = { findings: [], verdicts: [] };

function candidateIdOf(built: BuiltCandidates, elementId: string): string {
  for (const [id, candidate] of built.map.candidates) {
    if (candidate.elementIds.includes(elementId)) return id;
  }
  throw new Error(`no candidate for ${elementId}`);
}

function ruleIdOf(built: BuiltCandidates, sourceIndex: number): string {
  for (const [id, rule] of built.map.rules) {
    if (rule.index === sourceIndex) return id;
  }
  throw new Error(`rule ${sourceIndex} was not sent`);
}

/** The real builder's ids, taken before any test installs a throwing stub. */
const BUILT = buildCandidates(PAGE, RULES);
const CANDIDATE_COUNT = BUILT.candidates.length;
const RAN_OUTPUT = {
  findings: [
    {
      candidate: candidateIdOf(BUILT, "el-2"),
      pattern: "fake-scarcity",
      quote: "Selling fast",
      confidence: "medium",
      reason: "selling-fast-claim",
    },
  ],
  verdicts: [
    {
      rule: ruleIdOf(BUILT, 0),
      decision: "confirm",
      confidence: "high",
      reason: "vague-low-stock",
    },
  ],
};

// ---------------------------------------------------------------------------
// Deps
// ---------------------------------------------------------------------------

type Setup = {
  harness: Harness;
  records: JudgeLogRecord[];
  deps: ReviewDeps;
};

function setup(
  client: JudgeClient | undefined,
  over: Partial<ReviewDeps> = {},
  remainingMs = 20_000,
  harness: Harness = createHarness(),
): Setup {
  const records: JudgeLogRecord[] = [];
  const deps: ReviewDeps = {
    mode: "gateway",
    client,
    now: harness.now,
    deadline: harness.now() + remainingMs,
    cooldown: createCooldown(),
    log: (record) => records.push(record),
    setTimer: harness.setTimer,
    ...over,
  };
  return { harness, records, deps };
}

function sources(result: Awaited<ReturnType<typeof reviewFindings>>): string[] {
  return result.findings.map((entry) => entry.source);
}

function expectRulesOnly(
  result: Awaited<ReturnType<typeof reviewFindings>>,
  rules: Finding[] = RULES,
): void {
  expect(result.findings.map((entry) => entry.finding)).toEqual(rules);
  expect(sources(result).every((source) => source === "rules")).toBe(true);
  expect(result.setAside).toEqual([]);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("reviewFindings: off", () => {
  it("makes no call when the mode is off, even with a client", async () => {
    const client = createMockJudge(response(EMPTY_OUTPUT));
    const { deps, records } = setup(client, { mode: "off" });
    const result = await reviewFindings(PAGE, ruleResult(), deps);
    expect(client.calls).toBe(0);
    expect(result.judge).toEqual({ status: "off", candidateCount: 0, truncated: false });
    expectRulesOnly(result);
    expect(records).toHaveLength(1);
  });

  it("returns status off when the mode is on and the client is absent", async () => {
    const { deps } = setup(undefined);
    const result = await reviewFindings(PAGE, ruleResult(), deps);
    expect(result.judge.status).toBe("off");
    expectRulesOnly(result);
  });
});

describe("reviewFindings: cooldown and time", () => {
  it("skips while the cooldown is active", async () => {
    const client = createMockJudge(response(EMPTY_OUTPUT));
    const cooldown = createCooldown();
    const { deps, harness } = setup(client);
    cooldown.start(harness.now());
    const result = await reviewFindings(PAGE, ruleResult(), { ...deps, cooldown });
    expect(client.calls).toBe(0);
    expect(result.judge.status).toBe("skipped-cooldown");
    expectRulesOnly(result);
  });

  it("skips with 2,999 ms left and calls with 3,000 ms left", async () => {
    const low = createMockJudge(response(EMPTY_OUTPUT));
    const first = setup(low, {}, 2_999);
    const skipped = await reviewFindings(PAGE, ruleResult(), first.deps);
    expect(low.calls).toBe(0);
    expect(skipped.judge.status).toBe("skipped-no-time");
    expectRulesOnly(skipped);

    const enough = createMockJudge(response(EMPTY_OUTPUT));
    const second = setup(enough, {}, 3_000);
    const ran = await reviewFindings(PAGE, ruleResult(), second.deps);
    expect(enough.calls).toBe(1);
    expect(ran.judge.status).toBe("ran");
  });

  it.each([
    [20_000, 8_000],
    [9_500, 8_000],
    [9_499, 7_999],
    [5_000, 3_500],
    [3_000, 1_500],
  ])("with %i ms left the first timeout is %i ms", async (remaining, expected) => {
    const client = createMockJudge(response(EMPTY_OUTPUT));
    const { deps } = setup(client, {}, remaining);
    await reviewFindings(PAGE, ruleResult(), deps);
    expect(client.timeouts).toEqual([expected]);
  });
});

describe("reviewFindings: the call", () => {
  it("passes the request, an abort signal and the timeout to the client", async () => {
    const seen: { signal: AbortSignal; timeoutMs: number }[] = [];
    const client = createMockJudge((_request, opts) => {
      seen.push(opts);
      return response(EMPTY_OUTPUT);
    });
    const { deps } = setup(client);
    const result = await reviewFindings(PAGE, ruleResult(), deps);
    expect(seen).toHaveLength(1);
    expect(seen[0].signal).toBeInstanceOf(AbortSignal);
    expect(seen[0].signal.aborted).toBe(false);
    expect(seen[0].timeoutMs).toBe(8_000);
    const request = client.requests[0];
    expect(request.maxTokens).toBe(1_400);
    expect(readPageData(request).candidates).toHaveLength(result.judge.candidateCount);
  });

  it("aborts the signal of a first attempt that times out, and does not retry", async () => {
    const signals: AbortSignal[] = [];
    const hangs: JudgeClient = (_request, opts) => {
      signals.push(opts.signal);
      return new Promise<JudgeRawResponse>(() => {});
    };
    const { deps, harness, records } = setup(hangs);
    const promise = reviewFindings(PAGE, ruleResult(), deps);
    await flush();
    expect(signals).toHaveLength(1);
    await harness.advance(7_999);
    expect(signals[0].aborted).toBe(false);
    await harness.advance(1);
    const result = await promise;
    expect(signals[0].aborted).toBe(true);
    expect(signals).toHaveLength(1);
    expect(result.judge.status).toBe("timeout");
    expect(result.judge.candidateCount).toBe(CANDIDATE_COUNT);
    expectRulesOnly(result);
    expect(records[0].attempts).toBe(1);
    expect(harness.pendingTimers()).toBe(0);
  });

  it("settles on a hanging mock when its signal aborts", async () => {
    const client = createMockJudge("hang");
    const { deps, harness } = setup(client);
    const promise = reviewFindings(PAGE, ruleResult(), deps);
    await flush();
    await harness.advance(8_000);
    expect((await promise).judge.status).toBe("timeout");
    expect(client.calls).toBe(1);
  });

  it("counts a failure after the timeout has elapsed as a timeout", async () => {
    const client = createMockJudge((_request, _opts) => {
      harness.moveClock(8_000);
      return new JudgeHttpError(503, true);
    });
    const { deps, harness } = setup(client);
    const result = await reviewFindings(PAGE, ruleResult(), deps);
    expect(result.judge.status).toBe("timeout");
    expect(client.calls).toBe(1);
  });

  it("cancels its timer when the call settles", async () => {
    const client = createMockJudge(response(EMPTY_OUTPUT));
    const { deps, harness } = setup(client);
    await reviewFindings(PAGE, ruleResult(), deps);
    expect(harness.pendingTimers()).toBe(0);
  });
});

describe("reviewFindings: retry", () => {
  it.each([...RETRYABLE_STATUSES])(
    "retries once after status %i with the second timeout",
    async (status) => {
      const client = createMockJudge([
        new JudgeHttpError(status, true),
        response(EMPTY_OUTPUT),
      ]);
      const { deps, records } = setup(client);
      const result = await reviewFindings(PAGE, ruleResult(), deps);
      expect(client.calls).toBe(2);
      expect(client.timeouts).toEqual([8_000, 6_000]);
      expect(result.judge.status).toBe("ran");
      expect(records[0].attempts).toBe(2);
    },
  );

  it("retries after a connection error", async () => {
    const client = createMockJudge([new JudgeHttpError(null, true), response(EMPTY_OUTPUT)]);
    const { deps } = setup(client);
    const result = await reviewFindings(PAGE, ruleResult(), deps);
    expect(client.calls).toBe(2);
    expect(result.judge.status).toBe("ran");
  });

  it("uses a fresh abort signal for the retry", async () => {
    const signals: AbortSignal[] = [];
    const client = createMockJudge((_request, opts) => {
      signals.push(opts.signal);
      return signals.length === 1 ? new JudgeHttpError(503, true) : response(EMPTY_OUTPUT);
    });
    const { deps } = setup(client);
    await reviewFindings(PAGE, ruleResult(), deps);
    expect(signals).toHaveLength(2);
    expect(signals[0]).not.toBe(signals[1]);
  });

  it("retries with 5,000 ms left and caps the second timeout by the deadline", async () => {
    const client = createMockJudge([
      (_request, _opts) => {
        harness.moveClock(5_000);
        return new JudgeHttpError(503, true);
      },
      response(EMPTY_OUTPUT),
    ]);
    const { deps, harness } = setup(client, {}, 10_000);
    const result = await reviewFindings(PAGE, ruleResult(), deps);
    expect(client.calls).toBe(2);
    expect(client.timeouts).toEqual([8_000, 4_000]);
    expect(result.judge.status).toBe("ran");
  });

  it("does not retry with 4,999 ms left", async () => {
    const client = createMockJudge([
      (_request, _opts) => {
        harness.moveClock(5_001);
        return new JudgeHttpError(503, true);
      },
      response(EMPTY_OUTPUT),
    ]);
    const { deps, harness } = setup(client, {}, 10_000);
    const result = await reviewFindings(PAGE, ruleResult(), deps);
    expect(client.calls).toBe(1);
    expect(result.judge.status).toBe("error");
    expectRulesOnly(result);
  });

  it.each([400, 401, 403, 404])("does not retry after status %i", async (status) => {
    const client = createMockJudge([new JudgeHttpError(status, false), response(EMPTY_OUTPUT)]);
    const { deps, records } = setup(client);
    const result = await reviewFindings(PAGE, ruleResult(), deps);
    expect(client.calls).toBe(1);
    expect(result.judge.status).toBe("error");
    expect(records[0].httpStatus).toBe(status);
    expectRulesOnly(result);
  });

  it.each([400, 401, 403, 404])(
    "does not retry after status %i even when the error says retryable",
    async (status) => {
      const client = createMockJudge([new JudgeHttpError(status, true), response(EMPTY_OUTPUT)]);
      const { deps } = setup(client);
      const result = await reviewFindings(PAGE, ruleResult(), deps);
      expect(client.calls).toBe(1);
      expect(result.judge.status).toBe("error");
    },
  );

  it("returns timeout when the retry times out", async () => {
    const client = createMockJudge([new JudgeHttpError(503, true), "hang"]);
    const { deps, harness } = setup(client);
    const promise = reviewFindings(PAGE, ruleResult(), deps);
    await flush();
    expect(client.calls).toBe(2);
    await harness.advance(6_000);
    const result = await promise;
    expect(result.judge.status).toBe("timeout");
    expectRulesOnly(result);
  });

  it("returns error when the retry fails with another error", async () => {
    const client = createMockJudge([
      new JudgeHttpError(503, true),
      new JudgeHttpError(500, true),
      response(EMPTY_OUTPUT),
    ]);
    const { deps } = setup(client);
    const result = await reviewFindings(PAGE, ruleResult(), deps);
    expect(client.calls).toBe(2);
    expect(result.judge.status).toBe("error");
  });

  it("makes at most two calls", async () => {
    const client = createMockJudge(new JudgeHttpError(503, true));
    const { deps } = setup(client);
    await reviewFindings(PAGE, ruleResult(), deps);
    expect(client.calls).toBe(2);
  });
});

describe("reviewFindings: budget and cooldown", () => {
  it("maps 402 to skipped-over-budget and starts a 10-minute cooldown", async () => {
    const harness = createHarness();
    const cooldown = createCooldown();
    const client = createMockJudge([new JudgeHttpError(402, false), response(EMPTY_OUTPUT)]);

    const first = setup(client, { cooldown }, 20_000, harness);
    const over = await reviewFindings(PAGE, ruleResult(), first.deps);
    expect(over.judge.status).toBe("skipped-over-budget");
    expectRulesOnly(over);
    expect(client.calls).toBe(1);

    harness.moveClock(COOLDOWN_MS - 1);
    const second = setup(client, { cooldown }, 20_000, harness);
    const skipped = await reviewFindings(PAGE, ruleResult(), second.deps);
    expect(skipped.judge.status).toBe("skipped-cooldown");
    expect(client.calls).toBe(1);

    harness.moveClock(1);
    const third = setup(client, { cooldown }, 20_000, harness);
    const ran = await reviewFindings(PAGE, ruleResult(), third.deps);
    expect(client.calls).toBe(2);
    expect(ran.judge.status).toBe("ran");
  });

  it("maps a 402 on the retry to skipped-over-budget as well", async () => {
    const cooldown = createCooldown();
    const client = createMockJudge([new JudgeHttpError(503, true), new JudgeHttpError(402, false)]);
    const { deps, harness } = setup(client, { cooldown });
    const result = await reviewFindings(PAGE, ruleResult(), deps);
    expect(result.judge.status).toBe("skipped-over-budget");
    expect(cooldown.isActive(harness.now())).toBe(true);
  });

  it("does not start the cooldown for other failures", async () => {
    const cooldown = createCooldown();
    const client = createMockJudge(new JudgeHttpError(400, false));
    const { deps, harness } = setup(client, { cooldown });
    await reviewFindings(PAGE, ruleResult(), deps);
    expect(cooldown.isActive(harness.now())).toBe(false);
  });
});

describe("createCooldown", () => {
  it("is inactive until started, then active for the whole period", () => {
    const cooldown = createCooldown();
    expect(cooldown.isActive(5)).toBe(false);
    cooldown.start(1_000);
    expect(cooldown.isActive(1_000)).toBe(true);
    expect(cooldown.isActive(1_000 + COOLDOWN_MS - 1)).toBe(true);
    expect(cooldown.isActive(1_000 + COOLDOWN_MS)).toBe(false);
  });

  it("takes its length from the argument", () => {
    const cooldown = createCooldown(50);
    cooldown.start(0);
    expect(cooldown.isActive(49)).toBe(true);
    expect(cooldown.isActive(50)).toBe(false);
  });

  it("keeps separate state per cooldown", () => {
    const a = createCooldown();
    const b = createCooldown();
    a.start(0);
    expect(b.isActive(0)).toBe(false);
  });

  it("exports a default cooldown that starts inactive", () => {
    expect(typeof defaultCooldown.isActive).toBe("function");
    expect(typeof defaultCooldown.start).toBe("function");
    expect(defaultCooldown.isActive(0)).toBe(false);
  });
});

describe("reviewFindings: a run", () => {
  it("merges verdicts and new findings and reports the counts", async () => {
    const client = createMockJudge(response(RAN_OUTPUT));
    const { deps, records } = setup(client);
    const result = await reviewFindings(PAGE, ruleResult(), deps);
    expect(result.judge).toEqual({
      status: "ran",
      candidateCount: CANDIDATE_COUNT,
      truncated: false,
    });
    expect(sources(result)).toEqual(["rules+judge", "judge"]);
    const added = result.findings[1].finding;
    expect(added.confidence).toBe("low");
    expect(added.detectorName).toBe("judge");
    expect(added.title.startsWith("Possible")).toBe(true);
    expect(ReviewResultSchema.safeParse(result).success).toBe(true);
    expect(records[0].judgeStatus).toBe("ran");
    expect(records[0].findingsReturned).toBe(1);
    expect(records[0].findingsKept).toBe(1);
    expect(records[0].verdicts).toEqual({ confirm: 1, downgrade: 0, reject: 0 });
    expect(records[0].anomalies).toEqual([]);
  });

  it("sets a rule finding aside on a high-confidence reject", async () => {
    const rules = [
      ruleFinding("fake-scarcity", TEXT_TITLE, ["el-0"]),
      ruleFinding("fake-scarcity", TEXT_TITLE, ["el-1"]),
    ];
    const built = buildCandidates(PAGE, rules);
    const client = createMockJudge(
      response({
        findings: [],
        verdicts: [
          {
            rule: ruleIdOf(built, 0),
            decision: "reject",
            confidence: "high",
            reason: "neutral-stock-fact",
          },
        ],
      }),
    );
    const { deps } = setup(client);
    const result = await reviewFindings(PAGE, ruleResult(rules), deps);
    expect(result.judge.status).toBe("ran");
    expect(result.setAside).toHaveLength(1);
    expect(result.setAside[0].finding).toEqual(rules[0]);
    expect(result.findings.map((entry) => entry.finding)).toEqual([rules[1]]);
  });

  it("reports ran-anomalous and ignores every verdict", async () => {
    const candidate = candidateIdOf(BUILT, "el-0");
    const findings = Array.from({ length: 13 }, () => ({
      candidate,
      pattern: "fake-scarcity",
      quote: "Only 3",
      confidence: "low",
      reason: "vague-low-stock",
    }));
    const client = createMockJudge(
      response({
        findings,
        verdicts: [
          {
            rule: ruleIdOf(BUILT, 0),
            decision: "downgrade",
            confidence: "high",
            reason: "insufficient-context",
          },
        ],
      }),
    );
    const { deps, records } = setup(client);
    const result = await reviewFindings(PAGE, ruleResult(), deps);
    expect(result.judge.status).toBe("ran-anomalous");
    expectRulesOnly(result);
    expect(records[0].anomalies).toEqual(["too-many-findings"]);
    expect(records[0].findingsReturned).toBe(13);
  });

  it("reports invalid-output without a retry and keeps the rule findings", async () => {
    const client = createMockJudge([response(EMPTY_OUTPUT, { text: "not json" }), response(EMPTY_OUTPUT)]);
    const { deps } = setup(client);
    const result = await reviewFindings(PAGE, ruleResult(), deps);
    expect(client.calls).toBe(1);
    expect(result.judge).toEqual({
      status: "invalid-output",
      candidateCount: CANDIDATE_COUNT,
      truncated: false,
    });
    expectRulesOnly(result);
  });

  it("reports invalid-output for a response cut at the token limit", async () => {
    const client = createMockJudge(response(EMPTY_OUTPUT, { stopReason: "max_tokens" }));
    const { deps } = setup(client);
    const result = await reviewFindings(PAGE, ruleResult(), deps);
    expect(result.judge.status).toBe("invalid-output");
  });

  it("sorts the rule findings by document position when the judge did not run", async () => {
    const early = ruleFinding("fake-scarcity", TEXT_TITLE, ["el-0"]);
    const late = ruleFinding("fake-scarcity", TEXT_TITLE, ["el-2"]);
    const { deps } = setup(undefined, { mode: "off" });
    const result = await reviewFindings(PAGE, ruleResult([late, early]), deps);
    expect(result.findings.map((entry) => entry.finding)).toEqual([early, late]);
  });
});

describe("reviewFindings: result fields", () => {
  it("sets ruleErrors from the rule result in every case", async () => {
    const off = setup(undefined, { mode: "off" });
    expect((await reviewFindings(PAGE, ruleResult(RULES, 2), off.deps)).ruleErrors).toBe(2);
    const ran = setup(createMockJudge(response(EMPTY_OUTPUT)));
    expect((await reviewFindings(PAGE, ruleResult(RULES, 3), ran.deps)).ruleErrors).toBe(3);
  });

  it("sets truncated and a candidate count of 60 for a long page", async () => {
    const long = makeSnapshot(
      Array.from({ length: 70 }, (_, i) => makeText(`el-${i}`, "p", `Line number ${i} of text`)),
    );
    const client = createMockJudge(response(EMPTY_OUTPUT));
    const { deps } = setup(client);
    const result = await reviewFindings(long, ruleResult([]), deps);
    expect(result.judge).toEqual({ status: "ran", candidateCount: 60, truncated: true });
  });

  it("sets zero and false when no candidates were built", async () => {
    const client = createMockJudge(response(EMPTY_OUTPUT));
    const { deps } = setup(client, {}, 1_000);
    const result = await reviewFindings(PAGE, ruleResult(), deps);
    expect(result.judge).toEqual({ status: "skipped-no-time", candidateCount: 0, truncated: false });
  });
});

describe("reviewFindings: every status other than ran", () => {
  const scenarios: [JudgeStatus, () => Setup][] = [
    ["off", () => setup(createMockJudge(response(EMPTY_OUTPUT)), { mode: "off" })],
    ["skipped-no-time", () => setup(createMockJudge(response(EMPTY_OUTPUT)), {}, 100)],
    [
      "skipped-cooldown",
      () => {
        const cooldown = createCooldown();
        const made = setup(createMockJudge(response(EMPTY_OUTPUT)), { cooldown });
        cooldown.start(made.harness.now());
        return made;
      },
    ],
    ["skipped-over-budget", () => setup(createMockJudge(new JudgeHttpError(402, false)))],
    ["timeout", () => setup(createMockJudge("hang"))],
    ["error", () => setup(createMockJudge(new JudgeHttpError(400, false)))],
    [
      "invalid-output",
      () => setup(createMockJudge(response(EMPTY_OUTPUT, { text: "{" }))),
    ],
  ];

  it.each(scenarios)("%s returns the rule findings unchanged", async (status, make) => {
    const { deps, harness } = make();
    const promise = reviewFindings(PAGE, ruleResult(RULES, 2), deps);
    await flush();
    if (status === "timeout") await harness.advance(8_000);
    const result = await promise;
    expect(result.judge.status).toBe(status);
    expectRulesOnly(result);
    expect(result.ruleErrors).toBe(2);
    expect(ReviewResultSchema.safeParse(result).success).toBe(true);
  });

  it("covers every status of the closed list except the two that ran", () => {
    const covered = scenarios.map(([status]) => status);
    const expected = JUDGE_STATUSES.filter(
      (status) => status !== "ran" && status !== "ran-anomalous",
    );
    expect([...covered].sort()).toEqual([...expected].sort());
  });
});

describe("reviewFindings: never rejects", () => {
  it("returns error when the builder throws", async () => {
    vi.mocked(buildCandidates).mockImplementationOnce(() => {
      throw new Error("builder failed");
    });
    const client = createMockJudge(response(EMPTY_OUTPUT));
    const { deps } = setup(client);
    const result = await reviewFindings(PAGE, ruleResult(RULES, 1), deps);
    expect(client.calls).toBe(0);
    expect(result.judge).toEqual({ status: "error", candidateCount: 0, truncated: false });
    expectRulesOnly(result);
    expect(result.ruleErrors).toBe(1);
  });

  it("returns error when the merge throws", async () => {
    vi.mocked(mergeReview).mockImplementationOnce(() => {
      throw new Error("merge failed");
    });
    const client = createMockJudge(response(RAN_OUTPUT));
    const { deps } = setup(client);
    const result = await reviewFindings(PAGE, ruleResult(), deps);
    expect(result.judge.status).toBe("error");
    expectRulesOnly(result);
  });

  it("returns error when the client throws before it returns a promise", async () => {
    const client: JudgeClient = () => {
      throw new Error("sync failure");
    };
    const { deps } = setup(client);
    const result = await reviewFindings(PAGE, ruleResult(), deps);
    expect(result.judge.status).toBe("error");
    expectRulesOnly(result);
  });

  it("returns error when the client rejects with a value that is not an error", async () => {
    const client: JudgeClient = () => Promise.reject("plain text");
    const { deps } = setup(client);
    const result = await reviewFindings(PAGE, ruleResult(), deps);
    expect(result.judge.status).toBe("error");
  });

  it("still resolves when the log function throws", async () => {
    const client = createMockJudge(response(EMPTY_OUTPUT));
    const { deps } = setup(client, {
      log: () => {
        throw new Error("log failed");
      },
    });
    const result = await reviewFindings(PAGE, ruleResult(), deps);
    expect(result.judge.status).toBe("ran");
  });

  it("still resolves when the timer function throws", async () => {
    const client = createMockJudge(response(EMPTY_OUTPUT));
    const { deps } = setup(client, {
      setTimer: () => {
        throw new Error("timer failed");
      },
    });
    const result = await reviewFindings(PAGE, ruleResult(), deps);
    expect(result.judge.status).toBe("error");
    expectRulesOnly(result);
  });

  it("still resolves when the rule result cannot be read", async () => {
    const broken = {
      get findings(): Finding[] {
        throw new Error("unreadable");
      },
      get errors(): DetectorRunResult["errors"] {
        throw new Error("unreadable");
      },
    } as DetectorRunResult;
    const { deps } = setup(createMockJudge(response(EMPTY_OUTPUT)));
    const result = await reviewFindings(PAGE, broken, deps);
    expect(result.judge.status).toBe("error");
    expect(result.findings).toEqual([]);
    expect(result.ruleErrors).toBe(0);
    expect(ReviewResultSchema.safeParse(result).success).toBe(true);
  });
});

describe("reviewFindings: cost figures", () => {
  it("estimates the cost of the call that answered", async () => {
    const client = createMockJudge(response(EMPTY_OUTPUT));
    const { deps, records } = setup(client);
    await reviewFindings(PAGE, ruleResult(), deps);
    expect(records[0].usage).toEqual(USAGE);
    expect(records[0].estimatedCostUsd).toBe(estimateCostUsd(USAGE));
  });
});
