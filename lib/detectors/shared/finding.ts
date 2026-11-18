import { FORBIDDEN_WORDS } from "@/lib/detectors/data/forbidden-words";
import {
  MAX_FINDINGS_PER_DETECTOR,
  MAX_STYLE_READ,
} from "@/lib/detectors/shared/constants";
import type { IndexedElement } from "@/lib/detectors/shared/elements";
import { SAFE_PATTERNS } from "@/lib/detectors/shared/patterns";
import { normaliseText } from "@/lib/detectors/shared/text";
import { FindingSchema } from "@/lib/types";
import type { Confidence, Finding } from "@/lib/types";

/**
 * Finding assembly shared by the six static detectors. A detector builds
 * drafts (fixed title, template text, evidence elements, measured numbers);
 * `finaliseFindings` turns them into schema-valid findings and applies the
 * contract of requirements 2.8, 2.11 to 2.13, 3.1 to 3.2, 3.7, 3.9 to 3.11,
 * 3.13, 3.15 to 3.17.
 */

/** Pattern ids of the six static detectors. */
export type StaticPatternId =
  | "fake-urgency"
  | "fake-scarcity"
  | "fake-activity"
  | "confirmshaming"
  | "preselection"
  | "visual-interference";

export type FindingDraft = {
  patternId: StaticPatternId;
  confidence: Confidence;
  /** One of `TITLES[patternId]`. */
  title: string;
  /** Template output; page text is quoted with `quote()`. */
  description: string;
  /** Template output with `quote()` parts. */
  evidenceText: string;
  measuredValues?: Record<string, number>;
  /** Evidence elements, primary first. */
  elements: readonly IndexedElement[];
  /** Tie-break for equal element positions: the row order of the detector. */
  ruleOrder: number;
};

export type DetectedAt = { iso: string; ms: number | null };

export type FindingContext = {
  detectedAt: DetectedAt;
  /** True when the capture or the element budget cut the page short. */
  pageTruncated: boolean;
};

// ---------------------------------------------------------------------------
// Fixed texts
// ---------------------------------------------------------------------------

/** The fixed titles of each rule (design section 7). Every title starts with "Possible". */
export const TITLES: Readonly<Record<StaticPatternId, readonly string[]>> =
  Object.freeze({
    "fake-urgency": Object.freeze([
      "Possible fake urgency: countdown restarted on reload",
      "Possible fake urgency: countdown did not count down across a reload",
      "Possible fake urgency: countdown timer",
      "Possible fake urgency: rolling deadline",
      "Possible fake urgency: deadline already passed",
    ]),
    "fake-scarcity": Object.freeze([
      "Possible fake scarcity: stock number changed on reload",
      "Possible fake scarcity: low-stock message",
      "Possible fake scarcity: scarcity wording",
    ]),
    "fake-activity": Object.freeze([
      "Possible fake activity: number changed on reload",
      "Possible fake activity: purchase message changed on reload",
      "Possible fake activity: activity message",
    ]),
    confirmshaming: Object.freeze(["Possible confirmshaming"]),
    preselection: Object.freeze([
      "Possible preselection: paid option ticked in advance",
      "Possible preselection: consent ticked in advance",
      "Possible preselection: pricier option selected in advance",
    ]),
    "visual-interference": Object.freeze([
      "Possible visual interference: unequal choice buttons",
      "Possible visual interference: hard-to-see close control",
    ]),
  });

/** One explanation per pattern (design section 7). */
export const EXPLANATIONS: Readonly<Record<StaticPatternId, string>> =
  Object.freeze({
    "fake-urgency":
      "Time limits that reset or roll over can push people to decide faster than they planned.",
    "fake-scarcity":
      "Claims of low stock can push people to buy before they are ready; the detector cannot see real inventory.",
    "fake-activity":
      "Messages about other shoppers can create pressure; the detector cannot see real visitor or order data.",
    confirmshaming:
      "Decline options worded to make people feel bad can steer them toward accepting.",
    preselection:
      "Options that start selected are easy to miss and may add cost or sharing that people did not choose.",
    "visual-interference":
      "When one choice is much easier to see than the other, people may not notice the other choice.",
  });

const OUTSIDE_SENTENCE = "The element lies outside the screenshot.";
const TRUNCATION_SENTENCE =
  "The capture stopped at its element limit, so later parts of the page were not checked.";

const EPOCH_ISO = "1970-01-01T00:00:00.000Z";
const UNKNOWN_TIME: DetectedAt = Object.freeze({ iso: EPOCH_ISO, ms: null });

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------

/**
 * Read `capturedAt` of a snapshot. A value in the strict form
 * `YYYY-MM-DDTHH:MM:SS(.fraction)Z` that is also a real calendar date gives
 * its ISO string and its milliseconds. Anything else (missing, not a string,
 * an offset time, a date without a time, a day that does not exist, hour 24)
 * gives the epoch and `ms: null`, which makes callers treat the time as unknown.
 */
export function detectedAtFrom(snapshot: unknown): DetectedAt {
  let value: unknown;
  try {
    value =
      typeof snapshot === "object" && snapshot !== null
        ? (snapshot as Record<string, unknown>).capturedAt
        : undefined;
  } catch {
    return UNKNOWN_TIME;
  }
  if (typeof value !== "string" || value.length > MAX_STYLE_READ) {
    return UNKNOWN_TIME;
  }
  if (!SAFE_PATTERNS.isoUtc.test(value)) return UNKNOWN_TIME;

  const date = new Date(value);
  const ms = date.getTime();
  if (!Number.isFinite(ms)) return UNKNOWN_TIME;
  const iso = date.toISOString();
  // The engine may roll a day that does not exist (February 30) into the next
  // month; the date and time parts must come back unchanged.
  if (iso.slice(0, 19) !== value.slice(0, 19)) return UNKNOWN_TIME;
  return { iso, ms };
}

// ---------------------------------------------------------------------------
// Forbidden words
// ---------------------------------------------------------------------------

const FORBIDDEN_NORMALISED: ReadonlySet<string> = new Set(
  FORBIDDEN_WORDS.map((word) => normaliseText(word))
);

function isWordChar(ch: string): boolean {
  return ch.toLowerCase() !== ch.toUpperCase();
}

function runIsForbidden(run: string): boolean {
  if (run === "") return false;
  if (FORBIDDEN_NORMALISED.has(run)) return true;
  // A possessive or a Turkish suffix after an apostrophe.
  const apostrophe = run.indexOf("'");
  return apostrophe > 0 && FORBIDDEN_NORMALISED.has(run.slice(0, apostrophe));
}

/**
 * True when the text holds a word of `FORBIDDEN_WORDS` as a whole word, after
 * the same normalisation the word lists use. The whole text is scanned; there
 * is no token limit.
 */
export function containsForbidden(text: string): boolean {
  if (typeof text !== "string" || text.length === 0) return false;
  const chars = Array.from(normaliseText(text, text.length));
  let run = "";
  for (let i = 0; i < chars.length; i += 1) {
    const ch = chars[i];
    const inner =
      ch === "'" && run !== "" && i + 1 < chars.length && isWordChar(chars[i + 1]);
    if (isWordChar(ch) || inner) {
      run += ch;
    } else {
      if (runIsForbidden(run)) return true;
      run = "";
    }
  }
  return runIsForbidden(run);
}

// ---------------------------------------------------------------------------
// Confidence
// ---------------------------------------------------------------------------

/** One level lower: high to medium, medium to low, low stays low. */
export function lowerConfidence(c: Confidence): Confidence {
  if (c === "high") return "medium";
  return "low";
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

type Prepared = {
  readonly position: number;
  readonly ruleOrder: number;
  readonly firstId: string;
  readonly finding: Finding;
};

function copyBox(el: IndexedElement): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  return {
    x: el.box.x,
    y: el.box.y,
    width: el.box.width,
    height: el.box.height,
  };
}

function finiteValues(
  values: Record<string, number> | undefined
): Record<string, number> {
  const out: Record<string, number> = {};
  if (typeof values !== "object" || values === null) return out;
  for (const key of Object.keys(values)) {
    const value = values[key];
    if (typeof value === "number" && Number.isFinite(value)) out[key] = value;
  }
  return out;
}

function isFixedTitle(patternId: string, title: string): boolean {
  if (!Object.hasOwn(TITLES, patternId)) return false;
  return TITLES[patternId as StaticPatternId].includes(title);
}

function prepare(
  source: FindingDraft,
  detectedAt: DetectedAt,
  pageTruncated: boolean
): Prepared | null {
  if (typeof source !== "object" || source === null) return null;
  const { patternId, confidence, title, elements } = source;
  if (typeof title !== "string" || !isFixedTitle(patternId, title)) return null;
  if (typeof source.description !== "string") return null;
  if (typeof source.evidenceText !== "string") return null;
  if (!Array.isArray(elements)) return null;

  const explanation = EXPLANATIONS[patternId];
  if (
    containsForbidden(title) ||
    containsForbidden(source.description) ||
    containsForbidden(source.evidenceText) ||
    containsForbidden(explanation)
  ) {
    return null;
  }

  const sentences = [source.description];
  if (elements.some((el) => el.outsideImage)) sentences.push(OUTSIDE_SENTENCE);
  if (pageTruncated) sentences.push(TRUNCATION_SENTENCE);

  const measured = finiteValues(source.measuredValues);
  if (detectedAt.ms === null) measured.captureTimeUnknown = 1;
  const evidence: { text: string; measuredValues?: Record<string, number> } = {
    text: source.evidenceText,
  };
  if (Object.keys(measured).length > 0) evidence.measuredValues = measured;

  const first = elements[0];
  const position =
    first !== undefined && Number.isFinite(first.order)
      ? first.order
      : Number.POSITIVE_INFINITY;

  return {
    position,
    ruleOrder: Number.isFinite(source.ruleOrder) ? source.ruleOrder : 0,
    firstId: first === undefined ? "" : first.id,
    finding: {
      patternId,
      confidence,
      title,
      description: sentences.join(" "),
      evidence,
      elementIds: elements.map((el) => el.id),
      boundingBoxes: elements.map(copyBox),
      explanation,
      detectorName: patternId,
      detectedAt: detectedAt.iso,
    },
  };
}

function compare(a: Prepared, b: Prepared): number {
  if (a.position !== b.position) return a.position < b.position ? -1 : 1;
  if (a.ruleOrder !== b.ruleOrder) return a.ruleOrder - b.ruleOrder;
  if (a.firstId === b.firstId) return 0;
  return a.firstId < b.firstId ? -1 : 1;
}

/**
 * Turn drafts into findings. Drafts with a title that is not a fixed title of
 * their pattern, or with a forbidden word in any string, are dropped. The rest
 * are sorted by the document position of their first element, then by
 * `ruleOrder`, then by that element's id; at most `MAX_FINDINGS_PER_DETECTOR`
 * are kept and the last one says how many were left out. Every returned
 * finding passes `FindingSchema`.
 */
export function finaliseFindings(
  drafts: readonly FindingDraft[],
  ctx: FindingContext
): Finding[] {
  if (!Array.isArray(drafts)) return [];
  const detectedAt = ctx?.detectedAt ?? UNKNOWN_TIME;
  const pageTruncated = ctx?.pageTruncated === true;

  const prepared: Prepared[] = [];
  for (const source of drafts) {
    try {
      const item = prepare(source, detectedAt, pageTruncated);
      if (item) prepared.push(item);
    } catch {
      // A broken draft is skipped; the others still count.
    }
  }
  prepared.sort(compare);

  const kept = prepared.slice(0, MAX_FINDINGS_PER_DETECTOR);
  const omitted = prepared.length - kept.length;

  const out: Finding[] = [];
  kept.forEach((item, i) => {
    let finding = item.finding;
    if (omitted > 0 && i === kept.length - 1) {
      finding = {
        ...finding,
        description: `${finding.description} ${omitted} more similar findings were not listed.`,
        evidence: {
          ...finding.evidence,
          measuredValues: {
            ...(finding.evidence.measuredValues ?? {}),
            omittedFindings: omitted,
          },
        },
      };
    }
    const parsed = FindingSchema.safeParse(finding);
    if (parsed.success) out.push(parsed.data);
  });
  return out;
}
