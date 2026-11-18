import { BROWSER_VIEWPORT, MAX_ELEMENTS_LIGHT, MAX_TEXT_CHARS_LIGHT } from "@/lib/capture/constants";
import type { BaseSnapshot, CaptureMeta, ElementSnapshot } from "@/lib/types";

/** The only attributes the capture reads in the light (reload) sample. */
const LIGHT_ATTRIBUTES: readonly string[] = ["type", "name", "disabled"];

function lightAttributes(attributes: ElementSnapshot["attributes"]): Record<string, string> {
  const out: Record<string, string> = {};
  if (attributes === undefined) return out;
  for (const name of LIGHT_ATTRIBUTES) {
    const value = attributes[name];
    if (typeof value === "string") out[name] = value;
  }
  return out;
}

function lightElement(element: ElementSnapshot): ElementSnapshot {
  const out: ElementSnapshot = { ...element, attributes: lightAttributes(element.attributes) };
  delete out.outsideImage;
  const text = element.text;
  if (text !== undefined && text.length > MAX_TEXT_CHARS_LIGHT) {
    out.text = text.slice(0, MAX_TEXT_CHARS_LIGHT);
    out.textTruncated = true;
  }
  return out;
}

/**
 * Converts a full sample into the light sample the capture reads after a reload:
 * text cut to 120 characters, at most 750 elements, only the attributes `type`,
 * `name` and `disabled`, no `outsideImage`, no `capture.images`, `capture.light` true,
 * and the given capture time. The input is not changed.
 */
export function toLightSample(sample: BaseSnapshot, capturedAt: string): BaseSnapshot {
  const source: CaptureMeta = sample.capture ?? {
    devicePixelRatio: 1,
    layoutWidth: BROWSER_VIEWPORT.width,
    scrollX: 0,
    scrollY: 0,
    eligibleElementCount: sample.elements.length,
    elementsTruncated: false,
    light: false,
  };
  const elements = sample.elements.slice(0, MAX_ELEMENTS_LIGHT).map(lightElement);
  const capture: CaptureMeta = {
    devicePixelRatio: source.devicePixelRatio,
    scrollX: source.scrollX,
    scrollY: source.scrollY,
    eligibleElementCount: source.eligibleElementCount,
    elementsTruncated:
      source.elementsTruncated ||
      sample.elements.length > MAX_ELEMENTS_LIGHT ||
      source.eligibleElementCount > MAX_ELEMENTS_LIGHT,
    light: true,
  };
  if (source.layoutWidth !== undefined) capture.layoutWidth = source.layoutWidth;

  return {
    url: sample.url,
    capturedAt,
    viewportWidth: sample.viewportWidth,
    viewportHeight: sample.viewportHeight,
    fullWidth: sample.fullWidth,
    fullHeight: sample.fullHeight,
    elements,
    capture,
  };
}
