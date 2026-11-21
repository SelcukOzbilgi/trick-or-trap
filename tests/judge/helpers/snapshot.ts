import { PageSnapshotSchema } from "@/lib/types";
import type { ElementSnapshot, PageSnapshot } from "@/lib/types";

/**
 * Small builders of elements and snapshots for the judge tests. Every
 * snapshot is parsed with `PageSnapshotSchema`, so a helper never produces a
 * shape that the capture could not. No test hook attribute and no `data-*`
 * attribute is ever set here.
 */

/** An element given by the test: only the id is required. */
export type ElementInput = Partial<ElementSnapshot> & { id: string };

export const SNAPSHOT_CAPTURED_AT = "2025-03-14T10:30:00.000Z";

/** One element with neutral defaults. The default box depends on `index`. */
export function makeElement(input: ElementInput, index = 0): ElementSnapshot {
  return {
    tag: "div",
    boundingBox: { x: 40, y: 100 + 40 * index, width: 400, height: 24 },
    color: "rgb(0, 0, 0)",
    backgroundColor: "rgba(0, 0, 0, 0)",
    fontSize: "16px",
    opacity: "1",
    display: "block",
    visibility: "visible",
    position: "static",
    checked: false,
    selected: false,
    ...input,
  };
}

/**
 * A snapshot over the given elements, in the given order. `fullHeight` is at
 * least the bottom of the last default box (requirement 21.1: a box below the
 * page is not sent), so a page of 1,500 default rows stays on the page; an
 * explicit `extra.fullHeight` wins.
 */
export function makeSnapshot(
  elements: readonly ElementInput[],
  extra: Partial<PageSnapshot> = {},
): PageSnapshot {
  const lastDefaultBottom = 100 + 40 * Math.max(0, elements.length - 1) + 24;
  return PageSnapshotSchema.parse({
    url: "https://shop.example/",
    capturedAt: SNAPSHOT_CAPTURED_AT,
    viewportWidth: 1280,
    viewportHeight: 800,
    fullWidth: 1280,
    fullHeight: Math.max(2000, lastDefaultBottom),
    elements: elements.map((input, index) => makeElement(input, index)),
    ...extra,
  });
}

/** A checkbox or radio input. */
export function makeInput(
  id: string,
  type: "checkbox" | "radio",
  options: {
    checked?: boolean;
    name?: string;
    box?: ElementSnapshot["boundingBox"];
  } = {},
): ElementInput {
  const attributes: Record<string, string> = { type };
  if (options.name !== undefined) attributes.name = options.name;
  return {
    id,
    tag: "input",
    checked: options.checked ?? false,
    attributes,
    ...(options.box ? { boundingBox: options.box } : {}),
  };
}

/** A text element with a given tag. */
export function makeText(
  id: string,
  tag: string,
  text: string,
  extra: Partial<ElementSnapshot> = {},
): ElementInput {
  return { id, tag, text, ...extra };
}
