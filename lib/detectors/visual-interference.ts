import { CONSENT_CONTEXT_WORDS } from "@/lib/detectors/data/choice-words";
import {
  classifyControl,
  findChoiceGroups,
  isChoiceControl,
} from "@/lib/detectors/shared/choice-groups";
import type { ChoiceGroup } from "@/lib/detectors/shared/choice-groups";
import { parseColour, textContrast } from "@/lib/detectors/shared/colour";
import {
  ACCEPT_CONTRAST_MIN,
  AREA_RATIO_MIN,
  CLOSE_CONTRAST_MIN,
  CLOSE_MIN_PX,
  DECLINE_CONTRAST_MAX,
  DECLINE_OPACITY_MAX,
  EQUAL_AREA_RATIO_MAX,
  FONT_RATIO_MIN,
  MAX_CHOICE_GROUPS,
  SMALL_FONT_PX,
} from "@/lib/detectors/shared/constants";
import { buildIndex } from "@/lib/detectors/shared/elements";
import type { ElementIndex, IndexedElement } from "@/lib/detectors/shared/elements";
import {
  detectedAtFrom,
  finaliseFindings,
  TITLES,
} from "@/lib/detectors/shared/finding";
import type { FindingDraft } from "@/lib/detectors/shared/finding";
import { compilePhrases, hasAny, quote, tokenise } from "@/lib/detectors/shared/text";
import type { Confidence, Finding, PageSnapshot } from "@/lib/types";

/**
 * visual-interference (requirement 13, design section 9.6).
 *
 * Reads the first sample only: tag, role, `type`, `aria-label`, `aria-modal`,
 * text, ids and paths, `color`, `backgroundColor`, `fontSize`, `opacity`,
 * `position`, visibility fields, boxes and `outsideImage`. Ignores the reload
 * sample, checked state, selected state, `name` and `secondSample`.
 *
 * Pairs: an accept-like control and a reject-like or lesser control in one
 * choice group, in a consent, dialog or fixed context. Each pair is measured
 * (size, colour, structure); two or more passing measures give a finding, three
 * or more in two classes give high confidence. Pairs of equal style never flag.
 * A contrast measured on an assumed background never counts toward high.
 *
 * Close controls: a glyph or labelled close control inside a dialog, measured
 * for size, contrast and the size of the accept control next to it.
 *
 * Two choices of this file go beyond the wording of the spec and are stated
 * here: a plain decline ("No thanks") is reject-like, and three or more passing
 * measures that do not reach high (one class only, or an assumed background)
 * give medium, so that a pair never falls between rows V1 and V2.
 */

const PATTERN = "visual-interference" as const;
const TITLE_PAIR = TITLES[PATTERN][0];
const TITLE_CLOSE = TITLES[PATTERN][1];

const DESCRIPTION_PAIR =
  "Two choices in the same area differ a lot in size, colour or form.";
const DESCRIPTION_CLOSE =
  "A dialog's close control is very small or faint next to a much larger action.";

/** Rows of the table in requirement 13.12, in order. */
const ROW_V1 = 1;
const ROW_V2 = 2;
const ROW_V3 = 3;
const ROW_V4 = 4;

/** Consent words are searched in the group's container and up to this many levels above it. */
const CONSENT_LEVELS_UP = 2;
const MAX_CONSENT_ELEMENTS_READ = 200;

const CONSENT = compilePhrases(CONSENT_CONTEXT_WORDS);

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** The words of a control: its text, or its `aria-label` when it has no text. */
function labelOf(control: IndexedElement): string {
  return control.text !== "" ? control.text : (control.attr("aria-label") ?? "");
}

function isDialog(el: IndexedElement): boolean {
  if (el.role === "dialog" || el.role === "alertdialog") return true;
  return (el.attr("aria-modal") ?? "").trim().toLowerCase() === "true";
}

function isFixed(el: IndexedElement): boolean {
  return el.position === "fixed" || el.position === "sticky";
}

type Measure = {
  readonly cls: "size" | "colour" | "structure";
  /** True when the measure used a background that was assumed to be white. */
  readonly assumed: boolean;
  readonly values: Readonly<Record<string, number>>;
};

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

/**
 * True when a consent word (cookie, privacy, tracking, ...) is in the text or
 * `aria-label` of the elements around the group, other than the group's own
 * controls: the container's subtree, then the subtree of up to two levels above
 * it, never wider than the level just below the page body.
 */
function hasConsentWords(index: ElementIndex, group: ChoiceGroup): boolean {
  const own = new Set<IndexedElement>(group.controls);
  for (let up = 0; up <= CONSENT_LEVELS_UP; up += 1) {
    const length = group.path.length - up;
    if (length < 0 || (up > 0 && length < 2)) break;
    let read = 0;
    for (const el of index.subtree(group.path.slice(0, length))) {
      if (read >= MAX_CONSENT_ELEMENTS_READ) break;
      if (el.hidden || own.has(el)) continue;
      read += 1;
      if (hasAny(el.tokens, CONSENT)) return true;
      const label = el.attr("aria-label");
      if (label !== undefined && hasAny(tokenise(label), CONSENT)) return true;
    }
  }
  return false;
}

/** Requirement 13.2: a dialog or fixed ancestor, or a consent word nearby. */
function inContext(
  index: ElementIndex,
  controls: readonly IndexedElement[],
  consentWords: boolean
): boolean {
  if (consentWords) return true;
  for (const control of controls) {
    for (const ancestor of index.ancestors(control)) {
      if (isDialog(ancestor) || isFixed(ancestor)) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Pairs
// ---------------------------------------------------------------------------

type PairResult = {
  readonly decline: IndexedElement;
  readonly accept: IndexedElement;
  readonly confidence: Confidence;
  readonly row: number;
  readonly measures: readonly Measure[];
  readonly areaRatio: number | null;
  readonly declineContrast: number | null;
  readonly acceptContrast: number | null;
};

function stripSpaces(text: string): string {
  return text.split(" ").join("");
}

function sameColour(a: string, b: string): boolean {
  const pa = parseColour(a);
  const pb = parseColour(b);
  if (pa !== null && pb !== null) {
    return (
      Math.abs(pa.r - pb.r) < 0.5 &&
      Math.abs(pa.g - pb.g) < 0.5 &&
      Math.abs(pa.b - pb.b) < 0.5 &&
      Math.abs(pa.a - pb.a) < 0.005
    );
  }
  return stripSpaces(a.trim().toLowerCase()) === stripSpaces(b.trim().toLowerCase());
}

/** Requirement 13.5: equal colours, background, font size and opacity, and similar areas. */
function equalStyle(accept: IndexedElement, decline: IndexedElement): boolean {
  if (
    !sameColour(accept.color, decline.color) ||
    !sameColour(accept.backgroundColor, decline.backgroundColor) ||
    accept.fontSizePx !== decline.fontSizePx ||
    accept.opacity !== decline.opacity
  ) {
    return false;
  }
  if (accept.area <= 0 || decline.area <= 0) return false;
  const ratio = Math.max(accept.area, decline.area) / Math.min(accept.area, decline.area);
  return ratio <= EQUAL_AREA_RATIO_MAX;
}

function isPlainButton(el: IndexedElement): boolean {
  return el.tag === "button" || el.role === "button" || el.tag === "input";
}

function measurePair(
  index: ElementIndex,
  accept: IndexedElement,
  decline: IndexedElement,
  noRejectInConsent: boolean
): {
  measures: Measure[];
  areaRatio: number | null;
  declineContrast: number | null;
  acceptContrast: number | null;
} {
  const measures: Measure[] = [];

  // Size
  let areaRatio: number | null = null;
  if (accept.area > 0 && decline.area > 0) {
    areaRatio = accept.area / decline.area;
    if (areaRatio > AREA_RATIO_MIN) {
      measures.push({ cls: "size", assumed: false, values: { areaRatio: round2(areaRatio) } });
    }
  }
  if (
    accept.fontSizePx !== null &&
    decline.fontSizePx !== null &&
    accept.fontSizePx > 0 &&
    decline.fontSizePx > 0
  ) {
    const fontRatio = accept.fontSizePx / decline.fontSizePx;
    if (fontRatio > FONT_RATIO_MIN) {
      measures.push({ cls: "size", assumed: false, values: { fontRatio: round2(fontRatio) } });
    }
  }
  if (
    decline.fontSizePx !== null &&
    decline.fontSizePx > 0 &&
    decline.fontSizePx < SMALL_FONT_PX
  ) {
    measures.push({
      cls: "size",
      assumed: false,
      values: { declineFontPx: round2(decline.fontSizePx) },
    });
  }

  // Colour
  const declineText = textContrast(index, decline);
  const acceptText = textContrast(index, accept);
  if (
    declineText !== null &&
    acceptText !== null &&
    declineText.ratio < DECLINE_CONTRAST_MAX &&
    acceptText.ratio >= ACCEPT_CONTRAST_MIN
  ) {
    measures.push({
      cls: "colour",
      assumed: declineText.assumed || acceptText.assumed,
      values: {
        declineContrast: round1(declineText.ratio),
        acceptContrast: round1(acceptText.ratio),
      },
    });
  }
  if (decline.opacity < DECLINE_OPACITY_MAX) {
    measures.push({
      cls: "colour",
      assumed: false,
      values: { declineOpacity: round2(decline.opacity) },
    });
  }
  const acceptFill = parseColour(accept.backgroundColor);
  const declineFill = parseColour(decline.backgroundColor);
  if (acceptFill !== null && declineFill !== null && acceptFill.a >= 0.5 && declineFill.a < 0.1) {
    measures.push({
      cls: "colour",
      assumed: false,
      values: { acceptFilled: 1, declineFilled: 0 },
    });
  }

  // Structure
  if (accept.tag === "button" && !isPlainButton(decline)) {
    measures.push({ cls: "structure", assumed: false, values: { declineIsLink: 1 } });
  }
  if (noRejectInConsent) {
    measures.push({ cls: "structure", assumed: false, values: { noRejectControl: 1 } });
  }

  return {
    measures,
    areaRatio,
    declineContrast: declineText === null ? null : declineText.ratio,
    acceptContrast: acceptText === null ? null : acceptText.ratio,
  };
}

/** Rows V1 and V2 of requirement 13.12 (see the note at the top about three measures of one class). */
function rateMeasures(measures: readonly Measure[]): { confidence: Confidence; row: number } | null {
  const solid = measures.filter((m) => !m.assumed);
  const classes = new Set(solid.map((m) => m.cls));
  if (solid.length >= 3 && classes.size >= 2 && (classes.has("size") || classes.has("colour"))) {
    return { confidence: "high", row: ROW_V1 };
  }
  if (measures.length >= 2) return { confidence: "medium", row: ROW_V2 };
  return null;
}

const CONFIDENCE_RANK: Readonly<Record<Confidence, number>> = Object.freeze({
  high: 3,
  medium: 2,
  low: 1,
});

function pairsOfGroup(index: ElementIndex, group: ChoiceGroup): PairResult | null {
  const kinds = group.controls.map((control) => ({ control, kind: classifyControl(control) }));
  const accept = kinds.find((k) => k.kind === "accept")?.control;
  if (accept === undefined) return null;
  const declines = kinds.filter(
    (k) => k.kind === "reject" || k.kind === "lesser" || k.kind === "plain-decline"
  );
  if (declines.length === 0) return null;

  const consentWords = hasConsentWords(index, group);
  const controls = [accept, ...declines.map((d) => d.control)];
  if (!inContext(index, controls, consentWords)) return null;

  const hasReject = declines.some((d) => d.kind === "reject" || d.kind === "plain-decline");
  const noRejectInConsent = consentWords && !hasReject;

  let best: PairResult | null = null;
  for (const { control: decline } of declines) {
    if (equalStyle(accept, decline)) continue;
    const measured = measurePair(index, accept, decline, noRejectInConsent);
    const rated = rateMeasures(measured.measures);
    if (rated === null) continue;
    const result: PairResult = {
      decline,
      accept,
      confidence: rated.confidence,
      row: rated.row,
      measures: measured.measures,
      areaRatio: measured.areaRatio,
      declineContrast: measured.declineContrast,
      acceptContrast: measured.acceptContrast,
    };
    if (
      best === null ||
      CONFIDENCE_RANK[result.confidence] > CONFIDENCE_RANK[best.confidence] ||
      (result.confidence === best.confidence && result.measures.length > best.measures.length)
    ) {
      best = result;
    }
  }
  return best;
}

function describeControl(el: IndexedElement, contrast: number | null): string {
  const parts: string[] = [];
  if (el.fontSizePx !== null) parts.push(`${round1(el.fontSizePx)} px`);
  const fill = parseColour(el.backgroundColor);
  if (fill !== null && fill.a >= 0.5) parts.push("filled");
  else if (el.tag === "a") parts.push("link");
  else parts.push("not filled");
  if (el.opacity < 1) parts.push(`opacity ${round2(el.opacity)}`);
  if (contrast !== null) parts.push(`contrast ${round1(contrast)}`);
  return ` (${parts.join(", ")})`;
}

function pairDraft(result: PairResult): FindingDraft {
  const values: Record<string, number> = {};
  let assumed = false;
  for (const measure of result.measures) {
    Object.assign(values, measure.values);
    if (measure.assumed) assumed = true;
  }
  if (assumed) values.backgroundAssumed = 1;

  const { accept, decline } = result;
  const area = result.areaRatio === null ? "" : `; area ratio ${round2(result.areaRatio)}`;
  const text =
    `${quote(labelOf(accept))}${describeControl(accept, result.acceptContrast)} next to ` +
    `${quote(labelOf(decline))}${describeControl(decline, result.declineContrast)}${area}.`;

  return {
    patternId: PATTERN,
    confidence: result.confidence,
    title: TITLE_PAIR,
    description: DESCRIPTION_PAIR,
    evidenceText: text,
    measuredValues: values,
    elements: [decline, accept],
    ruleOrder: result.row,
  };
}

// ---------------------------------------------------------------------------
// Close controls
// ---------------------------------------------------------------------------

function dialogOf(index: ElementIndex, el: IndexedElement): IndexedElement | null {
  for (const ancestor of index.ancestors(el)) {
    if (isDialog(ancestor)) return ancestor;
  }
  return null;
}

/** The largest accept-like control inside the dialog. */
function dominantAccept(index: ElementIndex, dialog: IndexedElement): IndexedElement | null {
  if (dialog.path === null) return null;
  let best: IndexedElement | null = null;
  for (const el of index.subtree(dialog.path)) {
    if (!isChoiceControl(el) || el.area <= 0) continue;
    if (classifyControl(el) !== "accept") continue;
    if (best === null || el.area > best.area) best = el;
  }
  return best;
}

function closeDraft(index: ElementIndex, close: IndexedElement): FindingDraft | null {
  const dialog = dialogOf(index, close);
  if (dialog === null) return null;

  const width = close.box.width;
  const height = close.box.height;
  const tiny = width > 0 && height > 0 && width < CLOSE_MIN_PX && height < CLOSE_MIN_PX;

  const contrast = textContrast(index, close);
  const faint = contrast !== null && contrast.ratio < CLOSE_CONTRAST_MIN;

  const accept = dominantAccept(index, dialog);
  const dominantRatio =
    accept !== null && close.area > 0 ? accept.area / close.area : null;
  const dominant = dominantRatio !== null && dominantRatio >= AREA_RATIO_MIN;

  const passing = (tiny ? 1 : 0) + (faint ? 1 : 0) + (dominant ? 1 : 0);
  const faintAssumed = faint && contrast !== null && contrast.assumed;
  let confidence: Confidence;
  let row: number;
  if (tiny && faint && dominant && !faintAssumed) {
    confidence = "high";
    row = ROW_V3;
  } else if (passing >= 2) {
    confidence = "medium";
    row = ROW_V4;
  } else {
    return null;
  }

  const values: Record<string, number> = {};
  if (width > 0 && height > 0) {
    values.closeWidthPx = round2(width);
    values.closeHeightPx = round2(height);
  }
  if (contrast !== null) {
    values.closeContrast = round1(contrast.ratio);
    if (contrast.assumed) values.backgroundAssumed = 1;
  }
  if (dominantRatio !== null) values.dominantAreaRatio = round2(dominantRatio);

  let text = `Close control ${quote(labelOf(close))} measures ${round2(width)} × ${round2(height)} px`;
  if (contrast !== null) text += ` with contrast ${round1(contrast.ratio)}`;
  if (accept !== null && dominantRatio !== null) {
    text += `; ${quote(labelOf(accept))} is ${round2(dominantRatio)} times larger`;
  }
  text += ".";

  return {
    patternId: PATTERN,
    confidence,
    title: TITLE_CLOSE,
    description: DESCRIPTION_CLOSE,
    evidenceText: text,
    measuredValues: values,
    elements: accept === null ? [close] : [close, accept],
    ruleOrder: row,
  };
}

// ---------------------------------------------------------------------------
// Detector
// ---------------------------------------------------------------------------

/**
 * Detect possible visual interference in one snapshot. A value that is not a
 * usable snapshot gives an empty array. An unexpected exception propagates;
 * the registry reports it (requirement 6.1).
 */
export function detectVisualInterference(snapshot: PageSnapshot): Finding[] {
  const index = buildIndex(snapshot, false);
  const detectedAt = detectedAtFrom(snapshot);
  const drafts: FindingDraft[] = [];

  for (const group of findChoiceGroups(index)) {
    const result = pairsOfGroup(index, group);
    if (result !== null) drafts.push(pairDraft(result));
  }

  let closesRead = 0;
  for (const el of index.elements) {
    if (closesRead >= MAX_CHOICE_GROUPS) break;
    if (!isChoiceControl(el) || classifyControl(el) !== "close") continue;
    closesRead += 1;
    const draft = closeDraft(index, el);
    if (draft !== null) drafts.push(draft);
  }

  return finaliseFindings(drafts, {
    detectedAt,
    pageTruncated: index.captureTruncated || index.budgetHit,
  });
}
