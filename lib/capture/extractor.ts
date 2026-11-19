/**
 * Element collection. `collectInPage` runs inside the page and returns raw data.
 * `buildSample` runs outside the page, never trusts that data and turns it into a
 * `BaseSnapshot`.
 *
 * Page text and attributes are untrusted input. They are length-capped here, never
 * evaluated, and never used to build selectors, URLs or shell input.
 */
import type { BaseSnapshot, ElementSnapshot } from "@/lib/types";
import {
  BROWSER_VIEWPORT,
  FORBIDDEN_ATTRIBUTE_FRAGMENTS,
  MAX_ATTR_CHARS,
  MAX_ATTR_NAME_CHARS,
  MAX_ATTRS_PER_ELEMENT,
  MAX_ELEMENT_ID_CHARS,
  MAX_ELEMENTS,
  MAX_ELEMENTS_LIGHT,
  MAX_PATH_DEPTH,
  MAX_PATH_INDEX,
  MAX_ROLE_CHARS,
  MAX_STYLE_CHARS,
  MAX_TAG_CHARS,
  MAX_TEXT_CHARS,
  MAX_TEXT_CHARS_LIGHT,
  RAW_SCAN_FACTOR,
} from "./constants";
import { isOutsideImages, sanitiseMetrics, toDocumentBox, type ImageBox, type ScreenshotMode } from "./geometry";
import { CaptureFailure } from "./types";
import type { CollectOptions, RawCollection, RawElement, RawPageRead } from "./types";

/** Type of a getter taken from a prototype; erased at build time. */
type Getter<This, Result> = (this: This) => Result;

/**
 * Runs inside the page, in an isolated world, serialised by CDP. It must stay
 * self-contained: no imports, no closures over module scope, no named inner functions
 * (a build step may wrap those in helpers that do not exist in the page), and plain
 * ES2017 syntax apart from `catch` without a binding. One call reads every element and
 * returns the pixel ratio. It returns no other page metric: those come from CDP.
 *
 * DOM clobbering: a `<form>` exposes its controls as named properties that shadow its
 * own members (`tagName`, `children`, `getAttribute`, ...), in every world. So the
 * collector takes every getter and method it needs from the prototypes before it reads
 * any element, and calls them with `.call`. It never reads a DOM member by name from an
 * element. A getter that throws for an element of another kind (`innerText` on an SVG
 * element, `checked` on a non-input) is caught and falls back.
 *
 * The collector applies `options.limits` to what it returns, so less data crosses the
 * wire. It cuts strings with `substring`, and reads styles inside `try`, so that a
 * page that tampers with `slice` or `getComputedStyle` cannot make it throw. The
 * outside pass (`buildSample`) never trusts the result and applies the caps again.
 */
export function collectInPage(options: CollectOptions): RawCollection {
  // Prototype members, taken first. The `.get` of a descriptor is the getter itself.
  const own = Object.getOwnPropertyDescriptor;
  const documentElementGet = (own(Document.prototype, "documentElement") as PropertyDescriptor).get as Getter<
    Document,
    Element
  >;
  const tagNameGet = (own(Element.prototype, "tagName") as PropertyDescriptor).get as Getter<Element, string>;
  const childrenGet = (own(Element.prototype, "children") as PropertyDescriptor).get as Getter<
    Element,
    HTMLCollection
  >;
  const attributesGet = (own(Element.prototype, "attributes") as PropertyDescriptor).get as Getter<
    Element,
    NamedNodeMap
  >;
  const getAttributeFn = Element.prototype.getAttribute;
  const hasAttributeFn = Element.prototype.hasAttribute;
  const getRectFn = Element.prototype.getBoundingClientRect;
  const childNodesGet = (own(Node.prototype, "childNodes") as PropertyDescriptor).get as Getter<Node, NodeList>;
  const nodeTypeGet = (own(Node.prototype, "nodeType") as PropertyDescriptor).get as Getter<Node, number>;
  const nodeValueGet = (own(Node.prototype, "nodeValue") as PropertyDescriptor).get as Getter<Node, string | null>;
  const textContentGet = (own(Node.prototype, "textContent") as PropertyDescriptor).get as Getter<
    Node,
    string | null
  >;
  // Some DOM implementations used in tests have no `innerText`; the fallback is `textContent`.
  const innerTextDescriptor = own(HTMLElement.prototype, "innerText");
  const innerTextGet = innerTextDescriptor === undefined ? undefined : (innerTextDescriptor.get as Getter<Element, unknown>);
  const checkedGet = (own(HTMLInputElement.prototype, "checked") as PropertyDescriptor).get as Getter<
    HTMLInputElement,
    boolean
  >;
  const selectedGet = (own(HTMLOptionElement.prototype, "selected") as PropertyDescriptor).get as Getter<
    HTMLOptionElement,
    boolean
  >;
  const collectionLengthGet = (own(HTMLCollection.prototype, "length") as PropertyDescriptor).get as Getter<
    HTMLCollection,
    number
  >;
  const collectionItemFn = HTMLCollection.prototype.item;
  const nodeListLengthGet = (own(NodeList.prototype, "length") as PropertyDescriptor).get as Getter<NodeList, number>;
  const nodeListItemFn = NodeList.prototype.item;
  const mapLengthGet = (own(NamedNodeMap.prototype, "length") as PropertyDescriptor).get as Getter<
    NamedNodeMap,
    number
  >;
  const mapItemFn = NamedNodeMap.prototype.item;
  const attrNameGet = (own(Attr.prototype, "name") as PropertyDescriptor).get as Getter<Attr, string>;
  const attrValueGet = (own(Attr.prototype, "value") as PropertyDescriptor).get as Getter<Attr, string>;

  const limits = options.limits;
  const full = options.attributeNames === "full";
  const names: readonly string[] = full
    ? ["disabled", "type", "name", "href", "for", "placeholder", "value"]
    : (options.attributeNames as readonly string[]);
  const valueTypes = ["checkbox", "radio", "submit", "button", "reset"];
  const skipTags = ["script", "style", "noscript", "template", "head"];
  const controlTags = ["input", "select", "textarea", "button"];
  const styleNames = ["color", "backgroundColor", "fontSize", "opacity", "display", "visibility", "position"];

  const elements: RawElement[] = [];
  let eligibleCount = 0;
  // `path` is null for an element deeper than `limits.maxPathDepth`: it is still
  // visited and counted, but no path array is built for it, and it is not collected.
  const stack: { el: Element; path: number[] | null; depth: number }[] = [
    { el: documentElementGet.call(document), path: [], depth: 0 },
  ];

  while (stack.length > 0) {
    const item = stack.pop() as { el: Element; path: number[] | null; depth: number };
    const el = item.el;
    const fullTag = tagNameGet.call(el).toLowerCase();
    if (skipTags.indexOf(fullTag) >= 0) continue;
    const tag = fullTag.length > limits.maxTagChars ? fullTag.substring(0, limits.maxTagChars) : fullTag;

    const children = childrenGet.call(el);
    const childPath = item.path !== null && item.depth < limits.maxPathDepth ? item.path : null;
    for (let i = collectionLengthGet.call(children) - 1; i >= 0; i--) {
      stack.push({
        el: collectionItemFn.call(children, i) as Element,
        path: childPath === null ? null : childPath.concat([i]),
        depth: item.depth + 1,
      });
    }

    // Form state. A getter throws for an element of another kind (an SVG element named
    // "input"), which reads as not checked and not selected.
    let checked = false;
    if (fullTag === "input") {
      try {
        checked = checkedGet.call(el as HTMLInputElement) === true;
      } catch {
        checked = false;
      }
    }
    let selected = false;
    if (tag === "option") {
      try {
        selected = selectedGet.call(el as HTMLOptionElement) === true;
      } catch {
        selected = false;
      }
    }

    // Eligibility.
    let isControl = controlTags.indexOf(tag) >= 0;
    let eligible = isControl;
    let visibleText = isControl;
    if (tag === "option") {
      isControl = selected;
      eligible = isControl;
      visibleText = isControl;
    } else if (!eligible) {
      if (
        (tag === "a" && hasAttributeFn.call(el, "href")) ||
        tag === "label" ||
        tag === "summary" ||
        hasAttributeFn.call(el, "role")
      ) {
        eligible = true;
        visibleText = true;
      }
    }
    let ownText = "";
    if (!eligible) {
      const nodes = childNodesGet.call(el);
      const nodeCount = nodeListLengthGet.call(nodes);
      for (let i = 0; i < nodeCount; i++) {
        const node = nodeListItemFn.call(nodes, i) as Node;
        if (nodeTypeGet.call(node) === 3) {
          const value = nodeValueGet.call(node) || "";
          if (value.trim() !== "") {
            eligible = true;
            ownText += " " + value;
          }
        }
      }
    }
    if (!eligible) continue;

    const rect = getRectFn.call(el);
    if (!isControl && (rect.width <= 0 || rect.height <= 0)) continue;

    eligibleCount++;
    // An element past the depth cap or the element cap is counted and not collected.
    if (item.path === null || elements.length >= options.maxElements) continue;

    // Text. `innerText` throws for an element that is not an HTML element (SVG), and is
    // missing in some DOM implementations; both fall back to `textContent`.
    let rawText = ownText;
    if (visibleText) {
      let inner: unknown;
      if (innerTextGet !== undefined) {
        try {
          inner = innerTextGet.call(el);
        } catch {
          inner = undefined;
        }
      }
      rawText = typeof inner === "string" ? inner : textContentGet.call(el) || "";
    }
    const collapsed = rawText.replace(/\s+/g, " ").trim();
    const cut = collapsed.length > options.maxTextChars;

    // Attributes: allowlist, at most `maxAttrsPerElement`, names and values cut.
    const attrs: Record<string, string> = {};
    let attrCount = 0;
    const inputType = (getAttributeFn.call(el, "type") || "").toLowerCase();
    const attributes = attributesGet.call(el);
    const attributeTotal = mapLengthGet.call(attributes);
    for (let i = 0; i < attributeTotal && attrCount < limits.maxAttrsPerElement; i++) {
      const attr = mapItemFn.call(attributes, i) as Attr;
      const attrName = attrNameGet.call(attr);
      if (attrName.length > limits.maxAttrNameChars) continue;
      const name = attrName.toLowerCase();
      if (!(names.indexOf(name) >= 0 || (full && name.indexOf("aria-") === 0))) continue;
      if (
        name === "value" &&
        !(tag === "button" || tag === "option" || (tag === "input" && valueTypes.indexOf(inputType) >= 0))
      ) {
        continue;
      }
      const attrValue = attrValueGet.call(attr);
      attrs[name] =
        attrValue.length > options.maxAttrChars ? attrValue.substring(0, options.maxAttrChars) : attrValue;
      attrCount++;
    }

    // Role and styles, cut at their caps. A style that cannot be read becomes "".
    const roleAttr = getAttributeFn.call(el, "role");
    const role =
      roleAttr !== null && roleAttr.length > limits.maxRoleChars ? roleAttr.substring(0, limits.maxRoleChars) : roleAttr;
    let style: CSSStyleDeclaration | null = null;
    try {
      style = getComputedStyle(el);
    } catch {
      style = null;
    }
    const styleOut: Record<string, string> = {};
    for (let i = 0; i < styleNames.length; i++) {
      let value = "";
      try {
        const read: unknown = style === null ? "" : (style as unknown as Record<string, unknown>)[styleNames[i]];
        value = typeof read === "string" ? read : "";
      } catch {
        value = "";
      }
      styleOut[styleNames[i]] = value.length > limits.maxStyleChars ? value.substring(0, limits.maxStyleChars) : value;
    }

    elements.push({
      path: item.path,
      tag,
      role,
      text: cut ? collapsed.substring(0, options.maxTextChars) : collapsed,
      textTruncated: cut,
      rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
      style: styleOut as RawElement["style"],
      checked,
      selected,
      attrs,
    });
  }

  return {
    devicePixelRatio: window.devicePixelRatio,
    eligibleCount,
    elements,
  };
}

// ── Post-processing (outside the page) ─────────────────────────────────────

/** Image metadata of the first sample, copied into `capture.images`. */
export type SampleImages = {
  mode: ScreenshotMode;
  truncated: boolean;
  items: readonly ImageBox[];
};

export type BuildSampleParams = {
  /** True for the lighter reload sample. */
  light: boolean;
  /** Final page URL. */
  url: string;
  /** ISO time from the injected clock. */
  capturedAt: string;
  /** Present for the first sample only. Sets `outsideImage` and `capture.images`. */
  images?: SampleImages;
};

const FULL_ATTRIBUTES: readonly string[] = ["disabled", "type", "name", "href", "for", "placeholder", "value"];
const LIGHT_ATTRIBUTES: readonly string[] = ["type", "name", "disabled"];
const VALUE_INPUT_TYPES: readonly string[] = ["checkbox", "radio", "submit", "button", "reset"];
const ARIA_NAME = /^aria-[a-z0-9_-]+$/;

/** True when an attribute name holds a fragment that names an outcome (any case). */
export function isForbiddenAttributeName(name: string): boolean {
  const lower = name.toLowerCase();
  return FORBIDDEN_ATTRIBUTE_FRAGMENTS.some((fragment) => lower.includes(fragment));
}

/** Non-finite becomes 0; rounds to two decimals. */
function round2(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100 + 0; // "+ 0" turns -0 into 0
}

function size(value: unknown): number {
  return Math.max(0, round2(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Why a raw entry was not used: its shape is wrong, or it is beyond a size bound. */
type ElementCheck = "ok" | "invalid" | "out-of-bounds";

/**
 * Checks the shape of one raw entry and its path bounds. A path deeper than
 * `MAX_PATH_DEPTH` or with an index above `MAX_PATH_INDEX` is out of bounds; the length
 * is checked before the entries, so a path of a million entries costs one comparison.
 */
function checkElement(value: unknown): ElementCheck {
  if (!isRecord(value)) return "invalid";
  const path = value.path;
  if (!Array.isArray(path)) return "invalid";
  if (path.length > MAX_PATH_DEPTH) return "out-of-bounds";
  let tooLarge = false;
  for (const n of path) {
    if (!Number.isInteger(n) || n < 0) return "invalid";
    if (n > MAX_PATH_INDEX) tooLarge = true;
  }
  if (typeof value.tag !== "string" || !isRecord(value.rect)) return "invalid";
  return tooLarge ? "out-of-bounds" : "ok";
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Cuts a string at `max` characters. */
function cut(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

function cleanAttributes(
  raw: unknown,
  tag: string,
  allowed: readonly string[],
  allowAria: boolean
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!isRecord(raw)) return out;
  const type = str(raw.type).toLowerCase();
  let count = 0;
  for (const key of Object.keys(raw)) {
    if (count >= MAX_ATTRS_PER_ELEMENT) break;
    if (key.length > MAX_ATTR_NAME_CHARS) continue;
    const name = key.toLowerCase();
    const value = raw[key];
    if (typeof value !== "string") continue;
    if (isForbiddenAttributeName(name)) continue;
    if (!(allowed.includes(name) || (allowAria && ARIA_NAME.test(name)))) continue;
    if (name === "value" && !(tag === "button" || tag === "option" || (tag === "input" && VALUE_INPUT_TYPES.includes(type)))) {
      continue;
    }
    out[name] = cut(value, MAX_ATTR_CHARS);
    count++;
  }
  return out;
}

/** Size of the JSON text of `value` in UTF-8 bytes. */
export function snapshotBytes(value: unknown): number {
  const text = JSON.stringify(value);
  return typeof text === "string" ? new TextEncoder().encode(text).length : 0;
}

/** Rounds to two decimals; a result of 0 or less becomes `fallback`. */
function positive2(value: number, fallback: number): number {
  const rounded = round2(value);
  return rounded > 0 ? rounded : fallback;
}

/**
 * Turns a raw page read into a `BaseSnapshot`. The raw data is not trusted. In order:
 * at most `RAW_SCAN_FACTOR` times the element cap of raw entries are examined; an entry
 * with a wrong shape, a path beyond the bounds or an id that is too long is dropped
 * (a bounds drop still counts as an eligible element); tag, role and the style strings
 * are cut; text is cut; attributes go through the allowlist and the name and count
 * limits. Page metrics are made plausible, numbers are rounded, and boxes are
 * converted to document CSS px.
 *
 * Throws `CaptureFailure("page-read-failed")` when `raw` is not an object or its
 * `elements` is not an array.
 */
export function buildSample(raw: RawPageRead, params: BuildSampleParams): BaseSnapshot {
  if (!isRecord(raw) || !Array.isArray(raw.elements)) throw new CaptureFailure("page-read-failed");

  const elementCap = params.light ? MAX_ELEMENTS_LIGHT : MAX_ELEMENTS;
  const textCap = params.light ? MAX_TEXT_CHARS_LIGHT : MAX_TEXT_CHARS;
  const allowedAttributes = params.light ? LIGHT_ATTRIBUTES : FULL_ATTRIBUTES;
  const metrics = sanitiseMetrics(raw);
  const scroll = { x: round2(metrics.scrollX), y: round2(metrics.scrollY) };
  const images = params.images;
  const imageBoxes: ImageBox[] = images ? images.items.map((i) => ({ ...i })) : [];

  const rawElements: unknown[] = raw.elements;
  const scanLimit = Math.min(rawElements.length, RAW_SCAN_FACTOR * elementCap);
  const elements: ElementSnapshot[] = [];
  let droppedByBounds = 0;
  for (let index = 0; index < scanLimit && elements.length < elementCap; index++) {
    const item = rawElements[index];
    const check = checkElement(item);
    if (check === "invalid") continue;
    if (check === "out-of-bounds") {
      droppedByBounds++;
      continue;
    }
    const entry = item as RawElement;
    const id = `el-${entry.path.join("-")}`;
    if (id.length > MAX_ELEMENT_ID_CHARS) {
      droppedByBounds++;
      continue;
    }

    const tag = cut(entry.tag, MAX_TAG_CHARS);
    const style: Record<string, unknown> = isRecord(entry.style) ? entry.style : {};
    const collapsed = str(entry.text).replace(/\s+/g, " ").trim();
    const textCut = collapsed.length > textCap;
    const text = cut(collapsed, textCap);
    const boundingBox = toDocumentBox(
      {
        left: entry.rect.left,
        top: entry.rect.top,
        width: entry.rect.width,
        height: entry.rect.height,
      },
      scroll
    );

    const element: ElementSnapshot = {
      id,
      tag,
      boundingBox,
      color: cut(str(style.color), MAX_STYLE_CHARS),
      backgroundColor: cut(str(style.backgroundColor), MAX_STYLE_CHARS),
      fontSize: cut(str(style.fontSize), MAX_STYLE_CHARS),
      opacity: cut(str(style.opacity), MAX_STYLE_CHARS),
      display: cut(str(style.display), MAX_STYLE_CHARS),
      visibility: cut(str(style.visibility), MAX_STYLE_CHARS),
      position: cut(str(style.position), MAX_STYLE_CHARS),
      checked: entry.checked === true,
      selected: entry.selected === true,
      attributes: cleanAttributes(entry.attrs, entry.tag, allowedAttributes, !params.light),
    };
    if (typeof entry.role === "string" && entry.role !== "") element.role = cut(entry.role, MAX_ROLE_CHARS);
    if (text !== "") element.text = text;
    if (textCut || entry.textTruncated === true) element.textTruncated = true;
    if (images) element.outsideImage = isOutsideImages(boundingBox, imageBoxes);
    elements.push(element);
  }

  const reportedEligible = Math.max(0, Math.floor(round2(raw.eligibleCount)));
  const eligibleElementCount = Math.max(reportedEligible, elements.length + droppedByBounds);
  const elementsTruncated =
    reportedEligible > elementCap || reportedEligible > rawElements.length || droppedByBounds > 0;

  const capture: NonNullable<BaseSnapshot["capture"]> = {
    devicePixelRatio: positive2(metrics.devicePixelRatio, 1),
    layoutWidth: positive2(metrics.layoutWidth, BROWSER_VIEWPORT.width),
    scrollX: scroll.x,
    scrollY: scroll.y,
    eligibleElementCount,
    elementsTruncated,
    light: params.light,
  };
  if (images) {
    capture.images = {
      mode: images.mode,
      truncated: images.truncated,
      items: imageBoxes.map((i) => ({ offsetY: i.offsetY, width: i.width, height: i.height })),
    };
  }

  return {
    url: params.url,
    capturedAt: params.capturedAt,
    viewportWidth: size(metrics.innerWidth),
    viewportHeight: size(metrics.innerHeight),
    fullWidth: size(metrics.scrollWidth),
    fullHeight: size(metrics.scrollHeight),
    elements,
    capture,
  };
}
