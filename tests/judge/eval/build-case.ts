import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { BoundingBoxSchema, PageSnapshotSchema } from "@/lib/types";
import type { PageSnapshot } from "@/lib/types";

/**
 * Loader and snapshot builder of the judge evaluation harness (design section
 * 18). It reads the dev split only, checks its sha256 (requirement 16.2) and
 * builds, for each case, the `PageSnapshot` of the fixture README with exactly
 * the defaults listed there (requirement 16.1). The sealed split is not
 * handled here and is not known to this file.
 */

/** Path of the dev split from the repository root. */
export const DEV_JSON_PATH = "tests/fixtures/judge-eval/dev.json";

/** The sha256 of `dev.json` recorded in the design note (section 7.1). */
export const DEV_SHA256 =
  "68173dd346198c43e3d325c645f50c14e375c8236a66eb123e2689eb444f9cff";

// -- Schema of dev.json -------------------------------------------------------

export const DevPatternSchema = z.enum([
  "fake-urgency",
  "fake-scarcity",
  "fake-activity",
  "confirmshaming",
  "preselection",
  "visual-interference",
]);

/** The subset of `ElementSnapshot` the cases carry; every field but id and tag is optional. */
export const DevElementSchema = z.strictObject({
  id: z.string(),
  tag: z.string(),
  role: z.string().optional(),
  text: z.string().optional(),
  boundingBox: BoundingBoxSchema.optional(),
  color: z.string().optional(),
  backgroundColor: z.string().optional(),
  fontSize: z.string().optional(),
  opacity: z.string().optional(),
  display: z.string().optional(),
  visibility: z.string().optional(),
  position: z.string().optional(),
  checked: z.boolean().optional(),
  selected: z.boolean().optional(),
  attributes: z.record(z.string(), z.string()).optional(),
  outsideImage: z.boolean().optional(),
  textTruncated: z.boolean().optional(),
});

export const DevCaseSchema = z.strictObject({
  id: z.string(),
  lang: z.enum(["en", "tr"]),
  pattern: DevPatternSchema,
  expected: z.enum(["flag", "clean"]),
  elements: z.array(DevElementSchema),
  /** Flag cases only: the element that carries the claim. */
  evidenceElementId: z.string().optional(),
  /** Flag cases only: other parts of a split claim, the paired control or the label. */
  relatedElementIds: z.array(z.string()).optional(),
  /** Clean cases only: a low finding is tolerated. */
  tolerateLow: z.boolean().optional(),
  why: z.string(),
  tags: z.array(z.string()).optional(),
});

export const DevSetSchema = z.object({
  meta: z.object({
    name: z.string(),
    version: z.number(),
    created: z.string(),
    author: z.string(),
    caseCount: z.number(),
  }),
  cases: z.array(DevCaseSchema),
});

export type DevElement = z.infer<typeof DevElementSchema>;
export type DevCase = z.infer<typeof DevCaseSchema>;
export type DevSet = z.infer<typeof DevSetSchema>;

// -- Loading ------------------------------------------------------------------

/**
 * Check the sha256 of the bytes of `dev.json` and parse them. A different
 * hash fails: the dev set is frozen, and a corrected set gets a new version
 * and a new hash. The message holds no content of the file.
 */
export function parseDevSet(bytes: Buffer): DevSet {
  const hash = createHash("sha256").update(bytes).digest("hex");
  if (hash !== DEV_SHA256) {
    throw new Error("dev.json hash mismatch: the dev set is frozen");
  }
  return DevSetSchema.parse(JSON.parse(bytes.toString("utf8")));
}

/** Read `dev.json` from the repository root, check its hash and parse it. */
export function loadDevSet(): DevSet {
  return parseDevSet(readFileSync(join(process.cwd(), DEV_JSON_PATH)));
}

// -- The README defaults (requirement 16.1) -----------------------------------

/** Snapshot fields of the README, not carried by the cases. */
const SNAPSHOT_DEFAULTS = Object.freeze({
  url: "https://shop.example.test/p",
  capturedAt: "2026-11-21T12:00:00.000Z",
  viewportWidth: 1280,
  viewportHeight: 800,
  fullWidth: 1280,
  fullHeight: 3000,
});

/** The default box depends on the position of the element in the case. */
function defaultBox(index: number): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  return { x: 40, y: 100 + 40 * index, width: 400, height: 24 };
}

/**
 * The `PageSnapshot` of one case under the README defaults, validated with
 * `PageSnapshotSchema`. Every `a` element gets `attributes.href = "/x"`,
 * merged into its attributes. The judge receives none of these defaults as
 * such; they only make the snapshot complete so that the rules can run on it.
 */
export function buildCaseSnapshot(devCase: DevCase): PageSnapshot {
  const elements = devCase.elements.map((source, index) => {
    const isLink = source.tag.toLowerCase() === "a";
    const attributes = isLink
      ? { ...(source.attributes ?? {}), href: "/x" }
      : source.attributes;
    return {
      id: source.id,
      tag: source.tag,
      ...(source.role !== undefined ? { role: source.role } : {}),
      ...(source.text !== undefined ? { text: source.text } : {}),
      boundingBox: source.boundingBox ?? defaultBox(index),
      color: source.color ?? "rgb(0, 0, 0)",
      backgroundColor: source.backgroundColor ?? "rgba(0, 0, 0, 0)",
      fontSize: source.fontSize ?? "16px",
      opacity: source.opacity ?? "1",
      display: source.display ?? "block",
      visibility: source.visibility ?? "visible",
      position: source.position ?? "static",
      checked: source.checked ?? false,
      selected: source.selected ?? false,
      ...(attributes !== undefined ? { attributes } : {}),
      ...(source.outsideImage !== undefined ? { outsideImage: source.outsideImage } : {}),
      ...(source.textTruncated !== undefined ? { textTruncated: source.textTruncated } : {}),
    };
  });
  return PageSnapshotSchema.parse({ ...SNAPSHOT_DEFAULTS, elements });
}
