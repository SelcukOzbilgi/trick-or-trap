import { JudgeHttpError } from "@/lib/judge/interface";
import type { JudgeClient, JudgeRawResponse, JudgeRequest } from "@/lib/judge/interface";
import type { PageData } from "@/lib/judge/candidates";

/**
 * The deterministic judge client for tests (design section 16). It makes no
 * network call and imports no SDK. All state lives in the instance that
 * `createMockJudge` returns; the module holds none.
 */

type CallOptions = { signal: AbortSignal; timeoutMs: number };

/** What a scripted call may return: an answer, or an error to reject with. */
type MockOutcome = JudgeRawResponse | JudgeHttpError;

/** One scripted call. */
export type MockStep =
  | JudgeRawResponse
  | JudgeHttpError
  /** Settles only when the signal aborts, then rejects with an `AbortError`. */
  | "hang"
  | ((request: JudgeRequest, opts: CallOptions) => MockOutcome | Promise<MockOutcome>);

/** One step for every call, or an array with one step per successive call. */
export type MockScript = MockStep | readonly MockStep[];

export type MockJudge = JudgeClient & {
  /** The requests received, in order. */
  readonly requests: JudgeRequest[];
  /** The `timeoutMs` of each call, in order. */
  readonly timeouts: number[];
  /** The number of calls received. */
  readonly calls: number;
};

function abortError(): Error {
  const error = new Error("aborted");
  error.name = "AbortError";
  return error;
}

function hang(signal: AbortSignal): Promise<JudgeRawResponse> {
  return new Promise<JudgeRawResponse>((_resolve, reject) => {
    if (signal.aborted) {
      reject(abortError());
      return;
    }
    signal.addEventListener("abort", () => reject(abortError()), { once: true });
  });
}

/** A copy, so a caller cannot change what the next call returns. */
function copyResponse(response: JudgeRawResponse): JudgeRawResponse {
  return { ...response, usage: { ...response.usage } };
}

async function settle(outcome: MockOutcome): Promise<JudgeRawResponse> {
  if (outcome instanceof JudgeHttpError) throw outcome;
  return copyResponse(outcome);
}

async function runStep(
  step: MockStep,
  request: JudgeRequest,
  opts: CallOptions,
): Promise<JudgeRawResponse> {
  if (step === "hang") return hang(opts.signal);
  if (typeof step === "function") return settle(await step(request, opts));
  return settle(step);
}

/**
 * Build a client from a script. A single step answers every call; an array
 * answers one call per entry, and a call past its end rejects with the fixed
 * message `mock-judge-exhausted`, so an unexpected extra call is visible.
 */
export function createMockJudge(script: MockScript): MockJudge {
  const requests: JudgeRequest[] = [];
  const timeouts: number[] = [];
  const steps: readonly MockStep[] | null = Array.isArray(script)
    ? (script as readonly MockStep[])
    : null;

  const client: JudgeClient = async (request, opts) => {
    const position = requests.length;
    requests.push(request);
    timeouts.push(opts.timeoutMs);
    if (steps === null) return runStep(script as MockStep, request, opts);
    if (position >= steps.length) throw new Error("mock-judge-exhausted");
    return runStep(steps[position], request, opts);
  };

  return Object.defineProperties(client, {
    requests: { value: requests, enumerable: true },
    timeouts: { value: timeouts, enumerable: true },
    calls: { get: () => requests.length, enumerable: true },
  }) as MockJudge;
}

const OPEN_MARKER = "<page_data>\n";
const CLOSE_MARKER = "\n</page_data>";

/**
 * The parsed data block of a request: the text between the block markers,
 * parsed as JSON. Throws a fixed message, never a part of the data.
 */
export function readPageData(request: JudgeRequest): PageData {
  const start = request.data.indexOf(OPEN_MARKER);
  const end = request.data.indexOf(CLOSE_MARKER);
  if (start !== 0 || end < OPEN_MARKER.length) throw new Error("mock-judge-bad-data");
  try {
    return JSON.parse(request.data.slice(OPEN_MARKER.length, end)) as PageData;
  } catch {
    throw new Error("mock-judge-bad-data");
  }
}
