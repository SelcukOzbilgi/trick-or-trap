import type { DetectorRunResult } from "@/lib/detectors/index";
import { buildIndex } from "@/lib/detectors/shared/elements";
import { buildCandidates } from "@/lib/judge/candidates";
import {
  COOLDOWN_MS,
  FIRST_MARGIN_MS,
  FIRST_TIMEOUT_MS,
  JUDGE_PROMPT_VERSION,
  MIN_REMAINING_MS,
  RETRY_MARGIN_MS,
  RETRY_MIN_REMAINING_MS,
  RETRY_TIMEOUT_MS,
  estimateCostUsd,
} from "@/lib/judge/constants";
import { toJudgeHttpError } from "@/lib/judge/interface";
import type { JudgeClient, JudgeHttpError, JudgeRawResponse } from "@/lib/judge/interface";
import { mergeReview } from "@/lib/judge/merge";
import type { MergeOutput } from "@/lib/judge/merge";
import { buildJudgeRequest } from "@/lib/judge/prompt";
import type { JudgeRequest } from "@/lib/judge/prompt";
import { validateOutput } from "@/lib/judge/validate";
import type {
  AnomalyCode,
  JudgeLogRecord,
  JudgeMode,
  JudgeStatus,
  JudgeUsage,
  LoggedStopReason,
  OffReason,
  ReviewResult,
  ReviewedFinding,
} from "@/lib/judge/types";
import type { Finding, PageSnapshot } from "@/lib/types";

/**
 * The orchestrator of the model judge (requirements 13 and 14, design section
 * 17). `reviewFindings` runs after the rules: it builds the candidates, makes
 * one call (plus at most one retry) through the injected client, validates the
 * answer, merges it, and returns a `ReviewResult`. It never rejects. Any
 * failure gives the rule findings unchanged and a status that says why the
 * reviewer did not run.
 *
 * Time comes only from `deps.now`, and timeouts only from `deps.setTimer`.
 * The module holds no state except `defaultCooldown`.
 */

// -- Dependencies -------------------------------------------------------------

/** The cooldown after a spend limit: one instance per process or per test. */
export type JudgeCooldown = {
  isActive(now: number): boolean;
  start(now: number): void;
};

export type ReviewDeps = {
  mode: JudgeMode;
  /** Why the mode is off; copied into the log record. */
  offReason?: OffReason;
  client?: JudgeClient;
  now: () => number;
  /** Absolute time, in the unit of `now`, by which the whole scan must end. */
  deadline: number;
  cooldown: JudgeCooldown;
  /** Receives the one record of the scan. The default writes one JSON line. */
  log?: (record: JudgeLogRecord) => void;
  /** Starts a timer and returns its cancel function. The default uses `setTimeout`. */
  setTimer?: (ms: number, fn: () => void) => () => void;
  /** The hash of the scanned URL, as the scans table will hold it. */
  urlHash?: string;
};

/**
 * A cooldown that is active for `ms` milliseconds after `start`. The state is
 * inside the returned object, so tests make their own.
 */
export function createCooldown(ms: number = COOLDOWN_MS): JudgeCooldown {
  let until = Number.NEGATIVE_INFINITY;
  return {
    isActive: (now) => now < until,
    start: (now) => {
      until = now + ms;
    },
  };
}

/** The only module-level mutable state of `lib/judge` (requirement 13.16). */
export const defaultCooldown: JudgeCooldown = createCooldown();

function defaultSetTimer(ms: number, fn: () => void): () => void {
  const id = setTimeout(fn, ms);
  return () => clearTimeout(id);
}

function defaultLog(record: JudgeLogRecord): void {
  console.info(JSON.stringify(record));
}

// -- One call -----------------------------------------------------------------

type AttemptResult =
  | { kind: "ok"; response: JudgeRawResponse }
  | { kind: "timeout" }
  | { kind: "error"; error: JudgeHttpError };

/**
 * One call with its own abort signal and timer. A call that has not answered
 * within `timeoutMs` is aborted and counts as a timeout. A call that fails
 * after its timeout has elapsed, or after its signal was aborted, is a
 * timeout whatever error it raised.
 */
function attempt(
  client: JudgeClient,
  request: JudgeRequest,
  timeoutMs: number,
  deps: ReviewDeps,
): Promise<AttemptResult> {
  const setTimer = deps.setTimer ?? defaultSetTimer;
  return new Promise<AttemptResult>((resolve) => {
    const controller = new AbortController();
    const startedAt = deps.now();
    let settled = false;
    let cancel: () => void = () => {};
    const finish = (result: AttemptResult): void => {
      if (settled) return;
      settled = true;
      cancel();
      resolve(result);
    };
    const failed = (thrown: unknown): void => {
      const late = controller.signal.aborted || deps.now() - startedAt >= timeoutMs;
      finish(late ? { kind: "timeout" } : { kind: "error", error: toJudgeHttpError(thrown) });
    };

    cancel = setTimer(timeoutMs, () => {
      controller.abort();
      finish({ kind: "timeout" });
    });

    let pending: Promise<JudgeRawResponse>;
    try {
      pending = client(request, { signal: controller.signal, timeoutMs });
    } catch (thrown) {
      failed(thrown);
      return;
    }
    pending.then((response) => finish({ kind: "ok", response }), failed);
  });
}

/** Retry only what the design allows: never after 400 to 404 (402 included). */
function mayRetry(error: JudgeHttpError): boolean {
  if (error.status !== null && error.status >= 400 && error.status <= 404) return false;
  return error.retryable;
}

// -- Log trace ----------------------------------------------------------------

type Trace = {
  attempts: number;
  httpStatus: number | null;
  stopReason: LoggedStopReason | null;
  usage: JudgeUsage;
  candidateCount: number;
  truncated: boolean;
  findingsReturned: number;
  findingsKept: number;
  verdicts: { confirm: number; downgrade: number; reject: number };
  anomalies: AnomalyCode[];
};

function newTrace(): Trace {
  return {
    attempts: 0,
    httpStatus: null,
    stopReason: null,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    candidateCount: 0,
    truncated: false,
    findingsReturned: 0,
    findingsKept: 0,
    verdicts: { confirm: 0, downgrade: 0, reject: 0 },
    anomalies: [],
  };
}

const LOGGED_STOP_REASONS: readonly string[] = [
  "end_turn",
  "max_tokens",
  "stop_sequence",
  "refusal",
  "pause_turn",
  "tool_use",
];

/** Only values of the fixed set are logged; anything else is `other`. */
function loggedStopReason(value: unknown): LoggedStopReason {
  return typeof value === "string" && LOGGED_STOP_REASONS.includes(value)
    ? (value as LoggedStopReason)
    : "other";
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

function loggedUsage(usage: Partial<JudgeUsage> | undefined): JudgeUsage {
  return {
    input: count(usage?.input),
    output: count(usage?.output),
    cacheRead: count(usage?.cacheRead),
    cacheWrite: count(usage?.cacheWrite),
  };
}

// -- The review ---------------------------------------------------------------

type RunOutcome = { status: JudgeStatus; merged?: MergeOutput };

async function run(
  snapshot: PageSnapshot,
  ruleResult: DetectorRunResult,
  deps: ReviewDeps,
  trace: Trace,
): Promise<RunOutcome> {
  const ruleFindings = ruleResult.findings;
  const client = deps.client;
  if (deps.mode === "off" || client === undefined) return { status: "off" };
  if (deps.cooldown.isActive(deps.now())) return { status: "skipped-cooldown" };
  if (deps.deadline - deps.now() < MIN_REMAINING_MS) return { status: "skipped-no-time" };

  const built = buildCandidates(snapshot, ruleFindings);
  trace.candidateCount = built.candidates.length;
  trace.truncated = built.truncated;
  const request = buildJudgeRequest(built.data);

  const firstTimeout = Math.min(FIRST_TIMEOUT_MS, deps.deadline - deps.now() - FIRST_MARGIN_MS);
  trace.attempts = 1;
  let result = await attempt(client, request, firstTimeout, deps);
  if (
    result.kind === "error" &&
    mayRetry(result.error) &&
    deps.deadline - deps.now() >= RETRY_MIN_REMAINING_MS
  ) {
    trace.httpStatus = result.error.status;
    const retryTimeout = Math.min(
      RETRY_TIMEOUT_MS,
      deps.deadline - deps.now() - RETRY_MARGIN_MS,
    );
    trace.attempts = 2;
    result = await attempt(client, request, retryTimeout, deps);
  }

  if (result.kind === "timeout") return { status: "timeout" };
  if (result.kind === "error") {
    trace.httpStatus = result.error.status;
    if (result.error.status === 402) {
      deps.cooldown.start(deps.now());
      return { status: "skipped-over-budget" };
    }
    return { status: "error" };
  }

  trace.httpStatus = null;
  const response = result.response;
  trace.stopReason = loggedStopReason(response.stopReason);
  trace.usage = loggedUsage(response.usage);

  const validated = validateOutput(response, built.map, ruleFindings);
  if (validated.kind === "invalid") {
    // Requirement 22.9: a refused stop reason leaves its code in the record.
    if (validated.code !== undefined) trace.anomalies = [validated.code];
    return { status: "invalid-output" };
  }
  trace.findingsReturned = validated.returned;
  trace.findingsKept = validated.findings.length;
  for (const verdict of validated.verdicts) trace.verdicts[verdict.decision] += 1;
  trace.anomalies = [...validated.anomalies];

  const merged = mergeReview(ruleFindings, built, validated, snapshot);
  trace.anomalies = [...merged.anomalies];
  return { status: merged.anomalies.length > 0 ? "ran-anomalous" : "ran", merged };
}

/**
 * The rule findings as unchanged reviewed findings, in document order of their
 * first element, then pattern id. Falls back to the given order when the
 * snapshot cannot be indexed.
 */
function rulesOnly(snapshot: PageSnapshot, findings: readonly Finding[]): ReviewedFinding[] {
  const wrapped = findings.map((finding, seq) => ({ finding, seq }));
  try {
    const index = buildIndex(snapshot, false);
    const position = (finding: Finding): number => {
      const first = finding.elementIds.length > 0 ? index.byId(finding.elementIds[0]) : undefined;
      return first === undefined ? Number.POSITIVE_INFINITY : first.order;
    };
    wrapped.sort(
      (a, b) =>
        position(a.finding) - position(b.finding) ||
        (a.finding.patternId < b.finding.patternId
          ? -1
          : a.finding.patternId > b.finding.patternId
            ? 1
            : 0) ||
        a.seq - b.seq,
    );
  } catch {
    // Keep the given order.
  }
  return wrapped.map(({ finding }) => ({ finding, source: "rules" as const }));
}

function safeFindings(ruleResult: DetectorRunResult): Finding[] {
  try {
    return [...ruleResult.findings];
  } catch {
    return [];
  }
}

function safeErrorCount(ruleResult: DetectorRunResult): number {
  try {
    const length = ruleResult.errors.length;
    return Number.isInteger(length) && length >= 0 ? length : 0;
  } catch {
    return 0;
  }
}

function safeNow(deps: ReviewDeps): number {
  try {
    return deps.now();
  } catch {
    return 0;
  }
}

function buildRecord(
  deps: ReviewDeps,
  status: JudgeStatus,
  trace: Trace,
  latencyMs: number,
): JudgeLogRecord {
  return {
    event: "judge-review",
    judgeStatus: status,
    promptVersion: JUDGE_PROMPT_VERSION,
    mode: deps.mode,
    ...(deps.offReason !== undefined ? { offReason: deps.offReason } : {}),
    latencyMs,
    attempts: trace.attempts,
    httpStatus: trace.httpStatus,
    stopReason: trace.stopReason,
    usage: { ...trace.usage },
    estimatedCostUsd: estimateCostUsd(trace.usage),
    candidateCount: trace.candidateCount,
    truncated: trace.truncated,
    findingsReturned: trace.findingsReturned,
    findingsKept: trace.findingsKept,
    verdicts: { ...trace.verdicts },
    anomalies: [...trace.anomalies],
    ...(typeof deps.urlHash === "string" ? { urlHash: deps.urlHash } : {}),
  };
}

/**
 * Review the rule findings of one scan. It resolves to a `ReviewResult` and
 * never rejects, and it emits exactly one log record through `deps.log`.
 * When the status is neither `ran` nor `ran-anomalous`, every rule finding is
 * returned unchanged with source `rules` and `setAside` is empty.
 */
export async function reviewFindings(
  snapshot: PageSnapshot,
  ruleResult: DetectorRunResult,
  deps: ReviewDeps,
): Promise<ReviewResult> {
  const startedAt = safeNow(deps);
  const trace = newTrace();
  let outcome: RunOutcome;
  try {
    outcome = await run(snapshot, ruleResult, deps, trace);
  } catch {
    outcome = { status: "error" };
  }

  const merged = outcome.merged;
  const result: ReviewResult = {
    findings: merged ? merged.findings : rulesOnly(snapshot, safeFindings(ruleResult)),
    setAside: merged ? merged.setAside : [],
    judge: {
      status: outcome.status,
      candidateCount: trace.candidateCount,
      truncated: trace.truncated,
    },
    ruleErrors: safeErrorCount(ruleResult),
  };

  try {
    const record = buildRecord(deps, outcome.status, trace, Math.max(0, safeNow(deps) - startedAt));
    (deps.log ?? defaultLog)(record);
  } catch {
    // A failing log function never changes the result.
  }
  return result;
}
