/**
 * Pure maths of the page capture: document boxes, screenshot mode choice, the
 * single-image plan, tile planning, the outside-image test and base64 sizes.
 * No browser, no clock, no I/O.
 */
import type { BoundingBox, ElementSnapshot } from "@/lib/types";
import {
  BROWSER_VIEWPORT,
  MAX_BASE64_LENGTH,
  MAX_PLAUSIBLE_DPR,
  MAX_PLAUSIBLE_PX,
  MAX_TILES,
  SCREENSHOT_MAX_HEIGHT_PX,
  TILE_MODE_THRESHOLD_CSS_PX,
} from "./constants";
import type { RawElement } from "./types";

/** Position and size of one image in document CSS px. */
export type ImageBox = { offsetY: number; width: number; height: number };
export type ScreenshotMode = "single" | "tiled";

/** Replaces a non-finite value with 0. */
function finite(value: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** Replaces a non-finite value with 0 and rounds to two decimals. */
function clean(value: number): number {
  return Math.round(finite(value) * 100) / 100 + 0; // "+ 0" turns -0 into 0
}

/** Like `clean`, and a negative size becomes 0. */
function cleanSize(value: number): number {
  return Math.max(0, clean(value));
}

/** Converts a viewport-relative rectangle to a box in document CSS px. */
export function toDocumentBox(rect: RawElement["rect"], scroll: { x: number; y: number }): BoundingBox {
  return {
    x: clean(finite(rect.left) + finite(scroll.x)),
    y: clean(finite(rect.top) + finite(scroll.y)),
    width: cleanSize(rect.width),
    height: cleanSize(rect.height),
  };
}

/** Page metrics that are safe to compute with. Made by `sanitiseMetrics`. */
export type PageMetrics = {
  innerWidth: number;
  innerHeight: number;
  scrollX: number;
  scrollY: number;
  scrollWidth: number;
  scrollHeight: number;
  layoutWidth: number;
  devicePixelRatio: number;
};

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** A size: finite, above 0 and at most `MAX_PLAUSIBLE_PX`, else `fallback`. */
function plausibleSize(value: unknown, fallback: number): number {
  return isNumber(value) && value > 0 && value <= MAX_PLAUSIBLE_PX ? value : fallback;
}

/** A document size: finite and above 0, clamped to `MAX_PLAUSIBLE_PX`, else `fallback`. */
function plausibleContent(value: unknown, fallback: number): number {
  return isNumber(value) && value > 0 ? Math.min(value, MAX_PLAUSIBLE_PX) : fallback;
}

/** A scroll offset: finite and not negative, clamped to `MAX_PLAUSIBLE_PX`, else 0. */
function plausibleOffset(value: unknown): number {
  return isNumber(value) && value >= 0 ? Math.min(value, MAX_PLAUSIBLE_PX) : 0;
}

/**
 * Makes page metrics safe to compute with, whatever the page reported. A viewport
 * size or layout width that is not finite, not positive or above `MAX_PLAUSIBLE_PX`
 * becomes the `BROWSER_VIEWPORT` value. A document size that is not finite or not
 * positive becomes the `BROWSER_VIEWPORT` value, and one above the limit is clamped.
 * A scroll offset that is not finite or is negative becomes 0. A pixel ratio outside
 * `(0, MAX_PLAUSIBLE_DPR]` becomes 1. An absent `layoutWidth` means `innerWidth`.
 * Never throws and never returns a value that would fail the snapshot schema.
 */
export function sanitiseMetrics(raw: Partial<Record<keyof PageMetrics, unknown>>): PageMetrics {
  const source: Partial<Record<keyof PageMetrics, unknown>> = typeof raw === "object" && raw !== null ? raw : {};
  const layoutSource = source.layoutWidth === undefined ? source.innerWidth : source.layoutWidth;
  const ratio = source.devicePixelRatio;
  return {
    innerWidth: plausibleSize(source.innerWidth, BROWSER_VIEWPORT.width),
    innerHeight: plausibleSize(source.innerHeight, BROWSER_VIEWPORT.height),
    scrollX: plausibleOffset(source.scrollX),
    scrollY: plausibleOffset(source.scrollY),
    scrollWidth: plausibleContent(source.scrollWidth, BROWSER_VIEWPORT.width),
    scrollHeight: plausibleContent(source.scrollHeight, BROWSER_VIEWPORT.height),
    layoutWidth: plausibleSize(layoutSource, BROWSER_VIEWPORT.width),
    devicePixelRatio: isNumber(ratio) && ratio > 0 && ratio <= MAX_PLAUSIBLE_DPR ? ratio : 1,
  };
}

/** Single mode up to `TILE_MODE_THRESHOLD_CSS_PX` CSS px, tiled mode above. */
export function chooseMode(page: { fullHeight: number }): ScreenshotMode {
  return page.fullHeight <= TILE_MODE_THRESHOLD_CSS_PX ? "single" : "tiled";
}

/**
 * Plan of the one clipped image of single mode. The width is the layout width, rounded
 * up and clamped to `BROWSER_VIEWPORT.width`.
 */
export function planSingle(page: { fullHeight: number; layoutWidth: number }): ImageBox & { truncated: boolean } {
  const fullHeight = Number.isFinite(page.fullHeight) ? page.fullHeight : 0;
  const layoutWidth = Number.isFinite(page.layoutWidth) ? page.layoutWidth : 0;
  return {
    offsetY: 0,
    width: Math.min(BROWSER_VIEWPORT.width, Math.max(1, Math.ceil(layoutWidth))),
    height: Math.max(1, Math.ceil(Math.min(fullHeight, SCREENSHOT_MAX_HEIGHT_PX))),
    truncated: fullHeight > SCREENSHOT_MAX_HEIGHT_PX,
  };
}

/** Scroll position requested for tile `index`. */
export function tileTarget(index: number, viewportHeight: number): number {
  return index * viewportHeight;
}

/** Number of tiles needed to cover the document, capped at `MAX_TILES`. */
export function tileCount(fullHeight: number, viewportHeight: number): number {
  if (!(viewportHeight > 0) || !(fullHeight > 0)) return 1;
  return Math.max(1, Math.min(MAX_TILES, Math.ceil(fullHeight / viewportHeight)));
}

/** True when the image reaches the bottom of the document, within one pixel. */
export function reachesBottom(last: { offsetY: number; height: number }, fullHeight: number): boolean {
  return last.offsetY + last.height >= fullHeight - 1;
}

/**
 * True when a span overlaps `[low, high)` on one axis. A span with a size above 0
 * overlaps when `start + size > low && start < high`, so one that only touches an edge
 * does not. A span of size 0 is a point and is inside when `start >= low && start < high`.
 */
function overlapsAxis(start: number, size: number, low: number, high: number): boolean {
  if (size > 0) return start + size > low && start < high;
  return start >= low && start < high;
}

/** True when no image covers any part of the box. */
export function isOutsideImages(box: BoundingBox, images: readonly ImageBox[]): boolean {
  return !images.some(
    (image) =>
      overlapsAxis(box.x, box.width, 0, image.width) &&
      overlapsAxis(box.y, box.height, image.offsetY, image.offsetY + image.height)
  );
}

/**
 * Largest absolute difference in `x`, `y`, `width` and `height` over the elements that
 * have the same id in both lists. An id that is in one list only is ignored. Returns 0
 * when no id is shared.
 */
export function maxBoxDrift(a: readonly ElementSnapshot[], b: readonly ElementSnapshot[]): number {
  const boxes = new Map<string, BoundingBox>();
  for (const element of a) boxes.set(element.id, element.boundingBox);
  let drift = 0;
  for (const element of b) {
    const before = boxes.get(element.id);
    if (before === undefined) continue;
    const after = element.boundingBox;
    drift = Math.max(
      drift,
      Math.abs(after.x - before.x),
      Math.abs(after.y - before.y),
      Math.abs(after.width - before.width),
      Math.abs(after.height - before.height)
    );
  }
  return drift;
}

/** Length of the base64 text of `byteLength` bytes, without encoding anything. */
export function base64Length(byteLength: number): number {
  return 4 * Math.ceil(byteLength / 3);
}

/** True when the sum of the base64 lengths of all images is within the limit. */
export function totalFits(byteLengths: readonly number[]): boolean {
  let total = 0;
  for (const byteLength of byteLengths) total += base64Length(byteLength);
  return total <= MAX_BASE64_LENGTH;
}
