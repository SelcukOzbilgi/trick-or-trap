import { z } from "zod";

// ── PatternId ──────────────────────────────────────────────────────────────

export const PatternIdSchema = z.enum([
  "fake-urgency",
  "fake-scarcity",
  "fake-activity",
  "confirmshaming",
  "preselection",
  "visual-interference",
  "sneak-into-basket",
  "drip-pricing",
  "hard-to-cancel",
]);

export type PatternId = z.infer<typeof PatternIdSchema>;

// ── Confidence ─────────────────────────────────────────────────────────────

export const ConfidenceSchema = z.enum(["high", "medium", "low"]);

export type Confidence = z.infer<typeof ConfidenceSchema>;

// ── BoundingBox ────────────────────────────────────────────────────────────

export const BoundingBoxSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().nonnegative(),
  height: z.number().nonnegative(),
});

export type BoundingBox = z.infer<typeof BoundingBoxSchema>;

// ── ElementSnapshot ────────────────────────────────────────────────────────

export const ElementSnapshotSchema = z.object({
  /** Stable synthetic id assigned by the extractor (not the HTML id attribute). */
  id: z.string(),
  tag: z.string(),
  role: z.string().optional(),
  /** Visible text content of the element. */
  text: z.string().optional(),
  boundingBox: BoundingBoxSchema,
  // Computed style fields (always strings, as returned by getComputedStyle)
  color: z.string(),
  backgroundColor: z.string(),
  fontSize: z.string(),
  opacity: z.string(),
  display: z.string(),
  visibility: z.string(),
  position: z.string(),
  // Form state
  checked: z.boolean(),
  selected: z.boolean(),
  // Capture extensions (page-capture spec). All optional: old snapshots stay valid.
  /** Allow-listed HTML attributes, each value length-capped by the extractor. Untrusted page data. */
  attributes: z.record(z.string(), z.string()).optional(),
  /** True when `text` was cut at the extractor's text cap. */
  textTruncated: z.boolean().optional(),
  /** True when no screenshot image covers any part of the element's box. */
  outsideImage: z.boolean().optional(),
});

export type ElementSnapshot = z.infer<typeof ElementSnapshotSchema>;

// ── CaptureMeta ────────────────────────────────────────────────────────────
// Page-capture metadata: how the sample and its screenshot images were read.

export const CaptureMetaSchema = z.object({
  devicePixelRatio: z.number().positive(),
  scrollX: z.number(),
  scrollY: z.number(),
  eligibleElementCount: z.number().int().nonnegative(),
  elementsTruncated: z.boolean(),
  /** True for the lighter sample read after a reload. */
  light: z.boolean(),
  /** Absent on samples without a screenshot (the reload sample). */
  images: z
    .object({
      mode: z.enum(["single", "tiled"]),
      truncated: z.boolean(),
      items: z
        .array(
          z.object({
            offsetY: z.number().nonnegative(),
            width: z.number().int().positive(),
            height: z.number().int().positive(),
          })
        )
        .min(1),
    })
    .optional(),
});

export type CaptureMeta = z.infer<typeof CaptureMetaSchema>;

// ── BaseSnapshot ───────────────────────────────────────────────────────────
// Flat, non-recursive single-load capture record.

export const BaseSnapshotSchema = z.object({
  url: z.string(),
  capturedAt: z.iso.datetime(), // ISO-8601 datetime string
  viewportWidth: z.number(),
  viewportHeight: z.number(),
  fullWidth: z.number(),
  fullHeight: z.number(),
  elements: z.array(ElementSnapshotSchema),
  screenshotRef: z.string().optional(),
  capture: CaptureMetaSchema.optional(),
});

export type BaseSnapshot = z.infer<typeof BaseSnapshotSchema>;

// ── PageSnapshot ───────────────────────────────────────────────────────────
// Extends BaseSnapshot with optional second-load fields for change detection.

export const PageSnapshotSchema = BaseSnapshotSchema.extend({
  /** Second independent load of the same page (for reload-variance checks). */
  secondSample: BaseSnapshotSchema.optional(),
  /** Snapshot taken after a manual reload (for timer/counter comparison). */
  afterReload: BaseSnapshotSchema.optional(),
});

export type PageSnapshot = z.infer<typeof PageSnapshotSchema>;

// ── Evidence ───────────────────────────────────────────────────────────────

export const EvidenceSchema = z.object({
  /** Human-readable description of what was observed on the page. */
  text: z.string(),
  /** Numeric measurements that back up the finding (contrast ratios, pixel counts, etc.). */
  measuredValues: z.record(z.string(), z.number()).optional(),
});

export type Evidence = z.infer<typeof EvidenceSchema>;

// ── Finding ────────────────────────────────────────────────────────────────

export const FindingSchema = z.object({
  patternId: PatternIdSchema,
  confidence: ConfidenceSchema,
  /** Must start with "Possible". Enforced at the Zod layer. Only the title is prefix-checked. */
  title: z.string().refine(
    (v) => v.startsWith("Possible"),
    "Finding title must start with 'Possible'"
  ),
  /** No prefix rule. Describes what is on the screen. */
  description: z.string(),
  evidence: EvidenceSchema,
  /** Synthetic element ids (from ElementSnapshot.id) the finding references. */
  elementIds: z.array(z.string()),
  /** Bounding boxes to pin monster markers on the screenshot. */
  boundingBoxes: z.array(BoundingBoxSchema),
  /** One-sentence explanation of why this pattern matters to users. */
  explanation: z.string(),
  detectorName: z.string(),
  detectedAt: z.iso.datetime(), // ISO-8601 datetime string
});

export type Finding = z.infer<typeof FindingSchema>;
