/**
 * Review rule: an entry is added here only when it comes from section B of
 * docs/research/dark-patterns.md or is common shop wording, never to make one
 * demo page pass. Entries are written in plain readable form; the parsers
 * normalise them. Month names are language facts; time zone tokens are the
 * short names that follow a clock time on shop pages.
 */

/** Month names and short forms, each with its month number from 1 to 12. */
export const MONTHS: Readonly<
  Record<"en" | "tr", ReadonlyArray<readonly [string, number]>>
> = Object.freeze({
  en: Object.freeze([
    Object.freeze(["january", 1] as const),
    Object.freeze(["february", 2] as const),
    Object.freeze(["march", 3] as const),
    Object.freeze(["april", 4] as const),
    Object.freeze(["may", 5] as const),
    Object.freeze(["june", 6] as const),
    Object.freeze(["july", 7] as const),
    Object.freeze(["august", 8] as const),
    Object.freeze(["september", 9] as const),
    Object.freeze(["october", 10] as const),
    Object.freeze(["november", 11] as const),
    Object.freeze(["december", 12] as const),
    Object.freeze(["jan", 1] as const),
    Object.freeze(["feb", 2] as const),
    Object.freeze(["mar", 3] as const),
    Object.freeze(["apr", 4] as const),
    Object.freeze(["jun", 6] as const),
    Object.freeze(["jul", 7] as const),
    Object.freeze(["aug", 8] as const),
    Object.freeze(["sep", 9] as const),
    Object.freeze(["sept", 9] as const),
    Object.freeze(["oct", 10] as const),
    Object.freeze(["nov", 11] as const),
    Object.freeze(["dec", 12] as const),
  ]),
  tr: Object.freeze([
    Object.freeze(["ocak", 1] as const),
    Object.freeze(["şubat", 2] as const),
    Object.freeze(["mart", 3] as const),
    Object.freeze(["nisan", 4] as const),
    Object.freeze(["mayıs", 5] as const),
    Object.freeze(["haziran", 6] as const),
    Object.freeze(["temmuz", 7] as const),
    Object.freeze(["ağustos", 8] as const),
    Object.freeze(["eylül", 9] as const),
    Object.freeze(["ekim", 10] as const),
    Object.freeze(["kasım", 11] as const),
    Object.freeze(["aralık", 12] as const),
  ]),
});

/** Short time zone names that follow a clock time, which then reads as a time of day. */
export const TIME_ZONE_TOKENS: readonly string[] = Object.freeze([
  "utc",
  "gmt",
  "cet",
  "cest",
  "est",
  "edt",
  "pst",
  "pdt",
  "trt",
  "et",
  "pt",
]);
