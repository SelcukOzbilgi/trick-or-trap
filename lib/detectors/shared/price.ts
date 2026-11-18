import { CURRENCY_WORDS } from "@/lib/detectors/data/preselection-words";
import { MAX_TOKENS_PER_TEXT } from "@/lib/detectors/shared/constants";
import type { Token } from "@/lib/detectors/shared/text";

/**
 * Price parser (requirement 12.5). A price is a currency token (a symbol such
 * as `$`, `€`, `£`, `₺`, `¥`, or a code such as `usd`, `eur`, `gbp`, `TRY`,
 * `tl`) directly before or after a number token, with an optional `+` in
 * front of the whole price. Amounts are integer minor units (cents).
 *
 * In a number the last separator is the decimal separator when one or two
 * digits follow it; every other separator is a thousands separator and must be
 * followed by exactly three digits. Anything else is not read as a price.
 */

export type Price = {
  /** Amount in minor units (cents). */
  readonly minor: number;
  /** True when a `+` stands directly before the price. */
  readonly plus: boolean;
  /** The currency token, case-folded (`$`, `₺`, `tl`, `usd`). */
  readonly currency: string;
  /** Index of the first token of the price (the `+` when there is one). */
  readonly start: number;
  /** Index after the last token of the price (exclusive). */
  readonly end: number;
};

/** Amounts above this many minor units (100,000.00 of a currency) are not read as prices. */
const MAX_MINOR = 10_000_000;

/** Longest run of digits accepted in one amount, so that arithmetic stays exact. */
const MAX_AMOUNT_DIGITS = 12;

const CURRENCIES: ReadonlySet<string> = new Set(CURRENCY_WORDS);

function isCurrency(token: Token | undefined): boolean {
  if (token === undefined || typeof token.norm !== "string") return false;
  if (!CURRENCIES.has(token.norm)) return false;
  if (token.kind === "symbol") return true;
  if (token.kind !== "word") return false;
  // "try" is an English verb: only the capitals "TRY" are a currency code.
  return token.norm !== "try" || token.surface === "TRY";
}

function isPlus(token: Token | undefined): boolean {
  return token !== undefined && token.kind === "symbol" && token.norm === "+";
}

/** Minor units of a number token, or null when it is not a plain amount. */
function amountMinor(norm: string): number | null {
  if (typeof norm !== "string" || norm.length === 0 || norm.length > 24) return null;
  const groups: string[] = [];
  const separators: string[] = [];
  let current = "";
  for (const ch of norm) {
    if (ch >= "0" && ch <= "9") {
      current += ch;
    } else if (ch === "." || ch === ",") {
      groups.push(current);
      separators.push(ch);
      current = "";
    } else {
      return null; // a clock such as 04:59:59, or anything else
    }
  }
  groups.push(current);
  if (groups.some((g) => g.length === 0)) return null;

  let whole: string;
  let fraction = "";
  const last = groups[groups.length - 1];
  if (separators.length === 0) {
    whole = last;
  } else {
    const lastSeparator = separators[separators.length - 1];
    const earlier = separators.slice(0, -1);
    const middle = groups.slice(1, -1);
    const firstOk = groups[0].length >= 1 && groups[0].length <= 3;
    const allSame = separators.every((s) => s === separators[0]);
    if (last.length === 3 && allSame && firstOk && groups.slice(1).every((g) => g.length === 3)) {
      whole = groups.join(""); // thousands separators only
    } else if (
      (last.length === 1 || last.length === 2) &&
      earlier.every((s) => s === earlier[0] && s !== lastSeparator) &&
      middle.every((g) => g.length === 3) &&
      (earlier.length === 0 || firstOk)
    ) {
      whole = groups.slice(0, -1).join("");
      fraction = last;
    } else {
      return null;
    }
  }
  if (whole.length > MAX_AMOUNT_DIGITS) return null;
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isFinite(minor) && minor <= MAX_MINOR ? minor : null;
}

/** Every price in the tokens, in text order. Never throws; a value that is not a token array gives []. */
export function parsePrices(tokens: readonly Token[]): readonly Price[] {
  const found: Price[] = [];
  const list: unknown = tokens;
  if (!Array.isArray(list)) return Object.freeze(found);

  const limit = Math.min(tokens.length, MAX_TOKENS_PER_TEXT);
  for (let i = 0; i < limit; i += 1) {
    const token = tokens[i];
    if (!token || token.kind !== "number") continue;
    const minor = amountMinor(token.norm);
    if (minor === null) continue;

    const before = i > 0 ? tokens[i - 1] : undefined;
    const after = i + 1 < limit ? tokens[i + 1] : undefined;
    if (isCurrency(before)) {
      const plus = i > 1 && isPlus(tokens[i - 2]);
      found.push(
        Object.freeze({
          minor,
          plus,
          currency: (before as Token).norm,
          start: plus ? i - 2 : i - 1,
          end: i + 1,
        })
      );
    } else if (isCurrency(after)) {
      const plus = isPlus(before);
      found.push(
        Object.freeze({
          minor,
          plus,
          currency: (after as Token).norm,
          start: plus ? i - 1 : i,
          end: i + 2,
        })
      );
    }
  }
  return Object.freeze(found);
}
