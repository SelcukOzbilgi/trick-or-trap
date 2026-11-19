import type { WordList } from "@/lib/detectors/shared/text";

/**
 * Review rule: an entry is added here only when it comes from section B of
 * docs/research/dark-patterns.md or is common shop wording, never to make one
 * demo page pass. Entries are written in plain readable form; compilePhrases
 * normalises them. Each entry has at most six tokens. In a Turkish entry of a
 * list that is read through the phrase matcher, a word directly followed by `*`
 * is a stem: it matches that word and up to six further letters ("indirim*"
 * matches "indirimleri"); a stem has at least four characters.
 * FIRST_PERSON_SUFFIXES is read by the detector itself and has no stems.
 *
 * Turkish word endings are written with the letters of the language; the
 * detector normalises them with the same normaliser as the page text.
 */

/** Decline wording that casts the shopper as foolish or careless for saying no. */
export const SHAMING_PHRASES: WordList = Object.freeze({
  en: Object.freeze([
    "i hate saving",
    "i don't like saving money",
    "i'll pay full price",
    "i will pay full price",
    "i prefer to pay full price",
    "i'd rather pay full price",
    "i don't want to save",
    "i don't want a discount",
    "i'll miss out",
    "i like paying more",
  ]),
  tr: Object.freeze([
    "indirim* istemiyorum",
    "tasarruf etmek istemiyorum",
    "tam fiyat ödeyeceğim",
    "tam fiyat ödemeyi tercih ederim",
    "para biriktirmekten nefret ediyorum",
    "fırsat* kaçır* istiyorum",
    "indirim* kaçır* istiyorum",
  ]),
});

/** Words by which the shopper speaks about themself. */
export const FIRST_PERSON_TOKENS: WordList = Object.freeze({
  en: Object.freeze(["i", "i'll", "i'm", "i'd", "me", "my"]),
  tr: Object.freeze(["ben", "bana"]),
});

/** Turkish verb endings that carry the first person ("istemiyorum", "ödeyeceğim"). */
export const FIRST_PERSON_SUFFIXES: WordList = Object.freeze({
  en: Object.freeze([]),
  tr: Object.freeze(["miyorum", "mıyorum", "eceğim", "acağım"]),
});

/** Words of refusal, dislike or preference. */
export const NEGATION_EMOTION_TOKENS: WordList = Object.freeze({
  en: Object.freeze([
    "don't",
    "do not",
    "hate",
    "prefer",
    "rather",
    "enjoy",
    "like",
    "never",
  ]),
  tr: Object.freeze(["nefret*", "istemiyor*", "tercih*"]),
});

/** Words for something the shopper would gain or lose. */
export const BENEFIT_LOSS_TERMS: WordList = Object.freeze({
  en: Object.freeze([
    "saving",
    "save",
    "savings",
    "money",
    "discount",
    "deal",
    "free",
    "protection",
    "protect",
    "help",
    "full price",
    "miss out",
  ]),
  tr: Object.freeze([
    "indirim*",
    "tasarruf*",
    "para",
    "fırsat*",
    "koruma*",
    "ücretsiz",
    "tam fiyat",
    "kaçır*",
  ]),
});
