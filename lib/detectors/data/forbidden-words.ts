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

/**
 * Stems of the same words. A token that starts with a stem and carries at most
 * `FORBIDDEN_STEM_EXTRA_MAX` letters after it counts as a forbidden word, so
 * inflected forms ("scammers", "frauds", "dolandırıcılara") are covered too.
 * Entries are plain lower-case words, normalised when they are loaded.
 *
 * Over-masking costs less than under-masking: a quoted "scampi" or "scampering"
 * is masked as well. This is accepted.
 */
export const FORBIDDEN_STEMS: readonly string[] = Object.freeze([
  "scam",
  "fraud",
  "illegal",
  "unlawful",
  "deceiv",
  "decept",
  "dolandırıcı",
  "yasadışı",
  "aldatıcı",
]);
