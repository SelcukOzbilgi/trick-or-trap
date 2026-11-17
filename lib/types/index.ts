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
  id: z.string().max(2_048),
  tag: z.string().max(64),
  role: z.string().max(64).optional(),
  /** Visible text content of the element. */
  text: z.string().max(1_000).optional(),
  boundingBox: BoundingBoxSchema,
  // Computed style fields (always strings, as returned by getComputedStyle)
  color: z.string().max(64),
  backgroundColor: z.string().max(64),
  fontSize: z.string().max(64),
  opacity: z.string().max(64),
  display: z.string().max(64),
  visibility: z.string().max(64),
  position: z.string().max(64),
  // Form state
  checked: z.boolean(),
  selected: z.boolean(),
  // Capture extensions (page-capture spec). All optional: old snapshots stay valid.
  /** Allow-listed HTML attributes, each value length-capped by the extractor. Untrusted page data. */
  attributes: z
    .record(z.string().max(64), z.string().max(200))
    .refine((value) => Object.keys(value).length <= 32, "At most 32 attributes")
    .optional(),
  /** True when `text` was cut at the extractor's text cap. */
  textTruncated: z.boolean().optional(),
  /** True when no screenshot image covers any part of the element's box. */
  outsideImage: z.boolean().optional(),
});

export type ElementSnapshot = z.infer<typeof ElementSnapshotSchema>;

// ── CaptureMeta ────────────────────────────────────────────────────────────
// Page-capture metadata: how the sample and its screenshot images were read.
// The limits are literals: lib/types must not import lib/capture.
// tests/types/capture-meta.test.ts compares them with the capture constants.

export const CaptureMetaSchema = z.object({
  devicePixelRatio: z.number().positive().max(16),
  /** Layout width in CSS px used for the read and the single image. Absent on older snapshots. */
  layoutWidth: z.number().positive().max(100_000).optional(),
  scrollX: z.number(),
  scrollY: z.number(),
  eligibleElementCount: z.number().int().nonnegative().max(10_000_000),
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
        .min(1)
        .max(10),
    })
    .optional(),
});

export type CaptureMeta = z.infer<typeof CaptureMetaSchema>;

// ── BaseSnapshot ───────────────────────────────────────────────────────────
// Flat, non-recursive single-load capture record.

export const BaseSnapshotSchema = z.object({
  url: z.string().max(8_192),
  capturedAt: z.iso.datetime(), // ISO-8601 datetime string
  viewportWidth: z.number(),
  viewportHeight: z.number(),
  fullWidth: z.number(),
  fullHeight: z.number(),
  elements: z.array(ElementSnapshotSchema).max(1_500),
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
