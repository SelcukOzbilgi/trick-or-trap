import type { WordList } from "@/lib/detectors/shared/text";

/**
 * Review rule: an entry is added here only when it comes from section B of
 * docs/research/dark-patterns.md or is common shop wording, never to make one
 * demo page pass. Entries are written in plain readable form; compilePhrases
 * normalises them. `#` stands for one number, `@` for one to three words that
 * start with a capital letter, and each entry has at most six tokens (a longer
 * entry would be skipped without a message).
 */

/** Viewer, buyer and cart counts: "14 people are viewing this". */
export const COUNT_TEMPLATES: WordList = Object.freeze({
  en: Object.freeze([
    "# people are viewing this",
    "# people viewing",
    "# people are looking at this",
    "# others are viewing",
    "# people have this in their",
    "# customers are viewing",
    "# sold in the last",
    "# bought in the last",
    "# sold today",
  ]),
  tr: Object.freeze([
    "# kişi bu ürünü inceliyor",
    "# kişi şu anda bakıyor",
    "# kişi görüntülüyor",
    "# kişi sepetine ekledi",
    "son # saatte # adet satıldı",
    "bugün # adet satıldı",
  ]),
});

/** Purchase messages with a capitalised name and place: "Alex from Leeds just bought". */
export const PURCHASE_TEMPLATES: WordList = Object.freeze({
  en: Object.freeze([
    "@ from @ just bought",
    "@ from @ just purchased",
    "@ from @ recently bought",
    "@ in @ just ordered",
  ]),
  tr: Object.freeze([
    "@'dan @ az önce satın aldı",
    "@'den @ az önce satın aldı",
    "@ az önce satın aldı",
  ]),
});

/**
 * Purchase messages that name a person and a place but use a bare verb:
 * "Sarah in London purchased a Blue Dress 5 minutes ago". They count as a claim
 * only when the same element holds a word of PURCHASE_TIME_WORDS, because a
 * review such as "Sarah from London bought this for her mother" has the same
 * shape without one. English only.
 */
export const TIMED_PURCHASE_TEMPLATES: WordList = Object.freeze({
  en: Object.freeze([
    "@ in @ purchased",
    "@ from @ purchased",
    "@ in @ bought",
    "@ from @ bought",
    "someone in @ purchased",
    "someone from @ purchased",
    "someone in @ bought",
    "someone from @ bought",
  ]),
  tr: Object.freeze([]),
});

/** Time words that turn a TIMED_PURCHASE_TEMPLATES match into a purchase claim. English only. */
export const PURCHASE_TIME_WORDS: WordList = Object.freeze({
  en: Object.freeze(["ago", "just now", "recently"]),
  tr: Object.freeze([]),
});

/** Wording that marks a message as live. */
export const ACTIVITY_CONTEXT_WORDS: WordList = Object.freeze({
  en: Object.freeze(["right now"]),
  tr: Object.freeze(["şu anda"]),
});

/** Honest look-alikes: review counts and the shopper's own cart. */
export const ACTIVITY_LOOKALIKES: WordList = Object.freeze({
  en: Object.freeze(["reviews", "ratings", "items in your cart"]),
  tr: Object.freeze(["sepetinizde # ürün", "değerlendirme"]),
});
