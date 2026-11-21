import { describe, it, expect } from "vitest";
import * as constants from "@/lib/judge/constants";
import {
  COOLDOWN_MS,
  DIRECT_BASE_URL,
  GATEWAY_BASE_URL,
  INPUT_TOKEN_CEILING,
  JUDGE_EFFORT,
  JUDGE_MODEL_DIRECT,
  JUDGE_MODEL_GATEWAY,
  JUDGE_PROMPT_VERSION,
  MAX_COST_PER_SCAN_USD,
  MAX_OUTPUT_TOKENS,
  PRICE_CACHE_READ_PER_MTOK,
  PRICE_CACHE_WRITE_PER_MTOK,
  PRICE_INPUT_PER_MTOK,
  PRICE_OUTPUT_PER_MTOK,
  RANK_SCORES,
  RETRYABLE_STATUSES,
  estimateCostUsd,
} from "@/lib/judge/constants";

describe("limits of design section 9", () => {
  it("pins every numeric limit", () => {
    expect(constants.MAX_CANDIDATES).toBe(60);
    expect(constants.MAX_CANDIDATE_CHARS).toBe(200);
    expect(constants.MIN_TEXT_CHARS).toBe(2);
    expect(constants.MAX_PARTS_PER_CANDIDATE).toBe(8);
    expect(constants.TOAST_MAX_CHARS).toBe(160);
    expect(constants.BADGE_MAX_CHARS).toBe(80);
    expect(constants.GROUP_MAX_LEVELS).toBe(3);
    expect(constants.MAX_DATA_BLOCK_BYTES).toBe(24_000);
    expect(constants.MAX_FINDINGS_KEPT).toBe(8);
    expect(constants.MAX_VERDICTS).toBe(20);
    expect(constants.MAX_REJECTS).toBe(3);
    expect(constants.MAX_RULE_FINDINGS_SENT).toBe(20);
    expect(constants.MAX_TOTAL_CANDIDATE_CHARS).toBe(10_000);
    expect(constants.MAX_PART_CHARS).toBe(24);
    expect(constants.FRAGMENT_MAX_CHARS).toBe(40);
    expect(constants.LONG_TEXT_CHARS).toBe(160);
    expect(constants.ROLE_COVERAGE_MIN).toBe(0.8);
    expect(constants.REDACTED_SHARE_MAX).toBe(0.5);
    expect(constants.MAX_REQUEST_BODY_BYTES).toBe(40_000);
    expect(constants.ANOMALY_MAX_FINDINGS).toBe(12);
    expect(constants.JUDGE_QUOTE_MIN_CHARS).toBe(3);
    expect(constants.JUDGE_QUOTE_MAX_CHARS).toBe(120);
    expect(constants.ANOMALY_FLAGGED_SHARE).toBe(0.5);
    expect(constants.ANOMALY_FLAGGED_MIN).toBe(6);
    expect(constants.MAX_OUTPUT_TOKENS).toBe(1_400);
    expect(constants.INPUT_TOKEN_CEILING).toBe(6_100);
  });

  it("pins the review-fix limits of design section 24.1 (requirement 20.9, 20.11)", () => {
    expect(constants.MIN_REJECTS_ALLOWED).toBe(1);
    expect(constants.LOWERED_MIN_RULE_FINDINGS).toBe(3);
  });

  it("pins every timing", () => {
    expect(constants.FIRST_TIMEOUT_MS).toBe(8_000);
    expect(constants.FIRST_MARGIN_MS).toBe(1_500);
    expect(constants.MIN_REMAINING_MS).toBe(3_000);
    expect(constants.RETRY_MIN_REMAINING_MS).toBe(5_000);
    expect(constants.RETRY_TIMEOUT_MS).toBe(6_000);
    expect(constants.RETRY_MARGIN_MS).toBe(1_000);
    expect(COOLDOWN_MS).toBe(600_000);
  });

  it("pins the retryable statuses", () => {
    expect([...RETRYABLE_STATUSES]).toEqual([
      408, 409, 429, 500, 502, 503, 504, 529,
    ]);
    expect(Object.isFrozen(RETRYABLE_STATUSES)).toBe(true);
  });

  it("pins the prices, the ceiling and the effort", () => {
    expect(PRICE_INPUT_PER_MTOK).toBe(0.1);
    expect(PRICE_OUTPUT_PER_MTOK).toBe(0.5);
    expect(PRICE_CACHE_READ_PER_MTOK).toBe(0.01);
    expect(PRICE_CACHE_WRITE_PER_MTOK).toBe(0.125);
    expect(MAX_COST_PER_SCAN_USD).toBe(0.003);
    expect(JUDGE_EFFORT).toBe("low");
  });

  it("pins the model ids and base URLs", () => {
    expect(JUDGE_MODEL_DIRECT).toBe("claude-haiku-5-5");
    expect(JUDGE_MODEL_GATEWAY).toBe("anthropic/claude-haiku-5.5");
    expect(GATEWAY_BASE_URL).toBe("https://ai-gateway.vercel.sh");
    expect(DIRECT_BASE_URL).toBe("https://api.anthropic.com");
  });

  it("has a non-empty prompt version", () => {
    expect(typeof JUDGE_PROMPT_VERSION).toBe("string");
    expect(JUDGE_PROMPT_VERSION.length).toBeGreaterThan(0);
    expect(JUDGE_PROMPT_VERSION).toBe("model-judge-v1");
  });

  it("pins the ranking scores of design section 11", () => {
    expect({ ...RANK_SCORES }).toEqual({
      ruleCovered: 100,
      control: 60,
      groupInOverlay: 50,
      overlayPlace: 25,
      clock: 20,
      digit: 15,
      emphasis: 10,
      shortEmphasis: 10,
      heading: 5,
      longText: -10,
      outsideImage: -10,
    });
    expect(Object.isFrozen(RANK_SCORES)).toBe(true);
  });
});

describe("spend ceiling (requirement 3.4)", () => {
  it("keeps two worst-case attempts at or under the per-scan ceiling", () => {
    const inputPrice = Math.max(
      PRICE_INPUT_PER_MTOK,
      PRICE_CACHE_WRITE_PER_MTOK
    );
    const oneAttempt =
      (INPUT_TOKEN_CEILING * inputPrice +
        MAX_OUTPUT_TOKENS * PRICE_OUTPUT_PER_MTOK) /
      1_000_000;
    const twoAttempts = 2 * oneAttempt;
    expect(twoAttempts).toBeCloseTo(0.002925, 9);
    expect(twoAttempts).toBeLessThanOrEqual(MAX_COST_PER_SCAN_USD);
  });
});

describe("estimateCostUsd", () => {
  it("prices the four token kinds with the four price constants", () => {
    const cost = estimateCostUsd({
      input: 1_000,
      output: 200,
      cacheRead: 5_000,
      cacheWrite: 6_000,
    });
    // (1000 * 0.10 + 200 * 0.50 + 5000 * 0.01 + 6000 * 0.125) / 1e6
    expect(cost).toBeCloseTo(0.001, 9);
  });

  it("prices each kind alone", () => {
    const zero = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    expect(estimateCostUsd(zero)).toBe(0);
    expect(estimateCostUsd({ ...zero, input: 1_000_000 })).toBeCloseTo(0.1, 9);
    expect(estimateCostUsd({ ...zero, output: 1_000_000 })).toBeCloseTo(0.5, 9);
    expect(estimateCostUsd({ ...zero, cacheRead: 1_000_000 })).toBeCloseTo(
      0.01,
      9
    );
    expect(estimateCostUsd({ ...zero, cacheWrite: 1_000_000 })).toBeCloseTo(
      0.125,
      9
    );
  });
});
