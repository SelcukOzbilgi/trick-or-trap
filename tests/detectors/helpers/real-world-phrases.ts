import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

/**
 * The independent real-world corpus (requirement 3): realistic English and
 * Turkish shop texts written from section B of docs/research/dark-patterns.md
 * and general knowledge of shop copy. It is read by the generality test of
 * the word lists and by its own shape and anti-copy tests.
 */

const CORPUS_PATH = join(process.cwd(), "tests", "fixtures", "real-world-phrases.json");

export const RealWorldPhraseSchema = z.object({
  id: z.string().min(1),
  language: z.enum(["en", "tr"]),
  text: z
    .string()
    .max(300)
    .refine((text) => text.trim() !== "", { message: "text must not be blank" }),
  /** A short note of where this kind of phrase is seen on real shops. */
  seenAt: z
    .string()
    .refine((note) => note.trim() !== "", { message: "seenAt must not be blank" }),
  /** `research-b`: section B of docs/research/dark-patterns.md. `common`: general knowledge of shop copy. */
  source: z.enum(["research-b", "common"]),
});

export type RealWorldPhrase = z.infer<typeof RealWorldPhraseSchema>;

const CorpusSchema = z.array(RealWorldPhraseSchema);

/** Reads and validates the corpus; returns a frozen array of frozen entries. */
export function loadRealWorldPhrases(): readonly RealWorldPhrase[] {
  const parsed = CorpusSchema.parse(JSON.parse(readFileSync(CORPUS_PATH, "utf8")));
  return Object.freeze(parsed.map((item) => Object.freeze(item)));
}
