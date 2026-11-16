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
  })
  .refine(
    (e) => (e.pattern === "none") === (e.expectedVerdict === "no-flag"),
    "pattern none must pair with no-flag, and every other pattern with flag",
  );

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
