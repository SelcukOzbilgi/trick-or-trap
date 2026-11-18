/**
 * Review rule: a word is added here only when it asserts intent or legality
 * about a shop ("illegal", "scam", "fraud" and close relatives in English or
 * Turkish), as listed in findings-wording.md. Entries are plain lower-case
 * words; matching is whole-token after normaliseText. The word "lies" is not
 * listed because the template "The element lies outside the screenshot." uses
 * it in its spatial sense.
 *
 * This is the one place where these words may appear in the source.
 */
export const FORBIDDEN_WORDS: readonly string[] = Object.freeze([
  "illegal",
  "illegally",
  "unlawful",
  "scam",
  "scams",
  "scammy",
  "fraud",
  "fraudulent",
  "deceptive",
  "deceive",
  "deceives",
  "deceiving",
  "deceit",
  "dishonest",
  "cheat",
  "cheating",
  "yasadışı",
  "dolandırıcı",
  "dolandırıcılık",
  "aldatıcı",
]);
