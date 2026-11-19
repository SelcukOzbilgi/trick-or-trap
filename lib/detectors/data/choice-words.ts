import type { WordList } from "@/lib/detectors/shared/text";

/**
 * Review rule: an entry is added here only when it comes from section B of
 * docs/research/dark-patterns.md or is common shop wording, never to make one
 * demo page pass. Entries are written in plain readable form; compilePhrases
 * normalises them. Each entry has at most six tokens.
 *
 * These lists name what a choice control says. They are matched at the start
 * of a control's text (accept, reject, lesser) or against its whole text
 * without punctuation (plain declines, close labels).
 */

/** Controls that take the offered option. */
export const ACCEPT_WORDS: WordList = Object.freeze({
  en: Object.freeze([
    "accept",
    "accept all",
    "allow",
    "allow all",
    "agree",
    "i agree",
    "ok",
    "got it",
    "yes",
    "continue",
    "add",
    "subscribe",
    "join",
    "sign up",
    "get",
    "claim",
    "give me",
  ]),
  tr: Object.freeze([
    "kabul et",
    "tümünü kabul et",
    "kabul",
    "izin ver",
    "onayla",
    "tamam",
    "evet",
    "ekle",
    "katıl",
    "abone ol",
    "istiyorum",
  ]),
});

/** Controls that turn the offered option down. */
export const REJECT_WORDS: WordList = Object.freeze({
  en: Object.freeze([
    "reject",
    "reject all",
    "decline",
    "refuse",
    "deny",
    "only necessary",
    "necessary only",
    "essential only",
    "no",
  ]),
  tr: Object.freeze([
    "reddet",
    "tümünü reddet",
    "sadece gerekli",
    "yalnızca zorunlu",
    "hayır",
  ]),
});

/** Controls that lead to more choices instead of an answer. */
export const LESSER_WORDS: WordList = Object.freeze({
  en: Object.freeze([
    "options",
    "settings",
    "preferences",
    "manage",
    "customise",
    "customize",
    "more options",
    "learn more",
  ]),
  tr: Object.freeze(["seçenekler", "ayarlar", "tercihler", "yönet", "özelleştir"]),
});

/** Labels (visible or aria-label) of a control that closes a dialog. */
export const CLOSE_WORDS: WordList = Object.freeze({
  en: Object.freeze(["close", "dismiss"]),
  tr: Object.freeze(["kapat"]),
});

/** Single characters a close control shows instead of a word. */
export const CLOSE_GLYPHS: readonly string[] = Object.freeze([
  "x",
  "\u00d7",
  "\u2715",
  "\u2716",
]);

/**
 * Whole-text declines that are polite and never shaming. A control whose
 * text, without punctuation, equals one of these is never a candidate.
 */
export const PLAIN_DECLINES: WordList = Object.freeze({
  en: Object.freeze([
    "no",
    "no thanks",
    "no thank you",
    "not now",
    "maybe later",
    "skip",
    "close",
    "cancel",
    "not interested",
  ]),
  tr: Object.freeze([
    "hayır",
    "hayır teşekkürler",
    "şimdi değil",
    "belki sonra",
    "daha sonra",
    "atla",
    "kapat",
    "ilgilenmiyorum",
  ]),
});

/** Words that show a choice is about consent, cookies or tracking. */
export const CONSENT_CONTEXT_WORDS: WordList = Object.freeze({
  en: Object.freeze([
    "cookie",
    "cookies",
    "consent",
    "privacy",
    "tracking",
    "partners",
    "preferences",
  ]),
  tr: Object.freeze([
    "çerez",
    "çerezler",
    "onay",
    "gizlilik",
    "izleme",
    "tercihler",
  ]),
});
