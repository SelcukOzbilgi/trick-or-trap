import {
  FORBIDDEN_STEMS,
  FORBIDDEN_WORDS,
} from "@/lib/detectors/data/forbidden-words";
import {
  FORBIDDEN_STEM_EXTRA_MAX,
  MAX_PHRASE_TOKENS,
  MAX_QUOTE_CHARS,
  MAX_STEM_EXTRA_CHARS,
  MAX_TEXT_READ,
  MAX_TOKENS_PER_TEXT,
  MIN_STEM_CHARS,
} from "@/lib/detectors/shared/constants";

/**
 * Text helpers shared by all static detectors: one normaliser, one tokeniser
 * and a small phrase matcher. No regular expressions are used here (they live
 * only in shared/patterns.ts); every pass is a character loop over text that
 * was cut to its cap first.
 */

export type Language = "en" | "tr";

/** Word or phrase lists, one array per language. */
export type WordList = Readonly<Record<Language, readonly string[]>>;

export type Token = {
  /** Case-folded form, used for comparison. */
  readonly norm: string;
  /** Text after NFKC and cleaning, before case folding. */
  readonly surface: string;
  readonly kind: "word" | "number" | "symbol";
  /** Zero-based position of the token in the token array. */
  readonly index: number;
};

// ---------------------------------------------------------------------------
// Characters
// ---------------------------------------------------------------------------

type CharClass =
  | "space"
  | "ignorable"
  | "digit"
  | "apostrophe"
  | "symbol"
  | "mark"
  | "letter";

/** Characters removed by normalisation: zero-width, soft hyphen, word joiner, BOM, dot above. */
function isDropped(cp: number): boolean {
  return (
    (cp >= 0x200b && cp <= 0x200d) ||
    cp === 0x2060 ||
    cp === 0xfeff ||
    cp === 0x00ad ||
    cp === 0x0307
  );
}

/** Whitespace and control characters; both separate words. */
function isWhitespace(cp: number): boolean {
  return (
    cp <= 0x20 ||
    (cp >= 0x7f && cp <= 0xa0) ||
    cp === 0x1680 ||
    (cp >= 0x2000 && cp <= 0x200a) ||
    cp === 0x2028 ||
    cp === 0x2029 ||
    cp === 0x202f ||
    cp === 0x205f ||
    cp === 0x3000
  );
}

function isApostrophe(cp: number): boolean {
  return (
    cp === 0x27 || cp === 0x2018 || cp === 0x2019 || cp === 0x2bc || cp === 0xb4
  );
}

function isMark(cp: number): boolean {
  return (
    (cp >= 0x300 && cp <= 0x36f) ||
    (cp >= 0x1ab0 && cp <= 0x1aff) ||
    (cp >= 0x1dc0 && cp <= 0x1dff) ||
    (cp >= 0x20d0 && cp <= 0x20ff) ||
    (cp >= 0xfe00 && cp <= 0xfe0f) ||
    (cp >= 0xfe20 && cp <= 0xfe2f)
  );
}

/** Punctuation, currency, arrows, dingbats and emoji; everything else non-digit counts as a letter. */
function isSymbol(cp: number): boolean {
  if (cp < 0x80) {
    return (
      (cp >= 0x21 && cp <= 0x2f) ||
      (cp >= 0x3a && cp <= 0x40) ||
      (cp >= 0x5b && cp <= 0x60) ||
      (cp >= 0x7b && cp <= 0x7e)
    );
  }
  if (cp >= 0xa1 && cp <= 0xbf) {
    return cp !== 0xaa && cp !== 0xb5 && cp !== 0xba;
  }
  return (
    cp === 0xd7 ||
    cp === 0xf7 ||
    (cp >= 0x2000 && cp <= 0x206f) ||
    (cp >= 0x20a0 && cp <= 0x20cf) ||
    (cp >= 0x2190 && cp <= 0x2bff) ||
    (cp >= 0x3000 && cp <= 0x303f) ||
    (cp >= 0xfe30 && cp <= 0xfe6f) ||
    // Full-width punctuation, so that quote() sees it as a word boundary before NFKC.
    (cp >= 0xff01 && cp <= 0xff0f) ||
    (cp >= 0xff1a && cp <= 0xff20) ||
    (cp >= 0xff3b && cp <= 0xff40) ||
    (cp >= 0xff5b && cp <= 0xff65) ||
    (cp >= 0x1f000 && cp <= 0x1faff)
  );
}

function classify(cp: number): CharClass {
  if (isDropped(cp)) return "ignorable";
  if (isWhitespace(cp)) return "space";
  if ((cp >= 0x30 && cp <= 0x39) || (cp >= 0xff10 && cp <= 0xff19)) return "digit";
  if (isApostrophe(cp)) return "apostrophe";
  if (isMark(cp)) return "mark";
  if (isSymbol(cp)) return "symbol";
  return "letter";
}

// ---------------------------------------------------------------------------
// Normalising
// ---------------------------------------------------------------------------

/** Cut to at most `cap` UTF-16 units without leaving half of a surrogate pair. */
function cutCodeUnits(text: string, cap: number): string {
  if (text.length <= cap) return text;
  let end = cap;
  if (end > 0) {
    const last = text.charCodeAt(end - 1);
    if (last >= 0xd800 && last <= 0xdbff) end -= 1;
  }
  return text.slice(0, end);
}

function resolveCap(cap: number | undefined): number {
  return typeof cap === "number" && Number.isFinite(cap) && cap >= 0
    ? Math.floor(cap)
    : MAX_TEXT_READ;
}

/** Curly apostrophes and the dash variants become `'` and `-`. */
function unifyPunctuation(ch: string, cp: number): string {
  if (cp === 0x2018 || cp === 0x2019 || cp === 0x2bc || cp === 0xb4) return "'";
  if (cp === 0x2010 || cp === 0x2011 || cp === 0x2013 || cp === 0x2014) return "-";
  return ch;
}

/**
 * Cut, NFKC, drop invisible characters, unify apostrophes and dashes and
 * collapse whitespace. Keeps the letter case (the token surface).
 */
function cleanText(input: unknown, cap: number | undefined): string {
  if (typeof input !== "string") return "";
  const cut = cutCodeUnits(input, resolveCap(cap));
  // U+00B4 has a compatibility decomposition (space plus accent), so it is
  // mapped before NFKC, not after.
  const composed = cut.split("\u00b4").join("'").normalize("NFKC");
  let out = "";
  let pendingSpace = false;
  for (const ch of composed) {
    const cp = ch.codePointAt(0) as number;
    if (isDropped(cp)) continue;
    if (isWhitespace(cp)) {
      pendingSpace = out.length > 0;
      continue;
    }
    if (pendingSpace) {
      out += " ";
      pendingSpace = false;
    }
    out += unifyPunctuation(ch, cp);
  }
  return out;
}

/** Map "İ", "I" and "ı" to "i", then lower-case without a locale. */
function foldCase(text: string): string {
  let mapped = "";
  for (const ch of text) {
    mapped += ch === "\u0130" || ch === "I" || ch === "\u0131" ? "i" : ch;
  }
  return mapped.toLowerCase();
}

/**
 * The one normaliser of the detectors. Order of work: cut to the cap, NFKC,
 * remove zero-width characters, the soft hyphen and the dot above (U+0307),
 * unify apostrophes and dashes, collapse whitespace, map "İ", "I" and "ı" to
 * "i", `toLowerCase()` without a locale. U+0307 is removed in the cleaning
 * pass; nothing after it can create a new one because "İ" is mapped first.
 *
 * Folding both Turkish i forms to "i" is a deliberate locale decision: it
 * makes English and Turkish lists match with one rule.
 */
export function normaliseText(input: unknown, cap?: number): string {
  return foldCase(cleanText(input, cap));
}

/** Replace each run of digits with one "#", so "Only 4 left" and "Only 12 left" share a shape. */
export function maskDigits(norm: string): string {
  if (typeof norm !== "string") return "";
  let out = "";
  let inDigits = false;
  for (const ch of norm) {
    const isDigit = ch >= "0" && ch <= "9";
    if (isDigit) {
      if (!inDigits) out += "#";
      inDigits = true;
    } else {
      inDigits = false;
      out += ch;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

/**
 * Walk the cleaned text once. A word is a run of letters and marks with inner
 * apostrophes. A number is a run of digits with a single `.`, `,` or `:`
 * between digits. Every other non-space character is a symbol token. Letter
 * and digit runs split at their boundary ("2h" gives "2", "h"). A stray mark
 * that does not follow a letter is skipped. At most `MAX_TOKENS_PER_TEXT`
 * tokens are returned.
 */
export function tokenise(input: unknown, cap?: number): readonly Token[] {
  const clean = cleanText(input, cap);
  const chars = Array.from(clean);
  const classes: CharClass[] = chars.map((ch) =>
    classify(ch.codePointAt(0) as number)
  );
  const count = chars.length;
  const tokens: Token[] = [];

  const push = (surface: string, kind: Token["kind"]): void => {
    tokens.push(
      Object.freeze({
        norm: kind === "word" ? foldCase(surface) : surface,
        surface,
        kind,
        index: tokens.length,
      })
    );
  };

  let i = 0;
  while (i < count && tokens.length < MAX_TOKENS_PER_TEXT) {
    const cls = classes[i];
    if (cls === "space" || cls === "ignorable" || cls === "mark") {
      i += 1;
    } else if (cls === "digit") {
      let j = i + 1;
      while (j < count) {
        if (classes[j] === "digit") {
          j += 1;
        } else if (
          j + 1 < count &&
          classes[j + 1] === "digit" &&
          (chars[j] === "." || chars[j] === "," || chars[j] === ":")
        ) {
          j += 2;
        } else {
          break;
        }
      }
      push(chars.slice(i, j).join(""), "number");
      i = j;
    } else if (cls === "letter") {
      let j = i + 1;
      while (j < count) {
        const next = classes[j];
        if (next === "letter" || next === "mark") {
          j += 1;
        } else if (next === "apostrophe" && j + 1 < count && classes[j + 1] === "letter") {
          j += 1;
        } else {
          break;
        }
      }
      push(chars.slice(i, j).join(""), "word");
      i = j;
    } else {
      push(chars[i], "symbol");
      i += 1;
    }
  }
  return Object.freeze(tokens);
}

// ---------------------------------------------------------------------------
// Phrases
// ---------------------------------------------------------------------------

/** Opaque, frozen matcher built by `compilePhrases`; `size` is the number of compiled entries. */
export type PhraseMatcher = { readonly size: number };

export type PhraseHit = {
  /** The list entry as written. */
  readonly entry: string;
  readonly language: Language;
  /** Index of the first matched token. */
  readonly start: number;
  /** Index after the last matched token (exclusive). */
  readonly end: number;
  /** Values of the tokens matched by `#`, in order. */
  readonly numbers: readonly number[];
};

type EntryElement =
  | { readonly kind: "lit"; readonly norm: string }
  | { readonly kind: "num" }
  | { readonly kind: "name"; readonly suffix: string | null }
  | { readonly kind: "stem"; readonly stem: string };

type CompiledEntry = {
  readonly order: number;
  readonly entry: string;
  readonly language: Language;
  readonly elements: readonly EntryElement[];
};

type MatcherData = {
  readonly byFirst: ReadonlyMap<string, readonly CompiledEntry[]>;
  readonly placeholderFirst: readonly CompiledEntry[];
};

const MATCHER_DATA: unique symbol = Symbol("detectors.phrase-matcher");

type InternalMatcher = PhraseMatcher & { readonly [MATCHER_DATA]?: MatcherData };

/** Most words one `@` placeholder may take. */
const MAX_NAME_WORDS = 3;

/** List entries are read up to this many characters. */
const ENTRY_READ_CAP = 200;

/**
 * For each `*` of the cleaned entry, in order: true when a letter directly
 * precedes it (no space, symbol or digit between). The tokeniser drops that
 * information, and a stem must be written "word*".
 */
function starsTouchingLetters(entry: string): boolean[] {
  const chars = Array.from(normaliseText(entry, ENTRY_READ_CAP));
  const touching: boolean[] = [];
  for (let i = 0; i < chars.length; i += 1) {
    if (chars[i] !== "*") continue;
    const before = i > 0 ? classify(chars[i - 1].codePointAt(0) as number) : "space";
    touching.push(before === "letter" || before === "mark");
  }
  return touching;
}

function isStar(token: Token | undefined): boolean {
  return token !== undefined && token.kind === "symbol" && token.norm === "*";
}

/**
 * Turn an entry into elements, or null when the entry cannot be compiled.
 * `#` is a number, `@` is one to three capitalised words, and `@'dan` (a name
 * placeholder directly followed by an apostrophe and a word) is a name whose
 * last word ends with that suffix. A word directly followed by `*` is a stem
 * element; it is allowed only in a Turkish entry (`language` "tr", or not given
 * when only counting), only when the stem has at least `MIN_STEM_CHARS`
 * characters after normalisation, and a `*` that follows anything else is an
 * error (requirement 9.2).
 */
function toElements(entry: string, language: Language | undefined): EntryElement[] | null {
  const tokens = tokenise(entry, ENTRY_READ_CAP);
  const touching = starsTouchingLetters(entry);
  let starIndex = 0;
  const elements: EntryElement[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i];
    if (isStar(t)) {
      // A star that no word consumed below.
      return null;
    }
    if (t.kind === "symbol" && t.norm === "#") {
      elements.push({ kind: "num" });
    } else if (t.kind === "symbol" && t.norm === "@") {
      const apostrophe = tokens[i + 1];
      const suffix = tokens[i + 2];
      if (
        apostrophe !== undefined &&
        suffix !== undefined &&
        apostrophe.kind === "symbol" &&
        apostrophe.norm === "'" &&
        suffix.kind === "word"
      ) {
        elements.push({ kind: "name", suffix: `'${suffix.norm}` });
        i += 2;
      } else {
        elements.push({ kind: "name", suffix: null });
      }
    } else if (t.kind === "word" && isStar(tokens[i + 1])) {
      const attached = touching[starIndex] === true;
      starIndex += 1;
      if (!attached || language === "en") return null;
      if (Array.from(t.norm).length < MIN_STEM_CHARS) return null;
      elements.push({ kind: "stem", stem: t.norm });
      i += 1;
    } else {
      elements.push({ kind: "lit", norm: t.norm });
    }
  }
  return elements;
}

/**
 * Number of elements `compilePhrases` counts for one list entry: `#` is one,
 * `@` is one, `@'dan` (a name placeholder with a suffix) is one, a stem
 * ("indirim*") is one, every other token is one. 0 for an empty or non-string
 * entry and for an entry that cannot be compiled: a stray `*`, a stem shorter
 * than `MIN_STEM_CHARS`, or a stem when `language` is "en". A value above
 * `MAX_PHRASE_TOKENS` is returned as it is; `compilePhrases` skips such an
 * entry, and tests use this function so that they count the way the compiler
 * does. Without `language`, stems are allowed.
 */
export function countPhraseElements(entry: string, language?: Language): number {
  if (typeof entry !== "string") return 0;
  return toElements(entry, language)?.length ?? 0;
}

/**
 * Tokenise every entry once and index it by its first token. Entries with no
 * elements or more than `MAX_PHRASE_TOKENS` elements are not compiled, so work
 * per start token stays bounded; `size` counts the compiled entries.
 */
export function compilePhrases(list: WordList): PhraseMatcher {
  const byFirst = new Map<string, CompiledEntry[]>();
  const placeholderFirst: CompiledEntry[] = [];
  let order = 0;
  for (const language of ["en", "tr"] as const) {
    const entries: unknown = list?.[language];
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (typeof entry !== "string") continue;
      const elements = toElements(entry, language);
      if (elements === null || elements.length === 0 || elements.length > MAX_PHRASE_TOKENS) {
        continue;
      }
      const compiled: CompiledEntry = Object.freeze({
        order,
        entry,
        language,
        elements: Object.freeze(elements),
      });
      order += 1;
      const first = elements[0];
      if (first.kind === "lit") {
        const bucket = byFirst.get(first.norm);
        if (bucket) bucket.push(compiled);
        else byFirst.set(first.norm, [compiled]);
      } else {
        placeholderFirst.push(compiled);
      }
    }
  }
  const data: MatcherData = { byFirst, placeholderFirst };
  const matcher: InternalMatcher = { size: order, [MATCHER_DATA]: data };
  return Object.freeze(matcher);
}

/**
 * Value of a number token, or null when it cannot be read as one number.
 * Digits only: the integer. One separator kind followed by groups of exactly
 * three digits: thousands separators. One or two digits after the last
 * separator: a decimal part (the other separator kind, if any, groups thousands).
 */
function numberValue(norm: string): number | null {
  if (norm.length === 0 || norm.length > 24) return null;
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
      return null;
    }
  }
  groups.push(current);
  if (groups.some((g) => g.length === 0)) return null;
  if (separators.length === 0) return Number(norm);

  const firstOk = groups[0].length >= 1 && groups[0].length <= 3;
  const allSame = separators.every((s) => s === separators[0]);
  if (allSame && firstOk && groups.slice(1).every((g) => g.length === 3)) {
    return Number(groups.join(""));
  }
  const lastGroup = groups[groups.length - 1];
  const decimalOk = lastGroup.length >= 1 && lastGroup.length <= 2;
  if (separators.length === 1 && decimalOk) {
    return Number(`${groups[0]}.${lastGroup}`);
  }
  if (separators.length >= 2 && decimalOk && firstOk) {
    const lastSep = separators[separators.length - 1];
    const earlier = separators.slice(0, -1);
    if (
      earlier.every((s) => s === earlier[0] && s !== lastSep) &&
      groups.slice(1, -1).every((g) => g.length === 3)
    ) {
      return Number(`${groups.slice(0, -1).join("")}.${lastGroup}`);
    }
  }
  return null;
}

function isCapitalWord(token: Token | undefined): boolean {
  if (!token || token.kind !== "word" || typeof token.surface !== "string") {
    return false;
  }
  const code = token.surface.codePointAt(0);
  if (code === undefined) return false;
  const first = String.fromCodePoint(code);
  return first !== first.toLowerCase() && first === first.toUpperCase();
}

/** End position (exclusive) of a match of `elements[ei..]` at `pos`, or -1. Pushes matched numbers. */
function matchFrom(
  tokens: readonly Token[],
  limit: number,
  elements: readonly EntryElement[],
  ei: number,
  pos: number,
  numbers: number[]
): number {
  if (ei === elements.length) return pos;
  const el = elements[ei];
  if (el.kind === "lit") {
    if (pos >= limit || tokens[pos]?.norm !== el.norm) return -1;
    return matchFrom(tokens, limit, elements, ei + 1, pos + 1, numbers);
  }
  if (el.kind === "num") {
    const token = pos < limit ? tokens[pos] : undefined;
    if (!token || token.kind !== "number") return -1;
    const value = numberValue(token.norm);
    if (value === null) return -1;
    numbers.push(value);
    const end = matchFrom(tokens, limit, elements, ei + 1, pos + 1, numbers);
    if (end < 0) numbers.pop();
    return end;
  }
  if (el.kind === "stem") {
    const token = pos < limit ? tokens[pos] : undefined;
    if (
      !token ||
      token.kind !== "word" ||
      !matchesStem(token.norm, el.stem, MAX_STEM_EXTRA_CHARS)
    ) {
      return -1;
    }
    return matchFrom(tokens, limit, elements, ei + 1, pos + 1, numbers);
  }
  for (let n = 1; n <= MAX_NAME_WORDS; n += 1) {
    const last = pos + n - 1;
    if (last >= limit || !isCapitalWord(tokens[last])) break;
    if (el.suffix !== null && !tokens[last].norm.endsWith(el.suffix)) continue;
    const end = matchFrom(tokens, limit, elements, ei + 1, last + 1, numbers);
    if (end >= 0) return end;
  }
  return -1;
}

/**
 * Find every compiled entry that matches at each start token, in token order
 * and, for one start, in list order. Only the first `MAX_TOKENS_PER_TEXT`
 * tokens are read. `limit` caps the number of hits (default
 * `MAX_TOKENS_PER_TEXT`).
 */
export function findPhrases(
  tokens: readonly Token[],
  m: PhraseMatcher,
  limit?: number
): readonly PhraseHit[] {
  const data = (m as InternalMatcher | null | undefined)?.[MATCHER_DATA];
  const max =
    typeof limit === "number" && Number.isFinite(limit) && limit >= 0
      ? Math.floor(limit)
      : MAX_TOKENS_PER_TEXT;
  const hits: PhraseHit[] = [];
  const list: unknown = tokens;
  if (!data || !Array.isArray(list) || max === 0) return Object.freeze(hits);

  const readable = Math.min(tokens.length, MAX_TOKENS_PER_TEXT);
  for (let start = 0; start < readable && hits.length < max; start += 1) {
    const token = tokens[start];
    if (!token || typeof token.norm !== "string") continue;
    const bucket = data.byFirst.get(token.norm) ?? [];
    const candidates =
      bucket.length === 0 || data.placeholderFirst.length === 0
        ? [...bucket, ...data.placeholderFirst]
        : [...bucket, ...data.placeholderFirst].sort((a, b) => a.order - b.order);
    for (const entry of candidates) {
      if (hits.length >= max) break;
      const numbers: number[] = [];
      const end = matchFrom(tokens, readable, entry.elements, 0, start, numbers);
      if (end < 0) continue;
      hits.push(
        Object.freeze({
          entry: entry.entry,
          language: entry.language,
          start,
          end,
          numbers: Object.freeze(numbers),
        })
      );
    }
  }
  return Object.freeze(hits);
}

/** True when at least one entry of the matcher matches somewhere in the tokens. */
export function hasAny(tokens: readonly Token[], m: PhraseMatcher): boolean {
  return findPhrases(tokens, m, 1).length > 0;
}

// ---------------------------------------------------------------------------
// Quoting
// ---------------------------------------------------------------------------

const FORBIDDEN_NORMALISED: ReadonlySet<string> = new Set(
  FORBIDDEN_WORDS.map((word) => normaliseText(word))
);

const FORBIDDEN_STEMS_NORMALISED: readonly string[] = FORBIDDEN_STEMS.map((stem) =>
  normaliseText(stem)
);

const MASK = "[word omitted]";

function isLetterChar(ch: string): boolean {
  return ch.toLowerCase() !== ch.toUpperCase();
}

/**
 * True when `norm` starts with `stem` and what follows the stem is at most
 * `maxExtra` characters long and holds letters only (no digit, apostrophe,
 * hyphen or symbol). The stem itself must be given in normalised form.
 */
export function matchesStem(norm: string, stem: string, maxExtra: number): boolean {
  if (stem === "" || !norm.startsWith(stem)) return false;
  const extra = Array.from(norm.slice(stem.length));
  if (extra.length > maxExtra) return false;
  return extra.every(isLetterChar);
}

/**
 * True when a normalised word is a whole word of `FORBIDDEN_WORDS`, or starts
 * with a forbidden stem and carries at most `FORBIDDEN_STEM_EXTRA_MAX` letters
 * after it. Only the part before the first apostrophe is judged, so a
 * possessive or a Turkish suffix after an apostrophe does not hide the word.
 * Masking and the finding drop rule both call this one function.
 */
export function isForbiddenToken(norm: string): boolean {
  if (typeof norm !== "string" || norm === "") return false;
  const apostrophe = norm.indexOf("'");
  const head = apostrophe > 0 ? norm.slice(0, apostrophe) : norm;
  if (FORBIDDEN_NORMALISED.has(head)) return true;
  return FORBIDDEN_STEMS_NORMALISED.some((stem) =>
    matchesStem(head, stem, FORBIDDEN_STEM_EXTRA_MAX)
  );
}

function isForbiddenWord(run: string): boolean {
  return isForbiddenToken(normaliseText(run));
}

/** Replace each whole word of `FORBIDDEN_WORDS`, and each word with a forbidden stem, with the mask, keeping all other text as it is. */
function maskForbidden(text: string): string {
  const chars = Array.from(text);
  const classes = chars.map((ch) => classify(ch.codePointAt(0) as number));
  let out = "";
  let i = 0;
  while (i < chars.length) {
    const cls = classes[i];
    if (cls !== "letter") {
      out += chars[i];
      i += 1;
      continue;
    }
    let j = i + 1;
    while (j < chars.length) {
      const next = classes[j];
      if (next === "letter" || next === "mark" || next === "ignorable") {
        j += 1;
      } else if (next === "apostrophe" && j + 1 < chars.length && classes[j + 1] === "letter") {
        j += 1;
      } else {
        break;
      }
    }
    const run = chars.slice(i, j).join("");
    out += isForbiddenWord(run) ? MASK : run;
    i = j;
  }
  return out;
}

/**
 * Quote page text for a finding: the text is cut to `MAX_TEXT_READ`, control
 * characters are removed (tabs and line breaks become spaces), inner double
 * quotes become single quotes, forbidden words are masked, the result is cut
 * to `MAX_QUOTE_CHARS` characters plus "…" inside the quotes, and wrapped in
 * double quotes. A value that is not a string gives an empty quote.
 */
export function quote(text: unknown): string {
  const raw = typeof text === "string" ? text : "";
  const cut = cutCodeUnits(raw, MAX_TEXT_READ);
  let stripped = "";
  for (const ch of cut) {
    const cp = ch.codePointAt(0) as number;
    if (cp === 0x22) {
      stripped += "'";
    } else if ((cp >= 0x09 && cp <= 0x0d) || cp === 0x2028 || cp === 0x2029) {
      stripped += " ";
    } else if (cp < 0x20 || (cp >= 0x7f && cp <= 0x9f)) {
      // control character: dropped
    } else {
      stripped += ch;
    }
  }
  const masked = maskForbidden(stripped);
  const limited = cutCodeUnits(masked, MAX_QUOTE_CHARS);
  const ellipsis = cut.length < raw.length || limited.length < masked.length ? "…" : "";
  return `"${limited}${ellipsis}"`;
}
