import { MAX_STYLE_READ } from "@/lib/detectors/shared/constants";
import type { ElementIndex, IndexedElement } from "@/lib/detectors/shared/elements";

/**
 * Colour reading and contrast (requirements 7.13, 7.14).
 *
 * `parseColour` reads the computed-style forms a browser reports (`rgb()`,
 * `rgba()` in comma and space syntax, `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`,
 * `transparent`) with character loops only: no regular expression, and a
 * value longer than `MAX_STYLE_READ` characters is rejected before any work.
 * The background of an element is resolved from the element and its nearest
 * ancestors in the sample; when no opaque layer is found, white is assumed and
 * the result says so.
 */

export type Rgba = {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  /** Alpha from 0 (transparent) to 1 (opaque). */
  readonly a: number;
};

const WHITE: Rgba = Object.freeze({ r: 255, g: 255, b: 255, a: 1 });
const OPAQUE_ALPHA = 0.999;

/** Own background plus ancestors that are looked at, in total. */
const MAX_BACKGROUND_LAYERS = 8;

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/** A plain decimal number: optional sign, digits and at most one dot. No exponent. */
function parseNumber(text: string): number | null {
  let start = 0;
  let sign = 1;
  if (text[0] === "-" || text[0] === "+") {
    if (text[0] === "-") sign = -1;
    start = 1;
  }
  let digits = 0;
  let dots = 0;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (ch >= "0" && ch <= "9") digits += 1;
    else if (ch === ".") dots += 1;
    else return null;
  }
  if (digits === 0 || dots > 1) return null;
  const value = Number(text.slice(start));
  return Number.isFinite(value) ? sign * value : null;
}

/** A channel (0 to 255, or a percentage) or an alpha (0 to 1, or a percentage). */
function parseComponent(token: string, alpha: boolean): number | null {
  if (token.endsWith("%")) {
    const percent = parseNumber(token.slice(0, -1));
    if (percent === null) return null;
    return alpha ? clamp(percent / 100, 0, 1) : clamp((percent * 255) / 100, 0, 255);
  }
  const value = parseNumber(token);
  if (value === null) return null;
  return alpha ? clamp(value, 0, 1) : clamp(value, 0, 255);
}

/** Split on spaces, tabs, line breaks, commas and slashes. */
function splitParts(inner: string): string[] {
  const parts: string[] = [];
  let current = "";
  for (const ch of inner) {
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch === "," || ch === "/") {
      if (current !== "") parts.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  if (current !== "") parts.push(current);
  return parts;
}

function hexValue(text: string): number | null {
  for (const ch of text) {
    const ok = (ch >= "0" && ch <= "9") || (ch >= "a" && ch <= "f");
    if (!ok) return null;
  }
  return Number.parseInt(text, 16);
}

function parseHex(digits: string): Rgba | null {
  let parts: string[];
  if (digits.length === 3 || digits.length === 4) {
    parts = [...digits].map((ch) => ch + ch);
  } else if (digits.length === 6 || digits.length === 8) {
    parts = [];
    for (let i = 0; i < digits.length; i += 2) parts.push(digits.slice(i, i + 2));
  } else {
    return null;
  }
  const values = parts.map(hexValue);
  if (values.some((v) => v === null)) return null;
  const [r, g, b, alpha] = values as number[];
  return { r, g, b, a: alpha === undefined ? 1 : alpha / 255 };
}

function parseRgbFunction(inner: string): Rgba | null {
  const parts = splitParts(inner);
  if (parts.length !== 3 && parts.length !== 4) return null;
  const r = parseComponent(parts[0], false);
  const g = parseComponent(parts[1], false);
  const b = parseComponent(parts[2], false);
  const a = parts.length === 4 ? parseComponent(parts[3], true) : 1;
  if (r === null || g === null || b === null || a === null) return null;
  return { r, g, b, a };
}

/** Read a computed colour. Anything that is not a supported form gives null. */
export function parseColour(value: unknown): Rgba | null {
  if (typeof value !== "string" || value.length > MAX_STYLE_READ) return null;
  const text = value.trim().toLowerCase();
  if (text === "") return null;
  if (text === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
  if (text[0] === "#") return parseHex(text.slice(1));
  if (text.endsWith(")")) {
    if (text.startsWith("rgba(")) return parseRgbFunction(text.slice(5, -1));
    if (text.startsWith("rgb(")) return parseRgbFunction(text.slice(4, -1));
  }
  return null;
}

// ---------------------------------------------------------------------------
// Compositing and contrast
// ---------------------------------------------------------------------------

/** `top` painted over `bottom` (standard "over" operator). */
export function composite(top: Rgba, bottom: Rgba): Rgba {
  if (top.a <= 0) return { r: bottom.r, g: bottom.g, b: bottom.b, a: bottom.a };
  const a = top.a + bottom.a * (1 - top.a);
  if (a <= 0) return { r: 0, g: 0, b: 0, a: 0 };
  const mix = (t: number, b: number): number =>
    (t * top.a + b * bottom.a * (1 - top.a)) / a;
  return { r: mix(top.r, bottom.r), g: mix(top.g, bottom.g), b: mix(top.b, bottom.b), a };
}

function linear(channel: number): number {
  const s = clamp(channel, 0, 255) / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function luminance(c: Rgba): number {
  return 0.2126 * linear(c.r) + 0.7152 * linear(c.g) + 0.0722 * linear(c.b);
}

/**
 * WCAG contrast ratio of `fg` on `bg`, from 1 to 21. A translucent background is
 * composited over white and a translucent foreground over the background first.
 */
export function contrastRatio(fg: Rgba, bg: Rgba): number {
  const base = bg.a < 1 ? composite(bg, WHITE) : bg;
  const top = fg.a < 1 ? composite(fg, base) : fg;
  const a = luminance(top);
  const b = luminance(base);
  const high = Math.max(a, b);
  const low = Math.min(a, b);
  return (high + 0.05) / (low + 0.05);
}

// ---------------------------------------------------------------------------
// Backgrounds and text contrast
// ---------------------------------------------------------------------------

/**
 * The colour behind an element: its own background composited over the nearest
 * ancestors in `elements` (at most `MAX_BACKGROUND_LAYERS` layers in total)
 * until an opaque layer is reached. Without one the result is composited over
 * white and `assumed` is true (requirement 7.14). A background that does not
 * parse counts as transparent.
 */
export function effectiveBackground(
  index: ElementIndex,
  el: IndexedElement
): { colour: Rgba; assumed: boolean } {
  const layers: IndexedElement[] = [el, ...index.ancestors(el)].slice(
    0,
    MAX_BACKGROUND_LAYERS
  );
  let result: Rgba = { r: 0, g: 0, b: 0, a: 0 };
  for (const layer of layers) {
    const colour = parseColour(layer.backgroundColor);
    if (colour === null) continue;
    result = composite(result, colour);
    if (result.a >= OPAQUE_ALPHA) {
      return { colour: { r: result.r, g: result.g, b: result.b, a: 1 }, assumed: false };
    }
  }
  const flat = composite(result, WHITE);
  return { colour: { r: flat.r, g: flat.g, b: flat.b, a: 1 }, assumed: true };
}

/**
 * Contrast of an element's text on its effective background. The text colour's
 * alpha is multiplied by the element's opacity and by the opacities of its
 * ancestors in `elements`. A text colour that does not parse gives null.
 */
export function textContrast(
  index: ElementIndex,
  el: IndexedElement
): { ratio: number; assumed: boolean } | null {
  const text = parseColour(el.color);
  if (text === null) return null;
  let alpha = text.a * clamp(el.opacity, 0, 1);
  for (const ancestor of index.ancestors(el)) alpha *= clamp(ancestor.opacity, 0, 1);
  const background = effectiveBackground(index, el);
  const ratio = contrastRatio({ r: text.r, g: text.g, b: text.b, a: alpha }, background.colour);
  return { ratio, assumed: background.assumed };
}
