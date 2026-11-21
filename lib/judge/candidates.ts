import { textContrast } from "@/lib/detectors/shared/colour";
import { buildIndex } from "@/lib/detectors/shared/elements";
import type {
  ElementIndex,
  IndexedElement,
} from "@/lib/detectors/shared/elements";
import {
  GROUP_MAX_LEVELS,
  MAX_CANDIDATE_CHARS,
  MIN_TEXT_CHARS,
  ROLE_COVERAGE_MIN,
  TOAST_MAX_CHARS,
} from "@/lib/judge/constants";
import { isMostlyRedacted, redactText } from "@/lib/judge/redact";
import type { ElementSnapshot, PageSnapshot } from "@/lib/types";

/**
 * Candidate builder, part one (design section 11, note 2.1 steps 1 to 4):
 * eligibility, normalisation, redaction and structure. Pure: no clock, no
 * randomness, no state. It reads `snapshot.elements` only and, of the
 * attributes, only `type`, `name` and `disabled` (through the element index).
 * Split text, rule links, ranking, caps and ids belong to the second part.
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
};

// -- Normalisation (requirements 5.5 and 5.6) ---------------------------------

/** U+0009 to U+000D are whitespace: they separate words and are not removed. */
function isLineWhitespace(code: number): boolean {
  return code >= 0x09 && code <= 0x0d;
}

/** The control, zero-width and bidirectional formatting ranges of 5.5. */
function isRemovedCharacter(code: number): boolean {
  return (
    code <= 0x1f ||
    (code >= 0x7f && code <= 0x9f) ||
    (code >= 0x200b && code <= 0x200f) ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2060 && code <= 0x2069) ||
    code === 0xfeff
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
 * Normalise candidate text: NFKC, removal of control, zero-width and
 * bidirectional formatting characters, whitespace collapse, and a cut at 200
 * characters at a character boundary with `cut: true`.
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

/** Controls for the zero-box rule (design section 3). */
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

  const rawById = new Map<string, ElementSnapshot>();
  for (const raw of snapshot.elements) {
    if (!rawById.has(raw.id)) rawById.set(raw.id, raw);
  }

  const fullText: string[] = elements.map((el) => normaliseFull(el.text));

  // Own style, then ancestors' style: text under a hidden parent is not seen.
  const ownHidden = elements.map(isStyleHidden);
  const hidden: boolean[] = elements.map(
    (el) =>
      ownHidden[el.order] ||
      index.ancestors(el).some((ancestor) => ownHidden[ancestor.order]),
  );

  const isSelectedOption = (el: IndexedElement): boolean =>
    el.tag === "option" && rawById.get(el.id)?.selected === true;

  // Requirements 5.2 and 5.3.
  const eligible = (el: IndexedElement): boolean => {
    if (hidden[el.order]) return false;
    if (!CONTROL_TAGS.has(el.tag) && (el.box.width === 0 || el.box.height === 0)) {
      return false;
    }
    return (
      fullText[el.order].length >= MIN_TEXT_CHARS ||
      toggleType(el) !== null ||
      isSelectedOption(el)
    );
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

  // Pass one: labels of eligible checkboxes and radios.
  const labelOf = new Map<number, IndexedElement>();
  const consumed = new Set<number>();
  for (const el of elements) {
    if (toggleType(el) === null || !eligible(el)) continue;
    const wrapping = index.ancestors(el).find((a) => a.tag === "label");
    const label = wrapping ?? nextSibling.get(el.order);
    if (!label || label.tag !== "label" || hidden[label.order]) continue;
    labelOf.set(el.order, label);
    consumed.add(label.order);
  }

  // Requirements 6.1 to 6.3: a role container whose captured descendants
  // cover its text is not sent.
  const isCoveredContainer = (el: IndexedElement): boolean => {
    if (el.role === "" || el.path === null) return false;
    const length = fullText[el.order].length;
    if (length === 0) return false;
    let covered = 0;
    for (const d of index.subtree(el.path)) {
      if (!index.isAncestor(el, d) || hidden[d.order]) continue;
      covered += fullText[d.order].length;
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
        ? fullText[label.order]
        : ""
      : fullText[el.order];
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
    const candidate: PreparedCandidate = {
      elementIds: label ? [el.id, label.id] : [el.id],
      order: el.order,
      tag: el.tag,
      role: el.role,
      place: placeOf(draft),
      text: texts[i].text,
      cut: texts[i].cut,
      rawText: el.text,
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
  return { candidates, index };
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
