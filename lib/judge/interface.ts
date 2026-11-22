import { RETRYABLE_STATUSES } from "@/lib/judge/constants";
import type { JudgeRequest } from "@/lib/judge/prompt";
import type { JudgeUsage } from "@/lib/judge/types";

/**
 * The seam between the orchestrator and a model client (design section 16).
 * Pure: no clock, no randomness, no state, no network and no SDK import. The
 * real client lives in `haiku.ts`, the deterministic one in `mock.ts`.
 */

export type { JudgeRequest };

/** The raw answer of one call: the text, the stop reason and the token counts. */
export type JudgeRawResponse = {
  text: string;
  stopReason: string;
  usage: JudgeUsage;
};

/** One call to the model. It must settle or reject once `opts.signal` aborts. */
export type JudgeClient = (
  request: JudgeRequest,
  opts: { signal: AbortSignal; timeoutMs: number },
) => Promise<JudgeRawResponse>;

/**
 * A failed call. The message is fixed, so no text of the original error (which
 * can hold a header, a URL or a body) travels with it.
 */
export class JudgeHttpError extends Error {
  /** The HTTP status, or `null` for a connection error or an unknown failure. */
  readonly status: number | null;
  readonly retryable: boolean;

  constructor(status: number | null, retryable: boolean) {
    super("judge-http");
    this.name = "JudgeHttpError";
    this.status = status;
    this.retryable = retryable;
  }
}

function isHttpStatus(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 100 && value <= 599;
}

/**
 * Map whatever a client threw to a `JudgeHttpError`.
 *
 * - An existing `JudgeHttpError` is returned as it is.
 * - An object with an HTTP status keeps it; it is retryable only when the
 *   status is in `RETRYABLE_STATUSES`.
 * - An error without a status is a connection error: status `null`, retryable.
 *   An aborted call is the exception, because the orchestrator treats it as a
 *   timeout and does not retry it.
 * - Anything else has status `null` and is not retryable.
 */
export function toJudgeHttpError(value: unknown): JudgeHttpError {
  if (value instanceof JudgeHttpError) return value;
  if (typeof value === "object" && value !== null) {
    const status = (value as { status?: unknown }).status;
    if (isHttpStatus(status)) {
      return new JudgeHttpError(status, RETRYABLE_STATUSES.includes(status));
    }
  }
  if (value instanceof Error) {
    return new JudgeHttpError(null, value.name !== "AbortError");
  }
  return new JudgeHttpError(null, false);
}
