import { describe, it, expect } from "vitest";
import { normaliseText } from "@/lib/detectors/shared/text";
import {
  DEMO_TERMS,
  containsSequence,
  keyTokens,
  plantedTexts,
} from "@/tests/detectors/helpers/demo-terms";
import {
  RealWorldPhraseSchema,
  loadRealWorldPhrases,
} from "@/tests/detectors/helpers/real-world-phrases";

/**
 * The corpus of real-world shop texts (requirements 3.7 to 3.11): its shape,
 * its size and the anti-copy rule. The word lists are checked against it in
 * word-lists.test.ts.
 */

const corpus = loadRealWorldPhrases();

describe("the real-world corpus: shape", () => {
  it("is validated by the Zod schema, entry by entry", () => {
    expect(corpus.length).toBeGreaterThan(0);
    for (const item of corpus) {
      const result = RealWorldPhraseSchema.safeParse(item);
      expect(result.success, item.id).toBe(true);
    }
  });

  it("rejects a malformed entry", () => {
    const good = { id: "x-1", language: "en", text: "A text", seenAt: "somewhere", source: "common" };
    expect(RealWorldPhraseSchema.safeParse(good).success).toBe(true);
    expect(RealWorldPhraseSchema.safeParse({ ...good, language: "de" }).success).toBe(false);
    expect(RealWorldPhraseSchema.safeParse({ ...good, source: "other" }).success).toBe(false);
    expect(RealWorldPhraseSchema.safeParse({ ...good, text: "   " }).success).toBe(false);
    expect(RealWorldPhraseSchema.safeParse({ ...good, text: "a".repeat(301) }).success).toBe(false);
    expect(RealWorldPhraseSchema.safeParse({ ...good, id: "" }).success).toBe(false);
    expect(RealWorldPhraseSchema.safeParse({ ...good, seenAt: "" }).success).toBe(false);
  });

  it("has unique ids", () => {
    const ids = corpus.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("has non-blank texts of at most 300 characters", () => {
    for (const item of corpus) {
      expect(item.text.trim(), item.id).not.toBe("");
      expect(item.text.length, item.id).toBeLessThanOrEqual(300);
    }
  });

  it("holds at least 100 texts, at least 40 English and at least 40 Turkish", () => {
    expect(corpus.length).toBeGreaterThanOrEqual(100);
    expect(corpus.filter((item) => item.language === "en").length).toBeGreaterThanOrEqual(40);
    expect(corpus.filter((item) => item.language === "tr").length).toBeGreaterThanOrEqual(40);
  });
});

describe("the real-world corpus: anti-copy rule (requirements 3.10 and 3.11)", () => {
  it("holds no text that equals a planted Boo-tique text, after normalisation", () => {
    const planted = new Set(plantedTexts().map((text) => normaliseText(text)));
    const hits = corpus
      .filter((item) => planted.has(normaliseText(item.text)))
      .map((item) => `${item.id}: "${item.text}"`);
    expect(hits).toEqual([]);
  });

  it("holds no demo term in any text", () => {
    const terms = DEMO_TERMS.map((term) => keyTokens(term));
    const hits: string[] = [];
    for (const item of corpus) {
      const tokens = keyTokens(item.text);
      DEMO_TERMS.forEach((term, index) => {
        if (containsSequence(tokens, terms[index])) {
          hits.push(`${item.id}: "${item.text}" holds "${term}"`);
        }
      });
    }
    expect(hits).toEqual([]);
  });

  // Requirement 3.11: no containment check between a corpus text and a
  // planted text, so a corpus text that holds "selling fast" is accepted.
  it("accepts a text that merely contains a planted phrase (no containment check)", () => {
    const planted = plantedTexts().map((text) => normaliseText(text));
    expect(planted).toContain("selling fast");
    const longer = normaliseText("Selling fast: 40 sold in the last 24 hours");
    expect(planted).not.toContain(longer);
  });
});
