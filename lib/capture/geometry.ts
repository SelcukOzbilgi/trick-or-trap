/**
 * Pure maths of the page capture: document boxes, screenshot mode choice, the
 * single-image plan, tile planning, the outside-image test and base64 sizes.
 * No browser, no clock, no I/O.
 */
import type { BoundingBox } from "@/lib/types";
import { MAX_BASE64_LENGTH, MAX_TILES, SCREENSHOT_MAX_HEIGHT_PX, TILE_MODE_THRESHOLD_PX } from "./constants";
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

/** Single mode up to `TILE_MODE_THRESHOLD_PX` device px, tiled mode above. */
export function chooseMode(page: { fullHeight: number; devicePixelRatio: number }): ScreenshotMode {
  return page.fullHeight * page.devicePixelRatio <= TILE_MODE_THRESHOLD_PX ? "single" : "tiled";
}

/** Plan of the one clipped image of single mode. */
export function planSingle(page: { fullHeight: number; viewportWidth: number }): ImageBox & { truncated: boolean } {
  const fullHeight = Number.isFinite(page.fullHeight) ? page.fullHeight : 0;
  const viewportWidth = Number.isFinite(page.viewportWidth) ? page.viewportWidth : 0;
  return {
    offsetY: 0,
    width: Math.max(1, Math.ceil(viewportWidth)),
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

/** True when no image covers any part of the box. */
export function isOutsideImages(box: BoundingBox, images: readonly ImageBox[]): boolean {
  return !images.some(
    (image) => box.y < image.offsetY + image.height && box.y + box.height >= image.offsetY && box.x < image.width
  );
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
