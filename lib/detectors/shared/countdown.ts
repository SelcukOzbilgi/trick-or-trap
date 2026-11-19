import { TIME_ZONE_TOKENS } from "@/lib/detectors/data/months";
import { parseCalendarDates } from "@/lib/detectors/shared/calendar-date";
import type { CalendarDate } from "@/lib/detectors/shared/calendar-date";
import { MAX_TOKENS_PER_TEXT } from "@/lib/detectors/shared/constants";
import type { Token } from "@/lib/detectors/shared/text";

/**
 * Countdowns in page text, parsed from tokens.
 *
 * Clock forms: `HH:MM:SS` and `H:MM:SS` (minutes and seconds 00 to 59) and
 * `MM:SS` and `M:SS` (seconds 00 to 59, the first field may exceed 59). Unit
 * forms: up to four number-unit pairs with strictly descending units, in
 * English (d, day, h, hr, hour, m, min, minute, s, sec, second and plurals)
 * or Turkish (gün, saat, dk, dakika, sn, saniye), such as "2h 30m". The
 * display unit is the smallest unit used, because a page cannot show finer
 * steps than that.
 *
 * A clock that reads as a time of day is not a countdown: one that comes
 * after "at" or "saat" within two tokens, after a calendar date within two
 * tokens, or before am, pm or a time zone name.
 */

export type Countdown = {
  /** Remaining time in seconds. */
  readonly seconds: number;
  /** Seconds in the smallest unit the text shows (1 for a clock, 60 for "2h 30m"). */
  readonly unitSeconds: number;
  readonly form: "clock3" | "clock2" | "units";
  /** Index of the first token of the countdown. */
  readonly start: number;
  /** Index after the last token of the countdown. */
  readonly end: number;
};

type Reader = (index: number) => Token | undefined;

type Unit = { readonly rank: number; readonly seconds: number };

const DAY: Unit = Object.freeze({ rank: 4, seconds: 86400 });
const HOUR: Unit = Object.freeze({ rank: 3, seconds: 3600 });
const MINUTE: Unit = Object.freeze({ rank: 2, seconds: 60 });
const SECOND: Unit = Object.freeze({ rank: 1, seconds: 1 });

/** Normalised unit word to its unit; lookups only. */
const UNIT_BY_WORD: ReadonlyMap<string, Unit> = new Map<string, Unit>([
  ["d", DAY],
  ["day", DAY],
  ["days", DAY],
  ["gün", DAY],
  ["h", HOUR],
  ["hr", HOUR],
  ["hrs", HOUR],
  ["hour", HOUR],
  ["hours", HOUR],
  ["saat", HOUR],
  ["m", MINUTE],
  ["min", MINUTE],
  ["mins", MINUTE],
  ["minute", MINUTE],
  ["minutes", MINUTE],
  ["dk", MINUTE],
  ["dakika", MINUTE],
  ["s", SECOND],
  ["sec", SECOND],
  ["secs", SECOND],
  ["second", SECOND],
  ["seconds", SECOND],
  ["sn", SECOND],
  ["saniye", SECOND],
]);

const MAX_PAIRS = 4;
const MAX_NUMBER_DIGITS = 6;
const MAX_CLOCK_FIRST_DIGITS = 3;
const AT_WORDS: ReadonlySet<string> = new Set(["at", "saat"]);
const MERIDIEM_WORDS: ReadonlySet<string> = new Set(["am", "pm"]);
const ZONE_WORDS: ReadonlySet<string> = new Set(TIME_ZONE_TOKENS);
const PAIR_LINKS: ReadonlySet<string> = new Set([",", "and", "ve"]);
/** Tokens that may separate a calendar date from the clock time after it. */
const DATE_GAP_TOKENS = 2;

const NONE: readonly Countdown[] = Object.freeze([]);

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

/** A field of two digits from 00 to 59. */
function isSexagesimal(text: string): boolean {
  return text.length === 2 && isDigitsOnly(text) && Number(text) <= 59;
}

/** Seconds and form of a clock token such as 04:59:59 or 9:59; null when it is not a valid clock. */
function readClock(
  token: Token
): { seconds: number; form: "clock3" | "clock2" } | null {
  if (token.kind !== "number" || token.norm.length > 12) return null;
  const parts = token.norm.split(":");
  if (parts.length < 2 || parts.length > 3) return null;
  const first = parts[0];
  if (first.length > MAX_CLOCK_FIRST_DIGITS || !isDigitsOnly(first)) return null;
  if (parts.length === 2) {
    if (!isSexagesimal(parts[1])) return null;
    return { seconds: Number(first) * 60 + Number(parts[1]), form: "clock2" };
  }
  if (!isSexagesimal(parts[1]) || !isSexagesimal(parts[2])) return null;
  return {
    seconds: Number(first) * 3600 + Number(parts[1]) * 60 + Number(parts[2]),
    form: "clock3",
  };
}

function followsCalendarDate(dates: readonly CalendarDate[], start: number): boolean {
  for (const date of dates) {
    if (date.end <= start && start - date.end <= DATE_GAP_TOKENS) return true;
  }
  return false;
}

/** True when the clock at tokens `start` to `end` reads as a time of day (requirement 8.3). */
function isTimeOfDay(
  read: Reader,
  dates: readonly CalendarDate[],
  start: number,
  end: number
): boolean {
  const before1 = read(start - 1)?.norm;
  const before2 = read(start - 2)?.norm;
  if (
    (before1 !== undefined && AT_WORDS.has(before1)) ||
    (before2 !== undefined && AT_WORDS.has(before2))
  ) {
    return true;
  }
  const after = read(end)?.norm;
  if (after !== undefined && (MERIDIEM_WORDS.has(after) || ZONE_WORDS.has(after))) {
    return true;
  }
  return followsCalendarDate(dates, start);
}

/** Up to four number-unit pairs from index `start` with strictly descending units. */
function readUnits(read: Reader, start: number): Countdown | null {
  let next = start;
  let seconds = 0;
  let unitSeconds = 0;
  let lastRank = Number.POSITIVE_INFINITY;
  let pairs = 0;
  while (pairs < MAX_PAIRS) {
    let at = next;
    if (pairs > 0) {
      const link = read(at);
      if (link !== undefined && PAIR_LINKS.has(link.norm)) at += 1;
    }
    const numberToken = read(at);
    const unitToken = read(at + 1);
    if (
      !numberToken ||
      !unitToken ||
      numberToken.kind !== "number" ||
      numberToken.norm.length > MAX_NUMBER_DIGITS ||
      !isDigitsOnly(numberToken.norm) ||
      unitToken.kind !== "word"
    ) {
      break;
    }
    const unit = UNIT_BY_WORD.get(unitToken.norm);
    if (unit === undefined || unit.rank >= lastRank) break;
    seconds += Number(numberToken.norm) * unit.seconds;
    unitSeconds = unit.seconds;
    lastRank = unit.rank;
    next = at + 2;
    pairs += 1;
  }
  if (pairs === 0) return null;
  return Object.freeze({ seconds, unitSeconds, form: "units", start, end: next });
}

/**
 * Find every countdown in the tokens, in token order. Reads at most
 * `MAX_TOKENS_PER_TEXT` tokens; odd input gives an array.
 */
export function parseCountdowns(tokens: readonly Token[]): readonly Countdown[] {
  const list: unknown = tokens;
  if (!Array.isArray(list) || list.length === 0) return NONE;
  const read = makeReader(tokens);
  const limit = Math.min(list.length, MAX_TOKENS_PER_TEXT);
  const dates = parseCalendarDates(tokens);
  const found: Countdown[] = [];
  let i = 0;
  while (i < limit) {
    const token = read(i);
    if (token === undefined) {
      i += 1;
      continue;
    }
    const clock = readClock(token);
    if (clock !== null) {
      if (!isTimeOfDay(read, dates, i, i + 1)) {
        found.push(
          Object.freeze({
            seconds: clock.seconds,
            unitSeconds: 1,
            form: clock.form,
            start: i,
            end: i + 1,
          })
        );
      }
      i += 1;
      continue;
    }
    const units = readUnits(read, i);
    if (units !== null) {
      found.push(units);
      i = units.end;
      continue;
    }
    i += 1;
  }
  return Object.freeze(found);
}
