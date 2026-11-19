import { MONTHS } from "@/lib/detectors/data/months";
import { MAX_TOKENS_PER_TEXT } from "@/lib/detectors/shared/constants";
import { normaliseText } from "@/lib/detectors/shared/text";
import type { Token } from "@/lib/detectors/shared/text";

/**
 * Calendar dates in page text, parsed from tokens without the built-in date
 * text parser. Forms: day, month name and optional year (English and
 * Turkish, with an optional ordinal suffix); month name first, day and
 * optional year; ISO year-month-day; dotted day.month.year; and slash dates
 * with a four-digit year, which are "ambiguous" when day-first and month-first
 * both give a real date and the two differ. Years run from 2000 to 2099.
 *
 * A date that does not exist (29 February 2027, 31 April) is skipped, and its
 * tokens are consumed so that its day is not read again as part of another
 * date. `endMs` is the stated time of day when one follows the date, else
 * 23:59:59 UTC of that day; it is null for dates without a year and for
 * ambiguous ones. Time zones are not read; the detector allows for them with
 * `DATE_ZONE_SLACK_HOURS`.
 */

export type CalendarDate = {
  readonly kind: "full" | "no-year" | "ambiguous";
  /** End of the date as epoch milliseconds in UTC; null unless `kind` is "full". */
  readonly endMs: number | null;
  /** Index of the first token of the date. */
  readonly start: number;
  /** Index after the last token of the date (the time of day is not included). */
  readonly end: number;
};

const FIRST_YEAR = 2000;
const LAST_YEAR = 2099;
const SLASH = String.fromCharCode(0x2f);
const END_OF_DAY_SECONDS = 23 * 3600 + 59 * 60 + 59;

/** Words and symbols that may sit between a date and its time of day. */
const TIME_LINKS: ReadonlySet<string> = new Set([",", "at", "saat", "@"]);
const MAX_TIME_LINKS = 2;
const ORDINALS: ReadonlySet<string> = new Set(["st", "nd", "rd", "th"]);

/** Normalised month name to month number; lookups only. */
const MONTH_BY_NAME: ReadonlyMap<string, number> = (() => {
  const map = new Map<string, number>();
  for (const language of ["en", "tr"] as const) {
    for (const [name, number] of MONTHS[language]) {
      map.set(normaliseText(name), number);
    }
  }
  return map;
})();

const NONE: readonly CalendarDate[] = Object.freeze([]);

type Reader = (index: number) => Token | undefined;

type Match = {
  /** Index of the first token after the matched tokens. */
  readonly next: number;
  /** The date, or null when the tokens had the shape of a date but it does not exist. */
  readonly date: CalendarDate | null;
};

function makeReader(tokens: readonly Token[]): Reader {
  const limit = Math.min(tokens.length, MAX_TOKENS_PER_TEXT);
  return (index) => {
    if (!Number.isInteger(index) || index < 0 || index >= limit) return undefined;
    const token = tokens[index];
    if (typeof token !== "object" || token === null) return undefined;
    if (typeof token.norm !== "string" || typeof token.kind !== "string") {
      return undefined;
    }
    return token;
  };
}

function isDigitsOnly(text: string): boolean {
  if (text.length === 0) return false;
  for (const ch of text) {
    if (ch < "0" || ch > "9") return false;
  }
  return true;
}

/** Value of a number token made only of digits with a length from `minLen` to `maxLen`; else null. */
function intOf(token: Token | undefined, minLen: number, maxLen: number): number | null {
  if (!token || token.kind !== "number") return null;
  const text = token.norm;
  if (text.length < minLen || text.length > maxLen || !isDigitsOnly(text)) return null;
  return Number(text);
}

function yearOf(token: Token | undefined): number | null {
  const value = intOf(token, 4, 4);
  return value !== null && value >= FIRST_YEAR && value <= LAST_YEAR ? value : null;
}

function monthOf(token: Token | undefined): number | null {
  if (!token || token.kind !== "word") return null;
  return MONTH_BY_NAME.get(token.norm) ?? null;
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** Days in a month; a missing year allows 29 February. */
function daysIn(month: number, year: number | null): number {
  if (month === 2) return year === null || isLeapYear(year) ? 29 : 28;
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

function isRealDay(day: number, month: number, year: number | null): boolean {
  return month >= 1 && month <= 12 && day >= 1 && day <= daysIn(month, year);
}

/**
 * Seconds since midnight of a clock time that follows a date, after at most
 * two linking tokens (a comma, "at", "saat"). Accepts H:MM, HH:MM and
 * HH:MM:SS, with am or pm after it. Returns null when there is no valid time.
 */
function readTimeOfDay(read: Reader, from: number): number | null {
  let index = from;
  for (let skipped = 0; skipped < MAX_TIME_LINKS; skipped += 1) {
    const link = read(index);
    if (link === undefined || !TIME_LINKS.has(link.norm)) break;
    index += 1;
  }
  const clock = read(index);
  if (!clock || clock.kind !== "number") return null;
  const parts = clock.norm.split(":");
  if (parts.length < 2 || parts.length > 3) return null;
  const hourText = parts[0];
  const minuteText = parts[1];
  const secondText = parts.length === 3 ? parts[2] : "00";
  if (
    hourText.length < 1 ||
    hourText.length > 2 ||
    minuteText.length !== 2 ||
    secondText.length !== 2 ||
    !isDigitsOnly(hourText) ||
    !isDigitsOnly(minuteText) ||
    !isDigitsOnly(secondText)
  ) {
    return null;
  }
  let hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  if (minute > 59 || second > 59) return null;
  const suffix = read(index + 1)?.norm;
  if (suffix === "am" || suffix === "pm") {
    if (hour < 1 || hour > 12) return null;
    hour = (hour % 12) + (suffix === "pm" ? 12 : 0);
  } else if (hour > 23) {
    return null;
  }
  return hour * 3600 + minute * 60 + second;
}

function fullDate(
  read: Reader,
  start: number,
  next: number,
  year: number,
  month: number,
  day: number
): Match {
  const stated = readTimeOfDay(read, next);
  const seconds = stated ?? END_OF_DAY_SECONDS;
  const endMs = Date.UTC(year, month - 1, day, 0, 0, 0) + seconds * 1000;
  return { next, date: Object.freeze({ kind: "full", endMs, start, end: next }) };
}

function yearlessDate(start: number, next: number): Match {
  return {
    next,
    date: Object.freeze({ kind: "no-year", endMs: null, start, end: next }),
  };
}

/** Optional comma and a year after a day and month name; returns the year and the next index. */
function readYear(read: Reader, from: number): { year: number | null; next: number } {
  let index = from;
  if (read(index)?.norm === ",") index += 1;
  const year = yearOf(read(index));
  return year === null ? { year: null, next: from } : { year, next: index + 1 };
}

function skipOrdinal(read: Reader, index: number): number {
  const token = read(index);
  return token !== undefined && token.kind === "word" && ORDINALS.has(token.norm)
    ? index + 1
    : index;
}

function finishNamed(
  read: Reader,
  start: number,
  after: number,
  day: number,
  month: number
): Match {
  const { year, next } = readYear(read, after);
  if (!isRealDay(day, month, year)) return { next, date: null };
  return year === null
    ? yearlessDate(start, next)
    : fullDate(read, start, next, year, month, day);
}

/** Day, optional ordinal, month name, optional year. */
function matchDayFirst(read: Reader, i: number): Match | null {
  const day = intOf(read(i), 1, 2);
  if (day === null) return null;
  const monthIndex = skipOrdinal(read, i + 1);
  const month = monthOf(read(monthIndex));
  if (month === null) return null;
  return finishNamed(read, i, monthIndex + 1, day, month);
}

/** Month name, day, optional ordinal, optional year. */
function matchMonthFirst(read: Reader, i: number): Match | null {
  const month = monthOf(read(i));
  if (month === null) return null;
  const day = intOf(read(i + 1), 1, 2);
  if (day === null) return null;
  return finishNamed(read, i, skipOrdinal(read, i + 2), day, month);
}

/** Year, hyphen, month, hyphen, day. */
function matchIso(read: Reader, i: number): Match | null {
  const year = yearOf(read(i));
  if (year === null) return null;
  if (read(i + 1)?.norm !== "-" || read(i + 3)?.norm !== "-") return null;
  const month = intOf(read(i + 2), 1, 2);
  const day = intOf(read(i + 4), 1, 2);
  if (month === null || day === null) return null;
  if (!isRealDay(day, month, year)) return { next: i + 5, date: null };
  return fullDate(read, i, i + 5, year, month, day);
}

/** One number token holding day, month and year joined by dots. */
function matchDotted(read: Reader, i: number): Match | null {
  const token = read(i);
  if (!token || token.kind !== "number" || token.norm.length > 10) return null;
  const parts = token.norm.split(".");
  if (parts.length !== 3) return null;
  const [dayText, monthText, yearText] = parts;
  if (
    dayText.length < 1 ||
    dayText.length > 2 ||
    monthText.length < 1 ||
    monthText.length > 2 ||
    yearText.length !== 4 ||
    !isDigitsOnly(dayText) ||
    !isDigitsOnly(monthText) ||
    !isDigitsOnly(yearText)
  ) {
    return null;
  }
  const year = Number(yearText);
  if (year < FIRST_YEAR || year > LAST_YEAR) return null;
  const day = Number(dayText);
  const month = Number(monthText);
  if (!isRealDay(day, month, year)) return { next: i + 1, date: null };
  return fullDate(read, i, i + 1, year, month, day);
}

/** Two numbers and a four-digit year joined by slashes; day-first and month-first are both tried. */
function matchSlash(read: Reader, i: number): Match | null {
  const first = intOf(read(i), 1, 2);
  const second = intOf(read(i + 2), 1, 2);
  const year = yearOf(read(i + 4));
  if (first === null || second === null || year === null) return null;
  if (read(i + 1)?.norm !== SLASH || read(i + 3)?.norm !== SLASH) return null;
  const next = i + 5;
  const dayFirst = isRealDay(first, second, year);
  const monthFirst = isRealDay(second, first, year);
  if (dayFirst && monthFirst && first !== second) {
    return {
      next,
      date: Object.freeze({ kind: "ambiguous", endMs: null, start: i, end: next }),
    };
  }
  if (dayFirst) return fullDate(read, i, next, year, second, first);
  if (monthFirst) return fullDate(read, i, next, year, first, second);
  return { next, date: null };
}

const MATCHERS: ReadonlyArray<(read: Reader, i: number) => Match | null> = [
  matchDotted,
  matchIso,
  matchSlash,
  matchDayFirst,
  matchMonthFirst,
];

/**
 * Find every calendar date in the tokens, in token order. Reads at most
 * `MAX_TOKENS_PER_TEXT` tokens; odd input gives an array.
 */
export function parseCalendarDates(tokens: readonly Token[]): readonly CalendarDate[] {
  const list: unknown = tokens;
  if (!Array.isArray(list) || list.length === 0) return NONE;
  const read = makeReader(tokens);
  const limit = Math.min(list.length, MAX_TOKENS_PER_TEXT);
  const found: CalendarDate[] = [];
  let i = 0;
  while (i < limit) {
    let match: Match | null = null;
    for (const matcher of MATCHERS) {
      match = matcher(read, i);
      if (match !== null) break;
    }
    if (match === null) {
      i += 1;
      continue;
    }
    if (match.date !== null) found.push(match.date);
    i = Math.max(match.next, i + 1);
  }
  return Object.freeze(found);
}
