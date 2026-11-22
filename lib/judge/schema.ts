import { z } from "zod";
import { MAX_CANDIDATES, MAX_RULE_FINDINGS_SENT } from "@/lib/judge/constants";
import {
  FLAG_CODES,
  JUDGE_PATTERN_IDS,
  REASON_CODES,
} from "@/lib/judge/types";
import { ConfidenceSchema } from "@/lib/types";

/**
 * The model's answer: a strict zod schema and the hand-written JSON Schema
 * that is sent as `output_config.format` (design section 13). The id enums are
 * fixed (`c1` to `c60`, `r1` to `r20`) so the schema is byte-identical across
 * scans, which prompt caching needs. Counts and lengths are not in the schema:
 * the API does not enforce them, and `validateOutput` applies them as drops.
 */

export type CandidateId = `c${number}`;
export type RuleId = `r${number}`;

function ids<P extends "c" | "r">(prefix: P, count: number): readonly `${P}${number}`[] {
  const list: `${P}${number}`[] = [];
  for (let i = 1; i <= count; i += 1) list.push(`${prefix}${i}`);
  return Object.freeze(list);
}

export const CANDIDATE_IDS: readonly CandidateId[] = ids("c", MAX_CANDIDATES);
export const RULE_IDS: readonly RuleId[] = ids("r", MAX_RULE_FINDINGS_SENT);

export const JUDGE_DECISIONS = Object.freeze([
  "confirm",
  "downgrade",
  "reject",
] as const);

export type JudgeDecision = (typeof JUDGE_DECISIONS)[number];

// -- zod ----------------------------------------------------------------------

const JudgeFindingItemSchema = z.strictObject({
  candidate: z.enum(CANDIDATE_IDS),
  pattern: z.enum(JUDGE_PATTERN_IDS),
  quote: z.string(),
  confidence: ConfidenceSchema,
  reason: z.enum(FLAG_CODES),
});

const JudgeVerdictItemSchema = z.strictObject({
  rule: z.enum(RULE_IDS),
  decision: z.enum(JUDGE_DECISIONS),
  confidence: ConfidenceSchema,
  reason: z.enum(REASON_CODES),
});

export const JudgeOutputSchema = z.strictObject({
  findings: z.array(JudgeFindingItemSchema),
  verdicts: z.array(JudgeVerdictItemSchema),
});

export type JudgeOutput = z.infer<typeof JudgeOutputSchema>;
export type JudgeFindingItem = z.infer<typeof JudgeFindingItemSchema>;
export type JudgeVerdictItem = z.infer<typeof JudgeVerdictItemSchema>;

// -- JSON Schema ---------------------------------------------------------------

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

/** The structured-output schema sent with every request. Deep-frozen. */
export const JUDGE_OUTPUT_JSON_SCHEMA: Readonly<Record<string, unknown>> =
  deepFreeze({
    type: "object",
    additionalProperties: false,
    required: ["findings", "verdicts"],
    properties: {
      findings: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["candidate", "pattern", "quote", "confidence", "reason"],
          properties: {
            candidate: { enum: [...CANDIDATE_IDS] },
            pattern: { enum: [...JUDGE_PATTERN_IDS] },
            quote: { type: "string" },
            confidence: { enum: ["high", "medium", "low"] },
            reason: { enum: [...FLAG_CODES] },
          },
        },
      },
      verdicts: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["rule", "decision", "confidence", "reason"],
          properties: {
            rule: { enum: [...RULE_IDS] },
            decision: { enum: [...JUDGE_DECISIONS] },
            confidence: { enum: ["high", "medium", "low"] },
            reason: { enum: [...REASON_CODES] },
          },
        },
      },
    },
  });
