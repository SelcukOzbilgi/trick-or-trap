import { createRegistry } from "@/lib/detectors";
import type {
  Detector,
  DetectorRunResult,
  Registry,
} from "@/lib/detectors";
import { detectConfirmshaming } from "@/lib/detectors/confirmshaming";
import { detectFakeActivity } from "@/lib/detectors/fake-activity";
import { detectFakeScarcity } from "@/lib/detectors/fake-scarcity";
import { detectFakeUrgency } from "@/lib/detectors/fake-urgency";
import { detectPreselection } from "@/lib/detectors/preselection";
import { detectVisualInterference } from "@/lib/detectors/visual-interference";
import type { StaticPatternId } from "@/lib/detectors/shared/finding";
import type { PageSnapshot } from "@/lib/types";

/** The static detectors, in registration order. */
export const STATIC_DETECTORS: ReadonlyArray<{
  readonly name: StaticPatternId;
  readonly detect: Detector;
}> = Object.freeze([
  Object.freeze({ name: "fake-urgency", detect: detectFakeUrgency }),
  Object.freeze({ name: "fake-scarcity", detect: detectFakeScarcity }),
  Object.freeze({ name: "fake-activity", detect: detectFakeActivity }),
  Object.freeze({ name: "confirmshaming", detect: detectConfirmshaming }),
  Object.freeze({ name: "preselection", detect: detectPreselection }),
  Object.freeze({
    name: "visual-interference",
    detect: detectVisualInterference,
  }),
] as const);

/** The names of the static detectors, in registration order. */
export const STATIC_DETECTOR_NAMES: readonly StaticPatternId[] = Object.freeze(
  STATIC_DETECTORS.map((entry) => entry.name)
);

/**
 * Build a new registry that holds the six static detectors. Every call returns
 * an independent registry; nothing is registered at module level.
 */
export function createStaticRegistry(): Registry {
  const registry = createRegistry();
  for (const entry of STATIC_DETECTORS) {
    registry.registerDetector(entry.name, entry.detect);
  }
  return registry;
}

/** Run all six static detectors against the snapshot on a fresh registry. */
export function runAllDetectors(snapshot: PageSnapshot): DetectorRunResult {
  return createStaticRegistry().runDetectors(snapshot);
}
