import type { WordList } from "@/lib/detectors/shared/text";

/**
 * Review rule: an entry is added here only when it comes from section B of
 * docs/research/dark-patterns.md or is common shop wording, never to make one
 * demo page pass. Entries are written in plain readable form; compilePhrases
 * normalises them. Each entry has at most six tokens. In a Turkish entry a word
 * directly followed by `*` is a stem: it matches that word and up to six
 * further letters ("koruma*" matches "korumalı"); a stem has at least four
 * characters.
 */

/** Options that usually cost extra money (class "paid add-on"). */
export const PAID_ADDON_WORDS: WordList = Object.freeze({
  en: Object.freeze([
    "protection",
    "insurance",
    "warranty",
    "extended warranty",
    "donation",
    "donate",
    "tip",
    "priority",
    "express",
    "premium",
    "gift wrap",
    "upgrade",
    "add-on",
  ]),
  tr: Object.freeze([
    "koruma*",
    "sigorta*",
    "garanti*",
    "bağış",
    "bahşiş",
    "öncelikli",
    "ekspres",
    "hediye paketi",
  ]),
});

/** Options about messages, marketing or sharing data (class "consent"). */
export const CONSENT_WORDS: WordList = Object.freeze({
  en: Object.freeze([
    "newsletter",
    "marketing",
    "subscribe",
    "offers",
    "promotions",
    "partners",
    "third parties",
    "share my",
    "send me",
    "email me",
    "text me",
    "sms",
    "keep me updated",
  ]),
  tr: Object.freeze([
    "bülten*",
    "kampanya*",
    "pazarlama*",
    "iş ortakları",
    "üçüncü taraf",
    "paylaş",
    "bana gönder",
    "e-posta",
    "sms",
    "ileti",
  ]),
});

/** Options that are normal and needed (class "neutral" when no consent word is present). */
export const NEUTRAL_WORDS: WordList = Object.freeze({
  en: Object.freeze([
    "remember me",
    "keep me signed in",
    "stay signed in",
    "terms",
    "conditions",
    "i agree",
    "i accept",
    "same as billing",
    "save this address",
  ]),
  tr: Object.freeze([
    "beni hatırla",
    "oturumu açık tut",
    "koşullar",
    "şartlar",
    "sözleşme",
    "kabul ediyorum",
    "fatura adresi aynı",
  ]),
});

/** Words of an option that adds nothing, so its price counts as 0 in a radio group. */
export const NONE_WORDS: WordList = Object.freeze({
  en: Object.freeze(["no", "none", "without"]),
  tr: Object.freeze(["yok", "istemiyorum"]),
});

/** Words of a group the shopper has to choose from anyway (shipping, size and so on). */
export const REQUIRED_GROUP_WORDS: WordList = Object.freeze({
  en: Object.freeze(["shipping", "delivery", "size", "colour", "color"]),
  tr: Object.freeze(["kargo", "teslimat", "beden", "renk"]),
});

/** Words that stand for a price of 0 when a label holds no price. */
export const FREE_WORDS: WordList = Object.freeze({
  en: Object.freeze(["free"]),
  tr: Object.freeze(["ücretsiz"]),
});

/**
 * Currency symbols and codes (language free). A code is written in lower case
 * here; "try" counts only when the page writes it in capitals, because it is
 * also an English verb.
 */
export const CURRENCY_WORDS: readonly string[] = Object.freeze([
  "$",
  "€",
  "£",
  "₺",
  "¥",
  "usd",
  "eur",
  "gbp",
  "try",
  "tl",
]);
