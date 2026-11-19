import {
  ACCEPT_WORDS,
  CLOSE_GLYPHS,
  CLOSE_WORDS,
  LESSER_WORDS,
  PLAIN_DECLINES,
  REJECT_WORDS,
} from "@/lib/detectors/data/choice-words";
import {
  GROUP_MAX_LEVELS,
  MAX_CHOICE_GROUPS,
  MAX_CONTROLS_PER_GROUP,
} from "@/lib/detectors/shared/constants";
import type { ElementIndex, IndexedElement } from "@/lib/detectors/shared/elements";
import {
  compilePhrases,
  findPhrases,
  normaliseText,
  tokenise,
} from "@/lib/detectors/shared/text";
import type { PhraseMatcher, Token, WordList } from "@/lib/detectors/shared/text";

/**
 * Choice groups: buttons, links and role-button elements that sit together,
 * and the wording class of one control. Used by confirmshaming and by
 * visual-interference (requirements 11.1, 13.1, 15.5).
 *
 * A group is the tightest container (at most `GROUP_MAX_LEVELS` levels above
 * a control) that holds at least two controls that do not contain each other.
 * Every control is in at most one group. The work is bounded: only the first
 * `MAX_CHOICE_GROUPS * MAX_CONTROLS_PER_GROUP` controls are looked at, at most
 * `MAX_CHOICE_GROUPS` groups are returned and each holds at most
 * `MAX_CONTROLS_PER_GROUP` controls.
 */

export type ControlKind =
  | "accept"
  | "reject"
  | "lesser"
  | "close"
  | "plain-decline"
  | "other";

export type ChoiceGroup = {
  /** Integer path of the container that holds the controls. */
  readonly path: readonly number[];
  /** The controls in document order, at most `MAX_CONTROLS_PER_GROUP`. */
  readonly controls: readonly IndexedElement[];
};

// ---------------------------------------------------------------------------
// Word lists, compiled once at module load (frozen, never changed afterwards)
// ---------------------------------------------------------------------------

const ACCEPT = compilePhrases(ACCEPT_WORDS);
const REJECT = compilePhrases(REJECT_WORDS);
const LESSER = compilePhrases(LESSER_WORDS);

/** The words of a token list joined by one space; punctuation and symbols are left out. */
function wordsKey(tokens: readonly Token[]): string {
  const parts: string[] = [];
  for (const token of tokens) {
    if (token.kind !== "symbol") parts.push(token.norm);
  }
  return parts.join(" ");
}

/** Whole-text keys of a list: each entry normalised and stripped of punctuation. */
function keysOf(list: WordList): ReadonlySet<string> {
  const keys = new Set<string>();
  for (const language of ["en", "tr"] as const) {
    for (const entry of list[language]) {
      const key = wordsKey(tokenise(entry, 200));
      if (key !== "") keys.add(key);
    }
  }
  return keys;
}

const PLAIN_KEYS: ReadonlySet<string> = keysOf(PLAIN_DECLINES);
const CLOSE_KEYS: ReadonlySet<string> = keysOf(CLOSE_WORDS);
const GLYPH_KEYS: ReadonlySet<string> = new Set(
  CLOSE_GLYPHS.map((glyph) => normaliseText(glyph))
);

// ---------------------------------------------------------------------------
// Which elements are choice controls
// ---------------------------------------------------------------------------

/**
 * True for a visible `button`, a link, an `input` of type `submit` or
 * `button`, or an element with role `button` or `link`. An element with any
 * other role (a switch, a tab, a menu item) is not a choice control.
 */
export function isChoiceControl(el: IndexedElement): boolean {
  if (el.hidden) return false;
  if (el.role === "button" || el.role === "link") return true;
  if (el.role !== "") return false;
  if (el.tag === "button" || el.tag === "a") return true;
  if (el.tag === "input") {
    const type = (el.attr("type") ?? "").trim().toLowerCase();
    return type === "submit" || type === "button";
  }
  return false;
}

// ---------------------------------------------------------------------------
// Classing one control
// ---------------------------------------------------------------------------

/** True when one of the matcher's entries starts at the first token. */
function startsWithEntry(tokens: readonly Token[], matcher: PhraseMatcher): boolean {
  return findPhrases(tokens, matcher).some((hit) => hit.start === 0);
}

/**
 * The wording class of a control. Order of checks: close (a glyph as text, or
 * an `aria-label` of the close list), plain decline (the whole text without
 * punctuation), then the first words of the text: reject, lesser, accept. When
 * the control has no text its `aria-label` stands in for it.
 */
export function classifyControl(el: IndexedElement): ControlKind {
  const label = el.attr("aria-label");
  if (GLYPH_KEYS.has(normaliseText(el.text))) return "close";
  if (label !== undefined && CLOSE_KEYS.has(wordsKey(tokenise(label)))) {
    return "close";
  }

  const tokens = el.tokens.length > 0 ? el.tokens : tokenise(label ?? "");
  const key = wordsKey(tokens);
  if (key === "") return "other";
  if (PLAIN_KEYS.has(key)) return "plain-decline";

  let first = 0;
  while (first < tokens.length && tokens[first].kind === "symbol") first += 1;
  const words = tokens.slice(first);
  if (startsWithEntry(words, REJECT)) return "reject";
  if (startsWithEntry(words, LESSER)) return "lesser";
  if (startsWithEntry(words, ACCEPT)) return "accept";
  return "other";
}

// ---------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------

type Candidate = {
  readonly el: IndexedElement;
  readonly path: readonly number[];
};

const MAX_CANDIDATES = MAX_CHOICE_GROUPS * MAX_CONTROLS_PER_GROUP;

function startsWith(path: readonly number[], prefix: readonly number[]): boolean {
  if (prefix.length > path.length) return false;
  for (let i = 0; i < prefix.length; i += 1) {
    if (path[i] !== prefix[i]) return false;
  }
  return true;
}

/** True when the path lies below the container by one to `GROUP_MAX_LEVELS` levels. */
function belowContainer(path: readonly number[], container: readonly number[]): boolean {
  const levels = path.length - container.length;
  return levels >= 1 && levels <= GROUP_MAX_LEVELS && startsWith(path, container);
}

/** One path contains the other (a control inside a control). */
function nested(a: readonly number[], b: readonly number[]): boolean {
  return startsWith(a, b) || startsWith(b, a);
}

function comparePaths(a: readonly number[], b: readonly number[]): number {
  const shared = Math.min(a.length, b.length);
  for (let i = 0; i < shared; i += 1) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return a.length - b.length;
}

/**
 * Build the choice groups of one sample. Level by level (the container one,
 * two, then three levels above), each control that is not yet in a group looks
 * for the other free controls below that container; two or more that do not
 * contain each other form a group. A tighter container therefore always wins
 * over a wider one, and a stray control stays alone.
 */
export function findChoiceGroups(index: ElementIndex): readonly ChoiceGroup[] {
  const candidates: Candidate[] = [];
  for (const el of index.elements) {
    if (candidates.length >= MAX_CANDIDATES) break;
    if (el.path === null || !isChoiceControl(el)) continue;
    candidates.push({ el, path: el.path });
  }

  const used = new Set<Candidate>();
  const found = new Map<string, { path: readonly number[]; members: Candidate[] }>();

  for (let level = 1; level <= GROUP_MAX_LEVELS; level += 1) {
    for (const candidate of candidates) {
      if (used.has(candidate) || candidate.path.length < level) continue;
      const container = candidate.path.slice(0, candidate.path.length - level);
      const key = container.join("-");
      if (found.has(key)) continue;

      const members: Candidate[] = [];
      let partner = false;
      for (const other of candidates) {
        if (used.has(other) || !belowContainer(other.path, container)) continue;
        members.push(other);
        if (other !== candidate && !nested(other.path, candidate.path)) partner = true;
      }
      if (!partner) continue;

      found.set(key, { path: container, members });
      for (const member of members) used.add(member);
    }
  }

  const groups = [...found.values()].sort((a, b) => comparePaths(a.path, b.path));
  return Object.freeze(
    groups.slice(0, MAX_CHOICE_GROUPS).map((group) =>
      Object.freeze({
        path: Object.freeze([...group.path]),
        controls: Object.freeze(
          group.members.slice(0, MAX_CONTROLS_PER_GROUP).map((member) => member.el)
        ),
      })
    )
  );
}
