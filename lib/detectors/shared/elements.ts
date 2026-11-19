import type { BoundingBox } from "@/lib/types";
import {
  HIDDEN_OPACITY_MAX,
  MAX_ATTR_READ,
  MAX_ELEMENTS_CONSIDERED,
  MAX_ID_CHARS,
  MAX_ID_DEPTH,
  MAX_RELOAD_ELEMENTS_CONSIDERED,
  MAX_ROLE_TAG_READ,
  MAX_STYLE_READ,
  MAX_TEXT_READ,
  RELOAD_TEXT_CAP,
} from "@/lib/detectors/shared/constants";
import { isPxText } from "@/lib/detectors/shared/patterns";
import { tokenise } from "@/lib/detectors/shared/text";
import type { Token } from "@/lib/detectors/shared/text";

/**
 * Safe, bounded view of one snapshot sample. Every field of a page is
 * untrusted: it is cut to its cap before any other work and given a default
 * when it has the wrong type. A value that can be read never makes this code
 * throw; a read that itself throws (a hostile getter or proxy trap) is not
 * caught here, and the registry reports it (requirement 6.4).
 * Ids are parsed into integer paths so that ancestry compares integers, not
 * string prefixes ("el-1-1" is not an ancestor of "el-1-10").
 */

/** The only attribute names a detector may read (requirement 6.1). */
export type AttrKey =
  | "type"
  | "name"
  | "disabled"
  | "aria-checked"
  | "aria-label"
  | "aria-modal"
  | "aria-live";

export type IndexedElement = {
  /** Document position after sorting. */
  readonly order: number;
  readonly id: string;
  /** Integer path of the synthetic id; null when the id is not of the form `el-` plus integers. */
  readonly path: readonly number[] | null;
  readonly tag: string;
  readonly role: string;
  readonly text: string;
  readonly tokens: readonly Token[];
  readonly textTruncated: boolean;
  /** The box, or the zero box when it held an invalid number. */
  readonly box: BoundingBox;
  readonly area: number;
  readonly color: string;
  readonly backgroundColor: string;
  readonly fontSizePx: number | null;
  readonly opacity: number;
  readonly display: string;
  readonly visibility: string;
  readonly position: string;
  readonly checked: boolean;
  readonly outsideImage: boolean;
  /** Hidden by its own style or box, or by a hidden ancestor in the sample. */
  readonly hidden: boolean;
  readonly isControl: boolean;
  /** Reads one allow-listed attribute by key; any other name gives undefined. */
  attr(name: AttrKey): string | undefined;
};

export type ElementIndex = {
  /** Document order. */
  readonly elements: readonly IndexedElement[];
  /** True when the sample held more elements than the budget allows. */
  readonly budgetHit: boolean;
  /** True when `capture.elementsTruncated` is true. */
  readonly captureTruncated: boolean;
  byId(id: string): IndexedElement | undefined;
  /** Ancestors present in `elements`, nearest first, at most `maxLevels` levels up by path. */
  ancestors(el: IndexedElement, maxLevels?: number): readonly IndexedElement[];
  /** Elements whose path starts with `path` (the element at `path` itself included), in document order. */
  subtree(path: readonly number[]): readonly IndexedElement[];
  isAncestor(a: IndexedElement, b: IndexedElement): boolean;
  /** Longest common prefix of the two paths; null when either path is null. */
  commonPath(a: IndexedElement, b: IndexedElement): readonly number[] | null;
};

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

const ATTR_KEYS: ReadonlySet<string> = new Set([
  "type",
  "name",
  "disabled",
  "aria-checked",
  "aria-label",
  "aria-modal",
  "aria-live",
]);

const CONTROL_TAGS: ReadonlySet<string> = new Set([
  "input",
  "select",
  "textarea",
  "button",
  "option",
]);

const ZERO_BOX: BoundingBox = Object.freeze({ x: 0, y: 0, width: 0, height: 0 });

/** Longest digit run accepted in one id segment, so that parsed integers stay exact. */
const MAX_ID_SEGMENT_DIGITS = 9;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Property read. A value that is not an object gives undefined. A read that
 * itself throws (a hostile getter or proxy trap) is not odd input: the
 * exception propagates and `runDetectors` reports it (requirement 6.4).
 */
function readProp(source: unknown, key: string): unknown {
  if (!isRecord(source)) return undefined;
  return source[key];
}

/** Cut to at most `cap` UTF-16 units without leaving half of a surrogate pair. */
function cut(text: string, cap: number): string {
  if (text.length <= cap) return text;
  let end = cap;
  if (end > 0) {
    const last = text.charCodeAt(end - 1);
    if (last >= 0xd800 && last <= 0xdbff) end -= 1;
  }
  return text.slice(0, end);
}

function readCut(source: unknown, key: string, cap: number): string {
  const value = readProp(source, key);
  return typeof value === "string" ? cut(value, cap) : "";
}

function readLowerCut(source: unknown, key: string, cap: number): string {
  return readCut(source, key, cap).trim().toLowerCase();
}

function readFlag(source: unknown, key: string): boolean {
  return readProp(source, key) === true;
}

// ---------------------------------------------------------------------------
// Ids and paths
// ---------------------------------------------------------------------------

/**
 * `el-` followed by zero to MAX_ID_DEPTH non-negative integers joined by `-`,
 * in at most MAX_ID_CHARS characters (measured on the original id). Anything
 * else gives null.
 */
function parseId(id: string, originalLength: number): readonly number[] | null {
  if (originalLength > MAX_ID_CHARS) return null;
  if (!id.startsWith("el-")) return null;
  const rest = id.slice(3);
  if (rest === "") return Object.freeze([]);
  const parts = rest.split("-");
  if (parts.length > MAX_ID_DEPTH) return null;
  const path: number[] = [];
  for (const part of parts) {
    if (part.length === 0 || part.length > MAX_ID_SEGMENT_DIGITS) return null;
    for (const ch of part) {
      if (ch < "0" || ch > "9") return null;
    }
    path.push(Number(part));
  }
  return Object.freeze(path);
}

function comparePaths(a: readonly number[], b: readonly number[]): number {
  const shared = Math.min(a.length, b.length);
  for (let i = 0; i < shared; i += 1) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return a.length - b.length;
}

function startsWith(path: readonly number[], prefix: readonly number[]): boolean {
  if (prefix.length > path.length) return false;
  for (let i = 0; i < prefix.length; i += 1) {
    if (path[i] !== prefix[i]) return false;
  }
  return true;
}

function pathKey(path: readonly number[]): string {
  return path.join("-");
}

// ---------------------------------------------------------------------------
// Field readers
// ---------------------------------------------------------------------------

function readBox(raw: unknown): BoundingBox {
  const x = readProp(raw, "x");
  const y = readProp(raw, "y");
  const width = readProp(raw, "width");
  const height = readProp(raw, "height");
  if (
    typeof x !== "number" ||
    typeof y !== "number" ||
    typeof width !== "number" ||
    typeof height !== "number" ||
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width < 0 ||
    height < 0 ||
    !Number.isFinite(width * height)
  ) {
    return ZERO_BOX;
  }
  return Object.freeze({ x, y, width, height });
}

function readOpacity(raw: unknown): number {
  if (typeof raw !== "string") return 1;
  const text = cut(raw, MAX_STYLE_READ).trim();
  if (text === "") return 1;
  const value = Number(text);
  if (!Number.isFinite(value)) return 1;
  return Math.min(1, Math.max(0, value));
}

function readFontSizePx(raw: unknown): number | null {
  if (typeof raw !== "string") return null;
  const text = cut(raw, MAX_STYLE_READ).trim();
  if (!isPxText(text)) return null;
  const value = Number.parseFloat(text);
  return Number.isFinite(value) ? value : null;
}

function makeAttrReader(attributes: unknown): (name: AttrKey) => string | undefined {
  return (name: AttrKey): string | undefined => {
    if (typeof name !== "string" || !ATTR_KEYS.has(name)) return undefined;
    if (!isRecord(attributes)) return undefined;
    if (!Object.hasOwn(attributes, name)) return undefined;
    const value = attributes[name];
    return typeof value === "string" ? cut(value, MAX_ATTR_READ) : undefined;
  };
}

type Draft = {
  readonly index: number;
  readonly id: string;
  readonly path: readonly number[] | null;
  readonly tag: string;
  readonly role: string;
  readonly text: string;
  readonly tokens: readonly Token[];
  readonly textTruncated: boolean;
  readonly box: BoundingBox;
  readonly area: number;
  readonly color: string;
  readonly backgroundColor: string;
  readonly fontSizePx: number | null;
  readonly opacity: number;
  readonly display: string;
  readonly visibility: string;
  readonly position: string;
  readonly checked: boolean;
  readonly outsideImage: boolean;
  readonly isControl: boolean;
  readonly ownHidden: boolean;
  readonly attr: (name: AttrKey) => string | undefined;
};

function readDraft(raw: unknown, index: number, textCap: number): Draft {
  const rawId = readProp(raw, "id");
  const originalLength = typeof rawId === "string" ? rawId.length : 0;
  const id = typeof rawId === "string" ? cut(rawId, MAX_ID_CHARS) : "";
  const path = parseId(id, originalLength);

  const tag = readLowerCut(raw, "tag", MAX_ROLE_TAG_READ);
  const role = readLowerCut(raw, "role", MAX_ROLE_TAG_READ);
  const text = readCut(raw, "text", textCap);
  const box = readBox(readProp(raw, "boundingBox"));
  const area = box.width * box.height;
  const opacity = readOpacity(readProp(raw, "opacity"));
  const display = readLowerCut(raw, "display", MAX_STYLE_READ);
  const visibility = readLowerCut(raw, "visibility", MAX_STYLE_READ);
  const isControl = CONTROL_TAGS.has(tag);

  const ownHidden =
    display === "none" ||
    visibility === "hidden" ||
    visibility === "collapse" ||
    opacity <= HIDDEN_OPACITY_MAX ||
    (!isControl && (box.width === 0 || box.height === 0));

  return {
    index,
    id,
    path,
    tag,
    role,
    text,
    tokens: tokenise(text, textCap),
    textTruncated: readFlag(raw, "textTruncated"),
    box,
    area,
    color: readCut(raw, "color", MAX_STYLE_READ),
    backgroundColor: readCut(raw, "backgroundColor", MAX_STYLE_READ),
    fontSizePx: readFontSizePx(readProp(raw, "fontSize")),
    opacity,
    display,
    visibility,
    position: readLowerCut(raw, "position", MAX_STYLE_READ),
    checked: readFlag(raw, "checked"),
    outsideImage: readFlag(raw, "outsideImage"),
    isControl,
    ownHidden,
    attr: makeAttrReader(readProp(raw, "attributes")),
  };
}

function compareDrafts(a: Draft, b: Draft): number {
  if (a.path !== null && b.path !== null) {
    return comparePaths(a.path, b.path) || a.index - b.index;
  }
  if (a.path !== null) return -1;
  if (b.path !== null) return 1;
  return a.index - b.index;
}

// ---------------------------------------------------------------------------
// The index
// ---------------------------------------------------------------------------

function emptyIndex(captureTruncated: boolean, budgetHit: boolean): ElementIndex {
  return makeIndex([], budgetHit, captureTruncated);
}

function makeIndex(
  elements: readonly IndexedElement[],
  budgetHit: boolean,
  captureTruncated: boolean
): ElementIndex {
  const byIdMap = new Map<string, IndexedElement>();
  const byPath = new Map<string, IndexedElement>();
  for (const el of elements) {
    if (!byIdMap.has(el.id)) byIdMap.set(el.id, el);
    if (el.path !== null) {
      const key = pathKey(el.path);
      if (!byPath.has(key)) byPath.set(key, el);
    }
  }

  const ancestors = (
    el: IndexedElement,
    maxLevels: number = MAX_ID_DEPTH
  ): readonly IndexedElement[] => {
    if (el.path === null) return [];
    const found: IndexedElement[] = [];
    const lowest = Math.max(0, el.path.length - Math.max(0, maxLevels));
    for (let length = el.path.length - 1; length >= lowest; length -= 1) {
      const candidate = byPath.get(pathKey(el.path.slice(0, length)));
      if (candidate) found.push(candidate);
    }
    return found;
  };

  const subtree = (path: readonly number[]): readonly IndexedElement[] => {
    const found: IndexedElement[] = [];
    let started = false;
    for (const el of elements) {
      if (el.path === null) break; // elements with an invalid id come last
      if (startsWith(el.path, path)) {
        started = true;
        found.push(el);
      } else if (started) {
        break; // a pre-order subtree is contiguous
      }
    }
    return found;
  };

  const isAncestor = (a: IndexedElement, b: IndexedElement): boolean =>
    a.path !== null &&
    b.path !== null &&
    a.path.length < b.path.length &&
    startsWith(b.path, a.path);

  const commonPath = (
    a: IndexedElement,
    b: IndexedElement
  ): readonly number[] | null => {
    if (a.path === null || b.path === null) return null;
    const shared = Math.min(a.path.length, b.path.length);
    let length = 0;
    while (length < shared && a.path[length] === b.path[length]) length += 1;
    return a.path.slice(0, length);
  };

  return Object.freeze({
    elements: Object.freeze([...elements]),
    budgetHit,
    captureTruncated,
    byId: (id: string): IndexedElement | undefined => byIdMap.get(id),
    ancestors,
    subtree,
    isAncestor,
    commonPath,
  });
}

/**
 * Build the index of one sample. `light` is true for the reload sample: it
 * has the smaller element budget and the reload text cap. A value that is not
 * a sample, or has no `elements` array, gives an empty index.
 */
export function buildIndex(sample: unknown, light: boolean): ElementIndex {
  const capture = readProp(sample, "capture");
  const captureTruncated = readProp(capture, "elementsTruncated") === true;
  const list = readProp(sample, "elements");
  if (!Array.isArray(list)) return emptyIndex(captureTruncated, false);

  const budget = light ? MAX_RELOAD_ELEMENTS_CONSIDERED : MAX_ELEMENTS_CONSIDERED;
  const textCap = light ? RELOAD_TEXT_CAP : MAX_TEXT_READ;
  const budgetHit = list.length > budget;

  const drafts: Draft[] = [];
  const limit = Math.min(list.length, budget);
  for (let i = 0; i < limit; i += 1) {
    const entry: unknown = list[i];
    if (!isRecord(entry) || Array.isArray(entry)) continue;
    drafts.push(readDraft(entry, i, textCap));
  }
  drafts.sort(compareDrafts);

  // A hidden element hides everything below it, also across missing middle elements.
  const ownHiddenByPath = new Map<string, boolean>();
  for (const draft of drafts) {
    if (draft.path === null) continue;
    const key = pathKey(draft.path);
    if (!ownHiddenByPath.has(key)) ownHiddenByPath.set(key, draft.ownHidden);
  }

  const elements: IndexedElement[] = drafts.map((draft, order) => {
    let hidden = draft.ownHidden;
    if (!hidden && draft.path !== null) {
      for (let length = draft.path.length - 1; length >= 0; length -= 1) {
        if (ownHiddenByPath.get(pathKey(draft.path.slice(0, length))) === true) {
          hidden = true;
          break;
        }
      }
    }
    return Object.freeze({
      order,
      id: draft.id,
      path: draft.path,
      tag: draft.tag,
      role: draft.role,
      text: draft.text,
      tokens: draft.tokens,
      textTruncated: draft.textTruncated,
      box: draft.box,
      area: draft.area,
      color: draft.color,
      backgroundColor: draft.backgroundColor,
      fontSizePx: draft.fontSizePx,
      opacity: draft.opacity,
      display: draft.display,
      visibility: draft.visibility,
      position: draft.position,
      checked: draft.checked,
      outsideImage: draft.outsideImage,
      hidden,
      isControl: draft.isControl,
      attr: draft.attr,
    });
  });

  return makeIndex(elements, budgetHit, captureTruncated);
}
