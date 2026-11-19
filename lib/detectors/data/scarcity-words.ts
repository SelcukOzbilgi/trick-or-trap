import type { WordList } from "@/lib/detectors/shared/text";

/**
 * Review rule: an entry is added here only when it comes from section B of
 * docs/research/dark-patterns.md or is common shop wording, never to make one
 * demo page pass. Entries are written in plain readable form; compilePhrases
 * normalises them. `#` stands for one number and each entry has at most six
 * tokens.
 */

/** A qualifier, a number and a stock word: "Only 2 left". */
export const QUALIFIED_STOCK_TEMPLATES: WordList = Object.freeze({
  en: Object.freeze([
    "only # left",
    "only # left in stock",
    "only # remaining",
    "only # in stock",
    "only # available",
    "just # left",
    "just # remaining",
    "hurry, only # left",
  ]),
  tr: Object.freeze([
    "son # ürün",
    "son # adet",
    "sadece # adet kaldı",
    "sadece # ürün kaldı",
    "yalnızca # adet kaldı",
    "stokta son # ürün",
    "stokta sadece # adet",
  ]),
});

/** A number and a stock word without a qualifier: "3 left". Read only by the reload rule. */
export const BARE_STOCK_TEMPLATES: WordList = Object.freeze({
  en: Object.freeze(["# left", "# in stock", "# remaining", "# available"]),
  tr: Object.freeze(["# adet kaldı", "# ürün kaldı", "stokta # adet"]),
});

/** Scarcity wording without a number. */
export const UNQUANTIFIED_SCARCITY: WordList = Object.freeze({
  en: Object.freeze([
    "selling fast",
    "almost gone",
    "selling out fast",
    "almost sold out",
    "low stock",
    "high demand",
    "going fast",
    "limited stock",
    "limited quantity",
    "few left",
    "last few",
    "nearly sold out",
  ]),
  tr: Object.freeze([
    "çok satıyor",
    "hızla tükeniyor",
    "tükenmek üzere",
    "son birkaç",
    "sınırlı stok",
    "az kaldı",
    "stoklar azalıyor",
    "yoğun talep",
  ]),
});

/** Honest look-alikes: carts, review counts and shipping thresholds. */
export const SCARCITY_LOOKALIKES: WordList = Object.freeze({
  en: Object.freeze([
    "in your cart",
    "in your basket",
    "reviews",
    "ratings",
    "left for free shipping",
    "away from free shipping",
  ]),
  tr: Object.freeze(["sepetinizde", "değerlendirme", "yorum", "ücretsiz kargo"]),
});

/** Pressure words that support a stock claim of a higher number. */
export const SCARCITY_SUPPORT_WORDS: WordList = Object.freeze({
  en: Object.freeze([
    "hurry",
    "last chance",
    "don't miss out",
    "act fast",
    "order soon",
    "while stocks last",
    "while supplies last",
    "before it's gone",
  ]),
  tr: Object.freeze([
    "acele et",
    "acele edin",
    "kaçırmayın",
    "son şans",
    "tükenmeden",
  ]),
});
