import type { JudgeUsage } from "@/lib/judge/types";

/**
 * Every limit, price, id, timing and score of the model judge (design section
 * 9). Nothing here reads the clock or the environment. A change of any value
 * is a change of behaviour and is pinned by `tests/judge/constants.test.ts`.
 */

// -- Candidates ---------------------------------------------------------------

export const MAX_CANDIDATES = 60;
export const MAX_CANDIDATE_CHARS = 200;
export const MIN_TEXT_CHARS = 2;
export const MAX_PARTS_PER_CANDIDATE = 8;
export const MAX_PART_CHARS = 24;
export const FRAGMENT_MAX_CHARS = 40;
export const TOAST_MAX_CHARS = 160;
export const LONG_TEXT_CHARS = 160;
export const BADGE_MAX_CHARS = 80;
export const ROLE_COVERAGE_MIN = 0.8;
export const GROUP_MAX_LEVELS = 3;
export const REDACTED_SHARE_MAX = 0.5;
export const MAX_RULE_FINDINGS_SENT = 20;
export const MAX_TOTAL_CANDIDATE_CHARS = 10_000;

// -- Text the shopper cannot see (design section 24.2) ------------------------

/** A box under this many pixels wide or high is not seen (21.2). */
export const MIN_VISIBLE_BOX_PX = 4;
/** A known font size under this many pixels is not read (21.3). */
export const MIN_FONT_PX = 6;
/** Own opacity times the opacities of the ancestors under this is not seen (21.4). */
export const MIN_EFFECTIVE_OPACITY = 0.1;
/** Text contrast under this on a known background is not read (21.5). */
export const MIN_TEXT_CONTRAST = 1.2;

// -- Request size -------------------------------------------------------------

export const MAX_DATA_BLOCK_BYTES = 24_000;
export const MAX_REQUEST_BODY_BYTES = 40_000;

// -- Validation ---------------------------------------------------------------

export const MAX_FINDINGS_KEPT = 8;
export const ANOMALY_MAX_FINDINGS = 12;
export const MAX_VERDICTS = 20;
export const JUDGE_QUOTE_MIN_CHARS = 3;
export const JUDGE_QUOTE_MAX_CHARS = 120;
export const MAX_REJECTS = 3;
/** Smallest reject allowance when at least one text or structural finding was sent (20.9). */
export const MIN_REJECTS_ALLOWED = 1;
/** Fewest sent rule findings for which the lowering limit applies (20.11). */
export const LOWERED_MIN_RULE_FINDINGS = 3;
export const ANOMALY_FLAGGED_SHARE = 0.5;
export const ANOMALY_FLAGGED_MIN = 6;

// -- Tokens and settings ------------------------------------------------------

export const MAX_OUTPUT_TOKENS = 1_400;
/**
 * An estimate of the input tokens of one call for a typical page. It is not the
 * bound: the cost ceiling is derived from the byte caps (requirement 24.5).
 */
export const INPUT_TOKEN_CEILING = 6_100;
export const JUDGE_EFFORT = "low";

// -- Timing (milliseconds) ----------------------------------------------------

export const FIRST_TIMEOUT_MS = 8_000;
export const FIRST_MARGIN_MS = 1_500;
export const MIN_REMAINING_MS = 3_000;
export const RETRY_MIN_REMAINING_MS = 5_000;
export const RETRY_TIMEOUT_MS = 6_000;
export const RETRY_MARGIN_MS = 1_000;
export const COOLDOWN_MS = 600_000;

/** HTTP statuses that allow one retry. */
export const RETRYABLE_STATUSES: readonly number[] = Object.freeze([
  408, 409, 429, 500, 502, 503, 504, 529,
]);

// -- Prices (US dollars per million tokens) and the spend ceiling -------------

export const PRICE_INPUT_PER_MTOK = 0.1;
export const PRICE_OUTPUT_PER_MTOK = 0.5;
export const PRICE_CACHE_READ_PER_MTOK = 0.01;
export const PRICE_CACHE_WRITE_PER_MTOK = 0.125;
/**
 * Worst-case cost of one scan with two billed attempts, in US dollars: the
 * two-attempt figure derived from the byte caps (prompt, output schema,
 * user-message wrapper and `MAX_DATA_BLOCK_BYTES` at one token per byte, priced
 * at the higher of the input and cache-write prices, plus `MAX_OUTPUT_TOKENS`),
 * rounded up to the next $0.001. Requirements 24.5 to 24.7. It is a ceiling,
 * not a forecast: a typical call costs about $0.0006.
 */
export const MAX_COST_PER_SCAN_USD = 0.01;

// -- Model, endpoints and prompt version --------------------------------------

export const JUDGE_MODEL_DIRECT = "claude-haiku-5-5";
/** Unverified slug: the owner confirms it in the gateway model list. */
export const JUDGE_MODEL_GATEWAY = "anthropic/claude-haiku-5.5";
export const GATEWAY_BASE_URL = "https://ai-gateway.vercel.sh";
export const DIRECT_BASE_URL = "https://api.anthropic.com";
/** Raise on every prompt change. */
export const JUDGE_PROMPT_VERSION = "model-judge-v1";

// -- Ranking scores (design section 11) ---------------------------------------

export const RANK_SCORES = Object.freeze({
  /** Covered by a rule finding that is sent: always kept. */
  ruleCovered: 100,
  /** Checkbox, radio or selected option. */
  control: 60,
  /** Member of a button or link group in a dialog or toast. */
  groupInOverlay: 50,
  /** Place is toast or dialog. */
  overlayPlace: 25,
  /** Text holds a clock such as 12:45. */
  clock: 20,
  /** Text holds a digit. */
  digit: 15,
  /** Text holds `!`, `%` or a currency sign. */
  emphasis: 10,
  /** Text of at most BADGE_MAX_CHARS in an emphasis tag, or with a role. */
  shortEmphasis: 10,
  /** Heading h1 to h3. */
  heading: 5,
  /** Text over LONG_TEXT_CHARS. */
  longText: -10,
  /** Element lies outside the screenshot. */
  outsideImage: -10,
});

// -- Cost ---------------------------------------------------------------------

/** Estimated cost in US dollars of one call, from its usage counts. */
export function estimateCostUsd(usage: JudgeUsage): number {
  return (
    (usage.input * PRICE_INPUT_PER_MTOK +
      usage.output * PRICE_OUTPUT_PER_MTOK +
      usage.cacheRead * PRICE_CACHE_READ_PER_MTOK +
      usage.cacheWrite * PRICE_CACHE_WRITE_PER_MTOK) /
    1_000_000
  );
}
