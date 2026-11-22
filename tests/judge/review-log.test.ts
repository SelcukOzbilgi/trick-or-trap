import { afterEach, describe, expect, it, vi } from "vitest";
import { EXPLANATIONS, TITLES } from "@/lib/detectors/shared/finding";
import type { DetectorRunResult } from "@/lib/detectors/index";
import { buildCandidates, ruleKind } from "@/lib/judge/candidates";
import type { BuiltCandidates } from "@/lib/judge/candidates";
import { JUDGE_PROMPT_VERSION, estimateCostUsd } from "@/lib/judge/constants";
import { JudgeHttpError } from "@/lib/judge/interface";
import type { JudgeClient, JudgeRawResponse } from "@/lib/judge/interface";
import { createMockJudge } from "@/lib/judge/mock";
import { createCooldown, reviewFindings } from "@/lib/judge/review";
import type { ReviewDeps } from "@/lib/judge/review";
import { JUDGE_STATUSES } from "@/lib/judge/types";
import type { JudgeLogRecord, JudgeStatus } from "@/lib/judge/types";
import type { Finding } from "@/lib/types";
import { createHarness, flush } from "@/tests/judge/helpers/harness";
import type { Harness } from "@/tests/judge/helpers/harness";
import {
  SNAPSHOT_CAPTURED_AT,
  makeSnapshot,
  makeText,
} from "@/tests/judge/helpers/snapshot";

// ---------------------------------------------------------------------------
// Sentinels: strings that must never reach a log record.
// ---------------------------------------------------------------------------

const PAGE_SENTINEL = "ZQXPAGE";
const URL_HOST_SENTINEL = "zqx-host";
const URL_PATH_SENTINEL = "zqx-path";
const PLACEHOLDER_GATEWAY_VALUE = "placeholder-gateway";
const PLACEHOLDER_HEADER_VALUE = "placeholder-header";
const PLACEHOLDER_RAW_VALUE = "placeholder-raw";
const PLACEHOLDER_ERROR_VALUE = "placeholder-error";

const SENTINELS = [
  PAGE_SENTINEL,
  URL_HOST_SENTINEL,
  URL_PATH_SENTINEL,
  PLACEHOLDER_GATEWAY_VALUE,
  PLACEHOLDER_HEADER_VALUE,
  PLACEHOLDER_RAW_VALUE,
  PLACEHOLDER_ERROR_VALUE,
];

const PAGE = makeSnapshot(
  [
    makeText("el-0", "p", `${PAGE_SENTINEL} only 3 left`),
    makeText("el-1", "span", `${PAGE_SENTINEL} selling fast today`),
  ],
  { url: `https://${URL_HOST_SENTINEL}.example/${URL_PATH_SENTINEL}?q=1` },
);

const TEXT_TITLE = TITLES["fake-scarcity"].find((title) => ruleKind(title) === "text") as string;

const RULES: Finding[] = [
  {
    patternId: "fake-scarcity",
    confidence: "medium",
    title: TEXT_TITLE,
    description: `Description with ${PAGE_SENTINEL}.`,
    evidence: { text: `${PAGE_SENTINEL} only 3 left` },
    elementIds: ["el-0"],
    boundingBoxes: [{ x: 1, y: 2, width: 3, height: 4 }],
    explanation: EXPLANATIONS["fake-scarcity"],
    detectorName: "fake-scarcity",
    detectedAt: SNAPSHOT_CAPTURED_AT,
  },
];

const RULE_RESULT: DetectorRunResult = { findings: RULES, errors: [] };

function idOf(built: BuiltCandidates, elementId: string): string {
  for (const [id, candidate] of built.map.candidates) {
    if (candidate.elementIds.includes(elementId)) return id;
  }
  throw new Error(`no candidate for ${elementId}`);
}

const BUILT = buildCandidates(PAGE, RULES);

const USAGE = { input: 2500, output: 150, cacheRead: 3000, cacheWrite: 0 };

function answer(output: object, extra: Partial<JudgeRawResponse> = {}): JudgeRawResponse {
  return { text: JSON.stringify(output), stopReason: "end_turn", usage: USAGE, ...extra };
}

const EMPTY_OUTPUT = { findings: [], verdicts: [] };

const RAN_OUTPUT = {
  findings: [
    {
      candidate: idOf(BUILT, "el-1"),
      pattern: "fake-scarcity",
      quote: `${PAGE_SENTINEL} selling`,
      confidence: "medium",
      reason: "selling-fast-claim",
    },
  ],
  verdicts: [{ rule: "r1", decision: "confirm", confidence: "high", reason: "vague-low-stock" }],
};

const ANOMALOUS_OUTPUT = {
  findings: Array.from({ length: 13 }, () => ({
    candidate: idOf(BUILT, "el-0"),
    pattern: "fake-scarcity",
    quote: `${PAGE_SENTINEL} only`,
    confidence: "low",
    reason: "vague-low-stock",
  })),
  verdicts: [],
};

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

type Setup = { harness: Harness; records: JudgeLogRecord[]; deps: ReviewDeps };

function setup(
  client: JudgeClient | undefined,
  over: Partial<ReviewDeps> = {},
  remainingMs = 20_000,
): Setup {
  const harness = createHarness();
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

/** An error shaped like an SDK error: a status, a message and headers. */
function sdkError(status: number): Error {
  return Object.assign(
    new Error(`failed with ${PLACEHOLDER_GATEWAY_VALUE} ${PLACEHOLDER_ERROR_VALUE}`),
    { status, headers: { "x-extra": PLACEHOLDER_HEADER_VALUE } },
  );
}

const REQUIRED_FIELDS = [
  "event",
  "judgeStatus",
  "promptVersion",
  "mode",
  "latencyMs",
  "attempts",
  "httpStatus",
  "stopReason",
  "usage",
  "estimatedCostUsd",
  "candidateCount",
  "truncated",
  "findingsReturned",
  "findingsKept",
  "verdicts",
  "anomalies",
];
const OPTIONAL_FIELDS = ["offReason", "urlHash"];

const SCENARIOS: [JudgeStatus, () => Setup][] = [
  ["ran", () => setup(createMockJudge(answer(RAN_OUTPUT)))],
  ["ran-anomalous", () => setup(createMockJudge(answer(ANOMALOUS_OUTPUT)))],
  ["off", () => setup(createMockJudge(answer(EMPTY_OUTPUT)), { mode: "off" })],
  ["skipped-no-time", () => setup(createMockJudge(answer(EMPTY_OUTPUT)), {}, 500)],
  [
    "skipped-cooldown",
    () => {
      const cooldown = createCooldown();
      const made = setup(createMockJudge(answer(EMPTY_OUTPUT)), { cooldown });
      cooldown.start(made.harness.now());
      return made;
    },
  ],
  ["skipped-over-budget", () => setup(createMockJudge(new JudgeHttpError(402, false)))],
  ["timeout", () => setup(createMockJudge("hang"))],
  ["error", () => setup(createMockJudge(new JudgeHttpError(400, false)))],
  [
    "invalid-output",
    () => setup(createMockJudge(answer(EMPTY_OUTPUT, { text: `{ ${PLACEHOLDER_RAW_VALUE}` }))),
  ],
];

function scenario(status: JudgeStatus): () => Setup {
  const found = SCENARIOS.find(([name]) => name === status);
  if (found === undefined) throw new Error(`no scenario for ${status}`);
  return found[1];
}

async function runScenario(make: () => Setup, status: JudgeStatus): Promise<Setup> {
  const made = make();
  const promise = reviewFindings(PAGE, RULE_RESULT, made.deps);
  await flush();
  if (status === "timeout") await made.harness.advance(8_000);
  await promise;
  return made;
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("the log record: one per scan", () => {
  it("covers every status of the closed list", () => {
    expect(SCENARIOS.map(([status]) => status).sort()).toEqual([...JUDGE_STATUSES].sort());
  });

  it.each(SCENARIOS)("emits exactly one record for %s", async (status, make) => {
    const { records } = await runScenario(make, status);
    expect(records).toHaveLength(1);
    expect(records[0].event).toBe("judge-review");
    expect(records[0].judgeStatus).toBe(status);
    expect(records[0].promptVersion).toBe(JUDGE_PROMPT_VERSION);
  });

  it("emits one record when the retry also fails", async () => {
    const client: JudgeClient = () => Promise.reject(sdkError(503));
    const { deps, records } = setup(client);
    await reviewFindings(PAGE, RULE_RESULT, deps);
    expect(records).toHaveLength(1);
  });

  it("writes the record as one JSON line through console.info by default", async () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    const { deps } = setup(createMockJudge(answer(EMPTY_OUTPUT)));
    await reviewFindings(PAGE, RULE_RESULT, { ...deps, log: undefined });
    expect(spy).toHaveBeenCalledTimes(1);
    const line = spy.mock.calls[0][0] as string;
    expect(typeof line).toBe("string");
    const parsed = JSON.parse(line) as JudgeLogRecord;
    expect(parsed.event).toBe("judge-review");
    expect(parsed.judgeStatus).toBe("ran");
    for (const sentinel of SENTINELS) expect(line).not.toContain(sentinel);
  });
});

describe("the log record: field set", () => {
  it.each(SCENARIOS)("holds only the fields of the design for %s", async (status, make) => {
    const { records } = await runScenario(make, status);
    const keys = Object.keys(records[0]);
    for (const field of REQUIRED_FIELDS) expect(keys).toContain(field);
    for (const key of keys) expect([...REQUIRED_FIELDS, ...OPTIONAL_FIELDS]).toContain(key);
    expect(Object.keys(records[0].usage).sort()).toEqual(
      ["cacheRead", "cacheWrite", "input", "output"],
    );
    expect(Object.keys(records[0].verdicts).sort()).toEqual(["confirm", "downgrade", "reject"]);
  });

  it("has exactly the required fields plus the url hash when one is given", async () => {
    const { deps, records } = setup(createMockJudge(answer(EMPTY_OUTPUT)), { urlHash: "abc123" });
    await reviewFindings(PAGE, RULE_RESULT, deps);
    expect(Object.keys(records[0]).sort()).toEqual([...REQUIRED_FIELDS, "urlHash"].sort());
    expect(records[0].urlHash).toBe("abc123");
  });

  it("omits the url hash and the off reason when they are not given", async () => {
    const { deps, records } = setup(createMockJudge(answer(EMPTY_OUTPUT)));
    await reviewFindings(PAGE, RULE_RESULT, deps);
    expect(Object.keys(records[0]).sort()).toEqual([...REQUIRED_FIELDS].sort());
  });
});

describe("the log record: values", () => {
  it("reports a run with counts, cost and the mode", async () => {
    const { deps, records } = setup(createMockJudge(answer(RAN_OUTPUT)));
    await reviewFindings(PAGE, RULE_RESULT, deps);
    const record = records[0];
    expect(record.mode).toBe("gateway");
    expect(record.attempts).toBe(1);
    expect(record.httpStatus).toBeNull();
    expect(record.stopReason).toBe("end_turn");
    expect(record.usage).toEqual(USAGE);
    expect(record.estimatedCostUsd).toBe(estimateCostUsd(USAGE));
    expect(record.candidateCount).toBe(BUILT.candidates.length);
    expect(record.truncated).toBe(false);
    expect(record.findingsReturned).toBe(1);
    expect(record.findingsKept).toBe(1);
    expect(record.verdicts).toEqual({ confirm: 1, downgrade: 0, reject: 0 });
    expect(record.anomalies).toEqual([]);
  });

  it("measures the latency with deps.now", async () => {
    const client = createMockJudge((_request, _opts) => {
      harness.moveClock(1_234);
      return answer(EMPTY_OUTPUT);
    });
    const { deps, records, harness } = setup(client);
    await reviewFindings(PAGE, RULE_RESULT, deps);
    expect(records[0].latencyMs).toBe(1_234);
  });

  it("reports zero usage and zero cost when no call answered", async () => {
    const { records } = await runScenario(scenario("error"), "error");
    expect(records[0].usage).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
    expect(records[0].estimatedCostUsd).toBe(0);
    expect(records[0].httpStatus).toBe(400);
    expect(records[0].stopReason).toBeNull();
  });

  it("reports the anomaly codes", async () => {
    const { records } = await runScenario(scenario("ran-anomalous"), "ran-anomalous");
    expect(records[0].anomalies).toEqual(["too-many-findings"]);
    expect(records[0].findingsReturned).toBe(13);
  });

  it("logs a stop reason outside the fixed set as other", async () => {
    const client = createMockJudge(
      answer(EMPTY_OUTPUT, { stopReason: `${PLACEHOLDER_RAW_VALUE}-stop` }),
    );
    const { deps, records } = setup(client);
    await reviewFindings(PAGE, RULE_RESULT, deps);
    expect(records[0].stopReason).toBe("other");
  });

  // Requirement 22.9 (replaces 14.2's set): the fixed set of logged stop
  // reasons now holds pause_turn and tool_use too.
  it.each(["end_turn", "max_tokens", "stop_sequence", "refusal", "pause_turn", "tool_use"])(
    "keeps the stop reason %s",
    async (stopReason) => {
      const client = createMockJudge(answer(EMPTY_OUTPUT, { stopReason }));
      const { deps, records } = setup(client);
      await reviewFindings(PAGE, RULE_RESULT, deps);
      expect(records[0].stopReason).toBe(stopReason);
    },
  );

  it.each([
    ["refusal", "refusal", "stop-refusal"],
    ["pause_turn", "pause_turn", "stop-pause-turn"],
    ["max_tokens", "max_tokens", "stop-max-tokens"],
    ["tool_use", "tool_use", "stop-tool-use"],
    ["", "other", "stop-unknown"],
    [`${PLACEHOLDER_RAW_VALUE}-stop`, "other", "stop-unknown"],
  ])(
    "logs one record with the code and the logged stop reason for stop reason %j (22.9)",
    async (stopReason, logged, code) => {
      const client = createMockJudge(answer(RAN_OUTPUT, { stopReason }));
      const { deps, records } = setup(client);
      const result = await reviewFindings(PAGE, RULE_RESULT, deps);
      expect(result.judge.status).toBe("invalid-output");
      expect(records).toHaveLength(1);
      expect(records[0].judgeStatus).toBe("invalid-output");
      expect(records[0].anomalies).toEqual([code]);
      expect(records[0].stopReason).toBe(logged);
      expect(records[0].findingsReturned).toBe(0);
      expect(records[0].findingsKept).toBe(0);
      expect(records[0].verdicts).toEqual({ confirm: 0, downgrade: 0, reject: 0 });
      expect(Object.keys(records[0]).sort()).toEqual([...REQUIRED_FIELDS].sort());
      const text = JSON.stringify(records[0]);
      expect(text).not.toContain(PLACEHOLDER_RAW_VALUE);
      for (const sentinel of SENTINELS) expect(text).not.toContain(sentinel);
    },
  );

  it("logs no code for an invalid answer at end_turn", async () => {
    const { records } = await runScenario(scenario("invalid-output"), "invalid-output");
    expect(records[0].anomalies).toEqual([]);
    expect(records[0].stopReason).toBe("end_turn");
  });

  it("says in the one record that the key is missing", async () => {
    const { deps, records } = setup(undefined, { mode: "off", offReason: "missing-key" });
    const result = await reviewFindings(PAGE, RULE_RESULT, deps);
    expect(result.judge.status).toBe("off");
    expect(records).toHaveLength(1);
    expect(records[0].offReason).toBe("missing-key");
    expect(records[0].mode).toBe("off");
  });
});

describe("the log record: no content", () => {
  it.each(SCENARIOS)("holds no sentinel for %s", async (status, make) => {
    const { records } = await runScenario(make, status);
    const text = JSON.stringify(records[0]);
    for (const sentinel of SENTINELS) expect(text).not.toContain(sentinel);
  });

  it("holds no sentinel when the client fails with a message, a status and a header", async () => {
    const client: JudgeClient = () => Promise.reject(sdkError(503));
    const { deps, records } = setup(client);
    const result = await reviewFindings(PAGE, RULE_RESULT, deps);
    const text = JSON.stringify(records[0]) + JSON.stringify(result.judge);
    for (const sentinel of SENTINELS) expect(text).not.toContain(sentinel);
    expect(records[0].attempts).toBe(2);
    expect(records[0].httpStatus).toBe(503);
  });

  it("holds no sentinel from a raw response with a sentinel in its text", async () => {
    const client = createMockJudge(
      answer(EMPTY_OUTPUT, { text: `raw ${PLACEHOLDER_RAW_VALUE} ${PAGE_SENTINEL}` }),
    );
    const { deps, records } = setup(client);
    const result = await reviewFindings(PAGE, RULE_RESULT, deps);
    expect(result.judge.status).toBe("invalid-output");
    const text = JSON.stringify(records[0]);
    for (const sentinel of SENTINELS) expect(text).not.toContain(sentinel);
  });

  it("holds no sentinel in the status of the result either", async () => {
    const client: JudgeClient = () => Promise.reject(sdkError(500));
    const { deps } = setup(client);
    const result = await reviewFindings(PAGE, RULE_RESULT, deps);
    expect(JSON.stringify(result.judge)).not.toContain(PLACEHOLDER_ERROR_VALUE);
  });
});
