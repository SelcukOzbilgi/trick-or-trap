import { z } from "zod";
import { PatternIdSchema } from "@/lib/types";

export const GROUND_TRUTH_ID_SHAPE =
  /^(home|product|cart|checkout|club|account|newsletter)(-[a-z0-9]+)+$/;

/** `none` is allowed here only, for honest look-alike entries. It is not a PatternId. */
export const GroundTruthPatternSchema = z.union([PatternIdSchema, z.literal("none")]);

export const GroundTruthPageSchema = z.enum([
  "home",
  "product",
  "cart",
  "checkout",
  "club",
  "account",
  "newsletter-modal",
]);

/** What a detector may use to find an entry. `not-static` means one snapshot cannot show it. */
export const DETECTION_SIGNALS = [
  "text",
  "attribute",
  "style",
  "reload-variance",
  "timing",
  "cross-page",
  "not-static",
] as const;

export const DetectionSignalSchema = z.enum(DETECTION_SIGNALS);

export const GroundTruthEntrySchema = z
  .object({
    id: z.string().regex(GROUND_TRUTH_ID_SHAPE),
    page: GroundTruthPageSchema,
    route: z.string().regex(/^\/boo-tique(?:[/?]|$)/),
    element: z.string().min(1),
    pattern: GroundTruthPatternSchema,
    phase: z.union([z.literal(1), z.literal(2)]),
    difficulty: z.enum(["easy", "medium", "subtle", "lookalike"]),
    expectedVerdict: z.enum(["flag", "no-flag"]),
    detectionSignals: z
      .array(DetectionSignalSchema)
      .min(1)
      .refine((signals) => new Set(signals).size === signals.length, "signals must be unique"),
    detectionNote: z.string().trim().min(20),
  })
  .refine(
    (e) => (e.pattern === "none") === (e.expectedVerdict === "no-flag"),
    "pattern none must pair with no-flag, and every other pattern with flag",
  )
  .superRefine((e, ctx) => {
    const hasNotStatic = e.detectionSignals.includes("not-static");
    const onlyNotStatic = e.detectionSignals.length === 1 && hasNotStatic;
    const notScoredNote = e.detectionNote.startsWith("Not scored:");
    if (hasNotStatic !== onlyNotStatic || hasNotStatic !== notScoredNote) {
      ctx.addIssue({
        code: "custom",
        message: `Entry ${e.id}: not-static, signals exactly ["not-static"] and a note starting with "Not scored:" must hold together or not at all`,
        path: ["detectionSignals"],
      });
    }
  });

export const GroundTruthSchema = z.array(GroundTruthEntrySchema).superRefine((entries, ctx) => {
  const seen = new Set<string>();
  entries.forEach((entry, index) => {
    if (seen.has(entry.id)) {
      ctx.addIssue({
        code: "custom",
        message: `Duplicate ground-truth id: ${entry.id}`,
        path: [index, "id"],
      });
    }
    seen.add(entry.id);
  });
});

export type GroundTruthEntry = z.infer<typeof GroundTruthEntrySchema>;
export type GroundTruth = z.infer<typeof GroundTruthSchema>;
