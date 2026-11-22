import { REDACTED_SHARE_MAX } from "@/lib/judge/constants";

/**
 * Redaction of personal data in candidate text (design section 10). Pure: no
 * clock, no randomness, no state. The rules run in a fixed order (requirement
 * 4.6, design 24.4). The caller bounds the text (at most 2,000 characters after
 * normalisation, requirement 23.2); every expression is bounded and linear.
 */

export const EMAIL_PLACEHOLDER = "[email]";
export const LINK_PLACEHOLDER = "[link]";
export const NUMBER_PLACEHOLDER = "[number]";
export const HANDLE_PLACEHOLDER = "[handle]";

const PLACEHOLDERS: readonly string[] = [
  EMAIL_PLACEHOLDER,
  LINK_PLACEHOLDER,
  NUMBER_PLACEHOLDER,
  HANDLE_PLACEHOLDER,
];

/** Local part, `@`, then a dotted domain. The lookbehind keeps it linear. */
const EMAIL =
  /(?<![\p{L}\p{N}._%+-])[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+/gu;

/** A scheme separator anywhere in a token. */
const SCHEME_SEPARATOR = "://";

/** `www.` at the start of a token or after punctuation. */
const WWW_HOST = /(?:^|[^\p{L}\p{N}])www\./iu;

/** A dotted host directly followed by `/`, `?` or `#`. */
const DOTTED_HOST =
  /(?:^|[^\p{L}\p{N}-])(?:[\p{L}\p{N}-]+\.)+\p{L}{2,}[/?#]/u;

/**
 * A digit run (design 24.4): a digit, then any number of (gap, digit) pairs.
 * A gap is 0 to 3 characters from the separator set space, `.`, `-`, `/`, `(`
 * and `)`; a space inside a gap is never directly followed by another space,
 * so a double space still ends a run (see the note on `redactDigits`). An
 * opening `(` directly before the first digit and a closing `)` directly after
 * the last digit belong to the run. Digits and separators never overlap, so
 * each text position has one parse and the match is linear.
 */
const DIGIT_RUN = /\(?\p{Nd}(?:(?:[.\-/()]| (?! )){0,3}\p{Nd})*\)?/gu;

/** A single digit of any script. Not global, so it keeps no state. */
const DIGIT = /\p{Nd}/u;

/** A run or a part of a run with this many digits is replaced. */
const NUMBER_MIN_DIGITS = 9;

/**
 * Protected spans (design 24.4). Each is written with ASCII digits, is not
 * preceded or followed by a digit of any script, and is checked for plausible
 * values after the match. The same separator must stand twice in a date.
 */
const DATE_DAY_OR_MONTH_FIRST =
  /(?<!\p{Nd})(\d{1,2})([./-])(\d{1,2})\2((?:19|20|21)\d{2})(?!\p{Nd})/gu;
const DATE_YEAR_FIRST =
  /(?<!\p{Nd})((?:19|20|21)\d{2})([./-])(\d{1,2})\2(\d{1,2})(?!\p{Nd})/gu;
const TIME_OF_DAY =
  /(?<!\p{Nd})(\d{1,2}):([0-5]\d)(?::([0-5]\d))?(?!\p{Nd})/gu;

/**
 * Residue of an IBAN after the digit rule: two capital letters, then either
 * two digits or the number placeholder (the digit rule may already have
 * replaced the check digits), then groups of at most four capitals or digits.
 * Each group must end at a non-alphanumeric character, so a following word is
 * never swallowed and the match is unambiguous.
 */
const IBAN_SHAPE =
  /\b[A-Z]{2}(?:\d{2}|\[number\])(?: ?(?:[A-Z0-9]{1,4}(?![A-Za-z0-9])|\[number\]))*/gu;

/** The IBAN shape needs ten characters after the two check digits. */
const IBAN_MIN_BODY_CHARS = 10;
/** A number placeholder stands for a run of at least nine digits. */
const NUMBER_PLACEHOLDER_STANDIN = "0".repeat(12);

/** `@` followed by a word. */
const HANDLE = /@[\p{L}\p{N}_]+/gu;

function isUrlToken(token: string): boolean {
  return (
    token.includes(SCHEME_SEPARATOR) ||
    WWW_HOST.test(token) ||
    DOTTED_HOST.test(token)
  );
}

function redactUrls(text: string): string {
  return text.replace(/\S+/gu, (token) =>
    isUrlToken(token) ? LINK_PLACEHOLDER : token,
  );
}

interface Span {
  readonly start: number;
  readonly end: number;
}

function inRange(value: number, min: number, max: number): boolean {
  return value >= min && value <= max;
}

/** Day and month in either order: one of them 1-12, the other 1-31. */
function isPlausibleDayAndMonth(a: number, b: number): boolean {
  return (
    (inRange(a, 1, 31) && inRange(b, 1, 12)) ||
    (inRange(a, 1, 12) && inRange(b, 1, 31))
  );
}

/**
 * Every match of `pattern` in `text` that `isPlausible` accepts. After a match
 * that is rejected the search resumes one character after its start, so a
 * plausible span that overlaps a rejected one is still found. A match starts
 * with an ASCII digit, so that position is always a character boundary.
 */
function collectSpans(
  text: string,
  pattern: RegExp,
  isPlausible: (match: RegExpExecArray) => boolean,
  into: Span[],
): void {
  const re = new RegExp(pattern.source, pattern.flags);
  let match = re.exec(text);
  while (match !== null) {
    if (isPlausible(match)) {
      into.push({ start: match.index, end: match.index + match[0].length });
    } else {
      re.lastIndex = match.index + 1;
    }
    match = re.exec(text);
  }
}

/** Dates and times of design 24.4, sorted, with overlapping spans merged. */
function findProtectedSpans(text: string): Span[] {
  const found: Span[] = [];
  collectSpans(
    text,
    DATE_DAY_OR_MONTH_FIRST,
    (m) => isPlausibleDayAndMonth(Number(m[1]), Number(m[3])),
    found,
  );
  collectSpans(
    text,
    DATE_YEAR_FIRST,
    (m) => inRange(Number(m[3]), 1, 12) && inRange(Number(m[4]), 1, 31),
    found,
  );
  collectSpans(text, TIME_OF_DAY, (m) => inRange(Number(m[1]), 0, 24), found);
  found.sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: Span[] = [];
  for (const span of found) {
    const last = merged[merged.length - 1];
    if (last !== undefined && span.start <= last.end) {
      merged[merged.length - 1] = {
        start: last.start,
        end: Math.max(last.end, span.end),
      };
    } else {
      merged.push(span);
    }
  }
  return merged;
}

function countDigits(text: string): number {
  let count = 0;
  for (const char of text) {
    if (DIGIT.test(char)) count += 1;
  }
  return count;
}

/**
 * The part of `text[from, to)` that is replaced when it holds enough digits:
 * from its first digit to its last, widened by a `(` directly before the first
 * digit and a `)` directly after the last, when those lie inside the part.
 */
function numberRangeOf(text: string, from: number, to: number): Span | null {
  let first = -1;
  let lastEnd = -1;
  let count = 0;
  let index = from;
  for (const char of text.slice(from, to)) {
    if (DIGIT.test(char)) {
      if (first === -1) first = index;
      lastEnd = index + char.length;
      count += 1;
    }
    index += char.length;
  }
  if (count < NUMBER_MIN_DIGITS) return null;
  const start = first > from && text.charAt(first - 1) === "(" ? first - 1 : first;
  const end = lastEnd < to && text.charAt(lastEnd) === ")" ? lastEnd + 1 : lastEnd;
  return { start, end };
}

/**
 * The digit rule of design 24.4. Runs are found first; only a run with enough
 * digits can hold a part that reaches the limit, so the protected dates and
 * times are looked for only then. Each protected span is cut out of the run,
 * and each remaining part is counted by its own digits and replaced as a whole
 * when it has 9 or more.
 *
 * Deviation from the letter of design 24.4: the gap may not hold two spaces in
 * a row. Design 24.4 allows 0 to 3 separator characters, which would also join
 * "1234  5678  9012", while the existing case "does not join digits across two
 * spaces" in tests/judge/redact.test.ts, which this task may not change, keeps
 * it apart. Every example of the design (" - ", " / ", " (", ") ") still joins.
 */
function redactDigits(text: string): string {
  const runs: Span[] = [];
  for (const match of text.matchAll(DIGIT_RUN)) {
    const start = match.index ?? 0;
    if (countDigits(match[0]) >= NUMBER_MIN_DIGITS) {
      runs.push({ start, end: start + match[0].length });
    }
  }
  if (runs.length === 0) return text;

  const spans = findProtectedSpans(text);
  const replaced: Span[] = [];
  let spanIndex = 0;
  for (const run of runs) {
    while (spanIndex < spans.length && (spans[spanIndex]?.end ?? 0) <= run.start) {
      spanIndex += 1;
    }
    let cursor = run.start;
    for (let i = spanIndex; i < spans.length; i += 1) {
      const span = spans[i];
      if (span === undefined || span.start >= run.end) break;
      if (span.start > cursor) {
        const range = numberRangeOf(text, cursor, span.start);
        if (range !== null) replaced.push(range);
      }
      cursor = Math.max(cursor, span.end);
    }
    if (cursor < run.end) {
      const range = numberRangeOf(text, cursor, run.end);
      if (range !== null) replaced.push(range);
    }
  }

  let out = "";
  let position = 0;
  for (const range of replaced) {
    out += text.slice(position, range.start) + NUMBER_PLACEHOLDER;
    position = range.end;
  }
  return out + text.slice(position);
}

function redactIban(text: string): string {
  return text.replace(IBAN_SHAPE, (match) => {
    const rest = match
      .slice(2)
      .split(NUMBER_PLACEHOLDER)
      .join(NUMBER_PLACEHOLDER_STANDIN);
    const alphanumeric = rest.replace(/[^A-Za-z0-9]/gu, "").length;
    // Two of the characters are the check digits.
    return alphanumeric - 2 >= IBAN_MIN_BODY_CHARS ? NUMBER_PLACEHOLDER : match;
  });
}

/**
 * Replace personal data in `text` with placeholders, in the order of
 * requirement 4.6: email, URL, long digit run, IBAN shape, handle. Prices,
 * short counts, clock times and names stay.
 */
export function redactText(text: string): string {
  let out = text.replace(EMAIL, EMAIL_PLACEHOLDER);
  out = redactUrls(out);
  out = redactDigits(out);
  out = redactIban(out);
  out = out.replace(HANDLE, HANDLE_PLACEHOLDER);
  return out;
}

/**
 * True when more than `REDACTED_SHARE_MAX` of the characters of `text` belong
 * to placeholders. Such a candidate carries no readable claim and is dropped.
 */
export function isMostlyRedacted(text: string): boolean {
  if (text.length === 0) return false;
  let placeholderChars = 0;
  for (const placeholder of PLACEHOLDERS) {
    let from = 0;
    for (;;) {
      const at = text.indexOf(placeholder, from);
      if (at === -1) break;
      placeholderChars += placeholder.length;
      from = at + placeholder.length;
    }
  }
  return placeholderChars / text.length > REDACTED_SHARE_MAX;
}
