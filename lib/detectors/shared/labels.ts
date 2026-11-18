import { LABEL_MAX_LEVELS, MAX_TEXT_READ } from "@/lib/detectors/shared/constants";
import type { ElementIndex, IndexedElement } from "@/lib/detectors/shared/elements";
import { tokenise } from "@/lib/detectors/shared/text";
import type { Token } from "@/lib/detectors/shared/text";

/**
 * Label association for checkboxes, radios and switches (requirement 7.4).
 * Steps, in order: a `label` ancestor, the control's own text, its
 * `aria-label`, the text of the parent container when the control is the
 * only form control in it ("sole"), and the nearest text element in the
 * parent container or one level above ("nearby"). "nearby" is the weakest
 * association; callers lower their confidence by one level for it (7.5).
 */

export type LabelMatch = {
  readonly text: string;
  readonly tokens: readonly Token[];
  /** The element that carries the text; null for an `aria-label`. */
  readonly element: IndexedElement | null;
  readonly how: "label" | "own" | "aria" | "sole" | "nearby";
};

/** Text elements read in a container before duplicates are removed. */
const SOLE_SCAN_LIMIT = 40;

/** Text elements joined into one "sole" label. */
const SOLE_MAX_ELEMENTS = 6;

const CONTROL_ROLES: ReadonlySet<string> = new Set([
  "switch",
  "checkbox",
  "radio",
  "button",
]);

function isFormControl(el: IndexedElement): boolean {
  return el.isControl || CONTROL_ROLES.has(el.role);
}

function hasText(el: IndexedElement): boolean {
  return el.tokens.length > 0;
}

function makeMatch(
  text: string,
  element: IndexedElement | null,
  how: LabelMatch["how"]
): LabelMatch {
  const cut = text.length > MAX_TEXT_READ ? text.slice(0, MAX_TEXT_READ) : text;
  return Object.freeze({
    text: cut,
    tokens: tokenise(cut, MAX_TEXT_READ),
    element,
    how,
  });
}

/** A visible element with text that is not a form control and not inside the control. */
function isLabelText(
  index: ElementIndex,
  control: IndexedElement,
  el: IndexedElement
): boolean {
  return (
    el !== control &&
    !el.hidden &&
    !isFormControl(el) &&
    hasText(el) &&
    !index.isAncestor(control, el)
  );
}

/** Joined text of the text elements of a container, dropping text an ancestor element already holds. */
function soleMatch(
  index: ElementIndex,
  control: IndexedElement,
  parentPath: readonly number[]
): LabelMatch | null {
  const subtree = index.subtree(parentPath);
  for (const el of subtree) {
    if (el === control || index.isAncestor(control, el)) continue;
    if (isFormControl(el)) return null; // another form control: not "sole"
  }

  const candidates: IndexedElement[] = [];
  for (const el of subtree) {
    if (candidates.length >= SOLE_SCAN_LIMIT) break;
    if (isLabelText(index, control, el)) candidates.push(el);
  }
  const kept = candidates.filter(
    (el) =>
      !candidates.some(
        (other) => other !== el && index.isAncestor(other, el) && other.text.includes(el.text)
      )
  );
  const used = kept.slice(0, SOLE_MAX_ELEMENTS);
  if (used.length === 0) return null;
  return makeMatch(used.map((el) => el.text).join(" "), used[0], "sole");
}

/** The text element closest to the control in document order; on a tie, the one after it. */
function nearestText(
  index: ElementIndex,
  control: IndexedElement,
  containerPath: readonly number[]
): IndexedElement | null {
  let best: IndexedElement | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const el of index.subtree(containerPath)) {
    if (!isLabelText(index, control, el)) continue;
    const distance = Math.abs(el.order - control.order);
    if (distance < bestDistance || (distance === bestDistance && best !== null && el.order > best.order)) {
      best = el;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * The label of a control, or null when none is found (the control is then
 * not flagged, requirement 7.6).
 */
export function findLabel(
  index: ElementIndex,
  control: IndexedElement
): LabelMatch | null {
  for (const ancestor of index.ancestors(control, LABEL_MAX_LEVELS)) {
    if (ancestor.tag === "label" && hasText(ancestor)) {
      return makeMatch(ancestor.text, ancestor, "label");
    }
  }

  if (hasText(control)) return makeMatch(control.text, control, "own");

  const aria = control.attr("aria-label");
  if (aria !== undefined) {
    const tokens = tokenise(aria, MAX_TEXT_READ);
    if (tokens.length > 0) return makeMatch(aria, null, "aria");
  }

  if (control.path === null || control.path.length < 2) return null;
  // A container at the root (path of length 0 or 1) would be the whole page.
  const parentPath = control.path.slice(0, -1);

  const sole = soleMatch(index, control, parentPath);
  if (sole !== null) return sole;

  const near = nearestText(index, control, parentPath);
  if (near !== null) return makeMatch(near.text, near, "nearby");

  const higherPath = parentPath.slice(0, -1);
  if (higherPath.length > 0) {
    const higher = nearestText(index, control, higherPath);
    if (higher !== null) return makeMatch(higher.text, higher, "nearby");
  }
  return null;
}
