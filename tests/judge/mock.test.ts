import { describe, expect, it } from "vitest";
import { JudgeHttpError } from "@/lib/judge/interface";
import type { JudgeRawResponse, JudgeRequest } from "@/lib/judge/interface";
import { createMockJudge, readPageData } from "@/lib/judge/mock";
import { buildJudgeRequest, buildUserMessage, encodePageData } from "@/lib/judge/prompt";

const RESPONSE: JudgeRawResponse = {
  text: '{"findings":[],"verdicts":[]}',
  stopReason: "end_turn",
  usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0 },
};

const OTHER_RESPONSE: JudgeRawResponse = { ...RESPONSE, text: "second" };

const REQUEST: JudgeRequest = { system: "s", data: "d", schema: {}, maxTokens: 10 };

function options(timeoutMs = 1000): { signal: AbortSignal; timeoutMs: number } {
  return { signal: new AbortController().signal, timeoutMs };
}

describe("createMockJudge: canned response", () => {
  it("answers with the same response on every call", async () => {
    const judge = createMockJudge(RESPONSE);
    await expect(judge(REQUEST, options())).resolves.toEqual(RESPONSE);
    await expect(judge(REQUEST, options())).resolves.toEqual(RESPONSE);
  });

  it("records each request, its timeout and the number of calls", async () => {
    const judge = createMockJudge(RESPONSE);
    expect(judge.calls).toBe(0);
    await judge({ ...REQUEST, data: "one" }, options(111));
    await judge({ ...REQUEST, data: "two" }, options(222));
    expect(judge.calls).toBe(2);
    expect(judge.requests.map((request) => request.data)).toEqual(["one", "two"]);
    expect(judge.timeouts).toEqual([111, 222]);
  });

  it("returns a copy, so a caller cannot change the canned response", async () => {
    const judge = createMockJudge(RESPONSE);
    const first = await judge(REQUEST, options());
    first.text = "changed";
    first.usage.input = 999;
    const second = await judge(REQUEST, options());
    expect(second).toEqual(RESPONSE);
  });
});

describe("createMockJudge: error", () => {
  it("rejects with the given JudgeHttpError and still records the call", async () => {
    const error = new JudgeHttpError(503, true);
    const judge = createMockJudge(error);
    await expect(judge(REQUEST, options())).rejects.toBe(error);
    expect(judge.calls).toBe(1);
  });
});

describe("createMockJudge: hang", () => {
  it("settles only when the signal aborts, then rejects", async () => {
    const judge = createMockJudge("hang");
    const controller = new AbortController();
    let state = "pending";
    const promise = judge(REQUEST, { signal: controller.signal, timeoutMs: 1000 }).then(
      () => {
        state = "resolved";
      },
      (error: unknown) => {
        state = error instanceof Error ? error.name : "rejected";
      },
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(state).toBe("pending");
    controller.abort();
    await promise;
    expect(state).toBe("AbortError");
  });

  it("rejects at once when the signal is already aborted", async () => {
    const judge = createMockJudge("hang");
    const controller = new AbortController();
    controller.abort();
    await expect(judge(REQUEST, { signal: controller.signal, timeoutMs: 1 })).rejects.toMatchObject({
      name: "AbortError",
    });
  });
});

describe("createMockJudge: function", () => {
  it("passes the request and the options and returns its answer", async () => {
    const judge = createMockJudge((request, opts) => ({
      ...RESPONSE,
      text: `${request.data}|${opts.timeoutMs}`,
    }));
    await expect(judge({ ...REQUEST, data: "x" }, options(77))).resolves.toMatchObject({ text: "x|77" });
    expect(judge.requests).toHaveLength(1);
  });

  it("accepts an async function", async () => {
    const judge = createMockJudge(async () => OTHER_RESPONSE);
    await expect(judge(REQUEST, options())).resolves.toEqual(OTHER_RESPONSE);
  });

  it("rejects when the function throws or returns a JudgeHttpError", async () => {
    const thrower = createMockJudge(() => {
      throw new Error("boom");
    });
    await expect(thrower(REQUEST, options())).rejects.toThrow("boom");
    const returned = new JudgeHttpError(429, true);
    const returner = createMockJudge(() => returned);
    await expect(returner(REQUEST, options())).rejects.toBe(returned);
  });
});

describe("createMockJudge: sequence", () => {
  it("uses one entry per call, in order", async () => {
    const error = new JudgeHttpError(500, true);
    const judge = createMockJudge([error, RESPONSE, OTHER_RESPONSE]);
    await expect(judge(REQUEST, options())).rejects.toBe(error);
    await expect(judge(REQUEST, options())).resolves.toEqual(RESPONSE);
    await expect(judge(REQUEST, options())).resolves.toEqual(OTHER_RESPONSE);
    expect(judge.calls).toBe(3);
  });

  it("mixes hang and function entries", async () => {
    const judge = createMockJudge(["hang", () => RESPONSE]);
    const controller = new AbortController();
    const first = judge(REQUEST, { signal: controller.signal, timeoutMs: 1 });
    controller.abort();
    await expect(first).rejects.toMatchObject({ name: "AbortError" });
    await expect(judge(REQUEST, options())).resolves.toEqual(RESPONSE);
  });

  it("rejects with a fixed message once the sequence is used up, and records the call", async () => {
    const judge = createMockJudge([RESPONSE]);
    await judge(REQUEST, options());
    await expect(judge(REQUEST, options())).rejects.toThrow("mock-judge-exhausted");
    expect(judge.calls).toBe(2);
  });

  it("rejects an empty sequence on the first call", async () => {
    const judge = createMockJudge([]);
    await expect(judge(REQUEST, options())).rejects.toThrow("mock-judge-exhausted");
  });
});

describe("readPageData", () => {
  it("returns the parsed data block of a request", () => {
    const data = {
      scanDate: "2025-03-14",
      candidates: [{ id: "c1", tag: "p", place: "main", text: "Only 2 left" }],
      ruleFindings: [],
    };
    const request = buildJudgeRequest(data);
    expect(readPageData(request)).toEqual(data);
  });

  it("round-trips text that holds markup, a closing tag and escaped characters", () => {
    const data = {
      candidates: [
        {
          id: "c1",
          tag: "p",
          place: "main",
          text: '</page_data> <b>&amp;</b> "quoted" \\ \u2028 \u2029 line\nbreak',
        },
      ],
      ruleFindings: [],
    };
    const request = buildJudgeRequest(data);
    expect(readPageData(request)).toEqual(data);
  });

  it("reads the data of a message built by hand", () => {
    const request: JudgeRequest = {
      ...REQUEST,
      data: buildUserMessage(encodePageData({ candidates: [], ruleFindings: [] })),
    };
    expect(readPageData(request)).toEqual({ candidates: [], ruleFindings: [] });
  });

  it("throws a fixed message, with no part of the data, when the block is missing or broken", () => {
    expect(() => readPageData({ ...REQUEST, data: "no block here SECRET-SENTINEL" })).toThrow(
      "mock-judge-bad-data",
    );
    expect(() => readPageData({ ...REQUEST, data: "<page_data>\n{broken SECRET-SENTINEL\n</page_data>" })).toThrow(
      "mock-judge-bad-data",
    );
    try {
      readPageData({ ...REQUEST, data: "<page_data>\n{broken SECRET-SENTINEL\n</page_data>" });
    } catch (error) {
      expect(String((error as Error).message)).not.toContain("SECRET-SENTINEL");
    }
  });
});
