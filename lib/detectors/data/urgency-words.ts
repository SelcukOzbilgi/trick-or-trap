import type { WordList } from "@/lib/detectors/shared/text";

/**
 * Review rule: an entry is added here only when it comes from section B of
 * docs/research/dark-patterns.md or is common shop wording, never to make one
 * demo page pass. Entries are written in plain readable form; compilePhrases
 * normalises them. Each entry has at most six tokens.
 */

/** Words that show a time limit is being pressed on the reader. */
export const URGENCY_WORDS: WordList = Object.freeze({
  en: Object.freeze([
    "ends",
    "ends in",
    "ending",
    "expires",
    "expires in",
    "hurry",
    "last chance",
    "left",
    "remaining",
    "only",
    "limited time",
    "closes in",
  ]),
  tr: Object.freeze([
    "bitiyor",
    "sona eriyor",
    "son şans",
    "kaldı",
    "acele",
    "sınırlı süre",
    "kapanıyor",
  ]),
});

/** Words that show a price offer is being made. */
export const OFFER_WORDS: WordList = Object.freeze({
  en: Object.freeze(["off", "sale", "deal", "offer", "discount", "save", "coupon"]),
  tr: Object.freeze(["indirim", "fırsat", "kampanya", "kupon", "kazan"]),
});

/** Deadlines that roll over to the next day without a calendar date. */
export const ROLLING_DEADLINE_PHRASES: WordList = Object.freeze({
  en: Object.freeze([
    "ends at midnight",
    "ends tonight",
    "ends today",
    "today only",
    "last day",
    "until midnight",
  ]),
  tr: Object.freeze([
    "gece yarısı",
    "gece yarısına kadar",
    "sadece bugün",
    "bugün son gün",
    "bu gece sona eriyor",
  ]),
});

/** Wording that points to a deadline; read together with a calendar date. */
export const FUTURE_DEADLINE_WORDS: WordList = Object.freeze({
  en: Object.freeze(["ends", "ending", "expires", "until"]),
  tr: Object.freeze(["sona eriyor", "bitiyor", "geçerli"]),
});

/** Delivery cut-off wording: an honest look-alike of a deadline. */
export const SHIPPING_CUTOFF_PHRASES: WordList = Object.freeze({
  en: Object.freeze([
    "order within",
    "for next-day delivery",
    "ships today",
    "dispatched today",
  ]),
  tr: Object.freeze(["aynı gün kargo", "kargoya verilir", "saate kadar sipariş"]),
});

/** Words that turn a clock into a time of day. */
export const TIME_OF_DAY_WORDS: WordList = Object.freeze({
  en: Object.freeze(["at"]),
  tr: Object.freeze(["saat"]),
});

/**
 * Words that make a `units` or `clock2` countdown "worded": a deadline cue in
 * the same element. Without one, "12 hours" or "12:34" is read as an ordinary
 * duration.
 */
export const COUNTDOWN_CUE_WORDS: WordList = Object.freeze({
  en: Object.freeze([
    "ends in",
    "expires in",
    "closes in",
    "left",
    "remaining",
    "only",
    "hurry",
  ]),
  tr: Object.freeze(["bitiyor", "sona eriyor", "kaldı", "kapanıyor"]),
});
