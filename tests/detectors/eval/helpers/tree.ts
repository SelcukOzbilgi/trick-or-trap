import type { CSSProperties } from "react";
import {
  BROWSER_VIEWPORT,
  MAX_ATTRS_PER_ELEMENT,
  MAX_ATTR_CHARS,
  MAX_ATTR_NAME_CHARS,
  MAX_ELEMENTS,
  MAX_ROLE_CHARS,
  MAX_STYLE_CHARS,
  MAX_TAG_CHARS,
  MAX_TEXT_CHARS,
  SCREENSHOT_MAX_HEIGHT_PX,
} from "@/lib/capture/constants";
import { isOutsideImages } from "@/lib/capture/geometry";
import type { ImageBox } from "@/lib/capture/geometry";
import { PageSnapshotSchema } from "@/lib/types";
import type { BoundingBox, ElementSnapshot, PageSnapshot } from "@/lib/types";

/**
 * Hand-authored page trees and the snapshot builder of the evaluation harness.
 *
 * `buildSnapshot` applies the rules of `lib/capture/extractor.ts` (`collectInPage`
 * and `buildSample`) to a tree of nodes instead of a live page: which nodes are
 * eligible, how text is read and cut, which attributes are kept, how ids are formed.
 * Computed styles and boxes are not measured. Styles are converted from CSS values
 * (hex colour to `rgb()`, number to `px`); boxes are estimated or given by the
 * author. See design section 13 for what the harness cannot prove.
 */

/** Style values of a node. Only the keys read below matter; others are ignored. */
export type NodeStyle = CSSProperties;

/** One element of a page tree. `text` is the element's own text. */
export type PageNode = {
  /** Name used by the entry map. Never enters the snapshot. */
  key?: string;
  tag: string;
  role?: string;
  /** Own text nodes of the element. */
  text?: string;
  /** Attributes as in the markup. The builder applies the capture's allow-list. */
  attrs?: Readonly<Record<string, string>>;
  style?: NodeStyle;
  /** Explicit box in document px; replaces the estimate. */
  box?: { x?: number; y?: number; width: number; height: number };
  /** The `checked` DOM property. Only an `input` reports it. */
  checked?: boolean;
  /** The `selected` DOM property of an `option`. */
  selected?: boolean;
  children?: readonly PageNode[];
};

export type BuildOptions = { capturedAt: string; url: string };

export type BuiltSnapshot = {
  snapshot: PageSnapshot;
  /** Node key to synthetic id, also for nodes the capture would leave out. Not part of the snapshot. */
  keyToId: ReadonlyMap<string, string>;
};

const SKIP_TAGS: ReadonlySet<string> = new Set(["script", "style", "noscript", "template", "head"]);
const CONTROL_TAGS: ReadonlySet<string> = new Set(["input", "select", "textarea", "button"]);
const INLINE_TAGS: ReadonlySet<string> = new Set([
  "a", "abbr", "b", "code", "em", "i", "label", "mark", "small", "span", "strong", "sub", "sup", "time", "u",
]);
const VALUE_INPUT_TYPES: readonly string[] = ["checkbox", "radio", "submit", "button", "reset"];
const FULL_ATTRIBUTES: ReadonlySet<string> = new Set([
  "disabled", "type", "name", "href", "for", "placeholder", "value",
]);
const ARIA_NAME = /^aria-[a-z0-9_-]+$/;

const DEFAULT_FONT_PX = 16;
const LINE_HEIGHT = 1.25;
const CHAR_WIDTH = 0.55;

// ── Style conversion ───────────────────────────────────────────────────────

function hex2(value: string): number {
  return Number.parseInt(value, 16);
}

function formatAlpha(alpha: number): string {
  return String(Math.round(alpha * 100) / 100);
}

/** `#rgb`, `#rrggbb` and `#rrggbbaa` become `rgb()` or `rgba()`; `transparent` becomes `rgba(0, 0, 0, 0)`. Anything else is kept. */
function toComputedColour(value: string): string {
  const text = value.trim();
  if (text.toLowerCase() === "transparent") return "rgba(0, 0, 0, 0)";
  if (!/^#[0-9a-fA-F]+$/.test(text)) return text;
  let digits = text.slice(1);
  if (digits.length === 3 || digits.length === 4) {
    digits = digits
      .split("")
      .map((c) => c + c)
      .join("");
  }
  if (digits.length !== 6 && digits.length !== 8) return text;
  const r = hex2(digits.slice(0, 2));
  const g = hex2(digits.slice(2, 4));
  const b = hex2(digits.slice(4, 6));
  if (digits.length === 6) return `rgb(${r}, ${g}, ${b})`;
  const alpha = hex2(digits.slice(6, 8)) / 255;
  return alpha >= 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${formatAlpha(alpha)})`;
}

/** A length in px from a number, `"12px"`, `"0"` or `"1.5rem"`; other values (percentages, `auto`) give `null`. */
function toPx(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const text = value.trim().toLowerCase();
  if (text === "0") return 0;
  const unit = text.endsWith("px") ? "px" : text.endsWith("rem") ? "rem" : "";
  if (unit === "") return null;
  const n = Number(text.slice(0, text.length - unit.length));
  if (!Number.isFinite(n)) return null;
  return unit === "rem" ? n * DEFAULT_FONT_PX : n;
}

function formatPx(n: number): string {
  return `${Math.round(n * 100) / 100}px`;
}

type Sides = { top: number; right: number; bottom: number; left: number };

/** CSS padding shorthand of one to four lengths. Unreadable values count as 0. */
function toPadding(value: unknown): Sides {
  const none: Sides = { top: 0, right: 0, bottom: 0, left: 0 };
  if (typeof value === "number") return Number.isFinite(value) ? { top: value, right: value, bottom: value, left: value } : none;
  if (typeof value !== "string") return none;
  const parts = value
    .trim()
    .split(/\s+/)
    .map((part) => toPx(part) ?? 0);
  const [a = 0, b = a, c = a, d = b] = parts;
  if (parts.length === 1) return { top: a, right: a, bottom: a, left: a };
  if (parts.length === 2) return { top: a, right: b, bottom: a, left: b };
  if (parts.length === 3) return { top: a, right: b, bottom: c, left: b };
  return { top: a, right: b, bottom: c, left: d };
}

/** Width of a `border` shorthand such as `"2px solid #fff"`; a number or `0` is a width of 0. */
function toBorderWidth(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? Math.max(0, value) : 0;
  if (typeof value !== "string") return 0;
  const first = value.trim().split(/\s+/)[0] ?? "";
  return Math.max(0, toPx(first) ?? 0);
}

function cutStyle(value: string): string {
  return value.length > MAX_STYLE_CHARS ? value.slice(0, MAX_STYLE_CHARS) : value;
}

function styleString(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

type Inherited = {
  color: string;
  fontSize: string;
  fontPx: number;
  visibility: string;
};

const ROOT_INHERITED: Inherited = {
  color: "rgb(0, 0, 0)",
  fontSize: formatPx(DEFAULT_FONT_PX),
  fontPx: DEFAULT_FONT_PX,
  visibility: "visible",
};

type Computed = Inherited & {
  backgroundColor: string;
  opacity: string;
  display: string;
  position: string;
};

/** Computed strings of a node. Color, font size and visibility inherit; the rest does not. */
function computeStyle(node: PageNode, tag: string, parent: Inherited): Computed {
  const style = (node.style ?? {}) as Record<string, unknown>;

  const colour = styleString(style.color);
  const background = styleString(style.backgroundColor);
  const opacity = styleString(style.opacity);
  const display = styleString(style.display);
  const visibility = styleString(style.visibility);
  const position = styleString(style.position);

  const sizePx = toPx(style.fontSize);
  const ownSize = sizePx !== null && sizePx > 0;
  const fontPx = ownSize ? sizePx : parent.fontPx;
  const fontSize = ownSize ? formatPx(sizePx) : parent.fontSize;

  return {
    color: colour !== null ? cutStyle(toComputedColour(colour)) : parent.color,
    backgroundColor: background !== null ? cutStyle(toComputedColour(background)) : "rgba(0, 0, 0, 0)",
    fontSize,
    fontPx,
    opacity: opacity !== null ? cutStyle(opacity) : "1",
    display: display !== null ? cutStyle(display) : defaultDisplay(tag),
    visibility: visibility !== null ? cutStyle(visibility) : parent.visibility,
    position: position !== null ? cutStyle(position) : "static",
  };
}

function defaultDisplay(tag: string): string {
  if (CONTROL_TAGS.has(tag)) return "inline-block";
  return INLINE_TAGS.has(tag) ? "inline" : "block";
}

// ── Text ───────────────────────────────────────────────────────────────────

function collapse(text: string): string {
  return text.split(/\s+/).filter((part) => part !== "").join(" ");
}

/** Whether the author hid this node from layout and reading by its own style. */
function hiddenByStyle(node: PageNode): boolean {
  const style = (node.style ?? {}) as Record<string, unknown>;
  return style.display === "none" || style.visibility === "hidden";
}

/** Own text, then the rendered text of the children (`innerText`, with collapsed whitespace). */
function innerText(node: PageNode): string {
  const parts: string[] = [];
  if (typeof node.text === "string") parts.push(node.text);
  for (const child of node.children ?? []) {
    const childTag = child.tag.toLowerCase();
    if (SKIP_TAGS.has(childTag) || childTag === "input" || hiddenByStyle(child)) continue;
    parts.push(innerText(child));
  }
  return collapse(parts.join(" "));
}

// ── Attributes ─────────────────────────────────────────────────────────────

/**
 * The capture's full-sample allow-list: `disabled`, `type`, `name`, `href`, `for`,
 * `placeholder`, `value` (with the capture's tag rule) and `aria-*`. A `data-*`
 * attribute is passed through on purpose, so that `assertNoTestHooks` can see it if
 * an author writes one. Names are lower-cased, values cut, at most 32 are kept.
 */
function buildAttributes(node: PageNode, tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  const source = node.attrs ?? {};
  const inputType = (source.type ?? "").toLowerCase();
  let count = 0;
  for (const rawName of Object.keys(source)) {
    if (count >= MAX_ATTRS_PER_ELEMENT) break;
    if (rawName.length > MAX_ATTR_NAME_CHARS) continue;
    const name = rawName.toLowerCase();
    const value = source[rawName];
    if (typeof value !== "string") continue;
    const allowed = FULL_ATTRIBUTES.has(name) || ARIA_NAME.test(name) || name.startsWith("data-");
    if (!allowed) continue;
    if (
      name === "value" &&
      !(tag === "button" || tag === "option" || (tag === "input" && VALUE_INPUT_TYPES.includes(inputType)))
    ) {
      continue;
    }
    out[name] = value.length > MAX_ATTR_CHARS ? value.slice(0, MAX_ATTR_CHARS) : value;
    count++;
  }
  return out;
}

// ── Boxes ──────────────────────────────────────────────────────────────────

function round2(n: number): number {
  return Math.round(n * 100) / 100 + 0; // "+ 0" turns -0 into 0
}

/**
 * Estimates a box: text width is `characters × font size × 0.55` plus padding and
 * border, height is `1.25 × font size` plus padding and border, both raised to
 * `minWidth` and `minHeight` and replaced by an explicit `width` or `height` in px.
 * Text wider than the layout width wraps. Checkboxes and radios are 13 × 13.
 */
function estimateBox(node: PageNode, tag: string, text: string, fontPx: number): { width: number; height: number } {
  const style = (node.style ?? {}) as Record<string, unknown>;
  const type = (node.attrs?.type ?? "").toLowerCase();
  const pad = toPadding(style.padding);
  const border = 2 * toBorderWidth(style.border);
  const extraX = pad.left + pad.right + border;
  const extraY = pad.top + pad.bottom + border;

  let width: number;
  let height: number;
  if (tag === "input" && (type === "checkbox" || type === "radio")) {
    width = 13;
    height = 13;
  } else if (tag === "input" || tag === "select" || tag === "textarea") {
    width = 160 + extraX;
    height = LINE_HEIGHT * fontPx + extraY;
  } else {
    // An element without text (a link around an image) is one em wide.
    const textWidth = text === "" ? fontPx : text.length * fontPx * CHAR_WIDTH;
    width = textWidth + extraX;
    height = LINE_HEIGHT * fontPx + extraY;
    if (width > BROWSER_VIEWPORT.width) {
      const lines = Math.ceil(width / BROWSER_VIEWPORT.width);
      width = BROWSER_VIEWPORT.width;
      height = lines * LINE_HEIGHT * fontPx + extraY;
    }
  }
  width = Math.max(width, toPx(style.minWidth) ?? 0);
  height = Math.max(height, toPx(style.minHeight) ?? 0);
  const explicitWidth = toPx(style.width);
  const explicitHeight = toPx(style.height);
  if (explicitWidth !== null) width = explicitWidth;
  if (explicitHeight !== null) height = explicitHeight;
  return { width: Math.max(0, round2(width)), height: Math.max(0, round2(height)) };
}

// ── The walk ───────────────────────────────────────────────────────────────

type Walk = {
  elements: ElementSnapshot[];
  eligible: number;
  keyToId: Map<string, string>;
  cursorY: number;
  bottom: number;
};

function visit(node: PageNode, path: readonly number[], parent: Inherited, hiddenAbove: boolean, walk: Walk): void {
  const tag = node.tag.toLowerCase();
  const id = `el-${path.join("-")}`;
  if (node.key !== undefined) {
    if (walk.keyToId.has(node.key)) throw new Error(`Duplicate node key "${node.key}" in the page tree.`);
    walk.keyToId.set(node.key, id);
  }
  if (SKIP_TAGS.has(tag)) return;

  const computed = computeStyle(node, tag, parent);
  const hiddenHere = hiddenAbove || computed.display === "none";

  // Eligibility, as in `collectInPage`. An unselected option has no box in a closed select.
  const isOption = tag === "option";
  const isControl = isOption ? node.selected === true : CONTROL_TAGS.has(tag);
  const roleAttr = typeof node.role === "string" ? node.role : null;
  const readsInnerText =
    isControl ||
    (tag === "a" && node.attrs?.href !== undefined) ||
    tag === "label" ||
    tag === "summary" ||
    roleAttr !== null;
  const ownText = typeof node.text === "string" ? collapse(node.text) : "";
  let eligible = readsInnerText || ownText !== "";
  if (isOption && !isControl) eligible = false;

  if (eligible) {
    let text = "";
    if (tag === "input") text = "";
    else if (readsInnerText) text = innerText(node);
    else text = ownText;

    let box: BoundingBox;
    if (hiddenHere) {
      box = { x: 0, y: 0, width: 0, height: 0 };
    } else if (node.box !== undefined) {
      box = {
        x: round2(node.box.x ?? 0),
        y: round2(node.box.y ?? walk.cursorY),
        width: Math.max(0, round2(node.box.width)),
        height: Math.max(0, round2(node.box.height)),
      };
    } else {
      const size = estimateBox(node, tag, text, computed.fontPx);
      box = { x: 0, y: round2(walk.cursorY), ...size };
    }

    // Non-controls without width or height are not collected.
    if (isControl || (box.width > 0 && box.height > 0)) {
      walk.eligible++;
      if (!hiddenHere) {
        walk.cursorY = box.y + box.height;
        walk.bottom = Math.max(walk.bottom, box.y + box.height);
      }
      if (walk.elements.length < MAX_ELEMENTS) {
        const cut = text.length > MAX_TEXT_CHARS;
        const element: ElementSnapshot = {
          id,
          tag: tag.length > MAX_TAG_CHARS ? tag.slice(0, MAX_TAG_CHARS) : tag,
          boundingBox: box,
          color: computed.color,
          backgroundColor: computed.backgroundColor,
          fontSize: computed.fontSize,
          opacity: computed.opacity,
          display: computed.display,
          visibility: computed.visibility,
          position: computed.position,
          checked: tag === "input" && node.checked === true,
          selected: isOption && node.selected === true,
          attributes: buildAttributes(node, tag),
        };
        if (roleAttr !== null && roleAttr !== "") {
          element.role = roleAttr.length > MAX_ROLE_CHARS ? roleAttr.slice(0, MAX_ROLE_CHARS) : roleAttr;
        }
        const shown = cut ? text.slice(0, MAX_TEXT_CHARS) : text;
        if (shown !== "") element.text = shown;
        if (cut) element.textTruncated = true;
        walk.elements.push(element);
      }
    }
  }

  const children = node.children ?? [];
  for (let i = 0; i < children.length; i++) {
    visit(children[i], [...path, i], computed, hiddenHere, walk);
  }
}

/**
 * Builds a `PageSnapshot` from a page tree. `root` is the `<body>` node: it is placed
 * under `<html>` after an empty `<head>`, so the body is `el-1` and children get
 * child-index ids below it. The result is validated with `PageSnapshotSchema`.
 */
export function buildSnapshot(root: PageNode, options: BuildOptions): BuiltSnapshot {
  const walk: Walk = { elements: [], eligible: 0, keyToId: new Map(), cursorY: 0, bottom: 0 };
  const html: PageNode = { tag: "html", children: [{ tag: "head" }, root] };
  visit(html, [], ROOT_INHERITED, false, walk);

  const fullWidth = BROWSER_VIEWPORT.width;
  const fullHeight = Math.max(BROWSER_VIEWPORT.height, Math.ceil(walk.bottom));
  const image: ImageBox = {
    offsetY: 0,
    width: fullWidth,
    height: Math.min(fullHeight, SCREENSHOT_MAX_HEIGHT_PX),
  };
  for (const element of walk.elements) {
    element.outsideImage = isOutsideImages(element.boundingBox, [image]);
  }

  const snapshot = PageSnapshotSchema.parse({
    url: options.url,
    capturedAt: options.capturedAt,
    viewportWidth: BROWSER_VIEWPORT.width,
    viewportHeight: BROWSER_VIEWPORT.height,
    fullWidth,
    fullHeight,
    elements: walk.elements,
    capture: {
      devicePixelRatio: 1,
      layoutWidth: fullWidth,
      scrollX: 0,
      scrollY: 0,
      eligibleElementCount: walk.eligible,
      elementsTruncated: walk.eligible > MAX_ELEMENTS,
      light: false,
      images: {
        mode: "single",
        truncated: fullHeight > SCREENSHOT_MAX_HEIGHT_PX,
        items: [{ offsetY: image.offsetY, width: image.width, height: image.height }],
      },
    },
  });
  return { snapshot, keyToId: walk.keyToId };
}
