import { describe, expect, it } from "vitest";
import { RETRYABLE_STATUSES } from "@/lib/judge/constants";
import { JudgeHttpError, toJudgeHttpError } from "@/lib/judge/interface";
import type {
  JudgeClient,
  JudgeRawResponse,
  JudgeRequest,
} from "@/lib/judge/interface";

/** An error object shaped like an SDK error that carries a status. */
function statusError(status: number): Error & { status: number } {
  return Object.assign(new Error("sentinel message that must not travel"), { status });
}

describe("JudgeHttpError", () => {
  it("is an Error with a fixed message, the status and the retryable flag", () => {
    const error = new JudgeHttpError(503, true);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe("judge-http");
    expect(error.status).toBe(503);
    expect(error.retryable).toBe(true);
  });

  it("accepts a null status", () => {
    const error = new JudgeHttpError(null, false);
    expect(error.status).toBeNull();
    expect(error.retryable).toBe(false);
  });
});

describe("toJudgeHttpError", () => {
  it.each([...RETRYABLE_STATUSES])("marks status %i as retryable and keeps it", (status) => {
    const mapped = toJudgeHttpError(statusError(status));
    expect(mapped).toBeInstanceOf(JudgeHttpError);
    expect(mapped.status).toBe(status);
    expect(mapped.retryable).toBe(true);
  });

  it.each([400, 401, 402, 403, 404])("marks status %i as not retryable and keeps it", (status) => {
    const mapped = toJudgeHttpError(statusError(status));
    expect(mapped.status).toBe(status);
    expect(mapped.retryable).toBe(false);
  });

  it("keeps the status of a plain object that is not an Error", () => {
    const mapped = toJudgeHttpError({ status: 429 });
    expect(mapped.status).toBe(429);
    expect(mapped.retryable).toBe(true);
  });

  it("maps an error without a status to a retryable connection error with a null status", () => {
    const mapped = toJudgeHttpError(new Error("connection refused"));
    expect(mapped.status).toBeNull();
    expect(mapped.retryable).toBe(true);
  });

  it("maps an error whose status is undefined (an SDK connection error) the same way", () => {
    const mapped = toJudgeHttpError(Object.assign(new Error("x"), { status: undefined }));
    expect(mapped.status).toBeNull();
    expect(mapped.retryable).toBe(true);
  });

  it("does not retry an aborted call", () => {
    const aborted = Object.assign(new Error("aborted"), { name: "AbortError" });
    const mapped = toJudgeHttpError(aborted);
    expect(mapped.status).toBeNull();
    expect(mapped.retryable).toBe(false);
  });

  it("returns an existing JudgeHttpError unchanged", () => {
    const existing = new JudgeHttpError(402, false);
    expect(toJudgeHttpError(existing)).toBe(existing);
  });

  it.each([undefined, null, "boom", 42, {}, { status: "503" }, { status: 99 }, { status: 503.5 }])(
    "maps the non-error value %j to a null status that is not retryable",
    (value) => {
      const mapped = toJudgeHttpError(value);
      expect(mapped).toBeInstanceOf(JudgeHttpError);
      expect(mapped.status).toBeNull();
      expect(mapped.retryable).toBe(false);
    },
  );

  it("never carries the message of the original error", () => {
    const mapped = toJudgeHttpError(statusError(500));
    expect(mapped.message).toBe("judge-http");
    expect(JSON.stringify(mapped)).not.toContain("sentinel");
  });
});

describe("seam types", () => {
  it("lets a client be written against the exported types", async () => {
    const response: JudgeRawResponse = {
      text: "{}",
      stopReason: "end_turn",
      usage: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4 },
    };
    const client: JudgeClient = async (_request: JudgeRequest) => response;
    const request: JudgeRequest = { system: "s", data: "d", schema: {}, maxTokens: 1 };
    const controller = new AbortController();
    await expect(client(request, { signal: controller.signal, timeoutMs: 1 })).resolves.toBe(response);
  });
});
