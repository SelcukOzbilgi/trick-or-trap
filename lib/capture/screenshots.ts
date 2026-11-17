/**
 * Screenshots of the page capture, taken through the browser seam from the same load
 * as the first element read.
 *
 * Single mode takes one clipped image of the top of the document. Tiled mode, used
 * for very tall documents, scrolls and takes viewport-only images. Tiled mode never
 * asks for a full-page or a clipped screenshot (see "Geometry and screenshot" in the
 * design: those stalled on a 45,000 px page).
 */
import type { Deadline } from "./clock";
import { SCREENSHOT_JPEG_QUALITY, TILE_MIN_REMAINING_MS } from "./constants";
import {
  base64Length,
  chooseMode,
  planSingle,
  reachesBottom,
  tileCount,
  tileTarget,
  totalFits,
  type ImageBox,
  type ScreenshotMode,
} from "./geometry";
import { toDetail } from "./redact";
import type { CapturePage } from "./seam";
import { CaptureFailure } from "./types";
import type { CaptureImage, CaptureWarningCode, RawPageRead } from "./types";

export type ImagesOutcome = {
  images: CaptureImage[];
  meta: { mode: ScreenshotMode; truncated: boolean; items: ImageBox[] };
  warnings: CaptureWarningCode[]; // "screenshot-truncated", "tall-page-tiled"
};

/** Runs one seam call inside the whole-capture budget. A synchronous throw becomes a rejection. */
function step<T>(deadline: Deadline, call: () => Promise<T>): Promise<T> {
  return deadline.run((async () => call())());
}

function isTimeout(error: unknown): boolean {
  return error instanceof CaptureFailure && error.code === "capture-timeout";
}

/** Maps anything a screenshot step threw to `screenshot-failed`, except what already is a CaptureFailure. */
function asScreenshotFailure(error: unknown): CaptureFailure {
  if (error instanceof CaptureFailure) return error;
  return new CaptureFailure("screenshot-failed", toDetail(error, []));
}

function toImage(bytes: Uint8Array, box: ImageBox): CaptureImage {
  return {
    offsetY: box.offsetY,
    width: box.width,
    height: box.height,
    bytes,
    base64Length: base64Length(bytes.length),
  };
}

function finiteOrZero(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

async function captureSingle(page: CapturePage, read: RawPageRead, deadline: Deadline): Promise<ImagesOutcome> {
  const plan = planSingle({ fullHeight: read.scrollHeight, viewportWidth: read.innerWidth });
  let bytes: Uint8Array;
  try {
    bytes = await step(deadline, () =>
      page.screenshot({
        kind: "clip",
        clip: { x: 0, y: 0, width: plan.width, height: plan.height },
        quality: SCREENSHOT_JPEG_QUALITY,
      }),
    );
  } catch (error) {
    throw asScreenshotFailure(error);
  }
  if (!totalFits([bytes.length])) throw new CaptureFailure("screenshot-too-large");

  const box: ImageBox = { offsetY: 0, width: plan.width, height: plan.height };
  return {
    images: [toImage(bytes, box)],
    meta: { mode: "single", truncated: plan.truncated, items: [box] },
    warnings: plan.truncated ? ["screenshot-truncated"] : [],
  };
}

async function captureTiled(page: CapturePage, read: RawPageRead, deadline: Deadline): Promise<ImagesOutcome> {
  const fullHeight = finiteOrZero(read.scrollHeight);
  const tileWidth = Math.max(1, Math.ceil(finiteOrZero(read.innerWidth)));
  const tileHeight = Math.max(1, Math.ceil(finiteOrZero(read.innerHeight)));
  const count = tileCount(fullHeight, tileHeight);
  const images: CaptureImage[] = [];

  for (let index = 0; index < count; index++) {
    if (index > 0) {
      const previous = images[images.length - 1];
      if (reachesBottom(previous, fullHeight)) break;
      if (deadline.remainingMs() < TILE_MIN_REMAINING_MS) break;
    }
    try {
      const real = await step(deadline, () => page.scrollTo(tileTarget(index, tileHeight)));
      const offsetY = finiteOrZero(real);
      // A page that does not scroll would give the same tile again and again.
      if (index > 0 && offsetY <= images[images.length - 1].offsetY) break;
      const bytes = await step(deadline, () =>
        page.screenshot({ kind: "viewport", quality: SCREENSHOT_JPEG_QUALITY }),
      );
      images.push(toImage(bytes, { offsetY, width: tileWidth, height: tileHeight }));
    } catch (error) {
      // The whole budget is gone: nothing else can run, so this is the capture's error.
      if (isTimeout(error)) throw error;
      // The first tile is required. Later problems keep the tiles taken so far.
      if (index === 0) throw asScreenshotFailure(error);
      break;
    }
  }

  // Leave the page where it was. Best effort: a failure here is ignored.
  try {
    await step(deadline, () => page.scrollTo(0));
  } catch {
    // ignored
  }

  if (!totalFits(images.map((image) => image.bytes.length))) throw new CaptureFailure("screenshot-too-large");

  const last = images[images.length - 1];
  const truncated = !reachesBottom(last, fullHeight);
  const warnings: CaptureWarningCode[] = ["tall-page-tiled"];
  if (truncated) warnings.push("screenshot-truncated");
  return {
    images,
    meta: {
      mode: "tiled",
      truncated,
      items: images.map((image) => ({ offsetY: image.offsetY, width: image.width, height: image.height })),
    },
    warnings,
  };
}

/**
 * Takes the screenshots of the first sample, in single or tiled mode.
 *
 * Throws `CaptureFailure("screenshot-failed" | "screenshot-too-large" | "capture-timeout")`.
 * Uses `read.scrollHeight`, `read.devicePixelRatio`, `read.innerWidth` and
 * `read.innerHeight`; every call counts against the whole-capture `deadline`.
 */
export function captureImages(page: CapturePage, read: RawPageRead, deadline: Deadline): Promise<ImagesOutcome> {
  const mode = chooseMode({ fullHeight: read.scrollHeight, devicePixelRatio: read.devicePixelRatio });
  return mode === "single" ? captureSingle(page, read, deadline) : captureTiled(page, read, deadline);
}
