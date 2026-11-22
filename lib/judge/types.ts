import { z } from "zod";
import { ConfidenceSchema, FindingSchema } from "@/lib/types";
import type { Confidence, Finding } from "@/lib/types";

/**
 * Types, reason codes and result schemas of the model judge (design section
 * 8). `lib/types` stays unchanged: the judge wraps `Finding` and does not
 * extend it. This file is pure and holds no clock, randomness or state.
 */

// -- Patterns -----------------------------------------------------------------

/** The six pattern ids the judge can name, in the order of the design. */
export const JUDGE_PATTERN_IDS = Object.freeze([
  "fake-urgency",
  "fake-scarcity",
  "fake-activity",
  "confirmshaming",
  "preselection",
  "visual-interference",
] as const);

export type JudgePatternId = (typeof JUDGE_PATTERN_IDS)[number];

// -- Reason codes -------------------------------------------------------------

/** Flag codes per pattern: what the page shows when the pattern is present. */
export const FLAG_CODES_BY_PATTERN = Object.freeze({
  "fake-urgency": Object.freeze([
    "undated-deadline",
    "rolling-deadline",
    "personal-timer",
    "pressure-wording",
  ] as const),
  "fake-scarcity": Object.freeze([
    "vague-low-stock",
    "stock-with-pressure",
    "selling-fast-claim",
  ] as const),
  "fake-activity": Object.freeze([
    "live-viewers",
    "live-baskets",
    "recent-purchase-notice",
    "recent-count",
  ] as const),
  confirmshaming: Object.freeze(["shaming-decline", "guilt-decline"] as const),
  preselection: Object.freeze([
    "prechecked-paid-addon",
    "prechecked-marketing",
    "prechecked-data-sharing",
    "preselected-recurring",
    "preselected-pricier",
  ] as const),
  "visual-interference": Object.freeze([
    "faint-decline",
    "tiny-decline",
    "tiny-close",
  ] as const),
});

/** All 21 flag codes, grouped by pattern in the order of the design. */
export const FLAG_CODES = Object.freeze([
  ...FLAG_CODES_BY_PATTERN["fake-urgency"],
  ...FLAG_CODES_BY_PATTERN["fake-scarcity"],
  ...FLAG_CODES_BY_PATTERN["fake-activity"],
  ...FLAG_CODES_BY_PATTERN.confirmshaming,
  ...FLAG_CODES_BY_PATTERN.preselection,
  ...FLAG_CODES_BY_PATTERN["visual-interference"],
] as const);

/** The 17 honest look-alike codes. */
export const LOOK_ALIKE_CODES = Object.freeze([
  "dated-deadline",
  "true-by-nature-deadline",
  "duration-not-deadline",
  "holiday-countdown",
  "neutral-stock-fact",
  "edition-or-purchase-limit",
  "cumulative-count",
  "own-order-status",
  "review-or-quote",
  "neutral-decline",
  "not-a-decline",
  "required-terms",
  "free-or-cheapest-default",
  "neutral-default",
  "comparable-prominence",
  "not-a-choice",
  "disabled-control",
] as const);

/** The one code that belongs to no family: allowed on a downgrade only. */
export const INSUFFICIENT_CONTEXT = "insufficient-context" as const;

/** All 39 reason codes. */
export const REASON_CODES = Object.freeze([
  ...FLAG_CODES,
  ...LOOK_ALIKE_CODES,
  INSUFFICIENT_CONTEXT,
] as const);

export type FlagCode = (typeof FLAG_CODES)[number];
export type LookAlikeCode = (typeof LOOK_ALIKE_CODES)[number];
export type ReasonCode = (typeof REASON_CODES)[number];

export const ReasonCodeSchema = z.enum(REASON_CODES);

// -- Statuses -----------------------------------------------------------------

export const JUDGE_STATUSES = Object.freeze([
  "ran",
  "ran-anomalous",
  "off",
  "skipped-no-time",
  "skipped-over-budget",
  "skipped-cooldown",
  "timeout",
  "error",
  "invalid-output",
] as const);

export type JudgeStatus = (typeof JUDGE_STATUSES)[number];

export const JudgeStatusSchema = z.enum(JUDGE_STATUSES);

// -- Result wrappers ----------------------------------------------------------

export type FindingSource = "rules" | "judge" | "rules+judge";

export const FindingSourceSchema = z.enum(["rules", "judge", "rules+judge"]);

export type ReviewedFinding = {
  /** Still passes `FindingSchema`; judge findings use `detectorName: "judge"`. */
  finding: Finding;
  source: FindingSource;
  /** The rule's level before the review; present only when the level changed. */
  ruleConfidence?: Confidence;
  /** Present only when the judge gave a reason. */
  judgeReason?: ReasonCode;
};

export type SetAsideFinding = {
  /** The unchanged rule finding. */
  finding: Finding;
  judgeReason: ReasonCode;
};

export type ReviewResult = {
  findings: ReviewedFinding[];
  setAside: SetAsideFinding[];
  judge: { status: JudgeStatus; candidateCount: number; truncated: boolean };
  /** `DetectorRunResult.errors.length`. */
  ruleErrors: number;
};

export const ReviewedFindingSchema = z.object({
  finding: FindingSchema,
  source: FindingSourceSchema,
  ruleConfidence: ConfidenceSchema.optional(),
  judgeReason: ReasonCodeSchema.optional(),
});

export const SetAsideFindingSchema = z.object({
  finding: FindingSchema,
  judgeReason: ReasonCodeSchema,
});

export const ReviewResultSchema = z.object({
  findings: z.array(ReviewedFindingSchema),
  setAside: z.array(SetAsideFindingSchema),
  judge: z.object({
    status: JudgeStatusSchema,
    candidateCount: z.number().int().nonnegative(),
    truncated: z.boolean(),
  }),
  ruleErrors: z.number().int().nonnegative(),
});

// -- Other shared types -------------------------------------------------------

/** How a rule finding may be judged (design section 15). */
export type RuleKind = "reload" | "measured" | "structural" | "text";

export type JudgeMode = "off" | "gateway" | "anthropic";

/** Token counts of one call. */
export type JudgeUsage = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
};

/** Why the judge is off (design section 16). */
export type OffReason = "unset" | "unknown-mode" | "missing-key";

/** Stop reasons that may be logged; anything else is logged as `other`. */
export type LoggedStopReason =
  | "end_turn"
  | "max_tokens"
  | "stop_sequence"
  | "refusal"
  | "pause_turn"
  | "tool_use"
  | "other";

/** The code of an answer that was refused for its stop reason (requirement 22). */
export type StopAnomalyCode =
  | "stop-refusal"
  | "stop-pause-turn"
  | "stop-max-tokens"
  | "stop-tool-use"
  | "stop-unknown";

export type AnomalyCode =
  | "too-many-findings"
  | "too-many-flagged"
  | "too-many-rejects"
  | "too-many-lowered"
  | StopAnomalyCode;

/**
 * The one record logged per scan (design section 17). It holds counts, codes
 * and fixed strings only: never page text, a quote, the prompt, a URL, the raw
 * response, a key or a header.
 */
export type JudgeLogRecord = {
  event: "judge-review";
  judgeStatus: JudgeStatus;
  promptVersion: string;
  mode: JudgeMode;
  offReason?: OffReason;
  latencyMs: number;
  attempts: number;
  httpStatus: number | null;
  stopReason: LoggedStopReason | null;
  usage: JudgeUsage;
  estimatedCostUsd: number;
  candidateCount: number;
  truncated: boolean;
  findingsReturned: number;
  findingsKept: number;
  verdicts: { confirm: number; downgrade: number; reject: number };
  anomalies: AnomalyCode[];
  urlHash?: string;
};
