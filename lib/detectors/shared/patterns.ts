/**
 * The only regular expressions under lib/detectors/ (requirement 15.6).
 *
 * Every pattern is anchored, has no global or sticky flag (so it keeps no
 * state between calls), and obeys the safety rules of requirement 15.7: no `+`,
 * no `*`, no `{n,}`, only `?` after a closing parenthesis, no quantified group
 * whose body has a quantifier, and every bound at most 300. Callers cut the
 * input to its cap before testing it.
 */
export const SAFE_PATTERNS: Readonly<{
  /** Strict UTC time of `capturedAt`: `YYYY-MM-DDTHH:MM:SS` with an optional 1 to 9 digit fraction, then `Z`. */
  isoUtc: RegExp;
  /** A computed pixel size such as `12px` or `11.5px`. */
  px: RegExp;
  /** One to 300 ASCII digits and nothing else. */
  digits: RegExp;
}> = Object.freeze({
  isoUtc:
    /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z|\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{1,9}Z)$/,
  px: /^(\d{1,6}|\d{1,6}\.\d{1,4})px$/,
  digits: /^\d{1,300}$/,
});
