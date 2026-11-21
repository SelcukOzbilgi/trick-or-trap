import { REDACTED_SHARE_MAX } from "@/lib/judge/constants";

/**
 * Redaction of personal data in candidate text (design section 10). Pure: no
 * clock, no randomness, no state. The rules run in a fixed order (requirement
 * 4.6) on text that is already cut to 200 characters. Every expression is
 * bounded and linear on text of that size.
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

/** Nine or more digits, single spaces, dots or dashes allowed between them. */
const DIGIT_RUN = /\p{Nd}(?:[ .-]?\p{Nd}){8,}/gu;

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
  out = out.replace(DIGIT_RUN, NUMBER_PLACEHOLDER);
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
