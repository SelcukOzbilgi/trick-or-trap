/**
 * Element collection. `collectInPage` runs inside the page and returns raw data.
 * `buildSample` runs outside the page, never trusts that data and turns it into a
 * `BaseSnapshot`.
 *
 * Page text and attributes are untrusted input. They are length-capped here, never
 * evaluated, and never used to build selectors, URLs or shell input.
 */
import type { BaseSnapshot, ElementSnapshot } from "@/lib/types";
import { MAX_ELEMENTS, MAX_ELEMENTS_LIGHT, MAX_TEXT_CHARS, MAX_TEXT_CHARS_LIGHT, MAX_ATTR_CHARS } from "./constants";
import { isOutsideImages, toDocumentBox, type ImageBox, type ScreenshotMode } from "./geometry";
import type { CollectOptions, RawElement, RawPageRead } from "./types";

/**
 * Runs in the page's main world, serialised by Playwright. It must stay
 * self-contained: no imports, no closures over module scope, no named inner
 * functions (a build step may wrap those in helpers that do not exist in the page),
 * and plain ES2017 syntax. One call reads every element and the page metrics.
 */
export function collectInPage(options: CollectOptions): RawPageRead {
  const full = options.attributeNames === "full";
  const names: readonly string[] = full
    ? ["disabled", "data-testid", "type", "name", "href", "for", "placeholder", "value"]
    : (options.attributeNames as readonly string[]);
  const valueTypes = ["checkbox", "radio", "submit", "button", "reset"];
  const skipTags = ["script", "style", "noscript", "template", "head"];
  const controlTags = ["input", "select", "textarea", "button"];

  const elements: RawElement[] = [];
  let eligibleCount = 0;
  const stack: { el: Element; path: number[] }[] = [{ el: document.documentElement, path: [] }];

  while (stack.length > 0) {
    const item = stack.pop() as { el: Element; path: number[] };
    const el = item.el;
    const tag = el.tagName.toLowerCase();
    if (skipTags.indexOf(tag) >= 0) continue;

    const children = el.children;
    for (let i = children.length - 1; i >= 0; i--) {
      stack.push({ el: children[i], path: item.path.concat([i]) });
    }

    // Eligibility.
    let isControl = controlTags.indexOf(tag) >= 0;
    let eligible = isControl;
    let visibleText = isControl;
    if (tag === "option") {
      isControl = (el as HTMLOptionElement).selected === true;
      eligible = isControl;
      visibleText = isControl;
    } else if (!eligible) {
      if (
        (tag === "a" && el.hasAttribute("href")) ||
        tag === "label" ||
        tag === "summary" ||
        el.hasAttribute("role")
      ) {
        eligible = true;
        visibleText = true;
      }
    }
    let ownText = "";
    if (!eligible) {
      for (let i = 0; i < el.childNodes.length; i++) {
        const node = el.childNodes[i];
        if (node.nodeType === 3) {
          const value = node.nodeValue || "";
          if (value.trim() !== "") {
            eligible = true;
            ownText += " " + value;
          }
        }
      }
    }
    if (!eligible) continue;

    const rect = el.getBoundingClientRect();
    if (!isControl && (rect.width <= 0 || rect.height <= 0)) continue;

    eligibleCount++;
    if (elements.length >= options.maxElements) continue;

    // Text.
    let rawText = ownText;
    if (visibleText) {
      const inner = (el as HTMLElement).innerText;
      rawText = typeof inner === "string" ? inner : el.textContent || "";
    }
    const collapsed = rawText.replace(/\s+/g, " ").trim();
    const cut = collapsed.length > options.maxTextChars;

    // Attributes.
    const attrs: Record<string, string> = {};
    const inputType = (el.getAttribute("type") || "").toLowerCase();
    for (let i = 0; i < el.attributes.length; i++) {
      const attr = el.attributes[i];
      const name = attr.name.toLowerCase();
      if (!(names.indexOf(name) >= 0 || (full && name.indexOf("aria-") === 0))) continue;
      if (
        name === "value" &&
        !(tag === "button" || tag === "option" || (tag === "input" && valueTypes.indexOf(inputType) >= 0))
      ) {
        continue;
      }
      attrs[name] = attr.value.length > options.maxAttrChars ? attr.value.slice(0, options.maxAttrChars) : attr.value;
    }

    const style = getComputedStyle(el);
    elements.push({
      path: item.path,
      tag,
      role: el.getAttribute("role"),
      text: cut ? collapsed.slice(0, options.maxTextChars) : collapsed,
      textTruncated: cut,
      rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
      style: {
        color: style.color,
        backgroundColor: style.backgroundColor,
        fontSize: style.fontSize,
        opacity: style.opacity,
        display: style.display,
        visibility: style.visibility,
        position: style.position,
      },
      checked: (el as HTMLInputElement).checked === true,
      selected: (el as HTMLOptionElement).selected === true,
      attrs,
    });
  }

  const root = document.documentElement;
  return {
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    devicePixelRatio: window.devicePixelRatio,
    scrollX: window.scrollX,
    scrollY: window.scrollY,
    scrollWidth: root.scrollWidth,
    scrollHeight: root.scrollHeight,
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

const FULL_ATTRIBUTES: readonly string[] = [
  "disabled",
  "data-testid",
  "type",
  "name",
  "href",
  "for",
  "placeholder",
  "value",
];
const LIGHT_ATTRIBUTES: readonly string[] = ["type", "name", "disabled", "data-testid"];
const VALUE_INPUT_TYPES: readonly string[] = ["checkbox", "radio", "submit", "button", "reset"];
const ARIA_NAME = /^aria-[a-z0-9_-]+$/;

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

function isValidElement(value: unknown): value is RawElement {
  if (!isRecord(value)) return false;
  const path = value.path;
  if (!Array.isArray(path) || !path.every((n) => Number.isInteger(n) && n >= 0)) return false;
  return typeof value.tag === "string" && isRecord(value.rect);
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
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
  for (const key of Object.keys(raw)) {
    const name = key.toLowerCase();
    const value = raw[key];
    if (typeof value !== "string") continue;
    if (!(allowed.includes(name) || (allowAria && ARIA_NAME.test(name)))) continue;
    if (name === "value" && !(tag === "button" || tag === "option" || (tag === "input" && VALUE_INPUT_TYPES.includes(type)))) {
      continue;
    }
    out[name] = value.length > MAX_ATTR_CHARS ? value.slice(0, MAX_ATTR_CHARS) : value;
  }
  return out;
}

/**
 * Turns a raw page read into a `BaseSnapshot`. The raw data is not trusted: malformed
 * elements are dropped, caps and the attribute allowlist are applied again, numbers
 * are made finite and rounded, and boxes are converted to document CSS px.
 */
export function buildSample(raw: RawPageRead, params: BuildSampleParams): BaseSnapshot {
  const elementCap = params.light ? MAX_ELEMENTS_LIGHT : MAX_ELEMENTS;
  const textCap = params.light ? MAX_TEXT_CHARS_LIGHT : MAX_TEXT_CHARS;
  const allowedAttributes = params.light ? LIGHT_ATTRIBUTES : FULL_ATTRIBUTES;
  const scroll = { x: round2(raw.scrollX), y: round2(raw.scrollY) };
  const images = params.images;
  const imageBoxes: ImageBox[] = images ? images.items.map((i) => ({ ...i })) : [];

  const rawElements: unknown[] = Array.isArray(raw.elements) ? raw.elements : [];
  const elements: ElementSnapshot[] = [];
  for (const item of rawElements) {
    if (elements.length >= elementCap) break;
    if (!isValidElement(item)) continue;

    const style: Record<string, unknown> = isRecord(item.style) ? item.style : {};
    const collapsed = str(item.text).replace(/\s+/g, " ").trim();
    const cut = collapsed.length > textCap;
    const text = cut ? collapsed.slice(0, textCap) : collapsed;
    const boundingBox = toDocumentBox(
      {
        left: item.rect.left,
        top: item.rect.top,
        width: item.rect.width,
        height: item.rect.height,
      },
      scroll
    );

    const element: ElementSnapshot = {
      id: `el-${item.path.join("-")}`,
      tag: item.tag,
      boundingBox,
      color: str(style.color),
      backgroundColor: str(style.backgroundColor),
      fontSize: str(style.fontSize),
      opacity: str(style.opacity),
      display: str(style.display),
      visibility: str(style.visibility),
      position: str(style.position),
      checked: item.checked === true,
      selected: item.selected === true,
      attributes: cleanAttributes(item.attrs, item.tag, allowedAttributes, !params.light),
    };
    if (typeof item.role === "string" && item.role !== "") element.role = item.role;
    if (text !== "") element.text = text;
    if (cut || item.textTruncated === true) element.textTruncated = true;
    if (images) element.outsideImage = isOutsideImages(boundingBox, imageBoxes);
    elements.push(element);
  }

  const reportedEligible = Math.max(0, Math.floor(round2(raw.eligibleCount)));
  const eligibleElementCount = Math.max(reportedEligible, elements.length);
  const elementsTruncated = reportedEligible > elementCap || reportedEligible > rawElements.length;

  const capture: NonNullable<BaseSnapshot["capture"]> = {
    devicePixelRatio: round2(raw.devicePixelRatio),
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
    viewportWidth: size(raw.innerWidth),
    viewportHeight: size(raw.innerHeight),
    fullWidth: size(raw.scrollWidth),
    fullHeight: size(raw.scrollHeight),
    elements,
    capture,
  };
}
