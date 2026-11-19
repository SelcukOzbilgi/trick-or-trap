import {
  MAX_GAP_SECONDS,
  MIN_GAP_SECONDS,
  RELOAD_TEXT_CAP,
} from "@/lib/detectors/shared/constants";
import { buildIndex } from "@/lib/detectors/shared/elements";
import type { ElementIndex, IndexedElement } from "@/lib/detectors/shared/elements";
import { isIsoUtcText } from "@/lib/detectors/shared/patterns";
import { maskDigits, normaliseText } from "@/lib/detectors/shared/text";

/**
 * The first sample and the optional reload sample of a snapshot, plus the
 * reload gap and the rule that pairs an element with its reload counterpart.
 * Only text and state are compared, never positions or sizes. `secondSample`
 * is never read.
 */

export type SamplePair = {
  readonly first: ElementIndex;
  /** The light sample read after a reload; null when there is none or it is unusable. */
  readonly reload: ElementIndex | null;
  /** Reload time minus first time in seconds; null when unusable (requirement 7.10). */
  readonly gapSeconds: number | null;
};

/** Longest `capturedAt` text looked at; the strict form is at most 30 characters. */
const MAX_TIME_TEXT = 40;

/** Length of `YYYY-MM-DDTHH:MM:SS`, the part that must survive a round trip. */
const DATE_TIME_PREFIX = 19;

/**
 * Epoch milliseconds of a `capturedAt` value that matches the strict
 * `YYYY-MM-DDTHH:MM:SS(.fraction)Z` form and names a real date; otherwise
 * null. A date that would roll over (30 February) or an hour of 24 is not real.
 */
export function parseCapturedAt(value: unknown): number | null {
  if (typeof value !== "string" || value.length > MAX_TIME_TEXT) return null;
  if (!isIsoUtcText(value)) return null;
  const ms = new Date(value).getTime();
  if (!Number.isFinite(ms)) return null;
  const roundTrip = new Date(ms).toISOString().slice(0, DATE_TIME_PREFIX);
  return roundTrip === value.slice(0, DATE_TIME_PREFIX) ? ms : null;
}

/** Property read. A non-object gives undefined; a read that throws propagates (requirement 6.4). */
function readProp(source: unknown, key: string): unknown {
  if (typeof source !== "object" || source === null) return undefined;
  return (source as Record<string, unknown>)[key];
}

function isUsableSample(value: unknown): boolean {
  return Array.isArray(readProp(value, "elements"));
}

/**
 * Index the first sample and, when `afterReload` is a sample with an
 * `elements` array, the reload sample (with the light budget and text cap).
 */
export function buildSamplePair(snapshot: unknown): SamplePair {
  const first = buildIndex(snapshot, false);
  const afterReload = readProp(snapshot, "afterReload");
  if (!isUsableSample(afterReload)) {
    return Object.freeze({ first, reload: null, gapSeconds: null });
  }
  const reload = buildIndex(afterReload, true);

  const firstMs = parseCapturedAt(readProp(snapshot, "capturedAt"));
  const reloadMs = parseCapturedAt(readProp(afterReload, "capturedAt"));
  let gapSeconds: number | null = null;
  if (firstMs !== null && reloadMs !== null) {
    const gap = (reloadMs - firstMs) / 1000;
    if (gap >= MIN_GAP_SECONDS && gap <= MAX_GAP_SECONDS) gapSeconds = gap;
  }
  return Object.freeze({ first, reload, gapSeconds });
}

/**
 * Shapes are pure functions of frozen elements, so they are cached per element
 * object (a weak cache: it only saves repeated work and never changes a result).
 */
const SHAPE_CACHE = new WeakMap<IndexedElement, string>();

/** Digit-masked, normalised text over the first `RELOAD_TEXT_CAP` characters (requirement 7.11). */
function shapeOf(el: IndexedElement): string {
  const cached = SHAPE_CACHE.get(el);
  if (cached !== undefined) return cached;
  const shape = maskDigits(normaliseText(el.text, RELOAD_TEXT_CAP));
  SHAPE_CACHE.set(el, shape);
  return shape;
}

function sameKey(path: readonly number[] | null): string | null {
  return path === null ? null : path.join("-");
}

function parentKey(el: IndexedElement): string | null {
  return el.path === null || el.path.length === 0
    ? null
    : sameKey(el.path.slice(0, -1));
}

/**
 * The reload element that stands for `el`, in the order of requirement 7.7:
 * 1. the element with the same synthetic id whose text passes `sameTemplate`;
 * 2. the element with the same digit-masked text shape and the same parent;
 * 3. the only element of the sample with that shape.
 * Hidden reload elements are never used. When several elements fit step 2,
 * the first in document order is taken. Null when nothing fits.
 */
export function findCounterpart(
  pair: SamplePair,
  el: IndexedElement,
  sameTemplate: (candidate: IndexedElement) => boolean
): IndexedElement | null {
  const reload = pair.reload;
  if (reload === null) return null;

  const sameId = reload.byId(el.id);
  if (sameId !== undefined && !sameId.hidden && sameTemplate(sameId)) {
    return sameId;
  }

  const shape = shapeOf(el);
  if (shape === "") return null;

  const parent = parentKey(el);
  const matches: IndexedElement[] = [];
  let sameParent: IndexedElement | null = null;
  for (const candidate of reload.elements) {
    if (candidate.hidden || shapeOf(candidate) !== shape) continue;
    matches.push(candidate);
    if (
      sameParent === null &&
      parent !== null &&
      parentKey(candidate) === parent
    ) {
      sameParent = candidate;
    }
  }
  if (sameParent !== null) return sameParent;
  return matches.length === 1 ? matches[0] : null;
}
