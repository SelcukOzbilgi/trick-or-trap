import {
  CONSENT_WORDS,
  FREE_WORDS,
  NEUTRAL_WORDS,
  NONE_WORDS,
  PAID_ADDON_WORDS,
  REQUIRED_GROUP_WORDS,
} from "@/lib/detectors/data/preselection-words";
import { GROUP_MAX_LEVELS, MAX_CHOICE_GROUPS } from "@/lib/detectors/shared/constants";
import { buildIndex } from "@/lib/detectors/shared/elements";
import type { ElementIndex, IndexedElement } from "@/lib/detectors/shared/elements";
import {
  detectedAtFrom,
  finaliseFindings,
  lowerConfidence,
  TITLES,
} from "@/lib/detectors/shared/finding";
import type { FindingDraft } from "@/lib/detectors/shared/finding";
import { findLabel } from "@/lib/detectors/shared/labels";
import type { LabelMatch } from "@/lib/detectors/shared/labels";
import { parsePrices } from "@/lib/detectors/shared/price";
import type { Price } from "@/lib/detectors/shared/price";
import { compilePhrases, hasAny, quote } from "@/lib/detectors/shared/text";
import type { Token } from "@/lib/detectors/shared/text";
import type { Confidence, Finding, PageSnapshot } from "@/lib/types";

/**
 * preselection (requirement 12, design section 9.5).
 *
 * Reads the first sample only: tag, `type`, `name`, `disabled`, `aria-checked`,
 * `aria-label`, role, checked state, text, ids and paths, `display`,
 * `visibility`, boxes and `outsideImage`. Ignores the reload sample, colours,
 * font sizes, position, selected state and `secondSample`.
 *
 * Checkboxes and switches that start ticked: P1 (a positive price, medium),
 * P2 (a consent label, medium), P3 (a paid add-on word without a price, low).
 * Radio groups: P4 (a pricier option is selected, medium) and P5 (the same in
 * a group the shopper has to choose from anyway, low). A label found only from
 * nearby text lowers the confidence by one level. A checked radio is judged by
 * the radio-group rule only.
 */

const PATTERN = "preselection" as const;
const TITLE_PAID = TITLES[PATTERN][0];
const TITLE_CONSENT = TITLES[PATTERN][1];
const TITLE_GROUP = TITLES[PATTERN][2];

const DESCRIPTION_PRICED = "An option that adds a price starts ticked.";
const DESCRIPTION_CONSENT = "An option about messages or data sharing starts ticked.";
const DESCRIPTION_ADDON = "An add-on option without a shown price starts ticked.";
const DESCRIPTION_GROUP =
  "A pricier option is selected in a group that has a cheaper option.";
const NEARBY_SENTENCE = "The label was taken from nearby text.";

/** Rows of the table in requirement 12.14, in order. */
const ROW_PRICED = 1;
const ROW_CONSENT = 2;
const ROW_ADDON = 3;
const ROW_GROUP = 4;
const ROW_GROUP_REQUIRED = 5;

/** Radios and options read per page and per group, so that work stays bounded. */
const MAX_RADIOS_CONSIDERED = 200;
const MAX_OPTIONS_PER_GROUP = 20;
const MAX_GROUP_TEXT_ELEMENTS = 200;

const PAID_ADDON = compilePhrases(PAID_ADDON_WORDS);
const CONSENT = compilePhrases(CONSENT_WORDS);
const NEUTRAL = compilePhrases(NEUTRAL_WORDS);
const NONE = compilePhrases(NONE_WORDS);
const REQUIRED_GROUP = compilePhrases(REQUIRED_GROUP_WORDS);
const FREE = compilePhrases(FREE_WORDS);

// ---------------------------------------------------------------------------
// Reading controls
// ---------------------------------------------------------------------------

function lowerAttr(el: IndexedElement, name: "type" | "aria-checked"): string {
  return (el.attr(name) ?? "").trim().toLowerCase();
}

function isDisabled(el: IndexedElement): boolean {
  const value = el.attr("disabled");
  return value !== undefined && value.trim().toLowerCase() !== "false";
}

/**
 * Hidden for good: `display` none or `visibility` hidden or collapse on the
 * control or on an ancestor in the sample. Opacity and a zero box are not
 * counted: a custom checkbox often hides its input that way and shows the label.
 */
function hardHidden(index: ElementIndex, el: IndexedElement): boolean {
  const bad = (e: IndexedElement): boolean =>
    e.display === "none" || e.visibility === "hidden" || e.visibility === "collapse";
  return bad(el) || index.ancestors(el).some(bad);
}

/** A checkbox input, or an element with role switch or checkbox, that starts ticked. */
function isTickedToggle(el: IndexedElement): boolean {
  if (el.tag === "input" && lowerAttr(el, "type") === "checkbox" && el.checked) return true;
  return (
    (el.role === "switch" || el.role === "checkbox") && lowerAttr(el, "aria-checked") === "true"
  );
}

function isRadioInput(el: IndexedElement): boolean {
  return el.tag === "input" && lowerAttr(el, "type") === "radio";
}

/** The label is usable when it is a visible element (or the control itself, or an `aria-label`). */
function labelVisible(label: LabelMatch, control: IndexedElement): boolean {
  return label.element === null || label.element === control || !label.element.hidden;
}

// ---------------------------------------------------------------------------
// Reading labels
// ---------------------------------------------------------------------------

type LabelClass = "consent" | "neutral" | "paid" | "unclassed";

/** consent, else neutral, else paid add-on (requirement 12.7). */
function classOf(tokens: readonly Token[]): LabelClass {
  if (hasAny(tokens, CONSENT)) return "consent";
  if (hasAny(tokens, NEUTRAL)) return "neutral";
  if (hasAny(tokens, PAID_ADDON)) return "paid";
  return "unclassed";
}

/** The price with a plus when there is one, else the last price. */
function chosenPrice(prices: readonly Price[]): Price | null {
  if (prices.length === 0) return null;
  return prices.find((p) => p.plus) ?? prices[prices.length - 1];
}

/** A price as written on the page: its tokens joined, with a space only where a word or a trailing symbol needs one. */
function writtenPrice(tokens: readonly Token[], price: Price): string {
  let out = "";
  for (let i = price.start; i < price.end; i += 1) {
    const token = tokens[i];
    if (!token) break;
    const prev = i > price.start ? tokens[i - 1] : undefined;
    const space =
      prev !== undefined &&
      (prev.kind === "word" ||
        token.kind === "word" ||
        (prev.kind === "number" && token.kind === "symbol"));
    out += `${space ? " " : ""}${token.surface}`;
  }
  return out;
}

const SYMBOL_CURRENCIES: ReadonlySet<string> = new Set(["$", "€", "£", "₺", "¥"]);

/** An amount in the currency of another price, for options that show no price of their own. */
function formatMinor(minor: number, currency: string): string {
  const amount = (minor / 100).toFixed(2);
  if (SYMBOL_CURRENCIES.has(currency)) return `${currency}${amount}`;
  return currency === "" ? amount : `${amount} ${currency.toUpperCase()}`;
}

// ---------------------------------------------------------------------------
// Checkboxes and switches: P1 to P3
// ---------------------------------------------------------------------------

function labelElements(control: IndexedElement, label: LabelMatch): readonly IndexedElement[] {
  return label.element !== null && label.element !== control
    ? [control, label.element]
    : [control];
}

function toggleDraft(
  index: ElementIndex,
  control: IndexedElement
): FindingDraft | null {
  const label = findLabel(index, control);
  if (label === null || !labelVisible(label, control)) return null;

  const prices = parsePrices(label.tokens);
  const price = chosenPrice(prices);
  const free = price === null && hasAny(label.tokens, FREE);
  const cls = classOf(label.tokens);
  const nearby = label.how === "nearby";
  const elements = labelElements(control, label);
  const note = nearby ? ` ${NEARBY_SENTENCE}` : "";
  const ticked = `Option ${quote(label.text)} is ticked`;

  const make = (
    confidence: Confidence,
    title: string,
    description: string,
    evidenceText: string,
    ruleOrder: number,
    measuredValues?: Record<string, number>
  ): FindingDraft => ({
    patternId: PATTERN,
    confidence: nearby ? lowerConfidence(confidence) : confidence,
    title,
    description: `${description}${note}`,
    evidenceText,
    ...(measuredValues ? { measuredValues } : {}),
    elements,
    ruleOrder,
  });

  if (price !== null && price.minor > 0) {
    return make(
      "medium",
      TITLE_PAID,
      DESCRIPTION_PRICED,
      `${ticked}; price ${writtenPrice(label.tokens, price)}.`,
      ROW_PRICED,
      { priceMinor: price.minor }
    );
  }
  if (cls === "consent") {
    return make("medium", TITLE_CONSENT, DESCRIPTION_CONSENT, `${ticked}.`, ROW_CONSENT);
  }
  // A price of 0 (a shown 0.00 or the word "free") is no extra cost.
  if (cls === "paid" && price === null && !free) {
    return make("low", TITLE_PAID, DESCRIPTION_ADDON, `${ticked}.`, ROW_ADDON);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Radio groups: P4 and P5
// ---------------------------------------------------------------------------

type RadioOption = {
  readonly control: IndexedElement;
  readonly label: LabelMatch;
  readonly minor: number;
  /** The price as written on the page; null when the price came from a "free" or "none" word. */
  readonly written: string | null;
  readonly currency: string;
};

function levelsBelow(el: IndexedElement, common: readonly number[]): number {
  return el.path === null ? Number.POSITIVE_INFINITY : el.path.length - common.length;
}

/** Radios with the same `name` and a nearest common ancestor at most `GROUP_MAX_LEVELS` levels up. */
function findRadioGroups(index: ElementIndex): readonly (readonly IndexedElement[])[] {
  const radios: IndexedElement[] = [];
  for (const el of index.elements) {
    if (radios.length >= MAX_RADIOS_CONSIDERED) break;
    if (!isRadioInput(el) || isDisabled(el) || hardHidden(index, el)) continue;
    if ((el.attr("name") ?? "").trim() === "") continue;
    radios.push(el);
  }

  const assigned = new Set<IndexedElement>();
  const groups: IndexedElement[][] = [];
  for (const first of radios) {
    if (assigned.has(first)) continue;
    if (groups.length >= MAX_CHOICE_GROUPS) break;
    assigned.add(first);
    const members: IndexedElement[] = [first];
    const name = (first.attr("name") ?? "").trim();
    for (const other of radios) {
      if (members.length >= MAX_OPTIONS_PER_GROUP) break;
      if (assigned.has(other) || (other.attr("name") ?? "").trim() !== name) continue;
      const common = index.commonPath(first, other);
      if (common === null) continue;
      if (levelsBelow(first, common) > GROUP_MAX_LEVELS) continue;
      if (levelsBelow(other, common) > GROUP_MAX_LEVELS) continue;
      assigned.add(other);
      members.push(other);
    }
    groups.push(members);
  }
  return groups;
}

/** Price of one radio option, or null when the group's price rule cannot be applied (requirement 12.12). */
function radioOption(index: ElementIndex, control: IndexedElement): RadioOption | null {
  const label = findLabel(index, control);
  if (label === null || !labelVisible(label, control)) return null;
  const price = chosenPrice(parsePrices(label.tokens));
  if (price !== null) {
    return {
      control,
      label,
      minor: price.minor,
      written: writtenPrice(label.tokens, price),
      currency: price.currency,
    };
  }
  if (hasAny(label.tokens, FREE) || hasAny(label.tokens, NONE)) {
    return { control, label, minor: 0, written: null, currency: "" };
  }
  return null;
}

/** True when the group's container text holds a required-choice word (shipping, size and so on). */
function isRequiredGroup(index: ElementIndex, members: readonly IndexedElement[]): boolean {
  let common: readonly number[] | null = members[0].path;
  for (const member of members) {
    if (common === null || member.path === null) return false;
    let length = 0;
    const shared = Math.min(common.length, member.path.length);
    while (length < shared && common[length] === member.path[length]) length += 1;
    common = common.slice(0, length);
  }
  if (common === null) return false;
  let read = 0;
  for (const el of index.subtree(common)) {
    if (read >= MAX_GROUP_TEXT_ELEMENTS) break;
    if (el.hidden || el.tokens.length === 0) continue;
    read += 1;
    if (hasAny(el.tokens, REQUIRED_GROUP)) return true;
  }
  return false;
}

function groupDraft(
  index: ElementIndex,
  members: readonly IndexedElement[]
): FindingDraft | null {
  if (members.length < 2) return null;
  const selected = members.find((m) => m.checked);
  if (selected === undefined) return null;

  const options: RadioOption[] = [];
  for (const member of members) {
    const option = radioOption(index, member);
    if (option === null) return null; // an option with no price and no "none" word: skip the group
    options.push(option);
  }
  const chosen = options.find((o) => o.control === selected);
  if (chosen === undefined) return null;
  const cheapest = options.reduce((best, o) => (o.minor < best.minor ? o : best), options[0]);
  if (chosen.minor <= 0 || chosen.minor <= cheapest.minor) return null;

  const required = isRequiredGroup(index, members);
  const nearby = chosen.label.how === "nearby" || cheapest.label.how === "nearby";
  const base: Confidence = required ? "low" : "medium";
  const cheapestWritten =
    cheapest.written ?? formatMinor(cheapest.minor, chosen.currency);

  return {
    patternId: PATTERN,
    confidence: nearby ? lowerConfidence(base) : base,
    title: TITLE_GROUP,
    description: `${DESCRIPTION_GROUP}${nearby ? ` ${NEARBY_SENTENCE}` : ""}`,
    evidenceText:
      `Option ${quote(chosen.label.text)} (${chosen.written ?? ""}) is selected; ` +
      `the cheapest option ${quote(cheapest.label.text)} costs ${cheapestWritten}.`,
    measuredValues: {
      selectedMinor: chosen.minor,
      cheapestMinor: cheapest.minor,
      groupSize: members.length,
    },
    elements: labelElements(chosen.control, chosen.label),
    ruleOrder: required ? ROW_GROUP_REQUIRED : ROW_GROUP,
  };
}

// ---------------------------------------------------------------------------
// Detector
// ---------------------------------------------------------------------------

/**
 * Detect possible preselection in one snapshot. A value that is not a usable
 * snapshot gives an empty array. An unexpected exception propagates; the
 * registry reports it (requirement 6.1).
 */
export function detectPreselection(snapshot: PageSnapshot): Finding[] {
  const index = buildIndex(snapshot, false);
  const detectedAt = detectedAtFrom(snapshot);
  const drafts: FindingDraft[] = [];

  for (const el of index.elements) {
    if (!isTickedToggle(el) || isDisabled(el) || hardHidden(index, el)) continue;
    const draft = toggleDraft(index, el);
    if (draft !== null) drafts.push(draft);
  }

  for (const members of findRadioGroups(index)) {
    const draft = groupDraft(index, members);
    if (draft !== null) drafts.push(draft);
  }

  return finaliseFindings(drafts, {
    detectedAt,
    pageTruncated: index.captureTruncated || index.budgetHit,
  });
}
