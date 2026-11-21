import { textContrast } from "@/lib/detectors/shared/colour";
import { buildIndex } from "@/lib/detectors/shared/elements";
import type {
  ElementIndex,
  IndexedElement,
} from "@/lib/detectors/shared/elements";
import { TITLES, detectedAtFrom } from "@/lib/detectors/shared/finding";
import {
  BADGE_MAX_CHARS,
  FRAGMENT_MAX_CHARS,
  GROUP_MAX_LEVELS,
  LONG_TEXT_CHARS,
  MAX_CANDIDATES,
  MAX_CANDIDATE_CHARS,
  MAX_DATA_BLOCK_BYTES,
  MAX_PARTS_PER_CANDIDATE,
  MAX_PART_CHARS,
  MAX_RULE_FINDINGS_SENT,
  MAX_TOTAL_CANDIDATE_CHARS,
  MIN_EFFECTIVE_OPACITY,
  MIN_FONT_PX,
  MIN_TEXT_CHARS,
  MIN_TEXT_CONTRAST,
  MIN_VISIBLE_BOX_PX,
  RANK_SCORES,
  ROLE_COVERAGE_MIN,
  TOAST_MAX_CHARS,
} from "@/lib/judge/constants";
import { encodePageData } from "@/lib/judge/prompt";
import { isMostlyRedacted, redactText } from "@/lib/judge/redact";
import { JUDGE_PATTERN_IDS } from "@/lib/judge/types";
import type { JudgePatternId, RuleKind } from "@/lib/judge/types";
import type {
  BoundingBox,
  Confidence,
  Finding,
  PageSnapshot,
} from "@/lib/types";

/**
 * Candidate builder (design section 11, note 2.1). Part one, `prepareCandidates`:
 * eligibility, normalisation, redaction and structure. Part two,
 * `buildCandidates`: split-text parts, rule links, ranking, caps and ids.
 * Pure: no clock, no randomness, no state. It reads `snapshot.elements` only
 * and, of the attributes, only `type`, `name` and `disabled` (through the
 * element index).
 */

// -- Types --------------------------------------------------------------------

export type CandidatePlace = "main" | "dialog" | "toast";

export type CandidateControl = "checkbox" | "radio" | "option";

/** The layout facts of a member of a button or link group (requirement 6.11). */
export type CandidateFacts = {
  /** Text contrast, one decimal; absent when the background is assumed. */
  contrast?: number;
  /** Area against the largest member of the group, two decimals. */
  areaRatio: number;
  fontPx?: number;
  disabled: boolean;
};

/**
 * One eligible, normalised, redacted candidate. Fields after `text` that the
 * wire format does not carry (`rawText`, `role`, `outsideImage`, `order`) are
 * kept for the second part of the builder.
 */
export type PreparedCandidate = {
  /** Snapshot element ids, primary first (an input before its label). */
  elementIds: string[];
  /** Document position of the primary element in the element index. */
  order: number;
  tag: string;
  role: string;
  place: CandidatePlace;
  /** Normalised and redacted text, at most 200 characters. */
  text: string;
  /** True when the normalised text was longer than 200 characters. */
  cut: boolean;
  /** The element text as read from the snapshot, before normalisation. */
  rawText: string;
  outsideImage: boolean;
  control?: CandidateControl;
  checked?: boolean;
  /** Local group key `g1`, `g2`, ... in document order of the first member. */
  group?: string;
  /** Present for members of a button or link group only. */
  facts?: CandidateFacts;
};

export type PreparedCandidates = {
  /** In document order. */
  candidates: PreparedCandidate[];
  /** The element index of the first sample, for the second part. */
  index: ElementIndex;
  /** What the shopper sees, for the second part (parts use the same tests). */
  view: ShopperView;
};

// -- Normalisation (requirements 5.5 and 5.6) ---------------------------------

/** U+0009 to U+000D are whitespace: they separate words and are not removed. */
function isLineWhitespace(code: number): boolean {
  return code >= 0x09 && code <= 0x0d;
}

/**
 * The control, zero-width and bidirectional formatting ranges of 5.5, and the
 * invisible code points of 21.11: the tag block U+E0000 to U+E007F, the soft
 * hyphen, the Arabic letter mark, the Mongolian vowel separator, the braille
 * blank and the Hangul fillers. NFKC turns U+3164 and U+FFA0 into U+1160
 * before this runs; the three stay listed so a change of order cannot reopen
 * them.
 */
function isRemovedCharacter(code: number): boolean {
  return (
    code <= 0x1f ||
    (code >= 0x7f && code <= 0x9f) ||
    (code >= 0x200b && code <= 0x200f) ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2060 && code <= 0x2069) ||
    code === 0xfeff ||
    (code >= 0xe0000 && code <= 0xe007f) ||
    code === 0x00ad ||
    code === 0x061c ||
    code === 0x180e ||
    code === 0x2800 ||
    code === 0x3164 ||
    code === 0x115f ||
    code === 0x1160 ||
    code === 0xffa0
  );
}

/** NFKC, removal of the listed characters, whitespace collapse and trim. */
function normaliseFull(raw: string): string {
  let out = "";
  for (const ch of raw.normalize("NFKC")) {
    const code = ch.codePointAt(0) ?? 0;
    if (isLineWhitespace(code)) out += " ";
    else if (!isRemovedCharacter(code)) out += ch;
  }
  return out.replace(/\s+/gu, " ").trim();
}

/** Cut at `max` UTF-16 units without leaving half of a surrogate pair. */
function cutAtBoundary(text: string, max: number): { text: string; cut: boolean } {
  if (text.length <= max) return { text, cut: false };
  let end = max;
  const last = text.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1;
  return { text: text.slice(0, end).trimEnd(), cut: true };
}

/**
 * Normalise candidate text: NFKC, removal of control, zero-width,
 * bidirectional formatting and other invisible characters, whitespace
 * collapse, and a cut at 200 characters at a character boundary with
 * `cut: true`.
 *
 * A tab and a line break are whitespace here: removing them as control
 * characters would glue the words of two lines together.
 */
export function normaliseCandidateText(raw: string): {
  text: string;
  cut: boolean;
} {
  return cutAtBoundary(normaliseFull(raw), MAX_CANDIDATE_CHARS);
}

// -- Element classes ----------------------------------------------------------

/** Tags of controls (design section 3); a control is never a fragment. */
const CONTROL_TAGS: ReadonlySet<string> = new Set([
  "input",
  "button",
  "select",
  "option",
  "textarea",
  "a",
]);

const BUTTON_INPUT_TYPES: ReadonlySet<string> = new Set([
  "button",
  "submit",
  "reset",
]);

function inputType(el: IndexedElement): string {
  if (el.tag !== "input") return "";
  return (el.attr("type") ?? "").trim().toLowerCase();
}

function toggleType(el: IndexedElement): "checkbox" | "radio" | null {
  const type = inputType(el);
  return type === "checkbox" || type === "radio" ? type : null;
}

/** A button, a submit-like input, a role button, or a link. */
function isButtonOrLink(el: IndexedElement): boolean {
  if (el.tag === "button" || el.tag === "a" || el.role === "button") return true;
  return BUTTON_INPUT_TYPES.has(inputType(el));
}

function isDialogRole(role: string): boolean {
  return role === "dialog" || role === "alertdialog";
}

/** Hidden by its own style (requirement 5.2, without the box rule). */
function isStyleHidden(el: IndexedElement): boolean {
  return (
    el.display === "none" ||
    el.visibility === "hidden" ||
    el.visibility === "collapse" ||
    el.opacity <= 0
  );
}

// -- Text the shopper cannot see (requirements 21.1 to 21.10, design 24.2) ----

/** The page area in pixels; an edge that is not a positive number is not tested. */
type PageArea = { width: number | null; height: number | null };

function edgeOf(full: number, viewport: number): number | null {
  const values = [full, viewport].filter((value) => Number.isFinite(value));
  if (values.length === 0) return null;
  const largest = Math.max(...values);
  return largest > 0 ? largest : null;
}

/** The page area from the snapshot's own width and height fields (21.1). */
function pageAreaOf(snapshot: PageSnapshot): PageArea {
  return {
    width: edgeOf(snapshot.fullWidth, snapshot.viewportWidth),
    height: edgeOf(snapshot.fullHeight, snapshot.viewportHeight),
  };
}

/** Tests 2 and 3 of design section 24.2 on one box: off-screen, then tiny. */
function boxIsVisible(box: BoundingBox, page: PageArea): boolean {
  const { x, y, width, height } = box;
  // 2. Off-screen: entirely outside the page area.
  if (x + width <= 0 || y + height <= 0) return false;
  if (page.width !== null && x >= page.width) return false;
  if (page.height !== null && y >= page.height) return false;
  // 3. Tiny box.
  return width >= MIN_VISIBLE_BOX_PX && height >= MIN_VISIBLE_BOX_PX;
}

/**
 * Tests 2 to 6 of design section 24.2 on one carrier of text. The box tests
 * (2 and 3) are decided by the caller, because they are not a property of the
 * element alone: a box is only seen when every captured ancestor's box is
 * seen too, and a selected option takes them from its select (`boxOk`). This
 * function then runs the tests that are about the element's own style: tiny
 * font, faint effective opacity and low contrast on a known background. Test 1
 * (style) is `isStyleHidden`. Every test uses only fields the snapshot holds.
 *
 * Which tests look at ancestors: the box tests (all captured ancestors), the
 * style test (ancestors' display, visibility and opacity 0) and the opacity
 * test (own opacity times the ancestors') are inherited. The font size and the
 * text colour are the element's own computed values, so a readable child of a
 * tiny-font parent stays readable and the font test is not inherited; the
 * contrast test takes the background from the ancestors (`textContrast`).
 * The call sites (eligibility, parts, label merging, role coverage and the
 * text of every carrier) all go through the one `ShopperView` built from this
 * function, so that they cannot differ.
 */
function isShopperVisible(
  el: IndexedElement,
  index: ElementIndex,
  boxOk: boolean,
): boolean {
  if (!boxOk) return false;
  // 4. Tiny font.
  if (el.fontSizePx !== null && el.fontSizePx < MIN_FONT_PX) return false;
  // 5. Faint effective opacity: own times the opacities of captured ancestors.
  let opacity = el.opacity;
  for (const ancestor of index.ancestors(el)) opacity *= ancestor.opacity;
  if (opacity < MIN_EFFECTIVE_OPACITY) return false;
  // 6. Low contrast, only on a known background and a readable colour.
  const contrast = textContrast(index, el);
  if (contrast !== null && !contrast.assumed && contrast.ratio < MIN_TEXT_CONTRAST) {
    return false;
  }
  return true;
}

/** The first characters of a hidden text that are looked for when all of it is not found. */
const HIDDEN_ANCHOR_CHARS = 16;

function pathStartsWith(path: readonly number[], prefix: readonly number[]): boolean {
  if (prefix.length > path.length) return false;
  for (let i = 0; i < prefix.length; i += 1) {
    if (path[i] !== prefix[i]) return false;
  }
  return true;
}

const WORD_CHARACTER = /[\p{L}\p{N}]/u;

function isWordBoundary(text: string, start: number, end: number): boolean {
  const before = start > 0 ? text.charAt(start - 1) : "";
  const after = end < text.length ? text.charAt(end) : "";
  return !WORD_CHARACTER.test(before) && !WORD_CHARACTER.test(after);
}

/**
 * `text` without one occurrence of `part`, or null when `part` is not in it.
 * An occurrence between word boundaries is preferred, so that a hidden "ly"
 * does not take the end of a visible "Only". Nothing is put in its place: the
 * shopper sees the words on either side of invisible text as they are, and
 * the whitespace that surrounded it collapses.
 */
function withoutOnce(text: string, part: string): string | null {
  let first = -1;
  let chosen = -1;
  let from = 0;
  for (;;) {
    const at = text.indexOf(part, from);
    if (at < 0) break;
    if (first < 0) first = at;
    if (isWordBoundary(text, at, at + part.length)) {
      chosen = at;
      break;
    }
    from = at + 1;
  }
  if (chosen < 0) chosen = first;
  if (chosen < 0) return null;
  return (text.slice(0, chosen) + text.slice(chosen + part.length))
    .replace(/\s+/gu, " ")
    .trim();
}

/**
 * What the shopper can see, decided once per snapshot. All members are
 * memoised and every candidate path (eligibility, parts, label merging, role
 * coverage, place) asks this one object.
 */
export type ShopperView = {
  /** Hidden by its own style or by an ancestor's (requirement 5.2). */
  hidden(el: IndexedElement): boolean;
  /** Tests 2 to 6 of design section 24.2, with inherited box tests. */
  seen(el: IndexedElement): boolean;
  /**
   * The normalised text of the element with the text of its unseen captured
   * descendants taken out; null when that cannot be done reliably.
   *
   * Choice (design 24.2, residual risk of a hidden descendant in a visible
   * carrier): the text of an element is the page's own text of the whole
   * subtree, so it holds what a hidden span says. The snapshot has no
   * per-node text, but it has the text of every captured descendant, so the
   * text of each topmost unseen descendant is cut out of the carrier's text.
   * That is reliable when the descendant's text is in the carrier's text as a
   * whole. When it is only partly there (the capture cut one of the texts at
   * its cap, or the page changed the text), the part that is left cannot be
   * located, and the carrier is dropped (null) rather than sent with what may
   * be a piece of hidden text. When no part of it is there, the descendant
   * was never in the carrier's text (a browser leaves display:none out) and
   * nothing is taken out. The options of a select are not unseen descendants:
   * a closed select reports a zero box for each, and their text is the text of
   * the control.
   */
  textOf(el: IndexedElement): string | null;
  isSelectedOption(el: IndexedElement): boolean;
};

function createShopperView(snapshot: PageSnapshot, index: ElementIndex): ShopperView {
  const elements = index.elements;
  const page = pageAreaOf(snapshot);

  const selectedById = new Map<string, boolean>();
  for (const raw of snapshot.elements) {
    if (!selectedById.has(raw.id)) selectedById.set(raw.id, raw.selected === true);
  }
  const isSelectedOption = (el: IndexedElement): boolean =>
    el.tag === "option" && selectedById.get(el.id) === true;

  const fullText: string[] = elements.map((el) => normaliseFull(el.text));

  // Own style, then ancestors' style: text under a hidden parent is not seen.
  const ownHidden = elements.map(isStyleHidden);
  const hiddenFlags: boolean[] = elements.map(
    (el) =>
      ownHidden[el.order] ||
      index.ancestors(el).some((ancestor) => ownHidden[ancestor.order]),
  );
  const hidden = (el: IndexedElement): boolean => hiddenFlags[el.order];

  // Tests 2 and 3 are inherited: an element is not seen when its own box or the
  // box of any captured ancestor is off the page or under MIN_VISIBLE_BOX_PX.
  // A box that clips (a 1 px wrapper) hides everything inside it, whatever the
  // size of the inner box.
  const chainCache = new Map<number, boolean>();
  const boxChainOk = (el: IndexedElement): boolean => {
    const known = chainCache.get(el.order);
    if (known !== undefined) return known;
    let ok = boxIsVisible(el.box, page);
    if (ok) {
      const parent = index.ancestors(el)[0];
      if (parent !== undefined) ok = boxChainOk(parent);
    }
    chainCache.set(el.order, ok);
    return ok;
  };

  // Requirement 21.8, amended: a selected option reports a zero box in a closed
  // select, so its own box says nothing. What the shopper sees is the select, so
  // the box tests run on the nearest captured select (and its ancestors); an
  // option with no captured select is not seen.
  const boxOk = (el: IndexedElement): boolean => {
    if (!isSelectedOption(el)) return boxChainOk(el);
    const select = index.ancestors(el).find((ancestor) => ancestor.tag === "select");
    return select !== undefined && boxChainOk(select);
  };

  const seenCache = new Map<number, boolean>();
  const seen = (el: IndexedElement): boolean => {
    const known = seenCache.get(el.order);
    if (known !== undefined) return known;
    const result = isShopperVisible(el, index, boxOk(el));
    seenCache.set(el.order, result);
    return result;
  };

  const unseen = (el: IndexedElement): boolean => hidden(el) || !seen(el);

  const isOptionOfSelect = (el: IndexedElement): boolean =>
    (el.tag === "option" || el.tag === "optgroup") &&
    index.ancestors(el).some((ancestor) => ancestor.tag === "select");

  const compute = (el: IndexedElement): string | null => {
    let text = fullText[el.order];
    const path = el.path;
    if (text === "" || path === null) return text;
    let blocked: IndexedElement | null = null;
    for (let i = el.order + 1; i < elements.length; i += 1) {
      const d = elements[i];
      if (d.path === null || !pathStartsWith(d.path, path)) break;
      if (d.path.length === path.length) continue;
      // Only the topmost unseen descendant is cut out: its text already holds
      // the text of everything inside it.
      if (blocked !== null && index.isAncestor(blocked, d)) continue;
      blocked = null;
      if (isOptionOfSelect(d) || !unseen(d)) continue;
      blocked = d;
      const hiddenText = fullText[d.order];
      if (hiddenText === "") continue;
      const rest = withoutOnce(text, hiddenText);
      if (rest !== null) {
        text = rest;
        continue;
      }
      const anchor = cutAtBoundary(hiddenText, HIDDEN_ANCHOR_CHARS).text;
      if (text.includes(anchor)) return null;
    }
    return text;
  };

  const textCache = new Map<number, string | null>();
  const textOf = (el: IndexedElement): string | null => {
    if (textCache.has(el.order)) return textCache.get(el.order) ?? null;
    const result = compute(el);
    textCache.set(el.order, result);
    return result;
  };

  return { hidden, seen, textOf, isSelectedOption };
}

function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function parentKey(el: IndexedElement): string | null {
  if (el.path === null || el.path.length === 0) return null;
  return el.path.slice(0, -1).join("-");
}

// -- The builder --------------------------------------------------------------

type Draft = {
  el: IndexedElement;
  /** Label element merged into this candidate, if any. */
  label: IndexedElement | null;
  /** Full normalised text before the cut (used for place and coverage). */
  fullText: string;
};

/** Union-find over candidate positions. */
function makeUnionFind(size: number): {
  find: (i: number) => number;
  union: (a: number, b: number) => void;
} {
  const parent = Array.from({ length: size }, (_, i) => i);
  const find = (i: number): number => {
    let root = i;
    while (parent[root] !== root) root = parent[root];
    let at = i;
    while (parent[at] !== root) {
      const next = parent[at];
      parent[at] = root;
      at = next;
    }
    return root;
  };
  const union = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
  };
  return { find, union };
}

/**
 * Build the eligible, normalised, redacted and structured candidates of the
 * first sample, in document order (design section 11, steps up to "Facts").
 */
export function prepareCandidates(snapshot: PageSnapshot): PreparedCandidates {
  const index = buildIndex(snapshot, false);
  const elements = index.elements;
  const view = createShopperView(snapshot, index);
  const { hidden, seen, textOf, isSelectedOption } = view;

  // Requirements 5.3 and 21.1 to 21.8. A checkbox or a radio is sent whatever
  // its box (it has no text of its own; its label is the carrier, tested where
  // it is merged). Every other element is its own carrier, and its text is the
  // text the shopper can see (`textOf`): a carrier whose visible text cannot be
  // told is not sent.
  const eligible = (el: IndexedElement): boolean => {
    if (hidden(el)) return false;
    if (toggleType(el) !== null) return true;
    if (!seen(el)) return false;
    const visible = textOf(el);
    if (visible === null) return false;
    return visible.length >= MIN_TEXT_CHARS || isSelectedOption(el);
  };

  // Next captured sibling of every element (requirement 6.4).
  const nextSibling = new Map<number, IndexedElement>();
  const lastOfParent = new Map<string, IndexedElement>();
  for (const el of elements) {
    const key = parentKey(el);
    if (key === null) continue;
    const before = lastOfParent.get(key);
    if (before) nextSibling.set(before.order, el);
    lastOfParent.set(key, el);
  }

  // Pass one: labels of eligible checkboxes and radios. A label is merged only
  // when the shopper sees it and its visible text can be told.
  const labelOf = new Map<number, IndexedElement>();
  const consumed = new Set<number>();
  for (const el of elements) {
    if (toggleType(el) === null || !eligible(el)) continue;
    const wrapping = index.ancestors(el).find((a) => a.tag === "label");
    const label = wrapping ?? nextSibling.get(el.order);
    if (
      !label ||
      label.tag !== "label" ||
      hidden(label) ||
      !seen(label) ||
      textOf(label) === null
    ) {
      continue;
    }
    labelOf.set(el.order, label);
    consumed.add(label.order);
  }

  // Requirements 6.1 to 6.3: a role container whose captured descendants
  // cover its text is not sent. Both sides count the text the shopper sees.
  const isCoveredContainer = (el: IndexedElement): boolean => {
    if (el.role === "" || el.path === null) return false;
    const length = textOf(el)?.length ?? 0;
    if (length === 0) return false;
    let covered = 0;
    for (const d of index.subtree(el.path)) {
      if (!index.isAncestor(el, d) || hidden(d) || !seen(d)) continue;
      covered += textOf(d)?.length ?? 0;
    }
    return Math.min(covered, length) / length >= ROLE_COVERAGE_MIN;
  };

  const drafts: Draft[] = [];
  const texts: Array<{ text: string; cut: boolean }> = [];
  for (const el of elements) {
    if (consumed.has(el.order) || !eligible(el)) continue;
    if (isCoveredContainer(el)) continue;
    const label = labelOf.get(el.order) ?? null;
    const full = toggleType(el) !== null
      ? label
        ? (textOf(label) ?? "")
        : ""
      : (textOf(el) ?? "");
    const cut = cutAtBoundary(full, MAX_CANDIDATE_CHARS);
    const redacted = redactText(cut.text);
    if (redacted !== "" && isMostlyRedacted(redacted)) continue;
    drafts.push({ el, label, fullText: full });
    texts.push({ text: redacted, cut: cut.cut });
  }

  // Requirements 6.8 to 6.10.
  const placeOf = (draft: Draft): CandidatePlace => {
    const { el } = draft;
    if (
      isDialogRole(el.role) ||
      index.ancestors(el).some((ancestor) => isDialogRole(ancestor.role))
    ) {
      return "dialog";
    }
    const overlay = el.position === "fixed" || el.position === "sticky";
    if (
      el.role === "status" ||
      el.role === "alert" ||
      (overlay && draft.fullText.length <= TOAST_MAX_CHARS)
    ) {
      return "toast";
    }
    return "main";
  };

  const candidates: PreparedCandidate[] = drafts.map((draft, i) => {
    const { el, label } = draft;
    // The raw text is the text as read, unless text the shopper cannot see was
    // taken out of it: then it is the visible text, so that no hidden word
    // stays on the candidate (it only steers the split-text step).
    const visible = textOf(el);
    const rawText =
      visible === null || visible === normaliseFull(el.text) ? el.text : visible;
    const candidate: PreparedCandidate = {
      elementIds: label ? [el.id, label.id] : [el.id],
      order: el.order,
      tag: el.tag,
      role: el.role,
      place: placeOf(draft),
      text: texts[i].text,
      cut: texts[i].cut,
      rawText,
      outsideImage: el.outsideImage,
    };
    const toggle = toggleType(el);
    if (toggle !== null) {
      candidate.control = toggle;
      candidate.checked = el.checked;
    } else if (isSelectedOption(el)) {
      candidate.control = "option";
      candidate.checked = true;
    }
    return candidate;
  });

  assignGroups(candidates, drafts, index);
  return { candidates, index, view };
}

// -- Groups and facts (requirements 6.5 to 6.7, 6.11 to 6.13) -----------------

function assignGroups(
  candidates: PreparedCandidate[],
  drafts: readonly Draft[],
  index: ElementIndex,
): void {
  type Group = { members: number[]; buttons: boolean };
  const groups: Group[] = [];

  // Radios that share a name. The name is used here and never sent.
  const byName = new Map<string, number[]>();
  drafts.forEach((draft, i) => {
    if (toggleType(draft.el) !== "radio") return;
    const name = (draft.el.attr("name") ?? "").trim();
    if (name === "") return;
    const list = byName.get(name) ?? [];
    list.push(i);
    byName.set(name, list);
  });
  for (const members of byName.values()) {
    if (members.length >= 2) groups.push({ members, buttons: false });
  }

  // Buttons and links under a shared container within GROUP_MAX_LEVELS levels.
  const buckets = new Map<string, number[]>();
  const memberPositions: number[] = [];
  drafts.forEach((draft, i) => {
    const { el } = draft;
    if (el.path === null || !isButtonOrLink(el)) return;
    memberPositions.push(i);
    for (let level = 1; level <= GROUP_MAX_LEVELS; level += 1) {
      const prefixLength = el.path.length - level;
      if (prefixLength < 1) break;
      const key = el.path.slice(0, prefixLength).join("-");
      const list = buckets.get(key) ?? [];
      list.push(i);
      buckets.set(key, list);
    }
  });
  const sets = makeUnionFind(drafts.length);
  for (const list of buckets.values()) {
    for (let k = 1; k < list.length; k += 1) sets.union(list[0], list[k]);
  }
  const components = new Map<number, number[]>();
  for (const i of memberPositions) {
    const root = sets.find(i);
    const list = components.get(root) ?? [];
    list.push(i);
    components.set(root, list);
  }
  for (const members of components.values()) {
    if (members.length >= 2) groups.push({ members, buttons: true });
  }

  for (const group of groups) group.members.sort((a, b) => a - b);
  groups.sort((a, b) => a.members[0] - b.members[0]);

  groups.forEach((group, n) => {
    const key = `g${n + 1}`;
    for (const i of group.members) candidates[i].group = key;
    if (!group.buttons) return;
    const largest = Math.max(...group.members.map((i) => drafts[i].el.area));
    for (const i of group.members) {
      const el = drafts[i].el;
      const facts: CandidateFacts = {
        areaRatio: largest > 0 ? round(el.area / largest, 2) : 1,
        disabled: el.attr("disabled") !== undefined,
      };
      const contrast = textContrast(index, el);
      if (contrast !== null && !contrast.assumed) {
        facts.contrast = round(contrast.ratio, 1);
      }
      if (el.fontSizePx !== null) facts.fontPx = el.fontSizePx;
      candidates[i].facts = facts;
    }
  });
}

// =============================================================================
// Part two: split text, rule links, ranking, caps and ids
// (requirements 7.1 to 7.14, design section 11, note 2.1 steps 4 to 6)
// =============================================================================

// -- Wire and map types -------------------------------------------------------

/** One candidate as the model sees it (note 2.2). */
export type WireCandidate = {
  id: string;
  tag: string;
  place: CandidatePlace;
  text: string;
  cut?: true;
  control?: CandidateControl;
  checked?: boolean;
  parts?: string[];
  group?: string;
  facts?: CandidateFacts;
  rules?: string[];
};

/** One rule finding as the model sees it. No description, no quote. */
export type WireRuleFinding = {
  id: string;
  pattern: JudgePatternId;
  confidence: Confidence;
  kind: RuleKind;
  candidates: string[];
};

/** The data block: what is encoded between the `<page_data>` tags. */
export type PageData = {
  scanDate?: string;
  candidates: WireCandidate[];
  ruleFindings: WireRuleFinding[];
};

/** What the code keeps of a sent candidate, for validation and merge. */
export type MappedCandidate = {
  id: string;
  /** Snapshot element ids, primary first, then the label, then the parts. */
  elementIds: string[];
  /** The sent text, for the quote check. */
  text: string;
  /** The sent parts, for the quote check. */
  parts: string[];
  tag: string;
  place: CandidatePlace;
  control?: CandidateControl;
  checked?: boolean;
  group?: string;
  /** True for a member of a button or link group (it has `facts`). */
  inButtonGroup: boolean;
  /** Document position of the primary element. */
  order: number;
};

/** What the code keeps of a sent rule finding. */
export type MappedRule = {
  id: string;
  /** Index of the rule finding in the array given to `buildCandidates`. */
  index: number;
  kind: RuleKind;
  /** Ids of the sent candidates that cover the rule finding. */
  candidateIds: string[];
};

export type CandidateMap = {
  /** Keyed by `c1`, `c2`, ... in that order. */
  candidates: ReadonlyMap<string, MappedCandidate>;
  /** Keyed by `r1`, `r2`, ... in that order. */
  rules: ReadonlyMap<string, MappedRule>;
};

export type BuiltCandidates = {
  candidates: WireCandidate[];
  ruleFindings: WireRuleFinding[];
  map: CandidateMap;
  /** True when a cap dropped a candidate, a part or a rule finding. */
  truncated: boolean;
  /** The data block, ready for `encodePageData`. */
  data: PageData;
};

// -- Rule kinds (requirement 11.1) --------------------------------------------

const RELOAD_PHRASES: readonly string[] = ["on reload", "across a reload"];

/**
 * The kind of a rule finding, from its fixed title: `reload` for the five
 * titles that name a reload, `measured` for visual interference,
 * `structural` for preselection and `text` for the rest. A title that is not
 * in `TITLES` gives `null`.
 */
export function ruleKind(title: string): RuleKind | null {
  for (const pattern of JUDGE_PATTERN_IDS) {
    if (!TITLES[pattern].includes(title)) continue;
    if (RELOAD_PHRASES.some((phrase) => title.includes(phrase))) return "reload";
    if (pattern === "visual-interference") return "measured";
    if (pattern === "preselection") return "structural";
    return "text";
  }
  return null;
}

// -- Ranking (requirement 7.8) ------------------------------------------------

const CLOCK = /\d{1,2}:\d{2}/u;
const DIGIT = /\p{Nd}/u;
const EMPHASIS = /[!%\p{Sc}]/u;
const BADGE_TAGS: ReadonlySet<string> = new Set([
  "span",
  "strong",
  "b",
  "small",
  "em",
  "mark",
]);
const HEADING_TAGS: ReadonlySet<string> = new Set(["h1", "h2", "h3"]);

/**
 * The score of one candidate by the table of design section 11. Signals are
 * language-neutral on purpose: no word list is used. The text and the parts
 * both count for the digit, clock and emphasis signals.
 */
export function scoreCandidate(
  candidate: PreparedCandidate,
  parts: readonly string[],
  ruleCovered: boolean,
): number {
  const texts = [candidate.text, ...parts];
  let score = 0;
  if (ruleCovered) score += RANK_SCORES.ruleCovered;
  if (candidate.control !== undefined) score += RANK_SCORES.control;
  const overlay = candidate.place !== "main";
  if (candidate.facts !== undefined && overlay) score += RANK_SCORES.groupInOverlay;
  if (overlay) score += RANK_SCORES.overlayPlace;
  if (texts.some((text) => CLOCK.test(text))) score += RANK_SCORES.clock;
  if (texts.some((text) => DIGIT.test(text))) score += RANK_SCORES.digit;
  if (texts.some((text) => EMPHASIS.test(text))) score += RANK_SCORES.emphasis;
  if (
    candidate.text.length <= BADGE_MAX_CHARS &&
    (BADGE_TAGS.has(candidate.tag) || candidate.role !== "")
  ) {
    score += RANK_SCORES.shortEmphasis;
  }
  if (HEADING_TAGS.has(candidate.tag)) score += RANK_SCORES.heading;
  if (candidate.text.length > LONG_TEXT_CHARS) score += RANK_SCORES.longText;
  if (candidate.outsideImage) score += RANK_SCORES.outsideImage;
  return score;
}

// -- Split text (requirements 7.1 to 7.4) -------------------------------------

/** Punctuation only, to stay language-neutral (design section 3). */
const CONNECTORS = "-–—:,/+·";

/** Tags whose texts may be attached to a fragment as parts. */
const PART_TAGS: ReadonlySet<string> = new Set([
  "span",
  "b",
  "strong",
  "em",
  "i",
  "small",
  "mark",
  "s",
  "del",
  "ins",
  "sup",
  "sub",
  "time",
  "data",
  "abbr",
]);

/** A non-control element whose text may be only a piece of a claim. */
function isFragment(candidate: PreparedCandidate): boolean {
  if (CONTROL_TAGS.has(candidate.tag)) return false;
  const raw = candidate.rawText;
  if (raw.includes("  ")) return true;
  const trimmed = raw.trim();
  if (trimmed.length <= FRAGMENT_MAX_CHARS) return true;
  return (
    CONNECTORS.includes(trimmed.charAt(0)) ||
    CONNECTORS.includes(trimmed.charAt(trimmed.length - 1))
  );
}

type Part = { id: string; text: string; box: IndexedElement["box"]; order: number };

function partSort(a: Part, b: Part): number {
  if (a.box.y !== b.box.y) return a.box.y - b.box.y;
  if (a.box.x !== b.box.x) return a.box.x - b.box.x;
  return a.order - b.order;
}

/** Direct children (id path plus one segment) of every element, by parent path. */
function childrenByParent(index: ElementIndex): Map<string, IndexedElement[]> {
  const children = new Map<string, IndexedElement[]>();
  for (const el of index.elements) {
    if (el.path === null || el.path.length === 0) continue;
    const key = el.path.slice(0, -1).join("-");
    const list = children.get(key) ?? [];
    list.push(el);
    children.set(key, list);
  }
  return children;
}

/**
 * The parts of a fragment: the normalised and redacted texts of its direct
 * children with a part tag, each cut to 24 characters, ordered by box top and
 * then left. A part that is empty or mostly a placeholder is skipped. The
 * second value says whether a part was left out because of the cap.
 */
function partsOf(
  candidate: PreparedCandidate,
  index: ElementIndex,
  children: ReadonlyMap<string, readonly IndexedElement[]>,
  view: ShopperView,
): { parts: Part[]; capped: boolean } {
  const owner = index.byId(candidate.elementIds[0]);
  if (!owner || owner.path === null) return { parts: [], capped: false };
  const found: Part[] = [];
  for (const child of children.get(owner.path.join("-")) ?? []) {
    if (!PART_TAGS.has(child.tag) || child.hidden) continue;
    // Requirement 21.9: a child the shopper cannot see is not a part. The same
    // view as for candidates decides, ancestors' boxes included.
    if (view.hidden(child) || !view.seen(child)) continue;
    // The part's text is what the shopper sees of it: hidden text inside the
    // child is not part of it, and a child whose visible text cannot be told
    // is not a part.
    const visible = view.textOf(child);
    if (visible === null) continue;
    const redacted = redactText(cutAtBoundary(visible, MAX_CANDIDATE_CHARS).text);
    if (redacted === "" || isMostlyRedacted(redacted)) continue;
    found.push({
      id: child.id,
      text: cutAtBoundary(redacted, MAX_PART_CHARS).text,
      box: child.box,
      order: child.order,
    });
  }
  found.sort(partSort);
  return {
    parts: found.slice(0, MAX_PARTS_PER_CANDIDATE),
    capped: found.length > MAX_PARTS_PER_CANDIDATE,
  };
}

// -- The pool, rule links and assembly ----------------------------------------

type PoolEntry = {
  candidate: PreparedCandidate;
  parts: string[];
  /** The element ids of the candidate, then of its parts. */
  elementIds: string[];
  /** Characters of text and parts together. */
  size: number;
};

type RuleLink = {
  /** Position of the rule finding in the array given by the caller. */
  sourceIndex: number;
  finding: Finding;
  kind: RuleKind;
  /** Document position of the first element of the finding that the page holds. */
  position: number;
  /** Positions in the pool, ascending. */
  poolPositions: number[];
};

type Assembled = {
  candidates: WireCandidate[];
  ruleFindings: WireRuleFinding[];
  map: CandidateMap;
  data: PageData;
  chars: number;
  /** Number of rule links that have at least one kept candidate. */
  sentRules: number;
};

/** A tag that is a plain word of letters and digits is sent; anything else is `other`. */
const WIRE_TAG = /^[a-z][a-z0-9]{0,19}$/u;

function wireTag(tag: string): string {
  return WIRE_TAG.test(tag) ? tag : "other";
}

function wireFacts(facts: CandidateFacts): CandidateFacts {
  return {
    ...(facts.contrast !== undefined ? { contrast: facts.contrast } : {}),
    areaRatio: facts.areaRatio,
    ...(facts.fontPx !== undefined ? { fontPx: facts.fontPx } : {}),
    disabled: facts.disabled,
  };
}

function scanDateOf(snapshot: PageSnapshot): string | undefined {
  const at = detectedAtFrom(snapshot);
  return at.ms === null ? undefined : at.iso.slice(0, 10);
}

function assemble(
  pool: readonly PoolEntry[],
  links: readonly RuleLink[],
  keptPositions: readonly number[],
  scanDate: string | undefined,
): Assembled {
  const kept = [...keptPositions].sort((a, b) => a - b);
  const idOf = new Map<number, string>();
  kept.forEach((position, i) => idOf.set(position, `c${i + 1}`));

  // Rule findings with at least one kept candidate, in document order.
  const sent = links.filter((link) =>
    link.poolPositions.some((position) => idOf.has(position)),
  );
  const rulesOf = new Map<number, string[]>();
  const wireRules: WireRuleFinding[] = [];
  const mappedRules = new Map<string, MappedRule>();
  sent.forEach((link, i) => {
    const id = `r${i + 1}`;
    const candidateIds: string[] = [];
    for (const position of link.poolPositions) {
      const candidateId = idOf.get(position);
      if (candidateId === undefined) continue;
      candidateIds.push(candidateId);
      const list = rulesOf.get(position) ?? [];
      list.push(id);
      rulesOf.set(position, list);
    }
    wireRules.push({
      id,
      pattern: link.finding.patternId as JudgePatternId,
      confidence: link.finding.confidence,
      kind: link.kind,
      candidates: candidateIds,
    });
    mappedRules.set(id, {
      id,
      index: link.sourceIndex,
      kind: link.kind,
      candidateIds,
    });
  });

  let chars = 0;
  const wireCandidates: WireCandidate[] = [];
  const mappedCandidates = new Map<string, MappedCandidate>();
  for (const position of kept) {
    const entry = pool[position];
    const c = entry.candidate;
    const id = idOf.get(position) as string;
    chars += entry.size;

    const wire: WireCandidate = { id, tag: wireTag(c.tag), place: c.place, text: c.text };
    if (c.cut) wire.cut = true;
    if (c.control !== undefined) {
      wire.control = c.control;
      wire.checked = c.checked === true;
    }
    if (entry.parts.length > 0) wire.parts = [...entry.parts];
    if (c.group !== undefined) wire.group = c.group;
    if (c.facts !== undefined) wire.facts = wireFacts(c.facts);
    const rules = rulesOf.get(position);
    if (rules !== undefined) wire.rules = rules;
    wireCandidates.push(wire);

    const mapped: MappedCandidate = {
      id,
      elementIds: [...entry.elementIds],
      text: c.text,
      parts: [...entry.parts],
      tag: wire.tag,
      place: c.place,
      inButtonGroup: c.facts !== undefined,
      order: c.order,
    };
    if (c.control !== undefined) {
      mapped.control = c.control;
      mapped.checked = c.checked === true;
    }
    if (c.group !== undefined) mapped.group = c.group;
    mappedCandidates.set(id, mapped);
  }

  const data: PageData = {
    ...(scanDate !== undefined ? { scanDate } : {}),
    candidates: wireCandidates,
    ruleFindings: wireRules,
  };
  return {
    candidates: wireCandidates,
    ruleFindings: wireRules,
    map: { candidates: mappedCandidates, rules: mappedRules },
    data,
    chars,
    sentRules: sent.length,
  };
}

function encodedBytes(data: PageData): number {
  return new TextEncoder().encode(encodePageData(data)).length;
}

/**
 * Build the candidates, the rule findings and the map of one scan (design
 * section 11): parts for split text, links to at most 20 rule findings,
 * ranking, the caps of 60 candidates, 10,000 characters and the data block
 * byte cap, document order and ids `c1`..`cN`, `r1`..`rN`.
 *
 * `ruleFindings` are the findings of the rules, in their own order; the map
 * gives the index of each sent one in that array.
 */
export function buildCandidates(
  snapshot: PageSnapshot,
  ruleFindings: readonly Finding[],
): BuiltCandidates {
  const { candidates: prepared, index, view } = prepareCandidates(snapshot);
  let truncated = false;

  // Parts, in document order: a child that became a part is not sent again,
  // and a child that is a part of an earlier fragment owns no parts itself.
  const children = childrenByParent(index);
  const consumed = new Set<string>();
  const pool: PoolEntry[] = [];
  for (const candidate of prepared) {
    if (consumed.has(candidate.elementIds[0])) continue;
    let parts: Part[] = [];
    if (isFragment(candidate)) {
      const result = partsOf(candidate, index, children, view);
      parts = result.parts;
      if (result.capped) truncated = true;
    }
    for (const part of parts) consumed.add(part.id);
    pool.push({
      candidate,
      parts: parts.map((part) => part.text),
      elementIds: [...candidate.elementIds, ...parts.map((part) => part.id)],
      size:
        candidate.text.length +
        parts.reduce((total, part) => total + part.text.length, 0),
    });
  }

  // Rule links (requirements 7.5 to 7.7).
  const poolByElementId = new Map<string, number>();
  pool.forEach((entry, position) => {
    for (const id of entry.elementIds) {
      if (!poolByElementId.has(id)) poolByElementId.set(id, position);
    }
  });
  const found: RuleLink[] = [];
  ruleFindings.forEach((finding, sourceIndex) => {
    const kind = ruleKind(finding.title);
    if (kind === null) return;
    if (!(JUDGE_PATTERN_IDS as readonly string[]).includes(finding.patternId)) return;
    const mapped = new Set<number>();
    let position: number | null = null;
    for (const id of finding.elementIds) {
      const element = index.byId(id);
      if (position === null && element) position = element.order;
      const at = poolByElementId.get(id);
      if (at !== undefined) mapped.add(at);
    }
    if (mapped.size === 0) return;
    const poolPositions = [...mapped].sort((a, b) => a - b);
    found.push({
      sourceIndex,
      finding,
      kind,
      position: position ?? pool[poolPositions[0]].candidate.order,
      poolPositions,
    });
  });
  found.sort((a, b) => a.position - b.position || a.sourceIndex - b.sourceIndex);
  if (found.length > MAX_RULE_FINDINGS_SENT) truncated = true;
  const links = found.slice(0, MAX_RULE_FINDINGS_SENT);

  // Ranking: highest score first, ties by document order.
  const covered = new Set<number>();
  for (const link of links) for (const position of link.poolPositions) covered.add(position);
  const scores = pool.map((entry, position) =>
    scoreCandidate(entry.candidate, entry.parts, covered.has(position)),
  );
  const ranked = pool
    .map((_, position) => position)
    .sort((a, b) => scores[b] - scores[a] || a - b);

  // Caps (requirements 7.10 to 7.12): drop from the bottom of the ranking.
  const scanDate = scanDateOf(snapshot);
  const keep = ranked.slice(0, MAX_CANDIDATES);
  if (ranked.length > keep.length) truncated = true;
  let result = assemble(pool, links, keep, scanDate);
  while (
    keep.length > 0 &&
    (result.chars > MAX_TOTAL_CANDIDATE_CHARS ||
      encodedBytes(result.data) > MAX_DATA_BLOCK_BYTES)
  ) {
    keep.pop();
    truncated = true;
    result = assemble(pool, links, keep, scanDate);
  }
  if (result.sentRules < links.length) truncated = true;

  return {
    candidates: result.candidates,
    ruleFindings: result.ruleFindings,
    map: result.map,
    truncated,
    data: result.data,
  };
}
